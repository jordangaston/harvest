import { z } from 'zod';

/** A required connection string. Reports the same "is required" message whether
 * the variable is missing or empty, so a missing var reads clearly rather than
 * as Zod's default "expected string, received undefined". */
const requiredUrl = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: requiredUrl('DATABASE_URL'),
  DBOS_SYSTEM_DATABASE_URL: requiredUrl('DBOS_SYSTEM_DATABASE_URL'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Pure parser: validates a raw env-like record and returns typed config.
 * Throws a ZodError on invalid input. Kept side-effect-free so tests can
 * exercise validation without touching process.env or exiting the process.
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  return envSchema.parse(raw);
}

/**
 * Loads and validates process.env at module load. On failure, prints the
 * offending variable(s) and exits non-zero so the process never boots into a
 * half-configured state.
 */
function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  process.stderr.write(`Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env: Env = process.env.VITEST ? ({} as Env) : loadEnv();
