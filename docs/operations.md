# Operations

## Health Checks

- `GET /healthz`
- hidden admin health panel
- `npm run health:check`

Key signals:
- Worker reachable
- D1 query success
- bootstrap secret configured when no admin rule exists yet
- last live refresh time
- snapshot age
- stale warning
- source fetch failures

## Outage Playbook

If Worker is down:
- public home scene should still load from Pages
- protected entry should quietly dissolve back to home
- do not bypass auth

Actions:
1. inspect latest Worker deploy
2. inspect D1 binding health
3. inspect source fetch errors
4. if needed, re-deploy last known good Worker
5. verify Pages still serves `snapshot.json`

## First Deploy Checklist

Before the first production deploy:
1. set `PEPPER`
2. set `SESSION_SECRET`
3. set `ADMIN_BOOTSTRAP_PASSWORD`
4. deploy Worker
5. load the public site once so bootstrap seeding can run
6. enter hidden password flow with the bootstrap password
7. create permanent admin and protected-mode access rules
8. rotate or remove the bootstrap secret after permanent admin access is confirmed

## Panic Mode

Panic mode is a site setting. When enabled:
- donate block can be hidden
- refresh jobs can be paused
- admin can force `lock now`
- frontend may prefer snapshot and suppress live polling

## Brute Force Response

1. trigger `lock now`
2. inspect recent auth failures in audit
3. rotate affected passwords
4. optionally enable Turnstile flag
5. review rate limit thresholds

## Stale Snapshot

Use hidden admin or `npm run health:check` to inspect snapshot age.

If stale snapshot is visible:
1. verify GitHub Action `snapshot.yml`
2. run `npm run snapshot:update`
3. commit updated snapshot pipeline code if broken
4. redeploy Pages if required

## Donate Block Disable

Hide the donate block from hidden admin. This changes D1 settings and takes effect on the next bootstrap fetch.
