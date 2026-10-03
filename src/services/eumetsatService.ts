/**
 * EUMETSAT (Meteosat IODC) cloud data for the Live mode.
 *
 * Reads CLOUD COVER — not radar. The `msg_iodc:ir108` layer is the 10.8 µm infrared channel:
 * bright pixels are cold cloud tops, dark pixels are warm clear land.
 *
 * EVERY request carries an explicit WMS `TIME`, so each frame has a known timestamp and the
 * UI can say exactly which observation it is displaying. Without it the server returns
 * "whatever happens to be latest" and the data has no provenance at all.
 */
import { MIN_LON, MAX_LON, MIN_LAT, MAX_LAT } from '../utils/realSulaymaniyahTerrain';

const EUMETVIEW_WMS = 'https://view.eumetsat.int/geoserver/wms';

/**
 * IR luminance (0..255) at or below which the scene reads as clear, warm ground, and the
 * span up to a fully cold cloud top.
 *
 * EUMETSAT's ir108 is mostly DARK over this region (mean ~35, because the hot desert surface
 * reads warm). The downstream cloud pipeline expects a bright-cloud image, so the raw values
 * must be stretched into a real 0..1 density — otherwise it finds no cloud at all.
 */
const IR_CLEAR_LUM = 110;
const IR_CLOUD_SPAN = 80;
/** Density above which a pixel counts toward the reported cloud-cover percentage. */
const CLOUD_COVER_DENSITY = 0.35;

/** IODC IR frames are published every 15 minutes. */
const FRAME_INTERVAL_MS = 15 * 60 * 1000;
/**
 * The newest frame is NOT immediately downloadable — asking for "now" returns an empty body
 * (measured: a ~25 min old frame loads, the current one does not). Start 30 minutes back and
 * walk older until one actually loads.
 */
const PUBLISH_LATENCY_MINUTES = 30;

export interface EumetsatCloudResult {
  /** Grayscale image whose brightness is the normalized 0..1 cloud density. */
  canvas: HTMLCanvasElement;
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

function buildEumetsatIrUrl(frameTime: Date, width = 1024, height = 1024): string {
  // WMS 1.3.0 + EPSG:4326 → axis order is lat,lon: minLat,minLon,maxLat,maxLon.
  const bbox = `${MIN_LAT},${MIN_LON},${MAX_LAT},${MAX_LON}`;
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: 'msg_iodc:ir108',
    bbox,
    width: String(width),
    height: String(height),
    crs: 'EPSG:4326',
    format: 'image/png',
    // Explicit observation time → known provenance. toISOString() produces the
    // YYYY-MM-DDTHH:MM:00.000Z form the service expects.
    time: frameTime.toISOString()
  });
  return `${EUMETVIEW_WMS}?${params.toString()}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('EUMETSAT IR frame unavailable'));
    img.src = url;
  });
}

/**
 * Fetches the newest published IR frame that actually exists, and reports its timestamp.
 * Returns null only if every candidate in the recent window failed.
 */
export async function fetchEumetsatCloudCanvas(): Promise<EumetsatCloudResult | null> {
  for (const frameTime of candidateFrameTimes()) {
    try {
      const img = await loadImage(buildEumetsatIrUrl(frameTime));
      if (!img.width || !img.height) throw new Error('empty frame');

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const total = canvas.width * canvas.height;
      let cloudPixels = 0;

      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // Normalize into a 0..1 cloud density: warm (clear) ground -> 0, cold cloud -> 1.
        const density = Math.min(1, Math.max(0, (lum - IR_CLEAR_LUM) / IR_CLOUD_SPAN));
        const v = Math.round(density * 255);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
        if (density > CLOUD_COVER_DENSITY) cloudPixels++;
      }
      ctx.putImageData(imageData, 0, 0);

      const cloudCoveragePct = Math.round((cloudPixels / total) * 1000) / 10;
      console.info(
        `[EUMETSAT] ir108 frame ${frameTime.toISOString()} — cloud cover ${cloudCoveragePct}%`
      );

      return { canvas, cloudCoveragePct, frameTime };
    } catch {
      // Frame not published yet, or outside the retention window — try the next older one.
    }
  }

  console.warn('[EUMETSAT] no IR frame available in the recent window');
  return null;
}
