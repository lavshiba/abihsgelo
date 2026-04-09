import { describe, expect, it } from "vitest";
import { LEGACY_PASSWORD_HASH_SCHEME, PASSWORD_HASH_SCHEME, TRANSITION_PASSWORD_HASH_SCHEME, hashPassword, hashPasswordWithScheme, verifyPassword } from "../worker/src/security";

describe("worker password hashing", () => {
  const pepper = "pepper";
  const salt = "00112233445566778899aabbccddeeff";
  const password = "olegadmin";

  it("verifies the current worker-safe scrypt scheme", async () => {
    const hash = await hashPassword(password, salt, pepper);

    await expect(verifyPassword(password, salt, pepper, hash, PASSWORD_HASH_SCHEME)).resolves.toBe(true);
    await expect(verifyPassword("wrong", salt, pepper, hash, PASSWORD_HASH_SCHEME)).resolves.toBe(false);
  });

  it("keeps legacy scrypt hashes valid for migration", async () => {
    const hash = await hashPasswordWithScheme(password, salt, pepper, LEGACY_PASSWORD_HASH_SCHEME);

    await expect(verifyPassword(password, salt, pepper, hash, LEGACY_PASSWORD_HASH_SCHEME)).resolves.toBe(true);
    await expect(verifyPassword(password, salt, pepper, hash, null)).resolves.toBe(true);
  });

  it("accepts the intermediate scrypt_v2 transition scheme", async () => {
    const hash = await hashPasswordWithScheme(password, salt, pepper, TRANSITION_PASSWORD_HASH_SCHEME);

    await expect(verifyPassword(password, salt, pepper, hash, TRANSITION_PASSWORD_HASH_SCHEME)).resolves.toBe(true);
  });
});
