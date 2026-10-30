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
| The phone in the game | **EDGEphone**, a REDnode app of its own, in this repo, so it is pinned and switched apart from EDGEmobile: a transparent, borderless window, a phone frame in the game's own UI red with the OS inside. Only the frame drags it around the screen; it can be pinned to the HUD. EDGEmobile keeps its own window for connecting a phone (the user, 2026-10-29) |
| The first app | Chooms!, the social media app, discussed once the OS is built |

## How it fits REDnode

This repo holds two REDnode packages: `edgemobile`, installed in `red4ext/plugins/REDnode/apps/edgemobile/`, and `edgephone`, the phone in the game, in `apps/edgephone/` (from 0.0.6; the user, 2026-10-29).

| Part | Where | What it does |
|---|---|---|
| Node mod | `edgemobile/mod.mjs` | Runs the web server and the WebSocket on `127.0.0.1`, starts and watches the tunnel, keeps paired phones and the phone's state, finds mobile apps, and answers both screens |
| The OS (the shell) | `edgemobile/shell/` (pairing and the clock from M2; the OS from M3) | The OS, served by the mod to the real phone and to EDGEphone |
| EDGEphone | `edgephone/` (from 0.0.6), its own package | The phone in the game: the frame, with the shell from 127.0.0.1 in its screen. It asks EDGEmobile's service for the screen's address |
| Service | `edgemobile/service.mjs` (from 0.0.6) | Gives EDGEphone, and only EDGEphone, its screen's address with a local session, and the mod's run (it changes when the mod restarts) |
| Connect window | `edgemobile/connect/` (from M2; the drawer in 0.0.4 and 0.0.5) | Onboarding in the game: the QR code, the pairing code with Allow and Deny, and the list of paired phones |
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

## Chooms!

*Agreed with the user on 2026-10-30.* Night City's social feed, the first mobile app. The look is the **Chooms! prototype** canvas (Feed, Post and comments, Profile) in the Night City Mobile UI design system. The user chose to build Chooms! before the general M4 work, since it may change what the OS needs: C1 builds the parts of M4 it uses, and M4 then makes them general for other modders.

| Part | Where it runs |
|---|---|
| The app: Feed, Post and comments, Profile, DMs, Search, Me, **You Might Already Know** | A mobile app, on both screens |
| The accounts, the post cycle, the stored history | A Chooms! REDnode package on the PC |
| Posts, comments and replies in character | REDagent (`agent.ask`, the player's Anthropic key): **Sonnet** for posts, **Opus** for DMs (the user's choice) |
| Images | **Nano Banana Pro** (Google's image model, through the player's Gemini key in REDnode's shared keys, permission `keys:gemini`). The model's exact name and how it is called: *unverified*, the user will say more |
| Settings | A REDnode window from the Chooms! package, on the PC |

### Accounts

| Kind | Who (examples) | Shows in the app | Follow | Choom Request and DMs |
|---|---|---|---|---|
| Main cast | Judy, Panam, Jackie, River, Kerry | Once V has met them in the game; then in **You Might Already Know** until V follows | V may follow them | They may follow V and send V a Choom Request. V cannot send one, only accept theirs. Once V accepts, they and V can DM each other |
| Story figures | Kurt Hansen, Hanako, the fixers | In Search once V has become aware of them through the game, never before | V may follow them; they post only if V follows them | No |
| Delamain | The cab company's AI | Once V has met him | V may follow him | DMs, yes (the user's choice). Proposed: like the main cast, he sends V a Choom Request |
| Corporations | Militech, Arasaka, Kang Tao and others | Their posts in the feed | V may follow them | Never: no Choom Request, no DMs |

An NPC who is dead in V's playthrough stops posting.

### The post cycle

Every **N minutes** (a setting), only while V is in the world (`game.state().world`):

1. Read the game: the district, the time, the story points V has passed, who is alive, the state of each relationship.
2. **Corporations:** each one present in V's current district posts with the **corporation chance** (a setting). Which corporations are in which district is a table in the package.
3. **People:** each account that may post (main cast V has met, story figures V follows; enabled in the settings; alive) posts with the people's chance, at most a set number of posts per cycle.
4. **Social moves:** a main cast member V has met may follow V, or send a Choom Request, as the relationship allows.

A person's post is one of three kinds:

| Kind | Needs | What it is |
|---|---|---|
| Text | Nothing | The fallback, always possible |
| Selfie (the most common image post) | **Post images** on for that NPC, their portrait, at least one setting image | The NPC up close (smiling, laughing, whatever fits), the background from one of their setting images, no activity |
| Activity | The same, and an activity for that setting | The NPC placed in the setting doing one of its activities ("working on her car") |

