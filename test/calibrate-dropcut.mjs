// node test/calibrate-dropcut.mjs [amplitude-fixture.json]
import { readFileSync } from 'node:fs';
import { fromWaveform } from '../src/js/mixmemory.js';

const tracks = JSON.parse(readFileSync(process.argv[2] || new URL('./fixtures/dropcut-waveforms.json', import.meta.url)));
const genres = new Map();
for (const track of tracks) {
  const candidates = fromWaveform({ samples: track.samples, width: track.samples.length, height: track.height || 1 }, track.duration).dropCandidates;
  const family = track.family || track.genre || 'Unknown';
  const row = genres.get(family) || { genre: family, tracks: 0, withCandidate: 0 };
  row.tracks++;
  row.withCandidate += Number(candidates.length > 0);
  genres.set(family, row);
  console.log(`${track.id}: ${candidates.map(c => c.time.toFixed(1)).join(', ') || 'none'} — ${track.title}`);
}
console.table([...genres.values()]);
