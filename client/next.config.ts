import type { NextConfig } from "next";
import { config } from "dotenv";
import path from "node:path";

// Secrets live in the repository root .env (shared with the Foundry scripts). Server-side only.
config({ path: path.join(process.cwd(), "..", ".env") });

const nextConfig: NextConfig = {
  serverExternalPackages: ["jose"],
};

export default nextConfig;
