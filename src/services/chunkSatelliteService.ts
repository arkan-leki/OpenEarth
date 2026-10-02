/**
 * Runtime, per-chunk satellite imagery.
 *
 * A software product cannot pre-render satellite passes to files: the pass for today,
 * yesterday and every archive date is different. So these are fetched LIVE, one image per
 * chunk, and cached in memory only.
 *
 * Why per chunk: the previous pipeline requested ONE GIBS image for the whole domain and
 * stretched it across every chunk. A single image over 1600 km cannot give a region good
 * detail. Requesting the bounding box of each chunk separately means every region gets the
 * satellite's full resolution for its own area.
 *
 * Supports any GIBS reflectance layer, so each sensor (VIIRS SNPP, VIIRS NOAA-20, MODIS
 * Terra, MODIS Aqua, Landsat) can be rendered independently per region.
 */

import * as THREE from 'three';
import { isBlankSatelliteImage } from './liveSatelliteService';
import { MIN_LON, MAX_LON, MIN_LAT, MAX_LAT } from '../utils/realSulaymaniyahTerrain';

export interface ChunkBounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** GIBS layers the UI can select, all keyless and CORS-enabled. */
export const SATELLITE_SENSORS = [
  { id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', label: 'VIIRS SNPP (250 m)' },
  { id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', label: 'VIIRS NOAA-20 (250 m)' },
  { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', label: 'MODIS Terra (250 m)' },
  { id: 'MODIS_Aqua_CorrectedReflectance_TrueColor', label: 'MODIS Aqua (250 m)' },
  { id: 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual', label: 'Landsat WELD (30 m, annual)' }
] as const;

/** Pixels requested per chunk. Central chunks are narrower, so they get more per km. */
function tilePixelsFor(widthKm: number): number {
  return widthKm <= 320 ? 1536 : 1024;
}

function gibsWmsUrl(layer: string, b: ChunkBounds, w: number, h: number, dateIso: string): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    LAYERS: layer,
    VERSION: '1.3.0',
    FORMAT: 'image/jpeg',
    TRANSPARENT: 'FALSE',
    WIDTH: String(w),
    HEIGHT: String(h),
    CRS: 'EPSG:4326',
    BBOX: `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`,
    TIME: dateIso
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

/**
 * In-memory texture cache, keyed by `${date}|${layer}|${chunkId}`.
 * Deliberately never written to disk — this is live data for a running application.
 */
const textureCache = new Map<string, THREE.Texture>();
const inFlight = new Map<string, Promise<THREE.Texture | null>>();

export function clearSatelliteTextureCache(): void {
  for (const tex of textureCache.values()) tex.dispose();
  textureCache.clear();
}

/** Whole-domain bounds used only for cheap "is this date published yet" probes. */
const DOMAIN_BOUNDS: ChunkBounds = {
  minLon: MIN_LON,
  maxLon: MAX_LON,
  minLat: MIN_LAT,
  maxLat: MAX_LAT
};

function shiftDateIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

async function probeGibsDate(layer: string, dateIso: string): Promise<boolean> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('no pass'));
      i.src = gibsWmsUrl(layer, DOMAIN_BOUNDS, 96, 96, dateIso);
    });
    return !isBlankSatelliteImage(img);
  } catch {
    return false;
  }
}

/**
 * NASA polar passes for "today" are usually not published yet. Resolve the latest
 * date that actually has imagery (walking back a few days if needed) so the whole
 * map is built from ONE real, coherent pass instead of blank chunks.
 */
async function resolveAvailableDate(dateIso: string, layer: string, maxDaysBack = 3): Promise<string> {
  for (let back = 0; back <= maxDaysBack; back++) {
    const candidate = shiftDateIso(dateIso, -back);
    if (await probeGibsDate(layer, candidate)) return candidate;
  }
  return dateIso;
}

function loadOne(
  key: string,
  layer: string,
  bounds: ChunkBounds,
  pixels: number,
  dateIso: string
): Promise<THREE.Texture | null> {
  const cached = textureCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = new Promise<THREE.Texture | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      textureCache.set(key, tex);
      inFlight.delete(key);
      resolve(tex);
    };

    img.onerror = () => {
      // A missing pass (no coverage on that date) is normal, not fatal.
      inFlight.delete(key);
      resolve(null);
    };

    img.src = gibsWmsUrl(layer, bounds, pixels, pixels, dateIso);
  });

  inFlight.set(key, promise);
  return promise;
}

export interface ChunkRequest {
  id: string;
  bounds: ChunkBounds;
  /** Chunk width in km, used to choose the request resolution. */
  widthKm: number;
}

/**
 * Fetches one satellite image per chunk for a date + sensor.
 * Returns a map of chunkId -> texture; chunks without coverage are simply absent.
 */
export async function loadSatelliteTilesForChunks(
  requests: ChunkRequest[],
  layer: string,
  dateIso: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<Map<string, THREE.Texture>> {
  const out = new Map<string, THREE.Texture>();
  let loaded = 0;

  // Resolve once so every chunk uses the same real pass (today → yesterday → …).
  const effectiveDate = await resolveAvailableDate(dateIso, layer);

  // Bounded concurrency: 16 parallel GIBS requests would be rude and slow.
  const queue = [...requests];
  const runners = new Array(Math.min(6, queue.length)).fill(null).map(async () => {
    while (queue.length) {
      const req = queue.shift();
      if (!req) return;
      const key = `${effectiveDate}|${layer}|${req.id}`;
      const tex = await loadOne(key, layer, req.bounds, tilePixelsFor(req.widthKm), effectiveDate);
      if (tex) out.set(req.id, tex);
      loaded++;
      onProgress?.(loaded, requests.length);
    }
  });

  await Promise.all(runners);
  return out;
}
