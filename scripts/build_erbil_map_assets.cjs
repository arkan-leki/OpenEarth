#!/usr/bin/env node
'use strict';

/**
 * Builds the Middle East globe assets consumed by the runtime.
 *
 *   public/data/erbil_map_dem.bin         Int16 elevation, linear lat/lon grid
 *   public/data/erbil_map_dem_meta.json   grid size + bounds + provenance
 *   public/tiles/erbil_map_hd.jpg         HD regional base map (draped on terrain)
 *   public/tiles/erbil_map_clouds.jpg     greyscale cloud map (cloud shell alpha)
 *   public/tiles/world_base.jpg             global low-res base map (rest of planet)
 *
 * Usage:
 *   node scripts/build_middle_east_assets.cjs
 *   node scripts/build_middle_east_assets.cjs --dem-zoom=7 --imagery-size=8192x6144
 *   node scripts/build_middle_east_assets.cjs --skip-imagery
 *   node scripts/build_middle_east_assets.cjs --source=esri      # sharper aerial imagery
 *
 * Why the DEM needs resampling: XYZ elevation tiles are Web-Mercator, so their rows
 * are NOT evenly spaced in latitude. The runtime sampler assumes a linear latitude
 * grid, so this script decodes the Mercator mosaic into real elevations first and
 * then bilinearly resamples onto an evenly spaced lat/lon grid. Cropping the Mercator
 * mosaic instead would silently stretch the terrain north-to-south.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const TILES_DIR = path.join(ROOT, 'public', 'tiles');
const DATA_DIR = path.join(ROOT, 'public', 'data');

// ---------------------------------------------------------------------------
// Domain: a circle of RADIUS_KM around Erbil.
//
// The bounding box is derived from the circle rather than hard-coded, so changing
// CENTER or RADIUS_KM is the only edit needed to re-target the whole map. Degrees
// per kilometre are evaluated AT THE CENTRE latitude; the renderer maps lon/lat to
// world space the same way, so the two stay consistent.
// ---------------------------------------------------------------------------

const CENTER = { lon: 44.009, lat: 36.191 }; // Erbil
const RADIUS_KM = 800;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos((CENTER.lat * Math.PI) / 180);

const BOUNDS = {
  minLon: CENTER.lon - RADIUS_KM / KM_PER_DEG_LON,
  maxLon: CENTER.lon + RADIUS_KM / KM_PER_DEG_LON,
  minLat: CENTER.lat - RADIUS_KM / KM_PER_DEG_LAT,
  maxLat: CENTER.lat + RADIUS_KM / KM_PER_DEG_LAT
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const OPTIONS = {
  source: argValue('source', 'gibs'),
  // Zoom 8 gives ~0.61 km/px, needed to feed a 2048px DEM over a 1600 km span.
  demZoom: parseInt(argValue('dem-zoom', '8'), 10),
  demSize: argValue('dem-size', '2048x2048'),
  imagerySize: argValue('imagery-size', '4096x4096'),
  worldSize: argValue('world-size', '2048x1024'),
  imageryLayer: argValue('imagery-layer', 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual'),
  imageryFillLayer: argValue('imagery-fill-layer', 'BlueMarble_ShadedRelief_Bathymetry'),
  imageryLayerFallback: argValue('imagery-layer-fallback', 'BlueMarble_ShadedRelief_Bathymetry'),
  cloudSourceLayer: argValue('cloud-source-layer', 'MODIS_Terra_CorrectedReflectance_TrueColor'),
  concurrency: parseInt(argValue('concurrency', '8'), 10),
  skipDem: flag('skip-dem'),
  skipImagery: flag('skip-imagery'),
  skipClouds: flag('skip-clouds'),
  skipWorld: flag('skip-world'),
  // Cloud detection diffs the satellite pass against this image, so it must be a NEUTRAL
  // reference: contrast/saturation boosting shifts brightness over bright ground and makes
  // desert, salt flats and lake shores register as cloud.
  neutral: flag('neutral'),
  outName: argValue('out-name', 'erbil_map_hd.jpg')
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);

function parseSize(str) {
  const m = /^(\d+)x(\d+)$/.exec(str);
  if (!m) throw new Error(`Bad size "${str}", expected WIDTHxHEIGHT`);
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

function ensureDirs() {
  fs.mkdirSync(TILES_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function human(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBuffer(url, { expectImage = true, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'OpenEarth-asset-builder/1.0 (+https://github.com/arkan-leki/OpenEarth)',
          Accept: expectImage ? 'image/*,*/*' : '*/*'
        }
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} — ${body.slice(0, 300).replace(/\s+/g, ' ')}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // A WMS error comes back as XML with HTTP 200, so sniff the payload too.
      if (expectImage && buf.slice(0, 200).toString('utf8').trimStart().startsWith('<')) {
        throw new Error(`Server returned XML instead of an image: ${buf.toString('utf8').slice(0, 300)}`);
      }
      return buf;
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Runs async tasks with bounded concurrency, preserving input order. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// Web-Mercator tile maths (mirror of middleEastDomain.ts)
// ---------------------------------------------------------------------------

const lonToTileX = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z);

function latToTileY(lat, z) {
  const latRad = (lat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
  return y * Math.pow(2, z);
}

function tileRange(zoom) {
  const xMin = Math.floor(lonToTileX(BOUNDS.minLon, zoom));
  const xMax = Math.floor(lonToTileX(BOUNDS.maxLon, zoom));
  const yMin = Math.floor(latToTileY(BOUNDS.maxLat, zoom));
  const yMax = Math.floor(latToTileY(BOUNDS.minLat, zoom));
  return { xMin, xMax, yMin, yMax, cols: xMax - xMin + 1, rows: yMax - yMin + 1 };
}

// ---------------------------------------------------------------------------
// DEM (Mapzen / AWS terrarium)
//
// Encoding: elevation_metres = (R * 256 + G + B / 256) - 32768
// ---------------------------------------------------------------------------

const TERRARIUM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

async function buildDem() {
  const { width: outW, height: outH } = parseSize(OPTIONS.demSize);
  const z = OPTIONS.demZoom;
  const range = tileRange(z);
  const tileCount = range.cols * range.rows;

  log(`\n[DEM] terrarium zoom ${z} — ${range.cols}x${range.rows} = ${tileCount} tiles`);
  log(`[DEM] out grid ${outW}x${outH} (linear lat/lon)`);

  const tiles = [];
  for (let ty = range.yMin; ty <= range.yMax; ty++) {
    for (let tx = range.xMin; tx <= range.xMax; tx++) tiles.push({ tx, ty });
  }

  let done = 0;
  let bytes = 0;
  const decoded = await mapLimit(tiles, OPTIONS.concurrency, async ({ tx, ty }) => {
    const buf = await fetchBuffer(TERRARIUM_URL(z, tx, ty));
    bytes += buf.length;
    const png = PNG.sync.read(buf);
    // Decode once here so the later bilinear pass interpolates elevations, not
    // packed bytes — interpolating the encoding directly is numerically wrong.
    const elev = new Float32Array(png.width * png.height);
    for (let i = 0, p = 0; i < elev.length; i++, p += 4) {
      elev[i] = decodeTerrarium(png.data[p], png.data[p + 1], png.data[p + 2]);
    }
    done++;
    if (done % 10 === 0 || done === tiles.length) {
      process.stdout.write(`\r[DEM] downloaded ${done}/${tiles.length} tiles…`);
    }
    return { tx, ty, width: png.width, height: png.height, elev };
  });
  process.stdout.write('\n');
  log(`[DEM] ${human(bytes)} of tiles downloaded`);

  const tileSize = decoded[0].width; // 256
  const mosaicW = range.cols * tileSize;
  const mosaicH = range.rows * tileSize;
  const mosaic = new Float32Array(mosaicW * mosaicH);

  for (const t of decoded) {
    const ox = (t.tx - range.xMin) * tileSize;
    const oy = (t.ty - range.yMin) * tileSize;
    for (let y = 0; y < t.height; y++) {
      const srcRow = y * t.width;
      const dstRow = (oy + y) * mosaicW + ox;
      for (let x = 0; x < t.width; x++) {
        mosaic[dstRow + x] = t.elev[srcRow + x];
      }
    }
  }

  // Bilinear sample of the Mercator mosaic at a pixel offset.
  const sampleMosaic = (px, py) => {
    const cx = Math.max(0, Math.min(mosaicW - 1.001, px));
    const cy = Math.max(0, Math.min(mosaicH - 1.001, py));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(mosaicW - 1, x0 + 1);
    const y1 = Math.min(mosaicH - 1, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const a = mosaic[y0 * mosaicW + x0] * (1 - fx) + mosaic[y0 * mosaicW + x1] * fx;
    const b = mosaic[y1 * mosaicW + x0] * (1 - fx) + mosaic[y1 * mosaicW + x1] * fx;
    return a * (1 - fy) + b * fy;
  };

  const out = new Int16Array(outW * outH);
  let minE = Infinity;
  let maxE = -Infinity;

  for (let j = 0; j < outH; j++) {
    // Row 0 is the NORTH edge, the convention the runtime sampler expects.
    const lat = BOUNDS.maxLat - (j / (outH - 1)) * (BOUNDS.maxLat - BOUNDS.minLat);
    const gy = (latToTileY(lat, z) - range.yMin) * tileSize;

    for (let i = 0; i < outW; i++) {
      const lon = BOUNDS.minLon + (i / (outW - 1)) * (BOUNDS.maxLon - BOUNDS.minLon);
      const gx = (lonToTileX(lon, z) - range.xMin) * tileSize;

      const v = Math.round(sampleMosaic(gx, gy));
      const clamped = Math.max(-32768, Math.min(32767, v));
      out[j * outW + i] = clamped;
      if (clamped < minE) minE = clamped;
      if (clamped > maxE) maxE = clamped;
    }
    if (j % 128 === 0) process.stdout.write(`\r[DEM] resampling row ${j}/${outH}…`);
  }
  process.stdout.write('\n');

  const binPath = path.join(DATA_DIR, 'erbil_map_dem.bin');
  fs.writeFileSync(binPath, Buffer.from(out.buffer, out.byteOffset, out.byteLength));

  const meta = {
    width: outW,
    height: outH,
    minLon: BOUNDS.minLon,
    maxLon: BOUNDS.maxLon,
    minLat: BOUNDS.minLat,
    maxLat: BOUNDS.maxLat,
    // Circle definition the renderer clips the terrain to.
    centerLon: CENTER.lon,
    centerLat: CENTER.lat,
    radiusKm: RADIUS_KM,
    kmPerDegLon: KM_PER_DEG_LON,
    kmPerDegLat: KM_PER_DEG_LAT,
    domainWidthKm: RADIUS_KM * 2,
    domainHeightKm: RADIUS_KM * 2,
    minElevation: minE,
    maxElevation: maxE,
    rowOrder: 'north-to-south',
    encoding: 'Int16 little-endian metres above sea level',
    source: `Mapzen/AWS terrarium zoom ${z}`,
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(
    path.join(DATA_DIR, 'erbil_map_dem_meta.json'),
    JSON.stringify(meta, null, 2)
  );

  log(`[DEM] wrote ${binPath} (${human(fs.statSync(binPath).size)})`);
  log(`[DEM] elevation range ${minE} m … ${maxE} m`);
  return meta;
}

// ---------------------------------------------------------------------------
// Imagery — NASA GIBS WMS (single request covering the bbox)
// ---------------------------------------------------------------------------

function gibsWmsUrl(layer, width, height, { format = 'image/jpeg', transparent = false } = {}) {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    LAYERS: layer,
    VERSION: '1.3.0',
    FORMAT: format,
    TRANSPARENT: transparent ? 'TRUE' : 'FALSE',
    WIDTH: String(width),
    HEIGHT: String(height),
    CRS: 'EPSG:4326',
    // EPSG:4326 axis order in WMS 1.3.0 is lat,lon.
    BBOX: `${BOUNDS.minLat},${BOUNDS.minLon},${BOUNDS.maxLat},${BOUNDS.maxLon}`
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

async function buildGibsLayer({ layer, size, outPath, label, format, transparent }) {
  const { width, height } = parseSize(size);
  const url = gibsWmsUrl(layer, width, height, { format, transparent });
  log(`\n[${label}] GET ${layer} @ ${width}x${height}`);
  const buf = await fetchBuffer(url);
  fs.writeFileSync(outPath, buf);
  log(`[${label}] wrote ${outPath} (${human(buf.length)})`);
  return true;
}

// ---------------------------------------------------------------------------
// Cloud map — DERIVED from a true-colour layer
//
// Investigated and rejected: GIBS's dedicated cloud products
// (MODIS_Terra_Cloud_Fraction_Day, MODIS_Terra_Cloud_Top_Height_Day) return a
// completely blank tile for this bounding box — verified as a uniform all-zero
// image of 3129 bytes. They are Level-2 SWATH products, not global grids, so they
// only cover the satellite's instantaneous swath. Requesting them over the Middle
// East yields no data at all, which silently produces an invisible cloud layer.
//
// Instead the cloud mask is derived from a TRUE-COLOUR layer, where clouds are the
// bright, low-saturation pixels. Brightness alone is not enough: the Arabian desert
// is also very bright. Deserts are warm/yellow (high saturation) whereas cloud tops
// are neutral white, so saturation is used to reject sand.
//
// Known limitation: fresh snow is also bright and neutral, so snowfields can be
// mistaken for cloud. Acceptable for a weather overlay, and noted here honestly.
// ---------------------------------------------------------------------------

function smoothstep(x, edge0, edge1) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Brightness/saturation thresholds for the cloud mask. */
const CLOUD_LUMA_LOW = 168; // below this, definitely not cloud
const CLOUD_LUMA_HIGH = 238; // above this, definitely cloud (if neutral)
const CLOUD_SAT_LOW = 0.07; // neutral enough to be cloud
const CLOUD_SAT_HIGH = 0.24; // this saturated -> desert, not cloud
/**
 * Gamma applied to the cloud mask. Values above 1 crush faint haze and keep only real
 * cloud. Without it the soft edges of every thin cloud accumulate into a grey veil that
 * washes the terrain out from underneath.
 */
