// EDGEmobile's Node mod. From M1 on it runs the phone's web server and WebSocket on
// 127.0.0.1, starts and watches the Cloudflare quick tunnel, keeps paired phones and
// finds mobile apps (docs/design.md). For now it only says it started.

import { pkg } from 'rednode';

console.log(`EDGEmobile started from ${pkg.dir} (skeleton: no server yet)`);
