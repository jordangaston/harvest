import { FatalError } from "workflow";
import { eq } from "drizzle-orm";
import { dbFromEnv } from "../edge-db.js";
import { importJobs } from "../schema.js";
import { ImportJobRepository } from "../repositories/import-job-repository.js";
import { fetchSource, fetchLinkedRecipe, extract, type Material } from "../providers.js";
import { toExtractedData, hasRecipe } from "../parse/mapping.js";
import { persistAndReady } from "../import-persist.js";
import { importErrorCode, type ImportInput } from "../import-domain.js";
import { extractMedia, transcribe, readFrame, describePhoto, readSlideRecipe } from "./media-steps.js";
import type { ExtractedRecipeData } from "../parse/extractor.js";

/**
 * The durable import workflow — the WDK port of DBOS's `ImportWorkflow` +
 * `ImportPipeline`. Shape: markRunning → fetchSource → resolveRecipes →
 * persistAndReady, with catch → markFailed. The workflow orchestrates only; every
 * unit of real work is a `"use step"` that returns serializable data. On a fault,
 * WDK replays and returns each completed step's logged result — resume-not-restart.
 * The workflow never throws; every outcome is a recorded job status.
 *
 * Media path (this story): a video source runs the per-frame FAN-OUT —
 * `extractMedia` (one ffmpeg step) then `Promise.all([transcribe(audio),
 * Promise.all(frames.map(readFrame))])`, each frame in its own invocation, all
 * concurrent. A carousel fans `readSlideRecipe` per slide — one recipe per slide.
 */
export async function importWorkflow(input: ImportInput): Promise<void> {
  "use workflow";
  try {
    await markRunning(input.jobId);
    const material = await fetchSourceStep(input);
    const recipes = await resolveRecipes(material, input);
    await persistStep(recipes, input);
  } catch (err) {
    await markFailed(input.jobId, importErrorCode(err));
  }
}

/**
 * Resolve the fetched material to one or more structured recipes, orchestrating
 * the media fan-out in the workflow (so the per-frame steps run as separate,
 * concurrent invocations). Mirrors `ImportPipeline.run`'s tiering: structured
 * shortcut → caption-first → outbound link → media (ASR + per-frame OCR) → photo
 * → carousel. Returns recipes in slide order (usually one).
 */
async function resolveRecipes(material: Material, input: ImportInput): Promise<ExtractedRecipeData[]> {
  // Tier-0: a website/pin/rich structured recipe — no LLM.
  if (material.structured) {
    return [withThumbnail(toExtractedData(material.structured, 1), material.thumbnailUrl)];
  }

  // A multi-image carousel holds several recipes on its slides; OCR the slides
  // directly rather than caption-first (which would extract one thin teaser recipe).
  if ((material.imageUrls?.length ?? 0) > 1) return carouselRecipes(material.imageUrls!, material);

  // Caption-first: the free caption is often the whole recipe — try it before
  // spending ASR/vision on the media. A steps-less caption WITH media to fall back
  // on escalates; a caption recipe with no media to escalate to is accepted.
  if (material.caption) {
    const fromCaption = await extractStep({ caption: material.caption }, input);
    if (hasRecipe(fromCaption) && (fromCaption.steps.length > 0 || !hasMediaFallback(material))) {
      return [withThumbnail(fromCaption, material.thumbnailUrl)];
    }
  }

  // The caption pointed elsewhere — follow the linked recipe (best-effort).
  if (material.outboundLink) {
    const linked = await fetchLinkedRecipeStep(material.outboundLink);
    if (linked) return [withThumbnail(toExtractedData(linked, 1), material.thumbnailUrl)];
  }

  // Escalate to the media — the per-frame FAN-OUT.
  if (material.videoUrl) {
    const media = await extractMedia(material.videoUrl, material.videoHeaders);
    const [transcript, frameTexts] = await Promise.all([
      transcript_(media.audioBase64),
      Promise.all(media.frameBase64.map((frame) => readFrame(frame))),
    ]);
    const data = await extractStep(
      { caption: material.caption, transcript, visionText: frameTexts.join("\n") },
      input,
    );
    return [withThumbnail(requireRecipe(data), material.thumbnailUrl)];
  }

  // A single photo — one OCR read, then extract.
  if (material.imageRef) {
    const visionText = await describePhoto(await fetchImageBase64Step(material.imageRef));
    const data = await extractStep({ caption: material.caption, visionText }, input);
    return [withThumbnail(requireRecipe(data), material.thumbnailUrl)];
  }

  // A single-slide carousel (rare) still routes through the slide path.
  if (material.imageUrls?.length) return carouselRecipes(material.imageUrls, material);

  throw new FatalError("NO_RECIPE");
}

/** OCR each carousel slide (fanned out) and keep every recipe it yields, in slide
 * order. The thumbnail featured is the dish photo on the slide before the recipe. */
