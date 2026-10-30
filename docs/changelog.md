# Changelog

What changed in each EDGEmobile release, for players. Each release takes its notes from its section here: the GitHub release and the version's changelog on the Nexus Mods page.

How to keep it (the Edgemodders convention):

- With each change a player would notice, add a line under **Unreleased**, in its group: **New**, **Changed**, **Fixed** or **Other**. One change per line.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it.
- Links are full URLs, since the same text goes to GitHub and Nexus.

## Unreleased

### New

- Mobile apps on the phone's home screen, with their badges: an app opens full screen, and the bar at the bottom goes home. Each app runs walled off from the phone's sign-in and from other apps, and reaches only its own part on your PC. Apps go in `red4ext/plugins/REDnode/mobile-apps/`, and one unpacked while the game runs shows at once.
- EDGEphone, the phone in the game, is its own app: pin it to the HUD on its own. Connecting a phone stays in EDGEmobile's window.
- District names on the phone are in the game's language.

### Changed

- Needs REDnode 0.47.2 or later.
- The phone's status line comes back as soon as V is in the world after a load.

### Fixed

- The game no longer crashes on launch when the phone is open while the game starts.
- A load that starts while the phone reads the game no longer shows in the log as a failure, and no longer hides a real one.
