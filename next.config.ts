import type { NextConfig } from "next";

// Directives that restrict framing and plugins only: scripts, styles and connections stay open
// because the wallet SDKs (Reown, TON Connect, wallet-selector popups) load and call many origins.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // Positions and History moved into Portfolio; old links and bookmarks keep working (the query,
  // e.g. ?view=demo, is passed through). Temporary, so browsers don't cache them for good.
  async redirects() {
    return [
      { source: "/positions", destination: "/portfolio", permanent: false },
      { source: "/history", destination: "/portfolio#activity", permanent: false },
    ];
  },
};

export default nextConfig;
