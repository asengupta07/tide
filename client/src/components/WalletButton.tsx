"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet, CaretDown } from "@phosphor-icons/react";

/** RainbowKit connect button rendered in Tide's own pill so it matches the nav. */
export function WalletButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "pill pill-ghost pill-sm" : "pill pill-ghost";
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        return (
          <div aria-hidden={!ready} style={ready ? undefined : { opacity: 0, pointerEvents: "none" }}>
            {!connected ? (
              <button onClick={openConnectModal} className={cls} type="button">
                <span>Connect wallet</span>
                <span className="ico"><Wallet size={13} /></span>
              </button>
            ) : chain.unsupported ? (
              <button onClick={openChainModal} className={`${cls} !border-bad/50 !text-bad`} type="button">
                <span>Switch network</span>
                <span className="ico"><CaretDown size={13} /></span>
              </button>
            ) : (
              <button onClick={openAccountModal} className={cls} type="button">
                <span className="num">{account.ensName ?? account.displayName}</span>
                <span className="ico"><CaretDown size={13} /></span>
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
