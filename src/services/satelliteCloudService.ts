/**
 * High-Resolution (1024x1024) Real Satellite Cloud, Snow Cover, Fog & Dust Extraction Engine
 * for Northern Iraq & Kurdistan Region
 *
 * Preserves 100% of the crisp, fine-grained morphological structure of real NASA satellite
 * clouds (zero blur "soup"), while keeping the 3D terrain on the sharp Kurdistan HD Base.
 */
import * as THREE from 'three';
import {
  getTodayDateIso,
  getNasaGibsWmsUrl,
  fetchRainViewerMetadata,
  createRainViewerRadarCanvas,
  loadRobustSatelliteImage,
  isBlankSatelliteImage
} from './liveSatelliteService';
import {
  KurdistanWeatherPayload,
  KURDISTAN_STATIONS,
  WEATHER_SAMPLE_POINTS,
  fetchRealStationPrecipitationForDate
} from './weatherService';
import {
  MIN_LON,
  MAX_LON,
  MIN_LAT,
  MAX_LAT,
  sampleRealElevationAtLonLat,
  loadRealDemData
} from '../utils/realSulaymaniyahTerrain';

export interface SatelliteCloudAnalysis {
  date: string;
  requestedDate: string;
  sensor: string;
  cloudCoveragePct: number;
  snowCoverPct: number;
  fogCoveragePct: number;
  dustCoveragePct: number;
  hasActiveRain: boolean;
  hasActiveSnow: boolean;
  detectedPixelCount: number;
  peakDensity: number;
  weatherDataTexture: THREE.DataTexture;
  cloudDeckTexture: THREE.CanvasTexture;
  phenomenaTexture: THREE.DataTexture;
  groundPassTexture: THREE.CanvasTexture;
  rawImageSrc: string;
  isTodayPending?: boolean;
  statusNote?: string;
  processedAt: number;
}

const EXTRACT_RES = 1024;
const cloudAnalysisCache = new Map<string, SatelliteCloudAnalysis>();
type CloudUpdateListener = (analysis: SatelliteCloudAnalysis) => void;
const cloudListeners = new Set<CloudUpdateListener>();

interface ReferenceGroundData {
  nasaPixels: Uint8ClampedArray;
  hdPixels: Uint8ClampedArray;
  neighborhoodMaxY: Float32Array;
  neighborhoodMaxB: Float32Array;
  neighborhoodAvgR: Float32Array;
  neighborhoodAvgG: Float32Array;
  neighborhoodAvgB: Float32Array;
}

let cachedRefGround: ReferenceGroundData | null = null;
let refGroundPromise: Promise<ReferenceGroundData | null> | null = null;

function loadImagePixels(url: string, width: number, height: number): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(ctx.getImageData(0, 0, width, height).data);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function loadOptionalImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (isBlankSatelliteImage(img)) {
        resolve(null);
      } else {
        resolve(img);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function loadReferenceGroundData(targetWidth = EXTRACT_RES, targetHeight = EXTRACT_RES): Promise<ReferenceGroundData | null> {
  if (cachedRefGround) return Promise.resolve(cachedRefGround);
  if (refGroundPromise) return refGroundPromise;

  refGroundPromise = (async () => {
    const [nasaPixels, hdPixels] = await Promise.all([
      loadImagePixels('tiles/erbil_map_hd.jpg?v=erbil_map_hd', targetWidth, targetHeight),
      loadImagePixels('tiles/erbil_map_ref.jpg?v=erbil_map_ref', targetWidth, targetHeight)
    ]);

    const primary = nasaPixels || hdPixels;
    const secondary = hdPixels || nasaPixels;
    if (!primary || !secondary) return null;

    const total = targetWidth * targetHeight;
    const neighborhoodMaxY = new Float32Array(total);
    const neighborhoodMaxB = new Float32Array(total);
    const neighborhoodAvgR = new Float32Array(total);
    const neighborhoodAvgG = new Float32Array(total);
    const neighborhoodAvgB = new Float32Array(total);

    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        let maxY = 0;
        let maxB = 0;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let cnt = 0;

        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.min(targetHeight - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(targetWidth - 1, Math.max(0, x + dx));
            const idx = (ny * targetWidth + nx) * 4;

            const rN = primary[idx];
            const gN = primary[idx + 1];
            const bN = primary[idx + 2];
            const yN = 0.299 * rN + 0.587 * gN + 0.114 * bN;

            if (yN > maxY) maxY = yN;
            if (bN > maxB) maxB = bN;
            sumR += rN;
            sumG += gN;
            sumB += bN;
            cnt++;
          }
        }

        const p = y * targetWidth + x;
        neighborhoodMaxY[p] = maxY;
        neighborhoodMaxB[p] = maxB;
        neighborhoodAvgR[p] = sumR / cnt;
        neighborhoodAvgG[p] = sumG / cnt;
        neighborhoodAvgB[p] = sumB / cnt;
      }
    }

    cachedRefGround = {
      nasaPixels: primary,
      hdPixels: secondary,
      neighborhoodMaxY,
      neighborhoodMaxB,
      neighborhoodAvgR,
      neighborhoodAvgG,
      neighborhoodAvgB
    };
    return cachedRefGround;
  })();

  return refGroundPromise;
}

export function subscribeToSatelliteCloudUpdates(listener: CloudUpdateListener): () => void {
  cloudListeners.add(listener);
  return () => {
    cloudListeners.delete(listener);
  };
}

/**
 * Extracts crisp, full-detail 1024x1024 satellite clouds (NO spatial blur soup!)
 * along with Rain (only if raining), Snow, Ground Snow Cover, Fogs, and Dusts.
 */
