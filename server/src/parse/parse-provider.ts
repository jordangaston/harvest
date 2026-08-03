import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParseInput, ParseOutcome, ParseProvider } from '../pipeline/parse-step.js';
import { fetchWebsiteHtml, parseRecipeFromHtml, type ExtractedRecipe } from '../fetch/website.js';
import { TikTokOembed } from '../fetch/tiktok-oembed.js';
import { selectSourceFetcher, type ApifyPlatform, type FetchedPost } from '../fetch/apify-fetcher.js';
import { MediaExtractor } from '../fetch/media-extractor.js';
import { selectTranscriber, type Transcriber } from './asr.js';
import { selectVision, type FrameReader } from './vision.js';
import { selectExtractor, type ParseContext, type RecipeExtractor } from './extractor.js';
import { RecipeRepository, type RecipeInput } from '../repositories/recipe-repository.js';
import type { SourceType } from '../db/schema/enums.js';

/**
 * The real parse provider (O-08): routes a resolved source through the cheapest
 * capable path, extracts a structured recipe, and persists it to the user's
 * cookbook. Distinct throw sites map to distinct error codes (FETCH_FAILED,
 * MEDIA_UNAVAILABLE, EXTRACTION_FAILED); an empty result is NO_RECIPE.
 */
export class RealParseProvider {
  constructor(
    private readonly transcriber: Transcriber,
    private readonly vision: FrameReader,
    private readonly extractor: RecipeExtractor,
    private readonly media: MediaExtractor,
    private readonly repo: RecipeRepository,
  ) {}

  async run(input: ParseInput): Promise<ParseOutcome> {
    let structured: ExtractedRecipe | undefined;
    let ctx: ParseContext;
    try {
      ({ structured, ctx } = await this.gather(input));
    } catch (err) {
      return failed(classifyGatherError(err));
    }

    let data;
    try {
      data = structured ? { ...structured, confidence: 1 } : await this.extractor.extract(ctx);
    } catch {
      return failed('EXTRACTION_FAILED');
    }

    if (!data.title || data.ingredients.length === 0) return failed('NO_RECIPE');
    const recipeId = await this.repo.persist(toRecipeInput(data, input), input.userId);
    return { outcome: 'ready', recipeId };
  }

  /** Routes by source type to a structured recipe (Tier 0) or a ParseContext. */
  private async gather(
    input: ParseInput,
  ): Promise<{ structured?: ExtractedRecipe; ctx: ParseContext }> {
    switch (input.sourceType) {
      case 'website':
        return { structured: await this.fromWebsite(input.sourceRef), ctx: {} };
      case 'tiktok':
        return { ctx: { caption: (await TikTokOembed.create().fetch(input.sourceRef))?.caption } };
      case 'photo':
        return { ctx: { visionText: await this.vision.readFrames([await readFile(input.sourceRef)]) } };
      default:
        return this.fromApify(input.sourceType, input.sourceRef);
    }
  }

  /** Website path (Tier 0, no LLM): fetch HTML, read JSON-LD. */
  private async fromWebsite(url: string): Promise<ExtractedRecipe> {
    return parseRecipeFromHtml(await fetchWebsiteHtml(url), url);
  }

  /** IG/FB/Pinterest: outbound link → website recurse (Q-01), else caption + media. */
  private async fromApify(
    platform: Exclude<ApifyPlatform, 'tiktok'>,
    url: string,
  ): Promise<{ structured?: ExtractedRecipe; ctx: ParseContext }> {
    const post = await selectSourceFetcher().fetchPost(platform, url);
    if (post.outboundLink) return { structured: await this.fromWebsite(post.outboundLink), ctx: {} };
    return { ctx: await this.contextFromVideo(post) };
  }

  /** Builds a ParseContext from a post's caption plus (if present) its video. */
  private async contextFromVideo(post: FetchedPost): Promise<ParseContext> {
    const ctx: ParseContext = { caption: post.caption };
    if (!post.videoUrl) return ctx;
    const dir = await mkdtemp(join(tmpdir(), 'harvest-frames-'));
    try {
      ctx.transcript = await this.transcriber.transcribe(await this.media.audio(post.videoUrl));
      const frames = await this.media.frames(post.videoUrl, dir);
      ctx.visionText = await this.vision.readFrames(
        await Promise.all(frames.paths.map((p) => readFile(p))),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return ctx;
  }
}

function failed(errorCode: string): ParseOutcome {
  return { outcome: 'failed', errorCode };
}

/** Media (ffmpeg/frame) throws → MEDIA_UNAVAILABLE; fetch throws → FETCH_FAILED. */
function classifyGatherError(err: unknown): string {
  return err instanceof Error && /ffmpeg/i.test(err.message) ? 'MEDIA_UNAVAILABLE' : 'FETCH_FAILED';
}

function toRecipeInput(
  data: ExtractedRecipe & { confidence: number },
  input: ParseInput,
): RecipeInput {
  return {
    title: data.title,
    sourceType: input.sourceType as SourceType,
    sourceUrl: input.sourceType === 'photo' ? undefined : input.sourceRef,
    servings: data.servings ? parseInt(data.servings, 10) || undefined : undefined,
    totalMinutes: data.totalMinutes,
    imageUrl: data.imageUrl,
    confidence: data.confidence,
    ingredients: data.ingredients,
    steps: data.steps,
  };
}

/** Wires the env-selected providers into a ParseProvider for the workflow seam. */
export function createParseProvider(): ParseProvider {
  const provider = new RealParseProvider(
    selectTranscriber(),
    selectVision(),
    selectExtractor(),
    MediaExtractor.create(),
    RecipeRepository.create(),
  );
  return (input) => provider.run(input);
}
