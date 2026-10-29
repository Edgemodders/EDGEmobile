---
title: Design
---

# EDGE<span class="y">mobile</span> design

EDGEmobile is a phone operating system for Cyberpunk 2077, built as a [REDnode](https://edgemodders.github.io/REDnode/) app. One phone shows on two screens:

- **In the game**, as a phone drawn over the game by REDnode's overlay.
- **On the player's real phone**, as a web app they open from a QR code and can install to their home screen (a PWA).

The phone's home screen shows an icon for each **mobile app** installed in it. Other modders write mobile apps and players install them. The first is **Chooms!**, Night City's social feed, to be designed after the OS works.

This page is for developers. It records what was decided, how it will be built, and each phase with its test. Anything marked *proposed* is not agreed yet, and anything marked *unverified* has not been tried.

## Decided

Agreed with the user on 2026-10-28 and 2026-10-29.

| What | Decision |
|---|---|
| What it is | A REDnode app, built, downloaded and installed apart from REDnode, with its own repo (this one), version, changelog, zip and Nexus page |
| Why now | It is a side project ahead of REDnode's schedule, because it may change and improve REDnode itself. REDnode's schedule resumes after it |
| The two screens | A phone view in the game, on REDnode's overlay and HUD, and a real-life endpoint that a real phone opens and can install as a PWA |
| How a real phone reaches the PC | A REDnode Node mod runs a web server on the PC, behind a free Cloudflare quick tunnel (`https://….trycloudflare.com`). EDGEmobile sets up the tunnel itself: the player never uses Cloudflare's command line and makes no Cloudflare account |
| Where the phone app comes from | The player's PC, through the tunnel: the shell, the `mobile` library, the mobile apps and the live game data. A tiny fixed **loader** page lets the installed app find the PC again after a restart (option D in [Installing on the phone](#installing-on-the-phone-pwa); agreed 2026-10-29, to be tried in M1) |
| How a phone gets in | The game shows a QR code. The phone scans it and shows a pairing code. The game shows the same code with **Allow** and **Deny**, and the player allows it |
| Who gets in | Only a phone that has the QR code's link with its one-time key **and** was approved by someone at the PC. Either alone gets nothing (see [Pairing and security](#pairing-and-security)) |
| How players are told | That the tunnel gives the PC a private web address, always together with how the two conditions keep others out. Never "exposes" (see [What players are told](#what-players-are-told)) |
| First screen after pairing | The EDGEmobile home screen, with no apps installed at first |
| Mobile apps | Made by third-party modders and installed by players. They unpack into a folder inside EDGEmobile's REDnode folder, where EDGEmobile finds them |
| Using apps | Tap an icon to open its app. Swipe left or right to cycle through the apps. There is an easy way back to the home screen |
| Dock buttons | Phone, Messages, Camera and Browser, from the prototype. On a real phone they open the phone's own dialer, messages, camera and a browser tab. In the game there is no dock for now (the user, 2026-10-29) |
| Look | The **Chooms! prototype** design canvas (the user's artifact; its Home screen is the basis for the OS), with the **Night City Mobile UI** design system |
| Themes | **Night City** (the design system) by default, and **Edgemodders** (this repo's house style: yellow, cyan, green, the grid). One theme for both screens, kept on the PC (the user, 2026-10-29) |
| The phone in the game | A transparent, borderless window: a phone frame in the game's own UI red with the OS inside. Only the frame drags it around the screen; it can be pinned to the HUD (the user, 2026-10-29) |
| The first app | Chooms!, the social media app, discussed once the OS is built |

## How it fits REDnode

EDGEmobile is one REDnode package, `edgemobile`, installed in `red4ext/plugins/REDnode/apps/edgemobile/`.

| Part | Where | What it does |
|---|---|---|
| Node mod | `edgemobile/mod.mjs` | Runs the web server and the WebSocket on `127.0.0.1`, starts and watches the tunnel, keeps paired phones and the phone's state, finds mobile apps, and answers both screens |
| Phone window | `edgemobile/shell/` (pairing and the clock from M2; the OS from M3) | The OS, shown in a REDnode overlay window shaped like a phone. The same files are served to the real phone |
| Connect window | `edgemobile/connect/` (from M2) | Onboarding in the game: the QR code, the pairing code with Allow and Deny, and the list of paired phones |
| Mobile apps | `red4ext/plugins/REDnode/mobile-apps/<id>/`, beside EDGEmobile's folder (from M4) | One folder per installed app, with its own `mobile-app.json` |
| Tunnel program | `<pkg.dataDir>/cloudflared/<version>/cloudflared.exe` | Cloudflare's `cloudflared`, fetched on first use (see [The tunnel](#the-tunnel)) |
| Paired phones | `<pkg.dataDir>/phones.json` | Each phone's public key, its name and when it was last seen. Nothing in it is secret |

REDnode's parts it uses: Node mods (`main`), page windows, Pin to HUD, `pkg.dataDir`, `game` and `api` for the game's time and place, and services and roles (`use`) for app back ends.

## Onboarding a real phone

The sequence the player sees, the first time:

| Step | In the game | On the phone |
|---|---|---|
| 1 | The player opens EDGEmobile's **Connect a phone**. The first time, it says it will fetch Cloudflare's tunnel program (its size, from GitHub) and asks to go on | |
| 2 | EDGEmobile fetches `cloudflared`, checks its SHA-256 against the one pinned in EDGEmobile's source, starts the local server and the tunnel, and reads the tunnel's address | |
| 3 | The window shows a QR code, with "Scan this with your phone's camera" and a countdown | |
| 4 | | The player scans it. The phone opens the loader, which shows the PC's phone page full screen. The page connects and shows a pairing code, such as `482 913` |
| 5 | The window shows "A phone wants to connect: **482 913**", with the phone's browser and system, and **Allow** and **Deny** | "Check that the game shows the same code" |
| 6 | The player checks the codes match and presses **Allow** | |
| 7 | The phone shows in **Paired phones** | The loader keeps the phone's signing key and the PC's page shows the EDGEmobile home screen, with no apps yet |
| 8 | | The loader offers **Install** (Add to Home screen) |

After a game restart, the tunnel's address is new (see [The tunnel](#the-tunnel)), so the phone has to find the PC again. A phone already paired does not need the pairing code again. It scans the QR code once more, either with its camera or with **Scan the code** in the installed app, and the home screen comes back, with no pairing code and no Allow (from M2).

### What the QR code holds

`https://mobile.edgemodders.ai/#h=<tunnel host>&k=<one-time key>` (from M2; the loader was on GitHub Pages in M1).

- The part after `#` (the fragment) never leaves the phone, so the loader's host never sees the tunnel's address or the token. The loader reads it and shows `https://<tunnel host>/` in a full-screen frame.
- The loader is served from one fixed address, so the installed app keeps working after the tunnel's address changes (see [Installing on the phone](#installing-on-the-phone-pwa)).

## Pairing and security

The tunnel gives the player's PC a web address on the internet, so their phone can reach the game from anywhere. The address alone lets no one in. A phone gets in only when **both** of these are true:

| Condition | How it is checked | What it stops |
|---|---|---|
| **1. It has the QR code's link, with its one-time key** | The key is 128 random bits, carried after the `#` in the link. It works once, and only for about a minute | Anyone who finds or guesses the address, and anyone who tries keys: 128 bits cannot be guessed in any number of tries. An old QR code from a screenshot or a stream has already expired |
| **2. Someone at the PC approved it** | The game shows the phone's pairing code with **Allow** and **Deny**. Nothing happens until the player presses Allow | A phone that got a valid link anyway, for example a viewer who saw the QR code on a stream and scanned it first: the player sees a code that does not match their phone and presses Deny |

Neither condition is enough alone. A valid link without approval waits until it expires. Approval can only be given to a phone that brought a valid link.

**What anyone else gets.** The tunnel serves the shell's static files and the pairing screen to anyone, since a phone needs them before it has a key. They hold no game data and no secrets, and serving them reaches nothing in the game. Everything else (game data, mobile apps' files, the WebSocket) needs a valid one-time key or session. A request without one gets the same short refusal every time, with no hint of what was wrong, and nothing reaches the game.

The rules that keep it that way:

| Rule | Why |
|---|---|
| One pairing waits at a time. Repeated tries from one address are answered more slowly | No one can flood the player with requests or approval dialogs |
| A paired phone proves itself by signing a fresh challenge with a key its browser will not give out. The PC keeps only public keys (from M2; in M1, the hash of a session key) | A copy of `phones.json` lets no one in |
| **Paired phones** lists each phone with **Disconnect**, which drops its key | The player can remove a phone at any time |
| A phone can do only what EDGEmobile and its apps offer. It never reaches REDnode's `api`, the MCP server or files | A paired phone cannot run code in the game |
| The server listens on `127.0.0.1` only | A phone reaches it only through the tunnel, never over the home network |
| Only the PC's own page may open the WebSocket: its `Origin` header must be the tunnel's own address | Other websites the phone visits cannot use the session |
| Each signature names the origin the phone talks to, and the loader signs only for the page in its own frame, naming that page's origin (from M2; see [M2 plan](#m2-plan)). Through the tunnel, only the loader may frame the PC's page | A QR code made by someone else, naming another address, gets the loader to show that site, but nothing it gets works at the player's PC. A copy of `phones.json` holds no secret |
| Closing EDGEmobile, or the game, stops the server and the tunnel | Nothing stays open after the game |

**Cloudflare carries the traffic.** A quick tunnel ends HTTPS at Cloudflare's edge, so the traffic is decrypted there before it travels on to the PC. *Proposed, later:* encrypt the WebSocket's messages end to end with a key carried in the QR code's fragment, which Cloudflare never sees.

### What players are told

Players should know the tunnel is there, and in the same breath how it keeps others out, so it reads as what it is: a private, locked connection. Say "a private web address" or "reachable from your phone". Avoid words like "exposes" or "open to the internet", which suggest nothing guards it.

*Proposed* text for the Connect window, shown before the first tunnel starts:

> EDGEmobile gives your PC a private web address through Cloudflare, so your phone can reach the game from anywhere. Only a phone that scans this code, and that you allow here, can connect. You can disconnect it at any time, and the address closes when the game does.

*Proposed* text for the Nexus page:

> **How your phone connects, and how others are kept out.** EDGEmobile starts a free Cloudflare tunnel that gives your PC a private web address for your phone. A phone gets in only when both are true: it scanned the QR code shown in your game, whose one-time key works once and expires in a minute, and you pressed Allow in the game after checking its pairing code. Anyone else who reaches the address is refused. Connected phones can be removed at any time, and the address closes with the game.

REDnode has no permission yet that tells the player a package starts a tunnel or another program, so EDGEmobile says it itself, as above. A REDnode permission for it is on the [list for REDnode](#what-it-may-ask-of-rednode).

## The tunnel

A Cloudflare quick tunnel gives a free HTTPS address with no account. It always needs Cloudflare's `cloudflared` program. No JavaScript version of its protocol is known to us.

| Step | How |
|---|---|
| Fetch | `cloudflared-windows-amd64.exe` from Cloudflare's GitHub releases, at a version pinned in EDGEmobile, checked by a pinned SHA-256, kept in `<pkg.dataDir>/cloudflared/<version>/`. The same idea as REDagent's fetch of the Agent SDK. `cloudflared` is Apache-2.0 licensed, so shipping it in the zip is allowed too, but it would make the zip much larger |
| Start | The mod starts the **tunnel keeper** (`server/keeper.mjs`), a small Node process run with REDnode's own host program (`ELECTRON_RUN_AS_NODE=1`; the packaged host runs it as Node 24.21, checked 2026-10-29). The keeper runs `cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:<port> --url http://127.0.0.1:<port>` and reads the `https://….trycloudflare.com` address from its output |
| Ready | Only when the metrics port's `/ready` answers **and** trycloudflare.com's own name servers have the new name. A public resolver asked too early remembers "not found" for 60 s (the zone's negative TTL), which broke the first check outside the game. Took 2 to 4 s after the address appeared |
| Stop | REDnode ends a mod's thread with no last call, so the mod cannot stop `cloudflared` itself. The keeper holds a link to the mod and stops `cloudflared` 15 s after the link is gone (checked outside the game). **Stop the tunnel** in the window stops it at once. The game ending ends both through REDnode's job object (*unverified*) |
| Keeper started detached | Node ends the children it starts when its process ends (they go into a job object of Node's own; found outside the game). Detached, the keeper outlives a restart of the mod's process and stays in REDnode's job |

Limits of quick tunnels, from Cloudflare's docs (*check again in M1*):

| Limit | Effect on EDGEmobile |
|---|---|
| A random address that changes each time the tunnel starts | The phone has to scan again after each game start. A fixed address needs a Cloudflare account and a named tunnel |
| Meant for testing, with no uptime promise | Fine for a game companion. Say so on the Nexus page |
| About 200 requests in flight at once | Plenty for one player's phones |
| No Server-Sent Events | Live updates go over a WebSocket |

**Keeping the address across restarts of the mod.** REDnode restarts a mod when its files change while hot reload is on, and a new tunnel means a new address. The mod uses one fixed local port, chosen at first start and kept in `<pkg.dataDir>/settings.json`, and writes the keeper's link port and token to `<pkg.dataDir>/tunnel.json`. A restarted mod links to the keeper again and keeps the address, and paired phones only reconnect (checked outside the game, and in it on 2026-10-29).

## The OS

The OS is one web app, the shell, shown on both screens. Its first screen is the home screen from the prototype's **Home screen** artboard.

### The home screen

| Area | Content |
|---|---|
| Status line | District and weather, from the game (the user's rule, 2026-10-29: the game's own values, left out where the game has none). The prototype's temperature is left out: the game has none |
| Clock | Night City's time in large type, with a red rule and the date below, as `Friday, 28 October 2077`, on both screens (the user's rule, 2026-10-29) |

What the game offers, read from REDnode's game API reference for 2.5 (*unverified* in the game until M3):

| Value | In the game | Shown as |
|---|---|---|
| Time | `TimeSystem.GetGameTime()`: days, hours, minutes and seconds | The game's time |
| Date | No calendar date. The game counts days since the playthrough began and shows no date | 1 January 2077 plus the game's day count, so the date turns with the game's nights |
| Weather | The script `WeatherSystem` gives only rain (intensity and kind). The named weather (sunny, fog, smog, toxic rain, sandstorm) is not reachable from scripts | Rain now. The named weather if M3 finds a way to read it, possibly as a REDnode request |
| Temperature | None (only vehicles' and audio's) | Left out |
| District | `GetCurrentDistrict` exists | The district |
| No save loaded | No game time at the main menu | The last game time read, frozen and dimmed, with "No signal from Night City" |
| App grid | Four columns. Each app is its icon (64 px, cut corner) with its name below, and a yellow badge for new items. More apps than fit go on further pages, swiped sideways, with page dots above the dock |
| Empty state | With no apps installed: a panel saying no apps are installed yet and where they go. This is what every player sees first |
| Dock | Phone, Messages, Camera, Browser |

### Opening apps and getting home

| Action | What happens |
|---|---|
| Tap an icon | Its app opens full screen |
| Swipe left or right | The next or previous app, cycling through them in home screen order. *Proposed:* along the home bar at the bottom of the screen, as phones do, so the swipe does not clash with apps that scroll sideways |
| Swipe up on the home bar, or tap it | Back to the home screen |
| In the game | Mouse drags do the same as swipes. *Proposed:* `Esc` inside the phone goes home first, then closes |

An open app stays open while the player uses other apps, until the phone needs its memory (*proposed*).

### The dock on each screen

| Button | On a real phone | In the game |
|---|---|---|
| Phone | Opens the phone's dialer (a `tel:` link) | *Proposed, later:* the game's own phone or a contacts app. Hidden or greyed until then |
| Messages | Opens the phone's messages (an `sms:` link) | *Proposed, later:* EDGEmobile's own messages app |
| Camera | Takes a photo with the phone's camera (a file picker with `capture`, or the camera through `getUserMedia`, which HTTPS allows) | *Proposed:* a picture of the game, without the overlay, kept in EDGEmobile's gallery. Needs a REDnode call for it (see below) |
| Browser | Opens the phone's browser | *Proposed, later* |

Photos from either camera go into one gallery on the PC, so an app like Chooms! can post them.

### One phone, two screens

*Proposed:* both screens show the same phone. Installed apps, badges, notifications and each app's data are kept by the mod on the PC and shared. Each screen moves around on its own: opening an app on the real phone does not open it in the game.

### The phone in the game

| Question | Proposal |
|---|---|
| How it shows | A REDnode page window shaped like a phone, at 390 × 844 CSS px scaled to fit the screen's height (*unverified:* REDnode windows have no zoom setting yet) |
| During play | Pin to HUD keeps it on screen. Unpinned, it shows with the overlay (F10) |
| Opening it | From the launcher for now. A key of its own needs REDnode support (see below) |
| How it talks to the mod | Through REDnode's page calls to its own mod, not the tunnel |

## Mobile apps

A mobile app is a folder in `red4ext/plugins/REDnode/mobile-apps/<id>/`, beside EDGEmobile's own folder. It is plain web files, shown inside the shell.

*Proposed* `mobile-app.json`:

```json
{
  "id": "chooms",
  "name": "Chooms!",
  "version": "0.1.0",
  "author": "Edgemodders",
  "description": "Night City's social feed.",
  "entry": "index.html",
  "icon": "icon.svg",
  "requires": { "edgemobile": ">=0.1.0" }
}
```

| Question | Proposal |
|---|---|
| How it runs | In a sandboxed frame inside the shell, so an app cannot read the shell's session key, another app's data, or the page around it |
| How it talks | Through a small `mobile` library EDGEmobile gives every app: which screen it is on, its badge, notifications, its own storage on the PC, photos from the gallery, the game's time and place |
| A back end in the game | An app that needs the game, or work done on the PC, ships a REDnode package beside it, and calls it through EDGEmobile by package id or by role (`use`, REDnode 0.44.0). The phone never calls REDnode directly |
| How its files reach the real phone | Through the tunnel, behind the session key, cached by the phone page. How a sandboxed frame loads them is a spike item in M4 |
| Installing | A mod manager unpacks the app's zip into `mobile-apps/`. EDGEmobile finds it at start, and while it runs when the folder changes |

**Why beside, not inside.** While REDnode's hot reload is on (it is for developers, not for players), any change inside a package's folder restarts its mod. An app installed inside EDGEmobile's folder while the game runs would restart EDGEmobile's server, and the tunnel's address could change. In a folder of its own beside it, it does not, and an update of EDGEmobile never touches the apps a player installed.

## Installing on the phone (PWA)

A web app installs on a phone's home screen when it is served over HTTPS with a manifest and a service worker. The tunnel gives HTTPS. But an installed app is tied to the address it came from, and a quick tunnel's address changes each start, so an installed app served from the tunnel would break after every restart.

The phone app itself comes from the player's PC (agreed 2026-10-29). The shell, the `mobile` library and the mobile apps then always come from the same install, so third-party apps run against the library they were written for, and the live game data comes straight from the game. Option A, the whole shell on GitHub Pages, was dropped for that reason: its version could differ from the player's EDGEmobile and the apps on their PC.

| Option | Good | Bad |
|---|---|---|
| **D. Everything from the PC, plus a tiny fixed loader** (*agreed, to be tried in M1*) | The loader is a small static page at a fixed address. It keeps the session key, scans the new address after a restart, and shows the PC's page full screen in a frame. Everything that matters comes from the PC. The loader almost never changes, so it cannot fall out of step | The loader needs a fixed address (GitHub Pages at first). A frame needs care with the camera (`allow="camera"`) and with `tel:` and `sms:` links, which must open from the whole page (both checked on Android in the M1 test). How iPhones treat an installed app showing another site in a frame is *unverified* |
| B. Everything from the PC, no loader | Simplest. Nothing hosted | The installed app breaks at each game start, so installing is pointless. The player scans again in the browser each session. The fallback if D fails |
| C. A fixed address per player | No scanning after restarts | Needs a Cloudflare account and a named tunnel, or a small Edgemodders service that maps each PC to its current address |

**The loader's own origin.** Every Edgemodders docs site shares the origin `edgemodders.github.io`, so the key the loader keeps would sit in storage those sites share. Agreed 2026-10-29: from M2 the loader is at `https://mobile.edgemodders.ai/`, an origin of its own (see [M2 plan](#m2-plan)).

## Look

The look comes from the user's **Chooms! prototype** canvas, which uses the **Night City Mobile UI** design system. Its tokens are copied into `edgemobile/shell/theme/` (`tokens.css` and `nc.css`, the system's component styles).

| Token | Value | Use |
|---|---|---|
| Grounds | `--bg-000` `#05070b` to `--bg-300` `#151925` | Chrome, screens, panels, raised fills |
| Ink | `--ink` `#e3e6ee`, `--ink-dim` `#8a93a8` | Text, secondary text |
| Red | `--red` `#ff2a52` | The interface's voice: titles, primary buttons, the active tab |
| Cyan | `--cyan` `#19f3ff` | Interaction: selection, links, secondary buttons |
| Yellow | `--yellow` `#fcee0a` | Attention: badges, new items, the focus ring |
| Green | `--green` `#5dffa1` | Success, online |
| Type | Chakra Petch (display), Rajdhani (body), JetBrains Mono (data) | From Google Fonts |
| Shape | No rounded corners: one cut top-right corner per shape (`--cut-xs` 6 px to `--cut-lg` 20 px) | Buttons, panels, icons |

*To check:* the fonts are fetched from Google Fonts in the prototype. The shell should ship them so it works offline and in the game without fetching (their licence is the SIL Open Font License, which allows it).

## Phases

Each phase ends with a test by the user, on a real phone where it applies, before the next starts.

| Phase | What | Status |
|---|---|---|
| M0 Repo and design | The repo's scaffolding and this page | Done 2026-10-29 |
| M1 Tunnel spike | Fetch and check `cloudflared`, start a quick tunnel to a server in a REDnode mod, open a page on a real phone, a WebSocket both ways and its delay. Tested on the user's Android phone; iPhones stay *unverified* until someone tests one. Also: the loader (option D) installed on a real phone, showing the PC's page full screen in a frame, with the camera and a `tel:` link from inside it; reusing a running tunnel after a mod restart; `cloudflared` ending with the game; a REDnode page window reaching `127.0.0.1` | Done 2026-10-29: built, tested on Android, four fixes, retested ([M1 test](#m1-test)) |
| M2 Onboarding | The Connect window: the first fetch, the QR code, the pairing code with Allow and Deny, phones that prove themselves by signature, Paired phones with Disconnect, reconnecting by scan after a restart, the loader at its own address | Done 2026-10-29: built, tested on Android ([M2 test](#m2-test)) |
| M3 The OS | The shell on both screens: the home screen (status line, clock, empty app grid, dock), the dock's actions on each screen, the phone window in the game with Pin to HUD | Not started |
| M4 Mobile apps | `mobile-app.json`, finding apps, icons and badges, opening, swiping between apps, the home bar, sandboxed frames, the `mobile` library, a sample app and a modder's guide | Not started |
| M5 Install on the phone | The loader as a PWA: manifest, service worker, icons, the Scan button, offline screen, and its own origin | Not started |
| M6 Chooms! | To be designed with the user | Not started |
| Release | The zip, `requires` for REDnode, the Nexus page, the changelog | Not started |

### M1: built

Built on 2026-10-29, as EDGEmobile 0.0.2.

| Part | Where |
|---|---|
| The mod: web server, pairing, game time, the window's state | `edgemobile/mod.mjs` |
| Fetch and check of `cloudflared` 2026.10.6, the keeper's start and link | `edgemobile/server/tunnel.mjs`, `server/keeper.mjs` |
| The web server: a fixed list of files, the WebSocket's `Origin` check, Cloudflare's headers telling tunnel requests from local ones | `edgemobile/server/web.mjs` |
| Pairing: one-time key, one pairing at a time, Allow and Deny, session hashes in `phones.json` | `edgemobile/server/phones.mjs` |
| The in-game window (QR code, pairing code, connected phones, the page loaded from 127.0.0.1) | `edgemobile/spike/window.html`, `window.js` |
| The page the PC serves (pairing code, Night City's time and date, the delay both ways, camera and dialer checks) | `edgemobile/spike/phone.html`, `phone.js` |
| The loader, with its manifest, service worker and icons | `docs/phone/` |
| Libraries, shipped in the package's `node_modules` | `ws` 8.22.0, `qrcode-generator` 2.0.4 (both MIT, no dependencies) |

Even the spike follows the two conditions: a phone gets in only with the QR code's key and the player's Allow.

**Checked outside the game** (plain Node with a stand-in `rednode`, against real quick tunnels, 20 checks, all passed): the fetch matched its SHA-256; the tunnel was ready in 4 to 6 s; the page loads through it with its CSP; other paths and `phones.json` get the same "Not found."; a WebSocket from another origin, or claiming the local origin through the tunnel, is refused; a wrong key is refused after 1 s; the QR code leads to the loader; the game and the phone show the same pairing code; a used key is refused and dropped from the window; Allow gives a session whose hash only is kept; Deny refuses; the game's time arrives; the delay both ways (12 to 14 ms with this PC at both ends); the local session works at 127.0.0.1 and is refused through the tunnel; a restarted mod reuses the tunnel and the saved phone reconnects without pairing; the tunnel stops 15 s after the mod is gone. Cloudflare's headers on tunnel requests: `cf-connecting-ip`, `cf-ray`, `cf-visitor`, `cf-warp-tag-id` and others.

**Found:** a firewall that asks about programs connecting out (the user's did) asks about `cloudflared` on first start. The Connect window should say so in M2.

**First test in the game** (2026-10-29, the user's Android phone, Chrome 156 on Android 10). Passed: the fetch, the tunnel ready about 6 s after **Start** (address in 3 to 4 s, findable 1.6 to 2.1 s later), pairing through the loader with Allow, the game's time and date, the camera inside the loader's frame, installing the loader, the dimmed clock at the main menu, the page from 127.0.0.1 in the game's window, Skip the loader, hot reload (the restarted mod linked to the running tunnel and the phone was back 2 s later), Deny, Stop and Start, and no `cloudflared.exe` after quitting. Found, and fixed for the retest:

| Found | Why | Fix |
|---|---|---|
| The first **Start** failed: "An attempt was made to access a socket in a way forbidden by its access permissions" | Windows blocked `cloudflared` while the firewall's prompt was open; the second **Start** worked | The keeper recognises those words and says: allow `cloudflared` in the firewall, then press Start again. The mod no longer replaces the keeper's reason with "The tunnel stopped." |
| **Dial** without a target showed the browser's broken-page picture; **Dial (top)**, **Dial (new)** and **Message** (`_top`) worked | A `tel:` link without a target navigates the frame itself | The spike's plain **Dial** is gone. Rule for M3 and M4: the shell opens `tel:` and `sms:` links from the whole page, and mobile apps ask the `mobile` library to dial rather than writing links |
| The installed app showed the broken-page picture after a game restart | It framed the old address, which no longer exists; "Can't reach your game" came only after 10 s | The frame stays hidden behind "Connecting to your game…" until the PC's page says it is up. The loader also fetches the address first: a name that is gone fails at once, so "Can't reach your game" shows at once |
| The window listed the phone after the restart, read as still connected | The list shows every paired phone, online or not, under "Connected phones" | Renamed **Paired phones** |

**Retest** (2026-10-29, the same phone): steps 1 to 6 passed with the fixes. The delay, median round trips through the tunnel: phone → PC → phone 44 ms, PC → phone → PC 102 ms. Why the PC's way round is slower is *unverified*; a likely cause is the phone's Wi-Fi power saving, which holds traffic to the phone until the radio wakes (about every 100 ms), while the phone's own pings go out when it is awake. Step 14: "Connecting to your game…", then "Can't reach your game", without the broken page. That is the expected result, but it is not what a player expects: the installed app cannot find the game's new address without a scan (see [M2 plan](#m2-plan), "Reaching the game after a restart").

A new address still needs Allow again, since the page keeps its session under the old address: the loader keeping the session is M2's work (see [Pairing and security](#pairing-and-security)).

### M1 test

On the PC with the game, and the user's Android phone. Deploy first: `.\tools\deploy.ps1 -GameDir 'E:\SteamLibrary\steamapps\common\Cyberpunk 2077'` (the game closed). The loader must be live at https://edgemodders.github.io/EDGEmobile/phone/ (GitHub Pages publishes it on push).

| # | Step | Expect |
|---|---|---|
| 1 | Start the game. F10, the launcher, the **Mod Manager**: switch on **EDGEmobile**, pin it to the launcher, open it | The window says what the tunnel is and how others are kept out, with **Get cloudflared** (55 MB) |
| 2 | Press **Get cloudflared** | A progress bar, then **Start**. Allow `cloudflared` if a firewall asks |
| 3 | Press **Start** | A few seconds, then a QR code with a 60 s countdown, the address under it |
| 4 | Load a save. Scan the QR code with the phone's camera | The loader opens in Chrome, then the PC's page with a pairing code |
| 5 | Compare codes; press **Allow** in the game | The phone shows Night City's time and date (from 1 January 2077). Under it, the **Delay** panel: note its two **median** lines, in ms. The window lists the phone, online, with its round trip |
| 6 | On the phone: **Take a photo**, **Live camera**, **Dial (top)**, **Dial (new)** and **Message** | Each works inside the loader's frame |
| 7 | Accept the loader's **Install** (or Chrome's menu, Add to Home screen). Open the installed app | It opens the game's page again without a new scan |
| 8 | Go back to the main menu | The clock dims, "No signal from Night City" |
| 9 | In the window, the **In the game** tab: **Load it here** | The same page, from 127.0.0.1, connected as "This PC" |
| 10 | Turn on **Skip the loader**, scan again with a second browser or after **Disconnect** | The PC's page opens directly, without the loader |
| 11 | Hot reload on (launcher settings), then save `mod.mjs` in the deployed folder, `<game>\red4ext\plugins\REDnode\apps\edgemobile` (add an empty line) | The mod restarts; the address stays the same and the phone reconnects by itself |
| 12 | Scan a QR code and press **Deny** | The phone says it is not connected |
| 13 | **Stop the tunnel**; then **Start** again and pair; then quit the game | After the quit, Task Manager shows no `cloudflared.exe` |
| 14 | Restart the game, start the tunnel, open the installed app | "Connecting to your game…", then "Can't reach your game" within a second or two, never the browser's broken-page picture. A new scan connects (with Allow, until M2) |

Send back: the delays, and, if anything failed, `tunnel.log` from EDGEmobile's data folder (`%APPDATA%\@rednode\overlay\packages\edgemobile\`) and the mod's lines in `red4ext/logs/rednode-mods.log`.

**Retest after the fixes** (only what changed or was not measured): deploy again with the game closed, then steps 1 to 6 (the window now says **Paired phones**; note the delays), and step 14. The firewall message cannot be retested once `cloudflared` is allowed; it was checked outside the game with a stand-in that fails with Windows' words.

### M2 plan

Agreed with the user on 2026-10-29. M2 turns the spike into the real onboarding, and changes how a paired phone proves itself, so that after a game restart one scan brings it back with no pairing code and no Allow.

**Reaching the game after a restart.** A quick tunnel's address is new at each start, and the installed app cannot learn it by itself.

| Option | Status |
|---|---|
| One scan per game session: a paired phone that scans the new QR code is back at once | **M2** (agreed 2026-10-29). Always kept, as the fallback |
| A lookup service: the PC tells it its new address at each start, and the installed app asks it, so no scan is needed | **Later** (agreed 2026-10-29), on the user's AWS server behind NGINX, beside the loader. Designed in its own phase, with its own security check |
| The player's own Cloudflare account and a named tunnel | Not planned: a sign-up and setup for each player |

**The loader's own address** (agreed 2026-10-29): `https://mobile.edgemodders.ai/`, on the user's AWS server. NGINX passes each request on to the files on GitHub Pages (`docs/phone/`), so a push still publishes the loader, and the phone sees one origin of its own, apart from every other Edgemodders site. Let's Encrypt certificate, renewed by certbot's cron job (dry run passed 2026-10-29); HTTP redirects to HTTPS; HSTS. The copy at `edgemodders.github.io/EDGEmobile/phone/` stays, as NGINX's source, but the QR code and the PC's page name only the new address.

**How a paired phone proves itself.** Replaces the session key of M1, and designs the *proposed* rule in [Pairing and security](#pairing-and-security):

1. The loader makes an ECDSA P-256 key pair with the browser's WebCrypto, **non-extractable**: the browser signs with it, but no script, not even the loader's own, can read the private key out. It is kept in the loader's IndexedDB, on the loader's own origin.
2. The PC keeps each phone's **public key** only, in `phones.json`. A copy of the file lets no one in, and nothing in it is secret.
3. On each connection the PC sends a fresh random challenge. The page in the frame asks the loader to sign it. The loader signs `edgemobile-auth`, **the origin it is framing** (chosen by the loader, never by the page) and the challenge, and the page sends the signature. The PC checks it with the phone's public key, its own tunnel address and the challenge it sent.
4. Pairing a new phone is as in M1, with the public key added: the QR code's one-time key, the pairing code, **Allow**. Both conditions stay for every new phone.
5. A paired phone that scans a new QR code, or opens the installed app while the address is the same, is in by its signature alone.

What it stops: a QR code made by someone else, naming another site, gets the loader to frame that site, and the site can ask for signatures, but each names that site's own origin, so the player's PC refuses them. A stolen `phones.json` holds no secret. The page in the frame never holds anything that lets it in later.

A browser without the loader (a direct link) has no lasting key: its page makes a key of its own, kept only under that tunnel address, so it pairs again with Allow after each restart. The page from 127.0.0.1 in the game keeps the local session of M1, refused through the tunnel as now.

**Who may frame the PC's page.** The page served through the tunnel gets `frame-ancestors https://mobile.edgemodders.ai`, so no other site can show it in a frame. The page from 127.0.0.1 gets no frame rule yet: the in-game phone window that frames it comes in M3, and its rule with it.

**The parts.**

| Part | What changes |
|---|---|
| Connect window (`edgemobile/connect/`, replacing `spike/window`) | The first-time text on the tunnel and the two conditions; the firewall note; **Get cloudflared**, **Start**, **Stop the tunnel**; the QR code, made again by itself when its minute runs out while the window is open; **Allow** and **Deny**; **Paired phones** with online or offline and **Disconnect** (which drops the public key). The spike's **Skip the loader** goes |
| Setting: **Start the tunnel when the game starts** | Off by default (agreed 2026-10-29). On, the tunnel starts with the game when a phone is paired. Meant for the lookup service, when it becomes the default |
| Loader | The key pair and the signing (above), answering only its own frame and only for the origin it frames. On "Can't reach your game", a **Scan** button that reads the QR code with the phone's camera inside the app (Chrome's barcode reader on Android, *unverified*); the camera app stays the fallback |
| Phone page (`edgemobile/shell/`, a start of the shell) | Pairing, then a plain connected screen with Night City's clock and date. The home screen itself is M3. The spike's camera, dialer and delay checks go |
| Server | Public keys in `phones.json`; the challenge and signature check; `frame-ancestors`; the loader's address in the QR code and the page. M1's paired phones pair once more |
| Kept | The tunnel, the keeper, reuse after a mod restart, `cloudflared` ending with the game |

### M2: built

Built on 2026-10-29, as EDGEmobile 0.0.3.

| Part | Where |
|---|---|
| Pairing, the challenge and the signature check, public keys in `phones.json` (M1's phones are dropped and pair again) | `edgemobile/server/phones.mjs` |
| The web server: the shell's files, `frame-ancestors https://mobile.edgemodders.ai` through the tunnel, each connection's origin passed to pairing | `edgemobile/server/web.mjs` |
| The mod: a challenge on each connection, the loader's address in the QR code, the setting **Start the tunnel when the game starts** | `edgemobile/mod.mjs` |
| The Connect window | `edgemobile/connect/window.html`, `window.js` |
| The phone page: pairing, then Night City's clock; signs through the loader, or with a key of its own when opened directly | `edgemobile/shell/index.html`, `phone.js` |
| The loader: the key pair, signing for its own frame only, **Scan the code** | `docs/phone/`, served at https://mobile.edgemodders.ai/ |

The spike's files (`edgemobile/spike/`) are gone.

**Checked outside the game** (plain Node with a stand-in `rednode`, against real quick tunnels; Node's WebCrypto signs as a phone's browser does; 34 checks, all passed): an M1 phone is dropped; the page through the tunnel carries the frame rule, the one from 127.0.0.1 does not; `phones.json`, the window and the mod are not served; each connection gets a challenge first; refused, each after the pause: an unknown phone without a key, a signature made for another site even with a valid key, a signature over another connection's challenge, a broken signature, the key without a public key, a wrong key, the same key twice; the game and the phone show the same pairing code; `phones.json` keeps the public key only; the paired phone is back by signature alone (130 ms), also with a stale key; its signature for another site is refused; Deny; Disconnect closes the phone and drops its key; the local session works at 127.0.0.1 only; a restarted mod reuses the tunnel and the phone is in by signature; with the setting on, the tunnel starts with the mod and the phone is in at the new address with no Allow.

**Checked in Chrome on the PC** (the real loader at https://mobile.edgemodders.ai/, a real tunnel, Allow pressed by the harness): the loader made a P-256 key the browser reports as not extractable; the frame showed the PC's page; it paired; opened again with no key, it was in by signature with no pairing code; the PC's page refused to be framed by any origin but the loader's (tried from its own origin); opened directly, the page made a key of its own, also not extractable, and without a QR key showed "Not connected".

**Found:** Windows Firewall allows a program by its path, so a copy of `cloudflared` in another folder is blocked again: the harness's copy was, and the window's firewall message showed, as built in M1. Players are not affected, since EDGEmobile keeps one folder per `cloudflared` version; a new pinned version means one new firewall prompt.

Left to the M2 test, and confirmed there: **Scan the code** (Chrome's barcode reader on Android), the installed app sharing the loader's key with Chrome after a scan with the camera app, and the Connect window in the game.

### M2 test

On the PC with the game, and the user's Android phone. Deploy first: `.\tools\deploy.ps1 -GameDir 'E:\SteamLibrary\steamapps\common\Cyberpunk 2077'` (the game closed). On the phone, uninstall the M1 app (from `edgemodders.github.io`) first: the PC's page no longer shows inside it.

| # | Step | Expect |
|---|---|---|
| 1 | Start the game. F10, the launcher, open **EDGEmobile** | The Connect window: **Start**, with the firewall note. **Paired phones** is empty: the M1 phone must pair again |
| 2 | **Start** | A QR code; when its minute runs out, a new one follows by itself |
| 3 | Load a save. Scan with the phone's camera | Chrome opens `mobile.edgemodders.ai`, then the pairing code |
| 4 | Compare codes; **Allow** | The phone shows Night City's clock and date. The window lists the phone, online |
| 5 | Install the app (its **Install**, or Chrome's menu, Add to Home screen). Close Chrome. Open the installed app | Connected, with no scan and no Allow |
| 6 | Quit the game. Start it again, and **Start** the tunnel. Open the installed app | "Can't reach your game", with **Scan the code** |
| 7 | **Scan the code**, at the game's QR code | Connected, with no pairing code and no Allow |
| 8 | Quit and restart the game again; **Start**. This time scan with the phone's camera app instead | Connected, in Chrome, with no Allow. Open the installed app: connected there too |
| 9 | Turn on **Start the tunnel when the game starts**. Quit and restart the game, and load a save without opening the window | The tunnel starts by itself (open the window to see it ready). Scan: connected with no Allow |
| 10 | **Disconnect** the phone | The phone shows "Not connected". Scanning again needs the pairing code and Allow |
| 11 | Scan, and press **Deny** | "Not connected" |
| 12 | Quit the game | Task Manager shows no `cloudflared.exe` |

Send back: anything that did not match, and if the tunnel misbehaved, `tunnel.log` from `%APPDATA%\@rednode\overlay\packages\edgemobile\` and the mod's lines in `red4ext/logs/rednode-mods.log`.

**Result** (2026-10-29, the user's Android phone): all 12 steps as expected. A paired phone came back after each game restart with one scan, by **Scan the code** in the installed app and by the camera app, with no pairing code and no Allow; the setting started the tunnel with the game; Disconnect and Deny refused; `cloudflared` ended with the game.

### M3 plan

*Proposed* 2026-10-29, for the user's approval. M3 builds the OS's first screen on both screens, the phone in the game, and the two themes.

**What the game offers** (read from REDnode's game API reference for 2.5; *unverified* in the game):

| Value | How | Shown as |
|---|---|---|
| District | `PreventionSystem.GetCurrentDistrict()` gives the `District`; its record's `LocalizedName()` (a LocKey, read through REDnode's localization) and `ParentDistrict()` | The top district, "Watson" |
| Weather | `WeatherSystem.GetRainIntensityType()`: no rain, light or heavy. Its listener reports only rain too. The named weather (smog, fog, sandstorm) is not reachable from scripts | "Light rain", "Heavy rain", nothing when dry |
| Temperature | None | Left out: the status line is "Watson · Light rain" |

**The parts.**

| Part | What |
|---|---|
| Home screen (`edgemobile/shell/`) | The prototype's Home screen: the skyline and grid behind; the status line; Night City's clock, the rule and the date; the app grid, holding **Settings** until mobile apps arrive in M4; the page dots; the dock. Pairing stays as the first screen of a new phone. Laid out for 360 to 430 px wide |
| The dock on a real phone | **Phone** opens the dialer (`tel:`), **Messages** the messaging app (`sms:`), **Camera** the phone's camera (the photo stays on the phone; nothing is sent), **Browser** a new browser tab. Each opens from the whole page, not the frame (M1's rule) |
| Settings | A screen with **Theme**: Night City or Edgemodders. The choice goes to the PC (`settings.json`), and every connected screen switches at once |
| Themes | Colour sets over the same layout, as CSS custom properties, so every later screen gets both. **Night City**: the design system as it is. **Edgemodders**: yellow takes red's role as the voice (titles, the main button, the rule, the active item), cyan stays interaction, green success, red attention (badges); the 32 px cyan grid with the soft yellow glow from the banner; yellow corner brackets on hero panels (the clock). Cyan wherever the house style might suggest blue (the user, 2026-10-29) |
| The phone in the game | EDGEmobile's window becomes the phone: a transparent, borderless page with a phone frame drawn in the game's UI red, `#ff6158` (REDnode's own `hud` theme, which matches the game's menus), about 340 × 700 px on screen. Only the frame is the drag handle (`data-rednode-drag`); the screen inside takes taps and scrolls as usual. The screen is the shell from 127.0.0.1 with the local session (M1), so both screens run the same code and data. No dock in the game. **Pin to HUD** in REDnode's Mod Manager keeps it on screen during play (in play, the game keeps the mouse: the phone shows but takes taps only with the overlay open, F10) |
| Connect a phone | A drawer beside the phone, opened from a small icon on the frame, and by itself when a phone asks to pair. The same content as the M2 Connect window |
| Fonts | Chakra Petch, Rajdhani and JetBrains Mono shipped as woff2 in `edgemobile/shell/fonts/` with their SIL Open Font License files, served to both screens, so nothing is fetched from Google |
| Frame rule from 127.0.0.1 | `frame-ancestors` set to the game window's own origin, found in the game (*unverified*: M2 left it open for this) |

**M3 test**, to be written in full with the build: the phone in the game (its frame's red beside the game's menus, dragged by the frame only, pinned to the HUD, the drawer, pairing from it); the home screen on both screens (district and rain as you travel and as the weather turns); the dock on the real phone; the theme switched on one screen and seen on both; the fonts right with Google's font servers out of reach.

## Answered questions

Agreed with the user on 2026-10-29, as recommended.

| Question | Answer |
|---|---|
| The loader's own origin (see [Installing on the phone](#installing-on-the-phone-pwa)) | GitHub Pages for the spike, then `https://mobile.edgemodders.ai/` from M2, on the user's AWS server (agreed 2026-10-29; see [M2 plan](#m2-plan)) |
| Where mobile apps are installed | Beside EDGEmobile's folder, in `red4ext/plugins/REDnode/mobile-apps/`, so installing one does not restart EDGEmobile under hot reload, and an EDGEmobile update never touches them. The folder moves in M4 |
| The date's start, since the game has no calendar date | 1 January 2077 plus the game's day count |
| The clock with no save loaded (main menu) | The last game time read, frozen and dimmed, with "No signal from Night City". With the game closed the tunnel is closed too, and the loader shows its offline screen |
| Should the two screens mirror each other's navigation? | No: shared data, separate navigation |
| How to open the phone in the game | The launcher now, a key once REDnode has package keys |
| The folder name `mobile-apps` | Kept: it says what goes there, beside the REDnode word "apps" |
| Encrypt end to end, so Cloudflare cannot read the traffic | Later, after M5 |
| Fetch `cloudflared` at first use, or ship it in the zip | Fetch it, as REDagent fetches the Agent SDK |

## What it may ask of REDnode

These are needs EDGEmobile may raise as `request` issues on REDnode, once a phase shows they are real:

| Need | Why |
|---|---|
| A permission that tells the player a package starts a tunnel or another program | Players should be told, as they are for `admin` and `agent`, with how the package keeps others out |
| A key that opens a package's window | Bring up the phone during play |
| A zoom or scale for page windows | Fit a 390 × 844 phone on any screen |
| A package call for a picture of the game | The in-game camera. Today only the MCP server's `game_image` takes one |

EDGEmobile is not affiliated with CD Projekt RED or Cloudflare.