Images being allowed does not mean every post has one, and setting images being present does not mean they are always used: the weights of the three kinds are settings. For an image post, the app picks the setting and the activity (or none for a selfie), Sonnet writes the caption knowing the scene, and the app builds the image prompt from a template: the portrait and the setting image go to the image model with it. With no images, the post is text.

### Settings (a REDnode window, on the PC)

| Section | Settings |
|---|---|
| General | Chooms! on or off; check for posts every N minutes; the people's chance to post per check; the corporation chance; the most posts per check; the weights of text, selfie and activity posts; the models (Sonnet posts, Opus DMs); spending caps per day (proposed) |
| Each person (not corporations; Delamain included) | On or off; **Post images**; a **portrait** image; any number of **setting images**, each with a one-line description and its activities, one per line (Panam: the Aldecaldos camp; "working on her car", "around the campfire", "polishing her rifle") |
| Keys | Whether REDagent's Anthropic key and the shared Gemini key are set; where to set them |

The images are the player's own, kept in the package's data folder. None ship with the mod, and they reach Google only as part of an image request, which the window says.

### Playthroughs

History belongs to a playthrough (the user's choice). Proposed: on first seeing a playthrough, Chooms! writes a random id into a game fact (`quests.setFact`), which the game keeps in its saves, so every save of that playthrough reads the same id back (*unverified*: that REDnode's facts are saved with the game is for the C2 spike). Each post and message keeps the game time it was made at. Loading an older save of the same playthrough drops what was made after that save's game time, as that branch of the story did not happen.

### What each NPC knows: no spoilers

| Layer | How |
|---|---|
| Story points | A list of story points, each a quest state or a fact; a knowledge card per NPC per story point. A prompt carries only the cards for points V has passed |
| Met, alive, relationship | Facts and journal states (to be found in the C2 spike) |
| Texts with V in the game | Asked of REDnode: the journal's phone conversations between V and each contact (*unverified* whether the game keeps them readable) |
| The model's own knowledge | The model knows the whole story from its training. Each prompt says plainly that nothing past V's story points has happened, and a cheap check pass reads each post against the story points not reached before it is shown. That lowers leaks; it cannot rule them out |

The knowledge cards are content work, about 15 to 25 story points per main NPC: drafted by Claude, checked by someone who knows the game.

### In this repo, and released on its own

