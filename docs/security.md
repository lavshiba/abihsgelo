# Security

## Baseline

- Secure by default
- one Worker backend only
- no secrets in frontend
- no raw passwords in D1, logs, or analytics
- no protected fallback content in `snapshot.json`
- production bootstrap must not deadlock hidden admin when D1 starts without any admin rule
- bootstrap must not create any non-admin password implicitly

## Password Storage

- normalize password with trim + case fold
- generate random per-rule salt
- compute scrypt hash over `normalized_password + pepper`
- store `password_hash` and `password_salt`
- `PEPPER` exists only as a Worker secret
- bootstrap password follows the same hashing path when the Worker seeds the first `admin_mode` rule from `ADMIN_BOOTSTRAP_PASSWORD`
- the seeded bootstrap rule targets only `admin_mode`
- no default `proxies_mode` password is created

## Sessions

- opaque token returned only after successful auth
- token stored only in runtime memory on the client
- no cookies
- no local storage
- no session storage
- reload returns user to public home scene
- Worker stores only token hash and expiry
- `lock now` rotates session version and invalidates active sessions

## Rate Limiting

- auth endpoint: strict IP-based sliding window in Worker memory with D1 audit fallback
- admin endpoints: harder limits than public auth
- if limit trips, return generic denial without behavioral leaks

## Headers

Worker and Pages should emit:
- `Content-Security-Policy`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy` with most features disabled

## Threat Model

Main risks:
- brute force on password entry
- accidental exposure of admin or protected mode data
- stale or dead Worker accidentally opening protected content
- secret leakage through source control or frontend bundle
- oversharing through logs and analytics

Controls:
- protected modes require Worker decision every time
- wrong password, timeout, or Worker outage all return to home
- admin is a hidden protected mode, not a public route
- if D1 has no `admin_mode` rule yet, Worker can seed exactly one hashed bootstrap admin rule from the server-side `ADMIN_BOOTSTRAP_PASSWORD` secret
- audit trail records successes, failures, and admin changes
- analytics use IDs or labels, never raw passwords
- current cross-origin Pages -> Worker traffic is restricted by explicit CORS allowlist to the Pages production origin and local dev origins only

## Optional Features

- Turnstile can be enabled later behind a feature flag
- stronger distributed rate limit can be added with Durable Objects later only if needed, but current architecture must remain one Worker
