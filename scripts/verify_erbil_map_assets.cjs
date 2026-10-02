#!/usr/bin/env node
'use strict';

/**
 * Verifies the generated globe assets against known ground truth.
 *
 *  1. Samples the built DEM at landmarks whose real elevations are well documented
 *     and reports the error. Catches projection/resampling mistakes that would
 *     otherwise silently distort the terrain.
 *  2. Reports pixel statistics for every generated image so a blank or uniform
 *     download (which still yields a "successful" HTTP 200) cannot slip through.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const TILES_DIR = path.join(ROOT, 'public', 'tiles');

// --- DEM sampling (mirrors middleEastDemService.ts) ---
const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'erbil_map_dem_meta.json'), 'utf8'));
const buf = fs.readFileSync(path.join(DATA_DIR, 'erbil_map_dem.bin'));
const dem = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);

console.log('DEM meta:', JSON.stringify(meta));
console.log(`DEM samples: ${dem.length} (expected ${meta.width * meta.height})`);

function sample(lon, lat) {
  const u = (lon - meta.minLon) / (meta.maxLon - meta.minLon);
  const v = (meta.maxLat - lat) / (meta.maxLat - meta.minLat);
  if (u < 0 || u > 1 || v < 0 || v > 1) return NaN;
  const gx = u * (meta.width - 1);
  const gy = v * (meta.height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(meta.width - 1, x0 + 1);
  const y1 = Math.min(meta.height - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const e00 = dem[y0 * meta.width + x0];
  const e10 = dem[y0 * meta.width + x1];
  const e01 = dem[y1 * meta.width + x0];
  const e11 = dem[y1 * meta.width + x1];
  const top = e00 * (1 - fx) + e10 * fx;
  const bottom = e01 * (1 - fx) + e11 * fx;
  return top * (1 - fy) + bottom * fy;
}

// Real published elevations. Peak values will read LOW because the DEM is sampled
// at ~4.3 km/px, which cannot resolve a summit cone — that is expected, and the
// judgement below allows for it.
const CHECKS = [
  // Places inside the 800 km circle around Erbil, with published elevations.
  { name: 'Erbil (map centre)', lon: 44.009, lat: 36.191, real: 420, tol: 160, kind: 'city' },
  { name: 'Kalar, Iraq', lon: 45.31, lat: 34.62, real: 219, tol: 150, kind: 'city' },
  { name: 'Mosul, Iraq', lon: 43.119, lat: 36.335, real: 223, tol: 150, kind: 'city' },
  { name: 'Baghdad, S Iraq', lon: 44.361, lat: 33.315, real: 34, tol: 120, kind: 'city' },
  { name: 'Sulaymaniyah, Iraq', lon: 45.435, lat: 35.561, real: 845, tol: 200, kind: 'city' },
  { name: 'Basra, S Iraq', lon: 47.783, lat: 30.508, real: 5, tol: 120, kind: 'city' },
  { name: 'Diyarbakir, N Kurdistan', lon: 40.23, lat: 37.914, real: 675, tol: 250, kind: 'city' },
  { name: 'Damascus, Syria', lon: 36.292, lat: 33.513, real: 680, tol: 300, kind: 'city' },
  { name: 'Aleppo, Syria', lon: 37.162, lat: 36.202, real: 390, tol: 250, kind: 'city' },
  { name: 'Kermanshah, W Iran', lon: 47.065, lat: 34.314, real: 1350, tol: 350, kind: 'city' },
  { name: 'Tehran, Iran', lon: 51.389, lat: 35.689, real: 1200, tol: 350, kind: 'city' },
  { name: 'Dead Sea shore', lon: 35.5, lat: 31.5, real: -430, tol: 250, kind: 'depression' },
  { name: 'Mount Damavand (summit 5610 m)', lon: 52.11, lat: 35.955, real: 5610, tol: 1700, kind: 'peak' },
  { name: 'Mount Ararat (summit 5137 m)', lon: 44.298, lat: 39.702, real: 5137, tol: 1700, kind: 'peak' },
  // NOTE: terrarium/SRTM is a SURFACE elevation model — over water it reports the water
  // surface, not the depth. The Caspian's surface sits at -28 m, so that is what to expect.
  { name: 'Caspian Sea (surface level)', lon: 51.0, lat: 37.5, real: -28, tol: 80, kind: 'sea' },
  // Moved inside the domain: lat 27.5 is south of the bbox edge and sampled as NaN.
  { name: 'Persian Gulf (surface level)', lon: 48.5, lat: 29.5, real: 0, tol: 80, kind: 'sea' }
];

console.log('\n--- DEM accuracy vs published elevations ---');
let fails = 0;
for (const c of CHECKS) {
  const got = sample(c.lon, c.lat);
  const err = got - c.real;
  const ok = Math.abs(err) <= c.tol;
  if (!ok) fails++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(38)} real ${String(c.real).padStart(7)} m   ` +
      `DEM ${got.toFixed(0).padStart(7)} m   err ${err >= 0 ? '+' : ''}${err.toFixed(0).padStart(6)} m ` +
      `(tol ±${c.tol}, ${c.kind})`
  );
}
console.log(fails === 0 ? '\nAll DEM checks within tolerance.' : `\n${fails} DEM check(s) out of tolerance.`);

// --- Image statistics ---
async function imageStats(file, label) {
  if (!fs.existsSync(file)) {
    console.log(`${label.padEnd(22)} MISSING (${path.basename(file)})`);
    return;
  }
  const size = fs.statSync(file).size;
  const img = sharp(file);
  const md = await img.metadata();
  // Collapse to a single luminance channel to measure actual content.
  const { data, info } = await img
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / data.length;
  const verdict = max - min < 12 ? '  <-- UNIFORM/BLANK, almost no content!' : '';
  console.log(
    `${label.padEnd(22)} ${md.width}x${md.height} ${md.format} ${(size / 1024).toFixed(0)} KB  ` +
      `luma min=${min} max=${max} mean=${mean.toFixed(1)} range=${max - min}${verdict}`
  );
}

(async () => {
  console.log('\n--- Generated image content ---');
  await imageStats(path.join(TILES_DIR, 'erbil_map_hd.jpg'), 'Erbil map imagery');
  await imageStats(path.join(TILES_DIR, 'erbil_map_clouds.jpg'), 'Erbil map clouds');
  await imageStats(path.join(TILES_DIR, 'world_base.jpg'), 'world base');
  const demFile = path.join(DATA_DIR, 'erbil_map_dem.bin');
  console.log(
    `${'DEM binary'.padEnd(22)} ${meta.width}x${meta.height} int16 ${(
      fs.statSync(demFile).size / 1024
    ).toFixed(0)} KB  min=${meta.minElevation} max=${meta.maxElevation}`
  );
})();
