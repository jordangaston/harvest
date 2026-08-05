import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { SourceType } from '../db/schema/enums.js';
import { selectWebsiteFetcher, type ExtractedRecipe } from '../fetch/website.js';
import { selectTikTokOembed } from '../fetch/tiktok-oembed.js';
import { selectSourceFetcher, type ApifyPlatform } from '../fetch/apify-fetcher.js';
import { selectMediaExtractor, scaleImage } from '../fetch/media-extractor.js';
import { selectTranscriber } from '../parse/asr.js';
import { selectVision } from '../parse/vision.js';
import { selectExtractor, type ParseContext, type ExtractedRecipeData } from '../parse/extractor.js';
import { RecipeRepository, type RecipeInput } from '../repositories/recipe-repository.js';

const website = selectWebsiteFetcher();
const tiktok = selectTikTokOembed();
const media = selectMediaExtractor();
const transcriber = selectTranscriber();
const vision = selectVision();
const extractor = selectExtractor();
const recipes = RecipeRepository.create();

/** What the pipeline needs to import a job: the resolved source + its owner. */
export interface ImportInput {
  jobId: string;
  userId: string;
  sourceType: SourceType;
  sourceRef: string;
}

/**
 * A serializable hand-off between the fetch step and the rest of the pipeline —
 * no Buffers cross a step boundary, only URLs/text. `structured` is the Tier-0
 * JSON-LD shortcut (website / outbound link); the rest feed the LLM extractor.
 */
export interface Material {
  caption?: string;
  videoUrl?: string;
  imageRef?: string;
  /** Ordered slide image URLs of a carousel post — several recipes, one per slide. */
  imageUrls?: string[];
  /** The post's cover image, featured as a single recipe's thumbnail. */
  thumbnailUrl?: string;
  structured?: ExtractedRecipe;
}

/** A typed import failure carrying the machine error code the job records. */
export class ImportError extends Error {
  /** @param code - The machine error code the job records. */
  constructor(readonly code: string) {
    super(code);
    this.name = 'ImportError';
  }

  /** The error code to record for a thrown value (defaults to EXTRACTION_FAILED). */
  static codeOf(err: unknown): string {
    return err instanceof ImportError ? err.code : 'EXTRACTION_FAILED';
  }
}

/**
 * The import work — the concern the workflow drives, kept separate from it.
 * `run` is a deterministic orchestrator: each non-deterministic stage is a
 * `@DBOS.step` (static, as DBOS requires) it awaits, so DBOS memoizes completed
 * stages and a late failure re-runs only the failed stage, not the network calls
 * before it. Steps pass URLs/text — never Buffers — so their I/O stays inside one
 * step (ffmpeg → Buffer → Whisper) and the checkpoint stays JSON-serializable.
 */
export class ImportPipeline {
  /**
   * Deterministic orchestrator: try the structured shortcut, then the free
   * caption, then escalate to ASR/vision on the media. Each stage it awaits is a
   * memoized step, so a re-run skips the calls that already succeeded.
   * @param input - The resolved source and its owner.
   * @returns The persisted recipe ids — usually one, several for a slideshow.
   * @throws ImportError - `NO_RECIPE` when nothing usable is found; the failed
   *   stage's code otherwise.
   */
  static async run(input: ImportInput): Promise<string[]> {
    const material = await ImportPipeline.fetchSource(input);
    if (material.structured) {
      const data = withThumbnail({ ...material.structured, confidence: 1 }, material.thumbnailUrl);
      return [await ImportPipeline.persistOrThrow(data, input)];
    }

    // Caption-first: the free caption is often the whole recipe — try it before
    // spending ASR/vision on the media.
    if (material.caption) {
      const fromCaption = await ImportPipeline.extractOrThrow({ caption: material.caption });
      if (hasRecipe(fromCaption)) return [await ImportPipeline.persist(withThumbnail(fromCaption, material.thumbnailUrl), input)];
    }

    // The caption fell short — escalate to the media (O-04/O-05).
    if (material.videoUrl) {
      const ctx: ParseContext = { caption: material.caption };
      ctx.transcript = await ImportPipeline.transcribe(material.videoUrl);
      ctx.visionText = await ImportPipeline.describeVideo(material.videoUrl);
      return [await ImportPipeline.persistOrThrow(withThumbnail(await ImportPipeline.extractOrThrow(ctx), material.thumbnailUrl), input)];
    }
    if (material.imageRef) {
      const ctx: ParseContext = { caption: material.caption, visionText: await ImportPipeline.describePhoto(material.imageRef) };
      return [await ImportPipeline.persistOrThrow(withThumbnail(await ImportPipeline.extractOrThrow(ctx), material.thumbnailUrl), input)];
    }
    // A carousel (Instagram slideshow) can hold several recipes, one per slide.
    if (material.imageUrls?.length) return ImportPipeline.extractCarousel(material.imageUrls, input);

    // Neither a usable caption nor media — no recipe to find.
    throw new ImportError('NO_RECIPE');
  }

