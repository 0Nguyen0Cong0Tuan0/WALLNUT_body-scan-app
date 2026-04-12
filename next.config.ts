import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",       // enables minimal Docker image via multi-stage build
  serverExternalPackages: [], // add native deps here if needed
};

export default nextConfig;