Chooms! lives in this repo beside EDGEphone (the user's choice, 2026-10-30), with its own version, changelog, release zip (a file of its own in each EDGEmobile release) and Nexus Mods page. Other phone apps will follow, from Edgemodders and from other modders, and every one unpacks into the same folders in the game:

| In the repo | In the game | What |
|---|---|---|
| `chooms/rednode/` | `red4ext/plugins/REDnode/apps/chooms/` | The REDnode package: the post cycle, the history, the settings window |
| `chooms/mobile/` | `red4ext/plugins/REDnode/mobile-apps/chooms/` | The mobile app, shown in the phone |
| `docs/chooms/changelog.md` | | Its changelog, for its releases and its Nexus page |

### What it needs from REDnode and REDagent

| Need | Why |
|---|---|
| A model choice in `agent.ask` (such as `model: 'sonnet'`) | Sonnet for posts, Opus for DMs. Today the assistant picks its own model |
| The texts between V and a contact, and V's contacts, from the journal | NPCs aware of their history with V; "met" for the main cast. After the C2 spike shows what the game holds |

### Phases

| Phase | What |
|---|---|
| C1 The app | The M4 parts it needs: `mobile-app.json`, the app in a sandboxed frame, the `mobile` library, the bridge from the app to its package through EDGEmobile. The screens from the prototype with stored data: Feed, Post and comments, Profile, DMs, Search, Me, You Might Already Know; follow, Choom Request and accept. The playthrough id. The settings window, with the images. Hand-written posts, no AI yet, to test the app |
| C2 The game's story | A spike: facts, journal, texts, contacts, who is alive, whether facts are saved. Then the story points and cards for the first cast, who V is aware of, and the corporations by district |
| C3 Posts | The cycle with Sonnet, entities by district, NPCs commenting and liking, follows and Choom Requests, the spoiler check, the caps |
| C4 Images | Nano Banana Pro: selfies and activities, cached on the PC, 1080 × 1080 |
| C5 DMs | Conversations with Opus, remembering earlier ones |
| M4 Mobile apps | The C1 parts made general for other modders: a sample app and a guide |

### C1 plan

*Agreed with the user on 2026-10-30.* The app with hand-written posts, and the parts of the OS it needs. EDGEmobile becomes 0.1.0, Chooms! starts at 0.1.0.

**The OS (EDGEmobile 0.1.0):**

| Part | How |
|---|---|
| Finding apps | Each folder in `red4ext/plugins/REDnode/mobile-apps/` with a `mobile-app.json` (see [Mobile apps](#mobile-apps)), plus `"package": "chooms"`: the REDnode package that is its back end. Read at start and when the folder changes. The folder moves there from inside EDGEmobile's own |
| The home screen | The app grid shows each app's icon, name and badge. A tap opens the app full screen; a bar at the bottom goes home |
| The app's frame | `<iframe sandbox="allow-scripts allow-forms">`, without `allow-same-origin`, so the app runs in an origin of its own: it cannot read the shell's session, the loader's key or another app. Its files come from `/apps/<id>/` on the same server. Its page may not fetch anything itself (`connect-src 'none'`): everything goes through the shell. That a sandboxed frame loads its scripts and styles under that rule is a spike item (*unverified*) |
| The `mobile` library | `/mobile.js`, for apps: `mobile.call(name, ...args)` calls its package; `mobile.on(event, handler)` gets its package's events; `mobile.screen` (`'game'` or `'phone'`); the theme, which follows the shell; `mobile.badge(n)`; `mobile.home()` |
| The bridge | The app posts a message to the shell; the shell checks it comes from the frame of the app it opened and sends it over its signed-in WebSocket; EDGEmobile's mod calls that app's package through REDnode's services, naming the app and the screen. The package's events come back the same way to the screens that have the app open. A phone reaches only the package its app names, never REDnode's `api` |
| Images | The package hands out a short-lived address for each image (`/media/<random>`), served by EDGEmobile. No image is reachable without one |

**Chooms! 0.1.0:**

| Part | How |
|---|---|
| The screens | From the prototype, in plain HTML and the shell's Night City styles: Feed (with the chooms online strip), Post and comments, Profile, DMs, Search, Me, You Might Already Know. On a profile, **Follow**, and **Accept** when that NPC has sent a Choom Request; **Message** once they are chooms |
| The loading screen | The prototype's **Loading screen** artboard (added by the user on 2026-10-30): yellow `#fcee0a`, "Chooms!" in Teko 700, "// Night City's social feed", twelve segments lighting in turn (still, with reduced motion), "Loading feed", and the crew's silhouettes at the bottom. Shown from the moment the app opens until its package has sent the feed, then the Feed. The same on both screens and in both themes: it is the app's own look, not the shell's. If the package does not answer within 10 s, the screen says Chooms! needs its REDnode package switched on, and keeps trying. Teko ships with the app (Fontsource woff2, OFL), so it loads from the PC like the shell's fonts |
| The accounts | `roster.json` in the package: each account's id, name, handle, kind, initials and colour, bio, and (corporations) the districts they post in. For C1, a few accounts with hand-written posts, comments and one Choom Request, so every screen can be tried. Who V has met and is aware of comes in C2; until then the test accounts all count as met |
| History | Per playthrough, in the package's data folder: posts, comments, likes, follows, requests, DMs, each with the game time it was made. The playthrough's id goes into a game fact; loading an older save drops what came after it (see [Playthroughs](#playthroughs)) |
| DMs | V can write to a choom. Replies come in C5; until then the message just stays sent |
| The settings window | General (the settings above, saved, used from C3 on) and each person: on or off, Post images, the portrait, setting images with a description and activities. Images picked from the PC, kept in the package's data folder. A hand-written post can use a setting image, to try images on both screens before C4 |

**Checked outside the game:** the harness grows a second package and an app: an app reaches its own package and nothing else, a frame cannot reach the shell's session, a media address works only for its image and only for a while, the history follows the playthrough and drops a later branch.

**Test:** in the game and on the phone: every screen, follow, accept, a DM, the settings window with a portrait and a setting image, and an older save loaded back.

### C1: built

Built on 2026-10-30: EDGEmobile 0.1.0 (with EDGEphone 0.1.0) and Chooms! 0.1.0. Deployed with `tools/deploy.ps1`, which now copies Chooms!'s package to `apps/chooms` and its mobile app to `mobile-apps/chooms`.

| Part | Where | How it came out |
|---|---|---|
| Finding apps | `edgemobile/server/apps.mjs` | Each folder of `red4ext/plugins/REDnode/mobile-apps/` with a `mobile-app.json` whose `id` is the folder's name, an `entry` that exists and optionally an `icon` and a `package`. Watched: an app unpacked or removed while the game runs shows or goes within a second. A broken one is named once in the log. The old `mobile-apps/` inside EDGEmobile's folder is gone |
| Serving apps | `edgemobile/server/web.mjs` | `/apps/<id>/<file>`, only inside that app's folder and only known file types. Each app page comes with its own rules: `sandbox allow-scripts allow-forms` (no `allow-same-origin`), `connect-src 'none'`, scripts, styles, fonts and images from the server only, framed only by the shell. Fonts carry `Access-Control-Allow-Origin: *`, since a sandboxed page's origin is opaque and fonts load with CORS |
| The `mobile` library | `edgemobile/shell/mobile.js`, served at `/mobile.js` | `mobile.ready`, `mobile.call(name, ...args)`, `mobile.on(event, handler)`, `mobile.screen`, `mobile.theme` (the page's `data-theme` follows the shell), `mobile.home()`. Badges come from the package, not the page |
| The shell | `edgemobile/shell/index.html`, `phone.js` | Installed apps on the home screen before Settings, with their badge. An app opens full screen in a sandboxed frame, with a bar at the bottom to go home. Messages from the frame are taken only from the frame of the app that is open |
| The bridge | `edgemobile/server/bridge.mjs` | A screen's `app-call` goes to the app's package as `mobile({ app, screen, call, args })`, the only function a phone reaches. The package's `mobile` events go to the screens with the app open; a `badge` event also updates the home screen. At most 16 calls at once per screen, 15 s each |
| Images | the bridge | A package marks an image `{ $media: 'path' }` inside its own data folder; the screen gets `{ url: '/media/<random>' }`, good for an hour. A path that leaves the package's folder gives nothing, and no file path reaches a screen. It assumes REDnode keeps each package's data folder beside EDGEmobile's (`packages/<id>`), as its logs show (*unverified* as something REDnode promises) |
| Chooms!'s package | `chooms/rednode/`: `mod.mjs`, `store.mjs`, `service.mjs`, `roster.json`, `seed.json` | 22 accounts: 7 main cast, Delamain, 8 story figures, 6 corporations (their districts are a first guess, for C2 to check). The service answers EDGEmobile only, for the Chooms! app only: state, feed, post, profile, me, threads, thread, search, follow, accept, like, likeComment, comment, newPost, send |
| Playthroughs | `chooms/rednode/mod.mjs`, `store.mjs` | Once V is in the world, the fact `chooms_playthrough` holds the playthrough's id (set the first time). One history file per playthrough. Every follow, accept, like, post, comment and message keeps its game time; a follow or a like that changed back and forth keeps each change, so going back finds the value it had then |
| Test data | `chooms/rednode/seed.json` | Five accounts V has met (Judy, Panam, Jackie, River, Kerry): Jackie a choom with an unread message, Judy following V with a Choom Request, six posts with comments, two of them corporations' |
| The app | `chooms/mobile/` | The prototype's screens: the loading screen, Feed (Chooms and You Might Already Know strips), Post and comments, Profile (Follow, Accept choom, Message), DMs (Choom requests, threads), a thread, Search, Post (V writes), Me. All text is set as text. The silhouettes are the user's own image; Teko 700 ships with the app (Fontsource 5.3.0, OFL) |
| The settings window | `chooms/rednode/settings/` | Posting (on or off, the check interval, the chances, the most per check, the weights of text, selfie and activity posts, the models, a daily cap) and People (on or off, Post images, the portrait, places with a description and activities). Images reach the mod in 192 KB pieces over the package channel and are checked to be PNG, JPEG or WebP, up to 12 MB. **Try a post with it** makes a hand-written post with that place's image |

**Changed from the plan:** V can write posts of their own (the prototype's Post tab). Chooms! keeps the last playthrough's feed at the main menu rather than showing nothing. A refusal "V is not in the world yet" ends Chooms!'s round of reads, as in EDGEmobile 0.0.8.

**Checked outside the game:** the harness's new `apps` mode (52 checks, all passed) runs Chooms!'s package beside EDGEmobile's mod with a stand-in `rednode` that gives each package its own identity, services between them and quest facts:

- the apps list with Chooms!'s icon and page; the app's page with its sandbox, `connect-src 'none'` and its frame rule; its font for an opaque origin; `/mobile.js`;
- nothing outside an app's folder (`..` in several spellings), no unknown app, no unknown media address, no app through the tunnel with no tunnel;
- a call for an app not installed, a call with a bad name, and Chooms! answering anyone but EDGEmobile or for another app: all refused;
- at the main menu "load a save"; once V is in the world, a playthrough id in a fact and the open app told; the feed, its order, the chooms and You Might Already Know; search and profiles only for who V knows of; Accept, then messages; no accept without a request; follow; likes, comments, an empty comment refused; unread messages and the badge on the home screen and in the app; V's own post;
- a portrait and a place sent in pieces, not-an-image refused, a test post whose image and portrait come as media addresses that give the image, with no file path on the screen;
- an older save: what came after it gone, what came before it kept; an even older one: the accept, the posts and the likes gone too; a new playthrough with its own history, then each playthrough's own again;
- a media path leaving the package's folder gives nothing, a media address ends;
- an app unpacked while the game runs shows, and goes when removed;
- in headless Chrome: the shell opens Chooms! in its sandboxed frame, the app's scripts run and call its package, the shell cannot reach into the frame, the loading screen says what is missing when the package is off, and once a save is loaded the feed shows; clicked through to a profile, the DMs and a thread; and inside EDGEphone's window, at its 0.8 scale.

The 61 earlier checks (full, relink, auto, boot) passed again.

*Unverified until the C1 test:* that REDnode's quest facts are kept in the game's saves (the playthrough id rests on it); the file picker in an overlay window in the game; the sandboxed frame in REDnode's Electron and in Chrome on Android; images through the tunnel; and that REDnode's services carry the bridge's calls and events as the stand-in does.

**C1 test** (EDGEmobile and EDGEphone 0.1.0, Chooms! 0.1.0, REDnode 0.47.2 or later):

| # | Step | Expect |
|---|---|---|
| 1 | Start the game. F10, the **Mod Manager** | **Chooms!** listed beside EDGEmobile and EDGEphone. Switch all three on |
| 2 | At the main menu, open EDGEphone | The home screen shows the **Chooms!** icon, yellow, before Settings |
| 3 | Tap **Chooms!** | The yellow loading screen with the crew, then "Load a save: your feed belongs to the playthrough you play" |
| 4 | Load a save | Within a few seconds the Feed: Jackie under Chooms, Panam, River and Kerry under You might already know, then Judy's post, Jackie's, Militech's, Arasaka's |
| 5 | Tap Judy's name. **Accept choom**, then **Message**, write and send | "You and Judy Alvarez are chooms now", then the message in the thread |
| 6 | Back to the Feed. Tap Panam, **Follow** | Her sunset post joins the feed |
| 7 | Like Judy's post, open it, write a comment | The count goes up by one; the comment is the last one |
| 8 | **DMs**: open Jackie's thread | The badge on the DMs tab, and on the home screen's icon, drops by one |
| 9 | **Post**: write something, **Post** | It is first in the feed |
| 10 | Open **Chooms!**'s window from the launcher. **People**, **Judy Alvarez**: **Choose image** for the portrait, then **Add a place**, a line about it and two activities, **Try a post with it** | The file picker opens over the game (say if it does not). On the phone, Judy's new post with the place's image, and her portrait as her picture |
| 11 | On your Android phone, open the installed app, **Chooms!** | The same feed, the image too |
| 12 | Save the game. Follow Kerry. Load the save you just made | Kerry is not followed again |
| 13 | On the phone, **Settings**, **Edgemodders** | Chooms! turns to the Edgemodders colours; its loading screen stays yellow |

Send back: anything that did not match, and the lines of `red4ext/logs/rednode-mods.log` with `[edgemobile]` or `[chooms]` in them.

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

The fonts ship with EDGEmobile (from M3): `edgemobile/shell/fonts/`, woff2 in Latin and Latin Extended, with their SIL Open Font License files, so neither screen fetches from Google.

## Phases

Each phase ends with a test by the user, on a real phone where it applies, before the next starts.

| Phase | What | Status |
|---|---|---|
| M0 Repo and design | The repo's scaffolding and this page | Done 2026-10-29 |
| M1 Tunnel spike | Fetch and check `cloudflared`, start a quick tunnel to a server in a REDnode mod, open a page on a real phone, a WebSocket both ways and its delay. Tested on the user's Android phone; iPhones stay *unverified* until someone tests one. Also: the loader (option D) installed on a real phone, showing the PC's page full screen in a frame, with the camera and a `tel:` link from inside it; reusing a running tunnel after a mod restart; `cloudflared` ending with the game; a REDnode page window reaching `127.0.0.1` | Done 2026-10-29: built, tested on Android, four fixes, retested ([M1 test](#m1-test)) |
| M2 Onboarding | The Connect window: the first fetch, the QR code, the pairing code with Allow and Deny, phones that prove themselves by signature, Paired phones with Disconnect, reconnecting by scan after a restart, the loader at its own address | Done 2026-10-29: built, tested on Android ([M2 test](#m2-test)) |
| M3 The OS | The shell on both screens: the home screen (status line, clock, app grid, dock), the dock on the real phone, the phone in the game (a borderless red frame, Pin to HUD), the two themes, the fonts shipped | Done 2026-10-30: built, tested in the game and on Android, with EDGEphone as its own app ([EDGEphone](#edgephone-the-phone-as-its-own-app), [0.0.7](#007-rednodes-world-flag-and-the-games-text)) |
| M4 Mobile apps | `mobile-app.json`, finding apps, icons and badges, opening, swiping between apps, the home bar, sandboxed frames, the `mobile` library, a sample app and a modder's guide | Not started |
| M5 Install on the phone | The loader as a PWA: manifest, service worker, icons, the Scan button, offline screen, and its own origin | Not started |
| M6 Chooms! | C1 to C5 in [Chooms!](#chooms), built before M4's general parts (the user's choice, 2026-10-30) | C1 built 2026-10-30, awaiting the user's test ([C1: built](#c1-built)) |
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

Agreed with the user on 2026-10-29. M3 builds the OS's first screen on both screens, the phone in the game, and the two themes.

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
| The phone in the game | EDGEmobile's window becomes the phone: a transparent, borderless page with a solid phone frame in the game's UI red, `#ff6158` (REDnode's own `hud` theme, which matches the game's menus), 336 × 704 px on screen. Only the frame's four edges are drag handles (`data-rednode-drag`; REDnode sends each handle to the game as a rectangle, so one handle around the whole phone would cover the screen too); the screen inside takes taps and scrolls as usual. The screen is the shell from 127.0.0.1 with the local session (M1), so both screens run the same code and data. No dock in the game. **Pin to HUD** in REDnode's Mod Manager keeps it on screen during play (in play, the game keeps the mouse: the phone shows but takes taps only with the overlay open, F10) |
| Connect a phone | A drawer beside the phone, opened from a small icon on the frame, and by itself when a phone asks to pair. The same content as the M2 Connect window |
| Fonts | Chakra Petch, Rajdhani and JetBrains Mono shipped as woff2 in `edgemobile/shell/fonts/` with their SIL Open Font License files, served to both screens, so nothing is fetched from Google |
| Frame rule from 127.0.0.1 | `frame-ancestors file:`: REDnode's app pages are `file://` pages, so the game's window may frame the shell and no website can. Checked in Chrome: a `file://` page framed it under this rule; `'none'` and `'self'` refused it (*unverified* in REDnode's Electron) |

### M3: built

Built on 2026-10-29, as EDGEmobile 0.0.4.

| Part | Where |
|---|---|
| The phone in the game: the frame, the four drag edges, the screen, the Connect drawer | `edgemobile/game/window.html`, `window.js` (the M2 Connect window, `edgemobile/connect/`, is gone) |
| The home screen, Settings, the dock | `edgemobile/shell/index.html`, `phone.js` |
| The Edgemodders theme | `edgemobile/shell/theme/themes.css` |
| The fonts and their licences | `edgemobile/shell/fonts/` (Fontsource 5.3.0 packages, 260 KB) |
| The district and the rain, the theme kept on the PC and sent to every screen | `edgemobile/mod.mjs` |
| Fonts served (cached for a day), `font-src 'self'`, the frame rule from 127.0.0.1 | `edgemobile/server/web.mjs` |

**Checked outside the game** (the harness, against real quick tunnels, with a stand-in game whose district record is a sub-district under Watson, named through a LocKey, and light rain; 41 checks, all passed): every M2 check; the top district and the rain arrive with the time ("Watson", "light"); the theme is sent on connecting; a theme chosen on one screen reaches the others and is kept in `settings.json`; an unknown theme is ignored; the 16 font faces and the woff2 files are served, cached for a day; the page allows fonts and styles from itself only, with no Google address left; nothing else is served from the fonts folder; the page from 127.0.0.1 carries `frame-ancestors file:`.

**Seen in headless Chrome** at 390 × 844: the home screen in both themes against the prototype; Settings; the in-game window from its `file://` page with the shell in its screen, under the new frame rule. Found and fixed: Edgemodders turned the dock's Browser button red (it uses the yellow that the theme gives to attention), and the skyline's tower stayed red; the button is now always yellow and the tower follows the voice colour.

*Unverified until the M3 test:* everything that reads the game (the district through `PreventionSystem`, its LocKey through `GetLocalizedText`, the rain through `WeatherSystem`: how REDnode returns their handles and enums is a guess, so the mod accepts several shapes and logs the first failure of each as "Status line: could not read …"), the window in REDnode (transparent, the drag edges, the drawer, Pin to HUD), the frame rule in REDnode's Electron, and the dock on the phone.

**Found at the first launch** (2026-10-29): the game crashed twice on launch, an access violation reading `0x280`. REDnode's log, a second before each crash: "rtti.call: GetWeatherSystem crashed inside the game". The phone window now opens with the game, so the in-game screen connects while the game boots; `mainMenu` is still false then, so the mod asked for the weather system before the world existed. Fixed in 0.0.5: no call into the game's world systems (time, district, rain) unless V is in the world, checked with REDnode's `game.player.position()` (which rejects safely with no player) before each round of calls, about once a second, since loading another save from the pause menu takes the world away without passing the main menu; and one tick at a time, so a slow answer does not pile calls up. Checked with a `boot` mode in the harness: the in-game screen connected with no player, 6 ticks went by with no time, no place and no world call, then V arrived and the time, district and rain followed within 5 s; when V went away again without the main menu, no world call was made. All 41 checks passed again. Rule from this: **never call into the game's world before V exists.**

### EDGEphone: the phone as its own app

Asked for by the user on 2026-10-29, after the first M3 run in the game: the phone in the game becomes **EDGEphone**, a REDnode app of its own, kept in this repo (`edgephone/`) and installed beside EDGEmobile, so each is pinned and switched on its own. EDGEmobile keeps its M2 window for connecting a phone (`edgemobile/connect/`), and the drawer and the tab on the frame go. Built as 0.0.6.

| Part | How |
|---|---|
| EDGEphone | A window only, no Node mod: `window.html` (the frame, the four drag edges, the screen) and `window.js`. `requires` EDGEmobile 0.0.6 or later |
| Its screen | `service.connect('edgemobile')`, then `screen()`: the shell's address at 127.0.0.1 with a local session. Every 3 s it asks `run()`; a new run (EDGEmobile restarted) gets a new screen. EDGEmobile off: "EDGEphone needs EDGEmobile: switch it on in the Mod Manager" |
| EDGEmobile's service | `service.mjs`, beside `mod.mjs` in the same worker (REDnode imports both by their plain file addresses, so they share one module). `screen()` and `run()` refuse every caller but `edgephone`: other packages, assistants and calls with no caller |
| Deploy | `tools/deploy.ps1` copies both packages |

**Checked outside the game:** the harness's `boot` mode (8 checks, all passed) adds: EDGEphone gets its screen and the run from the service; the screen's session is in at 127.0.0.1; another package, an assistant or no caller is refused, for both functions. The 41 earlier checks all passed again.

**The first M3 run in the game** (2026-10-29, 0.0.5): it launched without a crash, the phone showed in the game, and the theme switched both screens. The district's name came from the record's own name ("Watson"): the game's `GetLocalizedText` takes a `script_ref<String>`, which REDnode cannot pass yet ("script_ref parameters are not supported yet"), so names are the game's English record names for now.

**EDGEphone test** (0.0.6; the M3 test below still holds, with EDGEphone for the phone and EDGEmobile's window for connecting):

| # | Step | Expect |
|---|---|---|
| 1 | Start the game. F10, the **Mod Manager** | **EDGEphone** and **EDGEmobile** listed apart. Switch both on; pin each to the launcher as you like |
| 2 | Open EDGEphone | The phone, with no tab on its frame, its screen showing the home screen |
| 3 | Open EDGEmobile | Its M2 window: the tunnel, the QR code, Allow and Deny, Paired phones |
| 4 | **Pin to HUD** for EDGEphone only, then F10 back to the game | The phone stays on screen; EDGEmobile's window does not |
| 5 | Pair or scan from EDGEmobile's window; change the theme on the real phone | Both screens follow, as in M3 |
| 6 | Hot reload on, save `mod.mjs` in the deployed `edgemobile` folder | EDGEphone's screen is back within a few seconds |
| 7 | Switch EDGEmobile off in the Mod Manager, then on | EDGEphone says it needs EDGEmobile, then shows its screen again |

### 0.0.7: REDnode's world flag and the game's text

REDnode 0.47.2 shipped both requests from the first M3 run (REDnode [#25](https://github.com/Edgemodders/REDnode/issues/25) and [#26](https://github.com/Edgemodders/REDnode/issues/26), both passed in the game on 2026-10-30). EDGEmobile and EDGEphone 0.0.7 require it.

| Part | Before (0.0.5 to 0.0.6) | Now (0.0.7) |
|---|---|---|
| When to read the world | `worldReady()`: `game.player.position()` before each round of calls, at most once every 900 ms | `game.state().world`, then each change through `game.onState`. False while the game starts, at the main menu and from the start of every load, the pause menu's too |
| The time system | Kept between ticks | Asked for on each tick. REDnode refuses `GameInstance` calls while V is out of the world, but not methods on objects a mod holds, so nothing from the world is kept |
| Back in the world | The place was read within 5 s | The place is read on the next tick |
| The district's name | The record's English name (`EnumName`), since `GetLocalizedText` could not be called | `loc.text` on its LocKey, in the player's language. The record's name stays as the fallback |

**Checked outside the game:** the harness's stand-in `rednode` now follows 0.47.2: `world` and its events, `GameInstance` calls refused while it is false, `loc.text` in two languages, and every call into the world counted, held objects too. The `boot` mode (13 checks) goes through the game starting (REDnode's main menu, then the plugin's "not the main menu" with no V yet, when the old mod crashed the game), V arriving, a load from the pause menu, V back in another language, a key with no text, and the main menu: no call into the world while V was out of it, the place back within a second. With full, relink and auto, 54 checks, all passed.

**0.0.7 test** (with the EDGEphone test above, if it is not done yet). REDnode 0.47.2 or later in the game.

| # | Step | Expect |
|---|---|---|
| 1 | Start the game with EDGEphone pinned to the HUD, or open it at the main menu | No crash. Its screen shows the clock dimmed, "No signal from Night City" |
| 2 | Load a save | The district and the rain within a second or two of V showing |
| 3 | From the pause menu, load another save | The status line goes to "No signal" during the load, and is back after it |
| 4 | Exit to the main menu | "No signal from Night City" |
| 5 | If you play in another language: the district's name | In that language |

Send back: anything that did not match, and the lines of `red4ext/logs/rednode-mods.log` with `[edgemobile]` in them.

**Results** (2026-10-30, on the PC, REDnode 0.48.1): the EDGEphone test (done earlier) and the 0.0.7 test **passed**. The log showed EDGEmobile's service ready and EDGEphone connected at once, no district name error (the names come through `loc.text`), and no crash. Two notes:

- At the start of the load from the pause menu, a round of reads already under way had its last calls refused by REDnode: "Status line: could not read the district (the rain): V is not in the world yet". `sound-test` hit the same in the same second: the world goes away between one call and the next, before the mod hears of it. Harmless, since REDnode refused the calls, but it reads as a failure and uses up the one line per kind of failure that a run logs. Fixed in 0.0.8: that refusal is taken as the world going away. The round stops there, no call is made until `onState` brings V back, and nothing is logged. Checked in the harness with a load starting at the district's call and at the rain's, the mod hearing of it 3 s later: one refused call, then none, no time or place on the phone, no log line (61 checks in all, passed).
- EDGEmobile was off when the game started and was switched on after the main menu, so a start with it on was not seen in this run. REDnode's own test checked its guard while the game starts.

### M3 test

On the PC with the game, and the user's Android phone (already paired in M2). EDGEmobile 0.0.5 is deployed.

| # | Step | Expect |
|---|---|---|
| 1 | Start the game. F10, open **EDGEmobile** from the launcher | A phone with a solid red frame at the right of the screen, the game showing around it. Its screen shows the home screen, with no dock |
| 2 | Drag the phone by its red frame. Then try to drag from the screen | The frame moves the phone. The screen does not move it; **Settings** opens with a tap |
| 3 | Compare the frame's red with the game's own menus (the inventory, the map) | Same red, or say how it differs |
| 4 | Load a save | The status line shows the district ("Watson · …"), and "Light rain" or "Heavy rain" when it rains. Go back to the main menu: "No signal from Night City", the clock dimmed |
| 5 | Travel to another district, and wait for rain if you can | The status line follows within a few seconds |
| 6 | The small red tab on the frame's right: **Connect a phone**. **Start** | The drawer beside the phone, then the QR code |
| 7 | On the phone, open the installed app, **Scan the code** | Back with no Allow. The home screen, with the dock |
| 8 | The dock on the phone: **Phone**, **Messages**, **Camera**, **Browser** | The dialer, the messaging app, the camera (then "Photo taken. Nothing was sent to the game."), a browser tab |
| 9 | On the phone: **Settings**, **Edgemodders** | Both screens turn yellow at once, with the house grid and the corner brackets on the clock. Switch back from the phone in the game |
| 10 | Close the drawer. **Disconnect** is in it: open it again and **Disconnect** the phone, then scan again | The drawer opens by itself with the pairing code. **Allow** |
| 11 | Mod Manager › EDGEmobile › **Pin to HUD**. F10 back to the game | The phone stays on screen while you play (it takes taps only with the overlay open) |
| 12 | Hot reload on, save `mod.mjs` in the deployed folder | The phone in the game reconnects by itself; the real phone too |

Send back: anything that did not match, and every line of `red4ext/logs/rednode-mods.log` starting `[edgemobile] Status line:` (the game calls that failed).

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

Raised on 2026-10-30, from the first M3 run in the game:

| Issue | Need |
|---|---|
| [REDnode #25](https://github.com/Edgemodders/REDnode/issues/25) | A "V is in the world" flag in `game.state()`, so mods never call world systems too early (the launch crash) |
| [REDnode #26](https://github.com/Edgemodders/REDnode/issues/26) | Localized text for Node mods: a LocKey to text in the player's language (district names) |

EDGEmobile is not affiliated with CD Projekt RED or Cloudflare.
