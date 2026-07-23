import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: the dev server is reached over Tailscale (e.g. 100.x) from a
  // browser on another host, so allow those origins to load /_next dev assets
  // (HMR + client chunks). No effect on production builds.
  allowedDevOrigins: ["100.103.33.54"],
};

export default nextConfig;
