import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { SameKitchenFlow } from '../objectives/onboarding-identity.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({
  members: z.array(z.object({ name: z.string() })).min(1),
});

/**
 * Adds named members to the thread's household (created with the thread on first inbound). New
 * people only — a name already in the household is rejected so the chef can ask for a nickname. The
 * texter's own row is named on a brand-new household (listing themselves first); later names are
 * proxy members. Sets `ctx.members` in place so a tool built later this turn sees the roster.
 */
export class AddMembersTool implements ChefTool {
  readonly id = 'add_members';

  private constructor(private readonly ctx: TurnContext, private readonly db: Database) {}

  static create(ctx: TurnContext, db: Database): AddMembersTool {
    return new AddMembersTool(ctx, db);
  }

  canRun(): boolean {
    return this.ctx.householdId !== null;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Add members to the household by name. New people only — a name already in the household is ' +
        'rejected, so ask for a nickname and try again ("we\'ve already got a Jordan"). The person ' +
        'texting is added like anyone else; list them the first time you learn who cooks here.',
      inputSchema,
      execute: async ({ members }) => this.run(members),
    });
  }

  async run(members: { name: string }[]): Promise<SaveResult> {
    if (!this.ctx.householdId) return { saved: {}, rejected: [] }; // no household to add to — no-op
    const { results, addedUserIds } = await SameKitchenFlow.create(this.db).addMembers({
      householdId: this.ctx.householdId,
      initiatorUserId: this.ctx.initiatorUserId,
      objectiveId: this.ctx.objectiveId,
      names: members.map((m) => m.name),
    });
    const known = new Set(this.ctx.members.map((m) => m.userId));
    for (const userId of addedUserIds) if (!known.has(userId)) this.ctx.members.push({ userId });
    return {
      saved: { members_added: addedUserIds.length },
      rejected: results.filter((r) => r.status === 'rejected').map((r) => ({ input: r.name, reason: r.reason! })),
    };
  }
}
