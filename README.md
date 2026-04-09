# abihsgelo

`abihsgelo` is a personal site built for Cloudflare Pages plus one Cloudflare Worker. The public root is a quiet home scene; hidden password entry can unlock `proxies_mode` or `admin_mode`. The stack is intentionally small: static Vite frontend, one Worker, D1, Analytics Engine, and GitHub Actions snapshot refresh.

## Stack

- Frontend: Vite + TypeScript + plain DOM/CSS
- Backend: one Cloudflare Worker in TypeScript
- Data: Cloudflare D1
- Metrics: Cloudflare Analytics Engine
- CI/CD: GitHub Actions + Cloudflare Pages Git integration + Worker deploy workflow

React was intentionally skipped because the site is interaction-heavy but structurally small, and plain DOM keeps the runtime lighter and the deployment surface simpler.

## Repository Layout

- `frontend/`: static Pages app
- `worker/`: Worker source and D1 migrations
- `shared/`: shared types and proxy parser
- `docs/`: project documentation and source-of-truth specs
- `scripts/`: snapshot and health utilities
- `.github/workflows/`: CI, Worker deploy, snapshot cron

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy dev secrets:

```bash
cp .dev.vars.example .dev.vars
```

3. Fill `.dev.vars` with strong secrets:
- `PEPPER`
- `SESSION_SECRET`
- `ADMIN_BOOTSTRAP_PASSWORD`
- optional `TURNSTILE_SECRET`

4. Apply local D1 migrations:

```bash
npm run db:migrate
npm run db:seed
```

5. Start local frontend + Worker:

```bash
npm run dev
```

Frontend runs on `http://127.0.0.1:5173`, Worker on `http://127.0.0.1:8787`.

## Production Bootstrap

`ADMIN_BOOTSTRAP_PASSWORD` is not an optional convenience secret. It is the required production-safe bootstrap path that prevents the deadlock where `admin_mode` is locked and `access_rules` is empty.

Bootstrap flow:
- deploy Worker with `ADMIN_BOOTSTRAP_PASSWORD` set as a long random secret
- on the first live `GET /api/bootstrap` or `POST /api/auth/enter`, the Worker checks whether D1 already has any non-deleted `admin_mode` access rule
- if no admin rule exists yet, the Worker seeds exactly one hashed D1 rule labeled `bootstrap admin access` that targets `admin_mode`
- that bootstrap password opens only `admin_mode`
- `proxies_mode` gets no default password and stays locked until you create one yourself from hidden admin
- operator enters the hidden password monolith with `ADMIN_BOOTSTRAP_PASSWORD`, reaches hidden admin, creates a `proxies_mode` rule, and then manages all later rules from hidden admin

Properties:
- raw bootstrap password is never stored in D1
- seeded rule still uses per-rule salt plus server-side pepper hashing
- bootstrap does not add a second backend or bypass D1
- if an admin rule already exists, bootstrap seeding does nothing
- if D1 has no admin rule and `ADMIN_BOOTSTRAP_PASSWORD` is missing, health/smoke/deploy must fail loudly and the deploy is not considered valid

## Cloudflare Login And Resource Creation

1. Authenticate:

```bash
npx wrangler login
```

or use an API token in the environment, not in code.

2. Create D1 database:

```bash
npx wrangler d1 create abihsgelo
```

3. Update binding IDs in [worker/wrangler.toml](/home/abihsgelo/Документы/abihsgelo/worker/wrangler.toml).

Analytics Engine dataset `abihsgelo_events` does not need a separate create command in current Cloudflare tooling; it is created automatically on first write when the binding exists.

4. Apply remote migrations:

```bash
npx wrangler d1 migrations apply DB --config worker/wrangler.toml --remote
npx wrangler d1 execute DB --config worker/wrangler.toml --remote --file worker/migrations/0002_seed.sql
```

5. Deploy Worker:

```bash
npm run deploy
```

6. Create the Cloudflare Pages project with the exact name `abihsgelo` and connect it to the GitHub repository, or use the included GitHub Action for Pages deploy.

