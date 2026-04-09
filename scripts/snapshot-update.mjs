import { mkdir, readFile, writeFile } from "node:fs/promises";
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
let fresh = parsed.slice(0, 9);
let archive = parsed.slice(9, 129);

if (parsed.length === 0) {
  try {
    const existing = JSON.parse(await readFile(resolve("frontend/public/snapshot.json"), "utf8"));
    fresh = existing.fresh ?? [];
    archive = existing.archive ?? [];
  } catch {
    fresh = [];
    archive = [];
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  source,
  fresh,
  archive
};

const target = resolve("frontend/public/snapshot.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
