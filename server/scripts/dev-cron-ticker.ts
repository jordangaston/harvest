import { config } from 'dotenv';
config({ path: '.env.local' });
config();

/**
 * Local stand-in for the production Vercel cron (`vercel.json` crons → `/crons/dispatch`),
 * which never fires in dev: sweeps the dynamic cron jobs once a minute against the local
 * server. Run alongside `npm run dev`; Ctrl-C to stop.
 */
const base = `http://localhost:${process.env.PORT ?? '3100'}`;
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error('CRON_SECRET is not set — add it to server/.env');

for (;;) {
  try {
    const res = await fetch(`${base}/crons/dispatch`, { headers: { authorization: `Bearer ${secret}` } });
    console.log(`[tick] ${res.status} ${(await res.text()).trim()}`);
  } catch (e) {
    console.log(`[tick] server unreachable: ${(e as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 60_000));
}
