import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The engine lives in app/lib/v2 and is pure TS; nothing special needed.
  reactStrictMode: true,
  // The bot's Chromium ships as brotli packs that a bundler cannot follow; both stay external,
  // and the packs are traced by hand into every route that drives the browser: the bot routes,
  // and the intake, which runs live writes inline (process.ts runWhenFree -> runOp).
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/bot/**": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/n8n-inbound": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
