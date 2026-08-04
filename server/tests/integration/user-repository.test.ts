import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, pool } from '../../src/db/index.js';
import { users } from '../../src/db/schema/index.js';
import { UserRepository } from '../../src/repositories/user-repository.js';

const repo = UserRepository.create();

beforeEach(async () => {
  await db.delete(users);
});
afterAll(async () => {
  await pool.end();
});

describe('UserRepository', () => {
  it('inserts and finds by phone and id; parses into the domain model', async () => {
    const created = await repo.insert({ phone: '+15555550001', jwtPrivateKey: 'priv', jwtPublicKey: 'pub' });
    expect(created.phone).toBe('+15555550001');
    expect(created.accessTokenNonce).toBe(0);
    expect(created.createdAt).toBeInstanceOf(Date);

    expect((await repo.findByPhone('+15555550001'))?.id).toBe(created.id);
    expect((await repo.findById(created.id))?.phone).toBe('+15555550001');
    expect(await repo.findByPhone('+10000000000')).toBeNull();
  });

  it('bumpNonce increments the nonce', async () => {
    const u = await repo.insert({ phone: '+15555550002', jwtPrivateKey: 'priv', jwtPublicKey: 'pub' });
    await repo.bumpNonce(u.id, 'access');
    await repo.bumpNonce(u.id, 'refresh');
    const after = await repo.findById(u.id);
    expect(after?.accessTokenNonce).toBe(1);
    expect(after?.refreshTokenNonce).toBe(1);
  });
});
