// After signing, the installer's bytes change, so the updater manifest (latest.yml) that
// electron-builder wrote no longer matches it. Recompute the sha512 and size from the signed file.
// Usage: node signed-latest-yml.js <latest.yml> <signed Quantm-Setup-x.y.z.exe>
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function updateManifest(yml, name, sha512, size) {
  const lines = yml.split(/\r?\n/);
  let inEntry = false;
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*- url:/.test(line)) inEntry = line.trim() === `- url: ${name}`;
    else if (inEntry && /^\s+sha512:/.test(line)) { lines[i] = line.replace(/sha512:.*/, `sha512: ${sha512}`); changed++; }
    else if (inEntry && /^\s+size:/.test(line)) { lines[i] = line.replace(/size:.*/, `size: ${size}`); changed++; }
    else if (/^\S/.test(line)) inEntry = false;
    // top-level fields describe the main installer
    if (/^sha512:/.test(line)) { lines[i] = `sha512: ${sha512}`; changed++; }
  }
  if (changed < 3) throw new Error(`latest.yml has no complete entry for ${name}`);
  return lines.join('\n');
}

if (require.main === module) {
  const [manifestPath, installerPath] = process.argv.slice(2);
  const bytes = fs.readFileSync(installerPath);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  const name = path.basename(installerPath);
  fs.writeFileSync(manifestPath, updateManifest(fs.readFileSync(manifestPath, 'utf8'), name, sha512, bytes.length));
  console.log(`latest.yml updated for ${name} (${bytes.length} bytes)`);
}

module.exports = { updateManifest };
