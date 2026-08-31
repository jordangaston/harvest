import { z } from 'zod';

// Domain model for the iMessage-origin link of an import (WI-2A). Ties a started import
// job back to the Chef thread it came from; `targetExternalId` is the triggering link
// message's Spectrum id, `notifiedAt` set once WI-2B replies on completion.
export const ImessageImportSchema = z.object({
  jobId: z.string().uuid(),
  threadId: z.string().uuid(),
  targetExternalId: z.string().nullable(),
  notifiedAt: z.date().nullable(),
  createdAt: z.date(),
});

export type ImessageImport = z.infer<typeof ImessageImportSchema>;
