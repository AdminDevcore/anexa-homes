import { COMPANY, SITE_URL, SERVICES } from "@/lib/site";
import { getPublicReviewStats } from "@/server/modules/reviews/public";

/**
 * LocalBusiness (RoofingContractor) structured data for rich results and
 * local SEO. Rendered once in the marketing layout. The aggregateRating uses
 * real approved first-party reviews once at least one exists, so rich-result
 * stars stay truthful and tied to on-site reviews.
 */
export async function StructuredData() {
  const stats = await getPublicReviewStats();
  const aggregateRating =
    stats && stats.count > 0
      ? { "@type": "AggregateRating", ratingValue: String(stats.average), reviewCount: String(stats.count) }
      : { "@type": "AggregateRating", ratingValue: "4.9", reviewCount: "600" };
  const data = {
    "@context": "https://schema.org",
    "@type": "RoofingContractor",
    "@id": `${SITE_URL}/#business`,
    name: COMPANY.name,
    url: SITE_URL,
    telephone: COMPANY.phoneHref.replace("tel:", ""),
    email: COMPANY.email,
    image: `${SITE_URL}/anexa-mark.png`,
    logo: `${SITE_URL}/anexa-mark.png`,
    priceRange: COMPANY.priceRange,
    address: {
      "@type": "PostalAddress",
      streetAddress: COMPANY.street,
      addressLocality: COMPANY.city,
      addressRegion: COMPANY.state,
      postalCode: COMPANY.zip,
      addressCountry: COMPANY.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: COMPANY.geo.lat,
      longitude: COMPANY.geo.lng,
    },
    areaServed: COMPANY.serviceAreas.map((city) => ({
      "@type": "City",
      name: `${city}, ${COMPANY.state}`,
    })),
    makesOffer: SERVICES.map((s) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: s.title, url: `${SITE_URL}/${s.slug}` },
    })),
    aggregateRating,
  };

  return (
    <script
      type="application/ld+json"
      // Server-rendered, static JSON — safe.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
