const value = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();

if (!value) {
  console.error("bootstrap check failed: ADMIN_BOOTSTRAP_PASSWORD is required for a correct empty-db bootstrap and first admin login path");
  process.exit(1);
}

console.log("bootstrap check ok: ADMIN_BOOTSTRAP_PASSWORD is present");
