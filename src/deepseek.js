export async function deepSeekChat({ messages, params = {}, env = process.env, fetchImpl = fetch }) {
  const apiKey = env.DEEPSEEK_API_KEY;
  const baseUrl = (env.DEEPSEEK_API_BASE || "https://api.deepseek.com").replace(/\/$/, "");
  const model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  if (!apiKey) throw Object.assign(new Error("DeepSeek API 尚未配置，请设置 DEEPSEEK_API_KEY。"), { status: 503 });

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: false, response_format: { type: "json_object" }, thinking: { type: "disabled" }, ...params }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `DeepSeek API 请求失败：${response.status}`;
    throw Object.assign(new Error(message), { status: response.status >= 400 && response.status < 500 ? response.status : 502 });
  }
  if (typeof body?.choices?.[0]?.message?.content !== "string") throw Object.assign(new Error("DeepSeek API 返回格式不正确"), { status: 502 });
  return body;
}
