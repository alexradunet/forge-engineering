import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { grepLines, jobUrl, main, parseArgs } from '../plugins/forge/scripts/jenkins.mjs';

let server, host;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, crumb: req.headers['jenkins-crumb'] });
    if (req.headers.authorization !== `Basic ${Buffer.from('me:tok').toString('base64')}`) { res.writeHead(401); return res.end(); }
    if (req.url.startsWith('/api/json')) { res.writeHead(200); return res.end('{}'); }
    if (req.url === '/crumbIssuer/api/json') { res.writeHead(200); return res.end('{"crumbRequestField":"Jenkins-Crumb","crumb":"c1"}'); }
    if (req.url.startsWith('/job/f/job/app/lastBuild/api/json')) { res.writeHead(200); return res.end('{"number":7,"result":"SUCCESS"}'); }
    if (req.url === '/job/f/job/app/7/consoleText') { res.writeHead(200); return res.end('a\nb\nERROR here\nc\nd\n'); }
    if (req.url.startsWith('/job/f/job/app/buildWithParameters')) { res.writeHead(201, { location: `${host}/queue/item/9/` }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  host = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const run = async (argv, secret = 'me:tok') => {
  const lines = [];
  await main([...argv, '--host', host], { getSecret: () => secret, out: (l) => lines.push(l) });
  return lines.join('\n');
};

test('helpers', () => {
  assert.equal(jobUrl('https://ci/', 'f/app'), 'https://ci/job/f/job/app');
  assert.equal(jobUrl('https://ci', 'job/f/job/app'), 'https://ci/job/f/job/app');
  assert.equal(grepLines('a\nb\nX\nc\nd\ne\nf', 'X', 1), '--\n2: b\n3: X\n4: c');
  assert.deepEqual(parseArgs(['trigger', 'f/app', 'BRANCH=main', 'X=a=b']).params, { BRANCH: 'main', X: 'a=b' });
  assert.throws(() => parseArgs(['--token', 'x']), (e) => e.code === 'bad-args');
});

test('check, status, logs, and trigger with a crumb', async () => {
  assert.equal(await run(['check']), 'ok');
  assert.equal(JSON.parse(await run(['status', 'f/app'])).number, 7);
  assert.match(await run(['logs', 'f/app', '7', '--grep', 'ERROR', '--context', '1']), /2: b\n3: ERROR here\n4: c/);
  assert.equal(await run(['logs', 'f/app', '7', '--tail', '2']), 'd\n');
  const t = JSON.parse(await run(['trigger', 'f/app', 'BRANCH=main']));
  assert.equal(t.status, 201);
  assert.match(t.queue, /queue\/item\/9/);
  const post = seen.find((s) => s.method === 'POST');
  assert.equal(post.crumb, 'c1');
  assert.equal(post.url, '/job/f/job/app/buildWithParameters?BRANCH=main');
});

test('errors name the status and never the secret', async () => {
  await assert.rejects(run(['check'], 'me:wrong'), (e) => e.code === 'http-401' && !e.message.includes('wrong'));
  await assert.rejects(main(['check', '--host', 'http://example.com'], { getSecret: () => 'me:tok' }), (e) => e.code === 'bad-host');
});
