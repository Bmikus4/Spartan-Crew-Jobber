import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine lives in app/lib/engine and is pure TS; nothing special needed.
  reactStrictMode: true,
  // The bot's Chromium ships as brotli packs that a bundler cannot follow; both stay external,
  // and the packs are traced into every bot route by hand.
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: { "/api/bot/**": ["./node_modules/@sparticuz/chromium/bin/**"] },
};

export default nextConfig;
