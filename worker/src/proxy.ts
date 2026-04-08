import type { ProxyItem } from "@abihsgelo/shared";
import { parseTelegramProxies } from "@abihsgelo/shared";
import type { Env } from "./db";
import { addAudit } from "./db";

const SOURCE_URL = "https://t.me/s/ProxyMTProto";

export async function fetchProxySnapshot(): Promise<ProxyItem[]> {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "abihsgelo-bot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error("proxy source fetch failed");
  }

  const html = await response.text();
  return parseTelegramProxies(html);
}

export async function refreshProxyState(env: Env): Promise<void> {
  const items = await fetchProxySnapshot();
  const fresh = items.slice(0, 9);
  const archive = items.slice(9, 129);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM proxy_items_fresh`),
    env.DB.prepare(`DELETE FROM proxy_items_archive`)
  ]);

  const statements = [
    ...fresh.map((item) =>
      env.DB.prepare(
        `INSERT INTO proxy_items_fresh (id, proxy_number, proxy_url, posted_at, source_message_id, created_at, click_count)
         VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP, 0)`
      ).bind(item.id, item.proxyNumber, item.proxyUrl, item.postedAt, item.sourceMessageId)
    ),
    ...archive.map((item) =>
      env.DB.prepare(
        `INSERT INTO proxy_items_archive (id, proxy_number, proxy_url, posted_at, source_message_id, created_at, click_count)
         VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP, 0)`
      ).bind(item.id, item.proxyNumber, item.proxyUrl, item.postedAt, item.sourceMessageId)
    ),
    env.DB.prepare(
      `UPDATE proxy_state
       SET last_live_refresh_at = CURRENT_TIMESTAMP,
           last_source_fetch_at = CURRENT_TIMESTAMP,
           last_refresh_status = 'ok',
           stale_reason = NULL
       WHERE id = 1`
    )
  ];

  await env.DB.batch(statements);
  await addAudit(env, "admin_refresh_now", "system", { count: fresh.length });
}
