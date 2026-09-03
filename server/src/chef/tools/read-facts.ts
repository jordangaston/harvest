import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { FactRegistry, type FactDef } from '../facts/registry.js';
import { FactTypeRegistry } from '../facts/fact-types.js';
import type { Subject } from '../facts/fact-type.js';
import type { ChefTool, TurnContext } from './types.js';

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

  private readonly factTypes: FactTypeRegistry;
  private readonly factRegistry: FactRegistry;

  private constructor(private readonly ctx: TurnContext, db: Database) {
    this.factTypes = FactTypeRegistry.create(db);
    this.factRegistry = FactRegistry.create();
  }

  static create(ctx: TurnContext, db: Database): ReadFactsTool {
    return new ReadFactsTool(ctx, db);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        'Recall what the household has already told you, so you never ask twice. Pass `keys` to read ' +
        'specific facts, or omit to read them all. Returns { facts: [{ key, value, known }] }, ' +
        'member-scoped facts repeated per member (`known` is false when nothing is on file). Reads only.',
      inputSchema,
      execute: async ({ keys }) => this.run(keys),
    });
  }

  async run(keys?: string[]): Promise<{ facts: FactReading[] }> {
    const defs = keys ? keys.map((k) => this.factRegistry.get(k)).filter((d): d is FactDef => !!d) : this.factRegistry.list();
    const readings: FactReading[] = [];
    for (const def of defs) readings.push(...(await this.readDef(def)));
    return { facts: readings };
  }

  /** Reads one def against its subject(s): the household once, or every member individually. */
  private async readDef(def: FactDef): Promise<FactReading[]> {
    const type = this.factTypes.get(def.factType);
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
