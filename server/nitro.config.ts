import { defineConfig } from "nitro";
import { fileURLToPath } from "node:url";

// Pin rolldown's tsconfig to this project's own. Without this, rolldown's TS
// resolver walks up to the repo-root Expo tsconfig (`extends: expo/tsconfig.base`,
// which isn't installed in this worktree) and fails every resolve with "Tsconfig
// not found". The server is a self-contained sub-project, so it uses its own.
const tsconfig = fileURLToPath(new URL("./tsconfig.json", import.meta.url));

export default defineConfig({
  modules: ["workflow/nitro"],
  routes: {
    "/**": "./src/index.ts",
  },
  plugins: ["./src/queue-consumer.ts"],
  rolldownConfig: {
    tsconfig,
    resolve: { tsconfigFilename: tsconfig },
  },
  // Nitro-native Vercel Queues: declare the intake topic. Nitro writes the
  // `experimentalTriggers` into the built consumer function and delivers each
  // message to the `vercel:queue` runtime hook (see plugins/queues.ts). This is
  // the Nitro way — a manual vercel.json `functions` trigger targets the
  // web-accessible catch-all, which Nitro warns against.
  vercel: {
    queues: {
      triggers: [{ topic: "import-intake" }, { topic: "inbound-messages" }],
    },
  },
});
