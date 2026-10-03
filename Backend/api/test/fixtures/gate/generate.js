// Regenerates the Tier A gate fixtures in this folder from test/images.js:
//
//   node test/fixtures/gate/generate.js        (from api/)
//
// Each bad fixture fails exactly one check at the v1 placeholder thresholds; good.jpg passes all
// of them. They are synthetic leaf scenes, not lab photos. Calibrate the real thresholds on lab
// photos with npm run gate:calibrate.
import { writeFile } from 'node:fs/promises';

import { makePhoto } from '../../images.js';

export const GATE_FIXTURES = Object.freeze({
  'good.jpg': { reasons: [], options: {} },
  'dark.jpg': { reasons: ['too_dark'], options: { tone: [0.5, 0] } },
  'bright.jpg': { reasons: ['too_bright'], options: { tone: [0.5, 156] } },
  'overexposed.jpg': { reasons: ['overexposed'], options: { glare: 0.12 } },
  'blurry.jpg': { reasons: ['blurry'], options: { blur: 6 } },
  'low-resolution.jpg': { reasons: ['resolution_too_low'], options: { width: 800, height: 1000 } },
});

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  for (const [name, { options }] of Object.entries(GATE_FIXTURES)) {
    await writeFile(new URL(name, import.meta.url), await makePhoto(options));
    console.log(`wrote ${name}`);
  }
}
