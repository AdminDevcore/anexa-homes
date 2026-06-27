import type { Metadata } from "next";
import { Star } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { Section, SectionHeading } from "@/components/marketing/ui";
import { TestimonialsCarousel, type CarouselReview } from "@/components/marketing/testimonials-carousel";
import { ReviewForm } from "@/components/marketing/review-form";
import { getPublicReviews, getPublicReviewStats } from "@/server/modules/reviews/public";

export const metadata: Metadata = {
  title: "Customer Reviews",
  description:
    "Read reviews from Anexa Homes customers across North Texas — roofing, solar, HVAC, water filtration, windows, gutters, and storm restoration — and leave your own.",
  alternates: { canonical: "/reviews" },
};

export default async function ReviewsPage() {
  const [reviews, stats] = await Promise.all([getPublicReviews(24), getPublicReviewStats()]);

  return (
    <>
      <PageHero
        eyebrow="Customer Reviews"
        title={
          <>
            Hear it from <span className="gold-gradient-text">our homeowners</span>.
          </>
        }
        description="We earn trust one home at a time. Read real reviews from North Texas families — then share your own experience with Anexa Homes."
        image="/img/home-dusk.jpg"
        primaryCta={{ label: "Leave a Review", href: "#leave-a-review" }}
        secondaryCta={{ label: "Explore Services", href: "/#services" }}
      />

      {stats && stats.count > 0 && (
        <Section className="py-12 sm:py-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={
                    i < Math.round(stats.average)
                      ? "size-6 fill-[var(--metal-bright)] text-metal"
                      : "size-6 text-muted-foreground/30"
                  }
                />
              ))}
            </div>
            <p className="font-display text-2xl font-semibold">
              {stats.average.toFixed(1)} average · {stats.count} review{stats.count === 1 ? "" : "s"}
            </p>
          </div>
        </Section>
      )}

      {reviews.length > 0 && (
        <Section className={stats ? "pt-0 sm:pt-0" : undefined}>
          <SectionHeading align="center" eyebrow="What People Say" title="Reviews from real Anexa Homes customers." />
          <div className="mt-12">
            <TestimonialsCarousel items={reviews as CarouselReview[]} />
          </div>
        </Section>
      )}

      <Section id="leave-a-review" className="bg-muted/40">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Leave a Review"
            title="Share your experience."
            description="Worked with us recently? We'd love to hear about it. Your review is checked by our team before it appears on the site."
          />
          <ReviewForm />
        </div>
      </Section>
    </>
  );
}