Pages settings:
- Build command: `npm run build:frontend`
- Build output directory: `frontend/dist`
- Node version: `22+`

7. If you have a Cloudflare zone, add a route so the Worker handles `/api/*` and `/healthz` on the same public domain.

Current live fallback for this repository:
- Pages shell: `https://abihsgelo.pages.dev`
- Worker API: `https://abihsgelo.shiaboi.workers.dev`

This cross-origin setup is used only because the account currently has no Cloudflare zone to attach routes to.

If Cloudflare refuses the exact public name `abihsgelo`, stop and resolve that first instead of renaming in code.

Production secrets to set in Cloudflare Worker:
- `PEPPER`
- `SESSION_SECRET`
- `ADMIN_BOOTSTRAP_PASSWORD`
- optional `TURNSTILE_SECRET`

## First Login Sequence

1. Set `PEPPER`, `SESSION_SECRET`, and `ADMIN_BOOTSTRAP_PASSWORD`.
2. Deploy the Worker and Pages project.
3. Open the public site once so the Worker can seed the first `admin_mode` access rule if D1 is still empty.
4. Tap into the hidden password flow and enter `ADMIN_BOOTSTRAP_PASSWORD`.
5. Hidden admin opens.
6. In hidden admin, create a password rule for `proxies_mode`.
7. Create any additional rules you need for future modes.
8. Rotate, disable, archive, or replace the bootstrap admin rule from hidden admin as needed.

## Hidden Password Input

The hidden password scene keeps its invisible input model in production:
- no visible field or buttons are shown
- an invisible focused text control captures keyboard input for the typographic monolith
- desktop `Enter` and mobile `enter/done/go` actions are both treated as submit paths
- mobile line-break insertion in the hidden control is normalized into submit instead of leaving a visible form artifact
- automated tests cover desktop `Enter`, mobile `beforeinput insertLineBreak`, and newline fallback inside the hidden control

## Scripts

- `npm run dev`: frontend + local Worker
- `npm run build`: shared, frontend, worker, snapshot
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run db:migrate`
- `npm run db:seed`
- `npm run snapshot:update`
- `npm run health:check`
- `npm run smoke`
- `npm run deploy`

## Passwords And Modes

Passwords are never stored raw. Each access rule stores:
- `password_hash`
- `password_salt`
- mode target
- usage and expiry fields

Passwords are checked only by the Worker. Frontend rendering uses an in-memory session token that disappears on reload.

Modes can be changed without code edits through hidden admin:
- make a mode public or locked
- enable or disable a mode
- change default public mode
- add or rotate passwords
- enable or disable donate block
- manage wallet entries

## Snapshot Fallback

`frontend/public/snapshot.json` is generated by `npm run snapshot:update`. It contains only stale-safe proxy snapshot data and site metadata, never protected content or secrets.

GitHub Actions refreshes snapshot data every 15 minutes on a staggered schedule. The Worker performs live proxy refresh every 10 minutes on its own staggered cron.

If the Worker is down:
- Pages still serves the public home scene
- hidden password entry does not unlock anything
- the auth monolith quietly dissolves back to home

## Hidden Admin

`admin_mode` is a protected hidden mode. It can:
- manage access rules
- manage modes
- manage wallets and donate visibility
- trigger `refresh now`
- trigger `lock now`
- inspect health and audit
- export JSON payloads for backup

See [docs/admin-guide.md](/home/abihsgelo/Документы/abihsgelo/docs/admin-guide.md).

## Rollback

1. Re-deploy the previous Worker commit or previous GitHub workflow run.
2. Re-deploy the previous Pages build from Cloudflare Pages.
3. If needed, restore D1 using exported JSON plus SQL backup.
4. Trigger `lock now` if protected access must be cut immediately.

## Backup

- Export access rules JSON from hidden admin
- Export wallets JSON from hidden admin
- Export site settings JSON from hidden admin
- Back up D1 regularly with `wrangler d1 export`
- Keep snapshot artifacts from GitHub Actions
