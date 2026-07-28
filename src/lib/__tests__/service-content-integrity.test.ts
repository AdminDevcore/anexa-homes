import { describe, it, expect } from "vitest";
import { SERVICES } from "@/lib/site";
import { serviceContent, serviceFor } from "@/lib/service-content";

const slugs = SERVICES.map((s) => s.slug);

describe("marketing service registry integrity", () => {
  it("every SERVICES entry has page content and vice versa", () => {
    for (const slug of slugs) {
      expect(() => serviceContent(slug), `content missing for ${slug}`).not.toThrow();
      expect(() => serviceFor(slug), `service missing for ${slug}`).not.toThrow();
    }
  });

  // A related-slug pointing at a retired service renders a card linking to a
  // page that no longer exists.
  it("every related cross-link points at a live service", () => {
    for (const slug of slugs) {
      for (const rel of serviceContent(slug).related) {
        expect(slugs, `${slug} → related "${rel}" is not a live service`).toContain(rel);
      }
    }
  });

  it("no service cross-links to itself", () => {
    for (const slug of slugs) {
      expect(serviceContent(slug).related).not.toContain(slug);
    }
  });
});
