# Tests outside the game

These run EDGEmobile's mod, and Chooms!'s package, in plain Node with a stand-in for REDnode's `rednode` package. The tunnel tests use real Cloudflare quick tunnels. Node's WebCrypto plays the phone: it signs as a phone's browser does. Nothing here replaces the tests in the game and on a real phone after each phase.

```
node tests/all.mjs              every mode: boot, apps, then full, relink and auto
node tests/all.mjs --offline    boot and apps only: no tunnel, no internet
node tests/run.mjs apps         one mode
```

Before the first run, install EDGEmobile's libraries: `npm ci` in `edgemobile/` (`tools/deploy.ps1` does it too).

| Mode | Checks | Needs |
|---|---|---|
| `boot` | The game starting with the phone window open, V arriving, a load from the pause menu, the main menu: no call into the world while V is not in it. EDGEphone's screen through EDGEmobile's service | Nothing |
| `apps` | Mobile apps: the app frame, `/mobile.js`, the bridge to an app's package, media addresses. Chooms!: the feed per playthrough, older saves, the settings window, its image picker, bundled pictures and places, Reset to default, the export tool. Ends with headless Chrome screenshots in `tests/.out/shots/` | Chrome |
| `full` | The tunnel, pairing (the QR link's key and Allow), every refusal, the phone back by its signature, themes, fonts, what is and is not served | The internet, `cloudflared` |
| `relink` | A restarted mod finds the running tunnel; the paired phone is in by signature | `full` just before, in the same command |
| `auto` | With the setting on and a phone paired, the tunnel starts with the mod | `full` before it |
| `browser <minutes>` | For a check in a real browser: a tunnel and QR links in `tests/.out/data/edgemobile/browser.json`, Allow pressed when a code shows | The internet, `cloudflared` |

`full` leaves the tunnel's keeper running for `relink`, as the mod does when REDnode stops it. Run them in one command (`all.mjs` does), since some shells end every process a command started when the command ends.

## cloudflared

Windows Firewall allows a program by its path. So the tunnel tests use the copy that EDGEmobile's Connect window fetched in the game (`%APPDATA%\@rednode\overlay\packages\edgemobile\cloudflared\`), through a junction, and the firewall's earlier answer for it holds. With no copy there, they fetch one into `tests/.out/`, and the firewall may ask about it.

The tunnel gives the test mod a private web address. As in the game, a phone gets in only with both the QR link's one-time key and Allow pressed at the PC, which the tests press themselves.

## Files

| File | What |
|---|---|
| `run.mjs` | The checks, by mode |
| `all.mjs` | Runs the modes and adds up the results |
| `rednode-stub.mjs` | The stand-in `rednode`: the game's state, the world flag, `loc.text`, quest facts, services between packages, windows' channels. It follows REDnode 0.47.2's shapes |
| `hooks.mjs` | Gives each package its own `rednode` (`?pkg=<id>`) |
| `shot.mjs` | Screenshots a page with headless Chrome over the DevTools protocol. `node tests/shot.mjs <url> <out.png> <width> <height> [script] [waitMs]` |

Each mode exits with 1 when a check fails. What a run writes (the packages' data folders, copies of the apps, the picker's test folder, screenshots) goes in `tests/.out/`, which is not committed.
