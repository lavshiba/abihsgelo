import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseTelegramProxies } from "../shared/dist/index.js";

const source = "https://t.me/s/ProxyMTProto";
const response = await fetch(source, {
  headers: {
    "User-Agent": "abihsgelo-snapshot/1.0"
  }
});

if (!response.ok) {
  throw new Error(`snapshot fetch failed: ${response.status}`);
}

const html = await response.text();
const parsed = parseTelegramProxies(html);
const payload = {
  generatedAt: new Date().toISOString(),
  source,
  fresh: parsed.slice(0, 9),
  archive: parsed.slice(9, 129)
};

const target = resolve("frontend/public/snapshot.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
