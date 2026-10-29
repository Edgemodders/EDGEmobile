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
| How a phone gets in | The game shows a QR code. The phone scans it and shows a pairing code. The game shows the same code with **Allow** and **Deny**, and the player allows it |
| First screen after pairing | The EDGEmobile home screen, with no apps installed at first |
| Mobile apps | Made by third-party modders and installed by players. They unpack into a folder inside EDGEmobile's REDnode folder, where EDGEmobile finds them |
| Using apps | Tap an icon to open its app. Swipe left or right to cycle through the apps. There is an easy way back to the home screen |
| Dock buttons | Phone, Messages, Camera and Browser, from the prototype. On a real phone, where possible, they open the phone's own dialer and camera |
| Look | The **Chooms! prototype** design canvas (the user's artifact; its Home screen is the basis for the OS), with the **Night City Mobile UI** design system |
| The first app | Chooms!, the social media app, discussed once the OS is built |

## How it fits REDnode

EDGEmobile is one REDnode package, `edgemobile`, installed in `red4ext/plugins/REDnode/apps/edgemobile/`.

| Part | Where | What it does |
|---|---|---|
| Node mod | `edgemobile/mod.mjs` | Runs the web server and the WebSocket on `127.0.0.1`, starts and watches the tunnel, keeps paired phones and the phone's state, finds mobile apps, and answers both screens |
| Phone window | `edgemobile/shell/` (*proposed*) | The OS, shown in a REDnode overlay window shaped like a phone. The same files are served to the real phone |
| Connect window | `edgemobile/connect/` (*proposed*) | Onboarding in the game: the QR code, the pairing code with Allow and Deny, and the list of connected phones |
| Mobile apps | `edgemobile/mobile-apps/<id>/` | One folder per installed app, with its own `mobile-app.json` |
| Tunnel program | `<pkg.dataDir>/cloudflared/<version>/cloudflared.exe` | Cloudflare's `cloudflared`, fetched on first use (see [The tunnel](#the-tunnel)) |
| Paired phones | `<pkg.dataDir>/phones.json` | A hash of each phone's session token, its name and when it was last seen |

REDnode's parts it uses: Node mods (`main`), page windows, Pin to HUD, `pkg.dataDir`, `game` and `api` for the game's time and place, services and roles (`use`) for app back ends, and secrets for the session keys (*proposed*).

## Onboarding a real phone

The sequence the player sees, the first time:

| Step | In the game | On the phone |
|---|---|---|
| 1 | The player opens EDGEmobile's **Connect a phone**. The first time, it says it will fetch Cloudflare's tunnel program (its size, from GitHub) and asks to go on | |
| 2 | EDGEmobile fetches `cloudflared`, checks its SHA-256 against the one pinned in EDGEmobile's source, starts the local server and the tunnel, and reads the tunnel's address | |
| 3 | The window shows a QR code, with "Scan this with your phone's camera" and a countdown | |
| 4 | | The player scans it. The phone opens EDGEmobile's phone page, which connects and shows a pairing code, such as `482 913` |
| 5 | The window shows "A phone wants to connect: **482 913**", with the phone's browser and system, and **Allow** and **Deny** | "Check that the game shows the same code" |
| 6 | The player checks the codes match and presses **Allow** | |
| 7 | The phone shows in **Connected phones** | The phone stores its session key and shows the EDGEmobile home screen, with no apps yet |
| 8 | | The page offers **Install** (Add to Home screen) |

After a game restart, the tunnel's address is new (see [The tunnel](#the-tunnel)), so the phone has to find the PC again. A phone already paired does not need the pairing code again. It scans the QR code once more, either with its camera or with a **Scan** button in the installed app, and the home screen comes back.

### What the QR code holds

*Proposed:* `https://edgemodders.github.io/EDGEmobile/phone/#h=<tunnel host>&t=<pairing token>`

- The part after `#` (the fragment) never leaves the phone, so GitHub's servers never see the tunnel's address or the token. The page reads it and connects to the tunnel itself.
- The page is served from one fixed address, so the installed app keeps working after the tunnel's address changes (see [Installing on the phone](#installing-on-the-phone-pwa)).

## Pairing and security

The tunnel puts a server on the player's PC on the open internet. Anyone who finds the address can reach it, so nothing works without pairing.

| Rule | Why |
|---|---|
| The QR code carries a long random token. It works once, and only for about a minute | Knowing or guessing the address is not enough. An old QR code from a screenshot or a stream is useless |
| The player confirms each new phone in the game, by a code shown on both screens | Stops a phone that got the token anyway, for example a viewer who saw the QR code on a stream |
| One pairing waits at a time. Repeated tries from one address are answered more slowly | No one can flood the player with requests |
| A paired phone gets a long random session key. The PC keeps only its hash | A copy of `phones.json` lets no one in |
| **Connected phones** lists each phone with **Disconnect**, which ends its key | The player can remove a phone at any time |
| A phone can do only what EDGEmobile and its apps offer. It never reaches REDnode's `api`, the MCP server or files | A paired phone cannot run code in the game |
| The server listens on `127.0.0.1` only | A phone reaches it only through the tunnel, never over the home network |
| Only the phone page's own origin may open the WebSocket (its `Origin` header is checked) | Other websites the phone visits cannot use the session |
| Closing EDGEmobile, or the game, stops the server and the tunnel | Nothing stays open after the game |

**Cloudflare sees the traffic.** A quick tunnel ends HTTPS at Cloudflare's edge, so Cloudflare could read what passes. *Proposed, later:* encrypt the WebSocket's messages end to end with a key carried in the QR code's fragment, which Cloudflare never sees.

**REDnode has no permission for this yet.** A Node mod can open the network and start programs without the player being told. EDGEmobile should say so plainly in its Connect window and on its Nexus page. A REDnode permission for it is on the [list for REDnode](#what-it-may-ask-of-rednode).

## The tunnel

A Cloudflare quick tunnel gives a free HTTPS address with no account. It always needs Cloudflare's `cloudflared` program. No JavaScript version of its protocol is known to us.

| Step | How |
|---|---|
| Fetch | `cloudflared-windows-amd64.exe` from Cloudflare's GitHub releases, at a version pinned in EDGEmobile, checked by a pinned SHA-256, kept in `<pkg.dataDir>/cloudflared/<version>/`. The same idea as REDagent's fetch of the Agent SDK. `cloudflared` is Apache-2.0 licensed, so shipping it in the zip is allowed too, but it would make the zip much larger |
| Start | `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>`, started by the mod, which reads the `https://….trycloudflare.com` address from its output |
| Watch | The mod checks the tunnel's metrics port, restarts the tunnel if it ends, and tells the Connect window when the address changes |
| Stop | When the mod stops. REDnode's host runs in a Windows job object, so `cloudflared` should end with the game even if the mod cannot stop it (*unverified*) |

Limits of quick tunnels, from Cloudflare's docs (*check again in M1*):

| Limit | Effect on EDGEmobile |
|---|---|
| A random address that changes each time the tunnel starts | The phone has to scan again after each game start. A fixed address needs a Cloudflare account and a named tunnel |
| Meant for testing, with no uptime promise | Fine for a game companion. Say so on the Nexus page |
| About 200 requests in flight at once | Plenty for one player's phones |
| No Server-Sent Events | Live updates go over a WebSocket |

**Keeping the address across restarts of the mod.** REDnode restarts a mod when its files change while hot reload is on, and a new tunnel means a new address. *Proposed:* the mod uses one fixed local port, chosen at first start and kept, and writes the tunnel's process id and address to `<pkg.dataDir>`. A restarted mod that finds that tunnel still running and answering reuses it, and connected phones only reconnect (*unverified*).

## The OS

The OS is one web app, the shell, shown on both screens. Its first screen is the home screen from the prototype's **Home screen** artboard.

### The home screen

| Area | Content |
|---|---|
| Status line | District, temperature and weather, as `Watson · 24°C · Smog`. From the game where REDnode can read it; *proposed* to leave out what it cannot |
| Clock | The time in large type, with a red rule and the date below, as `Friday, 28 October 2077`. *Proposed:* Night City's time while a save is loaded, otherwise the PC's clock with the year 2077 |
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

A mobile app is a folder in `edgemobile/mobile-apps/<id>/`. It is plain web files, shown inside the shell.

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

**A catch with the folder.** While REDnode's hot reload is on (it is for developers, not for players), any change inside a package's folder restarts its mod. An app installed into `mobile-apps/` while the game runs would restart EDGEmobile's server, and the tunnel's address could change. Two ways out: the reuse of a running tunnel above, or a REDnode manifest setting that keeps a subfolder out of hot reload (see below).

## Installing on the phone (PWA)

A web app installs on a phone's home screen when it is served over HTTPS with a manifest and a service worker. The tunnel gives HTTPS. But an installed app is tied to the address it came from, and a quick tunnel's address changes each start, so an installed app served from the tunnel would break after every restart.

| Option | Good | Bad |
|---|---|---|
| **A. The shell from a fixed address** (*recommended*): the phone page lives on GitHub Pages, at `edgemodders.github.io/EDGEmobile/phone/`, and connects to the tunnel's current address | The installed app keeps working. Its key stays in the app's own storage. After a restart, one scan with its **Scan** button reconnects | The phone page's version can differ from the player's EDGEmobile, so they compare versions when they connect. It depends on Edgemodders' GitHub Pages being up |
| B. The shell from the tunnel | Everything comes from the player's PC | The installed app breaks at each game start. It suits a page kept open in the browser, not an installed app |
| C. A fixed address per player | No scanning after restarts | Needs a Cloudflare account and a named tunnel, or a small Edgemodders service that maps each PC to its current address |

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
| M1 Tunnel spike | Fetch and check `cloudflared`, start a quick tunnel to a server in a REDnode mod, open a page on a real phone, a WebSocket both ways and its delay. Also: reusing a running tunnel after a mod restart, `cloudflared` ending with the game, a GitHub Pages page opening the tunnel's WebSocket, and a REDnode page window reaching `127.0.0.1` | Not started |
| M2 Onboarding | The Connect window: the first fetch, the QR code, the pairing code with Allow and Deny, session keys, Connected phones with Disconnect, reconnecting by scan after a restart | Not started |
| M3 The OS | The shell on both screens: the home screen (status line, clock, empty app grid, dock), the dock's actions on each screen, the phone window in the game with Pin to HUD | Not started |
| M4 Mobile apps | `mobile-app.json`, finding apps, icons and badges, opening, swiping between apps, the home bar, sandboxed frames, the `mobile` library, a sample app and a modder's guide | Not started |
| M5 Install on the phone | The PWA: manifest, service worker, icons, the Scan button, offline screen, version check | Not started |
| M6 Chooms! | To be designed with the user | Not started |
| Release | The zip, `requires` for REDnode, the Nexus page, the changelog | Not started |

## Open questions

| Question | Recommendation |
|---|---|
| Where the phone page is served from (see [Installing on the phone](#installing-on-the-phone-pwa)) | A, a fixed address on GitHub Pages |
| The clock on the real phone | Night City's time while a save is loaded |
| Should the two screens mirror each other's navigation? | No: shared data, separate navigation |
| How to open the phone in the game | The launcher now, a key once REDnode has package keys |
| The folder name `mobile-apps` | Keep it: it says what goes there, beside the REDnode word "apps" |
| Encrypt end to end, so Cloudflare cannot read the traffic | Later, after M5 |
| Fetch `cloudflared` at first use, or ship it in the zip | Fetch it, as REDagent fetches the Agent SDK |

## What it may ask of REDnode

These are needs EDGEmobile may raise as `request` issues on REDnode, once a phase shows they are real:

| Need | Why |
|---|---|
| A manifest setting that keeps a subfolder out of hot reload | Installing a mobile app should not restart EDGEmobile's server |
| A permission that says a package opens the PC to the internet or starts programs | Players should be told, as they are for `admin` and `agent` |
| A key that opens a package's window | Bring up the phone during play |
| A zoom or scale for page windows | Fit a 390 × 844 phone on any screen |
| A package call for a picture of the game | The in-game camera. Today only the MCP server's `game_image` takes one |

EDGEmobile is not affiliated with CD Projekt RED or Cloudflare.
