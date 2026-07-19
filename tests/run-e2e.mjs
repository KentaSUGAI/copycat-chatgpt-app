import { spawn } from "node:child_process";

const port = process.env.TEST_PORT || "8791";
const base = `http://127.0.0.1:${port}`;
const wranglerBin = process.platform === "win32"
  ? "node_modules/.bin/wrangler.cmd"
  : "node_modules/.bin/wrangler";

const worker = spawn(wranglerBin, ["dev", "--port", port], {
  cwd: process.cwd(),
  env: { ...process.env, WRANGLER_LOG: "none" },
  stdio: ["ignore", "pipe", "pipe"],
});

let workerOutput = "";
for (const stream of [worker.stdout, worker.stderr]) {
  stream.on("data", (chunk) => {
    workerOutput += chunk.toString();
    if (workerOutput.length > 12000) workerOutput = workerOutput.slice(-12000);
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(`Wrangler exited before becoming ready.\n${workerOutput}`);
    }
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      // The local server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${base}.\n${workerOutput}`);
}

function stopWorker() {
  if (worker.exitCode === null) worker.kill("SIGTERM");
}

process.on("SIGINT", () => {
  stopWorker();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopWorker();
  process.exit(143);
});

try {
  await waitUntilReady();
  const test = spawn(process.execPath, ["tests/e2e.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, TEST_BASE: base },
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    test.once("error", reject);
    test.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stopWorker();
}
