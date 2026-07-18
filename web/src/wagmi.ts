import { http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { defineChain } from "viem";

export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://monadvision.com" },
  },
});

export const config = createConfig({
  chains: [monadMainnet],
  transports: {
    [monadMainnet.id]: http(),
  },
});
