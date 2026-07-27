import { describe, expect, it } from "vitest";

import {
  divineskinsImageUrls,
  runeforgeFallbackImageUrls,
  runeforgeThumbnailUrls,
  runeforgeVideoThumbnailUrls,
} from "./providers";

describe("divineskinsImageUrls", () => {
  it("builds a Divine CDN URL without escaping path separators", () => {
    expect(
      divineskinsImageUrls("thumbnails/2610/fd3634ab-d5a6-4f6e-be76-a6c56434cfa4.webp"),
    ).toEqual([
      "https://lol-assets.divine-cdn.com/thumbnails/2610/fd3634ab-d5a6-4f6e-be76-a6c56434cfa4.webp",
    ]);
  });

  it("accepts only direct Divine CDN URLs", () => {
    expect(divineskinsImageUrls("https://lol-assets.divine-cdn.com/gallery/image.jpg")).toEqual([
      "https://lol-assets.divine-cdn.com/gallery/image.jpg",
    ]);
    expect(divineskinsImageUrls("https://example.com/image.jpg")).toEqual([]);
  });
});

describe("runeforgeThumbnailUrls", () => {
  it("returns no sources when RuneForge has no thumbnail", () => {
    expect(runeforgeThumbnailUrls(null)).toEqual([]);
  });

  it("uses RuneForge's card image URL and falls back to the original R2 asset", () => {
    const urls = runeforgeThumbnailUrls("6090282e-9c82-46a9-9ef2-c362c5e1d057.jpg");

    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(
      "https://runeforge.dev/cdn-cgi/image/width=600,height=400,quality=85,format=webp,fit=contain,anim=false/https://r2-images-prod.runeforge.dev/6090282e-9c82-46a9-9ef2-c362c5e1d057.jpg",
    );
    expect(urls[1]).toBe(
      "https://r2-images-prod.runeforge.dev/6090282e-9c82-46a9-9ef2-c362c5e1d057.jpg",
    );
  });
});

describe("runeforgeFallbackImageUrls", () => {
  it("accepts RuneForge gallery image URLs", () => {
    expect(
      runeforgeFallbackImageUrls(
        "/cdn-cgi/image/width=1280/https://r2-images-prod.runeforge.dev/gallery.png",
      ),
    ).toEqual([
      "https://runeforge.dev/cdn-cgi/image/width=1280/https://r2-images-prod.runeforge.dev/gallery.png",
      "https://r2-images-prod.runeforge.dev/gallery.png",
    ]);
  });

  it("rejects unrelated image hosts", () => {
    expect(runeforgeFallbackImageUrls("https://example.com/image.png")).toEqual([]);
  });
});

describe("runeforgeVideoThumbnailUrls", () => {
  it("creates fallback thumbnails for a YouTube share URL", () => {
    expect(runeforgeVideoThumbnailUrls("https://youtu.be/Q0u666apRnE")).toEqual([
      "https://i.ytimg.com/vi/Q0u666apRnE/maxresdefault.jpg",
      "https://i.ytimg.com/vi/Q0u666apRnE/hqdefault.jpg",
    ]);
  });

  it("supports regular, shorts, and embed YouTube URLs", () => {
    expect(runeforgeVideoThumbnailUrls("https://youtube.com/watch?v=Q0u666apRnE")).toHaveLength(2);
    expect(runeforgeVideoThumbnailUrls("https://youtube.com/shorts/Q0u666apRnE")).toHaveLength(2);
    expect(runeforgeVideoThumbnailUrls("https://youtube.com/embed/Q0u666apRnE")).toHaveLength(2);
  });

  it("ignores invalid and unsupported video URLs", () => {
    expect(runeforgeVideoThumbnailUrls("not a URL")).toEqual([]);
    expect(runeforgeVideoThumbnailUrls("https://vimeo.com/123456")).toEqual([]);
  });
});
