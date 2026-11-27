// ownTurn: tells a turn that Claude Code starts by itself from a prompt that the user types.
// Claude Code runs the UserPromptSubmit hook also for a report of a background subagent, for a message of
// another session, and for a scheduled task (hooks reference, UserPromptSubmit, read 2026-11-20).
// The hooks reference names no input field for the origin of a turn, so Forge reads the first words of the text.
// These shapes are NOT documented and can change. Each one was seen with Claude Code 2.1.316 on 2026-11-19 and 2026-11-20:
//   `<task-notification>`: the turn for a finished background subagent (then <task-id>, <status>, <summary>, <result>).
//   `Another Claude session sent a message:`: the turn for a message of another session or a subagent hand-back
//   (then a line `<agent-message from="...">`).
//   `<agent-message ` and `<cross-session-message `: the same turn when the text starts with the tag. Not seen first-hand:
//   they are kept as a guard.
// This file has no import, so the prompt hook starts fast.

export const OWN_TURN_STARTS = [
  '<task-notification>',
  'Another Claude session sent a message:',
  '<agent-message ',
  '<cross-session-message ',
];

/** True when the prompt text is a turn that Claude Code started by itself. White space at the start does not count. */
export function ownTurn(prompt) {
  const text = typeof prompt === 'string' ? prompt.trimStart() : '';
  return OWN_TURN_STARTS.some((start) => text.startsWith(start));
}
