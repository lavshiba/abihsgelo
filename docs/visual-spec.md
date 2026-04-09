# Visual Spec

This document is the UX/UI source of truth.

## Palette

- Background: deep graphite `#16181d`
- Elevated graphite: `#1f232b`
- Soft text: `rgba(255,255,255,0.72)`
- Quiet text: `rgba(255,255,255,0.48)`
- Border: `rgba(255,255,255,0.10)`
- Active glow: `rgba(255,255,255,0.14)`

## Typography

- Primary family: `"Manrope", "Segoe UI", sans-serif`
- Password monolith family: `"Space Grotesk", "Manrope", sans-serif`
- Tight optical spacing in password mode
- Avoid decorative headings in public home scene

## Home Scene

- No page scroll
- No bounce
- One calm vertical composition

ASCII layout:

```text
┌──────────────────────────────────────────────┐
│                                              │
│              oleg shiba // abihsgelo         │
│                     (tg)                     │
│                     2026                     │
│                                              │
│                                              │
│                                              │
│               hidden entry plane             │
│                                              │
│                                              │
│                donate usdt                   │
│      [ton] [trc20] [erc20] [sol]             │
└──────────────────────────────────────────────┘
```

Rules:
- top stack sits above center with breathing room
- `tg` is a filled circle slightly lighter than the background
- `tg` first attempts to open Telegram app directly, then falls back to web only if the app handoff fails
- `2026` is quieter than the name line
- almost any tap outside interactive elements starts hidden password entry
- donate block is centered near the bottom and fully admin-driven
- tap on donate pills or `tg` must not trigger hidden entry

## Wallet Overlay

- opens in-place, never navigates away
- dim backdrop with soft blur
- centered card
- content order:
  - title
  - QR code
  - address
  - `copy address` button
  - one-line warning
- no toasts, no noisy confirmation
- copy button briefly changes to `copied`

## Transition To Password Mode

1. top stack and donate block dissolve as one composition
2. screen clears to graphite
3. only then a thick slower-blinking cursor appears at the center
4. no input field box and no hint text
5. no visible labels, helper copy, submit button, or back button
6. hidden input layer may use an invisible focused text control for desktop/mobile keyboard capture, but it must stay fully visually absent

## Password Mode

ASCII feeling:

```text
                █

             ABIH
            SGELOP
           ROXIES123
          ANOTHERRULE
```

Rules:
- first character becomes a giant screen-dominant form
- two characters become two huge adjacent forms
- from three characters onward the block grows by optical fill, not textarea-style word wrapping
- text is visible, uppercase visually, case-insensitive in validation
- weight must feel heavy, dense, and visually confident rather than thin default text
- cursor stays at the end of the last line
- letter spacing stays tight; word spacing is wider than letter spacing
- the block should read as a fullscreen typographic lockup
- mobile keyboard `enter/done/go` actions must submit as reliably as desktop enter
- on enter:
  - success: block equalizes, soft blur, births target mode
  - fail: soft faster dissolve back to home
  - timeout: quiet dissolve back to home

## Proxies Mode

- same graphite world
- compact centered panel with close control in the corner
- title then status card then 3x3 fresh grid then archive

Fresh grid:
- up to 9 cards
- dense spacing
- nearly square cards
- card order newest top-left to oldest bottom-right
- proxy numbers are site-local running numbers:
  - first proxy ever seen by the site is `#1`
  - later proxies keep incrementing without reset
  - numbers never collapse or renumber when fresh cards push older cards into archive
- layouts with fewer than 9 cards must stay centered and composed:
  - `1`: one centered card
  - `3`: one complete centered row
  - `5`: balanced centered composition, not an empty 3-column grid with holes

Card content:

```text
#409
08:30
07.04.26
```

Archive:
- darker secondary layer
- archive pill label: `прокси постарее (n)`
- trigger reads like a large soft slab, not a plain collapse control
- mobile grid: 5 columns
- desktop grid: 10 columns
- archive card content: only `#number`
- opening archive must not flash or rebuild the whole proxies scene

## Hidden Admin

- same graphite environment
- utilitarian, not marketing
- close control in the corner that returns to home without reload
- top row explains what this screen is
- first row surfaces current state and quick actions
- then clear blocks for:
  - access rules
  - modes
  - donate and wallets
  - service/export/history
- sensitive actions use clear destructive styling but remain visually calm

## Motion

- all transitions are soft and short
- no springy bounce
- appearance often includes a slight upward drift
- archive opens row-by-row from bottom upward
- archive opens from its own slab without causing the whole proxies scene to flash or fully rerender
- live proxy update reflows the grid rather than flashing
- when archive is open, live updates queue quietly and apply only after the view returns to fresh
- newest incoming top-left card gets only a very thin, short accent
- proxies title and status appear softly before the grid fully settles
- fresh cards arrive row-by-row
- press targets give a clear soft graphite press response
