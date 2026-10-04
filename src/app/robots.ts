import type { MetadataRoute } from "next";

// A private tool: nothing of it belongs in a search engine.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
