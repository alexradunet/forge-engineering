// The forge user data folder. This file imports only Node built-ins,
// so the live reporter (live-hook.mjs) starts fast.
import os from 'node:os';
import path from 'node:path';

/** The forge user data folder (outside every repo and outside the plugin). */
export function dataDir(env = process.env, platform = process.platform) {
  if (env.FORGE_DATA_DIR) return env.FORGE_DATA_DIR;
  if (platform === 'win32') return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'forge');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'forge');
  return path.join(env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'forge');
}
