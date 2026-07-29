# Responsive audit — TKO (tko.cam)

Status after the **global shell pass** (this task). The shell now adapts:

- Vertical `Sidebar` is `hidden sm:flex` — it disappears below 640px and the page gets full width.
- New phone-only `BottomNav` (`sm:hidden`, fixed, safe-area aware) with 5 primary tabs + a **More** bottom sheet.
- `main` gets `pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0` so content clears the bottom bar, plus `min-w-0` and a `max-w-screen-2xl` centered wrapper.
- `PowerBar` header now wraps + scales (`flex-wrap`, `text-2xl sm:text-3xl`, tighter padding).
- `CommandBar` ("Ask TKO") floats above the bottom bar on phones.

**Breakpoint used:** Tailwind `sm` = **640px**. Below = bottom nav + full-width content; at/above = sidebar (icon rail 640–767, full labels 768+).

---

## Dominant remaining global offender (drives the per-screen pass)

**~25 page bodies open with a fixed `p-8` (32px) container that does not shrink.**
On a 360–390px phone that's 64px of the width gone before any content. The second
pass should swap the top-level `p-8` for `p-4 sm:p-6 lg:p-8` (and `max-w-* mx-auto`
stays). Pages affected include: AI, AILabel, CreateHighlight, CreateMatch,
CreateServer, Dashboard, Discover, GoLive, Live, MatchDetail, MyClips,
Notifications, Oracle, Profile, ProfileTrophies, Rankings, Redeem, ReelDetail,
Shop, StatCheck, StatCheckRoom, Tournaments, TournamentDetail, Upgrade.
(Newer pages — Broadcast, Director, LiveDashboard, LiveHub, LiveWatch — already
use `p-4 sm:p-6`, so they are the template to copy.)

Two more cross-cutting notes:
- **Fixed-height chat/browser pages** (`h-[calc(100vh-0px)]`) don't subtract the
  PowerBar or the bottom nav, so their bottom input row hides under the phone nav.
- **Full-bleed `fixed inset-0 z-50` views/modals** (ProgramView, TournamentDetail
  modal) sit *under* the bottom nav (`z-65`); acceptable but worth an explicit
  decision (hide nav on those, or raise their z-index).

---

## Per-route audit