export function extractCloudsFromSatelliteImage(
  sourceImage: HTMLImageElement | HTMLCanvasElement,
  weatherPayload?: KurdistanWeatherPayload | null,
  radarCanvas?: HTMLCanvasElement | null,
  targetWidth = EXTRACT_RES,
  targetHeight = EXTRACT_RES,
  refGround?: ReferenceGroundData | null,
  precomputedMaskImage?: HTMLImageElement | null,
  secondaryCloudImage?: HTMLImageElement | null,
  dateStationPrecip?: number[] | null
): {
  weatherDataTexture: THREE.DataTexture;
  cloudDeckTexture: THREE.CanvasTexture;
  phenomenaTexture: THREE.DataTexture;
  groundPassTexture: THREE.CanvasTexture;
  coveragePct: number;
  snowCoverPct: number;
  fogCoveragePct: number;
  dustCoveragePct: number;
  hasActiveRain: boolean;
  hasActiveSnow: boolean;
  detectedCount: number;
  peakDensity: number;
} {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  ctx.drawImage(sourceImage, 0, 0, targetWidth, targetHeight);
  const src = ctx.getImageData(0, 0, targetWidth, targetHeight).data;

  // Secondary same-day NASA orbital pass (e.g., MODIS Aqua afternoon pass + VIIRS SNPP pass)
  // Reads more clouds captured across morning/afternoon orbits on the exact same day
  let secData: Uint8ClampedArray | null = null;
  if (secondaryCloudImage) {
    const sCanvas = document.createElement('canvas');
    sCanvas.width = targetWidth;
    sCanvas.height = targetHeight;
    const sCtx = sCanvas.getContext('2d', { willReadFrequently: true });
    if (sCtx) {
      sCtx.drawImage(secondaryCloudImage, 0, 0, targetWidth, targetHeight);
      secData = sCtx.getImageData(0, 0, targetWidth, targetHeight).data;
    }
  }

  // Optional precomputed cloud mask from /tiles/nasa_history/*_clouds.png
  let preMaskData: Uint8ClampedArray | null = null;
  if (precomputedMaskImage) {
    const mCanvas = document.createElement('canvas');
    mCanvas.width = targetWidth;
    mCanvas.height = targetHeight;
    const mCtx = mCanvas.getContext('2d', { willReadFrequently: true });
    if (mCtx) {
      mCtx.drawImage(precomputedMaskImage, 0, 0, targetWidth, targetHeight);
      preMaskData = mCtx.getImageData(0, 0, targetWidth, targetHeight).data;
    }
  }

  // Radar pixel data if available
  let radarData: Uint8ClampedArray | null = null;
  if (radarCanvas) {
    const rCanvas = document.createElement('canvas');
    rCanvas.width = targetWidth;
    rCanvas.height = targetHeight;
    const rCtx = rCanvas.getContext('2d', { willReadFrequently: true });
    if (rCtx) {
      rCtx.drawImage(radarCanvas, 0, 0, targetWidth, targetHeight);
      radarData = rCtx.getImageData(0, 0, targetWidth, targetHeight).data;
    }
  }

  const totalPixels = targetWidth * targetHeight;
  const rawClouds = new Uint8Array(totalPixels);
  const rawCloudAlbedo = new Uint8Array(totalPixels);
  const rawRain = new Uint8Array(totalPixels);
  const rawSnowCover = new Uint8Array(totalPixels);
  const rawFog = new Uint8Array(totalPixels);
  const rawDust = new Uint8Array(totalPixels);

  const stations = weatherPayload?.stations || [];
  const avgTemp = stations[0]?.temperature ?? 24;
  const maxStationPrecip = stations.length > 0 ? Math.max(...stations.map((s) => s.precipitation ?? 0)) : 0;
  const avgHumidity = stations.length > 0 ? stations.reduce((acc, s) => acc + (s.relativeHumidity ?? 45), 0) / stations.length : 45;
  const maxWindSpeed = stations.length > 0 ? Math.max(...stations.map((s) => s.windSpeed ?? 10)) : 12;

  // ---------------------------------------------------------------------------
  // STAGE 0: MACRO-BLOCK MASSIVE BRIGHTNESS / WHITE-FILTER DETECTOR (32x32 grid)
  // Detects satellite swath-edge white filters, overexposed halves, or flat glare
  // so massive brightness is NEVER mistaken for real clouds!
  // ---------------------------------------------------------------------------
  const GRID_N = 32;
  const blockW = Math.floor(targetWidth / GRID_N);
  const blockH = Math.floor(targetHeight / GRID_N);
  const blockBrightFrac = new Float32Array(GRID_N * GRID_N);
  const blockMeanDiffBlue = new Float32Array(GRID_N * GRID_N);
  const blockMeanContrast = new Float32Array(GRID_N * GRID_N);

  for (let by = 0; by < GRID_N; by++) {
    for (let bx = 0; bx < GRID_N; bx++) {
      let brightCount = 0;
      let sumDiffBlue = 0;
      let sumContrast = 0;
      let count = 0;

      const y0 = by * blockH;
      const x0 = bx * blockW;
      for (let py = y0; py < y0 + blockH; py += 2) {
        for (let px = x0; px < x0 + blockW; px += 2) {
          const p = py * targetWidth + px;
          const i = p * 4;
          const r = src[i];
          const g = src[i + 1];
          const b = src[i + 2];
          const y = 0.299 * r + 0.587 * g + 0.114 * b;

          const bRef = refGround ? refGround.neighborhoodMaxB[p] : 110;
          const dBlue = b - bRef;

          // Measure local 3x3 luminance contrast to distinguish textured clouds from flat white filter
          const pRight = py * targetWidth + Math.min(targetWidth - 1, px + 2);
          const pDown = Math.min(targetHeight - 1, py + 2) * targetWidth + px;
          const yRight = 0.299 * src[pRight * 4] + 0.587 * src[pRight * 4 + 1] + 0.114 * src[pRight * 4 + 2];
          const yDown = 0.299 * src[pDown * 4] + 0.587 * src[pDown * 4 + 1] + 0.114 * src[pDown * 4 + 2];
          const localGrad = Math.abs(y - yRight) + Math.abs(y - yDown);

          if ((y > 148 && r - b < 28 && dBlue > 7) || (r > 232 && g > 232 && b > 232)) {
            brightCount++;
          }
          sumDiffBlue += Math.max(0, dBlue);
          sumContrast += localGrad;
          count++;
        }
      }

      const bIdx = by * GRID_N + bx;
      blockBrightFrac[bIdx] = count > 0 ? brightCount / count : 0;
      blockMeanDiffBlue[bIdx] = count > 0 ? sumDiffBlue / count : 0;
      blockMeanContrast[bIdx] = count > 0 ? sumContrast / count : 0;
    }
  }

  // Compute regional white-filter baseline offset for each macro-block (3x3 block neighborhood)
  // If a large region/half of the image (> 38% of pixels across multiple blocks) is uniformly bright,
  // it is a satellite swath white filter / overexposure, NOT a cloud!
  const blockWhiteFilterOffset = new Float32Array(GRID_N * GRID_N);
  const blockIsWhiteFilteredSlab = new Uint8Array(GRID_N * GRID_N);

  for (let by = 0; by < GRID_N; by++) {
    for (let bx = 0; bx < GRID_N; bx++) {
      let nBright = 0;
      let nDiffBlue = 0;
      let nContrast = 0;
      let nCnt = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const nby = Math.min(GRID_N - 1, Math.max(0, by + dy));
        for (let dx = -2; dx <= 2; dx++) {
          const nbx = Math.min(GRID_N - 1, Math.max(0, bx + dx));
          const nbIdx = nby * GRID_N + nbx;
          nBright += blockBrightFrac[nbIdx];
          nDiffBlue += blockMeanDiffBlue[nbIdx];
          nContrast += blockMeanContrast[nbIdx];
          nCnt++;
        }
      }
      const avgRegionBright = nBright / nCnt;
      const avgRegionDiffBlue = nDiffBlue / nCnt;
      const avgRegionContrast = nContrast / nCnt;

      const bIdx = by * GRID_N + bx;
      // Only flag extreme full-half sensor saturation (> 78% of an entire 5x5 block region uniformly saturated)
      if (avgRegionBright > 0.78 && avgRegionContrast < 5.0) {
        blockIsWhiteFilteredSlab[bIdx] = 1;
        blockWhiteFilterOffset[bIdx] = avgRegionDiffBlue * 0.85 + 10.0;
      } else {
        blockWhiteFilterOffset[bIdx] = 0.0;
      }
    }
  }

  // Continuous Physical Cloud Alpha Unmixing against cloudless ground reference:
  // Captures ALL satellite cloud regimes:
  // 1. Huge high-level semi-transparent cloud networks (Cirrus, Cirrostratus, Altostratus webs)
  // 2. Small spread-out cumulus / altocumulus puffs across valleys, ridges, and plains
  // 3. Large thick cumulus, wave clouds, and cumulonimbus formations
  const evaluatePixelCloud = (
    r: number,
    g: number,
    b: number,
    yRefMax: number,
    bRefMax: number,
    rRefAvg: number,
    gRefAvg: number,
    bRefAvg: number,
    localGrad: number,
    whiteFilterOffset: number,
    isWhiteFilteredSlab: boolean
  ): [number, number] => {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const yRefAvg = 0.299 * rRefAvg + 0.587 * gRefAvg + 0.114 * bRefAvg;

    // Reject only pure sensor no-data clipping (RGB >= 250 flat)
    if (r >= 250 && g >= 250 && b >= 250 && localGrad < 1.0) {
      return [0, 0];
    }

    if (isWhiteFilteredSlab && y - yRefMax < whiteFilterOffset + 12) {
      return [0, 0];
    }

    // Compare against true ground average so thin high-level networks and small puffs are never lost
    const diffLum = (y - yRefAvg) - whiteFilterOffset * 0.4;
    const diffBlue = (b - bRefAvg) - whiteFilterOffset * 0.4;
    const diffRed = (r - rRefAvg) - whiteFilterOffset * 0.4;

    const groundWarmth = Math.max(4.0, rRefAvg - bRefAvg);
    const pixelWarmth = Math.max(0.0, r - b);
    // Clouds are neutral white, so even thin high-level cirrus webs reduce the warm ground's (R - B) gap
    const warmthReduction = Math.max(0.0, groundWarmth - pixelWarmth);

    // Reject only pixels that are darker/less blue than bare ground
    if (diffBlue < 1.8 && diffLum < 2.0 && warmthReduction < 2.2) {
      return [0, 0];
    }

    // Reject bare sunlit soil/sand where Red increased much faster than Blue (pixel became warmer than bare ground)
    if (pixelWarmth > groundWarmth + 8.0 && diffRed > diffBlue * 1.25) {
      return [0, 0];
    }
    if (diffRed > diffBlue * 1.45 && pixelWarmth > 28 && diffBlue < 14) {
      return [0, 0];
    }

    // Continuous physical alpha unmixing:
    // Combines Blue excess, Luminance excess, and Warmth whitening so thin high-level networks,
    // small scattered puffs over dark mountains/valleys, and thick clouds are all captured!
    const denomB = Math.max(36.0, 235.0 - bRefAvg);
    const denomY = Math.max(36.0, 238.0 - yRefAvg);
    const alphaBlue = Math.min(1.0, Math.max(0.0, (diffBlue - 1.2) / (denomB * 0.62)));
    const alphaLum  = Math.min(1.0, Math.max(0.0, (diffLum - 1.2) / (denomY * 0.65)));
    const alphaCool = Math.min(1.0, Math.max(0.0, (warmthReduction - 1.5) / Math.max(14.0, groundWarmth * 0.75)));

    // Gently attenuate only if pixel remains nearly as warm as bare desert sand
    const warmthRatio = pixelWarmth / (groundWarmth + 18.0);
    const warmthFade = Math.min(1.0, Math.max(0.18, 1.28 - warmthRatio * 0.72));

    const rawAlpha = Math.max(
      alphaBlue * 0.55 + alphaLum * 0.30 + alphaCool * 0.15,
      Math.min(alphaBlue, alphaCool) * 0.90
    ) * warmthFade;

    if (rawAlpha <= 0.008) {
      return [0, 0];
    }

    // R channel: High-level cloud networks + soft haze + full cloud coverage (boosts thin/small clouds)
    const totalCloudAndHaze = Math.min(255, Math.round(Math.pow(rawAlpha, 0.72) * 248));
    // A channel: Crisp small & large cumulus/wave cores
    const puffyCore = Math.min(255, Math.round(Math.pow(rawAlpha, 0.86) * 252));

    return [totalCloudAndHaze, puffyCore];
  };

  for (let py = 0; py < targetHeight; py++) {
    const v = py / targetHeight;
    const lat = MAX_LAT - v * (MAX_LAT - MIN_LAT);

    for (let px = 0; px < targetWidth; px++) {
      const u = px / targetWidth;
      const lon = MIN_LON + u * (MAX_LON - MIN_LON);
      const p = py * targetWidth + px;
      const i = p * 4;

      const r1 = src[i];
      const g1 = src[i + 1];
      const b1 = src[i + 2];

      let yRef = 135;
      let bRef = 110;
      let rRefAvg = 165;
      let gRefAvg = 142;
      let bRefAvg = 112;

      if (refGround && refGround.neighborhoodMaxY.length === totalPixels) {
        yRef = refGround.neighborhoodMaxY[p];
        bRef = refGround.neighborhoodMaxB[p];
        rRefAvg = refGround.neighborhoodAvgR[p];
        gRefAvg = refGround.neighborhoodAvgG[p];
        bRefAvg = refGround.neighborhoodAvgB[p];
      }

      const bx = Math.min(GRID_N - 1, Math.floor(px / blockW));
      const by = Math.min(GRID_N - 1, Math.floor(py / blockH));
      const bIdx = by * GRID_N + bx;
      const whiteFilterOffset = blockWhiteFilterOffset[bIdx];
      const isWhiteFilteredSlab = blockIsWhiteFilteredSlab[bIdx] === 1;

      const pRight = py * targetWidth + Math.min(targetWidth - 1, px + 2);
      const pDown = Math.min(targetHeight - 1, py + 2) * targetWidth + px;
      const y1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
      const yR = 0.299 * src[pRight * 4] + 0.587 * src[pRight * 4 + 1] + 0.114 * src[pRight * 4 + 2];
      const yD = 0.299 * src[pDown * 4] + 0.587 * src[pDown * 4 + 1] + 0.114 * src[pDown * 4 + 2];
      const localGrad = Math.abs(y1 - yR) + Math.abs(y1 - yD);

      // Evaluate primary verified satellite pass with white-filter protection
      let [cloudVal, cloudAlbedo] = evaluatePixelCloud(
        r1,
        g1,
        b1,
        yRef,
        bRef,
        rRefAvg,
        gRefAvg,
        bRefAvg,
        localGrad,
        whiteFilterOffset,
        isWhiteFilteredSlab
      );

      // Precomputed archive mask support
      if (preMaskData && preMaskData[i] > 15 && r1 - b1 <= 24) {
        const mVal = preMaskData[i];
        if (mVal > cloudVal) {
          cloudVal = mVal;
          cloudAlbedo = Math.max(cloudAlbedo, mVal);
        }
      }

      const y = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
      const maxDiff = Math.max(Math.abs(r1 - g1), Math.abs(g1 - b1), Math.abs(r1 - b1));
      const elevM = sampleRealElevationAtLonLat(lon, lat);
      const localTempC = avgTemp - Math.max(0, elevM - 500) * 0.0065;

      // 2. REAL RAIN RADAR & MEASURED STATION PRECIPITATION ONLY (Zero fake rain on dry clouds!)
      // Strictly uses:
      // (a) Real RainViewer Doppler Radar echoes (radarData)
      // (b) Real Open-Meteo measured precipitation (mm/h) localized to the reporting station
      let rainVal = 0;
      if (radarData) {
        const rAlpha = radarData[i + 3];
        if (rAlpha > 25) {
          const rGreen = radarData[i + 1];
          const rRed = radarData[i];
          rainVal = Math.min(255, Math.round((rAlpha / 255.0) * Math.max(115, Math.max(rGreen, rRed))));
          // Ensure a 3D rain-bearing cloud sits directly above every real radar echo
          cloudVal = Math.max(cloudVal, Math.min(255, 145 + Math.round(rainVal * 0.40)));
          cloudAlbedo = Math.max(cloudAlbedo, 195);
        }
      }

      // Check real local Open-Meteo station precipitation (only within ~35km of a station reporting rain)
      if (cloudVal >= 80) {
        let localPrecipMm = 0;
        let wSum = 0;
        for (let sIdx = 0; sIdx < WEATHER_SAMPLE_POINTS.length; sIdx++) {
          const stMeta = WEATHER_SAMPLE_POINTS[sIdx];
          const stPrecip =
            dateStationPrecip && dateStationPrecip[sIdx] !== undefined
              ? dateStationPrecip[sIdx]
              : (stations[sIdx]?.precipitation ?? 0);

          if (stPrecip >= 0.12) {
            const dLon = lon - stMeta.lon;
            const dLat = lat - stMeta.lat;
            const distSq = dLon * dLon + dLat * dLat;
            if (distSq < 0.14) {
              const w = 1.0 / (distSq + 0.006);
              localPrecipMm += stPrecip * w;
              wSum += w;
            }
          }
        }
        if (wSum > 0) {
          const avgLocalPrecip = localPrecipMm / wSum;
          if (avgLocalPrecip >= 0.12) {
            const stRain = Math.min(245, Math.round((avgLocalPrecip / 4.5) * 215));
            rainVal = Math.max(rainVal, Math.round(stRain * (cloudVal / 255.0)));
          }
        }
      }

      // 3. GROUND SNOW COVER (Strictly when freezing & bright snow albedo is present)
      let snowCoverVal = 0;
      if (elevM > 1800 && localTempC <= 1.5) {
        const isBrightSnow = r1 - b1 <= 16 && y > 185 && b1 > 175 && maxDiff < 12;
        if (isBrightSnow) {
          snowCoverVal = Math.min(255, Math.round(((y - 180) / 65.0) * 245));
        }
      }

      // 4. VALLEY FOG & MIST (Strictly when humid >= 80% and valley mist signature is present)
      let fogVal = 0;
      if (elevM >= 260 && elevM <= 1150 && avgHumidity >= 80) {
        const isValleyMist =
          r1 - b1 <= 18 &&
          y > yRef + 12 &&
          y < 165 &&
          maxDiff < 10 &&
          b1 > bRefAvg + 12;
        if (isValleyMist) {
          fogVal = Math.min(210, Math.round(((avgHumidity - 78) / 22.0) * 190));
        }
      }

      // 5. SUSPENDED DESERT DUST PLUMES (Strictly when warm ochre aerosol jump exists)
      let dustVal = 0;
      if (elevM < 950 && cloudVal < 35) {
        const yRefMean = 0.299 * rRefAvg + 0.587 * gRefAvg + 0.114 * bRefAvg;
        const isDustPlume = (r1 - b1 > 28) && (y - yRefMean > 20) && (r1 - rRefAvg > 20) && maxWindSpeed >= 15;
        if (isDustPlume) {
          const dustFactor = Math.min(1.0, (y - yRefMean - 18) / 35.0);
          dustVal = Math.min(210, Math.round(dustFactor * 195));
        }
      }

      rawClouds[p] = cloudVal;
      rawCloudAlbedo[p] = cloudAlbedo;
      rawRain[p] = rainVal;
      rawSnowCover[p] = snowCoverVal;
      rawFog[p] = fogVal;
      rawDust[p] = dustVal;
    }
  }

  const weatherBytes = new Uint8Array(totalPixels * 4);
  const phenomenaBytes = new Uint8Array(totalPixels * 4);

  const deckCanvas = document.createElement('canvas');
  deckCanvas.width = targetWidth;
  deckCanvas.height = targetHeight;
  const dCtx = deckCanvas.getContext('2d');
  const deckImgData = dCtx ? dCtx.createImageData(targetWidth, targetHeight) : null;
  const deckBytes = deckImgData ? deckImgData.data : null;

  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = targetWidth;
  groundCanvas.height = targetHeight;
  const gCtx = groundCanvas.getContext('2d');
  const groundImgData = gCtx ? gCtx.createImageData(targetWidth, targetHeight) : null;
  const groundBytes = groundImgData ? groundImgData.data : null;

  let cloudPixelCount = 0;
  let snowPixelCount = 0;
  let fogPixelCount = 0;
  let dustPixelCount = 0;
  let rainPixelCount = 0;
  let fallingSnowPixelCount = 0;
  let peakDensity = 0;

  // Apply a separable 2-pass radial feathering envelope (radius 4) to R channel so cloud edges
  // have smooth, gradual atmospheric transitions (zero jagged pixel steps), while keeping wave ripples in A
  const tempHoriz = new Float32Array(totalPixels);
  const featheredClouds = new Float32Array(totalPixels);
  const kernelRadius = 4;

  for (let py = 0; py < targetHeight; py++) {
    const rowOffset = py * targetWidth;
    for (let px = 0; px < targetWidth; px++) {
      let sum = 0;
      let wSum = 0;
      for (let dx = -kernelRadius; dx <= kernelRadius; dx++) {
        const nx = Math.min(targetWidth - 1, Math.max(0, px + dx));
        const w = kernelRadius + 1 - Math.abs(dx);
        sum += rawClouds[rowOffset + nx] * w;
        wSum += w;
      }
      tempHoriz[rowOffset + px] = sum / wSum;
    }
  }

  for (let py = 0; py < targetHeight; py++) {
    for (let px = 0; px < targetWidth; px++) {
      let sum = 0;
      let wSum = 0;
      for (let dy = -kernelRadius; dy <= kernelRadius; dy++) {
        const ny = Math.min(targetHeight - 1, Math.max(0, py + dy));
        const w = kernelRadius + 1 - Math.abs(dy);
        sum += tempHoriz[ny * targetWidth + px] * w;
        wSum += w;
      }
      featheredClouds[py * targetWidth + px] = sum / wSum;
    }
  }

  for (let py = 0; py < targetHeight; py++) {
    const v = py / targetHeight;
    const lat = MAX_LAT - v * (MAX_LAT - MIN_LAT);

    for (let px = 0; px < targetWidth; px++) {
      const u = px / targetWidth;
      const lon = MIN_LON + u * (MAX_LON - MIN_LON);
      const p = py * targetWidth + px;
      const i = p * 4;

      const cSmooth = featheredClouds[p];
      const cRaw = rawClouds[p];
      let finalCloud = 0;
      let finalAlbedo = rawCloudAlbedo[p];

      if (cSmooth > 1.5 || cRaw > 3) {
        // Preserve 90% of cRaw peak so small spread-out clouds (1-4 px) and thin high-level
        // cloud networks are never diluted by the 9x9 smoothing kernel, while still keeping soft edges!
        finalCloud = Math.min(
          255,
          Math.round(Math.max(cRaw * 0.90, cSmooth * 0.65 + cRaw * 0.35))
        );
        finalAlbedo = Math.min(
          255,
          Math.round(Math.max(finalAlbedo * 0.92, cSmooth * 0.40 + finalAlbedo * 0.60))
        );
      }

      const elevM = sampleRealElevationAtLonLat(lon, lat);
      const localTempC = avgTemp - Math.max(0, elevM - 500) * 0.0065;

      // Ensure rain only occurs where real Rain Radar / Open-Meteo precipitation exists AND a cloud sits above it
      const finalRain = rawRain[p];
      if (finalRain > 12 && finalCloud < 90) {
        finalCloud = Math.max(finalCloud, Math.min(255, 115 + Math.round(finalRain * 0.42)));
        finalAlbedo = Math.max(finalAlbedo, finalCloud);
      }

      const finalSnowCover = rawSnowCover[p];
      const finalFog = rawFog[p];
      const finalDust = rawDust[p];

      if (finalCloud > 20) {
        cloudPixelCount++;
        if (finalCloud > peakDensity) peakDensity = finalCloud;
      }
      if (finalSnowCover > 30) snowPixelCount++;
      if (finalFog > 25) fogPixelCount++;
      if (finalDust > 25) dustPixelCount++;
      if (finalRain > 12) {
        if (localTempC <= 2.5) {
          fallingSnowPixelCount++;
        } else {
          rainPixelCount++;
        }
      }

      // 1. Weather Data Texture (R: Crisp Cloud Optical Depth, G: Rain/Snow Precip, B: Local Temp, A: Cloud Top Albedo)
      weatherBytes[i] = finalCloud;
      weatherBytes[i + 1] = finalRain;
      weatherBytes[i + 2] = Math.round(Math.min(1.0, Math.max(0.0, (localTempC + 5.0) / 47.0)) * 255);
      weatherBytes[i + 3] = finalCloud > 0 ? Math.max(finalCloud, finalAlbedo) : 0;

      // 2. Phenomena Texture (R: Ground Snow Cover, G: Valley Fog, B: Suspended Dust, A: Cloud Shadow Mask)
      phenomenaBytes[i] = finalSnowCover;
      phenomenaBytes[i + 1] = finalFog;
      phenomenaBytes[i + 2] = finalDust;
      phenomenaBytes[i + 3] = finalCloud;

      // 3. Cloud Deck Canvas (for 2D modal inspection)
      if (deckBytes) {
        deckBytes[i] = 255;
        deckBytes[i + 1] = 255;
        deckBytes[i + 2] = 255;
        deckBytes[i + 3] = finalCloud;
      }

      // 4. HD Base Ground Texture
      if (groundBytes) {
        const baseArr = refGround?.hdPixels || src;
        groundBytes[i] = baseArr[i];
        groundBytes[i + 1] = baseArr[i + 1];
        groundBytes[i + 2] = baseArr[i + 2];
        groundBytes[i + 3] = 255;
      }
    }
  }

  const weatherDataTexture = new THREE.DataTexture(
    weatherBytes,
    targetWidth,
    targetHeight,
    THREE.RGBAFormat
  );
  weatherDataTexture.needsUpdate = true;
  weatherDataTexture.minFilter = THREE.LinearFilter;
  weatherDataTexture.magFilter = THREE.LinearFilter;
  weatherDataTexture.wrapS = THREE.ClampToEdgeWrapping;
  weatherDataTexture.wrapT = THREE.ClampToEdgeWrapping;

  const phenomenaTexture = new THREE.DataTexture(
    phenomenaBytes,
    targetWidth,
    targetHeight,
    THREE.RGBAFormat
  );
  phenomenaTexture.needsUpdate = true;
  phenomenaTexture.minFilter = THREE.LinearFilter;
  phenomenaTexture.magFilter = THREE.LinearFilter;
  phenomenaTexture.wrapS = THREE.ClampToEdgeWrapping;
  phenomenaTexture.wrapT = THREE.ClampToEdgeWrapping;

  if (deckImgData && dCtx) {
    dCtx.putImageData(deckImgData, 0, 0);
  }
  const cloudDeckTexture = new THREE.CanvasTexture(deckCanvas);
  cloudDeckTexture.colorSpace = THREE.SRGBColorSpace;
  cloudDeckTexture.needsUpdate = true;
  cloudDeckTexture.wrapS = THREE.ClampToEdgeWrapping;
  cloudDeckTexture.wrapT = THREE.ClampToEdgeWrapping;

  if (groundImgData && gCtx) {
    gCtx.putImageData(groundImgData, 0, 0);
  }
  const groundPassTexture = new THREE.CanvasTexture(groundCanvas);
  groundPassTexture.colorSpace = THREE.SRGBColorSpace;
  groundPassTexture.anisotropy = 16;
  groundPassTexture.needsUpdate = true;
  groundPassTexture.wrapS = THREE.ClampToEdgeWrapping;
  groundPassTexture.wrapT = THREE.ClampToEdgeWrapping;

  const coveragePct = Math.round((cloudPixelCount / totalPixels) * 1000) / 10;
  const snowCoverPct = Math.round((snowPixelCount / totalPixels) * 1000) / 10;
  const fogCoveragePct = Math.round((fogPixelCount / totalPixels) * 1000) / 10;
  const dustCoveragePct = Math.round((dustPixelCount / totalPixels) * 1000) / 10;

  return {
    weatherDataTexture,
    cloudDeckTexture,
    phenomenaTexture,
    groundPassTexture,
    coveragePct,
    snowCoverPct,
    fogCoveragePct,
    dustCoveragePct,
    hasActiveRain: rainPixelCount > 25,
    hasActiveSnow: fallingSnowPixelCount > 15,
    detectedCount: cloudPixelCount,
    peakDensity
  };
}

