// The profile of this plugin build: <plugin>/templates/profile.json. The profile owns templates/ and the files
// that it lists. It gives the CLIs that detect checks, the main checkout hint, and the MCP servers that doctor checks.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForgeError } from './repo.mjs';

export const pluginRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const PROFILE_NAME = /^[a-z][a-z0-9-]*$/;

/** The names of the extra profiles: each folder of <plugin>/profiles with a profile.json, sorted. The default profile is not in the list. */
export function listProfiles(plugin = pluginRoot) {
  const root = path.join(plugin, 'profiles');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(root, e.name, 'profile.json')))
    .map((e) => e.name)
    .sort();
}

/**
 * The profile values. No name: the default profile, <plugin>/templates/profile.json. A name: <plugin>/profiles/<name>/profile.json.
 * Without a profile file, the values are empty and detect checks only gh. "dir" is the folder of the profile, relative to the plugin.
 */
export function loadProfile(plugin = pluginRoot, name = null) {
  const empty = { name: null, title: null, files: [], tests: [], terms: [], tools: ['gh'], mainCheckout: null, mcpServers: [], mcpRetired: [] };
  if (name === null) {
    const file = path.join(plugin, 'templates', 'profile.json');
    return { ...empty, ...(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}), dir: 'templates' };
  }
  const known = listProfiles(plugin);
  if (typeof name !== 'string' || !PROFILE_NAME.test(name) || !known.includes(name)) {
    throw new ForgeError(`Unknown profile "${name}". The profiles are: ${known.join(', ') || 'none'}. A name is lower case letters, digits, and hyphens.`, 'bad-profile');
  }
  return { ...empty, ...JSON.parse(readFileSync(path.join(plugin, 'profiles', name, 'profile.json'), 'utf8')), name, dir: `profiles/${name}` };
}

/** The path of a file of a profile. A file that the profile folder does not have comes from the default profile. */
export function profileFile(plugin, name, relative) {
  if (name !== null && !PROFILE_NAME.test(name)) throw new ForgeError(`Bad profile name "${name}".`, 'bad-profile');
  const own = name === null ? null : path.join(plugin, 'profiles', name, relative);
  return own && existsSync(own) ? own : path.join(plugin, 'templates', relative);
}

/** A case-insensitive pattern for the profile terms. A term of 4 or fewer characters matches only as a whole word. */
export function termPattern(terms) {
  if (!terms.length) return null;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(terms.map((t) => (t.length <= 4 ? `\\b${esc(t)}\\b` : esc(t))).join('|'), 'i');
}
