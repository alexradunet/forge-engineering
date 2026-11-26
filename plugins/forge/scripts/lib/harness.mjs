// The harness table: one row for each terminal harness whose sessions Forge can resume.
// A harness is a program that runs an agent session in a terminal. The id of a row is the host name of the hooks.
// A host without a row has no terminal session that Forge can resume, so Forge keeps no record of its sessions.
// A new harness is one more row here. This file has no import, so a hook that reads it starts fast.

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// The first character is a letter or a digit: a session id never reads as an option of the harness.
const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * - `bin`: the command of the harness. It is a constant: no value of a session goes into it.
 * - `idPattern`: the shape of a session id. An id with another shape is never recorded and never goes into a command line.
 * - `resumeArgs`: the arguments that continue the session with that id.
 */
export const HARNESSES = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', idPattern: UUID, resumeArgs: (id) => ['--resume', id] },
  { id: 'copilot-cli', name: 'Copilot CLI', bin: 'copilot', idPattern: PLAIN_ID, resumeArgs: (id) => [`--resume=${id}`] },
];

/** The row of a harness id, or null. */
export function harness(id) {
  return HARNESSES.find((row) => row.id === id) ?? null;
}

/** True when `id` is a session id of the harness `host`. */
export function sessionIdOk(host, id) {
  const row = harness(host);
  return Boolean(row) && typeof id === 'string' && row.idPattern.test(id);
}

/** The command and its arguments that continue a session, or null when the host or the id is not valid. */
export function resumeArgv(host, id) {
  return sessionIdOk(host, id) ? [harness(host).bin, ...harness(host).resumeArgs(id)] : null;
}

/**
 * The command line for a person: `cd "<folder>"; <harness> <arguments>`. The form with `;` works in PowerShell and in a POSIX shell.
 * A folder with a character that a shell reads inside quotes gives the command without the `cd` part. '' when the session cannot resume.
 */
export function resumeText(host, id, cwd = '') {
  const argv = resumeArgv(host, id);
  if (!argv) return '';
  const command = argv.join(' ');
  return cwd && !/["`$\r\n]/.test(cwd) ? `cd "${cwd}"; ${command}` : command;
}