// Simple deterministic 2D fractal cellular hash for crisp live station cumulus cells (zero soup)
function hash2D(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Live cloud texture for the EUMETSAT mode.
 *
 * Cloud comes ONLY from the EUMETSAT Cloud Mask and rain ONLY from the EUMETSAT h63
 * precipitation estimate. There is deliberately no procedural cloud generation here.
 */
export function buildCombinedLiveWeatherAndCloudTexture(
  weatherPayload: KurdistanWeatherPayload,
  liveIrCanvas?: HTMLCanvasElement | null,
  liveRadarCanvas?: HTMLCanvasElement | null,
  size = 1024
): {
  weatherDataTexture: THREE.DataTexture;
  cloudDeckTexture: THREE.CanvasTexture;
  phenomenaTexture: THREE.DataTexture;
  liveCoveragePct: number;
  hasLivePrecipitation: boolean;
} {
  const data = new Uint8Array(size * size * 4);
  const phenomData = new Uint8Array(size * size * 4);

  const deckCanvas = document.createElement('canvas');
  deckCanvas.width = size;
  deckCanvas.height = size;
  const dCtx = deckCanvas.getContext('2d');
  const deckImgData = dCtx ? dCtx.createImageData(size, size) : null;
  const deckBytes = deckImgData ? deckImgData.data : null;

  let irData: Uint8ClampedArray | null = null;
  if (liveIrCanvas) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(liveIrCanvas, 0, 0, size, size);
      irData = ctx.getImageData(0, 0, size, size).data;
    }
  }

  let radarData: Uint8ClampedArray | null = null;
  if (liveRadarCanvas) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(liveRadarCanvas, 0, 0, size, size);
      radarData = ctx.getImageData(0, 0, size, size).data;
    }
  }

  const hourIdx = weatherPayload ? weatherPayload.currentHourIndex : 0;
  let cloudPixels = 0;
  let precipPixels = 0;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const lat = MAX_LAT - v * (MAX_LAT - MIN_LAT);
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const lon = MIN_LON + u * (MAX_LON - MIN_LON);
      const idx = (y * size + x) * 4;

      const elevM = sampleRealElevationAtLonLat(lon, lat);

      // 1. Cloud density from the EUMETSAT Cloud Mask. eumetsatService has already decoded
      //    the mask palette into a 0..255 density (white cloud -> 255, clear -> 0), so this
      //    is a direct read — no IR-luminance reinterpretation.
      const maskCloud = irData ? irData[idx] : 0;

      // 2. Live RainViewer Doppler Radar echo
      let radarRain = 0;
      if (radarData) {
        const rAlpha = radarData[idx + 3];
        if (rAlpha > 35) {
          radarRain = Math.min(255, Math.round((rAlpha / 255.0) * Math.max(135, radarData[idx + 1])));
        }
      }

      // 3. Live Open-Meteo 9-Station Interpolation across Kurdistan
      let weightedCloud = 0;
      let weightedPrecip = 0;
      let weightedTemp = 24;
      let weightedHumidity = 35;
      let weightedWind = 10;
      let totalWeight = 0;

      if (weatherPayload?.stations?.length) {
        weatherPayload.stations.forEach((st, sIdx) => {
          const meta = WEATHER_SAMPLE_POINTS[sIdx] || KURDISTAN_STATIONS[0];
          const stU = (meta.lon - MIN_LON) / (MAX_LON - MIN_LON);
          const stV = (MAX_LAT - meta.lat) / (MAX_LAT - MIN_LAT);

          const dx = u - stU;
          const dy = v - stV;
          const d2 = dx * dx + dy * dy + 0.008;
          const weight = 1.0 / d2;

          // Read live cloud cover, plus any daytime convective peak in the current 24h window
          const liveC = (weatherPayload.hourly.cloudCovers[sIdx]?.[hourIdx] ?? st.cloudCover) / 100.0;
          const sPrecip = weatherPayload.hourly.precipitations[sIdx]?.[hourIdx] ?? st.precipitation;
          const sTemp = weatherPayload.hourly.temperatures[sIdx]?.[hourIdx] ?? st.temperature;
          const sHum = st.relativeHumidity ?? 35;
          const sWind = weatherPayload.hourly.windSpeeds?.[sIdx]?.[hourIdx] ?? st.windSpeed ?? 10;

          weightedCloud += liveC * weight;
          weightedPrecip += sPrecip * weight;
          weightedTemp += sTemp * weight;
          weightedHumidity += sHum * weight;
          weightedWind += sWind * weight;
          totalWeight += weight;
        });

        weightedCloud /= totalWeight;
        weightedPrecip /= totalWeight;
        weightedTemp /= totalWeight;
        weightedHumidity /= totalWeight;
        weightedWind /= totalWeight;
      }

      const localTempC = weightedTemp - Math.max(0, elevM - 500) * 0.0065;

      // CLOUD — strictly the EUMETSAT Cloud Mask, nothing else.
      //
      // This used to be Math.max(irCloud, stationCloudByte, rain-derived), where
      // stationCloudByte was an FBM noise field shaped by Open-Meteo station cloud cover plus
      // an elevation-driven orographic term. That synthesized cloud out of thin air, so the
      // Live sky showed cloud even where the satellite reported clear — and it kept doing so
      // on hardcoded fallback values whenever the weather fetch failed.
      const finalCloud = maskCloud;

      // RAIN — the EUMETSAT h63 precipitation estimate only.
      const finalRain = radarRain;

      if (finalCloud > 25) cloudPixels++;
      if (finalRain > 12) precipPixels++;

      data[idx] = finalCloud;
      data[idx + 1] = finalRain;
      data[idx + 2] = Math.round(Math.min(1.0, Math.max(0.0, (localTempC + 5.0) / 47.0)) * 255);
      data[idx + 3] = finalCloud;

      // Live Phenomena (R: Snow Cover if freezing, G: Fog if humid >= 80%, B: Dust if windy & dry, A: Cloud Shadow)
      const liveSnow =
        elevM > 1800 && localTempC <= 1.5 && weightedHumidity > 50
          ? Math.min(255, Math.round(((elevM - 1800) / 1400.0) * 235))
          : 0;
      const liveFog =
        elevM >= 260 && elevM <= 1150 && weightedHumidity >= 80
          ? Math.min(210, Math.round(((weightedHumidity - 78) / 22.0) * 190))
          : 0;
      const liveDust =
        elevM < 900 && weightedWind >= 18 && weightedHumidity < 32
          ? Math.min(210, Math.round(((weightedWind - 17) / 18.0) * 185))
          : 0;

      phenomData[idx] = liveSnow;
      phenomData[idx + 1] = liveFog;
      phenomData[idx + 2] = liveDust;
      phenomData[idx + 3] = finalCloud;

      if (deckBytes) {
        deckBytes[idx] = 255;
        deckBytes[idx + 1] = 255;
        deckBytes[idx + 2] = 255;
        deckBytes[idx + 3] = finalCloud;
      }
    }
  }

  const weatherDataTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  weatherDataTexture.needsUpdate = true;
  weatherDataTexture.minFilter = THREE.LinearFilter;
  weatherDataTexture.magFilter = THREE.LinearFilter;
  weatherDataTexture.wrapS = THREE.ClampToEdgeWrapping;
  weatherDataTexture.wrapT = THREE.ClampToEdgeWrapping;

  const phenomenaTexture = new THREE.DataTexture(phenomenaDataOrEmpty(phenomData), size, size, THREE.RGBAFormat);
  phenomenaTexture.needsUpdate = true;
  phenomenaTexture.minFilter = THREE.LinearFilter;
  phenomenaTexture.magFilter = THREE.LinearFilter;
  phenomenaTexture.wrapS = THREE.ClampToEdgeWrapping;
  phenomenaTexture.wrapT = THREE.ClampToEdgeWrapping;

  if (deckImgData && dCtx) {
    dCtx.putImageData(deckImgData, 0, 0);
  }
  const cloudDeckTexture = new THREE.CanvasTexture(deckCanvas);
  cloudDeckTexture.colorSpace = THREE.SRGBColorSpace;
  cloudDeckTexture.needsUpdate = true;

  const liveCoveragePct = Math.round((cloudPixels / (size * size)) * 1000) / 10;

  return {
    weatherDataTexture,
    cloudDeckTexture,
    phenomenaTexture,
    liveCoveragePct,
    hasLivePrecipitation: precipPixels > 25
  };
}

