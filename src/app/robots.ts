import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep the app, auth, and signing surfaces out of the index.
      disallow: ["/portal/", "/api/", "/login", "/forgot-password", "/reset-password", "/mfa", "/sign/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
