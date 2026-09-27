import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded with native require on the server: PGlite ships WASM + data files that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Self-contained server for the Docker image (see Dockerfile / docs/DEPLOY.md).
  output: "standalone",
};

export default nextConfig;
