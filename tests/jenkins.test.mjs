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
    if (req.url.startsWith('/job/f/job/app/7/testReport/api/json')) { res.writeHead(200); return res.end('{"failCount":0,"passCount":3,"skipCount":1}'); }
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

test('check, status, tests, logs, and trigger with a crumb', async () => {
  assert.equal(await run(['check']), 'ok');
  assert.equal(JSON.parse(await run(['status', 'f/app'])).number, 7);
  assert.deepEqual(JSON.parse(await run(['tests', 'f/app', '7'])), { failCount: 0, passCount: 3, skipCount: 1 });
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

test('read operations reject redirects and unexpected statuses without output or retries', async (t) => {
  let status;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status, headers: { location: 'https://ci.example/login' } });
  });
  for (const argv of [['check'], ['status', 'f/app'], ['tests', 'f/app', '7'], ['logs', 'f/app', '7']]) {
    for (status of [201, 202, 204, 301, 302, 303, 307, 308, 401, 403, 500]) {
      calls.length = 0;
      const output = [];
      await assert.rejects(main([...argv, '--host', host], { getSecret: () => 'me:tok', out: (l) => output.push(l) }),
        (e) => e.code === `http-${status}`, `${argv[0]} ${status}`);
      assert.deepEqual(output, []);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].init.redirect, 'manual');
    }
  }
});

test('JSON operations reject malformed responses without success output', async (t) => {
  let body;
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));
  for (const argv of [['check'], ['status', 'f/app'], ['tests', 'f/app', '7']]) {
    for (body of ['', '<html>Sign in</html>', '{broken', 'null', '[]', '"ok"']) {
      const output = [];
      await assert.rejects(main([...argv, '--host', host], { getSecret: () => 'me:tok', out: (l) => output.push(l) }),
        (e) => e.code === 'bad-response' && !e.message.includes(body || 'Sign in'));
      assert.deepEqual(output, []);
    }
  }
});

test('trigger retains successful statuses and queue locations without retrying writes', async (t) => {
  let status, crumbStatus;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/crumbIssuer/')) {
      return new Response(crumbStatus === 200 ? '{"crumbRequestField":"Jenkins-Crumb","crumb":"c1"}' : null, { status: crumbStatus });
    }
    return new Response(null, { status, headers: { location: `${host}/queue/item/9/` } });
  });
  for (crumbStatus of [200, 404]) {
    for (status of [200, 201, 202, 204]) {
      calls.length = 0;
      assert.deepEqual(JSON.parse(await run(['trigger', 'f/app'])), { status, queue: `${host}/queue/item/9/` });
      assert.equal(calls.length, 2);
      assert.equal(calls[1].init.method, 'POST');
      assert.equal(calls[1].init.headers['Jenkins-Crumb'], crumbStatus === 200 ? 'c1' : undefined);
    }
  }
});

test('trigger rejects redirects and unexpected statuses with one POST and no output', async (t) => {
  let status;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return url.includes('/crumbIssuer/')
      ? new Response(null, { status: 404 })
      : new Response(null, { status, headers: { location: 'https://ci.example/login' } });
  });
  for (status of [205, 206, 301, 302, 303, 307, 308, 400, 403, 500]) {
    calls.length = 0;
    const output = [];
    await assert.rejects(main(['trigger', 'f/app', '--host', host], { getSecret: () => 'me:tok', out: (l) => output.push(l) }),
      (e) => e.code === `http-${status}`);
    assert.deepEqual(output, []);
    assert.equal(calls.filter((c) => c.init.method === 'POST').length, 1);
    assert.equal(calls.length, 2);
  }
});

test('trigger never writes after a redirected or malformed crumb response', async (t) => {
  let response;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return new Response(response.body, { status: response.status });
  });
  for (response of [
    { status: 302, body: null },
    { status: 201, body: null },
    { status: 204, body: null },
    { status: 500, body: null },
    ...['<html>Login</html>', '{}', 'null', '{"crumbRequestField":"Jenkins-Crumb"}',
      '{"crumbRequestField":4,"crumb":"c1"}', '{"crumbRequestField":"Invalid Header","crumb":"c1"}',
      '{"crumbRequestField":"Jenkins-Crumb","crumb":""}']
      .map((body) => ({ status: 200, body })),
  ]) {
    calls.length = 0;
    await assert.rejects(run(['trigger', 'f/app']), (e) => e.code === (response.status === 200 ? 'bad-response' : `http-${response.status}`));
    assert.equal(calls.length, 1);
    assert.ok(calls.every((c) => c.init.method !== 'POST'));
  }
});

test('trigger does not retry an uncertain write after a connection failure', async (t) => {
  const calls = [];
  const failure = new Error('Connection closed');
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/crumbIssuer/')) return new Response(null, { status: 404 });
    throw failure;
  });
  const output = [];
  await assert.rejects(main(['trigger', 'f/app', '--host', host], { getSecret: () => 'me:tok', out: (l) => output.push(l) }),
    (e) => e === failure);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((c) => c.init.method === 'POST').length, 1);
  assert.deepEqual(output, []);
});