| Route(s) | Page | Remaining small-screen issue |
|---|---|---|
| `/marketing`, `/download` | Marketing | Full-bleed (no shell). Mostly responsive; hero `text-6xl md:text-7xl` is fine, but `whitespace-nowrap` pill (l.128) can overflow at ~320px. Low priority. |
| `/` (signed out) | Landing | `px-6 md:px-10` OK; `whitespace-nowrap` pill (l.38) may clip <340px; stat grid `grid-cols-2 md:grid-cols-4` fine. Solid. |
| `/` (signed in) | HomeMenu | Already `px-4 md:px-8` + `max-w-5xl`; big menu buttons fine. No issue. |
| `/video`, `/clans` | HomeMenu (section) | Same as HomeMenu — clean. |
| `/login` | Login | `min-h-screen` centered card, `max-w-md`. Clean. |
| `/signup` | Signup | Centered `max-w-md`, `p-10` on success card is a bit tight <360px. Minor. |
| `/legal` | Legal | Already `p-6 sm:p-8` + `max-w-3xl`. Clean. |
| `/terms` | Terms | Long-form text; verify it uses `p-6 sm:p-8` like siblings. Likely clean. |
| `/privacy` | Privacy | `p-6 sm:p-8` + `max-w-3xl`. Clean. |
| `/data-deletion`, `/account/delete` | DataDeletion | `p-6 sm:p-8` + `max-w-3xl`. Clean. |
| `/reels` | Reels | `p-8` container; grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` fine; search input `w-full md:max-w-md` fine. Only the `p-8`. |
| `/reels/:id` | ReelDetail | `p-8`; friend-gift form input `min-w-[220px]` + two `w-20` inputs can overflow a 360px row — needs wrap. |
| `/reels/create`, `/highlight/create` | CreateHighlight | `p-8`; clip tray `overflow-x-auto` OK; combine-options `grid sm:grid-cols-2` OK; add-clip row `min-w-[200px]` + `w-20`×2 overflows narrow — wrap. |
| `/matches` | Matches | `grid ... lg:grid-cols-3` fine; header create button row OK. Just the outer padding. |
| `/matches/create` | CreateMatch | `p-8` + `max-w-2xl`; simple form. Clean besides padding. |
| `/matches/:id` | MatchDetail | `p-8` + `max-w-4xl`; `aspect-video` tiles fine. Clean besides padding. |
| `/tournaments` | Tournaments | `p-8`; create form is long with many full-width inputs — fine stacked; filter buttons row could wrap. Padding is main issue. |
| `/tournaments/:id` | TournamentDetail | Heavy page. `grid grid-cols-3` (l.1501 vote buttons) is fixed 3-up — cramped <360px. Modal `fixed inset-0 ... max-h-[90vh]` footer buttons can hide under bottom nav (`z-65`). Several `ml-auto ... shrink-0` action chips risk crowding the title row. |
| `/boards` | Boards | `grid ... lg:grid-cols-3` fine; empty state centered. Padding only. |
| `/live` | LiveHub | Already `p-6 sm:p-8`; toolbar `flex-wrap`. Clean. |
| `/watch`, `/watch/:id` | LiveWatch | Already `p-4 sm:p-8` + `max-w-5xl`; `aspect-video` player. Clean. |
| `/live-streams` | Live | `p-8` + `max-w-4xl`; multi-section host/watch UI, grids `grid-cols-2 md:grid-cols-4` fine; many inline button rows — audit for wrap. Padding + dense controls. |
| `/director` | Director | Already `p-4 sm:p-6`; thumb strip `overflow-x-auto` contained; action grid `grid-cols-2 sm:grid-cols-3`. Clean. |
| `/live-dashboard` | LiveDashboard | Already `p-4 sm:p-6`; transport controls `grid-cols-2 sm:grid-cols-4`; input `min-w-[220px]` in a `flex` — confirm wrap. Mostly clean. |
| `/broadcast` | Broadcast | Already `p-4 sm:p-6`; tile grid caps at `sm:grid-cols-2`; title uses `truncate`. Clean. |
| `/program`, `/program/:groupId` | ProgramView | Full-bleed `fixed inset-0 z-50` multiview; side rail `hidden lg:block w-[320px]`. Bottom nav (`z-65`) floats over it on phones — decide hide-nav vs raise z. |
| `/go-live` | GoLive | `p-8`→ later states `p-6 sm:p-8`; forms `grid sm:grid-cols-2`. Mostly padding. |
| `/my-clips` | MyClips | `p-8`; grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` fine; search `w-full md:max-w-md`. Padding only. |
| `/ai` | AI | `p-8` + `max-w-4xl`; `grid md:grid-cols-2`. Padding only. |
| `/ai/label` | AILabel | `p-6` + `max-w-6xl`; input `min-w-[280px]` can force overflow <360px; keyboard-shortcut chip row uses `flex-wrap` (good). Watch the wide input. |
| `/discover` | Discover | `p-8` + `max-w-2xl`; search row `flex` (input + button) — fine, button won't wrap. Padding only. |
| `/connect` | Connect | `p-8` + `max-w-3xl`; simple stacked cards. Padding only. |
| `/rankings` | Rankings | `p-8` + `max-w-4xl`; list rows — check for wide numeric rows / nowrap. Padding + verify rows. |
| `/stat-check` | StatCheck | `p-8` + `max-w-4xl`; simple. Padding only. |
| `/stat-check-room` | StatCheckRoom | `p-8`; submissions `grid-cols-1 sm:grid-cols-2` + `aspect-video`. Padding only. |
| `/submit-result` | SubmitResult | KDA `grid sm:grid-cols-3` stacks on phone; image upload OK. Padding/verify. |
| `/notifications` | Notifications | `p-8` + `max-w-2xl`; list rows. Padding only. |
| `/dashboard` | Dashboard | `p-8`; stat cards `grid-cols-2 md:grid-cols-4` (2-up on phone, OK); body `grid lg:grid-cols-3`. Padding only. |
| `/redeem` | Redeem | `p-8` + `max-w-md`; single code form. Padding only. |
| `/store` | Store | `p-8` + `max-w-5xl`; product grid `grid-cols-1 sm:grid-cols-2`. Padding only. |
| `/shop` | Shop | `p-8`; grids `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` — 2-up cards on phone can feel cramped with `aspect-square` art + text; header wallet row may crowd. Padding + tighten cards. |
| `/oracle` | Oracle | `p-8` + `max-w-5xl`; stat grid `grid-cols-2 sm:grid-cols-4`, card grid `grid-cols-2 ... lg:grid-cols-4`. 2-up on phone OK; padding main issue. |
| `/upgrade` | Upgrade | `p-8`; tier grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5` — 5 tiers become 2-up on phone (tall). Acceptable; padding only. |
| `/browser` | Browser | `flex flex-col h-[calc(100vh-0px)]` — bottom controls hide under phone nav; address bar row has several `shrink-0` buttons + `min-w-0` input that will overflow a 360px row. HIGH: height + control row. |
| `/boards/create` | CreateServer | `p-8` + `max-w-md`; tiny form. Padding only. |
| `/boards/:serverId/:channelId?` | BoardDetail | `flex flex-col h-[calc(100vh-0px)]` chat — the message composer at the bottom hides under the phone bottom nav; channel layout may also need a mobile drawer. HIGH: fixed height + composer collision. |
| `/profile`, `/profile/:userId` | Profile | `p-8` + `max-w-3xl`; clan/DM panel uses fixed `w-64 shrink-0` column + `max-h-[60vh]`/`max-h-48` scrollers and DM bubbles `max-w-[80%]` — the two-column chat area is cramped/overflow-prone on phones. HIGH-ish: convert side column to stacked/drawer. |
| `/profile/:userId/trophies` | ProfileTrophies | `p-8` + `max-w-4xl`; trophy list. Padding only. |
| `*` | — | Redirect to `/`. N/A. |

### Legend
- **Padding only** = looks fine once the global `p-8 → p-4 sm:p-6 lg:p-8` swap lands.
- **HIGH** = real overflow/collision on a 360–390px phone; prioritize in the per-screen pass.

---

## Per-screen cleanup pass — DONE ✅

Verified after this pass: `tsc` → 0 errors · `vitest` → 107 passed (13 files) ·
`vite build` → ok · `VITE_BASE_PATH=/app/ vite build` → ok.

### 1. Container padding (`p-8 → p-4 sm:p-6 lg:p-8`) — swept ✅
All page-body containers converted (inner `bg-dark-card p-8` cards and centered
loader wrappers intentionally left as-is):
AI, AILabel (`p-6 → p-4 sm:p-6`), Boards, Connect, CreateHighlight, CreateMatch,
CreateServer, Dashboard (×2), Discover, GoLive (×3), Live, MatchDetail, Matches,
MyClips, Notifications (×2), Oracle (×2), Profile, ProfileTrophies (×2), Rankings,
Redeem (×2), Reels, ReelDetail, Shop (×2), StatCheck, StatCheckRoom, Store (×2),
SubmitResult, Tournaments, TournamentDetail (×2), Upgrade.

### 2. Bottom-nav clearance — done ✅
- **BoardDetail** — outer height now `h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] sm:h-[calc(100vh-0px)]` so the composer clears the phone bottom nav; channel rail `w-40 sm:w-56 shrink-0` so chat isn't crushed on phones.
- **Browser** — same responsive height so the framed site / bottom edge clears the nav (address row already `flex-wrap`).
- **ProgramView** — full-bleed view now insets its bottom above the nav on phones (`bottom-[calc(4rem+env(safe-area-inset-bottom))] sm:bottom-0`); it has no close button, so the nav stays reachable.
- **TournamentDetail entry modal** — raised to `z-[80]` (above the `z-[65]` nav) so its footer/submit stays usable; it has its own ✕ close.

### 3. Progressive disclosure (CollapsibleSection) — done ✅
- **TournamentDetail** — already tab-driven; Overview keeps Oracle card + entry-cost open, with **Schedule** (defaultOpen) and **Rules** collapsibles already in place. Also fixed the creator-decision `grid-cols-3 → grid-cols-2 sm:grid-cols-3`.
- **Profile** — tab-driven; **Sources** already collapsible; DM tab two-column now stacks (`flex-col sm:flex-row`, list `w-full sm:w-64`).
- **Store** — currency explainer tucked under **More**.
- **Shop** — "Design & sell" upload form tucked under **Upload**.
- **Oracle** — badges under **Stats**, locker under **More**; stat cards + "Your calls" stay open.
- **CreateHighlight** — already has a Simple/**Advanced** toggle gating all-layouts + friend-invite/uploads; Auto/Director presets + clips stay visible.

### 4. Sizing / overflow — verified ✅
Add-clip / friend-gift rows in **CreateHighlight** and **ReelDetail** already use
`flex flex-wrap` (input `flex-1 min-w-[200/220px]` + `w-20` fields wrap, no 360px
overflow). Header rows use `flex-wrap`; oversized headings are `text-2xl`.

### Remaining / not converted
- Loader & empty-state `p-8 flex items-center justify-center` wrappers and inner
  `bg-dark-card p-8` cards left as-is (centered content, no phone overflow).
- Auth cards (Login/Signup `p-8`) left roomy; fine at `max-w-md`.
- No further collapsible conversion attempted on already-tabbed pages
  (TournamentDetail, Profile) beyond what's noted above.
