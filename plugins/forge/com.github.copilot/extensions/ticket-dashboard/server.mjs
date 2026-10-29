import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readTicketDoc, readTickets, readWikiDoc } from './tickets.mjs';

const assets = new Map([
  ['/', ['text/html; charset=utf-8', new URL('./ui.html', import.meta.url)]],
  ['/ui.js', ['text/javascript; charset=utf-8', new URL('./ui.js', import.meta.url)]],
  ['/ui.css', ['text/css; charset=utf-8', new URL('./ui.css', import.meta.url)]],
  ['/vendor/mermaid.min.js', ['text/javascript; charset=utf-8', new URL('./vendor/mermaid.min.js', import.meta.url)]],
]);
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
};

export async function startDashboard(wikiPath, reportError) {
  let origin;
  const server = createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, { ...headers, 'Content-Type': type });
      response.end(body);
    };
    if (request.headers.host !== new URL(origin).host
      || (request.headers.origin && request.headers.origin !== origin)
      || (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))) {
      return send(403, 'text/plain', 'Forbidden');
    }
    if (request.method !== 'GET') return send(405, 'text/plain', 'Only GET is supported.');
    try {
      const url = new URL(request.url, origin);
      if (url.origin !== origin || url.search) return send(400, 'text/plain', 'Invalid request URL.');
      if (url.pathname === '/state') {
        return send(200, 'application/json; charset=utf-8', JSON.stringify(await readTickets(wikiPath)));
      }
      const docMatch = /^\/tickets\/([^/]+)\/docs\/(.+)$/.exec(url.pathname);
      if (docMatch) {
        let folder;
        let docPath;
        try {
          folder = decodeURIComponent(docMatch[1]);
          docPath = docMatch[2].split('/').map(decodeURIComponent).join('/');
        } catch {
          return send(400, 'application/json; charset=utf-8', JSON.stringify({ error: 'Invalid URL encoding.' }));
        }
        try {
          const doc = await readTicketDoc(wikiPath, folder, docPath);
          return send(200, 'application/json; charset=utf-8', JSON.stringify(doc));
        } catch (error) {
          const status = error.code === 'ENOENT' ? 404 : 400;
          return send(status, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
        }
      }
      const wikiMatch = /^\/wiki\/docs\/(.+)$/.exec(url.pathname);
      if (wikiMatch) {
        let docPath;
        try {
          docPath = wikiMatch[1].split('/').map(decodeURIComponent).join('/');
        } catch {
          return send(400, 'application/json; charset=utf-8', JSON.stringify({ error: 'Invalid URL encoding.' }));
        }
        try {
          const doc = await readWikiDoc(wikiPath, docPath);
          return send(200, 'application/json; charset=utf-8', JSON.stringify(doc));
        } catch (error) {
          const status = error.code === 'ENOENT' ? 404 : 400;
          return send(status, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
        }
      }
      const asset = assets.get(url.pathname);
      if (!asset) return send(404, 'text/plain', 'Not found');
      send(200, asset[0], await readFile(asset[1]));
    } catch (error) {
      reportError(error);
      send(500, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.on('error', reportError);
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    wikiPath,
    url: `${origin}/`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
