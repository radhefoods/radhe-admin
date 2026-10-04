import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Links are checked against the routes that exist (see src/lib/routes.ts).
  typedRoutes: true,
  // Product and category pictures come from the API as ready-made WebP
  // variants under immutable addresses. They are shown with a plain <img>,
  // so the Next.js image optimizer is not involved.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The panel is a private tool: no search engine may list it.
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          // Ignored on plain http (local development).
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
