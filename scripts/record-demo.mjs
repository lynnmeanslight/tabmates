// Records the TabMates demo video: drives the LIVE hosted app with two funded
// testnet wallets (you + Maya), performing real onchain transactions on camera.
// Privy auth is done via the "browser wallet" path — the injected shim signs
// SIWE messages and transactions with real keys through viem.
// Usage: DEPLOYER_KEY=0x... node scripts/record-demo.mjs
import { chromium } from "playwright-core";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { homedir } from "node:os";

const APP = "https://lynnmeanslight.github.io/tabmates/";
const CHROME = `${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

const you = privateKeyToAccount(process.env.DEPLOYER_KEY);
const mayaKey = generatePrivateKey();
const maya = privateKeyToAccount(mayaKey);

const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const accounts = {
  [you.address.toLowerCase()]: you,
  [maya.address.toLowerCase()]: maya,
};
const walletOf = (addr) =>
  createWalletClient({
    account: accounts[addr.toLowerCase()],
    chain: monadTestnet,
    transport: http(),
  });

console.log(`you:  ${you.address}`);
console.log(`maya: ${maya.address}`);

console.log("funding maya with 0.6 MON…");
const fh = await walletOf(you.address).sendTransaction({
  to: maya.address,
  value: parseEther("0.6"),
});
await pub.waitForTransactionReceipt({ hash: fh });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  recordVideo: { dir: "demo/", size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();

// Node-side signer for the page shim
await page.exposeBinding("__signAndSend", async (_src, txJson) => {
  const tx = JSON.parse(txJson);
  const hash = await walletOf(tx.from).sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : undefined,
  });
  console.log(`  tx ${tx.from.slice(0, 8)}… → ${hash.slice(0, 18)}…`);
  return hash;
});
await page.exposeBinding("__signMessage", async (_src, addr, message) => {
  const account = accounts[addr.toLowerCase()];
  const sig = await account.signMessage({
    message: message.startsWith("0x")
      ? { raw: message }
      : message,
  });
  console.log(`  siwe signed by ${addr.slice(0, 8)}…`);
  return sig;
});
await page.exposeBinding("__signTypedData", async (_src, addr, typedJson) => {
  const account = accounts[addr.toLowerCase()];
  const t = JSON.parse(typedJson);
  return account.signTypedData({
    domain: t.domain,
    types: t.types,
    primaryType: t.primaryType,
    message: t.message,
  });
});
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning")
    console.log(`  [page ${m.type()}] ${m.text().slice(0, 140)}`);
});

// EIP-1193 shim (handles Privy's SIWE wallet login) + cursor + captions
await page.addInitScript(
  ({ initialAccount }) => {
    let account = initialAccount;
    const handlers = {};
    const rpc = async (method, params) => {
      const res = await fetch("https://testnet-rpc.monad.xyz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    };
    window.ethereum = {
      isMetaMask: true,
      on: (ev, fn) => ((handlers[ev] ||= []).push(fn)),
      removeListener: (ev, fn) => {
        handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn);
      },
      request: async ({ method, params }) => {
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts":
            return [account];
          case "eth_chainId":
            return "0x279f";
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain":
          case "wallet_watchAsset":
            return null;
          case "wallet_requestPermissions":
          case "wallet_getPermissions":
            return [{ parentCapability: "eth_accounts" }];
          case "wallet_revokePermissions":
            return null;
          case "personal_sign": {
            // params: [message, address] — message may be hex or utf8
            const [msg, addr] = params;
            let text = msg;
            if (typeof msg === "string" && msg.startsWith("0x")) {
              try {
                const bytes = msg
                  .slice(2)
                  .match(/.{1,2}/g)
                  .map((b) => parseInt(b, 16));
                text = new TextDecoder().decode(new Uint8Array(bytes));
              } catch {
                text = msg;
              }
            }
            return window.__signMessage(addr, text);
          }
          case "eth_signTypedData_v4":
          case "eth_signTypedData": {
            const [addr, typed] = params;
            return window.__signTypedData(
              addr,
              typeof typed === "string" ? typed : JSON.stringify(typed)
            );
          }
          case "eth_sendTransaction":
            return window.__signAndSend(JSON.stringify(params[0]));
          default:
            if (method.startsWith("wallet_")) return null;
            return rpc(method, params ?? []);
        }
      },
    };
    window.__switchAccount = (a) => {
      account = a;
      (handlers["accountsChanged"] || []).forEach((f) => f([a]));
    };
    // EIP-6963 announcement so Privy's wallet list detects the shim
    const providerInfo = {
      uuid: "b8f7d3a2-1c4e-4f6a-9d2b-7e5a9c1d3f60",
      name: "MetaMask",
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      rdns: "io.metamask",
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: Object.freeze({ info: providerInfo, provider: window.ethereum }),
        })
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("div");
      c.id = "__cursor";
      c.style.cssText =
        "position:fixed;width:22px;height:22px;border-radius:50%;background:#c2492fcc;border:2.5px solid #fff;box-shadow:0 1px 6px #0006;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:left .05s,top .05s;left:-40px;top:-40px";
      document.body.appendChild(c);
      addEventListener("mousemove", (e) => {
        c.style.left = e.clientX + "px";
        c.style.top = e.clientY + "px";
      });
      const cap = document.createElement("div");
      cap.id = "__cap";
      cap.style.cssText =
        "position:fixed;left:24px;bottom:24px;background:#1c1a17;color:#f6f1e7;font:600 15px 'IBM Plex Mono',monospace;padding:10px 18px;border-radius:10px;z-index:2147483646;box-shadow:0 6px 24px #0005;max-width:560px;display:none";
      document.body.appendChild(cap);
      window.__caption = (t) => {
        cap.textContent = t;
        cap.style.display = t ? "block" : "none";
      };
    });
  },
  { initialAccount: you.address }
);

const caption = (t) => page.evaluate((x) => window.__caption?.(x), t).catch(() => {});
const pause = (ms) => page.waitForTimeout(ms);
const glideClick = async (locator) => {
  await locator.waitFor({ timeout: 20000 });
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await pause(320);
  await locator.click();
};
const typeSlow = async (locator, text) => {
  await glideClick(locator);
  await locator.pressSequentially(text, { delay: 50 });
};

// Privy login via the wallet path (shim signs SIWE automatically)
async function privyLogin() {
  await glideClick(page.getByRole("button", { name: "Sign in" }));
  await pause(1500);
  const modal = page.locator("#privy-modal-content");
  await glideClick(modal.getByRole("button", { name: /continue with a wallet/i }).first());
  await pause(1200);
  // second screen may list detected wallets (MetaMask via EIP-6963)
  const detected = modal.getByRole("button", { name: /metamask/i }).first();
  if (await detected.isVisible().catch(() => false)) {
    await glideClick(detected);
  }
  // handle SIWE / retry prompts inside the modal only
  for (let i = 0; i < 20; i++) {
    if (await page.locator(".account-chip").isVisible().catch(() => false)) break;
    const retry = modal.getByRole("button", { name: /retry/i }).first();
    const sign = modal.getByRole("button", { name: /^sign( and continue)?$|confirm/i }).first();
    if (await sign.isVisible().catch(() => false)) await sign.click().catch(() => {});
    else if (await retry.isVisible().catch(() => false)) await retry.click().catch(() => {});
    await pause(1000);
  }
  await page.locator(".account-chip").waitFor({ timeout: 20000 });
}

async function privyLogout() {
  await glideClick(page.locator(".account-chip button.ghost"));
  await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 20000 });
}

// ---------------------------------------------------------------- scenes

await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 30000 });
await pause(1500);
await caption("TabMates — split expenses with people, not hex addresses · live on Monad");
await pause(3000);

await caption("sign in — email, Google, or wallet (Privy)");
await privyLogin();
await pause(2000);

await caption("1 · open a tab — with real names, stored onchain");
await typeSlow(page.getByPlaceholder("Flat 4B · Lisbon trip · Lunch crew"), "Demo House");
await typeSlow(page.getByPlaceholder("Lynn"), "Lynn");
await typeSlow(page.getByPlaceholder("0x… wallet address"), maya.address);
await typeSlow(page.getByPlaceholder("Name (e.g. Maya)"), "Maya");
await pause(400);
await glideClick(page.getByRole("button", { name: "Open tab" }));
await page.getByText("is live onchain").waitFor({ timeout: 40000 });
await pause(1800);

await caption("2 · log what you paid for");
await glideClick(page.getByRole("heading", { name: "Demo House" }));
await pause(1500);
await typeSlow(page.getByPlaceholder("Groceries, rent, 3am pizza…"), "Groceries");
await typeSlow(page.getByPlaceholder("2.5"), "0.3");
await pause(400);
await glideClick(page.getByRole("button", { name: "Log expense" }));
await page.getByText("split 2 ways").first().waitFor({ timeout: 40000 });
await caption('the ledger reads "Maya owes Lynn" — not 0xf6a5…');
await pause(3200);

await caption("3 · now Maya signs in and settles up…");
await privyLogout();
await page.evaluate((a) => window.__switchAccount(a), maya.address);
await pause(800);
await privyLogin();
await pause(1800);
await glideClick(page.getByRole("heading", { name: "Demo House" }).first());
await pause(1800);

await caption("4 · settle = pay — real MON, wallet to wallet, in one click");
await glideClick(page.getByRole("button", { name: "settle" }));
await pause(700);
await glideClick(page.getByRole("button", { name: "pay", exact: true }));
await page.getByText("Paid in full").waitFor({ timeout: 40000 });
await caption("PAID IN FULL — ledger and money agree, forever, onchain");
await pause(3000);

await caption("every expense & payment straight from the chain — no backend, no indexer");
await page.mouse.wheel(0, 520);
await pause(2800);

await caption("TabMates · github.com/lynnmeanslight/tabmates · built on Monad");
await pause(3000);
await caption("");

await ctx.close();
await browser.close();

const left = await pub.getBalance({ address: maya.address });
const back = left - parseEther("0.03");
if (back > 0n) {
  const h = await walletOf(maya.address).sendTransaction({ to: you.address, value: back });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log("returned maya's float");
}
console.log("DONE — video in demo/");
