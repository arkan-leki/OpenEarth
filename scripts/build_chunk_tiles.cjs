#!/usr/bin/env node
'use strict';

/**
 * Builds ONE IMAGERY TILE PER TERRAIN CHUNK.
 *
 * Why: a single 4096px texture stretched over the whole 1600 km map gives only ~391 m per
 * pixel everywhere. The previous map was better because it shipped several smaller images,
 * each covering its own region at high resolution. This restores that approach at chunk
 * granularity, so every chunk gets its own texture rendered separately.
 *
 * Output: public/tiles/erbil_chunk_<ID>.jpg, one per chunk, in the same non-uniform
 * layout the terrain uses (see CHUNK_AXIS_SPLITS_KM in weatherDataPipeline.ts).
 *
 * Resolution is spent by ring:
 *   ring 0 (the 4 central 300 km chunks, Kurdistan heartland)  2048px -> ~146 m/px
 *   ring 1 / ring 2 (outer chunks up to 500 km)               1536px -> ~325 m/px
 *
 * Both beat the single-texture 391 m/px, and the centre is more than twice as sharp.
 *
 * Imagery is composited exactly as the regional map was: Landsat WELD for land, Blue Marble
 * bathymetry wherever the land layer is missing OR is dark open water (Landsat renders seas
 * near-black), and a flat ocean colour as a final fallback.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TILES_DIR = path.join(ROOT, 'public', 'tiles');

// Must match src/utils/weatherDataPipeline.ts and src/utils/realSulaymaniyahTerrain.ts
const SPLITS_KM = [-800, -300, 0, 300, 800];
const COLS = ['A', 'B', 'C', 'D'];
const CENTER = { lon: 44.009, lat: 36.191 };
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos((CENTER.lat * Math.PI) / 180);
const DOMAIN_KM = 1600;

const LAND_LAYER = 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual';
const FILL_LAYER = 'BlueMarble_ShadedRelief_Bathymetry';

const RING_PIXELS = { 0: 2048, 1: 1536, 2: 1536 };

const NO_DATA_MAX_CHANNEL = 24;
const WATER_MAX_CHANNEL = 80;
const WATER_BLUE_LEAD = 10;
const OCEAN = [0x12, 0x3d, 0x5e];
const SATURATION = 1.2;
const CONTRAST = 1.14;
const OFFSET = -10;

const argValue = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const ONLY = argValue('only', null);
const FORCE = process.argv.includes('--force');

const log = (...a) => console.log(...a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBuffer(url, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OpenEarth-tile-builder/1.0' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.slice(0, 200).toString('utf8').trimStart().startsWith('<')) {
        throw new Error('server returned XML: ' + buf.toString('utf8').slice(0, 200));
      }
      return buf;
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

function gibsUrl(layer, bbox, w, h) {
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    LAYERS: layer,
    VERSION: '1.3.0',
    FORMAT: 'image/jpeg',
    TRANSPARENT: 'FALSE',
    WIDTH: String(w),
    HEIGHT: String(h),
    CRS: 'EPSG:4326',
    BBOX: `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${p.toString()}`;
}

/** Chunk bboxes derived from the same split table the renderer uses. */
function chunkLayout() {
  const out = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const id = `${COLS[c]}${r + 1}`;
      const xStart = SPLITS_KM[c];
      const xEnd = SPLITS_KM[c + 1];
      const zStart = SPLITS_KM[r]; // +z is south
      const zEnd = SPLITS_KM[r + 1];

      // World km -> lon/lat. z increases southward, so north edge comes from zStart.
      const minLon = CENTER.lon + xStart / KM_PER_DEG_LON;
      const maxLon = CENTER.lon + xEnd / KM_PER_DEG_LON;
      const maxLat = CENTER.lat - zStart / KM_PER_DEG_LAT;
      const minLat = CENTER.lat - zEnd / KM_PER_DEG_LAT;

      const ringDistance = Math.max(Math.abs(c - 1.5), Math.abs(r - 1.5));
      const ring = ringDistance < 1 ? 0 : ringDistance < 1.6 ? 1 : 2;

      out.push({
        id,
        col: c,
        row: r,
        ring,
        widthKm: xEnd - xStart,
        heightKm: zEnd - zStart,
        bbox: { minLon, maxLon, minLat, maxLat }
      });
    }
  }
  return out;
}

async function buildTile(chunk, sharp) {
  const px = RING_PIXELS[chunk.ring];
  const { bbox } = chunk;
  const outPath = path.join(TILES_DIR, `erbil_chunk_${chunk.id}.jpg`);

  if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 20000) {
    log(`  [${chunk.id}] exists, skipping`);
    return { id: chunk.id, status: 'skipped' };
  }

  const [landBuf, fillBuf] = await Promise.all([
    fetchBuffer(gibsUrl(LAND_LAYER, bbox, px, px)),
    fetchBuffer(gibsUrl(FILL_LAYER, bbox, px, px))
  ]);

  const land = await sharp(landBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const fill = await sharp(fillBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const n = px * px;
  const out = Buffer.alloc(n * 3);
  let landN = 0, fillN = 0, oceanN = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const r = land.data[o], g = land.data[o + 1], b = land.data[o + 2];
    const landMax = Math.max(r, g, b);
    const isNoData = landMax <= NO_DATA_MAX_CHANNEL;
    const isDarkWater =
      !isNoData && landMax < WATER_MAX_CHANNEL && b > r + WATER_BLUE_LEAD && b >= g;

    if (!isNoData && !isDarkWater) {
      out[o] = r; out[o + 1] = g; out[o + 2] = b; landN++;
      continue;
    }
    const fr = fill.data[o], fg = fill.data[o + 1], fb = fill.data[o + 2];
    if (Math.max(fr, fg, fb) > NO_DATA_MAX_CHANNEL) {
      out[o] = fr; out[o + 1] = fg; out[o + 2] = fb; fillN++;
    } else {
      out[o] = OCEAN[0]; out[o + 1] = OCEAN[1]; out[o + 2] = OCEAN[2]; oceanN++;
    }
  }

  await sharp(out, { raw: { width: px, height: px, channels: 3 } })
    .modulate({ saturation: SATURATION })
    .linear(CONTRAST, OFFSET)
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outPath);

  const mPerPx = Math.round((chunk.widthKm * 1000) / px);
  log(
    `  [${chunk.id}] ring ${chunk.ring} ${chunk.widthKm}x${chunk.heightKm} km @ ${px}px ` +
      `= ${mPerPx} m/px  land ${((landN / n) * 100).toFixed(0)}% water ${(((fillN + oceanN) / n) * 100).toFixed(0)}%  ` +
      `${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`
  );
  return { id: chunk.id, status: 'built', mPerPx };
}

async function main() {
  const sharp = require('sharp');
  fs.mkdirSync(TILES_DIR, { recursive: true });

  let chunks = chunkLayout();
  if (ONLY) chunks = chunks.filter((c) => ONLY.split(',').includes(c.id));

  log(`Building ${chunks.length} imagery tiles (one per chunk)`);
  const results = [];
  for (const chunk of chunks) {
    results.push(await buildTile(chunk, sharp));
  }

  const built = results.filter((r) => r.status === 'built');
  log(`\nDone. ${built.length} built, ${results.length - built.length} skipped.`);
  if (built.length) {
    const total = fs
      .readdirSync(TILES_DIR)
      .filter((f) => f.startsWith('erbil_chunk_'))
      .reduce((s, f) => s + fs.statSync(path.join(TILES_DIR, f)).size, 0);
    log(`Tile payload on disk: ${(total / 1024 / 1024).toFixed(1)} MB`);
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
