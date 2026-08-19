import { describe, it, expect } from "vitest";
import { pickLogoCandidates, parseHttpUrl, isBlockedAddress } from "@/lib/logo-source";

const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;

describe("pickLogoCandidates", () => {
  it("prefers the apple touch icon over the favicon and the card image", () => {
    const html = page(`
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <meta property="og:image" content="https://bank.example/card.jpg">
      <link rel="apple-touch-icon" href="/touch.png" sizes="180x180">
    `);
    const got = pickLogoCandidates(html, "https://bank.example/");
    expect(got[0]).toEqual({ url: "https://bank.example/touch.png", source: "apple-touch-icon" });
  });

  it("takes the largest declared icon of a kind", () => {
    const html = page(`
      <link rel="icon" href="/small.png" sizes="16x16">
      <link rel="icon" href="/big.png" sizes="192x192">
    `);
    const urls = pickLogoCandidates(html, "https://bank.example/").map((c) => c.url);
    expect(urls.indexOf("https://bank.example/big.png")).toBeLessThan(
      urls.indexOf("https://bank.example/small.png")
    );
  });

  it("ranks an .ico behind a same-sized .png, because sharp cannot decode ICO", () => {
    const html = page(`
      <link rel="icon" href="/icon.ico">
      <link rel="icon" href="/icon.png">
    `);
    const urls = pickLogoCandidates(html, "https://bank.example/").map((c) => c.url);
    expect(urls.indexOf("https://bank.example/icon.png")).toBeLessThan(
      urls.indexOf("https://bank.example/icon.ico")
    );
  });

  it("resolves relative, protocol-relative and CDN hrefs against the page", () => {
    const html = page(`
      <link rel="apple-touch-icon" href="//cdn.example/logo.png">
      <link rel="icon" href="assets/icon.png">
    `);
    const urls = pickLogoCandidates(html, "https://bank.example/apply/");
    expect(urls.map((c) => c.url)).toContain("https://cdn.example/logo.png");
    expect(urls.map((c) => c.url)).toContain("https://bank.example/apply/assets/icon.png");
  });

  it("honours a <base href>, which is where a site's icons often actually live", () => {
    const html = page(`
      <base href="https://cdn.example/site/">
      <link rel="icon" href="icon.png">
    `);
    expect(pickLogoCandidates(html, "https://bank.example/")[0].url).toBe(
      "https://cdn.example/site/icon.png"
    );
  });

  it("drops a mask-icon, which is a silhouette rather than a logo", () => {
    const html = page(`<link rel="mask-icon" href="/pin.svg" color="#000">`);
    expect(pickLogoCandidates(html, "https://bank.example/").map((c) => c.url)).not.toContain(
      "https://bank.example/pin.svg"
    );
  });

  it("refuses a data: or javascript: href", () => {
    const html = page(`
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="apple-touch-icon" href="javascript:alert(1)">
    `);
    const urls = pickLogoCandidates(html, "https://bank.example/").map((c) => c.url);
    expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
  });

  it("always ends with /favicon.ico, so a page declaring nothing still has one try", () => {
    const got = pickLogoCandidates(page(""), "https://bank.example/apply");
    expect(got).toEqual([{ url: "https://bank.example/favicon.ico", source: "favicon.ico" }]);
  });

  it("de-duplicates a URL declared twice", () => {
    const html = page(`
      <link rel="icon" href="/icon.png">
      <link rel="shortcut icon" href="/icon.png">
    `);
    const urls = pickLogoCandidates(html, "https://bank.example/").map((c) => c.url);
    expect(urls.filter((u) => u.endsWith("/icon.png"))).toHaveLength(1);
  });

  it("reads single-quoted and unquoted attributes", () => {
    const html = page(`<link rel='apple-touch-icon' href=/touch.png sizes=180x180>`);
    expect(pickLogoCandidates(html, "https://bank.example/")[0].source).toBe("apple-touch-icon");
  });
});

describe("parseHttpUrl", () => {
  it("assumes https for a bare domain, the way an address bar does", () => {
    expect(parseHttpUrl("goodleap.com")?.toString()).toBe("https://goodleap.com/");
  });

  it("refuses a scheme that is not http(s)", () => {
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("file:///etc/passwd")).toBeNull();
    expect(parseHttpUrl("ftp://example.com")).toBeNull();
  });

  it("refuses empty input", () => {
    expect(parseHttpUrl("   ")).toBeNull();
  });
});

describe("isBlockedAddress", () => {
  it("blocks loopback, private and carrier-NAT ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks the cloud metadata endpoint", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks IPv6 loopback, link-local and unique-local", () => {
    for (const ip of ["::1", "::", "fe80::1", "fd00::1", "fc00::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks an IPv4 loopback wearing an IPv6 mapping", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "104.18.32.7", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});
