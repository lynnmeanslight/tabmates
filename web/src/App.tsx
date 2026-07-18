import { createContext, useCallback, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { monadTestnet } from "./wagmi";
import { EXPLORER, TAB_ADDRESS, tabAbi } from "./contract";
import { shortAddr, addrHue } from "./lib";
import Home from "./Home";
import TabView from "./TabView";

// ---------------------------------------------------------------- toasts

type Toast =
  | { kind: "pending"; text: string }
  | { kind: "done"; text: string; hash?: string }
  | { kind: "error"; text: string }
  | null;

const ToastCtx = createContext<(t: Toast) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ app

export default function App() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const queryClient = useQueryClient();

  const [toast, setToastState] = useState<Toast>(null);
  const [openTab, setOpenTab] = useState<bigint | null>(null);

  const setToast = useCallback(
    (t: Toast) => {
      setToastState(t);
      if (t?.kind === "done") {
        queryClient.invalidateQueries();
        setTimeout(() => setToastState((cur) => (cur === t ? null : cur)), 6000);
      }
      if (t?.kind === "error") {
        setTimeout(() => setToastState((cur) => (cur === t ? null : cur)), 6000);
      }
    },
    [queryClient]
  );

  const connected = ready && authenticated && !!address;
  const wrongChain = connected && chainId !== monadTestnet.id;
  const identity =
    user?.google?.name || user?.email?.address || (address ? shortAddr(address) : "");

  return (
    <ToastCtx.Provider value={setToast}>
      <header className="topbar">
        <div className="brand" onClick={() => setOpenTab(null)}>
          <h1>TabMates</h1>
          <span className="tagline">the roommate ledger on Monad</span>
        </div>

        {connected && address ? (
          <div className="account-chip">
            <span className="dot" style={{ background: `hsl(${addrHue(address)} 55% 62%)` }} />
            <span title={address}>{identity}</span>
            {wrongChain ? (
              <span
                className="net-pill bad"
                onClick={() => switchChain({ chainId: monadTestnet.id })}
                title="Click to switch to Monad Testnet"
              >
                wrong network
              </span>
            ) : (
              <span className="net-pill ok">monad testnet</span>
            )}
            <button className="ghost" onClick={() => logout()}>
              ×
            </button>
          </div>
        ) : null}
      </header>

      {!connected ? (
        <Hero connecting={!ready} canConnect={ready} onConnect={login} />
      ) : openTab === null ? (
        <Home onOpen={setOpenTab} />
      ) : (
        <TabView groupId={openTab} onBack={() => setOpenTab(null)} />
      )}

      {toast && (
        <div className="toast">
          {toast.kind === "pending" && <span className="spinner" />}
          <span>{toast.text}</span>
          {toast.kind === "done" && toast.hash && (
            <a href={`${EXPLORER}/tx/${toast.hash}`} target="_blank" rel="noreferrer">
              view tx ↗
            </a>
          )}
        </div>
      )}

      <p className="footer-note">
        no custody · settlements go wallet-to-wallet ·{" "}
        <a href="https://github.com/lynnmeanslight/tabmates" target="_blank" rel="noreferrer">
          source
        </a>
      </p>
    </ToastCtx.Provider>
  );
}

function Hero({
  connecting,
  canConnect,
  onConnect,
}: {
  connecting: boolean;
  canConnect: boolean;
  onConnect: () => void;
}) {
  const { data: groupCount } = useReadContract({
    address: TAB_ADDRESS,
    abi: tabAbi,
    functionName: "groupCount",
    query: { refetchInterval: 8000 },
  });

  return (
    <div className="hero">
      <div className="stamp">TM</div>
      <h2>Split the bill. Actually settle it.</h2>
      <p>
        Every shared-expense app ends the same way: the ledger says "you owe
        Maya 3&nbsp;MON" and then… nothing happens. TabMates keeps your group's
        running total onchain — real names, not hex — and lets you clear your
        debt with a real transfer, in one click, for less than a cent. Sign in
        with email, Google, or any wallet.
      </p>
      <button className="accent" disabled={!canConnect || connecting} onClick={onConnect}>
        {connecting ? "Loading…" : "Sign in"}
      </button>
      <p className="fine">
        {groupCount !== undefined && (
          <>
            {groupCount.toString()} tab{groupCount === 1n ? "" : "s"} open onchain ·{" "}
          </>
        )}
        Runs on Monad Testnet · you'll need{" "}
        <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">
          faucet MON
        </a>{" "}
        ·{" "}
        <a href={`${EXPLORER}/address/${TAB_ADDRESS}`} target="_blank" rel="noreferrer">
          view the contract
        </a>
      </p>
    </div>
  );
}
