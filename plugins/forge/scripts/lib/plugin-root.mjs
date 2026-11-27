// The folder of this plugin: the parent of scripts/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
