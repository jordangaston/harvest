import { createGrpcClient } from '@photon-ai/advanced-imessage/grpc';
import type { AdvancedIMessage } from '@photon-ai/advanced-imessage/grpc';

/**
 * The @photon-ai/advanced-imessage gRPC client for our Free/shared line — the one
 * chokepoint the poll send tool (WI-2) and the vote worker (WI-3) build on.
 *
 * On the shared plan the client is built exactly as @spectrum-ts/imessage builds it
 * internally (createCloudClients → shared branch): a gRPC client at the shared
 * address, authenticated with a bearer token minted from the project creds. Spectrum's
 * own SDK enriches poll metadata off a webhook that never delivers votes on shared,
 * so we go straight to the raw advanced client — see docs/imessage-polls-design.md.
 */

const TOKENS_HOST = 'https://spectrum.photon.codes';
const DEFAULT_ADDRESS = 'imessage.spectrum.photon.codes:443';
/** Re-mint when fewer than this many ms of the ~900s TTL remain. */
const REFRESH_MARGIN_MS = 60_000;

interface SharedTokenResponse {
  succeed: boolean;
  data: { type: string; token: string; expiresIn: number };
}

/** The project creds, read at build time so a missing var fails loudly before any RPC. */
function requireCreds(): { projectId: string; projectSecret: string } {
  const projectId = process.env.PHOTON_PROJECT_ID;
  const projectSecret = process.env.PHOTON_PROJECT_SECRET;
  if (!projectId) throw new Error('PHOTON_PROJECT_ID is not set — cannot mint an iMessage token');
  if (!projectSecret) throw new Error('PHOTON_PROJECT_SECRET is not set — cannot mint an iMessage token');
  return { projectId, projectSecret };
}

/**
 * Mints a shared-line bearer token via `POST /projects/{id}/imessage/tokens`, authed with
 * HTTP Basic `base64(projectId:projectSecret)`. Returns the token and when it expires (ms epoch).
 * @throws if the endpoint doesn't return `{succeed:true, data.token}`.
 */
export async function mintSharedToken(
  projectId: string,
  projectSecret: string,
): Promise<{ token: string; expiresAt: number }> {
  const basic = Buffer.from(`${projectId}:${projectSecret}`).toString('base64');
  const res = await fetch(`${TOKENS_HOST}/projects/${projectId}/imessage/tokens`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'content-type': 'application/json' },
  });
  const body = (await res.json()) as SharedTokenResponse;
  if (!body?.succeed || !body.data?.token) {
    throw new Error(`iMessage token mint failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  console.log(`[imessage] shared token minted: type=${body.data.type} ttl=${body.data.expiresIn}s`);
  return { token: body.data.token, expiresAt: Date.now() + body.data.expiresIn * 1000 };
}

/**
 * Builds the shared-line advanced iMessage gRPC client. The `token` fn caches the minted
 * token and re-mints when it's within {@link REFRESH_MARGIN_MS} of expiry — the SDK's own
 * renewer is internal, so this is the minimal equivalent for a standalone client.
 *
 * @throws if `PHOTON_PROJECT_ID`/`PHOTON_PROJECT_SECRET` are missing (before any network call).
 */
export function createAdvancedClient(): AdvancedIMessage {
  const { projectId, projectSecret } = requireCreds();
  const address = process.env.SPECTRUM_IMESSAGE_ADDRESS ?? DEFAULT_ADDRESS;

  let cached: { token: string; expiresAt: number } | undefined;
  const token = async (): Promise<string> => {
    if (!cached || cached.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
      cached = await mintSharedToken(projectId, projectSecret);
    }
    return cached.token;
  };

  return createGrpcClient({ address, token, tls: true, retry: true, autoIdempotency: true });
}
