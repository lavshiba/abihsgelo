# AGENTS.md

Read this file before touching code or docs.

## Project

`abihsgelo` is a personal Cloudflare Pages site backed by exactly one Cloudflare Worker. The public default is a quiet `home_mode`; hidden password entry unlocks protected modes such as `proxies_mode` and `admin_mode`.

## Non-Negotiables

- Public site name must remain exactly `abihsgelo`.
- Backend must remain exactly one Worker.
- Required architecture: Cloudflare Pages + one Worker + D1 + Analytics Engine + GitHub Actions snapshot fallback.
- `home_mode` is public by default.
- `proxies_mode` and `admin_mode` are locked by default.
- Never expose secrets, raw passwords, admin internals, or debug traces in the frontend.
- Never store raw passwords anywhere. Use worker-side hashing with per-rule salt and a server-side pepper secret.
- `ADMIN_BOOTSTRAP_PASSWORD` is mandatory for production until the first working `admin_mode` access rule exists in D1.
- The first working password must unlock only `admin_mode`. `proxies_mode` gets no default password and must be created later from hidden admin.
- If exact naming or another hard requirement cannot be met, stop and report it instead of silently improvising.

## Sources Of Truth

- Product/logic baseline: `for_codex/codex_tz_master.txt` content has been incorporated into repo docs.
- Visual source of truth: [docs/visual-spec.md](/home/abihsgelo/Документы/abihsgelo/docs/visual-spec.md)
- Architecture source of truth: [docs/architecture.md](/home/abihsgelo/Документы/abihsgelo/docs/architecture.md)
- Security source of truth: [docs/security.md](/home/abihsgelo/Документы/abihsgelo/docs/security.md)
- Operational source of truth: [docs/operations.md](/home/abihsgelo/Документы/abihsgelo/docs/operations.md)
- Admin behavior source of truth: [docs/admin-guide.md](/home/abihsgelo/Документы/abihsgelo/docs/admin-guide.md)

## Current Modes

- `home_mode`: public, non-scrolling, quiet personal scene.
- `proxies_mode`: locked by password by default.
- `admin_mode`: locked by password by default.
- first production bootstrap must seed the first `admin_mode` access rule from `ADMIN_BOOTSTRAP_PASSWORD` if D1 has no admin rule yet
- empty D1 without `ADMIN_BOOTSTRAP_PASSWORD` is an invalid deploy and must fail loudly in checks

## Required Checks Before Push

Run all of these before push or deploy:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`
5. `npm run smoke`

Only push or deploy after all five pass.

## Implementation Rules

- Keep Pages and Worker operationally separate. Static shell must still load when Worker is unavailable.
- Frontend auth state lives in memory only. No cookies, `localStorage`, or `sessionStorage` for session tokens.
- Hidden password entry is a typographic monolith only. No visible input box, labels, submit buttons, or back buttons.
- Protected panels should provide an in-app close path back to `home_mode` without full page reload.
- Telegram CTA behavior should prefer direct app deep-link handoff before web fallback.
- Protected mode panels should open with ready content as often as available data allows; avoid normal-path blank or confusing loading gaps after successful password entry.
- Hidden admin should stay compact and sectioned on both desktop and mobile, not one always-open raw form scroll.
- All mode/public-lock behavior must be data-driven through D1, not hardcoded special cases.
- Hidden admin changes passwords, mode visibility, wallets, donate block, and refresh/lock operations without code edits.
- Snapshot fallback must never reveal protected content or admin logic.
- Changes to UX must update [docs/visual-spec.md](/home/abihsgelo/Документы/abihsgelo/docs/visual-spec.md).
- Changes to routes, bindings, cron, or data flow must update [docs/architecture.md](/home/abihsgelo/Документы/abihsgelo/docs/architecture.md).
- Changes to auth, headers, rate limits, sessions, or data handling must update [docs/security.md](/home/abihsgelo/Документы/abihsgelo/docs/security.md).
- Changes to operator workflows must update [docs/operations.md](/home/abihsgelo/Документы/abihsgelo/docs/operations.md).

## Cloudflare Naming Policy

- Pages project name: `abihsgelo`
- Production public name: `abihsgelo`
- Worker name target: `abihsgelo`
- If Cloudflare blocks exact resource creation, report the blocker explicitly.
