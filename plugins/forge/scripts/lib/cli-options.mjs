// The options of forge.mjs that take a value. forge.mjs (parseArgs) and the gate guard (approval parser) both read this list,
// so the guard sees the same subcommand as the CLI does.
/** These 2 options take a value only when the next word does not start with `--`. */
export const OPTIONAL_VALUE_OPTIONS = ['--wiki', '--cwd'];
/** These options always need a value. */
export const REQUIRED_VALUE_OPTIONS = ['--summary', '--base', '--today', '--answer', '--method', '--manifest', '--hash', '--port', '--out'];
export const FORGE_VALUE_OPTIONS = new Set([...OPTIONAL_VALUE_OPTIONS, ...REQUIRED_VALUE_OPTIONS]);
