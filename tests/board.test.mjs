import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { parseArgs, pickPort } from '../plugins/forge/scripts/board.mjs';

test('parseArgs reads options and rejects unknown ones', () => {
  assert.deepEqual(parseArgs(['--ticket', 'app-1', '--check']), { check: true, restart: false, stop: false, ticket: 'app-1' });
  assert.throws(() => parseArgs(['--bogus']), (e) => e.code === 'bad-args');
  assert.throws(() => parseArgs(['--port', '70000']), (e) => e.code === 'bad-args');
});

test('pickPort skips ports of other wikis and busy ports', async () => {
  const busy = net.createServer();
  await new Promise((r) => busy.listen(0, '127.0.0.1', r));
  const busyPort = busy.address().port;
  try {
    assert.equal(await pickPort('/w/a', { boards: {} }, '5000'), 5000);
    const p = await pickPort('/w/a', { boards: { '/w/b': { port: 4517 } } });
    assert.notEqual(p, 4517);
    assert.ok(p > 4517 && p < 4717);
    // A recorded port that another server now holds is not reused.
    const q = await pickPort('/w/a', { boards: { '/w/a': { port: busyPort } } });
    assert.notEqual(q, busyPort);
  } finally {
    busy.close();
  }
});
