#!/usr/bin/env node
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "index.js");

const proc = spawn("bun", [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

proc.on("error", (err) => {
  if (err.code === "ENOENT") {
    process.stderr.write(
      "error: turbocsv requires the Bun runtime\n" +
        "  install: curl -fsSL https://bun.sh/install | bash\n" +
        "  docs:    https://bun.sh\n"
    );
  } else {
    process.stderr.write(`error: ${err.message}\n`);
  }
  process.exit(1);
});

proc.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
