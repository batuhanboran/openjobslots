import type { NextConfig } from "next";

// Where the existing OpenJobSlots Node backend lives.
// Local/dev: the public site. Production (when this app is the site root):
// set OJS_API_BASE to the INTERNAL backend (e.g. http://127.0.0.1:8081) to
// avoid proxying to itself.
const API_BASE = process.env.OJS_API_BASE || "https://openjobslots.com";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    // Next.js owns /, /ara, /api/*, /_next/*, and its static files.
    // Every other path — backend API, mobile endpoints and SEO
    // (/postings, /health, /sync/status, /sitemap.xml, /robots.txt,
    // /privacy, …) — is transparently proxied to the Node backend so this
    // frontend can take over the site root without breaking any of them.
    return {
      fallback: [{ source: "/:path*", destination: `${API_BASE}/:path*` }],
    };
  },
};

export default nextConfig;
