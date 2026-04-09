import { scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { normalizePassword } from "@abihsgelo/shared";

export const LEGACY_PASSWORD_HASH_SCHEME = "scrypt_v1";
export const PASSWORD_HASH_SCHEME = "sha256_v1";

export async function hashPassword(password: string, salt: string, pepper: string): Promise<string> {
  return hashPasswordWithScheme(password, salt, pepper, PASSWORD_HASH_SCHEME);
}

export async function hashPasswordWithScheme(password: string, salt: string, pepper: string, scheme: string): Promise<string> {
  if (scheme === PASSWORD_HASH_SCHEME) {
    return hashPasswordCurrent(password, salt, pepper);
  }

  return hashPasswordLegacy(password, salt, pepper);
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

async function hashPasswordCurrent(password: string, salt: string, pepper: string): Promise<string> {
  const normalized = normalizePassword(password);
  return bytesToHex(sha256(utf8ToBytes(`${salt}:${normalized}:${pepper}`)));
}

export function randomHex(bytes = 16): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function hashToken(token: string, secret: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${token}:${secret}`)));
}
