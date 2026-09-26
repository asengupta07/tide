"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { useState, type ReactNode } from "react";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// Browser extension first: the injected connector talks to the extension directly and never falls back to
// the MetaMask SDK deep-link flow (which hangs on "Opening MetaMask" when no extension is present).
// Mobile wallets go through WalletConnect and need a real project id; without one they are left out so the
// relay is never contacted (no 403 from Reown, no WalletConnect modal in the bundle).
const connectors = connectorsForWallets(
  projectId
    ? [
        { groupName: "Browser", wallets: [injectedWallet, metaMaskWallet] },
        { groupName: "Mobile", wallets: [rainbowWallet, coinbaseWallet, walletConnectWallet] },
      ]
    : [{ groupName: "Browser", wallets: [injectedWallet, coinbaseWallet] }],
  { appName: "Tide", projectId: projectId || "unused" },
);

const config = createConfig({
  connectors,
  chains: [sepolia],
  transports: { [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com") },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider
          theme={darkTheme({ accentColor: "#58c9b6", accentColorForeground: "#062521", borderRadius: "large", fontStack: "system", overlayBlur: "small" })}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
