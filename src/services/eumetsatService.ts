/**
 * EUMETSAT (Meteosat IODC) cloud data for the Live mode.
 *
 * Reads CLOUD COVER — not radar. The `msg_iodc:ir108` layer is the 10.8 µm infrared
 * channel: bright pixels are cold cloud tops, dark pixels are warm clear land. We fetch it
 * keylessly from EUMETView's GeoServer WMS and derive a cloud-cover percentage from it.
 *
 * This replaces RainViewer's Doppler radar, which measures precipitation (rain), a
 * different physical quantity than cloud cover.
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

export interface EumetsatCloudResult {
  /** Grayscale IR image (white = cold cloud tops). */
  canvas: HTMLCanvasElement;
  /** Cloud cover as a percentage (0..100). */
  cloudCoveragePct: number;
}

function buildEumetsatIrUrl(width = 1024, height = 1024): string {
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
    format: 'image/png'
  });
  return `${EUMETVIEW_WMS}?${params.toString()}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('EUMETSAT IR image load failed'));
    img.src = url;
  });
}

export async function fetchEumetsatCloudCanvas(): Promise<EumetsatCloudResult | null> {
  try {
    const img = await loadImage(buildEumetsatIrUrl());
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
      // Normalize into a 0..1 cloud density: warm (clear) ground -> 0, cold cloud top -> 1.
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
    console.info(`[EUMETSAT] ir108 cloud cover ${cloudCoveragePct}% (${canvas.width}x${canvas.height})`);

    return { canvas, cloudCoveragePct };
  } catch (err) {
    console.warn('EUMETSAT cloud cover fetch failed:', err);
    return null;
  }
}
