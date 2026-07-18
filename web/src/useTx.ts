import { useWriteContract, usePublicClient, useAccount } from "wagmi";
import { useToast } from "./App";
import { TAB_ADDRESS, tabAbi } from "./contract";

type WriteArgs = {
  functionName: "createGroup" | "addMember" | "setMemberName" | "addExpense" | "settle";
  args: readonly unknown[];
  value?: bigint;
  pendingText: string;
  doneText: string;
};

/** Wraps a contract write with toast lifecycle + receipt wait. */
export function useTx() {
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const setToast = useToast();

  async function send({ functionName, args, value, pendingText, doneText }: WriteArgs) {
    try {
      setToast({ kind: "pending", text: `${pendingText} — confirm in wallet…` });
      // Monad mainnet's eth_estimateGas runs tight — executing with the raw
      // estimate can out-of-gas. Pad it 1.5× (unused headroom is cheap).
      const estimated = await publicClient!.estimateContractGas({
        address: TAB_ADDRESS,
        abi: tabAbi,
        functionName,
        args,
        account: address,
        ...(value !== undefined ? { value } : {}),
      } as never);
      const hash = await writeContractAsync({
        address: TAB_ADDRESS,
        abi: tabAbi,
        functionName,
        args,
        gas: (estimated * 15n) / 10n,
        ...(value !== undefined ? { value } : {}),
      } as never);
      setToast({ kind: "pending", text: `${pendingText} — waiting for Monad…` });
      await publicClient!.waitForTransactionReceipt({ hash });
      // Monad reserve-balance rule: senders holding < 10 MON only get the
      // "emptying" exception when their previous tx is ≥ k=3 blocks (1.2s)
      // old — otherwise a value-spending tx is included-but-REVERTED and
      // still charged gas. Space txs out so rapid clicks can't hit it.
      await new Promise((r) => setTimeout(r, 1500));
      setToast({ kind: "done", text: doneText, hash });
      return true;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.split("\n")[0].slice(0, 120)
          : "transaction failed";
      setToast({ kind: "error", text: msg });
      return false;
    }
  }

  return { send, isPending };
}
