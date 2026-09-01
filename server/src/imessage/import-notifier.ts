import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { ImessageImportRepository } from '../repositories/imessage-import-repository.js';
import { ImportJobRepository } from '../repositories/import-job-repository.js';
import { RecipeRepository } from '../repositories/recipe-repository.js';
import { CookbookRepository } from '../repositories/cookbook-repository.js';
import { ThreadRepository } from '../repositories/thread-repository.js';
import { selectSender, type Sender } from './sender.js';

/** The terminal outcome the import reached — a `ready` save or a `failed` apology. */
export type ImportOutcome = 'ready' | 'failed';

/**
 * Notifies the iMessage thread an import came from when it finishes: on `ready`, saves the
 * recipe(s) to the user's Liked cookbook and replies naming the recipe; on `failed`, replies
 * with an apology. A job with no `imessage_import` link (a mobile import) is a no-op, and a
 * job already notified is a no-op — so the import workflow can call this on every terminal
 * transition without gating on the source.
 *
 * ponytail: the workflow → iMessage-notifier call is an accepted, guarded coupling (no-op for
 * non-iMessage). Ceiling: if decoupling matters, emit a terminal domain event and move this
 * behind its own consumer.
 */
export class ImportNotifier {
  private readonly imports: ImessageImportRepository;
  private readonly jobs: ImportJobRepository;
  private readonly recipes: RecipeRepository;
  private readonly cookbooks: CookbookRepository;
  private readonly threads: ThreadRepository;

  constructor(
    private readonly db: Database,
    private readonly sender: Sender,
  ) {
    this.imports = ImessageImportRepository.create(db);
    this.jobs = ImportJobRepository.create(db);
    this.recipes = RecipeRepository.create(db);
    this.cookbooks = CookbookRepository.create(db);
    this.threads = ThreadRepository.create(db);
  }

  /** Wires the notifier against the caller's db and the env-selected sender (stub in tests). */
  static async create(db: Database, sender?: Sender): Promise<ImportNotifier> {
    return new ImportNotifier(db, sender ?? (await selectSender()));
  }

  /**
   * Replies to the import's origin thread and, on `ready`, saves its recipes to Liked.
   * No-op unless the job has an un-notified `imessage_import` link. `markNotified` is the LAST
   * action, so a mid-notify crash re-runs cleanly: the Liked save is `onConflictDoNothing` and the
   * send is guarded by the (still-null) `notified_at` gate — both replay-safe until stamped.
   */
  async notify(jobId: string, outcome: ImportOutcome): Promise<void> {
    const link = await this.imports.findByJobId(jobId);
    if (!link || link.notifiedAt) return;

    const body = outcome === 'ready' ? await this.saveAndCompose(jobId) : FAILURE_MESSAGE;
    await this.send(link.threadId, body, link.targetExternalId);
    await this.imports.markNotified(jobId, new Date());
  }

  /** Saves the job's recipes to the owner's Liked cookbook and composes the success message. */
  private async saveAndCompose(jobId: string): Promise<string> {
    const userId = await this.jobs.userIdById(jobId);
    const recipeIds = await this.jobs.findRecipeIds(jobId);
    if (!userId || recipeIds.length === 0) return FAILURE_MESSAGE;

    const cookbookId = await this.cookbooks.ensureSystemCookbook(userId, 'liked', 'Liked');
    for (const recipeId of recipeIds) await this.cookbooks.addRecipe(userId, cookbookId, recipeId);

    if (recipeIds.length > 1) return `Saved ${recipeIds.length} recipes to your Liked cookbook.`;
    const title = await this.recipes.titleById(recipeIds[0]!);
    return `Saved "${title}" to your Liked cookbook.`;
  }

  /**
   * Direct-sends one message to the thread (mirrors the consumer's send: insert → send → stamp).
   * When `threadParentId` is set, the confirmation goes out as a threaded reply to that message and
   * the parent is recorded on the outbound row (symmetry with inbound); else it's a plain send.
   */
  private async send(threadId: string, body: string, threadParentId?: string | null): Promise<void> {
    const thread = await this.threads.findById(threadId);
    if (!thread) return;

    const messageGuid = randomUUID();
    await this.threads.insertOutbound({ threadId, body, messageGuid, targetGuid: threadParentId });
    const [row] = (await this.threads.loadUnsentOutbound(threadId)).filter((r) => r.messageGuid === messageGuid);
    if (!row) return;

    const [id] = threadParentId
      ? await this.sender.sendReply(thread.chatGuid, threadParentId, [body])
      : await this.sender.send(thread.chatGuid, [body]);
    await this.threads.markSent(row.id, new Date());
    if (id) await this.threads.setExternalId(row.id, id);
  }
}

const FAILURE_MESSAGE = "I couldn't save that recipe — we're looking into it.";
