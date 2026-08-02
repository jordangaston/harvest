import { describe, it, expect } from 'vitest';
import { UserRepository, type DbExecutor } from './user-repository.js';
import { users, type User } from '../db/schema/users.js';

const SAMPLE: User = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  phone: '+15555550123',
  jwtPrivateKey: 'priv',
  jwtPublicKey: 'pub',
  accessTokenNonce: 0,
  refreshTokenNonce: 0,
  onboarding: null,
  createdAt: new Date(),
};

/** A structural stand-in for a Drizzle executor that records the operation and
 * arguments each method sees and returns a preset row from terminal calls. */
function fakeExecutor(returnRow: User | undefined) {
  const calls: { op: string; table?: unknown; values?: unknown; set?: unknown }[] = [];
  const rows = returnRow ? [returnRow] : [];

  const insert = (table: unknown) => {
    const rec: (typeof calls)[number] = { op: 'insert', table };
    calls.push(rec);
    return {
      values(values: unknown) {
        rec.values = values;
        return { returning: async () => rows };
      },
    };
  };
  const select = () => ({
    from: (table: unknown) => {
      const rec: (typeof calls)[number] = { op: 'select', table };
      calls.push(rec);
      return { where: async () => rows };
    },
  });
  const update = (table: unknown) => {
    const rec: (typeof calls)[number] = { op: 'update', table };
    calls.push(rec);
    return {
      set(set: unknown) {
        rec.set = set;
        return { where: () => ({ returning: async () => rows }) };
      },
    };
  };

  return { exec: { insert, select, update } as unknown as DbExecutor, calls };
}

function repoWith(returnRow: User | undefined) {
  const { exec, calls } = fakeExecutor(returnRow);
  // The base db is never used because every call passes tx=exec.
  const repo = new UserRepository({} as never);
  return { repo, exec, calls };
}

describe('UserRepository contract (AC-9)', () => {
  it('create inserts into users with the given fields and returns the row', async () => {
    const { repo, exec, calls } = repoWith(SAMPLE);
    const created = await repo.create(
      { phone: '+15555550123', jwtPrivateKey: 'priv', jwtPublicKey: 'pub', onboarding: { age: '25-34' } },
      exec,
    );
    expect(created).toEqual(SAMPLE);
    expect(calls[0].op).toBe('insert');
    expect(calls[0].table).toBe(users);
    expect(calls[0].values).toMatchObject({
      phone: '+15555550123',
      jwtPrivateKey: 'priv',
      jwtPublicKey: 'pub',
      onboarding: { age: '25-34' },
    });
  });

  it('create defaults onboarding to null when omitted', async () => {
    const { repo, exec, calls } = repoWith(SAMPLE);
    await repo.create({ phone: '+15555550123', jwtPrivateKey: 'priv', jwtPublicKey: 'pub' }, exec);
    expect((calls[0].values as { onboarding: unknown }).onboarding).toBeNull();
  });

  it('findByPhone selects from users and returns the row', async () => {
    const { repo, exec, calls } = repoWith(SAMPLE);
    const found = await repo.findByPhone('+15555550123', exec);
    expect(found).toEqual(SAMPLE);
    expect(calls[0].op).toBe('select');
    expect(calls[0].table).toBe(users);
  });

  it('findByPhone returns undefined when no row matches', async () => {
    const { repo, exec } = repoWith(undefined);
    expect(await repo.findByPhone('+15555550999', exec)).toBeUndefined();
  });

  it('findById returns the row', async () => {
    const { repo, exec } = repoWith(SAMPLE);
    expect(await repo.findById(SAMPLE.id, exec)).toEqual(SAMPLE);
  });

  it('bumpAccessNonce updates users.accessTokenNonce', async () => {
    const { repo, exec, calls } = repoWith(SAMPLE);
    await repo.bumpAccessNonce(SAMPLE.id, exec);
    expect(calls[0].op).toBe('update');
    expect(calls[0].table).toBe(users);
    expect(calls[0].set).toHaveProperty('accessTokenNonce');
  });

  it('bumpRefreshNonce updates users.refreshTokenNonce', async () => {
    const { repo, exec, calls } = repoWith(SAMPLE);
    await repo.bumpRefreshNonce(SAMPLE.id, exec);
    expect(calls[0].op).toBe('update');
    expect(calls[0].set).toHaveProperty('refreshTokenNonce');
  });
});
