import assert from "node:assert/strict";
import { createCipheriv, createECDH, createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { requireAuth } from "../src/eazo-auth.js";

function sessionFor(user, privateKey) {
  const recipient = createECDH("secp256k1");
  recipient.setPrivateKey(Buffer.from(privateKey, "hex"));
  const sender = createECDH("secp256k1");
  sender.generateKeys();
  const wrappingKey = createHash("sha256").update(sender.computeSecret(recipient.getPublicKey())).digest();
  const aesKey = randomBytes(32);
  const keyIv = randomBytes(16);
  const keyCipher = createCipheriv("aes-256-cbc", wrappingKey, keyIv);
  const encryptedKey = Buffer.concat([sender.getPublicKey(null, "compressed"), keyIv, keyCipher.update(aesKey), keyCipher.final()]);
  const iv = randomBytes(12);
  const dataCipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const encryptedData = Buffer.concat([dataCipher.update(JSON.stringify(user)), dataCipher.final()]);
  return { encryptedData: encryptedData.toString("base64"), encryptedKey: encryptedKey.toString("base64"), iv: iv.toString("base64"), authTag: dataCipher.getAuthTag().toString("base64") };
}

test("requireAuth verifies an Eazo encrypted session with Node crypto", () => {
  const recipient = createECDH("secp256k1");
  recipient.generateKeys();
  const privateKey = recipient.getPrivateKey("hex");
  const session = sessionFor({ userId: "user-1", email: "me@example.com", nickname: "Me" }, privateKey);
  const request = new Request("http://localhost", { headers: { "x-eazo-session": JSON.stringify(session) } });

  const result = requireAuth(request, privateKey);

  assert.equal(result.ok, true);
  assert.deepEqual(result.user, { id: "user-1", email: "me@example.com", name: "Me", avatarUrl: null });
});

test("requireAuth rejects a malformed session", () => {
  const request = new Request("http://localhost", { headers: { "x-eazo-session": "{}" } });
  assert.equal(requireAuth(request, "a".repeat(64)).ok, false);
});
