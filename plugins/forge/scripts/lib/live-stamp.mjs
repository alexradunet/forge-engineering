// The change stamp of the live server (live-serve.mjs): a short hash that tells a page that the data of the page changed.
// The board stamp covers the board model that the board page shows.
// The needs count is the number that the tab title and the icon of a page show. This file imports only Node built-ins.
import { createHash } from 'node:crypto';

const STAMP_LENGTH = 12;

const stampOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, STAMP_LENGTH);

/** The stamp of a board model (buildBoard). The time of its generation is not a part of it. */
export function boardStamp(board) {
  return stampOf(JSON.stringify(board ?? null, (key, value) => (key === 'generated' ? undefined : value)));
}

/**
 * The count for the tab: each board ticket in the state needs-me, and each live session in the state needs-you whose ticket is not counted yet.
 * Two sessions of one ticket count one time. A session without a ticket counts for itself.
 */
export function needsCount(tickets, sessions) {
  const counted = new Set(tickets.filter((item) => item.state === 'needs-me').map((item) => item.folder));
  let count = counted.size;
  for (const session of sessions) {
    if (session.state !== 'needs-you') continue;
    if (!session.ticket) { count += 1; continue; }
    if (counted.has(session.ticket)) continue;
    counted.add(session.ticket);
    count += 1;
  }
  return count;
}
