import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { FactRegistry } from '../facts/registry.js';
import { writeFact } from '../facts/write-fact.js';
import type { Subject } from '../facts/fact-type.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({
  updates: z.array(z.object({ key: z.string(), value: z.unknown(), member_user_id: z.string().optional() })),
});

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
  readonly saved: SaveResult[] = [];

  private constructor(private readonly ctx: TurnContext) {}

  static create(ctx: TurnContext): UpdateFactsTool {
    return new UpdateFactsTool(ctx);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Record a fact the household mentioned that no current objective task is asking for. Pass ' +
        'updates:[{ key, value, member_user_id? }] (member_user_id for a member-scoped fact). Advances ' +
        'no task. Use `update_tasks` instead for anything the active objective is asking about.',
      inputSchema,
      execute: async ({ updates }) => this.run(updates),
    });
  }

  async run(updates: { key: string; value: unknown; member_user_id?: string }[]): Promise<{ results: FactWriteResult[] }> {
    const results: FactWriteResult[] = [];
    for (const u of updates) results.push(await this.writeOne(u));
    return { results };
  }

  private async writeOne({ key, value, member_user_id }: { key: string; value: unknown; member_user_id?: string }): Promise<FactWriteResult> {
    const def = FactRegistry.get(key);
    if (!def) return { key, status: 'rejected', reason: `unknown fact "${key}"` };
    if (def.access === 'derived') return { key, status: 'rejected', reason: `${key} is derived/read-only` };

    const type = this.ctx.factTypes.get(def.factType);
    if (!type) return { key, status: 'rejected', reason: `no fact type for "${key}"` };

    const subject = this.subjectFor(def.scope, member_user_id);
    if (!subject) return { key, status: 'rejected', reason: `${key} needs a household or member to write to` };

    const res = await writeFact(type, subject, value, this.ctx.db);
    if (res.ok) { this.saved.push({ saved: { [key]: res.value }, rejected: [] }); return { key, status: 'filled' }; }
    return { key, status: 'rejected', reason: res.reason, missing: res.missing, closest: res.closest };
  }

  /** The subject a fact writes to: the turn's household, or the named/only member for a member fact. */
  private subjectFor(scope: 'household' | 'member', memberUserId?: string): Subject | null {
    if (scope === 'household') return this.ctx.householdId ? { scope: 'household', householdId: this.ctx.householdId } : null;
    const userId = memberUserId ?? (this.ctx.members.length === 1 ? this.ctx.members[0]!.userId : undefined);
    return userId ? { scope: 'member', userId } : null;
  }
}
