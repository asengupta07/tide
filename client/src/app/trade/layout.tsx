import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Trade Tide",
  description: "Discover Tide execution, compare every funded LP, and trade from a compact live market terminal.",
};

export default function TradeLayout({ children }: { children: ReactNode }) {
  return children;
}