function phenomenaDataOrEmpty(arr: Uint8Array): Uint8Array {
  return arr;
}

/**
 * Loads NASA satellite orbital passes for Today, Yesterday, or any historical date at 1024x1024 resolution.
 * Uses satResult.actualDate for the complementary sensor pass so Today and Yesterday never mix!
 */
export async function loadLiveSatelliteCloudPass(
  date = getTodayDateIso(0),
  sensor = 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
  weatherPayload?: KurdistanWeatherPayload | null
): Promise<SatelliteCloudAnalysis | null> {
  const cacheKey = `${sensor}_${date}_1024_v7_all_clouds`;
  if (cloudAnalysisCache.has(cacheKey)) {
    return cloudAnalysisCache.get(cacheKey)!;
  }

  try {
    await loadRealDemData();

    let radarCanvas: HTMLCanvasElement | null = null;
    if (date === getTodayDateIso(0)) {
      const radarMeta = await fetchRainViewerMetadata();
      if (radarMeta) {
        radarCanvas = await createRainViewerRadarCanvas(radarMeta);
      }
    }

    // 1. Resolve the verified, non-white-filtered NASA pass for the requested date
    const [satResult, refGround] = await Promise.all([
      loadRobustSatelliteImage(sensor, date),
      loadReferenceGroundData(EXTRACT_RES, EXTRACT_RES)
    ]);

    const satImg = satResult.image;

    // Fetch real measured Open-Meteo precipitation for the actual satellite pass date
    const dateStationPrecip = await fetchRealStationPrecipitationForDate(satResult.actualDate);

    const result = extractCloudsFromSatelliteImage(
      satImg,
      weatherPayload,
      radarCanvas,
      EXTRACT_RES,
      EXTRACT_RES,
      refGround,
      null,
      null,
      dateStationPrecip
    );

    const analysis: SatelliteCloudAnalysis = {
      date: satResult.actualDate,
      requestedDate: date,
      sensor,
      cloudCoveragePct: result.coveragePct,
      snowCoverPct: result.snowCoverPct,
      fogCoveragePct: result.fogCoveragePct,
      dustCoveragePct: result.dustCoveragePct,
      hasActiveRain: result.hasActiveRain,
      hasActiveSnow: result.hasActiveSnow,
      detectedPixelCount: result.detectedCount,
      peakDensity: result.peakDensity,
      weatherDataTexture: result.weatherDataTexture,
      cloudDeckTexture: result.cloudDeckTexture,
      phenomenaTexture: result.phenomenaTexture,
      groundPassTexture: result.groundPassTexture,
      rawImageSrc: satResult.src,
      isTodayPending: satResult.isTodayPending,
      statusNote: satResult.statusNote,
      processedAt: Date.now()
    };

    cloudAnalysisCache.set(cacheKey, analysis);

    cloudListeners.forEach((fn) => {
      try {
        fn(analysis);
      } catch (e) {
        console.error('Error in cloud update listener:', e);
      }
    });

    return analysis;
  } catch (err) {
    console.error('Failed to load and process satellite cloud pass:', err);
    return null;
  }
}
