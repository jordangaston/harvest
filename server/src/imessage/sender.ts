import { Spectrum, reaction, reply, richlink, text } from '@spectrum-ts/core';
import type { SpectrumInstance } from '@spectrum-ts/core';
import { imessage } from '@spectrum-ts/imessage';

/** Binds the imessage provider to a Spectrum app instance — pins the app-instance
 * overload of `imessage()` (it is also overloaded for a space/message argument). */
function buildProvider(app: SpectrumInstance) {
  return imessage(app);
}

/** Sends outbound iMessage text via Spectrum, resolved outside any request scope. */
export interface Sender {
  /** Send a turn's bubbles as ONE ordered batch (so iMessage can't reorder them).
   *  @returns the sent messages' Spectrum platform ids, in send order (one per bubble). */
  send(chatGuid: string, bodies: string[]): Promise<string[]>;
  /** Send a turn's bubbles as a THREADED reply to `targetPlatformId`, in order. Falls back to a
   *  normal (un-threaded) send if the target message can't be resolved, so it still delivers.
   *  @returns the sent messages' platform ids, in send order (one per bubble). */
  sendReply(chatGuid: string, targetPlatformId: string, bodies: string[]): Promise<string[]>;
  /** Send a URL as a rich link (iMessage unfurls it into a native preview card). Threads it to
   *  `threadParentId` when given, falling back to an un-threaded send if the parent can't resolve.
   *  @returns the sent message's platform id(s). */
  sendLink(chatGuid: string, url: string, threadParentId?: string): Promise<string[]>;
  /** React to `targetPlatformId` with a native tapback (`emoji` is the glyph). No-op if the target
   *  message can't be resolved — a tapback with no resolvable target can't be sent. */
  sendReaction(chatGuid: string, targetPlatformId: string, emoji: string): Promise<void>;
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
   *
   * @returns the sent messages' platform ids in send order. Confirmed against @spectrum-ts/core:
   * `send(...content)` returns `Message[]` for a batch (≥2, in input order) and `Message | undefined`
   * for a single content; each `Message` carries a `.id`. Normalized to an id array here.
   */
  async send(chatGuid: string, bodies: string[]): Promise<string[]> {
    if (bodies.length === 0) return [];
    const space = await this.im.space.get(chatGuid);
    const contents = bodies.map((b) => text(b));
    // The SDK types the variadic send for ≥2 args, so call it generically (works for 1 or many).
    const sent = await (space.send as (...c: unknown[]) => Promise<unknown>)(...contents);
    return normalizeSentIds(sent);
  }

  /**
   * Sends the bodies as a threaded reply to `targetPlatformId` — resolves the parent via
   * `space.getMessage`, then batches `reply(text(body), target)` bubbles through the same
   * ordered variadic `send` as {@link send}. If the parent can't be resolved (undefined), falls
   * back to a plain `text` batch so the message still delivers un-threaded (spec AC2).
   *
   * @returns the sent messages' platform ids in send order (one per bubble).
   */
  async sendReply(chatGuid: string, targetPlatformId: string, bodies: string[]): Promise<string[]> {
    if (bodies.length === 0) return [];
    const space = await this.im.space.get(chatGuid);
    const target = await space.getMessage(targetPlatformId);
    const contents = bodies.map((b) => (target ? reply(text(b), target) : text(b)));
    const sent = await (space.send as (...c: unknown[]) => Promise<unknown>)(...contents);
    return normalizeSentIds(sent);
  }

