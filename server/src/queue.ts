import { QueueClient } from "@vercel/queue";

/**
 * The Vercel Queue client, configured for both local `vercel dev` and a real
 * deployment. On a deployment, `VERCEL_DEPLOYMENT_ID` pins sends to the current
 * deployment; locally that env is absent, so we opt out of deployment pinning
 * (`deploymentId: null`) and fix the region — otherwise `send()` throws "No
 * deployment ID available". The topic→consumer binding lives in vercel.json.
 */
const client = new QueueClient({
  region: "iad1",
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
});

export const { send, handleCallback } = client;
