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
import { NorthVietnamWeatherPayload, KURDISTAN_STATIONS } from './weatherService';
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
      loadImagePixels('/tiles/nasa_history/2026-09-15.jpg?v=kurdistan_ref', targetWidth, targetHeight),
      loadImagePixels('/tiles/north_iraq_hd_satellite.jpg?v=kurdistan_hd', targetWidth, targetHeight)
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
  weatherPayload?: NorthVietnamWeatherPayload | null,
  radarCanvas?: HTMLCanvasElement | null,
  targetWidth = EXTRACT_RES,
  targetHeight = EXTRACT_RES,
  refGround?: ReferenceGroundData | null,
  precomputedMaskImage?: HTMLImageElement | null,
  secondaryCloudImage?: HTMLImageElement | null
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
  const avgHumidity = stations.length > 0 ? stations.reduce((acc, s) => acc + (s.humidity ?? 45), 0) / stations.length : 45;
  const maxWindSpeed = stations.length > 0 ? Math.max(...stations.map((s) => s.windSpeed ?? 10)) : 12;

  // Helper to evaluate both Satellite Haze (R) and Puffy Cumulus Core (A) for a pixel against ground reference
  const evaluatePixelCloud = (
    r: number,
    g: number,
    b: number,
    yRef: number,
    bRef: number,
    rRefAvg: number,
    bRefAvg: number
  ): [number, number] => {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const diffLum = y - yRef;
    const diffBlue = b - bRef;
    const groundWarmth = rRefAvg - bRefAvg;
    const pixelWarmth = r - b;
    const warmthReduction = groundWarmth - pixelWarmth;

    // 1. Bright Puffy Cumulus / Convective Cores (White, optically thick satellite clouds)
    const isWhiteCloud =
      pixelWarmth <= 24 &&
      g - b <= 22 &&
      b >= 114 &&
      y >= 122 &&
      diffBlue >= 8 &&
      diffLum >= 7;

    // 2. Thin / Translucent Satellite Cloud Haze & Veil over Terrain or Mountains
    // Captures the soft atmospheric haze and semi-transparent cloud sheets visible in satellite imagery
    const isSatelliteHaze =
      pixelWarmth <= 38 &&
      b >= 98 &&
      y >= 108 &&
      diffBlue >= 6 &&
      diffLum >= 5 &&
      (warmthReduction >= 5 || pixelWarmth <= 20) &&
      b - bRefAvg >= (r - rRefAvg) * 0.72;

    if (!isWhiteCloud && !isSatelliteHaze) {
      return [0, 0];
    }

    // Haze + Cloud Optical Depth (R channel): captures both soft hazy veils and dense clouds
    const jumpStrength = Math.min(1.0, Math.max(0.0, (diffBlue - 5.0) / 48.0));
    const lumStrength = Math.min(1.0, Math.max(0.0, (y - 106.0) / 118.0));
    const neutrality = Math.min(1.0, Math.max(0.28, 1.0 - Math.max(0, pixelWarmth - 4.0) / 40.0));
    const totalCloudAndHaze = Math.min(
      255,
      Math.round(Math.pow(jumpStrength * 0.55 + lumStrength * 0.45, 0.72) * neutrality * 255)
    );

    // Puffy Core Strength (A channel): concentrated in the brighter, whiter cumulus nuclei
    let puffyCore = 0;
    if (diffBlue >= 9 && y >= 124 && pixelWarmth <= 28) {
      const coreJump = Math.min(1.0, Math.max(0.0, (diffBlue - 8.0) / 42.0));
      const coreLum = Math.min(1.0, Math.max(0.0, (y - 120.0) / 105.0));
      const coreNeutral = Math.min(1.0, Math.max(0.2, 1.0 - Math.max(0, pixelWarmth) / 30.0));
      puffyCore = Math.min(255, Math.round(Math.pow(coreJump * 0.5 + coreLum * 0.5, 0.80) * coreNeutral * 255));
    }

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

      // Evaluate primary satellite pass
      let [cloudVal, cloudAlbedo] = evaluatePixelCloud(r1, g1, b1, yRef, bRef, rRefAvg, bRefAvg);

      // Also read clouds from secondary same-day NASA sensor pass (e.g. MODIS Aqua + VIIRS)
      if (secData) {
        const [c2, a2] = evaluatePixelCloud(
          secData[i],
          secData[i + 1],
          secData[i + 2],
          yRef,
          bRef,
          rRefAvg,
          bRefAvg
        );
        if (c2 > cloudVal) {
          cloudVal = c2;
          cloudAlbedo = a2;
        }
      }

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

      // 2. STRICT RAIN DETECTION (ONLY if it is actually raining!)
      let rainVal = 0;
      if (radarData) {
        const rAlpha = radarData[i + 3];
        if (rAlpha > 40) {
          const rGreen = radarData[i + 1];
          rainVal = Math.min(255, Math.round((rAlpha / 255.0) * Math.max(130, rGreen)));
          cloudVal = Math.max(cloudVal, Math.min(255, 160 + Math.round(rainVal * 0.35)));
          cloudAlbedo = Math.max(cloudAlbedo, 210);
        }
      }
      if (maxStationPrecip > 0.15 && cloudVal > 110) {
        const stRain = Math.min(255, Math.round((maxStationPrecip / 6.0) * 220));
        rainVal = Math.max(rainVal, Math.round(stRain * (cloudVal / 255.0)));
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

  // Despeckle only isolated 1-pixel sensor noise while keeping 100% of crisp satellite cloud structure!
  for (let py = 0; py < targetHeight; py++) {
    const v = py / targetHeight;
    const lat = MAX_LAT - v * (MAX_LAT - MIN_LAT);

    for (let px = 0; px < targetWidth; px++) {
      const u = px / targetWidth;
      const lon = MIN_LON + u * (MAX_LON - MIN_LON);
      const p = py * targetWidth + px;
      const i = p * 4;

      const cCenter = rawClouds[p];
      let finalCloud = 0;
      let finalAlbedo = rawCloudAlbedo[p];

      if (cCenter > 10) {
        // Compute 5x5 soft satellite haze halo + 3x3 puffy core continuity
        let activeN = 0;
        let coreSum = 0;
        let hazeSum = 0;
        let hazeWeight = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = Math.min(targetHeight - 1, Math.max(0, py + dy));
          for (let dx = -2; dx <= 2; dx++) {
            const nx = Math.min(targetWidth - 1, Math.max(0, px + dx));
            const nv = rawClouds[ny * targetWidth + nx];
            const na = rawCloudAlbedo[ny * targetWidth + nx];
            const w = 3 - Math.max(Math.abs(dx), Math.abs(dy));
            hazeSum += nv * w;
            hazeWeight += w;
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
              if (nv > 12) activeN++;
              coreSum += na;
            }
          }
        }
        if (activeN >= 2) {
          const haloHaze = hazeSum / hazeWeight;
          // R channel carries both the cloud and its soft satellite haze aureole
          finalCloud = Math.min(255, Math.round(Math.max(cCenter * 0.82 + haloHaze * 0.18, haloHaze * 0.72)));
          // A channel carries the crisp puffy cumulus core strength
          finalAlbedo = Math.min(255, Math.round(finalAlbedo * 0.75 + (coreSum / 9.0) * 0.25));
        }
      }

      const elevM = sampleRealElevationAtLonLat(lon, lat);
      const localTempC = avgTemp - Math.max(0, elevM - 500) * 0.0065;

      const finalRain = rawRain[p];
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
      if (finalRain > 25) {
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

function fbmLiveCloud2D(u: number, v: number): number {
  let val = 0.0;
  let amp = 0.52;
  let freq = 14.0;
  for (let o = 0; o < 5; o++) {
    const n = valueNoise2D(u * freq, v * freq);
    const ridge = 1.0 - Math.abs(n * 2.0 - 1.0);
    val += (n * 0.45 + ridge * ridge * 0.55) * amp;
    freq *= 2.15;
    amp *= 0.48;
  }
  return val;
}

/**
 * Builds a dedicated Live Clouds & Weather texture for 'radar_live' (Live Radar & Met mode)
 * from live Open-Meteo 9-station meteorology, live RainViewer geostationary IR clouds,
 * and live RainViewer Doppler radar echoes — completely distinct from NASA Today & Yesterday.
 */
export function buildCombinedLiveWeatherAndCloudTexture(
  weatherPayload: NorthVietnamWeatherPayload,
  liveIrCanvas?: HTMLCanvasElement | null,
  liveRadarCanvas?: HTMLCanvasElement | null,
  size = 512
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

      // 1. Live RainViewer Geostationary Infrared Cloud pixel (if available)
      let irCloud = 0;
      if (irData) {
        const irAlpha = irData[idx + 3];
        const irLum = 0.299 * irData[idx] + 0.587 * irData[idx + 1] + 0.114 * irData[idx + 2];
        if (irAlpha > 25 && irLum > 90) {
          irCloud = Math.min(255, Math.round(((irLum - 85) / 160.0) * (irAlpha / 255.0) * 255));
        }
      }

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
          const meta = KURDISTAN_STATIONS[sIdx] || KURDISTAN_STATIONS[0];
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
          const sHum = weatherPayload.hourly.humidities?.[sIdx]?.[hourIdx] ?? st.humidity ?? 35;
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

      // Orographic mountain thermal uplift along Zagros peaks + live station cloud cover
      const orographicFactor = elevM > 1350 ? Math.min(0.28, ((elevM - 1350) / 2200.0) * 0.28) : 0.0;
      const effectiveLiveCloudTarget = Math.max(weightedCloud, orographicFactor * (weightedHumidity / 45.0));

      let stationCloudByte = 0;
      if (effectiveLiveCloudTarget > 0.015) {
        const fbm = fbmLiveCloud2D(u + 0.37, v + 0.61);
        const cutoff = Math.max(0.32, 0.66 - effectiveLiveCloudTarget * 0.58);
        if (fbm > cutoff) {
          const norm = Math.min(1.0, (fbm - cutoff) / (1.0 - cutoff));
          stationCloudByte = Math.min(255, Math.round(Math.pow(norm, 0.75) * 245));
        }
      }

      const finalCloud = Math.max(
        irCloud,
        stationCloudByte,
        radarRain > 20 ? Math.min(255, 165 + Math.round(radarRain * 0.35)) : 0
      );

      const stationRainByte =
        weightedPrecip > 0.12 && finalCloud > 90
          ? Math.min(255, Math.round(((weightedPrecip - 0.1) / 5.5) * 255))
          : 0;
      const finalRain = Math.max(radarRain, stationRainByte);

      if (finalCloud > 25) cloudPixels++;
      if (finalRain > 25) precipPixels++;

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
  weatherPayload?: NorthVietnamWeatherPayload | null
): Promise<SatelliteCloudAnalysis | null> {
  const cacheKey = `${sensor}_${date}_1024_v2`;
  if (cloudAnalysisCache.has(cacheKey)) {
    return cloudAnalysisCache.get(cacheKey)!;
  }

  try {
    await loadRealDemData();

    // 1. First resolve the exact NASA pass for the requested date (Today vs Yesterday are guaranteed distinct)
    const [satResult, refGround] = await Promise.all([
      loadRobustSatelliteImage(sensor, date),
      loadReferenceGroundData(EXTRACT_RES, EXTRACT_RES)
    ]);

    const satImg = satResult.image;
    const actualPassDate = satResult.actualDate;

    // 2. Load the complementary sensor pass for that EXACT actualPassDate (e.g., 2026-09-26 for Today, 2026-09-25 for Yesterday)
    let secondaryPassImg: HTMLImageElement | null = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(actualPassDate)) {
      const secondarySensor =
        sensor === 'MODIS_Aqua_CorrectedReflectance_TrueColor'
          ? 'VIIRS_SNPP_CorrectedReflectance_TrueColor'
          : 'MODIS_Aqua_CorrectedReflectance_TrueColor';
      const secondaryWmsUrl = getNasaGibsWmsUrl(secondarySensor, actualPassDate, 1280, 1024);
      secondaryPassImg = await loadOptionalImage(secondaryWmsUrl);
    }

    let preMaskImg: HTMLImageElement | null = null;
    const matchHistory = satResult.src.match(/\/tiles\/nasa_history\/(\d{4}-\d{2}-\d{2})\.jpg/);
    if (matchHistory) {
      preMaskImg = await loadOptionalImage(`/tiles/nasa_history/${matchHistory[1]}_clouds.png`);
    }

    const result = extractCloudsFromSatelliteImage(
      satImg,
      weatherPayload,
      null,
      EXTRACT_RES,
      EXTRACT_RES,
      refGround,
      preMaskImg,
      secondaryPassImg
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
