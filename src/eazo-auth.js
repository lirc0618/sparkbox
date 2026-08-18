import { createDecipheriv, createECDH, createHash } from "node:crypto";

function unauthorized(message) {
  return { ok: false, response: new Response(JSON.stringify({ error: message }), { status: 401, headers: { "Content-Type": "application/json" } }) };
}

export function requireAuth(request, privateKey = process.env.EAZO_PRIVATE_KEY) {
  const raw = request.headers.get("x-eazo-session");
  if (!raw) return unauthorized("Missing session");
  try {
    if (!/^[0-9a-f]{64}$/i.test(privateKey || "")) throw new Error("Invalid private key");
    const { encryptedData, encryptedKey, iv, authTag } = JSON.parse(raw);
    if (![encryptedData, encryptedKey, iv, authTag].every((value) => typeof value === "string" && value)) throw new Error("Incomplete session");

    const wrapped = Buffer.from(encryptedKey, "base64");
    const recipient = createECDH("secp256k1");
    recipient.setPrivateKey(Buffer.from(privateKey, "hex"));
    const wrappingKey = createHash("sha256").update(recipient.computeSecret(wrapped.subarray(0, 33))).digest();
    const keyDecipher = createDecipheriv("aes-256-cbc", wrappingKey, wrapped.subarray(33, 49));
    const aesKey = Buffer.concat([keyDecipher.update(wrapped.subarray(49)), keyDecipher.final()]);
    const dataDecipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(iv, "base64"));
    dataDecipher.setAuthTag(Buffer.from(authTag, "base64"));
    const user = JSON.parse(Buffer.concat([dataDecipher.update(Buffer.from(encryptedData, "base64")), dataDecipher.final()]).toString("utf8"));
    if (typeof user?.userId !== "string" || !user.userId) throw new Error("Invalid user");

    return { ok: true, user: { id: user.userId, email: user.email ?? null, name: user.nickname ?? null, avatarUrl: user.avatarUrl ?? null } };
  } catch {
    return unauthorized("Invalid session");
  }
}
