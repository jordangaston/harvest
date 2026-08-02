import { describe, it, expect } from 'vitest';
import { parseEnv, envSchema } from './env.js';

describe('parseEnv (TC-5)', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/harvest',
    DBOS_SYSTEM_DATABASE_URL: 'postgresql://u:p@localhost:5432/harvest_dbos',
  };

  it('parses a valid env and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces PORT from a string', () => {
    expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('throws naming DATABASE_URL when it is missing', () => {
    expect(() => parseEnv({ DBOS_SYSTEM_DATABASE_URL: valid.DBOS_SYSTEM_DATABASE_URL })).toThrow(
      /DATABASE_URL is required/,
    );
  });

  it('reports a clear "required" message for a missing var, not Zod default', () => {
    const result = envSchema.safeParse({ DBOS_SYSTEM_DATABASE_URL: valid.DBOS_SYSTEM_DATABASE_URL });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0].message;
    expect(message).toBe('DATABASE_URL is required');
  });

  it('throws naming DBOS_SYSTEM_DATABASE_URL when it is missing', () => {
    expect(() => parseEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(
      /DBOS_SYSTEM_DATABASE_URL/,
    );
  });
});
