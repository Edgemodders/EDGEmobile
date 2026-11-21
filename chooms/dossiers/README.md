# Chooms!'s dossiers

The pictures and places Chooms! ships for each person. A player starts with them in Chooms!'s settings window in the game, and can then change, add or remove them; **Reset to default** brings these back.

Each person has a folder named by their id in `chooms/rednode/roster.json`:

| File | What |
|---|---|
| `portrait.png` | Their face, shoulders up. Their picture in the app |
| `body.png` | Head to toe, standing, on a plain background if you can. Used for photos of them doing something |
| `places/<name>.png` | A place where photos of them are taken |
| `places/<name>.md` | Beside each place: the place in one line, then what they might do there, one per line |

PNG, JPG and WebP all work. A place's `.md` looks like this:

```markdown
# The Aldecaldos camp
- working on her car
- around the campfire
- polishing her rifle
```

The places already written are suggestions: change them, remove them, or add your own. A `.md` with no image beside it yet is a place still to take; it is left out until its image is there. Name the image as the `.md`: `places/aldecaldos-camp.md` takes `places/aldecaldos-camp.png`.

## After adding images

1. Run `node tools/chooms/dossiers.mjs`. It makes every image at most 1440 pixels across, as WebP, in place (as the settings window does with a picked image), so keep your originals elsewhere if you want them. It brings each person's checklist and the table below up to date, and says what is wrong: an image with no `.md`, two portraits, a folder that is not a person.
2. Check the changes with git and commit them.

The release zip builds Chooms!'s `content/` from these folders (`dossiers.mjs --build`), and so does `tools/deploy.ps1` for the game on this PC. Pictures set in the game's settings window can be copied in here with `node tools/chooms/export-content.mjs`.

*Shipping the pictures:* photo mode screenshots are fine to ship in a free mod (the user's decision, 2026-11-21: photo mode is built into the game, and its pictures are shared across the internet). Chooms! stays free and says it is not affiliated with CD Projekt RED.

## Progress

<!-- table: written by tools/chooms/dossiers.mjs -->
| Person | Portrait | Body | Places | To take |
|---|---|---|---|---|
| [Judy Alvarez](judy/README.md) | — | — | 0 | 3 |
| [Panam Palmer](panam/README.md) | — | — | 0 | 3 |
| [Jackie Welles](jackie/README.md) | — | — | 0 | 3 |
| [River Ward](river/README.md) | — | — | 0 | 2 |
| [Kerry Eurodyne](kerry/README.md) | — | — | 0 | 3 |
| [Viktor Vektor](viktor/README.md) | — | — | 0 | 2 |
| [Misty Olszewski](misty/README.md) | — | — | 0 | 2 |
| [Delamain](delamain/README.md) | — | — | 0 | 2 |
| [Rogue Amendiares](rogue/README.md) | — | — | 0 | 2 |
| [Regina Jones](regina/README.md) | — | — | 0 | 2 |
| [Wakako Okada](wakako/README.md) | — | — | 0 | 2 |
| [Padre](padre/README.md) | — | — | 0 | 2 |
| [Dakota Smith](dakota/README.md) | — | — | 0 | 2 |
| [Mr. Hands](hands/README.md) | — | — | 0 | 2 |
| [Hanako Arasaka](hanako/README.md) | — | — | 0 | 2 |
| [Kurt Hansen](kurt/README.md) | — | — | 0 | 2 |
<!-- /table -->