  /**
   * Sends `url` as a rich link — Spectrum carries only the URL and iMessage unfurls it into a
   * native preview card (presentation is OG-driven, no SDK knob). Threads it to `threadParentId`
   * via `space.getMessage` + `reply(richlink(url), target)`; if the parent can't be resolved,
   * sends the link un-threaded so it still delivers (mirrors {@link sendReply}).
   *
   * @returns the sent message's platform id(s), via {@link normalizeSentIds}.
   */
  async sendLink(chatGuid: string, url: string, threadParentId?: string): Promise<string[]> {
    const space = await this.im.space.get(chatGuid);
    const target = threadParentId ? await space.getMessage(threadParentId) : undefined;
    const content = target ? reply(richlink(url), target) : richlink(url);
    const sent = await (space.send as (...c: unknown[]) => Promise<unknown>)(content);
    return normalizeSentIds(sent);
  }

  /**
   * Reacts to `targetPlatformId` with a native tapback — resolves the target via `space.getMessage`,
   * then `space.send(reaction(emoji, target))`. If the target can't be resolved (undefined), no-ops:
   * a tapback has no un-threaded fallback (unlike sendReply), so it's simply dropped (spec AC2).
   */
  async sendReaction(chatGuid: string, targetPlatformId: string, emoji: string): Promise<void> {
    const space = await this.im.space.get(chatGuid);
    const target = await space.getMessage(targetPlatformId);
    if (!target) return;
    await space.send(reaction(emoji, target));
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

/** Normalizes a Spectrum `send` result (`Message | Message[] | undefined`) to a platform-id
 *  array in send order — a batch returns `Message[]`, a single content `Message | undefined`. */
function normalizeSentIds(sent: unknown): string[] {
  const messages = Array.isArray(sent) ? sent : sent ? [sent] : [];
  return messages.map((m) => (m as { id: string }).id);
}

/** Records sends without touching the network — the offline test double. */
export class StubSpectrumSender implements Sender {
  readonly calls: { chatGuid: string; body: string }[] = [];
  /** `sendReply` calls, with the resolved target (null when the parent didn't resolve → fallback). */
  readonly replyCalls: { chatGuid: string; target: string | null; body: string }[] = [];
  /** `sendLink` calls, with the resolved target (null when un-threaded or the parent didn't resolve). */
  readonly linkCalls: { chatGuid: string; url: string; target: string | null }[] = [];
  /** `sendReaction` calls that resolved a target (an unresolvable target no-ops, recording nothing). */
  readonly reactionCalls: { chatGuid: string; target: string; emoji: string }[] = [];
  readonly reads: string[] = [];
  respondingCount = 0;

  /** Synthetic platform ids in send order (`ext-0`, `ext-1`, …), or override `sendReturn` to
   *  simulate a degraded return (fewer ids than bubbles, or none). */
  sendReturn?: string[];

  /** Target ids that `sendReply` should treat as unresolvable (mirrors `getMessage` → undefined),
   *  so tests can drive the graceful-fallback path. Empty ⇒ every target resolves. */
  readonly missingTargets = new Set<string>();

  async send(chatGuid: string, bodies: string[]): Promise<string[]> {
    for (const body of bodies) this.calls.push({ chatGuid, body });
    return this.sendReturn ?? bodies.map((_, i) => `ext-${i}`);
  }

  async sendReply(chatGuid: string, targetPlatformId: string, bodies: string[]): Promise<string[]> {
    const target = this.missingTargets.has(targetPlatformId) ? null : targetPlatformId;
    for (const body of bodies) this.replyCalls.push({ chatGuid, target, body });
    return this.sendReturn ?? bodies.map((_, i) => `ext-${i}`);
  }

  async sendLink(chatGuid: string, url: string, threadParentId?: string): Promise<string[]> {
    const target = threadParentId && !this.missingTargets.has(threadParentId) ? threadParentId : null;
    this.linkCalls.push({ chatGuid, url, target });
    return this.sendReturn ?? ['ext-0'];
  }

  async sendReaction(chatGuid: string, targetPlatformId: string, emoji: string): Promise<void> {
    if (this.missingTargets.has(targetPlatformId)) return; // unresolvable target no-ops (spec AC2)
    this.reactionCalls.push({ chatGuid, target: targetPlatformId, emoji });
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
