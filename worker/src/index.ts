import type { AdminPayload } from "@abihsgelo/shared";
import type { Env } from "./db";
import { addAudit, getBootstrap, getBootstrapStatus, getModeState, getProxyPayload, listAccessRules, listModes, listWallets, setSetting } from "./db";
import { refreshProxyState } from "./proxy";
import { LEGACY_PASSWORD_HASH_SCHEME, PASSWORD_HASH_SCHEME, hashPassword, hashToken, randomHex, verifyPassword } from "./security";

type JsonBody = Record<string, unknown>;

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"
};

const memoryRateLimit = new Map<string, number[]>();

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const corsHeaders = buildCorsHeaders(request, env);

    try {
      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...SECURITY_HEADERS,
            ...corsHeaders,
            "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
            "Access-Control-Allow-Headers": "Authorization,Content-Type"
          }
        });
      }

      if (url.pathname === "/healthz") {
        await ensureAdminBootstrapRule(env);
        const bootstrap = await getBootstrapStatus(env);
        return json({
          ok: bootstrap.isReady,
          service: "abihsgelo",
          bootstrap
        }, bootstrap.isReady ? 200 : 503, corsHeaders);
      }

      if (url.pathname === "/api/bootstrap" && method === "GET") {
        await ensureAdminBootstrapRule(env);
        return json(await getBootstrap(env), 200, corsHeaders);
      }

      if (url.pathname === "/api/bootstrap" && method === "POST") {
        const body = await safeJson(request);
        const metadata = (body.metadata as Record<string, unknown> | undefined) ?? {};
        ctx.waitUntil(addAudit(env, String(body.eventType ?? "site_open"), "client", metadata));
        return json({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname === "/api/auth/enter" && method === "POST") {
        await ensureAdminBootstrapRule(env);
        const limit = enforceRateLimit(request, "auth", 8, 5 * 60_000);
        if (!limit.ok) {
          return json({ ok: false }, 429, corsHeaders);
        }

        const body = await safeJson(request);
        const result = await authenticate(env, String(body.password ?? ""), ctx);
        return json(result, 200, corsHeaders);
      }

      if (url.pathname.startsWith("/api/modes/") && method === "GET") {
        const modeId = url.pathname.replace("/api/modes/", "");
        return json(await getModePayload(request, env, modeId), 200, corsHeaders);
      }

      if (url.pathname === "/api/admin/bootstrap" && method === "GET") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }

        const payload: AdminPayload = {
          mode: "admin_mode",
          modes: await listModes(env),
          wallets: await listWallets(env),
          accessRules: await listAccessRules(env, true),
          settings: {
            "donate.visible": await getBootstrap(env).then((value) => value.donateVisible),
            panic_mode: await env.DB.prepare(`SELECT value_json FROM site_settings WHERE key = 'panic_mode'`).first<{ value_json: string }>().then((row) => row ? JSON.parse(row.value_json) : false)
          },
          health: await getHealth(env),
          audit: (
            await env.DB.prepare(
              `SELECT id, event_type AS eventType, actor_type AS actorType, created_at AS createdAt, metadata_json AS metadataJson
               FROM audit_log ORDER BY id DESC LIMIT 20`
            ).all<AdminPayload["audit"][number]>()
          ).results
        };
        return json(payload, 200, corsHeaders);
      }

      if (url.pathname === "/api/admin/access-rules" && method === "POST") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        const body = await safeJson(request);
        await createAccessRule(env, body);
        return json({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname.startsWith("/api/admin/access-rules/") && method === "PUT") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        await updateAccessRule(env, url.pathname.split("/").pop() ?? "", await safeJson(request));
        return json({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname.startsWith("/api/admin/modes/") && method === "PUT") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        await updateMode(env, url.pathname.split("/").pop() ?? "", await safeJson(request));
        return json({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname.startsWith("/api/admin/wallets/") && method === "PUT") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        await updateWallet(env, url.pathname.split("/").pop() ?? "", await safeJson(request));
        return json({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname === "/api/admin/settings" && method === "PUT") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        const body = await safeJson(request);
        await Promise.all(Object.entries(body).map(([key, value]) => setSetting(env, key, value)));
        return json({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname === "/api/admin/refresh-now" && method === "POST") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        await refreshProxyState(env);
        return json({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname === "/api/admin/lock-now" && method === "POST") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        await env.DB.prepare(`UPDATE proxy_state SET session_version = session_version + 1 WHERE id = 1`).run();
        await addAudit(env, "admin_lock_now", "admin");
        return json({ ok: true });
      }

      if (url.pathname === "/api/admin/export" && method === "GET") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        return exportJson(env, url.searchParams.get("kind") ?? "", corsHeaders);
      }

      if (url.pathname === "/api/admin/import" && method === "POST") {
        const session = await requireAdmin(request, env);
        if (!session.ok) {
          return session.response;
        }
        await importJson(env, url.searchParams.get("kind") ?? "", await request.json());
        return json({ ok: true }, 200, corsHeaders);
      }

      return json({ ok: false, error: "not_found" }, 404, corsHeaders);
    } catch {
      return json({ ok: false }, 500, corsHeaders);
    }
  },

  async scheduled(_event, env): Promise<void> {
    await refreshProxyState(env);
  }
} satisfies ExportedHandler<Env>;

async function authenticate(env: Env, password: string, ctx: ExecutionContext): Promise<{ ok: boolean; mode?: string; token?: string }> {
  await ensureAdminBootstrapRule(env);
  const rules = await listAccessRules(env, false);
  const now = Date.now();

  for (const rule of rules) {
    if (!rule.isEnabled) {
      continue;
    }

    if (rule.expiresAt && Date.parse(rule.expiresAt) < now) {
      continue;
    }

    if (rule.maxUses !== null && rule.usageCount >= rule.maxUses) {
      continue;
    }

    if (rule.firstUseOnly && rule.successCount > 0) {
      continue;
    }

    const passwordOk = await verifyPassword(password, rule.passwordSalt, env.PEPPER, rule.passwordHash, rule.hashScheme);
    if (!passwordOk) {
      continue;
    }

    const requiresRehash = !rule.hashScheme || rule.hashScheme === LEGACY_PASSWORD_HASH_SCHEME;
    const nextSalt = requiresRehash ? randomHex(16) : null;
    const nextHash = requiresRehash && nextSalt ? await hashPassword(password, nextSalt, env.PEPPER) : null;

    const token = randomHex(32);
    const tokenHash = hashToken(token, env.SESSION_SECRET);
    const version = await env.DB.prepare(`SELECT session_version FROM proxy_state WHERE id = 1`).first<{ session_version: number }>();

    const writes = [
      env.DB.prepare(
        `INSERT INTO sessions (id, token_hash, mode_id, expires_at, created_at, version, is_revoked)
         VALUES (?1, ?2, ?3, datetime('now', '+6 hours'), CURRENT_TIMESTAMP, ?4, 0)`
      ).bind(randomHex(12), tokenHash, rule.targetMode, version?.session_version ?? 1)
    ];

    if (requiresRehash && nextHash && nextSalt) {
      writes.push(
        env.DB.prepare(
          `UPDATE access_rules
           SET password_hash = ?2,
               password_salt = ?3,
               hash_scheme = ?4,
               usage_count = usage_count + 1,
               success_count = success_count + 1,
               last_used_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?1`
        ).bind(rule.id, nextHash, nextSalt, PASSWORD_HASH_SCHEME)
      );
    } else {
      writes.push(
        env.DB.prepare(
          `UPDATE access_rules
           SET usage_count = usage_count + 1,
               success_count = success_count + 1,
               last_used_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?1`
        ).bind(rule.id)
      );
    }

    await env.DB.batch(writes);

    ctx.waitUntil(
      Promise.resolve().then(async () => {
        await addAudit(env, "password_success", "auth", { targetMode: rule.targetMode }, rule.id, rule.targetMode);
        env.ANALYTICS.writeDataPoint({
          blobs: ["password_success", rule.id, rule.targetMode],
          doubles: [Date.now()]
        });
      })
    );
    return { ok: true, mode: rule.targetMode, token };
  }

  ctx.waitUntil(
    Promise.resolve().then(async () => {
      await addAudit(env, "password_fail", "auth");
      env.ANALYTICS.writeDataPoint({
        blobs: ["password_fail"],
        doubles: [Date.now()]
      });
    })
  );
  return { ok: false };
}

async function getModePayload(request: Request, env: Env, modeId: string): Promise<unknown> {
  const mode = await getModeState(env, modeId);
  if (!mode || !mode.isEnabled) {
    throw new Error("missing mode");
  }

  if (mode.accessState === "locked") {
    const session = await requireMode(request, env, modeId);
    if (!session.ok) {
      throw new Error("locked");
    }
  }

  if (modeId === "home_mode") {
    return getBootstrap(env);
  }

  if (modeId === "proxies_mode") {
    const payload = await getProxyPayload(env);
    env.ANALYTICS.writeDataPoint({ blobs: ["proxies_open"], doubles: [Date.now()] });
    return { mode: "proxies_mode", ...payload };
  }

  if (modeId === "admin_mode") {
    const admin = await requireAdmin(request, env);
    if (!admin.ok) {
      throw new Error("admin locked");
    }
    return { mode: "admin_mode" };
  }

  return { mode: modeId };
}

async function requireMode(request: Request, env: Env, modeId: string): Promise<{ ok: true } | { ok: false; response: Response }> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, response: json({ ok: false }, 401) };
  }

  const tokenHash = hashToken(token, env.SESSION_SECRET);
  const session = await env.DB.prepare(
    `SELECT mode_id, expires_at, version, is_revoked FROM sessions WHERE token_hash = ?1 LIMIT 1`
  ).bind(tokenHash).first<{ mode_id: string; expires_at: string; version: number; is_revoked: number }>();
  const version = await env.DB.prepare(`SELECT session_version FROM proxy_state WHERE id = 1`).first<{ session_version: number }>();

  if (!session || session.mode_id !== modeId || session.is_revoked || Date.parse(session.expires_at) < Date.now() || session.version !== (version?.session_version ?? 1)) {
    return { ok: false, response: json({ ok: false }, 401) };
  }

  return { ok: true };
}

