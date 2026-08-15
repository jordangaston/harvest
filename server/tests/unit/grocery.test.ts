import { describe, it, expect } from 'vitest';
import { GroceryCatalog } from '../../src/grocery/catalog.js';
import { GroceryService, type AddGroceryItem } from '../../src/services/grocery-service.js';
import { GroceryRepository, type InsertGroceryItem } from '../../src/repositories/grocery-repository.js';
import type { GroceryItem } from '../../src/models/grocery-item.js';

// An in-memory GroceryRepository so the service's add/merge logic is tested without a DB.
function fakeRepo() {
  const items: GroceryItem[] = [];
  let seq = 0;
  const repo = {
    async findMergeCandidate(userId: string, name: string, unit: string | null) {
      return items.find(
        (i) => i.userId === userId && i.name.toLowerCase() === name.toLowerCase() && i.unit === unit && i.amount !== null,
      );
    },
    async addAmount(id: string, delta: number) {
      const item = items.find((i) => i.id === id)!;
      item.amount = (item.amount ?? 0) + delta;
      return item;
    },
    async insert(userId: string, item: InsertGroceryItem) {
      const row: GroceryItem = {
        id: `it-${seq++}`,
        userId,
        name: item.name,
        amount: item.amount,
        unit: item.unit,
        quantityText: item.quantityText,
        aisle: item.aisle,
        icon: item.icon,
        checked: false,
        sourceRecipeId: item.sourceRecipeId,
        position: 0,
        createdAt: new Date(),
      };
      items.push(row);
      return row;
    },
  };
  return { repo: repo as unknown as GroceryRepository, items };
}

function service() {
  const { repo, items } = fakeRepo();
  return { svc: new GroceryService(repo, GroceryCatalog.create()), items };
}

describe('GroceryCatalog.resolve', () => {
  const catalog = GroceryCatalog.create();
  it('routes any phrasing through the icon taxonomy to an aisle', () => {
    expect(catalog.resolve('2 boneless chicken thighs')).toMatchObject({ aisle: 'meat_seafood', iconKey: 'chicken' });
    expect(catalog.resolve('fresh strawberries')).toMatchObject({ aisle: 'produce', iconKey: 'strawberry' });
  });
  it('falls back to other + default for an unknown ingredient', () => {
    expect(catalog.resolve('unobtainium powder')).toMatchObject({ aisle: 'other', iconKey: 'default', defaultUnit: 'count' });
  });
  it('common() filters by substring', () => {
    expect(catalog.common('apple').some((e) => e.canonicalName.includes('apple'))).toBe(true);
  });
});

describe('GroceryService.add', () => {
  it('applies the catalog default unit when a numeric amount has no unit', async () => {
    const { svc } = service();
    const [item] = await svc.add('u1', [{ name: 'flour', amount: 2 }]);
    expect(item!.unit).toBe('count'); // flour → pantry → default unit count
    expect(item!.aisle).toBe('pantry');
  });

  it('merges a re-added item with the same name + unit', async () => {
    const { svc, items } = service();
    await svc.add('u1', [{ name: 'Milk', amount: 1, unit: 'carton' }]);
    await svc.add('u1', [{ name: 'milk', amount: 2, unit: 'carton' }]);
    expect(items).toHaveLength(1);
    expect(items[0]!.amount).toBe(3);
  });

  it('keeps a separate line when units differ', async () => {
    const { svc, items } = service();
    await svc.add('u1', [{ name: 'soy sauce', amount: 1, unit: 'cup' }]);
    await svc.add('u1', [{ name: 'soy sauce', amount: 2, unit: 'tablespoon' }]);
    expect(items).toHaveLength(2);
  });

  it('never merges freeform (no-amount) rows and skips blank names', async () => {
    const { svc, items } = service();
    const added = await svc.add('u1', [
      { name: 'salt', quantityText: 'a pinch' },
      { name: 'salt', quantityText: 'a pinch' },
      { name: '   ' } as AddGroceryItem,
    ]);
    expect(added).toHaveLength(2);
    expect(items).toHaveLength(2);
    expect(items[0]!.amount).toBeNull();
  });
});
