import { access } from "node:fs/promises";

const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();

if (!bootstrapPassword) {
  console.error("smoke failed: missing required ADMIN_BOOTSTRAP_PASSWORD. Empty-db deploy would be locked out of admin_mode.");
  process.exit(1);
}

for (const path of ["frontend/dist/index.html", "frontend/public/snapshot.json"]) {
  await access(path);
  console.log(`ok ${path}`);
}

console.log("ok bootstrap secret present");
