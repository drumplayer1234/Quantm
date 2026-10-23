// `npm test`: every *.test.js file in this folder, each in its own process (that's how node --test
// runs a list of files), so tests that set up globals can't break each other. Node 20+.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(name => name.endsWith('.test.js')).sort().map(name => path.join(dir, name));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
