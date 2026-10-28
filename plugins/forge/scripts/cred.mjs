#!/usr/bin/env node
// forge credential store. Only the user runs "set", in a terminal.
//   node cred.mjs set <name>      asks for the secret (hidden), or reads it from stdin
//   node cred.mjs has <name>      prints "set" (exit 0) or "absent" (exit 1)
//   node cred.mjs delete <name>
// There is no "get": scripts call getSecret() from lib/cred.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/cred.mjs';
import { ForgeError } from './lib/repo.mjs';

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stderr.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new ForgeError('Cancelled.', 'cred-cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, '');
}

export async function main(argv = process.argv.slice(2), store = createStore()) {
  const [cmd, name] = argv;
  try {
    if (cmd === 'set' && name) {
      const secret = process.stdin.isTTY ? await readHidden(`Secret for ${name} (hidden): `) : await readStdin();
      store.set(name, secret);
      console.log(`Stored ${name} (${store.backend}).`);
      return 0;
    }
    if (cmd === 'has' && name) {
      const has = store.has(name);
      console.log(has ? 'set' : 'absent');
      return has ? 0 : 1;
    }
    if (cmd === 'delete' && name) {
      console.log(store.delete(name) ? `Deleted ${name}.` : `${name} was not stored.`);
      return 0;
    }
    console.error('Usage: node cred.mjs <set|has|delete> <name>');
    return 2;
  } catch (err) {
    if (err instanceof ForgeError) { console.error(`forge: ${err.message}`); return 1; }
    throw err;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
