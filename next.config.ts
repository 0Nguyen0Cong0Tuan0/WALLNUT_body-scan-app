import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",       // enables minimal Docker image via multi-stage build
  serverExternalPackages: [], // add native deps here if needed
  // Configure Turbopack to exclude .data directory from file watching
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".css", ".json"],
  },
  // Also configure webpack for production builds
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/.data/**", "**/.git/**", "**/node_modules/**"],
    };
    return config;
  },
};

export default nextConfig;
