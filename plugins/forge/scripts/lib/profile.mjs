// The profile of this plugin build: <plugin>/templates/profile.json. The profile owns templates/ and the files
// that it lists. It gives the CLIs that detect checks, the main checkout hint, and the MCP servers that doctor checks.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/** The profile values. Without a profile, the values are empty and detect checks only gh. */
export function loadProfile(plugin = pluginRoot) {
  const file = path.join(plugin, 'templates', 'profile.json');
  const empty = { name: null, title: null, files: [], tests: [], terms: [], tools: ['gh'], mainCheckout: null, mcpServers: [], mcpRetired: [] };
  if (!existsSync(file)) return empty;
  return { ...empty, ...JSON.parse(readFileSync(file, 'utf8')) };
}

/** A case-insensitive pattern for the profile terms. A term of 4 or fewer characters matches only as a whole word. */
export function termPattern(terms) {
  if (!terms.length) return null;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(terms.map((t) => (t.length <= 4 ? `\\b${esc(t)}\\b` : esc(t))).join('|'), 'i');
}
