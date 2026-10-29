# EDGEmobile: notes for Claude sessions

EDGEmobile is a phone operating system for Cyberpunk 2077, built as a REDnode app: one phone shown in the game (REDnode's overlay and HUD) and on the player's real phone (a web app reached through a Cloudflare quick tunnel, paired by QR code and a pairing code, installable as a PWA). Read [docs/design.md](docs/design.md) first. It depends on [REDnode](https://github.com/Edgemodders/REDnode), checked out beside this repo at `../REDnode`; read that repo's CLAUDE.md for the runtime, the tests and the conventions.

## Status and next step

- Asked for by the user on 2026-10-29 as a side project ahead of REDnode's schedule, since it may change and improve REDnode; REDnode's schedule resumes after it. Its own repo, version, changelog, zip and Nexus page.
- The look comes from the user's design canvas **Chooms! prototype** (claude.ai artifact https://claude.ai/artifact/CfF1Ri6LhBR5FkGPhGNFp3, private to the user; read it with the Artifact tool), whose **Home screen** artboard is the basis for the OS, with the **Night City Mobile UI** design system (https://claude.ai/artifact/TwDf9vxw4BxqLppZSzhCmn). Its tokens and component styles are copied into `edgemobile/shell/theme/`.
- M0 (scaffolding and the design) done on 2026-10-29. Agreed with the user the same day: the phone app comes from the player's PC through the tunnel, with a tiny fixed loader page for the installed app (option D in docs/design.md; GitHub Pages hosting the whole shell was rejected). The user tests on Android. The other open questions were answered as recommended (docs/design.md, "Answered questions").
- **M1, the tunnel spike, built on 2026-10-29** (EDGEmobile 0.0.2; docs/design.md, "M1: built"), 20 checks passed outside the game against real quick tunnels. Tested in the game on the user's Android phone the same day: all passed but two, four fixes followed, and the retest passed (docs/design.md, "First test in the game"). **M1 done.** **Next: plan M2 with the user**, starting with how the installed app reaches the game after a restart (scan again, or a fixed address: option C).
- Testing outside the game: the scratchpad harness `m1/run.mjs` (`full`, then `relink` in the same shell command) runs mod.mjs in plain Node with a stand-in `rednode` (`m1/hooks.mjs`, `m1/rednode-stub.mjs`). It needs the sandbox off, since `cloudflared` must reach Cloudflare. The shell ends every process a command started when the command ends, so run both phases in one command.
- Chooms!, the first mobile app, is designed with the user after the OS works (M3, M4).
- Stop after each phase for the user's test, in the game and on a real phone.

## Conventions

The same as REDnode's:

- **Commits:** straight to `main` and push, in small logical commits, after agreeing the plan in chat.
- **Git identity:** set per repo to `CyberbuildsAI` with the GitHub no-reply email. Never change the global identity.
- **Writing style:** plain, short sentences, tables for comparisons. Mark anything unverified as unverified.
- **Never commit game files** or data extracted from them, Cloudflare's `cloudflared` program, or a player's paired phones.
- **Security:** a paired phone may use only what EDGEmobile and its mobile apps offer, never REDnode's `api`, its MCP server or files. The server listens on `127.0.0.1` only. Any change to pairing or the tunnel gets the rules in docs/design.md, "Pairing and security", checked again. A phone gets in only with both the QR link's one-time key and the approval of someone at the PC (the user's rule, 2026-10-29).
- **Wording about the tunnel (the user's rule, 2026-10-29):** never "exposes" or "open to the internet". Say "a private web address" or "reachable from your phone", and always say in the same place how others are kept out (the two conditions), so it does not read as reckless.
- **Changelog:** `docs/changelog.md`, the Edgemodders convention (a line under **Unreleased** with each change a player would notice).
- **REDnode needs:** what EDGEmobile needs from REDnode goes to REDnode as a `request` issue, with the shape that would work (docs/design.md, "What it may ask of REDnode").

## Docs site

- `docs/` is published by GitHub Pages at https://edgemodders.github.io/EDGEmobile/ through `.github/workflows/pages.yml` (Settings > Pages > Source: GitHub Actions). Jekyll renders it with the HUD layout copied from REDagent.
- `docs/index.md` has the roadmap table: keep it current with each phase. Add every new page to `nav` in `docs/_config.yml`.
- The banner, social image, icon and badges come from `tools/brand/` (`render.ps1`, copied from EDGEchat's house style). Update the status badge in `badges.py` when the phase changes, then render again.
