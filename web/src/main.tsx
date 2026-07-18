import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config, monadMainnet } from "./wagmi";
import App from "./App";
import "./styles.css";

const queryClient = new QueryClient();

// Privy App ID is a public client-side identifier (like a Firebase apiKey) —
// safe to ship in the bundle. The app *secret* never belongs in the frontend.
const PRIVY_APP_ID = "cmrqphb9w00tl0cjo9cqxvnbq";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "light",
          accentColor: "#c2492f",
          landingHeader: "TabMates",
          loginMessage: "Split the bill. Actually settle it.",
        },
        loginMethods: ["email", "google", "wallet"],
        defaultChain: monadMainnet,
        supportedChains: [monadMainnet],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <App />
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  </StrictMode>
);
