const crypto = require("crypto");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateSecret(bytes = 20) {
  const data = crypto.randomBytes(bytes);
  let bits = "";
  for (const byte of data) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i < bits.length; i += 5) output += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return output;
}

function totp(secret, timestamp = Date.now()) {
  const key = Buffer.from(base32Decode(secret));
  const counter = Math.floor(timestamp / 1000 / 30);
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(code).padStart(6, "0");
}

function verifyTotp(secret, code, timestamp = Date.now()) {
  const normalized = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  return [-1, 0, 1].some((window) => crypto.timingSafeEqual(Buffer.from(totp(secret, timestamp + window * 30000)), Buffer.from(normalized)));
}

function encrypt(secret, encryptionKey) {
  const key = crypto.createHash("sha256").update(String(encryptionKey)).digest();
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decrypt(value, encryptionKey) {
  const [ivRaw, tagRaw, dataRaw] = String(value).split(".");
  const key = crypto.createHash("sha256").update(String(encryptionKey)).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
}

function otpauthUri(secret, email) { return `otpauth://totp/DependencyScanner:${encodeURIComponent(email)}?secret=${secret}&issuer=DependencyScanner&algorithm=SHA1&digits=6&period=30`; }

function base32Decode(value) {
  const clean = String(value).replace(/=+$/, "").toUpperCase(); let bits = "";
  for (const char of clean) { const index = ALPHABET.indexOf(char); if (index < 0) throw new Error("Invalid MFA secret"); bits += index.toString(2).padStart(5, "0"); }
  const bytes=[]; for (let i=0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(bytes);
}

module.exports = { decrypt, encrypt, generateSecret, otpauthUri, totp, verifyTotp };
