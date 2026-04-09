import type { AccessRuleSummary, BootstrapPayload, ModeSummary, ProxyItem, WalletEntry } from "@abihsgelo/shared";
import { buildProxyTitle } from "@abihsgelo/shared";

const FRESH_PROXY_LIMIT = 9;
const ARCHIVE_PROXY_LIMIT = 100;

export interface Env {
  DB: D1Database;
  ANALYTICS: AnalyticsEngineDataset;
  PEPPER: string;
  SESSION_SECRET: string;
  ADMIN_BOOTSTRAP_PASSWORD?: string;
  TURNSTILE_SECRET?: string;
  SITE_ORIGIN?: string;
}

export interface AuthRuleRecord extends AccessRuleSummary {
  passwordHash: string;
  passwordSalt: string;
  hashScheme: string | null;
}

export interface BootstrapStatus {
  isReady: boolean;
  hasAdminRule: boolean;
  hasBootstrapSecret: boolean;
  message: string;
}

export async function getBootstrap(env: Env): Promise<BootstrapPayload> {
  const defaultMode = await env.DB.prepare(
    `SELECT id FROM content_modes WHERE is_default_public = 1 AND is_enabled = 1 LIMIT 1`
  ).first<{ id: string }>();
  const wallets = await listWallets(env);
  const donateVisible = await getBooleanSetting(env, "donate.visible", true);
  const panicMode = await getBooleanSetting(env, "panic_mode", false);
  const state = await env.DB.prepare(`SELECT last_snapshot_at FROM proxy_state WHERE id = 1`).first<{ last_snapshot_at: string | null }>();

  return {
    siteName: "abihsgelo",
    defaultPublicMode: (defaultMode?.id ?? "home_mode") as BootstrapPayload["defaultPublicMode"],
    donateVisible,
    telegramUrl: "https://t.me/abihsgelo",
    wallets,
    yearLabel: "2026",
    snapshotAgeSeconds: state?.last_snapshot_at ? Math.max(0, Math.floor((Date.now() - Date.parse(state.last_snapshot_at)) / 1000)) : null,
    workerAvailable: true,
    panicMode
  };
}

export async function listWallets(env: Env): Promise<WalletEntry[]> {
  const result = await env.DB.prepare(
    `SELECT id, network, title, address, qr_payload AS qrPayload, warning_text AS warningText, is_enabled AS isEnabled, sort_order AS sortOrder
     FROM wallets
     WHERE deleted_at IS NULL
     ORDER BY sort_order ASC`
  ).all<WalletEntry>();
  return result.results.map((wallet) => ({ ...wallet, isEnabled: Boolean(wallet.isEnabled) }));
}

export async function listModes(env: Env): Promise<ModeSummary[]> {
  const result = await env.DB.prepare(
    `SELECT id, label, access_state AS accessState, is_enabled AS isEnabled, is_default_public AS isDefaultPublic
     FROM content_modes
     ORDER BY sort_order ASC`
  ).all<ModeSummary>();
  return result.results.map((mode) => ({
    ...mode,
    isEnabled: Boolean(mode.isEnabled),
    isDefaultPublic: Boolean(mode.isDefaultPublic)
  }));
}

export async function listAccessRules(env: Env, includeSoftDeleted = false): Promise<AuthRuleRecord[]> {
  const result = await env.DB.prepare(
    `SELECT id, label, password_hash AS passwordHash, password_salt AS passwordSalt, hash_scheme AS hashScheme, target_mode AS targetMode,
            is_enabled AS isEnabled, priority, notes, usage_count AS usageCount, success_count AS successCount,
            fail_count AS failCount, last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt,
            expires_at AS expiresAt, max_uses AS maxUses, first_use_only AS firstUseOnly, soft_deleted_at AS softDeletedAt
     FROM access_rules
     ${includeSoftDeleted ? "" : "WHERE soft_deleted_at IS NULL"}
     ORDER BY CASE WHEN soft_deleted_at IS NULL THEN 0 ELSE 1 END ASC, priority DESC, updated_at DESC`
  ).all<AuthRuleRecord>();

  return result.results.map((rule) => ({
    ...rule,
    isEnabled: Boolean(rule.isEnabled),
    firstUseOnly: Boolean(rule.firstUseOnly)
  }));
}

