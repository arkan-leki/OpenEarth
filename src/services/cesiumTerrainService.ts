/**
 * Live, token-free, on-demand global terrain for CesiumJS.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app used to hand-roll its own DEM: a 4096² Int16 blob (33 MB) baked once from
 * Mapzen/AWS "terrarium" tiles at zoom 9, decoded and uploaded as one giant texture. That
 * approach has three problems — it is frozen at one resolution, it costs 33 MB of transfer
 * before anything appears, and it only ever covers the app's own 1600 km box.
 *
 * CesiumJS wants terrain as a *tile pyramid*: it asks for the specific (x, y, level) tiles
 * that are on screen, at the resolution the current camera actually needs, and nothing else.
 * That is exactly what "stream on demand" means here — pan and zoom, and the tiles you need
 * arrive; the ones you leave behind are never fetched.
 *
 * So instead of serving a baked file, this provider fetches terrarium tiles live — the very
 * same source the old blob was baked FROM, just at whatever zoom Cesium asks for. No API key,
 * no Cesium ion token, global coverage, and the source sends
 * `Access-Control-Allow-Origin: *` so the browser may decode the pixels.
 *
 * TERRARIUM ENCODING
 * ------------------
 * Each 256×256 PNG packs a height into RGB as `(R * 256 + G + B / 256) - 32768` metres. That
 * range is exactly the Int16 range, so heights are stored here as Int16Array — a perfect fit
 * with no precision loss.
 *
 * ROW ORDER (checked against Cesium's own tessellator, not assumed)
 * ----------------------------------------------------------------
 * `HeightmapTessellator` walks `lerp(rectangle.north, rectangle.south, row / (height - 1))`,
 * so heightmap row 0 is the NORTH edge. A terrarium PNG's row 0 is its top edge, which is
 * also north, and column 0 is west. The data therefore maps straight in with no flip.
 */

import * as Cesium from 'cesium';

const TERRARIUM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/** Terrarium tiles are 256×256 PNGs. */
const SOURCE_TILE_PX = 256;

/**
 * Samples per side in the heightmap handed to Cesium.
 *
 * Cesium's own terrain tiles are ~65×65; feeding it 256×256 would mean a 65k-vertex mesh per
 * tile for detail the source does not actually have. We therefore decode the 256² PNG and
 * resample it down to 65², which also shrinks the cache entry from 256 KB to 8.4 KB.
 */
const OUT_SAMPLES = 65;

/** Highest terrarium zoom that exists. Asking deeper only produces 404s. */
export const TERRARIUM_MAX_LEVEL = 13;

/** Concurrent PNG downloads+decodes. Enough to fill a screen, few enough not to saturate the CPU. */
const MAX_INFLIGHT = 6;

/** 65² Int16 = 8.4 KB per tile, so a few thousand tiles still fits in a modest budget. */
const MAX_CACHED_TILES = 3000;

/** Terrain tiles are streamed; the terrain is flat (0 m) wherever a tile cannot be fetched. */
const FLAT_TILE = new Int16Array(OUT_SAMPLES * OUT_SAMPLES);

export interface TerrainStreamStats {
  loaded: number;
  failed: number;
  cached: number;
  inflight: number;
}

const stats: TerrainStreamStats = { loaded: 0, failed: 0, cached: 0, inflight: 0 };

/** Live counters for the HUD — proof that tiles really are arriving on demand. */
export function getTerrainStats(): TerrainStreamStats {
  return { ...stats, cached: tileCache.size, inflight: inflight };
}

const tileCache = new Map<string, Int16Array>();
const pending = new Map<string, Promise<Int16Array>>();

let inflight = 0;
const waiters: Array<() => void> = [];

/**
 * Caps how many tiles are downloaded at once. Without this, flying the camera can queue
 * hundreds of simultaneous fetches and decodes and stall the main thread — the exact class of
 * freeze this project is trying to leave behind.
 */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    const next = waiters.shift();
    if (next) next();
  }
}

/**
 * One reusable canvas for decoding. `drawImage` + `getImageData` run back-to-back in the same
 * synchronous block after the `await`, so concurrent decodes cannot interleave on it.
 */
let decodeCanvas: HTMLCanvasElement | null = null;
let decodeCtx: CanvasRenderingContext2D | null = null;

function getDecodeTarget(): CanvasRenderingContext2D {
  if (!decodeCtx) {
    decodeCanvas = document.createElement('canvas');
    decodeCanvas.width = SOURCE_TILE_PX;
    decodeCanvas.height = SOURCE_TILE_PX;
    decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
    if (!decodeCtx) throw new Error('2d context unavailable for terrain decode');
  }
  return decodeCtx;
}

