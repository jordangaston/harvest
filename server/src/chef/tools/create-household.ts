import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createSameKitchenHousehold } from '../objectives/onboarding-identity.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({
  members: z.array(z.object({ name: z.string() })).min(1),
});

/**
 * The "same kitchen" command. Creates the household from the named members — the first is the
 * person texting (initiator/owner, keyed by their handle); the rest are proxy members (name-only
 * until they text). Sets `ctx.householdId`/`ctx.members` in place so a later `save_*` this turn
 * sees the new household. Legal only until a household exists.
 */
export class CreateHouseholdTool implements ChefTool {
  readonly id = 'create_household';
  readonly saved: SaveResult[] = [];

  private constructor(private readonly ctx: TurnContext) {}

  static create(ctx: TurnContext): CreateHouseholdTool {
    return new CreateHouseholdTool(ctx);
  }

  canRun(): boolean {
    return !this.ctx.householdId;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Call once the people in the chat confirm they cook as one household. Pass the members by ' +
        'name — the first is the person texting. Creates the household so member profiles can be saved.',
      inputSchema,
      execute: async ({ members }) => this.run(members),
    });
  }

  async run(members: { name: string }[]): Promise<SaveResult> {
    if (this.ctx.householdId) return { saved: {}, rejected: [] }; // already created — no-op
    const participants = members.map((m, i) =>
      i === 0 ? { handle: this.ctx.initiatorHandle, name: m.name } : { name: m.name },
    );
    const { householdId, memberUserIds } = await createSameKitchenHousehold(this.ctx.db, {
      threadId: this.ctx.threadId,
      objectiveId: this.ctx.objectiveId,
      participants,
    });
    this.ctx.householdId = householdId;
    this.ctx.members = memberUserIds.map((userId) => ({ userId }));
    const result: SaveResult = { saved: { household: householdId, members: memberUserIds.length }, rejected: [] };
    this.saved.push(result);
    return result;
  }
}
