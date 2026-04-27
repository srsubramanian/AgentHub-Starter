import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the trace root to this project so the standalone build emits
  // a flat layout (server.js at the root of .next/standalone). Without
  // this, Next.js can pick a parent dir if it finds a higher lockfile,
  // which then breaks the Docker COPY in the runner stage.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
