import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/hoot",
  images: { unoptimized: true },
};

export default nextConfig;
