import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DBOS_SYSTEM_DATABASE_URL: z.string().min(1, 'DBOS_SYSTEM_DATABASE_URL is required'),
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
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    process.stderr.write(`Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }
  return result.data;
}

export const env: Env = process.env.VITEST ? ({} as Env) : loadEnv();
