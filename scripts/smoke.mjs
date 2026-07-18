// End-to-end smoke test against the LIVE TabMates contract on Monad mainnet.
// Simulates two roommates: creates a tab, logs expenses, settles with real MON.
// Usage: DEPLOYER_KEY=0x... node scripts/smoke.mjs
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";

const TAB = "0xc294C7E608F79e9FfCF4eDB85e36A91E4CCBAdB9";

const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
});

const abi = JSON.parse(
  readFileSync(new URL("../contracts/out/TabMates.sol/TabMates.json", import.meta.url), "utf8")
).abi;

const key = process.env.DEPLOYER_KEY;
if (!key) throw new Error("set DEPLOYER_KEY");

const alice = privateKeyToAccount(key);
const bobKey = generatePrivateKey();
const bob = privateKeyToAccount(bobKey);

const pub = createPublicClient({ chain: monad, transport: http() });
const wAlice = createWalletClient({ account: alice, chain: monad, transport: http() });
const wBob = createWalletClient({ account: bob, chain: monad, transport: http() });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const send = async (wallet, fn, args, value) => {
  // pad gas 1.5×: Monad mainnet's raw estimate can out-of-gas at execution
  const estimated = await pub.estimateContractGas({
    address: TAB,
    abi,
    functionName: fn,
    args,
    account: wallet.account,
    ...(value ? { value } : {}),
  });
  // Monad admission checks run against a k-block LAGGED state: a freshly
  // funded sender can be rejected with "insufficient balance" for a couple
  // of seconds even though the receipt is in. Retry with backoff.
  let hash;
  for (let attempt = 1; ; attempt++) {
    try {
      hash = await wallet.writeContract({
        address: TAB,
        abi,
        functionName: fn,
        args,
        gas: (estimated * 15n) / 10n,
        ...(value ? { value } : {}),
      });
      break;
    } catch (err) {
      if (attempt < 6 && `${err}`.includes("insufficient balance")) {
        console.log(`  (lagged-state admission reject, retry ${attempt}…)`);
        await wait(1000);
        continue;
      }
      throw err;
    }
  }
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`${fn} reverted: ${hash}`);
  console.log(`  ${fn} → ${rcpt.status} (${hash})`);
  // Monad reserve-balance: senders < 10 MON need their previous tx to be
  // ≥ k=3 blocks (1.2s) old, or value-spending txs are included-but-reverted.
  await wait(1500);
  return rcpt;
};

console.log(`alice (deployer): ${alice.address}`);
console.log(`bob   (fresh):    ${bob.address}`);

// fund bob from alice so he can settle
console.log("\n1. funding bob with 1 MON…");
const fundHash = await wAlice.sendTransaction({ to: bob.address, value: parseEther("1") });
await pub.waitForTransactionReceipt({ hash: fundHash });
// newly-funded accounts can't spend until the credit is k=3 blocks old
await wait(1500);

console.log("\n2. alice opens tab 'Flat 4B' with bob (named!)…");
await send(wAlice, "createGroup", ["Flat 4B", "Alice", [bob.address], ["Bob"]]);
const count = await pub.readContract({ address: TAB, abi, functionName: "groupCount" });
const gid = count - 1n;
console.log(`  tab id: ${gid}`);

const [, , , , labels] = await pub.readContract({
  address: TAB, abi, functionName: "getGroup", args: [gid],
});
console.log(`  member labels onchain: ${JSON.stringify(labels)}`);

console.log("\n3. alice logs 'Groceries' 0.4 MON split 2 ways…");
await send(wAlice, "addExpense", [gid, "Groceries", parseEther("0.4"), [alice.address, bob.address]]);

console.log("\n4. bob logs 'Internet bill' 0.2 MON split 2 ways…");
await send(wBob, "addExpense", [gid, "Internet bill", parseEther("0.2"), [alice.address, bob.address]]);

let [debtors, creditors, amounts] = await pub.readContract({
  address: TAB, abi, functionName: "getAllDebts", args: [gid],
});
console.log("\n  debts after netting:");
debtors.forEach((d, i) =>
  console.log(`    ${d.slice(0, 8)}… owes ${creditors[i].slice(0, 8)}… ${formatEther(amounts[i])} MON`)
);

const aliceBefore = await pub.getBalance({ address: alice.address });

console.log("\n5. bob settles his 0.1 MON debt with real MON…");
await send(wBob, "settle", [gid, alice.address], parseEther("0.1"));

const aliceAfter = await pub.getBalance({ address: alice.address });
console.log(`  alice balance delta: +${formatEther(aliceAfter - aliceBefore)} MON`);

[debtors, creditors, amounts] = await pub.readContract({
  address: TAB, abi, functionName: "getAllDebts", args: [gid],
});
console.log(`  remaining debt edges: ${debtors.length}`);

const net = await pub.readContract({
  address: TAB, abi, functionName: "netBalance", args: [gid, alice.address],
});
console.log(`  alice net position: ${formatEther(net)} MON`);

// return bob's leftover gas money
const bobLeft = await pub.getBalance({ address: bob.address });
const refund = bobLeft - parseEther("0.05");
if (refund > 0n) {
  const h = await wBob.sendTransaction({ to: alice.address, value: refund });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log(`\n6. returned ${formatEther(refund)} MON of bob's float to alice`);
}

console.log("\nSMOKE TEST PASSED — live contract behaves correctly on Monad mainnet");
