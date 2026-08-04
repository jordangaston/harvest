import type { SourceType } from '../db/schema/enums.js';

/** What the pipeline needs to import a job: the resolved source + its owner. */
export interface ImportInput {
  jobId: string;
  userId: string;
  sourceType: SourceType;
  sourceRef: string;
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
 * The import work — the concern the workflow drives, kept separate from it. It
 * turns a resolved source into a persisted recipe and returns the recipe id, or
 * throws an {@link ImportError}.
 *
 * WI-03 ships the skeleton: nothing is parseable yet, so it fails NO_RECIPE.
 * WI-05 decomposes `run` into fetch → transcribe → vision → extract → persist
 * DBOS steps, so a late failure re-runs only the failed stage.
 */
export class ImportPipeline {
  static create(): ImportPipeline {
    return new ImportPipeline();
  }

  async run(_input: ImportInput): Promise<string> {
    throw new ImportError('NO_RECIPE');
  }
}
