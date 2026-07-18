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
              | readonly [string, string, bigint, readonly string[]]
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
  const [membersRaw, setMembersRaw] = useState("");
  const [err, setErr] = useState("");
  const { send, isPending } = useTx();

  async function create() {
    setErr("");
    const members = membersRaw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name.trim()) return setErr("Give your tab a name.");
    const bad = members.find((m) => !isAddress(m));
    if (bad) return setErr(`Not an address: ${bad.slice(0, 24)}…`);

    const ok = await send({
      functionName: "createGroup",
      args: [name.trim(), members],
      pendingText: `Opening "${name.trim()}"`,
      doneText: `Tab "${name.trim()}" is live onchain`,
    });
    if (ok) {
      setName("");
      setMembersRaw("");
    }
  }

  return (
    <div className="receipt">
      <div className="receipt-head">
        <h3>Open a new tab</h3>
        <span className="meta">costs a fraction of a cent</span>
      </div>
      <div className="form-grid">
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
          <label>Members (wallet addresses, one per line — you're added automatically)</label>
          <textarea
            rows={2}
            placeholder={"0xabc…\n0xdef…"}
            value={membersRaw}
            onChange={(e) => setMembersRaw(e.target.value)}
          />
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