const CLOUD_MASK_GAMMA = 1.9;

async function buildCloudMap({ size, outPath, sourceLayer, label = 'CLOUDS' }) {
  const sharp = require('sharp');
  const { width, height } = parseSize(size);

  const url = gibsWmsUrl(sourceLayer, width, height, { format: 'image/jpeg' });
  log(`\n[${label}] deriving cloud mask from ${sourceLayer} @ ${width}x${height}`);
  const buf = await fetchBuffer(url);

  const { data, info } = await sharp(buf)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const mask = Buffer.alloc(width * height);
  let cloudPixels = 0;

  for (let i = 0, p = 0; i < mask.length; i++, p += channels) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];

    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;

    const bright = smoothstep(luma, CLOUD_LUMA_LOW, CLOUD_LUMA_HIGH);
    const neutral = 1 - smoothstep(sat, CLOUD_SAT_LOW, CLOUD_SAT_HIGH);
    const shaped = Math.pow(Math.max(0, bright * neutral), CLOUD_MASK_GAMMA);
    const value = Math.round(255 * Math.max(0, Math.min(1, shaped)));

    mask[i] = value;
    if (value > 64) cloudPixels++;
  }

  await sharp(mask, { raw: { width, height, channels: 1 } })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(outPath);

  const pct = ((cloudPixels / (width * height)) * 100).toFixed(1);
  const bytes = fs.statSync(outPath).size;
  log(`[${label}] wrote ${outPath} (${human(bytes)}), cloud-covered ${pct}% of the region`);
  return { cloudCoveragePct: parseFloat(pct) };
}

