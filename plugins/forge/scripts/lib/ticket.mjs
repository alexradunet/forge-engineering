export const STATES = ['needs-me', 'go', 'active', 'waiting', 'blocked', 'done'];
const PHASES = ['start', 'investigate', 'plan', 'implement', 'review', 'closed'];
const GATE_STATUSES = ['todo', 'in-review', 'approved', 'skipped', 'blocked'];

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

// Ticket frontmatter uses scalars and flat object lists, not the flat config format.
function splitOutside(text, separator) {
  const parts = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) {
        if (quote === "'" && text[i + 1] === "'") { i++; continue; }
        quote = '';
      }
      continue;
    }
    if ((c === '"' || c === "'") && (i === 0 || /[\s:[{,]/.test(text[i - 1]))) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      text = text.slice(0, i);
      break;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || depth !== 0) throw new Error('Unclosed quote or collection in frontmatter.');
  parts.push(text.slice(start).trim());
  return parts;
}

function scalar(text) {
  const value = splitOutside(text, '\0')[0];
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error('Unclosed quoted value.');
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner ? splitOutside(inner, ',').map(scalar) : [];
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const object = Object.create(null);
    for (const field of splitOutside(value.slice(1, -1), ',')) assign(object, field);
    return object;
  }
  if (!value || value === 'null' || value === '~') return null;
  if (/^[>|&*!{\[]/.test(value)) throw new Error('Unsupported ticket value. Use a scalar or a flat object list.');
  return value;
}

function assign(object, text) {
  const match = /^([a-zA-Z][\w-]*):(?:\s+(.*)|$)/.exec(text);
  if (!match) throw new Error(`Invalid frontmatter field: ${text}`);
  if (Object.hasOwn(object, match[1])) throw new Error(`Duplicate field: ${match[1]}`);
  object[match[1]] = scalar(match[2] ?? '');
  return match[1];
}

function blockScalar(lines, index, indicator) {
  const parentIndent = lines[index].match(/^ */)[0].length;
  const content = [];
  let indent;
  let end = index + 1;
  for (; end < lines.length; end++) {
    const line = lines[end];
    if (!line.trim()) { content.push(''); continue; }
    const spaces = line.match(/^ */)[0].length;
    if (spaces <= parentIndent) break;
    indent ??= spaces;
    if (spaces < indent) throw new Error('Invalid indentation in a block scalar.');
    content.push(line.slice(indent));
  }
  const lastContent = content.findLastIndex((line) => line.length > 0);
  const trailingLines = content.length - lastContent - 1;
  const body = content.slice(0, lastContent + 1);
  let text = '';
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const next = body[i + 1];
    text += line;
    if (indicator[0] === '|' || next === undefined || /^\s/.test(line) || /^\s/.test(next)) text += '\n';
    else if (line && next) text += ' ';
    else if (!line) text += '\n';
  }
  if (indicator.endsWith('+')) text += '\n'.repeat(trailingLines);
  if (indicator.endsWith('-')) text = text.replace(/\n+$/, '');
  else if (!indicator.endsWith('+')) text = text.replace(/\n+$/, '') + (content.some((line) => line.length) ? '\n' : '');
  return { text, end };
}

export function parseFrontmatter(text, lists = ['gates', 'changes']) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!match) throw new Error('Ticket README needs frontmatter.');
  const data = Object.create(null);
  let list = null;
  let current = null;
  const lines = match[1].split('\n');
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (/^\s*(#|$)/.test(line)) continue;
    const block = /^(\s*(?:-\s+)?[a-zA-Z][\w-]*:\s*)([>|][+-]?)(?:\s+#.*)?\s*$/.exec(line);
    if (block) {
      const { text, end } = blockScalar(lines, index, block[2]);
      line = block[1] + JSON.stringify(text);
      index = end - 1;
    }
    if (!/^\s/.test(line)) {
      const key = assign(data, line);
      list = lists.includes(key) ? key : null;
      current = null;
      if (list && data[key] === null) data[key] = [];
      if (list && !Array.isArray(data[key])) throw new Error(`${key} must be a list.`);
    } else if (list) {
      const entry = /^\s+-\s+(.+)$/.exec(line);
      if (entry) {
        if (list === 'sources') {
          data[list].push(scalar(entry[1]));
          continue;
        }
        current = Object.create(null);
        const content = splitOutside(entry[1], '\0')[0];
        if (content.startsWith('{') && content.endsWith('}')) {
          for (const field of splitOutside(content.slice(1, -1), ',')) assign(current, field);
        } else {
          assign(current, content);
        }
        data[list].push(current);
      } else if (current) {
        assign(current, line.trim());
      } else {
        throw new Error(`Invalid ${list} entry.`);
      }
    } else {
      throw new Error(`Fields must be scalars; supported lists: ${lists.join(', ')}.`);
    }
  }
  return data;
}

export function parseTicket(text) {
  const data = parseFrontmatter(text);
  for (const key of ['key', 'title', 'phase', 'state', 'next']) {
    if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`Missing or invalid ${key}.`);
  }
  for (const key of ['item', 'waiting_on', 'branch', 'worktree', 'updated']) {
    if (data[key] != null && typeof data[key] !== 'string') throw new Error(`Invalid ${key}: expected one line of text.`);
  }
  if (!STATES.includes(data.state)) throw new Error(`Unknown ticket state: ${data.state}`);
  if (!PHASES.includes(data.phase)) throw new Error(`Unknown ticket phase: ${data.phase}`);
  if (data.track != null && !['S', 'M', 'L'].includes(data.track)) throw new Error(`Unknown ticket track: ${data.track}`);
  if (data.workflow != null && data.workflow !== 'full-v1') throw new Error(`Unknown ticket workflow: ${data.workflow}`);
  if (data.workflow === 'full-v1' && data.track != null) throw new Error('full-v1 tickets must not select a track.');
  if (data.workflow === 'full-v1' && data.type !== 'ticket') throw new Error('full-v1 metadata needs type: ticket.');
  for (const gate of data.gates ?? []) {
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)
      || typeof gate.name !== 'string' || !GATE_STATUSES.includes(gate.status)) throw new Error('Invalid gate name or status.');
    if (!['required', 'recommended'].includes(gate.need)) throw new Error(`Invalid gate need: ${gate.name}`);
    for (const key of ['doc', 'date', 'hash', 'note', 'manifest']) {
      if (gate[key] != null && typeof gate[key] !== 'string') throw new Error(`Invalid gate ${key}: ${gate.name}`);
    }
    if (gate.status === 'approved' && !validDate(gate.date)) {
      throw new Error(`Approved gate needs a date: ${gate.name}`);
    }
  }
  for (const change of data.changes ?? []) {
    if (!change || typeof change !== 'object' || Array.isArray(change)
      || typeof change.url !== 'string' || !['draft', 'open', 'merged', 'closed', 'abandoned'].includes(change.state)) {
      throw new Error('Invalid change request URL or state.');
    }
    if (change.label != null && typeof change.label !== 'string') throw new Error('Invalid change request label.');
  }
  return {
    key: data.key, title: data.title, phase: data.phase, state: data.state,
    workflow: data.workflow ?? null,
    track: data.workflow === 'full-v1' ? null : data.track ?? 'Unspecified', next: data.next, waitingOn: data.waiting_on ?? '',
    branch: data.branch ?? '', worktree: data.worktree ?? '', updated: data.updated ?? '',
    item: data.item ?? '', gates: data.gates ?? [], changes: data.changes ?? [],
  };
}
