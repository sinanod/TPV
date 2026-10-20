import path from "path";
import { defineConfig } from "vitest/config";

const testDb = `file:${path.join(__dirname, "prisma", "test.db")}`;

export default defineConfig({
  test: {
    env: { DATABASE_URL: testDb, TZ: "Europe/Madrid", PRINT_AGENT_TOKEN: "test-agent-token" },
    globalSetup: ["./test/globalSetup.ts"],
    fileParallelism: false,
  },
});
