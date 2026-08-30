import 'dotenv/config'; // load PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET from .env

import { SpectrumSender } from '../src/imessage/sender.js';

/**
 * Q-5 discovery smoke check: run Spectrum automatic discovery and log the line it
 * resolves for the Photon project. If discovery returns no usable line, Jordan must
 * provision a dedicated/Business line before the manual round-trip (AC-9).
 *
 * Run with: `npx tsx scripts/spectrum-discover.ts` — this makes a real network call,
 * so it is NOT run in the offline test phase.
 */
async function main() {
  await SpectrumSender.create();
  console.log('[spectrum-discover] done — see the line log above.');
}

main().catch((err) => {
  console.error('[spectrum-discover] failed:', err);
  process.exit(1);
});
