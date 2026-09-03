import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { ImportService } from '../../import-service.js';
import { classifySource } from '../../classify.js';
import { ImessageImportRepository } from '../../repositories/imessage-import-repository.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({ url: z.string() });

/**
 * The drop-a-recipe-link command. Classifies the URL, starts an import for the thread owner
 * through the existing ImportService, and records an `imessage_import` link so WI-2B can reply
 * on completion. A non-recipe URL is rejected synchronously (no job, no link). Legal whenever a
 * thread owner is known — importing isn't gated on onboarding.
 */
export class ImportRecipeTool implements ChefTool {
  readonly id = 'import_recipe';
  private readonly imports: ImportService;
  private readonly links: ImessageImportRepository;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.imports = ImportService.create(db);
    this.links = ImessageImportRepository.create(db);
  }

  static create(ctx: TurnContext, db: Database): ImportRecipeTool {
    return new ImportRecipeTool(ctx, db);
  }

  canRun(): boolean {
    return !!this.ctx.initiatorUserId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Start importing a recipe from a link the household dropped — Instagram, TikTok, YouTube, or a ' +
        'recipe site. Pass the `url`. It runs in the background and replies when it is done, so just ' +
        'acknowledge you are on it. Works anytime, not only during onboarding. Returns a job_id, or a ' +
        'rejection if the link is not a recipe.',
      inputSchema,
      execute: async ({ url }) => this.run(url),
    });
  }

  async run(url: string): Promise<SaveResult> {
    if (!classifySource({ url })) return { saved: {}, rejected: [{ input: url, reason: 'not a recipe link' }] };
    const job = await this.imports.create(this.ctx.initiatorUserId, { url });
    if (!job) return { saved: {}, rejected: [{ input: url, reason: 'not a recipe link' }] };
    await this.links.insert({ jobId: job.id, threadId: this.ctx.threadId, targetExternalId: this.ctx.triggerExternalId });
    return { saved: { job_id: job.id }, rejected: [] };
  }
}
