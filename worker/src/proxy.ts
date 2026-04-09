import type { ProxyItem } from "@abihsgelo/shared";
import { assignStableProxyNumbers, parseTelegramProxies } from "@abihsgelo/shared";
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
  try {
    const items = await fetchProxySnapshot();
    if (items.length === 0) {
      throw new Error("proxy source returned zero parsed items");
    }

    const existingCatalog = (
      await env.DB.prepare(
        `SELECT source_message_id AS sourceMessageId, proxy_number AS proxyNumber
         FROM proxy_catalog
         ORDER BY proxy_number ASC`
      ).all<{ sourceMessageId: string; proxyNumber: number }>()
    ).results;

    const numbered = assignStableProxyNumbers(items, existingCatalog);
    const fresh = numbered.items.slice(0, 9);
    const archive = numbered.items.slice(9, 109);
    const knownSourceIds = new Set(existingCatalog.map((entry) => entry.sourceMessageId));
    const catalogStatements = numbered.catalog
      .filter((entry) => !knownSourceIds.has(entry.sourceMessageId))
      .map((entry) =>
        env.DB.prepare(
          `INSERT INTO proxy_catalog (source_message_id, proxy_number, first_seen_at)
           VALUES (?1, ?2, CURRENT_TIMESTAMP)`
        ).bind(entry.sourceMessageId, entry.proxyNumber)
      );

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM proxy_items_fresh`),
      env.DB.prepare(`DELETE FROM proxy_items_archive`)
    ]);

    const statements = [
      ...catalogStatements,
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
    await addAudit(env, "admin_refresh_now", "system", {
      count: fresh.length,
      newestProxyNumber: fresh[0]?.proxyNumber ?? null
    });
  } catch (error) {
    await env.DB.prepare(
      `UPDATE proxy_state
       SET last_source_fetch_at = CURRENT_TIMESTAMP,
           last_refresh_status = 'stale',
           stale_reason = ?1
       WHERE id = 1`
    ).bind(error instanceof Error ? error.message : "proxy refresh failed").run();
    await addAudit(env, "admin_refresh_failed", "system", {
      reason: error instanceof Error ? error.message : "proxy refresh failed"
    });
  }
}
