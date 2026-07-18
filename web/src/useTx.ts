import { useWriteContract, usePublicClient } from "wagmi";
import { useToast } from "./App";
import { TAB_ADDRESS, tabAbi } from "./contract";

type WriteArgs = {
  functionName: "createGroup" | "addMember" | "addExpense" | "settle";
  args: readonly unknown[];
  value?: bigint;
  pendingText: string;
  doneText: string;
};

/** Wraps a contract write with toast lifecycle + receipt wait. */
export function useTx() {
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const setToast = useToast();

  async function send({ functionName, args, value, pendingText, doneText }: WriteArgs) {
    try {
      setToast({ kind: "pending", text: `${pendingText} — confirm in wallet…` });
      const hash = await writeContractAsync({
        address: TAB_ADDRESS,
        abi: tabAbi,
        functionName,
        args,
        ...(value !== undefined ? { value } : {}),
      } as never);
      setToast({ kind: "pending", text: `${pendingText} — waiting for Monad…` });
      await publicClient!.waitForTransactionReceipt({ hash });
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
