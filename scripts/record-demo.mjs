// Records the demo video: drives the LIVE hosted app with two funded testnet
// wallets (you + roomie), performing real onchain transactions on camera.
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

const APP = "https://lynnmeanslight.github.io/tab-monad/";
const CHROME = `${homedir()}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

const you = privateKeyToAccount(process.env.DEPLOYER_KEY);
const roomieKey = generatePrivateKey();
const roomie = privateKeyToAccount(roomieKey);

const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const wallets = {
  [you.address.toLowerCase()]: createWalletClient({ account: you, chain: monadTestnet, transport: http() }),
  [roomie.address.toLowerCase()]: createWalletClient({ account: roomie, chain: monadTestnet, transport: http() }),
};

console.log(`you:    ${you.address}`);
console.log(`roomie: ${roomie.address}`);

// fund roomie for settling + gas
console.log("funding roomie with 0.6 MON…");
const fh = await wallets[you.address.toLowerCase()].sendTransaction({
  to: roomie.address,
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

// Node-side signer the page shim calls for eth_sendTransaction
await page.exposeBinding("__signAndSend", async (_src, txJson) => {
  const tx = JSON.parse(txJson);
  const w = wallets[tx.from.toLowerCase()];
  const hash = await w.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : undefined,
  });
  console.log(`  signed ${tx.from.slice(0, 8)}… → ${hash.slice(0, 18)}…`);
  return hash;
});

// EIP-1193 shim + fake cursor + caption chip
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
            return null;
          case "eth_sendTransaction":
            return window.__signAndSend(JSON.stringify(params[0]));
          default:
            return rpc(method, params ?? []);
        }
      },
    };
    window.__switchAccount = (a) => {
      account = a;
      (handlers["accountsChanged"] || []).forEach((f) => f([a]));
    };
    // fake cursor + caption
    addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("div");
      c.id = "__cursor";
      c.style.cssText =
        "position:fixed;width:22px;height:22px;border-radius:50%;background:#c2492fcc;border:2.5px solid #fff;box-shadow:0 1px 6px #0006;pointer-events:none;z-index:99999;transform:translate(-50%,-50%);transition:left .05s,top .05s;left:-40px;top:-40px";
      document.body.appendChild(c);
      addEventListener("mousemove", (e) => {
        c.style.left = e.clientX + "px";
        c.style.top = e.clientY + "px";
      });
      const cap = document.createElement("div");
      cap.id = "__cap";
      cap.style.cssText =
        "position:fixed;left:24px;bottom:24px;background:#1c1a17;color:#f6f1e7;font:600 15px 'IBM Plex Mono',monospace;padding:10px 18px;border-radius:10px;z-index:99998;box-shadow:0 6px 24px #0005;max-width:520px;display:none";
      document.body.appendChild(cap);
      window.__caption = (t) => {
        cap.textContent = t;
        cap.style.display = t ? "block" : "none";
      };
    });
  },
  { initialAccount: you.address }
);

const caption = (t) => page.evaluate((x) => window.__caption(x), t);
const pause = (ms) => page.waitForTimeout(ms);
const glideClick = async (locator) => {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await pause(350);
  await locator.click();
};
const typeSlow = async (locator, text) => {
  await glideClick(locator);
  await locator.pressSequentially(text, { delay: 55 });
};

// ---------------------------------------------------------------- scenes

await page.goto(APP, { waitUntil: "networkidle" });
await pause(1200);
await caption("Tab — shared expenses that actually get settled · live on Monad Testnet");
await pause(3200);

await caption("connect your wallet");
await glideClick(page.getByRole("button", { name: "Connect wallet" }));
await pause(2200);

await caption("1 · open a tab with your roommate");
await typeSlow(page.getByPlaceholder("Flat 4B · Lisbon trip · Lunch crew"), "Demo House");
await typeSlow(page.getByPlaceholder("0xabc…\n0xdef…"), roomie.address);
await pause(500);
await glideClick(page.getByRole("button", { name: "Open tab" }));
await caption("every tab is a real onchain group — watch the toast");
await page.getByText("is live onchain").waitFor({ timeout: 30000 });
await pause(2000);

await caption("2 · log what you paid for");
await glideClick(page.getByRole("heading", { name: "Demo House" }));
await pause(1500);
await typeSlow(page.getByPlaceholder("Groceries, rent, 3am pizza…"), "Groceries");
await typeSlow(page.getByPlaceholder("2.5"), "0.3");
await pause(400);
await glideClick(page.getByRole("button", { name: "Log expense" }));
await page.getByText("split 2 ways").first().waitFor({ timeout: 30000 });
await caption("split equally, debt recorded onchain in under a second");
await pause(2500);

await caption("your roommate now owes you 0.15 MON — the contract nets every pair");
await pause(3000);

await caption("3 · switch to your roommate's wallet…");
await page.evaluate((a) => window.__switchAccount(a), roomie.address);
await pause(2500);
await glideClick(page.getByRole("heading", { name: "Demo House" }).first());
await pause(1800);

await caption("4 · settle up — with real MON, not a checkbox");
const settleBtn = page.getByRole("button", { name: "settle" });
await settleBtn.waitFor({ timeout: 15000 });
await glideClick(settleBtn);
await pause(800);
await glideClick(page.getByRole("button", { name: "pay", exact: true }));
await caption("0.15 MON goes wallet-to-wallet through the contract…");
await page.getByText("Paid in full").waitFor({ timeout: 30000 });
await caption("PAID IN FULL — ledger and money agree, forever, onchain");
await pause(3200);

await caption("every expense & payment, straight from the chain — no backend, no indexer");
await page.mouse.wheel(0, 500);
await pause(3000);

await caption("Tab · github.com/lynnmeanslight/tab-monad · built on Monad");
await pause(3000);
await caption("");

await ctx.close();
await browser.close();

// return roomie's leftover MON
const left = await pub.getBalance({ address: roomie.address });
const back = left - parseEther("0.03");
if (back > 0n) {
  const w = createWalletClient({ account: roomie, chain: monadTestnet, transport: http() });
  const h = await w.sendTransaction({ to: you.address, value: back });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log("returned roomie float");
}
console.log("DONE — video in demo/");
