import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { SourceType } from '../db/schema/enums.js';
import { selectWebsiteFetcher, type ExtractedRecipe } from '../fetch/website.js';
import { selectTikTokOembed } from '../fetch/tiktok-oembed.js';
import { selectSourceFetcher, type ApifyPlatform } from '../fetch/apify-fetcher.js';
import { selectMediaExtractor } from '../fetch/media-extractor.js';
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
  structured?: ExtractedRecipe;
}

/** A typed import failure carrying the machine error code the job records. */
export class ImportError extends Error {
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
  static async run(input: ImportInput): Promise<string> {
    const material = await ImportPipeline.fetchSource(input);
    const structured = material.structured;
    if (structured) return ImportPipeline.persistOrThrow({ ...structured, confidence: 1 }, input);

    const ctx: ParseContext = { caption: material.caption };
    if (material.videoUrl) {
      ctx.transcript = await ImportPipeline.transcribe(material.videoUrl);
      ctx.visionText = await ImportPipeline.describeVideo(material.videoUrl);
    } else if (material.imageRef) {
      ctx.visionText = await ImportPipeline.describePhoto(material.imageRef);
    }

    let data: ExtractedRecipeData;
    try {
      data = await ImportPipeline.extract(ctx);
    } catch {
      throw new ImportError('EXTRACTION_FAILED');
    }
    return ImportPipeline.persistOrThrow(data, input);
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

  /** IG/FB/Pinterest: an outbound link → website (Q-01), else caption + video. */
  private static async fromApify(platform: Exclude<ApifyPlatform, 'tiktok'>, url: string): Promise<Material> {
    const post = await selectSourceFetcher().fetchPost(platform, url);
    if (post.outboundLink) return { structured: await website.fetch(post.outboundLink) };
    return { caption: post.caption, videoUrl: post.videoUrl };
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

  @DBOS.step()
  static async extract(ctx: ParseContext): Promise<ExtractedRecipeData> {
    return extractor.extract(ctx);
  }

  @DBOS.step()
  static async persist(data: ExtractedRecipeData, input: ImportInput): Promise<string> {
    return recipes.persist(toRecipeInput(data, input), input.userId);
  }

  /** Gate on a real recipe, then persist — an empty extraction is NO_RECIPE. */
  private static async persistOrThrow(data: ExtractedRecipeData, input: ImportInput): Promise<string> {
    if (!data.title || data.ingredients.length === 0) throw new ImportError('NO_RECIPE');
    return ImportPipeline.persist(data, input);
  }
}

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