async function requireAdmin(request: Request, env: Env): Promise<{ ok: true } | { ok: false; response: Response }> {
  const rate = enforceRateLimit(request, "admin", 20, 10 * 60_000);
  if (!rate.ok) {
    return { ok: false, response: json({ ok: false }, 429) };
  }

  const mode = await requireMode(request, env, "admin_mode");
  return mode.ok ? { ok: true } : mode;
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("Authorization");
  if (!value?.startsWith("Bearer ")) {
    return null;
  }
  return value.slice(7);
}

function json(payload: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

async function safeJson(request: Request): Promise<JsonBody> {
  return (await request.json()) as JsonBody;
}

function enforceRateLimit(request: Request, scope: string, limit: number, windowMs: number): { ok: boolean } {
  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const entries = (memoryRateLimit.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  entries.push(now);
  memoryRateLimit.set(key, entries);
  return { ok: entries.length <= limit };
}

async function createAccessRule(env: Env, body: JsonBody): Promise<void> {
  const salt = randomHex(16);
  const password = String(body.password ?? "");
  const hash = await hashPassword(password, salt, env.PEPPER);
  const id = randomHex(12);
  await env.DB.prepare(
    `INSERT INTO access_rules (
      id, label, password_hash, password_salt, hash_scheme, target_mode, is_enabled, priority, notes,
      usage_count, success_count, fail_count, last_used_at, created_at, updated_at,
      expires_at, max_uses, first_use_only, soft_deleted_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 0, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?10, ?11, ?12, NULL)`
  ).bind(
    id,
    String(body.label ?? id),
    hash,
    salt,
    PASSWORD_HASH_SCHEME,
    String(body.targetMode ?? "home_mode"),
    body.isEnabled === false ? 0 : 1,
    Number(body.priority ?? 100),
    body.notes ? String(body.notes) : null,
    normalizeOptionalDate(body.expiresAt),
    normalizeOptionalNumber(body.maxUses),
    body.firstUseOnly ? 1 : 0
  ).run();
  await addAudit(env, "admin_change_access_rule", "admin", { id });
}

async function ensureAdminBootstrapRule(env: Env): Promise<void> {
  const bootstrapPassword = env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
  if (!bootstrapPassword) {
    return;
  }

  const existing = await env.DB.prepare(
    `SELECT id
     FROM access_rules
     WHERE target_mode = 'admin_mode' AND soft_deleted_at IS NULL
     LIMIT 1`
  ).first<{ id: string }>();

  if (existing) {
    return;
  }

  const salt = randomHex(16);
  const hash = await hashPassword(bootstrapPassword, salt, env.PEPPER);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO access_rules (
      id, label, password_hash, password_salt, hash_scheme, target_mode, is_enabled, priority, notes,
      usage_count, success_count, fail_count, last_used_at, created_at, updated_at,
      expires_at, max_uses, first_use_only, soft_deleted_at
    ) VALUES (
      'bootstrap-admin-rule',
      'bootstrap admin access',
      ?1,
      ?2,
      ?3,
      'admin_mode',
      1,
      1000,
      'Seeded automatically from ADMIN_BOOTSTRAP_PASSWORD. Rotate from admin after first successful production login.',
      0,
      0,
      0,
      NULL,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      NULL,
      NULL,
      0,
      NULL
    )`
  ).bind(hash, salt, PASSWORD_HASH_SCHEME).run();

  await addAudit(env, "admin_bootstrap_rule_seeded", "system", { mode: "admin_mode" });
}

async function updateAccessRule(env: Env, id: string, body: JsonBody): Promise<void> {
  let passwordFragment = "";
  const bindValues: unknown[] = [
    String(body.label ?? id),
    String(body.targetMode ?? "home_mode"),
    Number(body.priority ?? 100),
    body.isEnabled ? 1 : 0,
    body.notes ? String(body.notes) : null,
    normalizeOptionalDate(body.expiresAt),
    normalizeOptionalNumber(body.maxUses),
    body.firstUseOnly ? 1 : 0,
    body.softDelete ? 1 : 0
  ];

  if (body.password && String(body.password).trim()) {
    const salt = randomHex(16);
    const hash = await hashPassword(String(body.password), salt, env.PEPPER);
    passwordFragment = ", password_hash = ?10, password_salt = ?11, hash_scheme = ?12";
    bindValues.push(hash, salt, PASSWORD_HASH_SCHEME);
  }

  bindValues.push(id);
  const statement = `UPDATE access_rules
    SET label = ?1,
        target_mode = ?2,
        priority = ?3,
        is_enabled = ?4,
        notes = ?5,
        expires_at = ?6,
        max_uses = ?7,
        first_use_only = ?8,
        soft_deleted_at = CASE WHEN ?9 = 1 THEN COALESCE(soft_deleted_at, CURRENT_TIMESTAMP) ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP
        ${passwordFragment}
    WHERE id = ?${passwordFragment ? 13 : 10}`;
  await env.DB.prepare(statement).bind(...bindValues).run();
  await addAudit(env, "admin_change_access_rule", "admin", { id });
}

async function updateMode(env: Env, id: string, body: JsonBody): Promise<void> {
  await env.DB.prepare(
    `UPDATE content_modes
     SET access_state = ?1, is_enabled = ?2, is_default_public = ?3, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?4`
  ).bind(String(body.accessState ?? "locked"), body.isEnabled ? 1 : 0, body.isDefaultPublic ? 1 : 0, id).run();

  if (body.isDefaultPublic) {
    await env.DB.prepare(`UPDATE content_modes SET is_default_public = CASE WHEN id = ?1 THEN 1 ELSE 0 END`).bind(id).run();
  }

  await addAudit(env, "admin_change_mode", "admin", { id });
}

async function updateWallet(env: Env, id: string, body: JsonBody): Promise<void> {
  await env.DB.prepare(
    `UPDATE wallets
     SET address = ?1,
         qr_payload = ?2,
         warning_text = ?3,
         is_enabled = ?4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?5`
  ).bind(
    String(body.address ?? ""),
    String(body.qrPayload ?? body.address ?? ""),
    String(body.warningText ?? ""),
    body.isEnabled ? 1 : 0,
    id
  ).run();
  await addAudit(env, "wallet_update", "admin", { id });
}

async function getHealth(env: Env): Promise<Record<string, unknown>> {
  const bootstrap = await getBootstrapStatus(env);
  const state = await env.DB.prepare(
    `SELECT last_live_refresh_at, last_snapshot_at, last_refresh_status, stale_reason, session_version FROM proxy_state WHERE id = 1`
  ).first<Record<string, unknown>>();
  return {
    worker: bootstrap.isReady ? "ok" : "bootstrap_blocked",
    d1: "ok",
    analytics: "ok",
    adminBootstrapConfigured: bootstrap.hasBootstrapSecret,
    adminRulePresent: bootstrap.hasAdminRule,
    bootstrapMessage: bootstrap.message,
    ...state
  };
}

function normalizeOptionalDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

async function exportJson(env: Env, kind: string, extraHeaders: HeadersInit = {}): Promise<Response> {
  const table = kind === "wallets" ? "wallets" : kind === "site_settings" ? "site_settings" : "access_rules";
  const rows = (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
  return new Response(JSON.stringify(rows, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

function buildCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return {};
  }

  const allowedOrigins = new Set([env.SITE_ORIGIN, "http://127.0.0.1:5173", "http://localhost:5173"]);
  if (!allowedOrigins.has(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "false",
    Vary: "Origin"
  };
}

async function importJson(env: Env, kind: string, body: unknown): Promise<void> {
  if (!Array.isArray(body)) {
    throw new Error("invalid import");
  }

  if (kind === "site_settings") {
    await env.DB.batch([env.DB.prepare(`DELETE FROM site_settings`)]);
    for (const row of body as Array<Record<string, unknown>>) {
      await env.DB.prepare(
        `INSERT INTO site_settings (key, value_json, updated_at) VALUES (?1, ?2, COALESCE(?3, CURRENT_TIMESTAMP))`
      ).bind(String(row.key), String(row.value_json), row.updated_at ? String(row.updated_at) : null).run();
    }
  } else if (kind === "wallets") {
    await env.DB.batch([env.DB.prepare(`DELETE FROM wallets`)]);
    for (const row of body as Array<Record<string, unknown>>) {
      await env.DB.prepare(
        `INSERT INTO wallets (id, network, title, address, qr_payload, warning_text, is_enabled, sort_order, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, COALESCE(?9, CURRENT_TIMESTAMP), ?10)`
      ).bind(
        String(row.id),
        String(row.network),
        String(row.title),
        String(row.address),
        String(row.qr_payload ?? row.qrPayload ?? row.address),
        String(row.warning_text ?? row.warningText ?? ""),
        Number(row.is_enabled ?? row.isEnabled ?? 1),
        Number(row.sort_order ?? row.sortOrder ?? 100),
        row.updated_at ? String(row.updated_at) : null,
        row.deleted_at ? String(row.deleted_at) : null
      ).run();
    }
  } else {
    await env.DB.batch([env.DB.prepare(`DELETE FROM access_rules`)]);
    for (const row of body as Array<Record<string, unknown>>) {
      await env.DB.prepare(
        `INSERT INTO access_rules (
          id, label, password_hash, password_salt, hash_scheme, target_mode, is_enabled, priority, notes,
          usage_count, success_count, fail_count, last_used_at, created_at, updated_at,
          expires_at, max_uses, first_use_only, soft_deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, COALESCE(?14, CURRENT_TIMESTAMP), COALESCE(?15, CURRENT_TIMESTAMP), ?16, ?17, ?18, ?19)`
      ).bind(
        String(row.id),
        String(row.label),
        String(row.password_hash ?? row.passwordHash),
        String(row.password_salt ?? row.passwordSalt),
        String(row.hash_scheme ?? row.hashScheme ?? LEGACY_PASSWORD_HASH_SCHEME),
        String(row.target_mode ?? row.targetMode),
        Number(row.is_enabled ?? row.isEnabled ?? 1),
        Number(row.priority ?? 100),
        row.notes ? String(row.notes) : null,
        Number(row.usage_count ?? row.usageCount ?? 0),
        Number(row.success_count ?? row.successCount ?? 0),
        Number(row.fail_count ?? row.failCount ?? 0),
        row.last_used_at ? String(row.last_used_at) : null,
        row.created_at ? String(row.created_at) : null,
        row.updated_at ? String(row.updated_at) : null,
        row.expires_at ? String(row.expires_at) : null,
        row.max_uses === null || row.max_uses === undefined ? null : Number(row.max_uses),
        Number(row.first_use_only ?? row.firstUseOnly ?? 0),
        row.soft_deleted_at ? String(row.soft_deleted_at) : null
      ).run();
    }
  }

  await addAudit(env, "admin_import", "admin", { kind, count: body.length });
}
