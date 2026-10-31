// One-time setup for the SKA Lesson Planner's notifications. Run from this folder:  node setup.mjs
// 1. makes a VAPID key pair and a key the Worker uses to talk to the planner's Apps Script
// 2. deploys the Worker (asks you to sign in to Cloudflare the first time)
// 3. stores the private parts as Worker secrets (they never go into the repo)
// 4. prints one setup code to paste into the sheet: SKA Lesson Planner menu → Set up notifications…
// Running it again makes new keys: every phone then has to turn notifications on again.
import { spawnSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const run = (args, input) => {
  const r = spawnSync('npx', ['--yes', 'wrangler@4', ...args], { input, encoding: 'utf8', shell: process.platform === 'win32', stdio: [input == null ? 'inherit' : 'pipe', 'pipe', 'inherit'] });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0) { console.error('\nwrangler ' + args[0] + ' failed. Fix the message above and run node setup.mjs again.'); process.exit(1); }
  return r.stdout || '';
};

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const cronKey = b64u(crypto.getRandomValues(new Uint8Array(24)));

// Sign in to Cloudflare first if needed (the browser opens once; later runs skip this)
const who = spawnSync('npx', ['--yes', 'wrangler@4', 'whoami'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (!/associated with the email|Account ID/i.test((who.stdout || '') + (who.stderr || ''))) {
  console.log('Signing in to Cloudflare: a browser window will open. Click Allow, then come back here.');
  const r = spawnSync('npx', ['--yes', 'wrangler@4', 'login'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error('Cloudflare sign-in did not finish. Run node setup.mjs again.'); process.exit(1); }
}

console.log('Deploying the notification sender…');
const out = run(['deploy']);
const url = (out.match(/https:\/\/[\w.-]+\.workers\.dev/) || [])[0];
if (!url) { console.error('Deployed, but could not find its workers.dev address in the output above.'); process.exit(1); }

console.log('Saving the keys as Worker secrets…');
run(['secret', 'put', 'VAPID_PRIVATE'], JSON.stringify(jwk));
run(['secret', 'put', 'VAPID_PUBLIC'], pub);
run(['secret', 'put', 'CRON_KEY'], cronKey);

const code = Buffer.from(JSON.stringify({ pub, key: cronKey, url })).toString('base64url');
console.log('\nDone. Last step: in the SKA Lesson Planner sheet choose');
console.log('  SKA Lesson Planner → Set up notifications…   and paste this setup code:\n');
console.log(code + '\n');
