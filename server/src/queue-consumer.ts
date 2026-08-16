import { startImport } from "./start-import.js";
import { IMPORT_TOPIC } from "./import-service.js";
import type { ImportInput } from "./import-domain.js";

/**
 * Nitro plugin: the Vercel Queues consumer. Nitro delivers every message on the
 * declared `import-intake` topic (nitro.config.ts → vercel.queues.triggers) to the
 * `vercel:queue` runtime hook. This is the intake → Queue → consumer → workflow
 * hop. The consumer starts the durable workflow idempotently (a redelivery whose
 * job has already advanced is a no-op) and rethrows a transient failure so the
 * queue redelivers, up to its retry limit, then to the dead-letter queue.
 *
 * A Nitro plugin is any `(nitro) => void`; `defineNitroPlugin` is just an identity
 * wrapper (unavailable as an import here), so we export the bare function.
 */
type QueueHook = { message: unknown; metadata: { topicName: string; deliveryCount: number } };
type NitroApp = { hooks: { hook: (name: string, fn: (arg: QueueHook) => unknown) => void } };

export default (nitro: NitroApp) => {
  nitro.hooks.hook("vercel:queue", async ({ message, metadata }) => {
    if (metadata.topicName !== IMPORT_TOPIC) return;
    const msg = message as ImportInput;
    console.log(`[queue] start job=${msg.jobId} delivery=${metadata.deliveryCount}`);
    const started = await startImport(msg);
    console.log(`[queue] job=${msg.jobId} ${started ? "workflow started" : "no-op (already advanced)"}`);
  });
};
