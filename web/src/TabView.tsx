import { useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { parseEther } from "viem";
import { TAB_ADDRESS, tabAbi } from "./contract";
import { addrHue, displayName, fmtMon, isAddress, shortAddr, timeAgo } from "./lib";
import { useTx } from "./useTx";

const REFETCH = { refetchInterval: 4000 } as const;

type Props = { groupId: bigint; onBack: () => void };

export default function TabView({ groupId, onBack }: Props) {
  const { address } = useAccount();

  const { data: group } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "getGroup",
    args: [groupId],
    query: REFETCH,
  });

  const { data: debts } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "getAllDebts",
    args: [groupId],
    query: REFETCH,
  });

  const { data: net } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "netBalance",
    args: [groupId, address!],
    query: { enabled: !!address, ...REFETCH },
  });

  const { data: expenses } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "getExpenses",
    args: [groupId, 0n, 500n],
    query: REFETCH,
  });

  const { data: settlements } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "getSettlements",
    args: [groupId, 0n, 500n],
    query: REFETCH,
  });

  const members = useMemo(() => (group ? [...group[3]] : []), [group]);

  /** lowercase address → onchain label ("" if unset) */
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    if (group) group[3].forEach((a, i) => (m[a.toLowerCase()] = group[4][i]));
    return m;
  }, [group]);

  const nameOf = (a: string) => displayName(names[a.toLowerCase()], a);

  const feed = useMemo(() => {
    const items: {
      ts: number;
      kind: "expense" | "paid";
      memo: string;
      detail: string;
      amount: bigint;
    }[] = [];
    for (const e of expenses ?? []) {
      items.push({
        ts: Number(e.timestamp),
        kind: "expense",
        memo: e.memo,
        detail: `${nameOf(e.payer)} paid · split ${e.participants.length} way${
          e.participants.length === 1 ? "" : "s"
        }`,
        amount: e.amount,
      });
    }
    for (const s of settlements ?? []) {
      items.push({
        ts: Number(s.timestamp),
        kind: "paid",
        memo: "Settled up",
        detail: `${nameOf(s.from)} → ${nameOf(s.to)}`,
        amount: s.amount,
      });
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, settlements, names]);

  if (!group) return <p className="empty">Loading tab #{groupId.toString()}…</p>;

  return (
    <div className="stack">
      <button className="back-link" onClick={onBack}>
        ← all tabs
      </button>

      <div className="receipt">
        <div className="receipt-head">
          <h3>{group[0]}</h3>
          <span className="meta">tab #{groupId.toString()}</span>
        </div>

        {net !== undefined && (
          <div className="balance-line" style={{ marginBottom: 14 }}>
            {net === 0n ? (
              <span className="zero">you're all square in this tab</span>
            ) : net > 0n ? (
              <span className="pos">
                overall, you're owed <strong>{fmtMon(net)} MON</strong>
              </span>
            ) : (
              <span className="neg">
                overall, you owe <strong>{fmtMon(net)} MON</strong>
              </span>
            )}
          </div>
        )}

        <Members groupId={groupId} members={members} names={names} you={address} />
      </div>

      <Debts groupId={groupId} debts={debts} you={address} nameOf={nameOf} />

      <AddExpense groupId={groupId} members={members} you={address} nameOf={nameOf} />

      <div className="receipt">
        <div className="receipt-head">
          <h3>Activity</h3>
          <span className="meta">straight from the chain</span>
        </div>
        {feed.length === 0 ? (
          <p className="empty">Nothing yet. Add the first expense below the fold ↑</p>
        ) : (
          feed.map((f, i) => (
            <div className="feed-item" key={i}>
              <span className="when">{timeAgo(f.ts)}</span>
              <span className="what">
                <span className={`feed-tag ${f.kind}`}>{f.kind === "paid" ? "paid" : "expense"}</span>
                <span className="memo">{f.memo}</span>
                <div className="detail">{f.detail}</div>
              </span>
              <span className="feed-amount">{fmtMon(f.amount)} MON</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- members

function Members({
  groupId,
  members,
  names,
  you,
}: {
  groupId: bigint;
  members: string[];
  names: Record<string, string>;
  you?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState("");
  const { send, isPending } = useTx();

  async function add() {
    setErr("");
    if (!isAddress(addr)) return setErr("That's not a wallet address.");
    if (label.trim().length > 32) return setErr("Name must be 32 characters or fewer.");
    const ok = await send({
      functionName: "addMember",
      args: [groupId, addr.trim(), label.trim()],
      pendingText: "Adding mate",
      doneText: `${label.trim() || shortAddr(addr)} joined the tab`,
    });
    if (ok) {
      setAddr("");
      setLabel("");
      setAdding(false);
    }
  }

  async function rename() {
    setErr("");
    if (newName.trim().length > 32) return setErr("Name must be 32 characters or fewer.");
    const ok = await send({
      functionName: "setMemberName",
      args: [groupId, you!, newName.trim()],
      pendingText: "Updating your name",
      doneText: newName.trim() ? `You're now "${newName.trim()}"` : "Name cleared",
    });
    if (ok) {
      setNewName("");
      setRenaming(false);
    }
  }

  return (
    <div>
      <label>Mates</label>
      <div className="member-row">
        {members.map((m) => {
          const isYou = you?.toLowerCase() === m.toLowerCase();
          const label_ = names[m.toLowerCase()];
          return (
            <span
              className="member-chip"
              key={m}
              title={isYou ? `${m} · click to rename` : `${m} · click to copy`}
              onClick={() => {
                if (isYou) {
                  setRenaming(true);
                  setNewName(label_ ?? "");
                } else {
                  navigator.clipboard?.writeText(m);
                }
              }}
            >
              <span className="dot" style={{ background: `hsl(${addrHue(m)} 55% 62%)` }} />
              {displayName(label_, m)}
              {label_ && <span className="mono-addr">{shortAddr(m)}</span>}
              {isYou && <span className="you-badge">you</span>}
            </span>
          );
        })}
        {!adding ? (
          <button className="ghost" onClick={() => setAdding(true)}>
            + add
          </button>
        ) : null}
      </div>

      {renaming && (
        <div className="mate-row" style={{ marginTop: 10 }}>
          <input
            placeholder="Your display name"
            maxLength={32}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="primary" onClick={rename} disabled={isPending}>
            save
          </button>
          <button className="ghost" onClick={() => setRenaming(false)}>
            cancel
          </button>
        </div>
      )}

      {adding && (
        <div className="mate-row" style={{ marginTop: 10 }}>
          <input
            placeholder="0x… wallet of your roommate"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
          />
          <input
            placeholder="Name (e.g. Maya)"
            maxLength={32}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className="primary" onClick={add} disabled={isPending}>
            add
          </button>
          <button className="ghost" onClick={() => setAdding(false)}>
            cancel
          </button>
        </div>
      )}
      {err && <div className="error-text" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

// --------------------------------------------------------------- debts

function Debts({
  groupId,
  debts,
  you,
  nameOf,
}: {
  groupId: bigint;
  debts?: readonly [readonly string[], readonly string[], readonly bigint[]];
  you?: string;
  nameOf: (a: string) => string;
}) {
  const [settling, setSettling] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");
  const { send, isPending } = useTx();

  const edges = useMemo(() => {
    if (!debts) return [];
    return debts[0].map((debtor, i) => ({
      debtor,
      creditor: debts[1][i],
      amount: debts[2][i],
    }));
  }, [debts]);

  async function settle(i: number) {
    setErr("");
    const edge = edges[i];
    let value: bigint;
    try {
      value = parseEther((amount || fmtMon(edge.amount, 18)) as `${number}`);
    } catch {
      return setErr("Enter a MON amount, like 0.5");
    }
    if (value <= 0n) return setErr("Amount must be positive.");
    if (value > edge.amount) return setErr("That's more than you owe.");

    const ok = await send({
      functionName: "settle",
      args: [groupId, edge.creditor],
      value,
      pendingText: `Sending ${fmtMon(value)} MON to ${nameOf(edge.creditor)}`,
      doneText: `Paid ${fmtMon(value)} MON to ${nameOf(edge.creditor)} — debt updated`,
    });
    if (ok) {
      setSettling(null);
      setAmount("");
    }
  }

  return (
    <div className="receipt">
      <div className="receipt-head">
        <h3>Who owes who</h3>
        <span className="meta">netted automatically</span>
      </div>

      {edges.length === 0 ? (
        <div className="settled-note">
          <span className="stamp-paid">Paid in full</span>
          <div style={{ marginTop: 8 }}>nobody owes anybody · nice</div>
        </div>
      ) : (
        edges.map((e, i) => {
          const yours = you?.toLowerCase() === e.debtor.toLowerCase();
          return (
            <div className="debt-row" key={`${e.debtor}-${e.creditor}`}>
              <span className="who">
                <span className="dot" style={{ background: `hsl(${addrHue(e.debtor)} 55% 62%)` }} />
                {yours ? "you" : nameOf(e.debtor)}
                <span className="arrow">owes →</span>
                <span
                  className="dot"
                  style={{ background: `hsl(${addrHue(e.creditor)} 55% 62%)` }}
                />
                {you?.toLowerCase() === e.creditor.toLowerCase() ? "you" : nameOf(e.creditor)}
              </span>

              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="amount">{fmtMon(e.amount)} MON</span>
                {yours &&
                  (settling === i ? (
                    <>
                      <input
                        style={{ width: 110 }}
                        placeholder={fmtMon(e.amount)}
                        value={amount}
                        onChange={(ev) => setAmount(ev.target.value)}
                      />
                      <button className="accent" disabled={isPending} onClick={() => settle(i)}>
                        pay
                      </button>
                      <button
                        className="ghost"
                        onClick={() => {
                          setSettling(null);
                          setErr("");
                        }}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <button
                      className="accent"
                      onClick={() => {
                        setSettling(i);
                        setAmount("");
                        setErr("");
                      }}
                    >
                      settle
                    </button>
                  ))}
              </span>
            </div>
          );
        })
      )}
      {err && <div className="error-text">{err}</div>}
      {edges.length > 0 && (
        <p className="hint" style={{ marginTop: 10 }}>
          settling sends MON wallet-to-wallet through the contract — partial payments welcome
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------- add expense

function AddExpense({
  groupId,
  members,
  you,
  nameOf,
}: {
  groupId: bigint;
  members: string[];
  you?: string;
  nameOf: (a: string) => string;
}) {
  const [memo, setMemo] = useState("");
  const [amount, setAmount] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const { send, isPending } = useTx();

  // default: everyone participates
  const participants = members.filter((m) => selected[m] !== false);

  async function add() {
    setErr("");
    if (!memo.trim()) return setErr("What was it for?");
    let value: bigint;
    try {
      value = parseEther(amount as `${number}`);
    } catch {
      return setErr("Enter a MON amount, like 1.5");
    }
    if (value <= 0n) return setErr("Amount must be positive.");
    if (participants.length === 0) return setErr("Pick at least one participant.");

    const ok = await send({
      functionName: "addExpense",
      args: [groupId, memo.trim(), value, participants],
      pendingText: `Logging "${memo.trim()}"`,
      doneText: `"${memo.trim()}" split ${participants.length} ways`,
    });
    if (ok) {
      setMemo("");
      setAmount("");
      setSelected({});
    }
  }

  return (
    <div className="receipt">
      <div className="receipt-head">
        <h3>Add an expense</h3>
        <span className="meta">you paid, they owe</span>
      </div>
      <div className="form-grid">
        <div className="row-2">
          <div>
            <label>What was it?</label>
            <input
              placeholder="Groceries, rent, 3am pizza…"
              maxLength={140}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
          <div>
            <label>Total (MON)</label>
            <input
              placeholder="2.5"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label>Split between ({participants.length})</label>
          <div className="check-row">
            {members.map((m) => {
              const on = selected[m] !== false;
              return (
                <span
                  key={m}
                  className={`check-chip ${on ? "on" : ""}`}
                  onClick={() => setSelected((s) => ({ ...s, [m]: !on }))}
                  title={m}
                >
                  <span className="dot" style={{ background: `hsl(${addrHue(m)} 55% 62%)` }} />
                  {you?.toLowerCase() === m.toLowerCase() ? "you" : nameOf(m)}
                </span>
              );
            })}
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            equal split · your own share is never a debt
          </p>
        </div>

        {err && <div className="error-text">{err}</div>}
        <div>
          <button className="primary" onClick={add} disabled={isPending}>
            {isPending ? "Logging…" : "Log expense"}
          </button>
        </div>
      </div>
    </div>
  );
}
