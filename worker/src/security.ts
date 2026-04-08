import { scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { normalizePassword } from "@abihsgelo/shared";

export async function hashPassword(password: string, salt: string, pepper: string): Promise<string> {
  const normalized = normalizePassword(password);
  const bytes = await scryptAsync(utf8ToBytes(`${normalized}:${pepper}`), hexToBytes(salt), {
    N: 1 << 15,
    r: 8,
    p: 1,
    dkLen: 32
  });
  return bytesToHex(bytes);
}

export function randomHex(bytes = 16): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function hashToken(token: string, secret: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${token}:${secret}`)));
}
