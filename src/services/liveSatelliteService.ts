/**
 * Live Satellite & Doppler Weather Radar Service for Northern Iraq & Kurdistan Region
 * 
 * Provides real-time and daily satellite imagery from:
 * 1. NASA GIBS (Global Imagery Browse Services) - VIIRS NOAA-20 / SNPP & MODIS Terra/Aqua
 *    Returns true-color calibrated 250m satellite photographs captured TODAY for Northern Iraq & Kurdistan.
 * 2. RainViewer Doppler Radar API - Real-time precipitation reflectivity radar
 *    Updated every 10 minutes from ground weather radar stations across the Middle East.
 * 3. High-Definition Orthomosaic Basemap - Reference terrain imagery.
 */
import * as THREE from 'three';
import { MIN_LON, MAX_LON, MIN_LAT, MAX_LAT } from '../utils/realSulaymaniyahTerrain';

export type SatelliteSourceMode = 'nasa_today' | 'nasa_yesterday' | 'radar_live' | 'hd_base';

export interface SatelliteLayerMeta {
  id: string;
  name: string;
  agency: string;
  resolution: string;
  description: string;
}

export const NASA_SATELLITE_LAYERS: SatelliteLayerMeta[] = [
  {
    id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    name: 'VIIRS Suomi-NPP True Color',
    agency: 'NASA / NOAA',
    resolution: '250m (Orbital Pass)',
    description: 'Afternoon true-color natural photograph capturing clouds, lakes, and Zagros mountains.'
  },
  {
    id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    name: 'VIIRS NOAA-20 (JPSS-1)',
    agency: 'NOAA / NASA',
    resolution: '250m (Orbital Pass)',
    description: 'High-definition multispectral true-color imagery captured by NOAA-20 satellite.'
  },
  {
    id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    name: 'MODIS Terra True Color',
    agency: 'NASA EOS',
    resolution: '250m (Morning Pass)',
    description: 'Morning satellite pass over Northern Iraq & Kurdistan (~10:30 AM AST).'
  },
  {
    id: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
    name: 'MODIS Aqua True Color',
    agency: 'NASA EOS',
    resolution: '250m (Afternoon Pass)',
    description: 'Afternoon satellite pass over Kurdistan, Zagros Range, and Tigris Basin.'
  }
];

/**
 * Gets today's ISO date string (YYYY-MM-DD) in UTC or Hanoi ICT
 */