async function carouselRecipes(imageUrls: string[], material: Material): Promise<ExtractedRecipeData[]> {
  const perSlide = await Promise.all(imageUrls.map((url) => readSlideRecipe(url)));
  const recipes: ExtractedRecipeData[] = [];
  for (let i = 0; i < perSlide.length; i++) {
    const data = perSlide[i];
    if (!data) continue;
    const thumbnail = imageUrls[i - 1] ?? imageUrls[i];
    recipes.push({ ...data, imageUrl: data.imageUrl || thumbnail });
  }
  if (recipes.length === 0) throw new FatalError("NO_RECIPE");
  return recipes;
}

/** Transition the job to `running`. */
async function markRunning(jobId: string): Promise<void> {
  "use step";
  console.log(`[step] mark-running job=${jobId}`);
  await ImportJobRepository.create(dbFromEnv()).setRunning(jobId, 10);
}

/** Fetch the resolved source's material (website JSON-LD, social caption, or media refs). */
async function fetchSourceStep(input: ImportInput): Promise<Material> {
  "use step";
  console.log(`[step] fetch-source job=${input.jobId} type=${input.sourceType}`);
  return fetchSource(input);
}
fetchSourceStep.maxRetries = 3;

/**
 * The LLM extract step. A one-shot injected fault (proof-only) throws once so the
 * retry re-enters ONLY this step — upstream steps replay from the event log.
 */
async function extractStep(ctx: { caption?: string; transcript?: string; visionText?: string }, input: ImportInput): Promise<ExtractedRecipeData> {
  "use step";
  console.log(`[step] extract job=${input.jobId}`);
  if (input.faultStep === "extract" && (await bumpAndCheckFault(input.jobId))) {
    throw new Error("injected transient fault (extract) — expect a retry");
  }
  return extract(ctx);
}
extractStep.maxRetries = 3;

/** Follow a caption's outbound link to a JSON-LD recipe; null when it has none. */
async function fetchLinkedRecipeStep(url: string): Promise<Awaited<ReturnType<typeof fetchLinkedRecipe>> | null> {
  "use step";
  console.log(`[step] fetch-linked ${url}`);
  try {
    return await fetchLinkedRecipe(url);
  } catch {
    return null;
  }
}
fetchLinkedRecipeStep.maxRetries = 2;

/** Fetch a photo source (a URL or file ref) and return it as base64 for OCR. */
async function fetchImageBase64Step(imageRef: string): Promise<string> {
  "use step";
  if (/^https?:\/\//.test(imageRef)) {
    const res = await fetch(imageRef);
    if (!res.ok) throw new Error("MEDIA_UNAVAILABLE");
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }
  const { readFile } = await import("node:fs/promises");
  return (await readFile(imageRef)).toString("base64");
}

/** Alias so the workflow's Promise.all reads as `transcribe`/`readFrame` per DESIGN. */
const transcript_ = transcribe;

/** Persist each resolved recipe and drive the job to `ready`, linking them all. */
async function persistStep(recipes: ExtractedRecipeData[], input: ImportInput): Promise<void> {
  "use step";
  console.log(`[step] persist-and-ready job=${input.jobId} recipes=${recipes.length}`);
  const recipeId = await persistAndReady(dbFromEnv(), recipes, input);
  console.log(`[step] persisted recipe=${recipeId} job=${input.jobId}`);
}
persistStep.maxRetries = 3;

/** Record the terminal failure. The workflow itself never throws. */
async function markFailed(jobId: string, code: string): Promise<void> {
  "use step";
  console.log(`[step] mark-failed job=${jobId} code=${code}`);
  await ImportJobRepository.create(dbFromEnv()).setTerminal(jobId, { status: "failed", progress: 100, errorCode: code });
}

/** Proof-only one-shot fault gate (persisted in `progress` so it survives a retry). */
async function bumpAndCheckFault(jobId: string): Promise<boolean> {
  const db = dbFromEnv();
  const [row] = await db.select({ progress: importJobs.progress }).from(importJobs).where(eq(importJobs.id, jobId));
  if ((row?.progress ?? 0) >= 11) return false;
  await ImportJobRepository.create(db).setRunning(jobId, 11);
  return true;
}

/** A usable recipe or a permanent NO_RECIPE. */
function requireRecipe(data: ExtractedRecipeData): ExtractedRecipeData {
  if (!hasRecipe(data)) throw new FatalError("NO_RECIPE");
  return data;
}

/** Whether the material has media to escalate to when a caption yields no steps. */
function hasMediaFallback(material: Material): boolean {
  return Boolean(material.videoUrl || material.imageRef || material.imageUrls?.length);
}

/** Feature the post's cover as the thumbnail when the parse found none. */
function withThumbnail(data: ExtractedRecipeData, thumbnailUrl?: string): ExtractedRecipeData {
  return data.imageUrl || !thumbnailUrl ? data : { ...data, imageUrl: thumbnailUrl };
}
