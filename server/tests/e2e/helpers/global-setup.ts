import { spawn, type ChildProcess } from "node:child_process";
import { openSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";

/**
 * Vitest global setup for the live e2e tier. Boots ONE `vercel dev` for the whole
 * suite (loading .env.local so the real providers + Turso creds are present),
 * resets the Turso dev database to the generated schema so every run starts clean,
 * waits for /healthz, and tears the dev server down afterwards.
 *
 * The heavy import work (scrape + ffmpeg + Groq per URL) happens inside this one
 * dev server; the tests just drive it over HTTP via the compat harness.
 */

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

/** Parse .env.local into a plain object (KEY=VALUE, `#` comments, no interpolation). */
function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(resolve(SERVER_DIR, ".env.local"), "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

/** Drop every app table, then apply the generated DDL — a clean slate per run. */
async function resetDatabase(env: Record<string, string>): Promise<void> {
  const url = env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL missing from .env.local");
  const client = createClient({ url, authToken: env.TURSO_AUTH_TOKEN });

  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'",
  );
  for (const row of tables.rows) {
    await client.execute(`DROP TABLE IF EXISTS \`${row.name as string}\``);
  }

  const sqlFile = readdirSync(resolve(SERVER_DIR, "drizzle")).find((f) => f.endsWith(".sql"));
  if (!sqlFile) throw new Error("no drizzle/*.sql — run `npm run db:generate`");
  await client.executeMultiple(readFileSync(resolve(SERVER_DIR, "drizzle", sqlFile), "utf8"));
  client.close();
}

/** Poll /healthz until the dev server answers or we give up. */
async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`vercel dev did not become healthy within ${timeoutMs}ms`);
}

let devServer: ChildProcess | undefined;

export async function setup(): Promise<void> {
  const envLocal = loadEnvLocal();
  // `vercel dev` mints and refreshes its own short-lived VERCEL_OIDC_TOKEN (the
  // Queue API auth); the one saved in .env.local expires within hours. Passing the
  // stale value would override the fresh one and 401 every `send()`, so drop it
  // and let the CLI own it.
  delete envLocal.VERCEL_OIDC_TOKEN;
  const env = { ...process.env, ...envLocal };
  // Surface the provider creds to the test process too (the beforeAll guards
  // read process.env.APIFY_TOKEN / GROQ_API_KEY).
  Object.assign(process.env, envLocal);
  process.env.E2E_BASE_URL = BASE_URL;

  await resetDatabase(envLocal);

  const logPath = process.env.E2E_DEV_LOG;
  const out = logPath ? openSync(logPath, "a") : "inherit";
  devServer = spawn("vercel", ["dev", "--listen", String(PORT), "--yes"], {
    cwd: SERVER_DIR,
    env,
    stdio: ["ignore", out, out],
  });

  await waitForHealth(120_000);
}

export async function teardown(): Promise<void> {
  if (!devServer) return;
  devServer.kill("SIGTERM");
  // vercel dev spawns nitro under it; free the port so a rerun can rebind.
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const { execSync } = await import("node:child_process");
    execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: "ignore" });
  } catch {
    /* nothing left on the port */
  }
}
