/**
 * EUMETSAT (Meteosat IODC) derived products for the Live mode.
 *
 * We use EUMETSAT's OWN derived products rather than interpreting raw channels ourselves:
 *
 *  - `msg_iodc:clm`  Cloud Mask — a per-pixel classification produced by EUMETSAT's
 *                    multi-channel detection algorithm. Rendered as white = cloud,
 *                    green = clear land, blue = clear sea. Because cloud is the only
 *                    white class, `min(R,G,B)` is an exact cloud discriminator
 *                    (white -> 255, green/blue -> 0 ); the WMS antialiasing even gives
 *                    soft edges for free.
 *  - `msg_iodc:h63`  Precipitation estimate (IR + microwave blend) — the closest thing
 *                    to a radar rain map, transparent where it is dry. Feeds rain.
 *
 * Every request carries an explicit WMS `TIME`, so each frame has a known timestamp and the
 * UI can state exactly which observation it is showing.
 */
import { MIN_LON, MAX_LON, MIN_LAT, MAX_LAT } from '../utils/realSulaymaniyahTerrain';

const EUMETVIEW_WMS = 'https://view.eumetsat.int/geoserver/wms';

const CLOUD_MASK_LAYER = 'msg_iodc:clm';
const PRECIP_LAYER = 'msg_iodc:h63';

/** Cloud density above which a pixel counts toward the reported cloud-cover percentage. */
const CLOUD_COVER_DENSITY = 0.5;

/**
 * Blur radius (texture pixels) applied to the cloud mask before decoding.
 *
 * The mask is a HARD BINARY classification at the satellite's ~3 km pixel size, so its class
 * boundaries land on the map as blocky rectangular edges. Softening them first turns those
 * steps into gradients, and the volumetric cloud resolves soft edges instead of cut-outs.
 */
const MASK_BLUR_PX = 3;

/** IODC products are published every 15 minutes. */
const FRAME_INTERVAL_MS = 15 * 60 * 1000;
/**
 * The newest frame is NOT immediately downloadable — asking for "now" returns an empty body.
 * Start 30 minutes back and walk older until one actually loads.
 */
const PUBLISH_LATENCY_MINUTES = 30;

export interface EumetsatCloudResult {
  /** Grayscale cloud density from the EUMETSAT Cloud Mask (white = cloud). */
  cloudCanvas: HTMLCanvasElement;
  /** Precipitation estimate canvas (RGBA, transparent where dry), or null if unavailable. */
  precipCanvas: HTMLCanvasElement | null;
  /** Cloud cover as a percentage (0..100). */
  cloudCoveragePct: number;
  /** The exact frame timestamp that was requested and successfully loaded. */
  frameTime: Date;
}

function snapToFrame(ms: number): number {
  return Math.floor(ms / FRAME_INTERVAL_MS) * FRAME_INTERVAL_MS;
}

/** Candidate frame times, newest first. */
function candidateFrameTimes(count = 5): Date[] {
  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    const offsetMs = (PUBLISH_LATENCY_MINUTES + i * 15) * 60 * 1000;
    times.push(new Date(snapToFrame(Date.now() - offsetMs)));
  }
  return times;
}

function buildWmsUrl(layer: string, frameTime: Date, width = 1024, height = 1024): string {
  // WMS 1.3.0 + EPSG:4326 → axis order is lat,lon: minLat,minLon,maxLat,maxLon.
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: layer,
    bbox: `${MIN_LAT},${MIN_LON},${MAX_LAT},${MAX_LON}`,
    width: String(width),
    height: String(height),
    crs: 'EPSG:4326',
    format: 'image/png',
    // Explicit observation time → known provenance.
    time: frameTime.toISOString()
  });
  return `${EUMETVIEW_WMS}?${params.toString()}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('EUMETSAT layer unavailable'));
    img.src = url;
  });
}

function toCanvas(img: HTMLImageElement, willRead: boolean, blurPx = 0): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', willRead ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('no 2d context');
  // Blurring through the canvas filter costs us no extra pixel work of our own.
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';
  return canvas;
}

/**
 * Decodes the Cloud Mask into a 0..255 cloud-density image.
 * Cloud is the only white class, so min(R,G,B) is the density directly.
 */
function decodeCloudMask(img: HTMLImageElement): { canvas: HTMLCanvasElement; coveragePct: number } {
  const canvas = toCanvas(img, true, MASK_BLUR_PX);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const total = canvas.width * canvas.height;
  let cloudPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const density = Math.min(data[i], data[i + 1], data[i + 2]);
    data[i] = density;
    data[i + 1] = density;
    data[i + 2] = density;
    data[i + 3] = 255;
    if (density / 255 > CLOUD_COVER_DENSITY) cloudPixels++;
  }
  ctx.putImageData(imageData, 0, 0);

  return { canvas, coveragePct: Math.round((cloudPixels / total) * 1000) / 10 };
}

/**
 * Fetches the newest published cloud mask that actually exists, plus the precipitation
 * estimate for the same frame. Returns null only if every candidate in the window failed.
 */
export async function fetchEumetsatCloudCanvas(): Promise<EumetsatCloudResult | null> {
  for (const frameTime of candidateFrameTimes()) {
    try {
      const maskImg = await loadImage(buildWmsUrl(CLOUD_MASK_LAYER, frameTime));
      if (!maskImg.width || !maskImg.height) throw new Error('empty cloud mask');

      const { canvas: cloudCanvas, coveragePct } = decodeCloudMask(maskImg);

      // Precipitation is a bonus: a failure there must not lose the cloud mask.
      let precipCanvas: HTMLCanvasElement | null = null;
      try {
        const precipImg = await loadImage(buildWmsUrl(PRECIP_LAYER, frameTime));
        if (precipImg.width && precipImg.height) precipCanvas = toCanvas(precipImg, false);
      } catch {
        precipCanvas = null;
      }

      console.info(
        `[EUMETSAT] clm frame ${frameTime.toISOString()} — cloud cover ${coveragePct}%` +
          (precipCanvas ? ' (+ h63 precipitation)' : '')
      );

      return { cloudCanvas, precipCanvas, cloudCoveragePct: coveragePct, frameTime };
    } catch {
      // Frame not published yet, or outside the retention window — try the next older one.
    }
  }

  console.warn('[EUMETSAT] no cloud-mask frame available in the recent window');
  return null;
}
