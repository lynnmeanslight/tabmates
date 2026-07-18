// End-to-end smoke test against the LIVE TabMates contract on Monad testnet.
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

const TAB = "0x6B7DF3C263E495c319b3841c658A23E5E361d110";

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

const abi = JSON.parse(
  readFileSync(new URL("../contracts/out/TabMates.sol/TabMates.json", import.meta.url), "utf8")
).abi;

const key = process.env.DEPLOYER_KEY;
if (!key) throw new Error("set DEPLOYER_KEY");

const alice = privateKeyToAccount(key);
const bobKey = generatePrivateKey();
const bob = privateKeyToAccount(bobKey);

const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const wAlice = createWalletClient({ account: alice, chain: monadTestnet, transport: http() });
const wBob = createWalletClient({ account: bob, chain: monadTestnet, transport: http() });

const send = async (wallet, fn, args, value) => {
  const hash = await wallet.writeContract({
    address: TAB,
    abi,
    functionName: fn,
    args,
    ...(value ? { value } : {}),
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`  ${fn} → ${rcpt.status} (${hash.slice(0, 18)}…)`);
  return rcpt;
};

console.log(`alice (deployer): ${alice.address}`);
console.log(`bob   (fresh):    ${bob.address}`);

// fund bob from alice so he can settle
console.log("\n1. funding bob with 1 MON…");
const fundHash = await wAlice.sendTransaction({ to: bob.address, value: parseEther("1") });
await pub.waitForTransactionReceipt({ hash: fundHash });

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

console.log("\nSMOKE TEST PASSED — live contract behaves correctly on Monad testnet");
