import { z } from 'zod';

// Load .env into process.env for local dev; real env vars (prod, CI) win since
// loadEnvFile never overwrites. Skipped under test — vitest provides a controlled
// env and the offline stubs depend on APIFY_TOKEN/GROQ_API_KEY staying unset.
if (process.env.NODE_ENV !== 'test') {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — rely on the ambient environment.
  }
}

/**
 * A required non-empty string schema. Same "is required" message whether the var is missing or empty.
 * @param name - env var name, interpolated into the error message.
 */
const requiredUrl = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: requiredUrl('DATABASE_URL'),
  // Separate Postgres database for the DBOS system tables (workflow/step state).
  DBOS_SYSTEM_DATABASE_URL: requiredUrl('DBOS_SYSTEM_DATABASE_URL'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  // Apify API token (optional). Present → real ApifyFetcher; absent → stub.
  APIFY_TOKEN: z.string().optional(),
  // Groq API key (optional). Present → real ASR/vision/extraction; absent → stubs.
  GROQ_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env` against the schema at startup.
 * @returns the typed, defaulted env config.
 * On any validation failure, writes the issues to stderr and exits the process with code 1 (never returns).
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

export const env: Env = loadEnv();