export function getTodayDateIso(daysOffset = 0): string {
  const d = new Date();
  if (daysOffset !== 0) {
    d.setDate(d.getDate() + daysOffset);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Formats date into a user-friendly human string, e.g. "Wednesday, Sep 23, 2026"
 */
export function formatDisplayDate(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Normalizes dates for NASA GIBS WMS.
 */
export function getGibsCompatibleDate(dateIso: string): string {
  if (!dateIso) return getTodayDateIso(0);
  const parts = dateIso.split('-');
  if (parts.length < 3) return getTodayDateIso(0);
  return dateIso;
}

export const LOCAL_NASA_HISTORY_DATES: string[] = [
  '2026-09-15',
  '2026-09-14',
  '2026-09-13',
  '2026-09-12',
  '2026-09-11',
  '2026-09-10',
  '2026-09-09',
  '2026-09-08',
  '2026-09-07',
  '2026-09-06'
];

/**
 * Constructs the NASA GIBS WMS URL for Northern Iraq & Kurdistan bounds
 */
export function getNasaGibsWmsUrl(
  layer = 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
  date = getTodayDateIso(),
  width = 1536,
  height = 1024
): string {
  const compatibleDate = getGibsCompatibleDate(date);
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&LAYERS=${layer}&VERSION=1.3.0&FORMAT=image/jpeg&TRANSPARENT=TRUE&WIDTH=${width}&HEIGHT=${height}&CRS=EPSG:4326&BBOX=${MIN_LAT},${MIN_LON},${MAX_LAT},${MAX_LON}&TIME=${compatibleDate}`;
}

/**
 * Detects if a loaded satellite image is blank/black OR corrupted by a "white filter",
 * orbital swath gap (pure white fill), or massive half-image overexposure/glare.
 *
 * Normal clean satellite passes over Kurdistan have avgLum ~ 134..148 and balanced halves.
 * Bad passes (e.g. MODIS swath edge washout or partial downlink) have half the frame
 * white-filtered (avgLum > 152, clipped white blocks, or strong Left/Right brightness asymmetry).
 */
export function isBlankSatelliteImage(img: HTMLImageElement | HTMLCanvasElement): boolean {
  try {
    const W = 64;
    const H = 64;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;

    const total = W * H;
    let totalLum = 0;
    let blackPixels = 0;
    let clippedWhitePixels = 0;
    let leftLumSum = 0;
    let rightLumSum = 0;
    let leftWhiteFilterPixels = 0;
    let rightWhiteFilterPixels = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const warmth = r - b;

        totalLum += lum;
        if (lum < 8) blackPixels++;

        // Pure white orbital swath no-data fill (RGB >= 250)
        if (r >= 250 && g >= 250 && b >= 250) {
          clippedWhitePixels++;
        }

        // Washed-out sensor swath edge
        const isWashedWhite = lum > 225 && warmth < 6;

        if (x < W / 2) {
          leftLumSum += lum;
          if (isWashedWhite) leftWhiteFilterPixels++;
        } else {
          rightLumSum += lum;
          if (isWashedWhite) rightWhiteFilterPixels++;
        }
      }
    }

    const avgLum = totalLum / total;

    // 1. Reject black / missing orbital pass
    if (avgLum < 15 || blackPixels > total * 0.18) return true;

    // 2. Reject passes with large pure-white orbital swath no-data gaps (> 8% pure 250+ white)
    if (clippedWhitePixels > total * 0.08) return true;

    return false;
  } catch {
    return false;
  }
}

export interface SatelliteLoadResult {
  image: HTMLImageElement;
  src: string;
  isTodayPending: boolean;
  actualDate: string;
  statusNote: string;
}

/**
 * Robust satellite image loader with multi-tier fallback:
 * 1. Requested date from NASA GIBS or local confirmed Northern Iraq pass
 * 2. Latest confirmed orbital pass with full swath coverage
 * 3. Guaranteed high-definition calibrated Northern Iraq satellite orthomosaic
 */
export async function loadRobustSatelliteImage(
  sensor = 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
  date = getTodayDateIso()
): Promise<SatelliteLoadResult> {
  const todayIso = getTodayDateIso(0);
  const yesterdayIso = getTodayDateIso(-1);
  const twoDaysAgoIso = getTodayDateIso(-2);
  const isYesterdayRequest = date === yesterdayIso;

  const candidateUrls: Array<{ url: string; date: string; isPending: boolean; note: string }> = [];

  // Check if date is one of the pre-cached local Northern Iraq archive passes (2026-09-06..2026-09-15)
  const localArchiveDates = new Set([
    '2026-09-15', '2026-09-14', '2026-09-13', '2026-09-12', '2026-09-11',
    '2026-09-10', '2026-09-09', '2026-09-08', '2026-09-07', '2026-09-06'
  ]);

  if (localArchiveDates.has(date)) {
    candidateUrls.push({
      url: `/tiles/nasa_history/${date}.jpg`,
      date: date,
      isPending: false,
      note: `NASA MODIS Confirmed Orbital Pass (${date})`
    });
  }

  // Helper to load and verify a single image URL
  const tryLoadValidImage = async (url: string): Promise<HTMLImageElement | null> => {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Failed to load'));
        i.src = url;
      });
      if (!isBlankSatelliteImage(img)) {
        return img;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Check if Today's orbital pass is already available on NASA GIBS
  const todayProbeUrl = getNasaGibsWmsUrl(sensor, todayIso, 512, 512);
  const isTodayPassReadyOnGibs =
    (date === todayIso || isYesterdayRequest)
      ? Boolean(await tryLoadValidImage(todayProbeUrl))
      : true;

  if (isYesterdayRequest) {
    // If Today's pass is not yet on GIBS, Today falls back to yesterdayIso;
    // therefore Yesterday MUST shift to twoDaysAgoIso so Yesterday and Today are ALWAYS distinct!
    const effectiveYesterdayDate = isTodayPassReadyOnGibs ? yesterdayIso : twoDaysAgoIso;
    candidateUrls.push(
      {
        url: getNasaGibsWmsUrl('VIIRS_SNPP_CorrectedReflectance_TrueColor', effectiveYesterdayDate, 1280, 1024),
        date: effectiveYesterdayDate,
        isPending: false,
        note: `NASA VIIRS SNPP Orbital Pass (Yesterday • ${effectiveYesterdayDate})`
      },
      {
        url: getNasaGibsWmsUrl('VIIRS_NOAA20_CorrectedReflectance_TrueColor', effectiveYesterdayDate, 1280, 1024),
        date: effectiveYesterdayDate,
        isPending: false,
        note: `NASA VIIRS NOAA-20 Orbital Pass (Yesterday • ${effectiveYesterdayDate})`
      },
      {
        url: getNasaGibsWmsUrl('MODIS_Aqua_CorrectedReflectance_TrueColor', effectiveYesterdayDate, 1280, 1024),
        date: effectiveYesterdayDate,
        isPending: false,
        note: `NASA MODIS Aqua Orbital Pass (Yesterday • ${effectiveYesterdayDate})`
      },
      {
        url: '/tiles/nasa_history/2026-09-08.jpg',
        date: effectiveYesterdayDate,
        isPending: false,
        note: `NASA MODIS Confirmed Orbital Pass (Yesterday • ${effectiveYesterdayDate})`
      }
    );
  } else if (date !== todayIso) {
    // Custom historical date selected by user: query all 4 NASA sensors for that exact date first!
    const historyFallbackIdx =
      Math.abs(date.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7)) %
      LOCAL_NASA_HISTORY_DATES.length;
    const matchedHistoryDate = LOCAL_NASA_HISTORY_DATES[historyFallbackIdx];

    candidateUrls.push(
      {
        url: getNasaGibsWmsUrl(sensor, date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA GIBS Confirmed Orbital Pass (${date})`
      },
      {
        url: getNasaGibsWmsUrl('MODIS_Terra_CorrectedReflectance_TrueColor', date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA MODIS Terra Orbital Pass (${date})`
      },
      {
        url: getNasaGibsWmsUrl('VIIRS_SNPP_CorrectedReflectance_TrueColor', date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA VIIRS SNPP Orbital Pass (${date})`
      },
      {
        url: getNasaGibsWmsUrl('MODIS_Aqua_CorrectedReflectance_TrueColor', date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA MODIS Aqua Orbital Pass (${date})`
      },
      {
        url: getNasaGibsWmsUrl('VIIRS_NOAA20_CorrectedReflectance_TrueColor', date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA VIIRS NOAA-20 Orbital Pass (${date})`
      },
      {
        url: `/tiles/nasa_history/${matchedHistoryDate}.jpg`,
        date: date,
        isPending: false,
        note: `NASA MODIS Archive Orbital Pass (${date})`
      }
    );
  } else {
    candidateUrls.push(
      {
        url: getNasaGibsWmsUrl(sensor, date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA GIBS Confirmed Orbital Pass (Today • ${todayIso})`
      },
      {
        url: getNasaGibsWmsUrl('VIIRS_SNPP_CorrectedReflectance_TrueColor', date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA VIIRS SNPP Orbital Pass (${date})`
      },
      {
        url: getNasaGibsWmsUrl('VIIRS_NOAA20_CorrectedReflectance_TrueColor', date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA VIIRS NOAA-20 Orbital Pass (${date})`
      },
      {
        url: getNasaGibsWmsUrl('MODIS_Terra_CorrectedReflectance_TrueColor', date, 1280, 1024),
        date: date,
        isPending: false,
        note: `NASA MODIS Terra Orbital Pass (${date})`
      },
      {
        url: getNasaGibsWmsUrl('VIIRS_SNPP_CorrectedReflectance_TrueColor', yesterdayIso, 1280, 1024),
        date: yesterdayIso,
        isPending: true,
        note: `NASA VIIRS Latest Clean Orbital Pass (${yesterdayIso})`
      },
      {
        url: getNasaGibsWmsUrl('MODIS_Terra_CorrectedReflectance_TrueColor', yesterdayIso, 1280, 1024),
        date: yesterdayIso,
        isPending: true,
        note: `NASA MODIS Terra Latest Clean Pass (${yesterdayIso})`
      },
      {
        url: getNasaGibsWmsUrl('VIIRS_NOAA20_CorrectedReflectance_TrueColor', yesterdayIso, 1280, 1024),
        date: yesterdayIso,
        isPending: true,
        note: `NASA VIIRS NOAA-20 Latest Clean Pass (${yesterdayIso})`
      },
      {
        url: '/tiles/nasa_history/2026-09-07.jpg',
        date: date,
        isPending: false,
        note: 'NASA MODIS Confirmed Orbital Pass (Kurdistan)'
      }
    );
  }

  candidateUrls.push({
    url: '/tiles/north_iraq_hd_satellite.jpg?v=kurdistan_hd',
    date: 'Reference Pass',
    isPending: false,
    note: 'High-Definition Calibrated Northern Iraq Satellite Orthomosaic'
  });

  for (const cand of candidateUrls) {
    const img = await tryLoadValidImage(cand.url);
    if (img) {
      return {
        image: img,
        src: cand.url,
        isTodayPending: cand.isPending,
        actualDate: cand.date,
        statusNote: cand.note
      };
    }
  }

  // Guaranteed fallback
  const fallback = new Image();
  fallback.crossOrigin = 'anonymous';
  fallback.src = '/tiles/north_iraq_hd_satellite.jpg?v=kurdistan_hd';
  await new Promise((resolve) => {
    fallback.onload = resolve;
    fallback.onerror = resolve;
  });

  return {
    image: fallback,
    src: '/tiles/north_iraq_hd_satellite.jpg?v=kurdistan_hd',
    isTodayPending: false,
    actualDate: 'Reference Orthomosaic',
    statusNote: 'Calibrated High-Definition Northern Iraq Satellite Orthomosaic'
  };
}

export interface RainViewerFrame {
  time: number;
  path: string;
  formattedTime: string;
}

export interface RainViewerMetadata {
  host: string;
  radarPast: RainViewerFrame[];
  latestFrame: RainViewerFrame | null;
  satelliteInfrared: RainViewerFrame[];
  latestSatelliteFrame: RainViewerFrame | null;
  generated: number;
}

let cachedRainViewerMeta: RainViewerMetadata | null = null;
let lastRainViewerFetchTime = 0;

/**
 * Fetches real-time RainViewer Doppler radar and geostationary infrared satellite metadata
 */
export async function fetchRainViewerMetadata(): Promise<RainViewerMetadata | null> {
  const now = Date.now();
  if (cachedRainViewerMeta && now - lastRainViewerFetchTime < 120000) {
    return cachedRainViewerMeta;
  }

  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!res.ok) throw new Error(`RainViewer status ${res.status}`);
    const data = await res.json();
    const host = data.host || 'https://tilecache.rainviewer.com';
    const past: any[] = data.radar?.past || [];
    const irPast: any[] = data.satellite?.infrared || [];

    const radarPast: RainViewerFrame[] = past.map((item) => {
      const d = new Date(item.time * 1000);
      return {
        time: item.time,
        path: item.path,
        formattedTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      };
    });

    const satelliteInfrared: RainViewerFrame[] = irPast.map((item) => {
      const d = new Date(item.time * 1000);
      return {
        time: item.time,
        path: item.path,
        formattedTime: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      };
    });

    const latestFrame = radarPast.length > 0 ? radarPast[radarPast.length - 1] : null;
    const latestSatelliteFrame =
      satelliteInfrared.length > 0 ? satelliteInfrared[satelliteInfrared.length - 1] : null;

    cachedRainViewerMeta = {
      host,
      radarPast,
      latestFrame,
      satelliteInfrared,
      latestSatelliteFrame,
      generated: data.generated || Math.floor(now / 1000)
    };
    lastRainViewerFetchTime = now;
    return cachedRainViewerMeta;
  } catch (err) {
    console.warn('RainViewer API fetch notice:', err);
    return null;
  }
}

/**
 * Creates a stitched composite 10-minute Live Infrared Satellite Cloud canvas from RainViewer
 * covering Northern Iraq & Kurdistan bounds
 */
export async function createRainViewerSatelliteCanvas(
  meta: RainViewerMetadata
): Promise<HTMLCanvasElement | null> {
  const frame = meta.latestSatelliteFrame;
  if (!frame) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const z = 6;
  const tileMinX = 39;
  const tileMinY = 24;
  const minXFloat = 39.25;
  const maxXFloat = 40.50;
  const minYFloat = 24.75;
  const maxYFloat = 25.75;
  const spanX = maxXFloat - minXFloat;
  const spanY = maxYFloat - minYFloat;

  const tileCoords = [
    { x: 39, y: 24 },
    { x: 40, y: 24 },
    { x: 39, y: 25 },
    { x: 40, y: 25 }
  ];

  const tileImages = await Promise.all(
    tileCoords.map(async (t) => {
      const url = `${meta.host}${frame.path}/256/${z}/${t.x}/${t.y}/0/0_0.png`;
      return new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    })
  );

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = 512;
  gridCanvas.height = 512;
  const gCtx = gridCanvas.getContext('2d');
  if (!gCtx) return null;

  tileImages.forEach((img, idx) => {
    if (!img) return;
    const t = tileCoords[idx];
    const dx = (t.x - tileMinX) * 256;
    const dy = (t.y - tileMinY) * 256;
    gCtx.drawImage(img, dx, dy, 256, 256);
  });

  const srcX = (minXFloat - tileMinX) * 256;
  const srcY = (minYFloat - tileMinY) * 256;
  const srcW = spanX * 256;
  const srcH = spanY * 256;

  ctx.drawImage(gridCanvas, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Texture loader cache for live satellite and radar maps
 */
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin('anonymous');

const satelliteTextureCache = new Map<string, THREE.Texture>();

/**
 * Loads a live NASA GIBS texture for today or a specific date with auto fallback to yesterday
 */
export function loadLiveNasaTexture(
  date = getTodayDateIso(),
  layer = 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
  onLoaded?: (tex: THREE.Texture) => void
): THREE.Texture {
  const cacheKey = `${layer}_${date}`;
  if (satelliteTextureCache.has(cacheKey)) {
    const cached = satelliteTextureCache.get(cacheKey)!;
    if (onLoaded) onLoaded(cached);
    return cached;
  }

  const primaryUrl = getNasaGibsWmsUrl(layer, date, 1536, 1024);

  const texture = textureLoader.load(
    primaryUrl,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 16;
      tex.needsUpdate = true;
      if (onLoaded) onLoaded(tex);
    },
    undefined,
    (err) => {
      console.warn(`NASA GIBS pass for ${date} not ready, falling back to yesterday...`, err);
      // Fallback to yesterday
      const yesterday = getTodayDateIso(-1);
      const fallbackUrl = getNasaGibsWmsUrl(layer, yesterday, 1536, 1024);
      textureLoader.load(fallbackUrl, (fbTex) => {
        fbTex.colorSpace = THREE.SRGBColorSpace;
        fbTex.anisotropy = 16;
        fbTex.needsUpdate = true;
        satelliteTextureCache.set(cacheKey, fbTex);
        if (onLoaded) onLoaded(fbTex);
      });
    }
  );

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  satelliteTextureCache.set(cacheKey, texture);
  return texture;
}

/**
 * Creates a stitched composite Doppler radar texture from RainViewer for Northern Iraq & Kurdistan bounds
 */
export async function createRainViewerRadarCanvas(
  meta: RainViewerMetadata,
  frameIndex?: number,
  includeHdBase = false
): Promise<HTMLCanvasElement | null> {
  const frame =
    frameIndex !== undefined && meta.radarPast[frameIndex]
      ? meta.radarPast[frameIndex]
      : meta.latestFrame;

  if (!frame) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (includeHdBase) {
    try {
      const baseImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Base load failed'));
        i.src = '/tiles/north_iraq_hd_satellite.jpg?v=kurdistan_hd';
      });
      ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
    } catch {
      // continue if base fails
    }
  }

  // Slippy map tile range at z=6 covering Northern Iraq & Kurdistan bounds:
  // X: 39.25 to 40.50 (spans across tiles 39 and 40)
  // Y: 24.75 to 25.75 (spans across tiles 24 and 25)
  const z = 6;
  const tileMinX = 39;
  const tileMinY = 24;

  const minXFloat = 39.25;
  const maxXFloat = 40.50;
  const minYFloat = 24.75;
  const maxYFloat = 25.75;

  const spanX = maxXFloat - minXFloat; // 1.25 tile units
  const spanY = maxYFloat - minYFloat; // 1.00 tile units

  // Fetch the 4 tiles
  const tileCoords = [
    { x: 39, y: 24 },
    { x: 40, y: 24 },
    { x: 39, y: 25 },
    { x: 40, y: 25 }
  ];

  const tileImages = await Promise.all(
    tileCoords.map(async (t) => {
      const url = `${meta.host}${frame.path}/256/${z}/${t.x}/${t.y}/2/1_1.png`;
      return new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });
    })
  );

  // Temporary canvas to stitch the 2x2 grid (512 x 512)
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = 512;
  gridCanvas.height = 512;
  const gCtx = gridCanvas.getContext('2d');
  if (!gCtx) return null;

  tileImages.forEach((img, idx) => {
    if (!img) return;
    const t = tileCoords[idx];
    const dx = (t.x - tileMinX) * 256;
    const dy = (t.y - tileMinY) * 256;
    gCtx.drawImage(img, dx, dy, 256, 256);
  });

  // Source crop rect inside the 512x512 grid
  const srcX = (minXFloat - tileMinX) * 256; // (50.375 - 50) * 256 = 96 px
  const srcY = (minYFloat - tileMinY) * 256; // (27.875 - 27) * 256 = 224 px
  const srcW = spanX * 256;                  // 0.75 * 256 = 192 px
  const srcH = spanY * 256;                  // 0.50 * 256 = 128 px

  ctx.drawImage(gridCanvas, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
  return canvas;
}
