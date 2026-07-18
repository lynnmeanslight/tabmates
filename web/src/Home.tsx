import { useMemo, useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { isAddress } from "./lib";
import { TAB_ADDRESS, tabAbi } from "./contract";
import { fmtMon } from "./lib";
import { useTx } from "./useTx";

export default function Home({ onOpen }: { onOpen: (id: bigint) => void }) {
  const { address } = useAccount();

  const { data: myGroupIds } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "groupsOf",
    args: [address!],
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const ids = useMemo(() => [...(myGroupIds ?? [])].reverse(), [myGroupIds]);

  const { data: groupData } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { address: TAB_ADDRESS, abi: tabAbi, functionName: "getGroup", args: [id] } as const,
      {
        address: TAB_ADDRESS,
        abi: tabAbi,
        functionName: "netBalance",
        args: [id, address!],
      } as const,
    ]),
    query: { enabled: ids.length > 0 && !!address, refetchInterval: 5000 },
  });

  return (
    <div>
      <CreateTab />

      <div className="section-title">your tabs</div>

      {ids.length === 0 ? (
        <p className="empty">
          No tabs yet. Start one above — add your roommates, your trip group,
          the office lunch crew.
        </p>
      ) : (
        <div className="tab-grid">
          {ids.map((id, i) => {
            const group = groupData?.[i * 2]?.result as
              | readonly [string, string, bigint, readonly string[], readonly string[]]
              | undefined;
            const net = groupData?.[i * 2 + 1]?.result as bigint | undefined;
            return (
              <div key={id.toString()} className="tab-card" onClick={() => onOpen(id)}>
                <h3>{group ? group[0] : `Tab #${id}`}</h3>
                <div className="sub">
                  {group ? `${group[3].length} member${group[3].length === 1 ? "" : "s"}` : "…"}{" "}
                  · #{id.toString()}
                </div>
                {net !== undefined && (
                  <div className="balance-line">
                    {net === 0n ? (
                      <span className="zero">all square</span>
                    ) : net > 0n ? (
                      <span className="pos">
                        you're owed <strong>{fmtMon(net)} MON</strong>
                      </span>
                    ) : (
                      <span className="neg">
                        you owe <strong>{fmtMon(net)} MON</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateTab() {
  const [name, setName] = useState("");
  const [yourName, setYourName] = useState("");
  const [rows, setRows] = useState<{ addr: string; label: string }[]>([
    { addr: "", label: "" },
  ]);
  const [err, setErr] = useState("");
  const { send, isPending } = useTx();

  function setRow(i: number, patch: Partial<{ addr: string; label: string }>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function create() {
    setErr("");
    if (!name.trim()) return setErr("Give your tab a name.");
    const filled = rows.filter((r) => r.addr.trim() !== "" || r.label.trim() !== "");
    const bad = filled.find((r) => !isAddress(r.addr));
    if (bad) return setErr(`Not a wallet address: ${(bad.addr || "(empty)").slice(0, 24)}`);
    if (filled.some((r) => r.label.trim().length > 32))
      return setErr("Names must be 32 characters or fewer.");

    const ok = await send({
      functionName: "createGroup",
      args: [
        name.trim(),
        yourName.trim(),
        filled.map((r) => r.addr.trim()),
        filled.map((r) => r.label.trim()),
      ],
      pendingText: `Opening "${name.trim()}"`,
      doneText: `Tab "${name.trim()}" is live onchain`,
    });
    if (ok) {
      setName("");
      setYourName("");
      setRows([{ addr: "", label: "" }]);
    }
  }

  return (
    <div className="receipt">
      <div className="receipt-head">
        <h3>Open a new tab</h3>
        <span className="meta">costs a fraction of a cent</span>
      </div>
      <div className="form-grid">
        <div className="row-2">
          <div>
            <label>Tab name</label>
            <input
              placeholder="Flat 4B · Lisbon trip · Lunch crew"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label>Your name</label>
            <input
              placeholder="Lynn"
              value={yourName}
              maxLength={32}
              onChange={(e) => setYourName(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label>Mates (you're added automatically)</label>
          <div className="form-grid" style={{ gap: 8 }}>
            {rows.map((r, i) => (
              <div className="mate-row" key={i}>
                <input
                  placeholder="0x… wallet address"
                  value={r.addr}
                  onChange={(e) => setRow(i, { addr: e.target.value })}
                />
                <input
                  placeholder="Name (e.g. Maya)"
                  maxLength={32}
                  value={r.label}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                />
                <button
                  className="ghost"
                  title="remove"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  disabled={rows.length === 1}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            className="ghost"
            style={{ marginTop: 8 }}
            onClick={() => setRows((rs) => [...rs, { addr: "", label: "" }])}
          >
            + another mate
          </button>
        </div>
        {err && <div className="error-text">{err}</div>}
        <div>
          <button className="primary" onClick={create} disabled={isPending}>
            {isPending ? "Opening…" : "Open tab"}
          </button>
        </div>
      </div>
    </div>
  );
}
