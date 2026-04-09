# Architecture

## Topology

- Cloudflare Pages serves the static shell from `frontend/dist`.
- One Worker named `abihsgelo` handles `/api/*`, `/healthz`, cron refresh, auth, hidden admin, stats, and snapshot metadata.
- D1 stores modes, access rules, wallets, sessions, audit, and proxy state.
- Analytics Engine stores event streams and creates the bound dataset automatically on first write.
- GitHub Actions builds `snapshot.json` as stale-safe fallback data.

Current deployed topology:
- `https://abihsgelo.pages.dev` serves the frontend
- `https://abihsgelo.shiaboi.workers.dev` serves the Worker API

This temporary split exists because the account currently has no Cloudflare zone configured for same-origin Worker routes.

## Request Flow

1. Browser loads Pages shell.
2. Frontend calls `/api/bootstrap`.
3. Public home scene renders from bootstrap data or static defaults.
4. Hidden password entry submits to `/api/auth/enter`.
5. Worker validates password against D1 access rules using peppered salted hash.
6. Worker returns a short-lived session token for the current tab only.
7. Frontend requests `/api/modes/:mode`.
8. Worker authorizes mode access based on public-lock state, session token, and session version.

Bootstrap safeguard:
1. Worker receives `GET /api/bootstrap` or `POST /api/auth/enter`.
2. Worker checks whether D1 already contains any non-deleted `admin_mode` access rule.
3. If none exists and `ADMIN_BOOTSTRAP_PASSWORD` is configured, Worker seeds one hashed `bootstrap admin access` rule in D1.
4. Operator uses the hidden password monolith to enter `admin_mode`, then creates permanent rules from hidden admin.

## Route Surface

Public:
- `GET /healthz`
- `GET /api/bootstrap`
- `POST /api/auth/enter`
- `GET /api/modes/home_mode`
- `GET /api/modes/proxies_mode`

Protected:
- `GET /api/modes/admin_mode`
- `GET /api/admin/bootstrap`
- `POST /api/admin/access-rules`
- `PUT /api/admin/access-rules/:id`
- `PUT /api/admin/modes/:id`
- `PUT /api/admin/wallets/:id`
- `PUT /api/admin/settings`
- `POST /api/admin/refresh-now`
- `POST /api/admin/lock-now`
- `GET /api/admin/export`

## Data Flow

- `content_modes`: mode registry and public-lock state
- `access_rules`: password -> target mode
- `wallets`: donate networks and wallet metadata
- `site_settings`: donate visibility, stale thresholds, snapshot controls
- `proxy_items_fresh`: up to 9 latest proxy entries
- `proxy_items_archive`: older proxy entries
- `proxy_state`: health and refresh metadata
- `sessions`: opaque session storage and version invalidation
- `audit_log`: security and admin history

## Cron Flow

- Worker cron: every 10 minutes, staggered away from `:00`
- Fetches `https://t.me/s/ProxyMTProto`
- Parses latest entries
- Upserts fresh 9 and archives overflow
- Updates `proxy_state`
- Emits Analytics event

## Snapshot Flow

1. GitHub Actions runs `npm ci`, `npm run snapshot:update`.
2. `scripts/snapshot-update.mjs` fetches the public Telegram page and writes `frontend/public/snapshot.json`.
3. Pages deploy includes the fresh snapshot file.
4. Frontend uses it only when live Worker data is unavailable or marked stale.

## Bindings

Expected `wrangler.toml` bindings:
- `DB`: D1 database
- `ANALYTICS`: Analytics Engine dataset
- `PEPPER`: Worker secret
- `SESSION_SECRET`: Worker secret
- `ADMIN_BOOTSTRAP_PASSWORD`: Worker secret required for production bootstrap until first admin rule exists
- optional `TURNSTILE_SECRET`

## Why Pages And Worker Stay Separate

- Public shell must still render if Worker is down.
- Protected modes never unlock without Worker auth.
- Operational failures in auth/api do not blank the entire site.
