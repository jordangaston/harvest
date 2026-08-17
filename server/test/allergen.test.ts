import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratedFileDb } from './helpers/migrated-db.js';
import { mergePresence } from '../src/allergen/allergen.js';
import type { Client } from '@libsql/client';

describe('mergePresence (Test Case 1)', () => {
  it('lets contains win over may_contain in either order and is commutative', () => {
    expect(mergePresence('contains', 'contains')).toBe('contains');
    expect(mergePresence('contains', 'may_contain')).toBe('contains');
    expect(mergePresence('may_contain', 'contains')).toBe('contains');
    expect(mergePresence('may_contain', 'may_contain')).toBe('may_contain');
  });
});

describe('allergen migration (Test Case 2)', () => {
  let client: Client;
  let cleanup: () => void;

  beforeAll(async () => {
    ({ client, cleanup } = await migratedFileDb());
  });

  afterAll(() => cleanup());

  it('adds allergens + allergens_complete to recipes', async () => {
    const { rows } = await client.execute('PRAGMA table_info(recipes)');
    const names = rows.map((r) => r.name);
    expect(names).toContain('allergens');
    expect(names).toContain('allergens_complete');
  });

  it('creates fdc_food_allergen with its four columns', async () => {
    const { rows } = await client.execute('PRAGMA table_info(fdc_food_allergen)');
    const names = rows.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['fdc_id', 'allergen', 'presence', 'species']));
  });
});