// ---------------------------------------------------------------------------
// Base map — composite of a high-detail LAND layer over a full-coverage layer
//
// The Landsat WELD true-colour mosaic is a LAND-ONLY product at 30 m: every ocean,
// sea and gulf renders as pure black, and it also has black scene gaps. Used
// directly as a globe base map it produces a black Mediterranean, Red Sea and
// Persian Gulf, which is unusable.
//
// So the land layer is composited over a full-coverage layer (Blue Marble shaded
// relief, which carries ocean colour and bathymetry). Any pixel that is
// essentially black in the land layer is replaced by the fill layer. Real imagery
// is virtually never pure black, so a very low threshold is safe and will not
// clobber genuinely dark terrain.
// ---------------------------------------------------------------------------

/** A pixel is treated as "no data" when every channel is at or below this. */
// Landsat WELD no-data tiles are pure black (0); JPEG noise scatters a fringe around them.
const NO_DATA_MAX_CHANNEL = 24;

/**
 * Landsat WELD is tuned for LAND, so it renders open water almost black — the Caspian came
 * out as RGB(1,20,24) and the Black Sea as RGB(0,2,27). Those are REAL pixels, not no-data,
 * so no brightness threshold could catch them, and the contrast offset then crushed them to
 * solid black patches. They are replaced from the bathymetry layer instead.
 *
 * Detection is deliberately water-specific rather than "dark": dark WATER is blue-dominant
 * (b > r), whereas dark vegetation is green-dominant and dark shadow is neutral. A plain
 * brightness threshold would have wiped out the dark forested slopes of the Caucasus.
 */