export function toAccessRuleSummary(rule: AuthRuleRecord): AccessRuleSummary {
  return {
    id: rule.id,
    label: rule.label,
    targetMode: rule.targetMode,
    isEnabled: rule.isEnabled,
    priority: rule.priority,
    notes: rule.notes,
    usageCount: rule.usageCount,
    successCount: rule.successCount,
    failCount: rule.failCount,
    lastUsedAt: rule.lastUsedAt,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    expiresAt: rule.expiresAt,
    maxUses: rule.maxUses,
    firstUseOnly: rule.firstUseOnly,
    softDeletedAt: rule.softDeletedAt
  };
}

export async function getModeState(env: Env, modeId: string): Promise<ModeSummary | null> {
  const mode = await env.DB.prepare(
    `SELECT id, label, access_state AS accessState, is_enabled AS isEnabled, is_default_public AS isDefaultPublic
     FROM content_modes WHERE id = ?1 LIMIT 1`
  ).bind(modeId).first<ModeSummary>();

  if (!mode) {
    return null;
  }

  return { ...mode, isEnabled: Boolean(mode.isEnabled), isDefaultPublic: Boolean(mode.isDefaultPublic) };
}

export async function getProxyPayload(env: Env): Promise<{
  title: string;
  lastSuccessfulRefreshAt: string | null;
  isStale: boolean;
  staleReason: string | null;
  fresh: ProxyItem[];
  archive: ProxyItem[];
}> {
  const fresh = (await env.DB.prepare(
    `SELECT id, proxy_number AS proxyNumber, proxy_url AS proxyUrl, posted_at AS postedAt, source_message_id AS sourceMessageId, click_count AS clickCount
     FROM proxy_items_fresh ORDER BY proxy_number DESC LIMIT ?1`
  ).bind(FRESH_PROXY_LIMIT).all<ProxyItem>()).results;

  const archive = (await env.DB.prepare(
    `SELECT id, proxy_number AS proxyNumber, proxy_url AS proxyUrl, posted_at AS postedAt, source_message_id AS sourceMessageId, click_count AS clickCount
     FROM proxy_items_archive ORDER BY proxy_number DESC LIMIT ?1`
  ).bind(ARCHIVE_PROXY_LIMIT).all<ProxyItem>()).results;

  const state = await env.DB.prepare(
    `SELECT last_live_refresh_at, last_refresh_status, stale_reason FROM proxy_state WHERE id = 1`
  ).first<{ last_live_refresh_at: string | null; last_refresh_status: string | null; stale_reason: string | null }>();

  return {
    title: buildProxyTitle(fresh.length),
    lastSuccessfulRefreshAt: state?.last_live_refresh_at ?? null,
    isStale: state?.last_refresh_status === "stale" || state?.last_refresh_status === "degraded",
    staleReason: state?.stale_reason ?? null,
    fresh,
    archive
  };
}

export async function getBooleanSetting(env: Env, key: string, fallback: boolean): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT value_json FROM site_settings WHERE key = ?1 LIMIT 1`).bind(key).first<{ value_json: string }>();
  if (!row) {
    return fallback;
  }
  try {
    return Boolean(JSON.parse(row.value_json));
  } catch {
    return fallback;
  }
}

export async function setSetting(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO site_settings (key, value_json, updated_at)
     VALUES (?1, ?2, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`
  ).bind(key, JSON.stringify(value)).run();
}

export async function addAudit(env: Env, eventType: string, actorType: string, metadata: Record<string, unknown> = {}, accessRuleId: string | null = null, modeId: string | null = null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (event_type, actor_type, access_rule_id, mode_id, metadata_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)`
  ).bind(eventType, actorType, accessRuleId, modeId, JSON.stringify(metadata)).run();
}

export async function getBootstrapStatus(env: Env): Promise<BootstrapStatus> {
  const adminRule = await env.DB.prepare(
    `SELECT id
     FROM access_rules
     WHERE target_mode = 'admin_mode' AND soft_deleted_at IS NULL
     LIMIT 1`
  ).first<{ id: string }>();
  const hasBootstrapSecret = Boolean(env.ADMIN_BOOTSTRAP_PASSWORD?.trim());

  if (adminRule?.id) {
    return {
      isReady: true,
      hasAdminRule: true,
      hasBootstrapSecret,
      message: "admin bootstrap ready"
    };
  }

  if (hasBootstrapSecret) {
    return {
      isReady: true,
      hasAdminRule: false,
      hasBootstrapSecret: true,
      message: "admin bootstrap secret present; first admin rule will be seeded on bootstrap/auth"
    };
  }

  return {
    isReady: false,
    hasAdminRule: false,
    hasBootstrapSecret: false,
    message: "missing required ADMIN_BOOTSTRAP_PASSWORD for empty database bootstrap"
  };
}
