ALTER TABLE access_rules ADD COLUMN hash_scheme TEXT NOT NULL DEFAULT 'sha256_v1';

UPDATE access_rules
SET hash_scheme = 'scrypt_v1'
WHERE hash_scheme IS NULL OR TRIM(hash_scheme) = '' OR hash_scheme = 'pbkdf2_sha256_v1';
