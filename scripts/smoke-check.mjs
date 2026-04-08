import { access } from "node:fs/promises";

for (const path of ["frontend/dist/index.html", "frontend/public/snapshot.json"]) {
  await access(path);
  console.log(`ok ${path}`);
}
