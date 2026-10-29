// EDGEmobile's service, for EDGEphone (the phone in the game, a package of its own in this repo)
// and no one else: it gives EDGEphone the address of its screen, the shell from 127.0.0.1 with a
// local session. Runs in EDGEmobile's mod worker, so it shares mod.mjs's state.

import { service } from 'rednode';
import { RUN, screenUrl } from './mod.mjs';

function onlyEdgephone() {
  if (service.caller()?.id !== 'edgephone') throw new Error('Only EDGEphone may ask for the phone screen');
}

/**
 * This run of EDGEmobile's mod. It changes when the mod restarts; EDGEphone then asks for a new screen.
 * @readonly
 * @returns {string} The run's id.
 */
export function run() {
  onlyEdgephone();
  return RUN;
}

/**
 * The address of the phone's screen, with a session good through 127.0.0.1 only, for this run.
 * @returns {{ url: string, run: string }} The address, and the run it belongs to.
 */
export function screen() {
  onlyEdgephone();
  return { url: screenUrl(), run: RUN };
}
