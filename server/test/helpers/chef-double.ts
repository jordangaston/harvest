import type { Chef, ChefReply, OutboundSink } from "../../src/imessage/chef.js";
import type { ChatEvent } from "../../src/chef/types.js";
import type { ConfirmTask } from "../../src/imessage/chef.js";

/** An in-memory `OutboundSink` that records the events sent through it — for RealChef unit tests
 *  that used to read `reply.chatEvents` (increment 2 sends live, so the events land in the sink). */
export class CollectingSink implements OutboundSink {
  readonly events: ChatEvent[] = [];
  async send(event: ChatEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * A test `Chef` that sends the given `chatEvents` live through the sink (mirroring how the real chef
 * drives its `send` tool), then returns the commit reply. `delivered` is derived from whether any
 * event was sent — matching the real chef. Use in consumer integration tests that used to return a
 * `chatEvents` array on the old `ChefReply`.
 */
export function sendingChef(
  chatEvents: ChatEvent[],
  reply: { confirmTasks: ConfirmTask[]; cursorTo: string | null; objectiveId: string; popped?: boolean },
): Chef {
  return {
    respond: async (_threadId: string, sink: OutboundSink): Promise<ChefReply> => {
      for (const event of chatEvents) await sink.send(event);
      return { ...reply, delivered: chatEvents.length > 0, popped: reply.popped ?? false };
    },
  };
}
