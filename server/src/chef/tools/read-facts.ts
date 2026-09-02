import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { FactRegistry, type FactDef } from '../facts/registry.js';
import type { Subject } from '../facts/fact-type.js';
import type { ChefTool, SaveResult, TurnContext } from './types.js';

const inputSchema = z.object({ keys: z.array(z.string()).optional() });

/** One resolved fact: its key, the read value, and whether anything is known. A member-scoped fact
 *  reads once per member, so it carries the member it belongs to. */
interface FactReading {
  key: string;
  value: unknown;
  known: boolean;
  member_user_id?: string;
}

/**
 * Reads back known fact values so the model can recall what the household has already told it.
 * Household-scoped facts read the household subject; member-scoped facts read once per member in
 * the turn context. `keys` filters to those defs; absent reads every registered fact. Writes nothing.
 */
export class ReadFactsTool implements ChefTool {
  readonly id = 'read_facts';
  readonly saved: SaveResult[] = []; // reads never write

  private constructor(private readonly ctx: TurnContext) {}

  static create(ctx: TurnContext): ReadFactsTool {
    return new ReadFactsTool(ctx);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Recall facts the household has already given. Optionally pass `keys` to read only those; ' +
        'omit to read all. Returns { facts: [{ key, value, known }] } — member facts repeat per member.',
      inputSchema,
      execute: async ({ keys }) => this.run(keys),
    });
  }

  async run(keys?: string[]): Promise<{ facts: FactReading[] }> {
    const defs = keys ? keys.map((k) => FactRegistry.get(k)).filter((d): d is FactDef => !!d) : FactRegistry.list();
    const readings: FactReading[] = [];
    for (const def of defs) readings.push(...(await this.readDef(def)));
    return { facts: readings };
  }

  /** Reads one def against its subject(s): the household once, or every member individually. */
  private async readDef(def: FactDef): Promise<FactReading[]> {
    const type = this.ctx.factTypes.get(def.factType);
    if (!type) return [];
    if (def.scope === 'household') {
      if (!this.ctx.householdId) return [{ key: def.key, value: null, known: false }];
      const value = await type.read({ scope: 'household', householdId: this.ctx.householdId });
      return [{ key: def.key, value, known: isKnown(value) }];
    }
    return Promise.all(
      this.ctx.members.map(async (m) => {
        const subject: Subject = { scope: 'member', userId: m.userId };
        const value = await type.read(subject);
        return { key: def.key, value, known: isKnown(value), member_user_id: m.userId };
      }),
    );
  }
}

/** A fact is "known" when its read returns a non-null, non-empty value. */
function isKnown(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
