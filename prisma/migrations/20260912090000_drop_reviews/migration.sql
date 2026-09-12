-- Drop the first-party customer review system.
--
-- It was a public submission form on the marketing site feeding a moderation
-- queue in Settings: staff approved, featured, hid or soft-deleted a review,
-- and the approved ones filled a carousel on the homepage and a /reviews page,
-- plus the aggregateRating in the site's LocalBusiness structured data.
--
-- Nobody ever used it. `reviews` is empty in production, so the homepage
-- carousel had been showing the five hardcoded placeholder quotes this whole
-- time -- placeholder testimonials presented as real homeowners -- and the
-- rich-result stars were a hardcoded 4.9/600 backed by nothing on the page.
-- Both are gone with the feature. This drops storage, not data.
--
-- The table carries a FK to `users` (approvedById) and to `companies`; dropping
-- the table takes its own constraints with it, so no ALTER is needed first.
DROP TABLE IF EXISTS "reviews";
DROP TYPE IF EXISTS "ReviewStatus";
