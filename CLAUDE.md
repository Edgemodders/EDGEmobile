# EDGEmobile: notes for Claude sessions

EDGEmobile is a phone operating system for Cyberpunk 2077, built as a REDnode app: one phone shown in the game (REDnode's overlay and HUD) and on the player's real phone (a web app reached through a Cloudflare quick tunnel, paired by QR code and a pairing code, installable as a PWA). Read [docs/design.md](docs/design.md) first. It depends on [REDnode](https://github.com/Edgemodders/REDnode), checked out beside this repo at `../REDnode`; read that repo's CLAUDE.md for the runtime, the tests and the conventions.

## Status and next step

- Asked for by the user on 2026-10-29 as a side project ahead of REDnode's schedule, since it may change and improve REDnode; REDnode's schedule resumes after it. Its own repo, version, changelog, zip and Nexus page.
- The look comes from the user's design canvas **Chooms! prototype** (claude.ai artifact https://claude.ai/artifact/CfF1Ri6LhBR5FkGPhGNFp3, private to the user; read it with the Artifact tool), whose **Home screen** artboard is the basis for the OS, with the **Night City Mobile UI** design system (https://claude.ai/artifact/TwDf9vxw4BxqLppZSzhCmn). Its tokens and component styles are copied into `edgemobile/shell/theme/`.
- M0 (scaffolding and the design) done on 2026-10-29. **Next: agree the design's open questions with the user, then M1, the tunnel spike.**
- Chooms!, the first mobile app, is designed with the user after the OS works (M3, M4).
- Stop after each phase for the user's test, in the game and on a real phone.

## Conventions

The same as REDnode's:

- **Commits:** straight to `main` and push, in small logical commits, after agreeing the plan in chat.
- **Git identity:** set per repo to `CyberbuildsAI` with the GitHub no-reply email. Never change the global identity.
- **Writing style:** plain, short sentences, tables for comparisons. Mark anything unverified as unverified.
- **Never commit game files** or data extracted from them, Cloudflare's `cloudflared` program, or a player's paired phones.
- **Security:** a paired phone may use only what EDGEmobile and its mobile apps offer, never REDnode's `api`, its MCP server or files. The server listens on `127.0.0.1` only. Any change to pairing or the tunnel gets the rules in docs/design.md, "Pairing and security", checked again.
- **Changelog:** `docs/changelog.md`, the Edgemodders convention (a line under **Unreleased** with each change a player would notice).
- **REDnode needs:** what EDGEmobile needs from REDnode goes to REDnode as a `request` issue, with the shape that would work (docs/design.md, "What it may ask of REDnode").

## Docs site

- `docs/` is published by GitHub Pages at https://edgemodders.github.io/EDGEmobile/ through `.github/workflows/pages.yml` (Settings > Pages > Source: GitHub Actions). Jekyll renders it with the HUD layout copied from REDagent.
- `docs/index.md` has the roadmap table: keep it current with each phase. Add every new page to `nav` in `docs/_config.yml`.
