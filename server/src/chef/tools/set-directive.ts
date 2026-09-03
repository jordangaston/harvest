import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { FactTypeRegistry } from '../facts/fact-types.js';
import { writeFact } from '../facts/write-fact.js';
import type { Subject } from '../facts/fact-type.js';
import type { ChefTool, TurnContext } from './types.js';

const inputSchema = z.object({
  dimension: z.enum(['cuisine', 'dish_type', 'ingredient', 'food_category', 'nutrient']),
  value: z.string(),
  direction: z.enum(['more', 'less']),
  scope: z.enum(['recipe', 'breakfast', 'lunch', 'dinner', 'snack', 'day', 'week']).optional(),
  strength: z.enum(['soft', 'firm', 'strict']).optional(),
  target: z.number().optional(),
  unit: z.string().optional(),
  reason: z.string().optional(),
  member_user_id: z.string().optional(),
});

/** One directive to ground + persist: a dimension, a loose value, and the enum/aggregate modifiers. */
type SetDirectiveInput = z.infer<typeof inputSchema>;

/** The directive's verdict, echoing the dimension/value the model tried. */
type SetDirectiveResult =
  | { status: 'set'; dimension: string; value: string }
  | { status: 'rejected'; reason: string; missing?: string[]; closest?: string[] };

/**
 * Persists one composite food directive: grounds `value` against the dimension's catalog (nutrient,
 * cuisine, dish_type, ingredient, food_category), validates the `scope`/`direction`/`strength` enums,
 * and writes the whole row through the `SET_DIRECTIVE` fact type — the single validate→persist
 * chokepoint. This is the composite write `update_facts` can't express (one grounded value per key).
 * Member-scoped: targets the named member, or the only member when there's exactly one.
 */
export class SetDirectiveTool implements ChefTool {
  readonly id = 'set_directive';

  private readonly db: Database;
  private readonly factTypes: FactTypeRegistry;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.db = db;
    this.factTypes = FactTypeRegistry.create(db);
  }

  static create(ctx: TurnContext, db: Database): SetDirectiveTool {
    return new SetDirectiveTool(ctx, db);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Record one member food directive: how much they want of a cuisine, dish type, ingredient, ' +
        'food category, or nutrient. A like is direction:more, a dislike direction:less. An aggregate ' +
        'limit (e.g. "≤20g saturated fat a day") uses scope:day|week with target + unit; strict makes ' +
        'it a filter. Grounds the value against the dimension\'s catalog before writing.',
      inputSchema,
      execute: async (input) => this.run(input),
    });
  }

  async run(input: SetDirectiveInput): Promise<SetDirectiveResult> {
    const { member_user_id, ...directive } = input;
    const subject = this.subjectFor(member_user_id);
    if (!subject) return { status: 'rejected', reason: 'set_directive needs a member to write to' };

    const type = this.factTypes.get('SET_DIRECTIVE')!;
    const res = await writeFact(type, subject, directive, this.db);
    if (res.ok) return { status: 'set', dimension: directive.dimension, value: directive.value };
    return { status: 'rejected', reason: res.reason, missing: res.missing, closest: res.closest };
  }

  /** The member a directive writes to: the named member, or the only one when unambiguous. */
  private subjectFor(memberUserId?: string): Subject | null {
    const userId = memberUserId ?? (this.ctx.members.length === 1 ? this.ctx.members[0]!.userId : undefined);
    return userId ? { scope: 'member', userId } : null;
  }
}
