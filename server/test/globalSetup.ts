import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export default function setup() {
  const file = path.join(__dirname, "..", "prisma", "test.db");
  fs.rmSync(file, { force: true });
  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, ".."),
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: `file:${file}` },
  });
}
