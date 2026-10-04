import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // The same JSX transform as Next.js, without importing React in every file.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "mocks/**/*.test.ts"],
    // Logic runs in Node; a component test asks for a browser-like
    // environment with `// @vitest-environment jsdom` in its first line.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    // A component test clicks through a whole flow against the mock API;
    // on a busy machine that takes longer than the five seconds of the default.
    testTimeout: 20_000,
  },
});
