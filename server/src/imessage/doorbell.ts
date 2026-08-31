/** The inbound doorbell topic — a near-empty `{threadId}` message that wakes the
 * consumer. Coalesced per thread via `idempotencyKey = threadId`. */
export const INBOUND_TOPIC = "inbound-messages";

/** The doorbell payload: which thread has pending inbound to process. */
export type Doorbell = {
  threadId: string;
};