const WATER_MAX_CHANNEL = 80;
const WATER_BLUE_LEAD = 10;

/** Final fallback for pixels missing in BOTH source layers (enclosed seas). */
const OCEAN_FALLBACK_R = 0x12;
const OCEAN_FALLBACK_G = 0x3d;
const OCEAN_FALLBACK_B = 0x5e;

/** Post-processing applied to the assembled base map, to cut through source haze. */
const IMAGERY_SATURATION = 1.2;
const IMAGERY_CONTRAST = 1.14;
// Kept mild deliberately: an aggressive negative offset crushes near-black source pixels
// to pure black and turns sensor no-data into hard black rectangles.
const IMAGERY_OFFSET = -10;

async function buildBaseComposite({ size, outPath, landLayer, fillLayer, label = 'IMAGERY' }) {
  const sharp = require('sharp');
  const { width, height } = parseSize(size);

  log(`\n[${label}] land layer  : ${landLayer}`);
  log(`[${label}] fill layer  : ${fillLayer}`);
  log(`[${label}] size        : ${width}x${height}`);

  const [landBuf, fillBuf] = await Promise.all([
    fetchBuffer(gibsWmsUrl(landLayer, width, height, { format: 'image/jpeg' })),
    fetchBuffer(gibsWmsUrl(fillLayer, width, height, { format: 'image/jpeg' }))
  ]);

  const land = await sharp(landBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const fill = await sharp(fillBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  if (land.info.width !== width || fill.info.width !== width) {
    throw new Error(
      `Panel size mismatch: land ${land.info.width}x${land.info.height}, ` +
        `fill ${fill.info.width}x${fill.info.height}, expected ${width}x${height}`
    );
  }

  const pixels = width * height;
  const out = Buffer.alloc(pixels * 3);
  let fromLand = 0;
  let fromFill = 0;
  let fromOcean = 0;

  // Three-way fill. Landsat WELD is land-only, and the fill layer has its OWN no-data
  // gaps over enclosed seas (the Caspian and Black Sea came out black). So a pixel that
  // is missing in BOTH falls back to a flat ocean colour — otherwise dead black
  // rectangles survive into the final map, which is exactly what happened before.
  for (let i = 0; i < pixels; i++) {
    const o = i * 3;
    const r = land.data[o];
    const g = land.data[o + 1];
    const b = land.data[o + 2];

    const landMax = Math.max(r, g, b);
    const isNoData = landMax <= NO_DATA_MAX_CHANNEL;
    const isDarkWater =
      !isNoData && landMax < WATER_MAX_CHANNEL && b > r + WATER_BLUE_LEAD && b >= g;

    if (!isNoData && !isDarkWater) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      fromLand++;
      continue;
    }

    const fr = fill.data[o];
    const fg = fill.data[o + 1];
    const fb = fill.data[o + 2];

    if (Math.max(fr, fg, fb) > NO_DATA_MAX_CHANNEL) {
      out[o] = fr;
      out[o + 1] = fg;
      out[o + 2] = fb;
      fromFill++;
    } else {
      out[o] = OCEAN_FALLBACK_R;
      out[o + 1] = OCEAN_FALLBACK_G;
      out[o + 2] = OCEAN_FALLBACK_B;
      fromOcean++;
    }
  }

  // Mild contrast + saturation lift. The Landsat annual composite carries visible
  // atmospheric haze, so straight from the source it looks pale and flat next to
  // Google Earth's base imagery. linear(a, b) computes a*x + b, and the offset is
  // chosen so the midpoint stays put while contrast increases about it.
  const pipeline = sharp(out, { raw: { width, height, channels: 3 } });
  if (!OPTIONS.neutral) {
    pipeline.modulate({ saturation: IMAGERY_SATURATION }).linear(IMAGERY_CONTRAST, IMAGERY_OFFSET);
  } else {
    log(`[${label}] NEUTRAL output — no contrast/saturation boost (cloud-detection reference)`);
  }
  await pipeline.jpeg({ quality: 92, mozjpeg: true }).toFile(outPath);

  const pct = (n) => ((n / pixels) * 100).toFixed(1);
  log(
    `[${label}] wrote ${outPath} (${human(fs.statSync(outPath).size)}) — ` +
      `land ${pct(fromLand)}%, fill layer ${pct(fromFill)}%, ocean fallback ${pct(fromOcean)}%`
  );
  return {
    landPct: parseFloat(pct(fromLand)),
    fillPct: parseFloat(pct(fromFill)),
    oceanPct: parseFloat(pct(fromOcean))
  };
}

// ---------------------------------------------------------------------------
// Imagery — XYZ tile mosaic (ESRI World Imagery and similar)
// ---------------------------------------------------------------------------

async function buildTileMosaic({ urlTemplate, zoom, size, outPath, label, tileSize = 256 }) {
  const range = tileRange(zoom);
  const nativeW = range.cols * tileSize;
  const nativeH = range.rows * tileSize;
  const tileCount = range.cols * range.rows;

  log(`\n[${label}] XYZ zoom ${zoom} — ${range.cols}x${range.rows} = ${tileCount} tiles`);
  log(`[${label}] native mosaic ${nativeW}x${nativeH}, output ${size}`);

  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    throw new Error('sharp is required for tile mosaics — run `yarn install` first.');
  }

  const jobs = [];
  for (let ty = range.yMin; ty <= range.yMax; ty++) {
    for (let tx = range.xMin; tx <= range.xMax; tx++) jobs.push({ tx, ty });
  }

  let done = 0;
  let bytes = 0;
  const buffers = await mapLimit(jobs, OPTIONS.concurrency, async ({ tx, ty }) => {
    const url = urlTemplate
      .replace('{z}', String(zoom))
      .replace('{x}', String(tx))
      .replace('{y}', String(ty));
    const buf = await fetchBuffer(url);
    bytes += buf.length;
    done++;
    if (done % 20 === 0 || done === jobs.length) {
      process.stdout.write(`\r[${label}] downloaded ${done}/${jobs.length} tiles…`);
    }
    return { tx, ty, buf };
  });
  process.stdout.write('\n');
  log(`[${label}] ${human(bytes)} of tiles downloaded`);

  const composites = buffers.map(({ tx, ty, buf }) => ({
    input: buf,
    left: (tx - range.xMin) * tileSize,
    top: (ty - range.yMin) * tileSize
  }));

  const mosaic = sharp({
    create: {
      width: nativeW,
      height: nativeH,
      channels: 3,
      background: { r: 8, g: 12, b: 20 }
    }
  }).composite(composites);

  const { width: outW, height: outH } = parseSize(size);
  const outBuf = await mosaic
    .resize(outW, outH, { fit: 'fill' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  fs.writeFileSync(outPath, outBuf);
  log(`[${label}] wrote ${outPath} (${human(outBuf.length)})`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  ensureDirs();
  const started = Date.now();

  log('OpenEarth — Middle East asset builder');
  log(`Bounds: lon ${BOUNDS.minLon}…${BOUNDS.maxLon}, lat ${BOUNDS.minLat}…${BOUNDS.maxLat}`);
  log(`Source: ${OPTIONS.source}`);

  const summary = {};

  if (!OPTIONS.skipDem) {
    summary.dem = await buildDem();
  } else {
    log('\n[DEM] skipped');
  }

  if (!OPTIONS.skipImagery) {
    const out = path.join(TILES_DIR, OPTIONS.outName);
    if (OPTIONS.source === 'esri') {
      await buildTileMosaic({
        urlTemplate:
          'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        zoom: OPTIONS.demZoom + 1,
        size: OPTIONS.imagerySize,
        outPath: out,
        label: 'IMAGERY-ESRI'
      });
    } else if (OPTIONS.source === 'eox') {
      await buildTileMosaic({
        urlTemplate:
          'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
        zoom: OPTIONS.demZoom + 1,
        size: OPTIONS.imagerySize,
        outPath: out,
        label: 'IMAGERY-EOX'
      });
    } else {
      try {
        await buildBaseComposite({
          size: OPTIONS.imagerySize,
          outPath: out,
          landLayer: OPTIONS.imageryLayer,
          fillLayer: OPTIONS.imageryFillLayer
        });
      } catch (err) {
        warn(`[IMAGERY] composite failed: ${err.message}`);
        warn(`[IMAGERY] falling back to plain "${OPTIONS.imageryLayerFallback}"`);
        await buildGibsLayer({
          layer: OPTIONS.imageryLayerFallback,
          size: OPTIONS.imagerySize,
          outPath: out,
          label: 'IMAGERY'
        });
      }
    }
  } else {
    log('\n[IMAGERY] skipped');
  }

  if (!OPTIONS.skipClouds) {
    await buildCloudMap({
      size: '2048x2048',
      outPath: path.join(TILES_DIR, 'erbil_map_clouds.jpg'),
      sourceLayer: OPTIONS.cloudSourceLayer
    });
  } else {
    log('\n[CLOUDS] skipped');
  }

  if (!OPTIONS.skipWorld) {
    await buildGibsLayer({
      layer: 'BlueMarble_ShadedRelief_Bathymetry',
      size: OPTIONS.worldSize,
      outPath: path.join(TILES_DIR, 'world_base.jpg'),
      label: 'WORLD'
    });
  } else {
    log('\n[WORLD] skipped');
  }

  log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (summary.dem) {
    log(`Elevation range: ${summary.dem.minElevation} m … ${summary.dem.maxElevation} m`);
  }
}

main().catch((err) => {
  console.error('\nAsset build FAILED:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
