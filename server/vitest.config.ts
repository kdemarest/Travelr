import { defineConfig } from "vitest/config";
import path from "node:path";

// Change to project root before any imports happen
// This ensures Paths.dataRoot = process.cwd() resolves to the correct location
process.chdir(path.resolve(__dirname, ".."));

export default defineConfig({
  test: {
    include: ["server/src/**/*.test.ts", "server/dist/**/*.test.js"],
  },
});
