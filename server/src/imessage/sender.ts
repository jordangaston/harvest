import { Spectrum, text } from '@spectrum-ts/core';
import type { SpectrumInstance } from '@spectrum-ts/core';
import { imessage } from '@spectrum-ts/imessage';

/** Binds the imessage provider to a Spectrum app instance — pins the app-instance
 * overload of `imessage()` (it is also overloaded for a space/message argument). */
function buildProvider(app: SpectrumInstance) {
  return imessage(app);
}

/** Sends outbound iMessage text via Spectrum, resolved outside any request scope. */
export interface Sender {
  /** Send a turn's bubbles as ONE ordered batch (so iMessage can't reorder them). */
  send(chatGuid: string, bodies: string[]): Promise<void>;
  /** Send read receipts for the given inbound message guids (fire-and-forget). */
  markRead(chatGuid: string, messageGuids: string[]): Promise<void>;
  /** Run `fn` with the typing indicator shown, cleared when it settles (even on throw). */
  responding<T>(chatGuid: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Live Spectrum sender. `create()` does automatic line discovery from the project
 * creds; `send` resolves the space by chat_guid and sends a text builder.
 */
export class SpectrumSender implements Sender {
  private constructor(private readonly im: ReturnType<typeof buildProvider>) {}

  /**
   * Discovers the Spectrum app from project creds and binds the imessage provider.
   * Logs the discovered line info (Q-5: warn if it looks empty).
   */
  static async create(): Promise<SpectrumSender> {
    const app = await Spectrum({
      projectId: process.env.PHOTON_PROJECT_ID!,
      projectSecret: process.env.PHOTON_PROJECT_SECRET!,
      providers: [imessage.config()],
      webhookSecret: process.env.SPECTRUM_WEBHOOK_SECRET,
    });
    // Q-5: the SDK resolves the iMessage line internally, so we log the project it
    // discovered rather than a raw line address; a missing project is a hard warning.
    if (app.config?.slug) console.log(`[imessage] Spectrum line discovered for project=${app.config.slug}`);
    else console.warn('[imessage] Spectrum discovery returned no project config — no line to send from');
    return new SpectrumSender(buildProvider(app));
  }

  /**
   * Sends a turn's bubbles to the space identified by chat_guid as ONE ordered batch —
   * Spectrum's variadic `send(a, b, …)` sequences them server-side, so they arrive in order.
   * A rapid-fire loop of single sends lets iMessage reorder them (the bug this fixes).
   * ponytail: no send-idempotency key exists in the SDK — outbound idempotency is the
   * `sent_at` gate. A crash between the batch resolving and the sent_at write can double-send
   * the whole batch on redelivery (documented increment-1 ceiling).
   */
  async send(chatGuid: string, bodies: string[]): Promise<void> {
    if (bodies.length === 0) return;
    const space = await this.im.space.get(chatGuid);
    const contents = bodies.map((b) => text(b));
    // The SDK types the variadic send for ≥2 args, so call it generically (works for 1 or many).
    await (space.send as (...c: unknown[]) => Promise<unknown>)(...contents);
  }

  // ponytail: each of send/markRead/responding resolves the space via space.get; a turn
  // does 2-3 resolves. Fine at turn frequency; fold into one resolve if it ever matters.
  async markRead(chatGuid: string, messageGuids: string[]): Promise<void> {
    const space = await this.im.space.get(chatGuid);
    for (const guid of messageGuids) {
      const msg = await space.getMessage(guid);
      await msg?.read(); // fire-and-forget, best-effort (dedicated lines only); inbound only
    }
  }

  async responding<T>(chatGuid: string, fn: () => Promise<T>): Promise<T> {
    const space = await this.im.space.get(chatGuid);
    return space.responding(fn); // typing on → run fn → typing off
  }
}

/** Records sends without touching the network — the offline test double. */
export class StubSpectrumSender implements Sender {
  readonly calls: { chatGuid: string; body: string }[] = [];
  readonly reads: string[] = [];
  respondingCount = 0;

  async send(chatGuid: string, bodies: string[]): Promise<void> {
    for (const body of bodies) this.calls.push({ chatGuid, body });
  }

  async markRead(_chatGuid: string, messageGuids: string[]): Promise<void> {
    this.reads.push(...messageGuids);
  }

  async responding<T>(_chatGuid: string, fn: () => Promise<T>): Promise<T> {
    this.respondingCount += 1;
    return fn();
  }
}

/**
 * The sender for the current env: the live Spectrum sender when project creds are
 * present, else the offline stub (mirrors selectExtractor()).
 */
export async function selectSender(): Promise<Sender> {
  if (process.env.PHOTON_PROJECT_ID && process.env.PHOTON_PROJECT_SECRET) return SpectrumSender.create();
  return new StubSpectrumSender();
}