  /**
   * OCR each carousel slide and persist every recipe it yields (O-05). A recipe
   * slide carries the full ingredient+step block; the dish photo on the slide
   * before it becomes that recipe's thumbnail (the image a user recognizes).
   * @param imageUrls - Ordered slide image URLs.
   * @param input - The resolved source and its owner.
   * @returns The persisted recipe ids, in slide order.
   * @throws ImportError - `NO_RECIPE` when no slide yields a recipe.
   */
  private static async extractCarousel(imageUrls: string[], input: ImportInput): Promise<string[]> {
    // Every slide fetches → OCRs → extracts in one step, all in parallel, so OCR
    // and extraction overlap across slides. Null = a photo/cover or non-recipe slide.
    const perSlide = await Promise.all(imageUrls.map((url) => ImportPipeline.readSlideRecipe(url)));

    const recipeIds: string[] = [];
    for (let i = 0; i < perSlide.length; i++) {
      const data = perSlide[i];
      if (!data) continue;
      // The thumbnail to feature is the slide before the instructions — the dish
      // photo — falling back to the recipe slide itself for a leading recipe.
      const thumbnail = imageUrls[i - 1] ?? imageUrls[i];
      recipeIds.push(await ImportPipeline.persist({ ...data, imageUrl: data.imageUrl || thumbnail }, input));
    }
    if (recipeIds.length === 0) throw new ImportError('NO_RECIPE');
    return recipeIds;
  }

  /** The extract step, with its throw mapped to EXTRACTION_FAILED. */
  private static async extractOrThrow(ctx: ParseContext): Promise<ExtractedRecipeData> {
    try {
      return await ImportPipeline.extract(ctx);
    } catch {
      throw new ImportError('EXTRACTION_FAILED');
    }
  }

  /** Routes by source type to a Tier-0 structured recipe or the raw material. */
  @DBOS.step()
  static async fetchSource(input: ImportInput): Promise<Material> {
    try {
      switch (input.sourceType) {
        case 'website':
          return { structured: await website.fetch(input.sourceRef) };
        case 'tiktok':
          return { caption: (await tiktok.fetch(input.sourceRef))?.caption };
        case 'photo':
          return { imageRef: input.sourceRef };
        default:
          return ImportPipeline.fromApify(input.sourceType, input.sourceRef);
      }
    } catch (err) {
      throw new ImportError(err instanceof ImportError ? err.code : 'FETCH_FAILED');
    }
  }

  /** IG/FB/Pinterest: an outbound link → website (Q-01), else caption + media
   * (a reel's video, or a carousel's slide images). */
  private static async fromApify(platform: Exclude<ApifyPlatform, 'tiktok'>, url: string): Promise<Material> {
    const post = await selectSourceFetcher().fetchPost(platform, url);
    if (post.outboundLink) return { structured: await website.fetch(post.outboundLink) };
    return { caption: post.caption, videoUrl: post.videoUrl, imageUrls: post.images, thumbnailUrl: post.thumbnailUrl };
  }

