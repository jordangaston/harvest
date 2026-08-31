import { eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { imessageImport } from '../schema.js';
import { ImessageImportSchema, type ImessageImport } from '../models/imessage-import.js';

/**
 * Data access for `imessage_import` — the link between a started import job and the Chef
 * thread it originated from (WI-2A). `insert` records the origin; `findByJobId` resolves it
 * (parsed at the boundary); `markNotified` stamps the WI-2B completion reply.
 */
export class ImessageImportRepository {
  constructor(private readonly db: Database) {}

  static create(db: Database) {
    return new ImessageImportRepository(db);
  }

  /** Records that `jobId`'s import came from `threadId`, carrying the trigger link's platform id. */
  async insert(input: { jobId: string; threadId: string; targetExternalId: string | null }): Promise<void> {
    await this.db.insert(imessageImport).values(input);
  }

  /** The origin link for a job, parsed into the domain model, or null when the import wasn't from iMessage. */
  async findByJobId(jobId: string): Promise<ImessageImport | null> {
    const [row] = await this.db.select().from(imessageImport).where(eq(imessageImport.jobId, jobId));
    return row ? ImessageImportSchema.parse(row) : null;
  }

  /** Stamps the completion reply (WI-2B), so a job is notified at most once. */
  async markNotified(jobId: string, at: Date): Promise<void> {
    await this.db.update(imessageImport).set({ notifiedAt: at }).where(eq(imessageImport.jobId, jobId));
  }
}
