import { Spectrum, UnsupportedError, app, reaction, reply, richlink, text } from '@spectrum-ts/core';
import type { SpectrumInstance } from '@spectrum-ts/core';
import { effect, imessage, nativeContactCard } from '@spectrum-ts/imessage';

/** The screen effects Chef uses (WI-4B): confetti on greeting, fireworks on onboarding-complete.
 *  A key of the provider's `effect.message` map, resolved to a bundle-id at send. */
export type MessageEffect = 'confetti' | 'fireworks';

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
  /** Send one bubble carrying a native iMessage screen effect (WI-4B) — confetti/fireworks.
   *  @returns the sent message's platform id(s), via `normalizeSentIds`. */
  sendEffect(chatGuid: string, body: string, effectName: MessageEffect): Promise<string[]>;
  /** Send a turn's bubbles as a THREADED reply to `targetPlatformId`, in order. Falls back to a
   *  normal (un-threaded) send if the target message can't be resolved, so it still delivers.
   *  @returns the sent messages' platform ids, in send order (one per bubble). */
  sendReply(chatGuid: string, targetPlatformId: string, bodies: string[]): Promise<string[]>;
  /** Send a URL as a rich link (iMessage unfurls it into a native preview card). Threads it to
   *  `threadParentId` when given, falling back to an un-threaded send if the parent can't resolve.
   *  @returns the sent message's platform id(s). */
  sendLink(chatGuid: string, url: string, threadParentId?: string): Promise<string[]>;
  /** Send `url` as a live iMessage app card (`app(url, {live:true})`) — a native, tappable balloon
   *  that renders the page inline for recipients with the Spectrum app, degrading to a caption/link
   *  otherwise (docs/spikes/photon-app-recipe-card.md). Threads to `threadParentId` when given.
   *  @returns the sent message's platform id(s). */
  sendRecipeCard(chatGuid: string, url: string, threadParentId?: string): Promise<string[]>;
  /** React to `targetPlatformId` with a native tapback (`emoji` is the glyph). No-op if the target
   *  message can't be resolved — a tapback with no resolvable target can't be sent. */
  sendReaction(chatGuid: string, targetPlatformId: string, emoji: string): Promise<void>;
  /** Rename the chat (WI-4C) — group chats only. iMessage `rename` throws on a 1:1 DM, so this
   *  guards on `space.type` and no-ops on a DM. Fire-and-forget; called once after household creation. */
  renameChat(chatGuid: string, name: string): Promise<void>;
  /** Send Chef's native contact card (WI-4C) — `space.send(nativeContactCard())`, sharing the line's
   *  own Apple-account name/photo. Fire-and-forget; called once after the onboarding fireworks. */
  sendContactCard(chatGuid: string): Promise<void>;
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
   * Sends one bubble carrying a native screen effect (WI-4B) — `space.send(effect(text(body),
   * this.im.effect.message.<name>))`, where the map resolves the key to Apple's effect bundle-id.
   * Used only for the confetti greeting and the fireworks onboarding-complete moment.
   *
   * @returns the sent message's platform id(s), via {@link normalizeSentIds}.
   */
  async sendEffect(chatGuid: string, body: string, effectName: MessageEffect): Promise<string[]> {
    const space = await this.im.space.get(chatGuid);
    // The effect-name → bundle-id map lives on the `imessage` module const, not the bound instance.
    const sent = await space.send(effect(text(body), imessage.effect.message[effectName]));
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
   * Sends `url` as a live app card — `app(url, {live:true})`, threaded to `threadParentId` via
   * `reply(...)` when it resolves (mirrors {@link sendLink}). Delivered natively regardless; the
   * live mini-app UI only draws for recipients with the Spectrum app installed.
   *
   * @returns the sent message's platform id(s), via {@link normalizeSentIds}.
   */
  async sendRecipeCard(chatGuid: string, url: string, threadParentId?: string): Promise<string[]> {
    const space = await this.im.space.get(chatGuid);
    const target = threadParentId ? await space.getMessage(threadParentId) : undefined;
    const card = app(url, { live: true });
    const content = target ? reply(card, target) : card;
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

  /**
   * Renames the chat (WI-4C) — iMessage `rename` is group-only, so a 1:1 DM throws
   * `UnsupportedError`. Guards on the resolved space's `type` (the iMessage platform space
   * carries `type: 'dm' | 'group'`) and no-ops on a DM; the `UnsupportedError` catch is a
   * defensive backstop so the turn never crashes even if the guard is wrong.
   */
  async renameChat(chatGuid: string, name: string): Promise<void> {
    const space = await this.im.space.get(chatGuid);
    if (space.type !== 'group') return; // 1:1 DM — rename would throw; no-op (spec AC2)
    try {
      await space.rename(name);
    } catch (err) {
      if (err instanceof UnsupportedError) return; // belt-and-braces; a DM never reaches here
      throw err;
    }
  }

  /** Sends Chef's native contact card (WI-4C) — `space.send(nativeContactCard())`, which shares the
   *  line's own Apple-account name/photo. Works on DMs and groups. Fire-and-forget. */
  async sendContactCard(chatGuid: string): Promise<void> {
    const space = await this.im.space.get(chatGuid);
    await space.send(nativeContactCard());
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
  /** `sendRecipeCard` calls, with the resolved target (null when un-threaded or the parent didn't resolve). */
  readonly recipeCardCalls: { chatGuid: string; url: string; target: string | null }[] = [];
  /** `sendReaction` calls that resolved a target (an unresolvable target no-ops, recording nothing). */
  readonly reactionCalls: { chatGuid: string; target: string; emoji: string }[] = [];
  /** `sendEffect` calls (WI-4B) — the bubble body and which screen effect it carried. */
  readonly effectCalls: { chatGuid: string; body: string; effectName: MessageEffect }[] = [];
  /** `renameChat` calls that actually renamed (a DM no-ops, recording nothing — spec AC2). */
  readonly renameCalls: { chatGuid: string; name: string }[] = [];
  /** `sendContactCard` calls (WI-4C). */
  readonly contactCardCalls: { chatGuid: string }[] = [];
  readonly reads: string[] = [];
  respondingCount = 0;

  /** The space type `renameChat` guards on: `'group'` renames, `'dm'` no-ops (mirrors the live
   *  `space.type` guard). Defaults to a group so the rename path is exercised by default. */
  spaceType: 'dm' | 'group' = 'group';

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

  async sendEffect(chatGuid: string, body: string, effectName: MessageEffect): Promise<string[]> {
    this.effectCalls.push({ chatGuid, body, effectName });
    return this.sendReturn ?? ['ext-0'];
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

  async sendRecipeCard(chatGuid: string, url: string, threadParentId?: string): Promise<string[]> {
    const target = threadParentId && !this.missingTargets.has(threadParentId) ? threadParentId : null;
    this.recipeCardCalls.push({ chatGuid, url, target });
    return this.sendReturn ?? ['ext-0'];
  }

  async sendReaction(chatGuid: string, targetPlatformId: string, emoji: string): Promise<void> {
    if (this.missingTargets.has(targetPlatformId)) return; // unresolvable target no-ops (spec AC2)
    this.reactionCalls.push({ chatGuid, target: targetPlatformId, emoji });
  }

  async renameChat(chatGuid: string, name: string): Promise<void> {
    if (this.spaceType !== 'group') return; // DM no-ops without throwing (spec AC2)
    this.renameCalls.push({ chatGuid, name });
  }

  async sendContactCard(chatGuid: string): Promise<void> {
    this.contactCardCalls.push({ chatGuid });
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
