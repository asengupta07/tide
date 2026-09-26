import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Trade Tide",
  description: "Compare every available liquidity source and trade from a compact live market terminal.",
};

export default function TradeLayout({ children }: { children: ReactNode }) {
  return children;
}
