# TabMates — the roommate ledger on Monad

**Split the bill. Actually settle it.**

Live app: **https://lynnmeanslight.github.io/tabmates/** · Contract: [`0xc294C7E608F79e9FfCF4eDB85e36A91E4CCBAdB9`](https://monadvision.com/address/0xc294C7E608F79e9FfCF4eDB85e36A91E4CCBAdB9) (Monad Mainnet, [verified](https://monadvision.com/address/0xc294C7E608F79e9FfCF4eDB85e36A91E4CCBAdB9?tab=Contract))

## The problem (a personal one)

I live with two roommates. We track shared groceries, internet, and 3am pizza
in a notes app, and the "ledger" always ends the same way: everyone knows who
owes what, and **nobody ever actually pays**. Splitwise-style apps stop at the
IOU — settling means opening a bank app, typing an amount, forgetting, being
nagged, repeat. The ledger and the money live in different worlds.

## The solution

TabMates puts the ledger and the money in the same place. It's a
shared-expenses tracker where the **settle button is a real value transfer**:

- **Sign in like a normal app** — email, Google, or any wallet, via
  [Privy](https://privy.io). No wallet? An embedded one is created for you.
- **Open a tab** with any group (roommates, a trip, the lunch crew) and give
  everyone a **human name, stored onchain** — the ledger reads "Maya owes
  Lynn", not `0xf6A5… owes 0xA858…`.
- **Log expenses** — equal split between whoever you pick. Every entry is an
  onchain transaction, viable only because Monad confirms in well under a
  second and charges a fraction of a cent.
- **Debts net automatically in the contract.** If I owe you 1 MON from
  groceries and you owe me 0.5 from the cab, the ledger holds a single 0.5
  edge — never two opposing IOUs (per pair, at most one direction is ever
  non-zero, enforced by `_addDebt`).
- **Settle = pay.** One click sends MON through the contract straight to your
  roommate's wallet and clears the debt in the same transaction. Partial
  payments welcome. The contract holds **zero custody** — it never keeps funds.

No indexer, no backend, no database: the UI reads everything from contract
view functions (`getAllDebts`, `netBalance`, ranged feeds) every few seconds.

## Run it in 3 minutes

Sign in with email/Google (Privy creates an embedded wallet for you) or a
browser wallet. TabMates runs on **Monad mainnet** — settling moves real MON
(logging expenses only costs gas, a fraction of a cent).

**Just use it:** open the [live app](https://lynnmeanslight.github.io/tabmates/),
sign in, open a tab (name your mates!), log an expense. To see the full loop,
add a second account as a member and settle from it.

**Or run locally:**

```sh
cd web
npm install
npm run dev          # http://localhost:5173, talks to the live mainnet contract
```

**Contract dev (Foundry):**

```sh
cd contracts
forge test           # 17 tests: splitting, netting, settlement, naming, auth, dust, caps
forge build
```

**Live end-to-end check** (creates a real tab on mainnet with two wallets,
logs expenses, settles, prints the resulting state — spends a little real MON):

```sh
DEPLOYER_KEY=0x<funded key> node scripts/smoke.mjs
```

## How it's built

| Layer     | Stack                                                            |
| --------- | ---------------------------------------------------------------- |
| Contract  | Solidity 0.8.28, Foundry, zero dependencies, ~400 lines           |
| Auth      | Privy — email / Google / wallet login, embedded wallets on Monad  |
| Frontend  | Vite + React + TypeScript, wagmi v2 / viem, hand-rolled CSS       |
| Chain     | Monad Mainnet (chain id 143) — 400ms blocks make every UI action feel instant |

### Contract design notes

- `debt[groupId][debtor][creditor]` with **automatic pairwise netting** —
  opposing debts cancel on write, so the "who owes who" list stays minimal.
- **Member names live onchain** (`memberName[groupId][member]`, ≤ 32 bytes):
  set when adding a mate, editable by any group member (tabs are
  trust-scoped — the people who share your fridge can fix your typo).
- `settle()` forwards `msg.value` to the creditor in the same tx
  (checks-effects-interactions + reentrancy guard). The contract balance is
  always zero; there is nothing to drain.
- Integer-division dust on splits (< n wei) is absorbed by the payer —
  at 18 decimals that's nothing.
- View functions are designed so a frontend needs **no indexer**:
  `groupsOf(address)`, `getAllDebts`, `netBalance`, `getGroup` (returns
  labels too), and ranged `getExpenses`/`getSettlements` readers.

### Repo layout

```
contracts/   Foundry project — src/TabMates.sol, test/TabMates.t.sol
web/         Vite React app (Privy + wagmi/viem)
scripts/     smoke.mjs — live e2e against the deployed contract
```

## Security model

Tabs are trust-scoped: members are people who already share a fridge or a
hotel room. Any member can add expenses/members and edit labels within their
tab; the contract enforces membership, split validity, settlement caps (can't
overpay a debt), and holds no funds. It is not designed for adversarial
strangers — it replaces the notes app, not the courts.

> Earlier deployments live on Monad Testnet: v1 (pre-rename, no member names) at
> [`0x698EBb78528e2a55B14ccf3c33171CcBF8f6392f`](https://testnet.monadvision.com/address/0x698EBb78528e2a55B14ccf3c33171CcBF8f6392f),
> v2 at [`0x6B7DF3C263E495c319b3841c658A23E5E361d110`](https://testnet.monadvision.com/address/0x6B7DF3C263E495c319b3841c658A23E5E361d110).
> v3 (mainnet) adds an expense cap (`MAX_AMOUNT`) and a hardened `_addDebt` after a pre-mainnet security review.

## License

MIT
