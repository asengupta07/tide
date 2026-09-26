import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Trade Tide",
  description: "Compare live Tide strategy quotes and trade when the partially-active curve offers better execution.",
};

export default function TradeLayout({ children }: { children: ReactNode }) {
  return children;
}
