import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { FactRegistry } from '../facts/registry.js';
import { FactTypeRegistry } from '../facts/fact-types.js';
import { writeFact, retractFact } from '../facts/write-fact.js';
import type { Subject } from '../facts/fact-type.js';
import type { ChefTool, TurnContext } from './types.js';

const inputSchema = z.object({
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.unknown(),
      member_user_id: z.string().optional(),
      op: z.enum(['set', 'remove']).optional(),
    }),
  ),
});

/** One out-of-band fact write: a registry key, its value, an optional target member, and whether to
 *  set (default) or remove the value. */
type FactWriteInput = { key: string; value: unknown; member_user_id?: string; op?: 'set' | 'remove' };

/** One out-of-band write's verdict, echoing the key. */
interface FactWriteResult {
  key: string;
  status: 'filled' | 'rejected';
  reason?: string;
  missing?: string[];
  closest?: string[];
}

/**
 * Records facts no active-objective task tracks — the model heard something worth keeping (a member's
 * allergy, a store) outside the current objective. Resolves each key → its `FactType`, rejects a
 * `derived`/read-only fact, and routes through `writeFact` (the single validate→persist chokepoint).
 * Advances no task. Passes `ctx.db` (never a tx) so repo-backed persists self-transact.
 */
export class UpdateFactsTool implements ChefTool {
  readonly id = 'update_facts';

  private readonly db: Database;
  private readonly factTypes: FactTypeRegistry;
  private readonly factRegistry: FactRegistry;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.db = db;
    this.factTypes = FactTypeRegistry.create(db);
    this.factRegistry = FactRegistry.create();
  }

  static create(ctx: TurnContext, db: Database): UpdateFactsTool {
    return new UpdateFactsTool(ctx, db);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Record a fact the household volunteers that no active task is asking for — a member\'s allergy, ' +
        'a store they like. `member_user_id` targets a member-scoped fact (omit it when there is only one ' +
        'member). Set op:"remove" with the value to retract a previously recorded value when they correct ' +
        'or narrow it ("actually just peanuts", "I like avocado now"). Advances no task; for anything a ' +
        'task is asking about, use update_tasks. Returns filled/rejected per key, with reason and closest values.',
      inputSchema,
      execute: async ({ updates }) => this.run(updates),
    });
  }

  async run(updates: FactWriteInput[]): Promise<{ results: FactWriteResult[] }> {
    const results: FactWriteResult[] = [];
    for (const u of updates) results.push(await this.writeOne(u));
    return { results };
  }

  private async writeOne({ key, value, member_user_id, op }: FactWriteInput): Promise<FactWriteResult> {
    // Forgiving: accept the key or the type name, any case/plurality. Echo the CANONICAL key back so
    // the model converges on it. `unknown fact` keeps the raw input — there's no canonical form to show.
    const def = this.factRegistry.resolve(key);
    if (!def) return { key, status: 'rejected', reason: `unknown fact "${key}"` };
    if (def.access === 'derived') return { key: def.key, status: 'rejected', reason: `${def.key} is derived/read-only` };

    const type = this.factTypes.get(def.factType);
    if (!type) return { key: def.key, status: 'rejected', reason: `no fact type for "${def.key}"` };

    const subject = this.subjectFor(def.scope, member_user_id);
    if (!subject) return { key: def.key, status: 'rejected', reason: `${def.key} needs a household or member to write to` };

    const res = op === 'remove' ? await retractFact(type, subject, value, this.db) : await writeFact(type, subject, value, this.db);
    if (res.ok) return { key: def.key, status: 'filled' };
    return { key: def.key, status: 'rejected', reason: res.reason, missing: res.missing, closest: res.closest };
  }

  /** The subject a fact writes to: the turn's household, or the named/only member for a member fact. */
  private subjectFor(scope: 'household' | 'member', memberUserId?: string): Subject | null {
    if (scope === 'household') return this.ctx.householdId ? { scope: 'household', householdId: this.ctx.householdId } : null;
    const userId = memberUserId ?? (this.ctx.members.length === 1 ? this.ctx.members[0]!.userId : undefined);
    return userId ? { scope: 'member', userId } : null;
  }
}
