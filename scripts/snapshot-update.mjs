import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assignStableProxyNumbers, parseTelegramProxies } from "../shared/dist/index.js";

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
let catalog = [];
let fresh = [];
let archive = [];

if (parsed.length === 0) {
  try {
    const existing = JSON.parse(await readFile(resolve("frontend/public/snapshot.json"), "utf8"));
    catalog = Array.isArray(existing.catalog) ? existing.catalog : [];
    fresh = existing.fresh ?? [];
    archive = existing.archive ?? [];
  } catch {
    catalog = [];
    fresh = [];
    archive = [];
  }
} else {
  try {
    const existing = JSON.parse(await readFile(resolve("frontend/public/snapshot.json"), "utf8"));
    catalog = Array.isArray(existing.catalog) ? existing.catalog : [];
  } catch {
    catalog = [];
  }

  const numbered = assignStableProxyNumbers(parsed, catalog);
  catalog = numbered.catalog;
  fresh = numbered.items.slice(0, 9);
  archive = numbered.items.slice(9, 109);
}

const payload = {
  generatedAt: new Date().toISOString(),
  source,
  fresh,
  archive,
  catalog
};

const target = resolve("frontend/public/snapshot.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
