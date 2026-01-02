import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  basePath: isProd && isGitHubPages ? "/webllm-svg" : "",
  output: "export",
};

export default nextConfig;
