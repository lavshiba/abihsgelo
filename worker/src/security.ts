import { scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { normalizePassword } from "@abihsgelo/shared";

export const LEGACY_PASSWORD_HASH_SCHEME = "scrypt_v1";
export const PASSWORD_HASH_SCHEME = "pbkdf2_sha256_v1";
const PBKDF2_ITERATIONS = 150_000;

export async function hashPassword(password: string, salt: string, pepper: string): Promise<string> {
  return hashPasswordWithScheme(password, salt, pepper, PASSWORD_HASH_SCHEME);
}

export async function hashPasswordWithScheme(password: string, salt: string, pepper: string, scheme: string): Promise<string> {
  if (scheme === LEGACY_PASSWORD_HASH_SCHEME) {
    return hashPasswordLegacy(password, salt, pepper);
  }

  return hashPasswordPbkdf2(password, salt, pepper);
}

export async function verifyPassword(password: string, salt: string, pepper: string, expectedHash: string, scheme: string | null | undefined): Promise<boolean> {
  const normalizedScheme = scheme?.trim() || LEGACY_PASSWORD_HASH_SCHEME;
  const hash = await hashPasswordWithScheme(password, salt, pepper, normalizedScheme);
  return hash === expectedHash;
}

async function hashPasswordLegacy(password: string, salt: string, pepper: string): Promise<string> {
  const normalized = normalizePassword(password);
  const bytes = await scryptAsync(utf8ToBytes(`${normalized}:${pepper}`), hexToBytes(salt), {
    N: 1 << 15,
    r: 8,
    p: 1,
    dkLen: 32
  });
  return bytesToHex(bytes);
}

async function hashPasswordPbkdf2(password: string, salt: string, pepper: string): Promise<string> {
  const normalized = normalizePassword(password);
  const input = toArrayBuffer(utf8ToBytes(`${normalized}:${pepper}`));
  const importedKey = await crypto.subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: toArrayBuffer(hexToBytes(salt)),
    iterations: PBKDF2_ITERATIONS
  }, importedKey, 256);

  return bytesToHex(new Uint8Array(derivedBits));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function randomHex(bytes = 16): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function hashToken(token: string, secret: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${token}:${secret}`)));
}
