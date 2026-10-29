// EDGEphone's screen. EDGEmobile's service gives the address of the shell from its server at
// 127.0.0.1, with a local session for its mod's current run. When EDGEmobile restarts (hot
// reload, or switched off and on), its run changes and the phone asks for a new screen.

const { service } = await import('rednode');
const $ = (id) => document.getElementById(id);
const CHECK_MS = 3000;

let mobile = null;
let run = null;

function wait(text) {
  $('wait').textContent = text;
  $('wait').hidden = false;
  $('screen').hidden = true;
}

async function check() {
  try {
    mobile ??= await service.connect('edgemobile');
    if ((await mobile.run()) === run) return;
    const screen = await mobile.screen();
    run = screen.run;
    $('screen').src = screen.url;
    $('screen').hidden = false;
    $('wait').hidden = true;
  } catch (err) {
    mobile = null;
    run = null;
    wait(`EDGEphone needs EDGEmobile: switch it on in the Mod Manager. (${err.message})`);
  }
}

check();
setInterval(check, CHECK_MS);