  /**
   * Fetch a carousel slide, OCR it, and extract a recipe if it carries one. OCR
   * and extraction run inside one step so slides pipeline in parallel (a later
   * slide OCRs while an earlier one extracts). A slide we can't fetch/OCR, a
   * photo/cover slide (short text), or one with no recipe returns null. Every
   * operation here is a read, so a re-run on failure is safe.
   * @param url - The slide image URL.
   * @returns The slide's recipe, or null when it carries none.
   */
  @DBOS.step()
  static async readSlideRecipe(url: string): Promise<ExtractedRecipeData | null> {
    let text: string;
    try {
      const res = await fetch(url, { headers: { 'user-agent': IMAGE_FETCH_USER_AGENT } });
      if (!res.ok) throw new Error(`image fetch ${url} — HTTP ${res.status}`);
      text = await vision.readFrames([await scaleImage(Buffer.from(await res.arrayBuffer()))]);
    } catch {
      return null;
    }
    // ponytail: a recipe slide OCRs to a long ingredient+step block; a cover or
    // dish-photo slide to a short, noisy string. Gate on length to skip photos;
    // hasRecipe is the real filter. Retune if a layout puts a short recipe alone.
    if (text.length < CAROUSEL_RECIPE_MIN_CHARS) return null;
    try {
      const data = await extractor.extract({ visionText: text });
      return hasRecipe(data) ? data : null;
    } catch {
      return null;
    }
  }

  /** Pull the audio track and transcribe it (ffmpeg → Buffer → Whisper, in-step). */
  @DBOS.step()
  static async transcribe(videoUrl: string): Promise<string> {
    try {
      return await transcriber.transcribe(await media.audio(videoUrl));
    } catch {
      throw new ImportError('MEDIA_UNAVAILABLE');
    }
  }

  /** Sample frames and read their on-screen text (ffmpeg → Buffers → vision, in-step). */
  @DBOS.step()
  static async describeVideo(videoUrl: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'harvest-frames-'));
    try {
      const paths = await media.frames(videoUrl, dir);
      return await vision.readFrames(await Promise.all(paths.map((p) => readFile(p))));
    } catch {
      throw new ImportError('MEDIA_UNAVAILABLE');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Read on-screen text from a single photo. */
  @DBOS.step()
  static async describePhoto(imageRef: string): Promise<string> {
    try {
      return await vision.readFrames([await readFile(imageRef)]);
    } catch {
      throw new ImportError('MEDIA_UNAVAILABLE');
    }
  }

  /**
   * Run the LLM extractor over the parse signals (its own network call, so its
   * own step).
   * @param ctx - Caption/transcript/vision text to extract from.
   * @returns The structured recipe with a confidence score.
   */
  @DBOS.step()
  static async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    return extractor.extract(ctx);
  }

  /**
   * Persist the recipe for its owner (the final DB step).
   * @param data - The extracted recipe.
   * @param input - Carries the owning `userId` and source metadata.
   * @returns The new recipe id.
   */
  @DBOS.step()
  static async persist(data: ExtractedRecipeData, input: ImportInput): Promise<string> {
    return recipes.persist(toRecipeInput(data, input), input.userId);
  }

  /** Gate on a real recipe, then persist — an empty extraction is NO_RECIPE. */
  private static async persistOrThrow(data: ExtractedRecipeData, input: ImportInput): Promise<string> {
    if (!hasRecipe(data)) throw new ImportError('NO_RECIPE');
    return ImportPipeline.persist(data, input);
  }
}

/** A usable recipe has at least a title and one ingredient. */
function hasRecipe(data: ExtractedRecipeData): boolean {
  return Boolean(data.title) && data.ingredients.length > 0;
}

/** Feature the post's cover as the recipe thumbnail when the parse found none. */
function withThumbnail(data: ExtractedRecipeData, thumbnailUrl?: string): ExtractedRecipeData {
  return data.imageUrl || !thumbnailUrl ? data : { ...data, imageUrl: thumbnailUrl };
}

/** Min OCR length for a slide to be treated as a recipe (vs. a photo/cover). */
const CAROUSEL_RECIPE_MIN_CHARS = 800;

/** Browser-ish UA — Instagram's image CDN 403s an unadorned fetch client. */
const IMAGE_FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Maps an extracted recipe + its source onto the repository's insert shape. */
function toRecipeInput(data: ExtractedRecipeData, input: ImportInput): RecipeInput {
  return {
    title: data.title,
    sourceType: input.sourceType,
    sourceUrl: input.sourceType === 'photo' ? undefined : input.sourceRef,
    servings: data.servings ? parseInt(data.servings, 10) || undefined : undefined,
    totalMinutes: data.totalMinutes,
    imageUrl: data.imageUrl,
    confidence: data.confidence,
    ingredients: data.ingredients,
    steps: data.steps,
  };
}
