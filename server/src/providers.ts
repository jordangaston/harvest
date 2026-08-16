import type { ImportInput } from "./import-domain.js";
import { WebsiteFetcher, type ExtractedRecipe } from "./parse/website.js";
import { selectExtractor, type ExtractedRecipeData, type ParseContext } from "./parse/extractor.js";
import { selectSourceFetcher, type ApifyPlatform } from "./fetch/apify-fetcher.js";
import { YouTubeFetcher } from "./fetch/youtube-fetcher.js";
import { PinterestFetcher } from "./fetch/pinterest-fetcher.js";
import type { VideoHeaders } from "./fetch/media-extractor.js";

/**
 * A serializable fetch → extract hand-off (only URLs/text cross a step boundary,
 * never Buffers). `structured` is the Tier-0 JSON-LD shortcut; `caption` feeds the
 * LLM extractor; the media fields (video/photo/slides) drive the real ASR/OCR
 * fan-out in the workflow. Ports `Material` from server/src/pipeline/import-pipeline.ts.
 */
export interface Material {
  caption?: string;
  videoUrl?: string;
  /** Extra HTTP headers ffmpeg must send to read `videoUrl` (Pinterest's CDN). */
  videoHeaders?: VideoHeaders;
  imageRef?: string;
  /** A link to follow for the recipe when the caption falls short (a YouTube
   * description linking out to the printable recipe). Tried before the media. */
  outboundLink?: string;
  /** Ordered slide image URLs of a carousel post — several recipes, one per slide. */
  imageUrls?: string[];
  /** The post's cover image, featured as a single recipe's thumbnail. */
  thumbnailUrl?: string;
  structured?: ExtractedRecipe;
}

const website = WebsiteFetcher.create();
const extractor = selectExtractor();

/**
 * Route a resolved source to fetched material — ports `ImportPipeline.fetchSource`.
 * Website reads schema.org JSON-LD (Tier-0, no LLM). YouTube reads InnerTube
 * (description/pinned comment/transcript + outbound link). Pinterest reads its
 * public pidgets endpoint. TikTok/Instagram/Facebook scrape via Apify — real
 * caption + video URL + carousel slides. Photo is a single image OCR.
 *
 * @throws Error carrying FETCH_FAILED on any fetch failure, UNSUPPORTED for an
 *   unknown source type.
 */
export async function fetchSource(input: ImportInput): Promise<Material> {
  try {
    switch (input.sourceType) {
      case "website":
        return { structured: await website.fetch(input.sourceRef) };
      case "youtube":
        return await fromYouTube(input.sourceRef);
      case "pinterest":
        return await fromPinterest(input.sourceRef);
      case "photo":
        return { imageRef: input.sourceRef };
      case "tiktok":
      case "instagram":
      case "facebook":
        return await fromApify(input.sourceType, input.sourceRef);
      default:
        throw new Error("UNSUPPORTED");
    }
  } catch (err) {
    if (err instanceof Error && err.message === "UNSUPPORTED") throw err;
    throw new Error("FETCH_FAILED");
  }
}

/** IG/FB/TikTok via Apify: an outbound link → website, else caption + media
 * (a reel's video, or a carousel's slide images). */
async function fromApify(platform: ApifyPlatform, url: string): Promise<Material> {
  const post = await selectSourceFetcher().fetchPost(platform, url);
  if (post.outboundLink) return { structured: await website.fetch(post.outboundLink) };
  return {
    caption: post.caption,
    videoUrl: post.videoUrl,
    videoHeaders: post.videoHeaders,
    imageUrls: post.images,
    thumbnailUrl: post.thumbnailUrl,
  };
}

/** YouTube via InnerTube. The recipe is in the description, the pinned comment,
 * or a blog the description links to — gather the text as the caption and expose
 * the link for the caption-then-link path. */
async function fromYouTube(url: string): Promise<Material> {
  const video = await YouTubeFetcher.create().fetch(url);
  const caption = [video.description, video.pinnedComment, video.transcript].filter(Boolean).join("\n\n");
  return { caption: caption || undefined, outboundLink: video.outboundLink, thumbnailUrl: video.thumbnailUrl };
}

/** Pinterest via pidgets: a video pin → its clip; else the outbound link → the
 * full recipe website; else the pin's own structured recipe; else its description. */
async function fromPinterest(url: string): Promise<Material> {
  const pin = await PinterestFetcher.create().fetchPin(url);
  if (pin.videoUrl) {
    return { caption: pin.description, videoUrl: pin.videoUrl, videoHeaders: pin.videoHeaders, thumbnailUrl: pin.thumbnailUrl };
  }
  if (pin.link) {
    try {
      return { structured: await website.fetch(pin.link) };
    } catch {
      // The link had no JSON-LD recipe — fall back to the pin's own data.
    }
  }
  if (pin.recipe) return { structured: pin.recipe };
  return { caption: pin.description, thumbnailUrl: pin.thumbnailUrl };
}

/** Fetch and extract a linked recipe page's JSON-LD (throws if it has none). */
export async function fetchLinkedRecipe(url: string): Promise<ExtractedRecipe> {
  return website.fetch(url);
}

/** Run the LLM extractor over the parse signals (caption/transcript/vision text). */
export async function extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
  return extractor.extract(ctx);
}
