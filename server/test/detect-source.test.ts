import { describe, it, expect } from "vitest";
import { detectSource, extractUrl, normalizeUrl } from "../src/classify.js";

// Ported from main's tests/unit/detect-source.test.ts — the subject moved from
// src/util/detect-source.ts to src/classify.ts; assertions are unchanged.

describe("detectSource", () => {
  it("classifies supported social posts by host + post path", () => {
    expect(detectSource("https://www.tiktok.com/@caitlynskitchen/video/7663645567339334943")).toBe("tiktok");
    expect(detectSource("https://www.instagram.com/reel/Dbi_VuygdfS/")).toBe("instagram");
    expect(detectSource("https://fb.watch/abc123/")).toBe("facebook");
    expect(detectSource("https://www.pinterest.com/pin/68750145082/")).toBe("pinterest");
    expect(detectSource("https://youtube.com/shorts/WwSJhSpdnr0?is=v0p8")).toBe("youtube");
    expect(detectSource("https://www.youtube.com/watch?v=79gZLSXINAU")).toBe("youtube");
    expect(detectSource("https://youtu.be/79gZLSXINAU")).toBe("youtube");
  });

  it("treats an unknown http host as a website", () => {
    expect(detectSource("https://thecozycook.com/creamy-garlic-chicken/")).toBe("website");
  });

  it("returns null for a profile link, junk, or a non-http URL", () => {
    expect(detectSource("https://instagram.com/someprofile")).toBeNull();
    expect(detectSource("ftp://example.com/x")).toBeNull();
    expect(detectSource("not a url")).toBeNull();
    expect(detectSource(undefined)).toBeNull();
  });
});

describe("extractUrl", () => {
  it("reads the url field, else the first URL in free text, else undefined", () => {
    expect(extractUrl({ url: "https://x.com/p/1" })).toBe("https://x.com/p/1");
    expect(extractUrl({ text: "look at this https://www.tiktok.com/@x/video/9 yum" })).toBe(
      "https://www.tiktok.com/@x/video/9",
    );
    expect(extractUrl({ text: "no link here" })).toBeUndefined();
    expect(extractUrl(undefined)).toBeUndefined();
  });
});

describe("normalizeUrl", () => {
  it("strips tracking params, the fragment, and www", () => {
    expect(normalizeUrl("https://www.tiktok.com/@x/video/9?utm_source=ig&si=abc#top")).toBe(
      "https://tiktok.com/@x/video/9",
    );
  });
});
