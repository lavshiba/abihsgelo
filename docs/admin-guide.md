# Admin Guide

`admin_mode` is the hidden operational panel for the site.

## What It Can Do

- view access rules
- add password rules
- rotate passwords
- enable or disable rules
- soft-delete rules
- assign target mode
- manage temporary password fields:
  - `expires_at`
  - `max_uses`
  - `first_use_only`
- switch a mode between `public` and `locked`
- enable or disable modes
- choose default public mode
- manage wallet entries and ordering
- show or hide the donate block
- run `refresh now`
- run `lock now`
- view health and audit
- export JSON

## Access Rule Notes

Each access rule has:
- `id`
- `label`
- `target_mode`
- `is_enabled`
- `priority`
- `notes`
- `usage_count`
- `success_count`
- `fail_count`
- `last_used_at`
- `created_at`
- `updated_at`
- optional `expires_at`
- optional `max_uses`
- optional `first_use_only`
- `soft_deleted_at`

## Lock Now

`lock now`:
- forces protected modes back to locked
- increments session version
- invalidates active sessions
- should be used if admin access might be compromised

## Refresh Now

`refresh now`:
- fetches latest proxies immediately
- updates fresh and archive tables
- updates proxy health metadata
- emits audit and analytics events

## Export/Import

The current implementation ships export endpoints for:
- access rules JSON
- wallets JSON
- site settings JSON

Imports should be performed through reviewed admin changes or scripted D1 restore, not raw blind overwrite.
