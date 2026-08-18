import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("local server serves the app at the root path", async (t) => {
  const port = 31000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  t.after(() => server.kill());

  let response;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  assert.ok(response, "server did not start");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Sparkbox/);

  const aiResponse = await fetch(`http://127.0.0.1:${port}/api/ai/organize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookmark: { title: "Test" }, projects: [] }),
  });
  assert.equal(aiResponse.status, 503);
  assert.match((await aiResponse.json()).error, /DEEPSEEK_API_KEY/);
});
