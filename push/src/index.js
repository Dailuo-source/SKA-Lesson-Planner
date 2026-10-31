// SKA Lesson Planner push sender (Cloudflare Worker).
// Every 5 minutes it asks the planner's Apps Script what is due ({cron: CRON_KEY}) and sends each
// message as a Web Push notification, signed with the VAPID key and encrypted for each phone (RFC 8291).
// Google Apps Script can't sign ES256 or do the ECDH encryption, which is why this lives here.
// POST /run does the same thing straight away (the app uses it after "Send a test").
// Secrets (set by setup.mjs): VAPID_PRIVATE (JWK), VAPID_PUBLIC (base64url), CRON_KEY. Var: API_URL.

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method === 'POST' && url.pathname === '/run') {
      const r = await run(env);
      return new Response(JSON.stringify(r), { headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
    }
    return new Response('SKA Lesson Planner notifications', { headers: cors });
  },
};

export async function run(env, fetchFn) {
  const f = fetchFn || fetch;
  let j;
  try {
    const r = await f(env.API_URL, { method: 'POST', body: JSON.stringify({ cron: env.CRON_KEY }), redirect: 'follow' });
    j = await r.json();
  } catch (e) {
    return { ok: false, error: 'Could not reach the planner: ' + e };
  }
  if (!j || !j.ok) return { ok: false, error: (j && (j.message || j.error)) || 'no reply' };
  const gone = [];
  let sent = 0, failed = 0;
  for (const m of j.pushes || []) {
    try {
      const res = await sendPush(env, m.sub, JSON.stringify(m.msg), f);
      if (res.status === 404 || res.status === 410) gone.push(m.sub.endpoint);
      else if (res.ok) sent++;
      else { failed++; console.log('push failed', res.status, await res.text()); }
    } catch (e) {
      failed++; console.log('push error', String(e));
    }
  }
  if (gone.length) {
    try { await f(env.API_URL, { method: 'POST', body: JSON.stringify({ cron: env.CRON_KEY, gone }), redirect: 'follow' }); } catch (e) { /* next run */ }
  }
  return { ok: true, sent, failed, gone: gone.length };
}

/* ---------- Web Push ---------- */

const enc = new TextEncoder();
export const b64u = {
  enc(buf) {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
// HKDF in two steps (RFC 5869); every output here is at most 32 bytes, so one expand block is enough.
const extract = (salt, ikm) => hmac(salt, ikm);
const expand = async (prk, info, len) => (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);

/** Encrypt a payload for one subscription (aes128gcm, RFC 8188/8291). */
export async function encryptPayload(sub, payload) {
  const uaPublic = b64u.dec(sub.keys.p256dh);
  const authSecret = b64u.dec(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const prkKey = await extract(authSecret, ecdh);
  const ikm = await expand(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await extract(salt, ikm);
  const cek = await expand(prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expand(prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 0x02 = last record, no padding
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** VAPID JWT (ES256) for one push service. */
export async function vapidJwt(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://ska-lesson-planner.pages.dev' })));
  const jwk = typeof env.VAPID_PRIVATE === 'string' ? JSON.parse(env.VAPID_PRIVATE) : env.VAPID_PRIVATE;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return header + '.' + claims + '.' + b64u.enc(sig);
}

export async function sendPush(env, sub, payload, fetchFn) {
  const body = await encryptPayload(sub, payload);
  const jwt = await vapidJwt(env, sub.endpoint);
  return (fetchFn || fetch)(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    },
    body,
  });
}
