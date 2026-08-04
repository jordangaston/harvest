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
 * The import work — the concern the workflow drives, kept separate from it.
 * `run` turns a resolved source into a persisted recipe and returns the recipe
 * id, or throws an {@link ImportError}. It is a deterministic orchestrator: every
 * non-deterministic stage is a `@DBOS.step` (static, since DBOS requires it) that
 * `run` awaits, so the workflow only ever drives steps.
 *
 * WI-03 ships the skeleton: nothing is parseable yet, so it fails NO_RECIPE.
 * WI-05 adds the fetch → transcribe → vision → extract → persist steps, so a
 * late failure re-runs only the failed stage, not the network calls before it.
 */
export class ImportPipeline {
  static async run(_input: ImportInput): Promise<string> {
    throw new ImportError('NO_RECIPE');
  }
}
