import assert from "node:assert/strict";
import test from "node:test";
import { deepSeekChat } from "../src/deepseek.js";

test("DeepSeek client sends authenticated JSON-output requests", async () => {
  let captured;
  const result = await deepSeekChat({
    messages: [{ role: "user", content: "return json" }],
    params: { max_tokens: 100 },
    env: { DEEPSEEK_API_KEY: "secret", DEEPSEEK_MODEL: "deepseek-v4-pro" },
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    },
  });

  assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
  assert.equal(captured.options.headers.Authorization, "Bearer secret");
  assert.equal(captured.body.model, "deepseek-v4-pro");
  assert.deepEqual(captured.body.response_format, { type: "json_object" });
  assert.deepEqual(captured.body.thinking, { type: "disabled" });
  assert.equal(result.choices[0].message.content, "{}");
});

test("DeepSeek client requires a server-side API key", async () => {
  await assert.rejects(() => deepSeekChat({ messages: [], env: {} }), /DEEPSEEK_API_KEY/);
});
