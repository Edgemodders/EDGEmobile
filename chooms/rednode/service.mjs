// Chooms!'s service: the one function its mobile app reaches, through EDGEmobile's bridge
// (docs/design.md, "C1 plan"). Runs in Chooms!'s mod worker, so it shares mod.mjs's state.

import { service } from 'rednode';
import { answer } from './mod.mjs';

/**
 * A call from the Chooms! mobile app, passed on by EDGEmobile for a signed-in screen.
 * @param {object} request The app, the screen ('game' or 'phone'), the call's name and its arguments.
 * @returns {object} The answer for the app.
 */
export function mobile(request) {
  if (service.caller()?.id !== 'edgemobile') throw new Error('Only EDGEmobile may call Chooms!');
  if (request?.app !== 'chooms') throw new Error('Only the Chooms! app may call Chooms!');
  const args = Array.isArray(request.args) ? request.args : [];
  return answer(String(request.call ?? ''), args);
}
