# Admin Guide

`admin_mode` is the hidden operational panel for the site.

## First Bootstrap

Production bootstrap path:
- set `ADMIN_BOOTSTRAP_PASSWORD` as a strong Worker secret before the first live deploy
- on the first bootstrap or auth request, Worker seeds the first `admin_mode` access rule if D1 has none
- that password opens only `admin_mode`
- enter that password through the hidden typographic monolith
- once inside hidden admin, create the first `proxies_mode` password yourself, then create or rotate any later rules from hidden admin

This bootstrap path is required to prevent the deadlock where `admin_mode` is locked but `access_rules` is empty.

## UI Notes

`admin_mode` stays utilitarian, but the panel should still feel calm and readable:
- clear panel rhythm
- readable grouped controls
- no default browser-form look
- same graphite visual world as the rest of the site
- top-right close control returns to the home scene without reload
- short success or error feedback after save actions
- compact collapsible sections keep desktop and mobile from turning into one endless page
- the top bar is always visible first: panel meaning on the left, close control on the right
- default open sections are:
  - current state
  - quick actions
  - access rules
- less frequent sections stay collapsed until needed:
  - modes
  - donate and wallets
  - service/export/audit
- access rules grouped into:
  - quick proxy password creation
  - create new rule
  - working rules
  - disabled rules
  - archive
- first row shows current state and quick actions before detailed controls
- advanced rule fields stay hidden behind an explicit expanded section by default

## What It Can Do

- view access rules
- add password rules
- rotate passwords
- archive or restore rules with soft delete
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

Editable from hidden admin:
- `label`
- `target_mode`
- `priority`
- `password`
- `notes`
- `expires_at`
- `max_uses`
- `first_use_only`
- `is_enabled`
- archive state

The browser-side admin payload must never include:
- `password_hash`
- `password_salt`
- `hash_scheme`

The automatically seeded bootstrap rule:
- targets `admin_mode`
- is stored hashed in D1 like any other rule
- should be replaced, rotated, disabled, or archived after the first successful production admin login
- does not create any password for `proxies_mode`

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
