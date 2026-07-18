# Tab — the roommate ledger on Monad

**Split the bill. Actually settle it.**

Live app: **https://lynnmeanslight.github.io/tab-monad/** · Contract: [`0x698EBb78528e2a55B14ccf3c33171CcBF8f6392f`](https://testnet.monadvision.com/address/0x698EBb78528e2a55B14ccf3c33171CcBF8f6392f) (Monad Testnet, [verified](https://testnet.monadvision.com/address/0x698EBb78528e2a55B14ccf3c33171CcBF8f6392f?tab=Contract))

## The problem (a personal one)

I live with two roommates. We track shared groceries, internet, and 3am pizza
in a notes app, and the "ledger" always ends the same way: everyone knows who
owes what, and **nobody ever actually pays**. Splitwise-style apps stop at the
IOU — settling means opening a bank app, typing an amount, forgetting, being
nagged, repeat. The ledger and the money live in different worlds.

## The solution

Tab puts the ledger and the money in the same place. It's a shared-expenses
tracker where the **settle button is a real value transfer**:

- **Open a tab** with any group of wallets (roommates, a trip, the lunch crew).
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

You need a browser wallet (MetaMask/Rabby) and free testnet MON from the
[faucet](https://faucet.monad.xyz).

**Just use it:** open the [live app](https://lynnmeanslight.github.io/tab-monad/),
connect, approve the network switch to Monad Testnet, open a tab, log an
expense. To see the full loop, add a second wallet as a member and settle from it.

**Or run locally:**

```sh
cd web
npm install
npm run dev          # http://localhost:5173, talks to the live testnet contract
```

**Contract dev (Foundry):**

```sh
cd contracts
forge test           # 13 tests: splitting, netting, settlement, auth, dust
forge build
```

**Live end-to-end check** (creates a real tab on testnet with two wallets,
logs expenses, settles, prints the resulting state):

```sh
DEPLOYER_KEY=0x<funded testnet key> node scripts/smoke.mjs
```

## How it's built

| Layer     | Stack                                                            |
| --------- | ---------------------------------------------------------------- |
| Contract  | Solidity 0.8.28, Foundry, zero dependencies, ~330 lines           |
| Frontend  | Vite + React + TypeScript, wagmi v2 / viem, hand-rolled CSS       |
| Chain     | Monad Testnet (chain id 10143) — 400ms blocks make every UI action feel instant |

### Contract design notes

- `debt[groupId][debtor][creditor]` with **automatic pairwise netting** —
  opposing debts cancel on write, so the "who owes who" list stays minimal.
- `settle()` forwards `msg.value` to the creditor in the same tx
  (checks-effects-interactions + reentrancy guard). The contract balance is
  always zero; there is nothing to drain.
- Integer-division dust on splits (< n wei) is absorbed by the payer —
  at 18 decimals that's nothing.
- View functions are designed so a frontend needs **no indexer**:
  `groupsOf(address)`, `getAllDebts`, `netBalance`, and ranged
  `getExpenses`/`getSettlements` readers.

### Repo layout

```
contracts/   Foundry project — src/Tab.sol, test/Tab.t.sol
web/         Vite React app (wagmi/viem)
scripts/     smoke.mjs — live e2e against the deployed contract
```

## Security model

Tabs are trust-scoped: members are people who already share a fridge or a
hotel room. Any member can add expenses/members within their tab; the contract
enforces membership, split validity, settlement caps (can't overpay a debt),
and holds no funds. It is not designed for adversarial strangers — it replaces
the notes app, not the courts.

## License

MIT
