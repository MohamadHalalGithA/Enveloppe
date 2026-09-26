import { defineConfig } from "vitest/config";

// `npm test`       → fast offline unit tests (tests/unit).
// `npm run test:live` → real Gemini calls on synthetic letters (tests/live). Costs a few cents.
export default defineConfig(({ mode }) => {
  const live = mode === "live";
  return {
    resolve: {
      alias: {
        "@": import.meta.dirname,
        // Next.js enforces server-only at build time; in tests it's a no-op.
        "server-only": `${import.meta.dirname}/tests/stubs/server-only.ts`,
      },
    },
    test: {
      environment: "node",
      include: live ? ["tests/live/**/*.test.ts"] : ["tests/unit/**/*.test.ts"],
      testTimeout: live ? 180_000 : 5_000,
      fileParallelism: !live,
    },
  };
});
