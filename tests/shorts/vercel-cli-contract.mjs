// Real pinned CLI HTTP serialization, loopback only; no Google/Vercel credentials.
// Usage: node tests/shorts/vercel-cli-contract.mjs /path/to/node_modules/vercel
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert(process.argv[2], 'Pass the installed vercel@59.25.4 package directory');
const packageDir = resolve(process.argv[2]);
const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
assert.equal(pkg.name, 'vercel');
assert.equal(pkg.version, '59.25.4', 'Retest deliberately when changing the pinned CLI');
const chunksDir = join(packageDir, 'dist/chunks');
let clientFile;
for (const filename of await readdir(chunksDir)) {
  if (!filename.endsWith('.js')) continue;
  const source = await readFile(join(chunksDir, filename), 'utf8');
  if (/export\{[^}]*\bClient\b[^}]*\}/.test(source) && source.includes('async _fetch(')) {
    clientFile = join(chunksDir, filename);
    break;
  }
}
assert(clientFile, 'Pinned CLI Client implementation must be available');
const { Client } = await import(pathToFileURL(clientFile));
const root = fileURLToPath(new URL('../../', import.meta.url));
const payloads = JSON.parse(execFileSync('python3', ['-c', `
import contextlib, importlib.util, io, json
spec = importlib.util.spec_from_file_location('connector', 'infra/shorts/connect.py')
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
calls = []
c.vercel = lambda command, path, method, data: calls.append(dict(path=path, method=method, data=data)) or {}
with contextlib.redirect_stdout(io.StringIO()):
    c.branch_vars(None, 'fixture-project', 'fixture-team', {
        'SHORTS_ENABLED': 'true', 'SHORTS_ENVIRONMENT': 'production',
        'SHORTS_PRODUCTION_URL': 'https://fixture.invalid',
        'SHORTS_FIREBASE_WEB_CONFIG': json.dumps({'apiKey':'not-a-real-key','projectId':'fixture'}),
        'STUDIO_ALLOWED_EMAILS': 'owner@example.invalid'})
print(json.dumps(calls))
`], { cwd: root, encoding: 'utf8' }));
assert.equal(payloads.length, 5);
const requests = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const type = req.headers['content-type'];
  requests.push({ body, type });
  let valid = false;
  try { JSON.parse(body); valid = type?.startsWith('application/json'); } catch {}
  res.writeHead(valid ? 200 : 400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(valid ? { created: true } : { error: 'invalid_json_fixture' }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const client = {
  apiUrl: `http://127.0.0.1:${server.address().port}`, config: {}, authConfig: {},
  telemetryEventStore: { currentSessionId: 'fixture', currentInvocationId: 'fixture' },
  requestIdCounter: 0, ensureAuthorized: async () => {},
};
try {
  const old = await Client.prototype._fetch.call(client, '/fixture', {
    method: 'POST', body: payloads.map(row => row.data),
  });
  assert.equal(old.status, 400);
  await old.text();
  assert.match(requests[0].body, /^\[object Object\]/);
  console.log('Reproduced old batch failure with real vercel@59.25.4: invalid text/plain body.');
  for (const { path, method, data } of payloads) {
    assert.equal(Array.isArray(data), false);
    const response = await Client.prototype._fetch.call(client, path, { method, body: data });
    assert.equal(response.status, 200);
    await response.text();
    assert.deepEqual(JSON.parse(requests.at(-1).body), data);
  }
  console.log('PASS: all 5 actual connector payloads reach loopback as valid application/json.');
  console.log('No authenticated API calls, infrastructure changes or model generations.');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
