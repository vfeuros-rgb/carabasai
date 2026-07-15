import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "10.100.9.104",
    "10.100.9.104:3000",
  ],
};

export default nextConfig;