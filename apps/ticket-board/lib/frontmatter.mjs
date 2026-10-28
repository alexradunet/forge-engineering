import { parse } from 'yaml';

export const PHASES = ['start', 'investigate', 'plan', 'implement', 'review', 'closed'];
export const TRACKS = ['S', 'M', 'L'];
// One vocabulary with the session-title emoji of the ticket skill.
export const STATES = {
  'needs-me': '🟡',
  go: '🟢',
  active: '▶️',
  waiting: '⏳',
  blocked: '🔴',
  done: '✅',
};
export const GATES = ['Understood?', 'Agreed?', 'Briefed?', 'Diagnosed?', 'Designed?', 'Sendable?', 'Shippable?', 'Learned?'];
export const GATE_STATUS = ['todo', 'in-review', 'approved', 'skipped', 'blocked'];
export const GATE_NEED = ['required', 'recommended'];
export const PR_STATE = ['draft', 'open', 'merged', 'closed', 'abandoned'];
export const OUTBOX_STATUS = ['draft', 'approved', 'sent', 'dropped'];
export const OUTBOX_TARGET = ['tracker-comment', 'tracker-item', 'change', 'email', 'chat', 'other'];

// Document type for each file name in a ticket folder.
export const DOC_TYPES = {
  'README.md': 'ticket',
  'ticket.md': 'item-snapshot',
  'context.md': 'context',
  'interview.md': 'interview',
  'investigation.md': 'investigation',
  'plan.draft.md': 'plan-draft',
  'plan.md': 'plan',
  'review.md': 'review',
  'close.draft.md': 'close-draft',
  'evidence-testing.md': 'evidence-testing',
  'test-plan.md': 'test-plan',
  'map.md': 'map',
  'decisions.md': 'decisions',
  'troubleshooting.md': 'troubleshooting',
  'log.md': 'log',
};

export function docTypeFor(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('evidence/')) return 'evidence';
  if (p.startsWith('outbox/')) return 'outbox';
  return DOC_TYPES[p] ?? null;
}

const FM = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits a Markdown file into frontmatter data and body. */
export function splitFrontmatter(text) {
  const m = FM.exec(text);
  if (!m) return { data: null, body: text.replace(/^\uFEFF/, ''), error: null };
  try {
    const data = parse(m[1]) ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) {
      return { data: null, body: text.slice(m[0].length), error: 'frontmatter is not a mapping' };
    }
    return { data, body: text.slice(m[0].length), error: null };
  } catch (e) {
    return { data: null, body: text.slice(m[0].length), error: `invalid YAML: ${e.message.split('\n')[0]}` };
  }
}

const isDate = (v) => v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
const str = (v) => typeof v === 'string' && v.trim() !== '';

/** Normalizes YAML dates (the parser can return Date objects) to yyyy-mm-dd strings. */
export function toDay(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === 'string' ? v : '';
}

function oneOf(problems, data, key, allowed, { required = true } = {}) {
  const v = data[key];
  if (v === undefined || v === null || v === '') {
    if (required) problems.push(`missing "${key}"`);
    return;
  }
  if (!allowed.includes(v)) problems.push(`"${key}" is "${v}"; use one of: ${allowed.join(', ')}`);
}

function common(problems, data, type, ticketKey) {
  if (data.type !== type) problems.push(`"type" is "${data.type ?? ''}"; expected "${type}"`);
  if (type !== 'ticket' && ticketKey && data.ticket !== ticketKey) {
    problems.push(`"ticket" is "${data.ticket ?? ''}"; expected "${ticketKey}"`);
  }
  if (data.updated !== undefined && !isDate(data.updated)) problems.push('"updated" is not yyyy-mm-dd');
}

function validateTicket(data, problems) {
  if (!str(data.key) || !/^[A-Z][A-Z0-9]*-\d+$/.test(data.key)) problems.push('"key" must look like APP-123');
  if (!str(data.title)) problems.push('missing "title"');
  oneOf(problems, data, 'track', TRACKS, { required: false });
  oneOf(problems, data, 'phase', PHASES);
  oneOf(problems, data, 'state', Object.keys(STATES));
  if (data.next !== undefined && typeof data.next !== 'string') problems.push('"next" must be text');
  if (data.waiting_on !== undefined && data.waiting_on !== null && typeof data.waiting_on !== 'string') {
    problems.push('"waiting_on" must be text');
  }
  if (data.changes !== undefined && data.changes !== null) {
    const list = data.changes;
    if (!Array.isArray(list)) problems.push('"changes" must be a list');
    else list.forEach((p, i) => {
      if (!p || typeof p !== 'object') return problems.push(`changes[${i}] must be a mapping`);
      if (!str(p.url) || !/^https?:\/\//.test(p.url)) problems.push(`changes[${i}].url must be an http(s) URL`);
      oneOf(problems, p, 'state', PR_STATE, { required: false });
    });
  }
  if (!Array.isArray(data.gates)) problems.push('missing "gates" list');
  else data.gates.forEach((g, i) => {
    if (!g || typeof g !== 'object') return problems.push(`gates[${i}] must be a mapping`);
    if (!GATES.includes(g.name)) problems.push(`gates[${i}].name "${g.name ?? ''}"; use one of: ${GATES.join(', ')}`);
    oneOf(problems, g, 'status', GATE_STATUS);
    oneOf(problems, g, 'need', GATE_NEED, { required: false });
    if (g.status === 'approved' && !isDate(g.date)) problems.push(`gates[${i}] (${g.name}) is approved without "date"`);
  });
}

/**
 * Validates frontmatter of a ticket document. Returns a list of problem strings.
 * @param {string} type document type (see DOC_TYPES / docTypeFor)
 * @param {object|null} data parsed frontmatter
 * @param {string} [ticketKey] expected ticket key, for example APP-123
 */
export function validate(type, data, ticketKey) {
  if (!data) return ['missing frontmatter'];
  const problems = [];
  common(problems, data, type, ticketKey);
  if (type === 'ticket') validateTicket(data, problems);
  if (['context', 'interview', 'investigation', 'plan-draft', 'plan', 'review', 'close-draft'].includes(type)) {
    if (data.gate !== undefined && !GATES.includes(data.gate)) problems.push(`"gate" "${data.gate}" is not a known gate`);
  }
  if (type === 'evidence' && data.date !== undefined && !isDate(data.date)) problems.push('"date" is not yyyy-mm-dd');
  if (type === 'outbox') {
    oneOf(problems, data, 'status', OUTBOX_STATUS);
    oneOf(problems, data, 'target', OUTBOX_TARGET, { required: false });
  }
  return problems;
}
