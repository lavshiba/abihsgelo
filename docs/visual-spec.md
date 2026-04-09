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
- cursor stays at the end of the last line
- letter spacing stays tight; word spacing is wider than letter spacing
- the block should read as a fullscreen typographic lockup
- on enter:
  - success: block equalizes, soft blur, births target mode
  - fail: soft faster dissolve back to home
  - timeout: quiet dissolve back to home

## Proxies Mode

- same graphite world
- compact center column slightly above true center
- title then status line then optional stale line then 3x3 fresh grid then archive

Fresh grid:
- up to 9 cards
- dense spacing
- nearly square cards
- card order newest top-left to oldest bottom-right
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

## Hidden Admin

- same graphite environment
- utilitarian, not marketing
- left-aligned sections inside a centered panel
- cards for health, mode controls, access rules, wallets, audit, exports
- sensitive actions use clear destructive styling but remain visually calm

## Motion

- all transitions are soft and short
- no springy bounce
- appearance often includes a slight upward drift
- archive opens row-by-row from bottom upward
- live proxy update reflows the grid rather than flashing
- when archive is open, live updates queue quietly and apply only after the view returns to fresh
- newest incoming top-left card gets only a very thin, short accent
