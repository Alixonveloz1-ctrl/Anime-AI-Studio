const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { generateKeyPairSync, sign } = require('node:crypto');
const access = require('../../api/_lib/access');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const firebase = { projectId: 'studio-test', apiKey: 'fixture-public-key', authDomain: 'studio-test.firebaseapp.com', appId: 'fixture-app' };
const settings = { firebase, emails: ['owner@example.com'] };
const now = () => Math.floor(Date.now() / 1000);
const payload = overrides => ({ sub: 'owner-id', aud: firebase.projectId, iss: 'https://securetoken.google.com/' + firebase.projectId,
  iat: now() - 2, exp: now() + 3600, auth_time: now() - 20, email: 'owner@example.com', email_verified: true,
  firebase: { sign_in_provider: 'google.com' }, ...overrides });
function token(overrides, header = {}) {
  const parts = [ { alg: 'RS256', kid: 'fixture', ...header }, payload(overrides) ].map(x => Buffer.from(JSON.stringify(x)).toString('base64url'));
  const data = parts.join('.'); return data + '.' + sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
}
let calls, account, originalFetch, originalConfig, originalEmails;
function fakeFetch(url, options) {
  calls.push({ url: String(url), options });
  if (url === access.CERTS) return Promise.resolve(new Response(JSON.stringify({ fixture: publicKey.export({ type: 'spki', format: 'pem' }) }), { headers: { 'Cache-Control': 'public, max-age=600' } }));
  assert.equal(String(url), 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=fixture-public-key');
  assert.ok(JSON.parse(options.body).idToken);
  return Promise.resolve(new Response(JSON.stringify({ users: [account] })));
}
beforeEach(() => {
  calls = []; account = { localId: 'owner-id', email: 'owner@example.com', emailVerified: true, validSince: '1' };
  originalFetch = global.fetch; originalConfig = process.env.SHORTS_FIREBASE_WEB_CONFIG; originalEmails = process.env.STUDIO_ALLOWED_EMAILS;
  global.fetch = fakeFetch; process.env.SHORTS_FIREBASE_WEB_CONFIG = JSON.stringify(firebase); process.env.STUDIO_ALLOWED_EMAILS = 'owner@example.com';
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of [['SHORTS_FIREBASE_WEB_CONFIG', originalConfig], ['STUDIO_ALLOWED_EMAILS', originalEmails]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function response() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(n) { this.statusCode = n; return this; },
    json(value) { this.value = value; return this; }, end() { this.ended = true; return this; } };
}
function request(options = {}) {
  return { url: '/api/image', method: 'POST', body: {}, ...options,
    headers: { host: 'studio.example', origin: 'https://studio.example', 'sec-fetch-site': 'same-origin', ...options.headers } };
}
test('real RSA signature, exact Firebase project and current owner authorize a request', async () => {
  const verifier = access.createVerifier(); const identity = await verifier(token(), settings);
  assert.equal(identity.uid, 'owner-id'); assert.equal(calls.length, 2);
  await verifier(token(), settings); assert.equal(calls.length, 3, 'only certificates are cached; identity/revocation is rechecked');
});
test('forged, expired, wrong-project, anonymous and unverified tokens fail closed', async () => {
  const verifier = access.createVerifier();
  for (const value of ['', 'x.y.z', token().slice(0, -10) + 'abcdefghij', token({ exp: now() - 1 }), token({ aud: 'other' }),
    token({ iss: 'https://evil.example' }), token({ iat: now() + 10 }), token({ auth_time: now() + 10 }), token({ sub: '' }),
    token({ email_verified: false }), token({ firebase: { sign_in_provider: 'anonymous' } }), token({}, { alg: 'none' }), token({}, { kid: '__proto__' })])
    await assert.rejects(verifier(value, settings), e => e.status === 401);
  assert.equal(calls.filter(c => c.url.includes('accounts:lookup')).length, 0);
});
test('a valid Google login from another account still has no access', async () => {
  await assert.rejects(access.createVerifier()(token({ email: 'someone@example.com' }), settings), e => e.status === 403);
  assert.equal(calls.filter(c => c.url.includes('accounts:lookup')).length, 0);
});
test('deleted, disabled, changed-email and revoked accounts are rejected', async () => {
  const verifier = access.createVerifier();
  for (const change of [null, { disabled: true }, { localId: 'someone' }, { email: 'someone@example.com' }, { emailVerified: false }, { validSince: String(now()) }]) {
    account = change === null ? null : { localId: 'owner-id', email: 'owner@example.com', emailVerified: true, ...change };
    await assert.rejects(verifier(token(), settings), e => e.status === 401);
  }
});
test('Google outage never permits access and never leaks upstream diagnostics', async () => {
  const verifier = access.createVerifier({ fetcher: async () => { throw new Error('secret token details'); } });
  await assert.rejects(verifier(token(), settings), e => e.status === 503 && !e.message.includes('secret'));
});
test('private config fails closed and public config excludes owner and credentials', async () => {
  const out = response(); await access.handleSession(request({ method: 'GET', url: '/api/health?studioAuth=config' }), out);
  assert.deepEqual(out.value, { firebase }); assert.equal(out.headers['cache-control'], 'private, no-store');
  delete process.env.STUDIO_ALLOWED_EMAILS;
  const blocked = response(); assert.equal(await access.requireOwner(request(), blocked), true); assert.equal(blocked.statusCode, 503);
  assert.equal(calls.length, 0);
});
test('shared cookie is HttpOnly/Secure/Strict, expires with token and logout removes it', async () => {
  const value = token(), out = response();
  await access.handleSession(request({ url: '/api/health?studioAuth=session', headers: { authorization: 'Bearer ' + value } }), out);
  assert.equal(out.statusCode, 200); assert.deepEqual(out.value, { uid: 'owner-id' });
  assert.match(out.headers['set-cookie'], /^__Host-studio_session=/);
  assert.match(out.headers['set-cookie'], /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=\d+/);
  assert.ok(Number(out.headers['set-cookie'].split('Max-Age=')[1]) <= 3600);
  const status = response(); await access.handleSession(request({ url: '/api/health?studioAuth=status', method: 'GET', headers: { cookie: access.COOKIE + '=' + value } }), status);
  assert.equal(status.statusCode, 200);
  const logout = response(); await access.handleSession(request({ url: '/api/health?studioAuth=logout' }), logout);
  assert.match(logout.headers['set-cookie'], /Max-Age=0$/);
});
test('cross-site POST, missing Origin and cookie-only login cannot create a session or generate', async () => {
  for (const origin of ['https://evil.example', undefined, 'null']) {
    const req = request({ headers: { origin, cookie: access.COOKIE + '=' + token() } });
    const out = response(); await access.requireOwner(req, out); assert.equal(out.statusCode, 403);
    req.url = '/api/health?studioAuth=session'; const login = response(); await access.handleSession(req, login); assert.equal(login.statusCode, 403);
  }
  const out = response(); await access.handleSession(request({ url: '/api/health?studioAuth=session', headers: { cookie: access.COOKIE + '=' + token() } }), out);
  assert.equal(out.statusCode, 401); assert.equal(calls.length, 0);
});
test('every Animes API rejects unauthenticated direct calls before touching Google', async () => {
  for (const name of fs.readdirSync('api').filter(x => x.endsWith('.js'))) {
    const handler = require('../../api/' + name), out = response();
    await handler(request({ url: '/api/' + name.slice(0, -3) }), out);
    assert.equal(out.statusCode, 401, name); assert.equal(out.headers['access-control-allow-origin'], undefined);
    assert.equal(calls.length, 0, name + ' contacted a provider');
  }
});
test('authorized Animes API bodies retain baseline outcomes with provider stubs', async () => {
  const gcp = require('../../api/_lib/gcp');
  for (const name of fs.readdirSync('api').filter(x => x.endsWith('.js'))) {
    const current = fs.readFileSync('api/' + name, 'utf8');
    const old = execFileSync('git', ['show', '958248ec2fe90fb4a2b0b5004d2a53642a274995:api/' + name], { encoding: 'utf8' });
    const results = [], providers = [];
    for (const [source, legacy] of [[old, true], [current, false]]) {
      let reached = 0;
      const stopProvider = () => { reached++; throw new Error('fixture provider not connected'); };
      const helpers = { ...gcp, auth: stopProvider, loadServiceAccount: stopProvider, getAccessToken: stopProvider,
        begin: legacy ? () => false : gcp.begin };
      const context = { module: { exports: {} }, require: path => path === './_lib/gcp' ? helpers : path === './_lib/access' ? access : require(path.startsWith('./') ? '../../api/' + path.slice(2) : path),
        console, process, Buffer, URL, fetch: async () => { throw new Error('Unexpected provider call'); } };
      vm.runInNewContext(source, context, { filename: name });
      const out = response(); await context.module.exports(request({ headers: { cookie: access.COOKIE + '=' + token() } }), out);
      results.push(JSON.stringify({ status: out.statusCode, value: out.value })); providers.push(reached);
    }
    assert.equal(results[1], results[0], name); assert.equal(providers[1], providers[0], name);
  }
});
test('both sections use one gate; no cookie, invalid session and network failure redirect', async () => {
  const { pageGate } = await import('../../auth/gate.mjs');
  for (const path of ['/', '/index.html', '/cortos/', '/cortos/index.html']) {
    const req = new Request('https://studio.example' + path);
    const result = await pageGate(req, () => { throw new Error('must not fetch'); });
    assert.equal(result.status, 303); assert.equal(new URL(result.headers.get('location')).pathname, '/login/');
    const cookieReq = new Request(req, { headers: { cookie: access.COOKIE + '=untrusted' } });
    for (const fetcher of [async () => new Response('', { status: 401 }), async () => { throw new Error('offline'); }])
      assert.equal((await pageGate(cookieReq, fetcher)).status, 303);
    const allowed = await pageGate(cookieReq, async (url, opts) => {
      assert.equal(url.pathname, '/api/health'); assert.equal(opts.headers.cookie, access.COOKIE + '=untrusted'); return new Response('{}');
    });
    assert.equal(allowed.headers.get('x-middleware-next'), '1');
    assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
  }
});

test('New recovery reads and restores reject unauthorized access before storage',async()=>{
 const handler=require('../../api/upload-url');
 for(const action of ['projectRecovery','projectRecover']){const out=response();await handler(request({url:'/api/upload-url',body:{action,id:'p12345678',key:'deleted:3',expectedGeneration:'4'}}),out);assert.equal(out.statusCode,401);assert.equal(calls.length,0);}
});
