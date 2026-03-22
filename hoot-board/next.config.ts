import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // basePath: "/hoot", // uncomment for GitHub Pages
  images: { unoptimized: true },
};

export default nextConfig;
