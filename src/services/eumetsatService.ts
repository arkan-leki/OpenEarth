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

/** Brightness threshold (0..255) above which an IR pixel is counted as cloud. */
const IR_CLOUD_LUM_THRESHOLD = 150;

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

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const total = canvas.width * canvas.height;
    let cloudPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum > IR_CLOUD_LUM_THRESHOLD) cloudPixels++;
    }
    const cloudCoveragePct = Math.round((cloudPixels / total) * 1000) / 10;

    return { canvas, cloudCoveragePct };
  } catch (err) {
    console.warn('EUMETSAT cloud cover fetch failed:', err);
    return null;
  }
}