/** Terrarium RGB → metres. */
function encodedHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Bilinear sample of the terrarium tile, in pixel coordinates clamped to the tile. */
function sampleHeight(data: Uint8ClampedArray, fx: number, fy: number): number {
  const x = fx < 0 ? 0 : fx > SOURCE_TILE_PX - 1 ? SOURCE_TILE_PX - 1 : fx;
  const y = fy < 0 ? 0 : fy > SOURCE_TILE_PX - 1 ? SOURCE_TILE_PX - 1 : fy;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < SOURCE_TILE_PX ? x0 + 1 : x0;
  const y1 = y0 + 1 < SOURCE_TILE_PX ? y0 + 1 : y0;
  const tx = x - x0;
  const ty = y - y0;

  const i00 = (y0 * SOURCE_TILE_PX + x0) * 4;
  const i10 = (y0 * SOURCE_TILE_PX + x1) * 4;
  const i01 = (y1 * SOURCE_TILE_PX + x0) * 4;
  const i11 = (y1 * SOURCE_TILE_PX + x1) * 4;

  const h00 = encodedHeight(data[i00], data[i00 + 1], data[i00 + 2]);
  const h10 = encodedHeight(data[i10], data[i10 + 1], data[i10 + 2]);
  const h01 = encodedHeight(data[i01], data[i01 + 1], data[i01 + 2]);
  const h11 = encodedHeight(data[i11], data[i11 + 1], data[i11 + 2]);

  const top = h00 + (h10 - h00) * tx;
  const bottom = h01 + (h11 - h01) * tx;
  return top + (bottom - top) * ty;
}

/**
 * Decodes one terrarium PNG into a 65×65 Int16 heightmap.
 *
 * Cesium's sample grid is edge-inclusive (sample 0 sits exactly on the west/north edge, the
 * last on the east/south edge), while PNG pixels sit at half-pixel centres. The mapping below
 * therefore spans `[0, 256]` in pixel space and clamps at the ends, which keeps every interior
 * sample on its true position and puts the two edge samples on the nearest real pixel.
 */
async function decodeTerrariumTile(blob: Blob): Promise<Int16Array> {
  const bitmap = await createImageBitmap(blob);
  try {
    const ctx = getDecodeTarget();
    ctx.clearRect(0, 0, SOURCE_TILE_PX, SOURCE_TILE_PX);
    ctx.drawImage(bitmap, 0, 0, SOURCE_TILE_PX, SOURCE_TILE_PX);
    const { data } = ctx.getImageData(0, 0, SOURCE_TILE_PX, SOURCE_TILE_PX);

    const out = new Int16Array(OUT_SAMPLES * OUT_SAMPLES);
    for (let j = 0; j < OUT_SAMPLES; j++) {
      const fy = (j * SOURCE_TILE_PX) / (OUT_SAMPLES - 1) - 0.5;
      for (let i = 0; i < OUT_SAMPLES; i++) {
        const fx = (i * SOURCE_TILE_PX) / (OUT_SAMPLES - 1) - 0.5;
        out[j * OUT_SAMPLES + i] = Math.round(sampleHeight(data, fx, fy));
      }
    }
    return out;
  } finally {
    bitmap.close();
  }
}

function loadTile(z: number, x: number, y: number): Promise<Int16Array> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return Promise.resolve(cached);

  const already = pending.get(key);
  if (already) return already;

  const task = withSlot(async () => {
    try {
      const res = await fetch(`${TERRARIUM_BASE}/${key}.png`, { mode: 'cors' });
      if (!res.ok) {
        stats.failed++;
        return FLAT_TILE;
      }
      const heights = await decodeTerrariumTile(await res.blob());
      // Map preserves insertion order, so the oldest entry is simply the first key.
      if (tileCache.size >= MAX_CACHED_TILES) {
        const oldest = tileCache.keys().next().value;
        if (oldest !== undefined) tileCache.delete(oldest);
      }
      tileCache.set(key, heights);
      stats.loaded++;
      return heights;
    } catch {
      stats.failed++;
      return FLAT_TILE;
    } finally {
      pending.delete(key);
    }
  });

  pending.set(key, task);
  return task;
}

/**
 * Builds the terrain provider CesiumJS streams from.
 *
 * `WebMercatorTilingScheme` is deliberate: terrarium tiles are standard XYZ web-mercator, so
 * Cesium's (x, y, level) maps 1:1 onto a terrarium URL with no reprojection or tile algebra.
 */
export function createLiveTerrainProvider(): Cesium.CustomHeightmapTerrainProvider {
  const provider = new Cesium.CustomHeightmapTerrainProvider({
    width: OUT_SAMPLES,
    height: OUT_SAMPLES,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: 'Terrain: Mapzen / AWS Open Data (terrarium)',
    callback: (x, y, level) => {
      if (level > TERRARIUM_MAX_LEVEL) return FLAT_TILE;
      return loadTile(level, x, y);
    }
  });

  /**
   * Stops refinement at the deepest level the source actually has. Past it there is no new
   * information to fetch, so requesting more tiles would cost bandwidth and memory to
   * interpolate detail that was never measured.
   */
  provider.getTileDataAvailable = (_x: number, _y: number, level: number) =>
    level <= TERRARIUM_MAX_LEVEL;

  return provider;
}
