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

/** A plain longitude/latitude rectangle. */
export interface LonLatBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** The app's original Kurdistan domain — the default extent for these products. */
export const KURDISTAN_BBOX: LonLatBbox = {
  minLon: MIN_LON,
  minLat: MIN_LAT,
  maxLon: MAX_LON,
  maxLat: MAX_LAT
};

/**
 * The full Meteosat IODC disc footprint.
 *
 * Meteosat sits at 45.5°E, and a geostationary satellite sees up to 81.3° from its
 * sub-satellite point. That 81.3° applies to LATITUDE as measured from the equator, not as an
 * offset from the satellite's longitude — so the disc spans ±81.3° latitude, while longitude
 * is the satellite's 45.5°E ± 81.3°. Offsetting latitude by the longitude would produce
 * maxLat = 126.8°, which is not a real latitude and silently shifts every cloud.
 *
 * This is the largest extent that carries real data; outside it there is nothing to fetch,
 * which is why the global layers stop here rather than requesting transparent tiles over the
 * Americas. The bounding rectangle's corners fall outside the disc and carry no data.
 */
/**
 * The Meteosat 0° disc — a DIFFERENT view from IODC, not a duplicate of it.
 *
 * Meteosat at 0° sees longitudes -81.3 to 81.3; Meteosat IODC at 45.5°E sees -35.8 to 126.8.
 * Added together they span -81.3 to 126.8, covering 58% of the planet's longitudes instead of
 * 45%. EUMETView's own capabilities list only Meteosat (fes / iodc / rss / mtg_fd) — there is no
 * GOES or Himawari, so the Americas and the Pacific cannot be reached from this service at all.
 */
export const FES_DISC_BBOX: LonLatBbox = {
  minLon: -81.3,
  minLat: -81.3,
  maxLon: 81.3,
  maxLat: 81.3
};

/**
 * Only the part of the 0° disc that IODC does NOT already cover.
 *
 * The two discs share 117° of longitude, and painting both in full doubled the cloud's opacity
 * across that whole band — a visible overlap seam down the middle of the map. Requesting just
 * the western slice (-81.3 to -35.8) makes the pair tile the planet edge to edge instead of
 * stacking on top of each other.
 */
/**
 * Metop's infrared channel — the polar layer that covers every longitude.
 *
 * Back to `ir108` deliberately. It is grey, but that grey is the point: satellite IR is displayed
 * inverted (cold = white, warm = black), so brightness IS a cloud signal and the dark end can be
 * knocked out to drop the ground. A colour composite has no such single channel to key on.
 */
export const POLAR_LAYER = 'eps:m01_ir108';

/** A whole-world probe extent, for checking whether a polar frame carries anything. */
export const GLOBAL_BBOX: LonLatBbox = {
  minLon: -180,
  minLat: -80,
  maxLon: 180,
  maxLat: 80
};

export const FES_WEST_BBOX: LonLatBbox = {
  minLon: -81.3,
  minLat: -81.3,
  maxLon: -35.8,
  maxLat: 81.3
};

export const IODC_DISC_BBOX: LonLatBbox = {
  minLon: 45.5 - 81.3,
  minLat: -81.3,
  maxLon: 45.5 + 81.3,
  maxLat: 81.3
};

function snapToFrame(ms: number): number {
  return Math.floor(ms / FRAME_INTERVAL_MS) * FRAME_INTERVAL_MS;
}

/**
 * Candidate frame times, newest first.
 *
 * `fromMs` lets the caller ask about a moment in the past, which is what the time control uses
 * to reach back 6 or 12 hours.
 *
 * The publish-latency offset only makes sense when asking about NOW — the newest frame is
 * routinely not downloadable yet. For a historical request it is set to zero, so "6 hours ago"
 * means the frame nearest 6 hours ago rather than a further 30 minutes behind it.
 */
function candidateFrameTimes(
  count = 5,
  fromMs = Date.now(),
  latencyMinutes = PUBLISH_LATENCY_MINUTES
): Date[] {
  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    const offsetMs = (latencyMinutes + i * 15) * 60 * 1000;
    times.push(new Date(snapToFrame(fromMs - offsetMs)));
  }
  return times;
}

function buildWmsUrl(
  layer: string,
  frameTime: Date,
  width = 1024,
  height = 1024,
  bbox: LonLatBbox = KURDISTAN_BBOX
): string {
  // WMS 1.3.0 + EPSG:4326 → axis order is lat,lon: minLat,minLon,maxLat,maxLon.
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: layer,
    bbox: `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`,
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
function decodeCloudMask(
  img: HTMLImageElement,
  blurPx = MASK_BLUR_PX
): { canvas: HTMLCanvasElement; coveragePct: number } {
  const canvas = toCanvas(img, true, blurPx);
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
 * Resolves which frame time is actually published, using a deliberately tiny request.
 *
 * GeoServer intermittently answers with a 500 while warming, and the newest frame is not
 * immediately downloadable, so some probing is unavoidable. Probing with a 64² image costs
 * almost nothing, whereas the alternative — calling the full cloud-canvas fetch purely to
 * learn a timestamp — downloads a megapixel mask that the 3D globe then throws away.
 */
export async function resolveEumetsatFrameTime(hoursAgo = 0): Promise<Date | null> {
  const fromMs = Date.now() - hoursAgo * 3_600_000;
  const latency = hoursAgo > 0 ? 0 : PUBLISH_LATENCY_MINUTES;

  for (const frameTime of candidateFrameTimes(6, fromMs, latency)) {
    try {
      const img = await loadImage(buildWmsUrl(CLOUD_MASK_LAYER, frameTime, 64, 64));
      if (img.width && img.height) return frameTime;
    } catch {
      // Not published yet, or outside the retention window — try the next older frame.
    }
  }
  console.warn('[EUMETSAT] no published frame found in the recent window');
  return null;
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

/**
 * Raw channel shown as the picture in the 2D imagery viewer.
 *
 * This is the visual IR 10.8 µm frame — the 3D cloud field itself is driven by the decoded
 * Cloud Mask above, but a classified mask reads as a flat colour map, not as imagery.
 */
export const EUMETSAT_VISIBLE_LAYER = 'msg_iodc:ir108';

export interface EumetsatLayerFrame {
  image: HTMLImageElement;
  frameTime: Date;
}

/** Loads a raw EUMETSAT layer frame for display, newest published frame first. */
export async function fetchEumetsatLayerFrame(
  layer: string = EUMETSAT_VISIBLE_LAYER
): Promise<EumetsatLayerFrame | null> {
  for (const frameTime of candidateFrameTimes()) {
    try {
      const img = await loadImage(buildWmsUrl(layer, frameTime));
      if (!img.width || !img.height) throw new Error('empty frame');
      return { image: img, frameTime };
    } catch {
      // Not published yet, or outside the retention window — try the next older frame.
    }
  }
  console.warn(`[EUMETSAT] no ${layer} frame available in the recent window`);
  return null;
}

/**
 * Cloud-mask density and cover over an arbitrary extent, for a frame time already known to
 * load.
 *
 * The cloud field follows the camera, so the mask is fetched for whatever the camera is
 * currently looking at. Requesting the same pixel count over a smaller extent is what makes
 * detail scale with zoom: the WMS renders more pixels per kilometre the further you zoom in,
 * up to the ~3 km limit of the instrument itself.
 *
 * `coveragePct` describes the SAME extent that was just fetched, so the figure on screen
 * always refers to the area in view rather than to some fixed region elsewhere.
 *
 * `blurPx` defaults to ZERO here, unlike the legacy canvas decode. The mask is a hard per-pixel
 * classification, and blurring it rounds off the class boundaries — which destroys exactly the
 * sharp edges and clear holes that make the product readable. The blur exists only for the old
 * volumetric pipeline, which needed soft edges to ray-march against.
 *
 * `layerId` allows the same decode to be run against a second satellite's mask (`msg_fes:clm`),
 * so two discs can be painted from one code path.
 *
 * Returns null on failure — the caller keeps its previous field rather than repositioning
 * clouds against the wrong extent.
 */
export async function fetchEumetsatCloudMaskExtent(
  frameTime: Date,
  bbox: LonLatBbox = IODC_DISC_BBOX,
  width = 1024,
  height = 1024,
  blurPx = 0,
  layerId = CLOUD_MASK_LAYER
): Promise<{ canvas: HTMLCanvasElement; coveragePct: number } | null> {
  /*
   * Retried once, because this service fails INTERMITTENTLY rather than by request size:
   * measured on one frame time, 512/768/1024 answered 200, 1280 answered 502, and 1536/2048
   * answered 200 again. A single silent failure here loses the entire cloud layer, so one
   * retry converts a common transient into a rarely-visible one.
   */
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const img = await loadImage(buildWmsUrl(layerId, frameTime, width, height, bbox));
      if (!img.width || !img.height) throw new Error('empty cloud mask');
      return decodeCloudMask(img, blurPx);
    } catch (err) {
      if (attempt === 1) {
        console.warn('[EUMETSAT] cloud mask unavailable after retry:', err);
        return null;
      }
    }
  }
  return null;
}

/**
 * The precipitation estimate as published (RGBA, transparent where dry), for an arbitrary
 * extent and frame time.
 *
 * Returned raw rather than decoded: unlike the cloud mask this product is already a colour
 * ramp, so its channels ARE the information and must not be reduced to a grey density.
 */
export async function fetchEumetsatPrecipExtent(
  frameTime: Date,
  bbox: LonLatBbox = IODC_DISC_BBOX,
  width = 768,
  height = 768
): Promise<HTMLCanvasElement | null> {
  try {
    const img = await loadImage(buildWmsUrl(PRECIP_LAYER, frameTime, width, height, bbox));
    if (!img.width || !img.height) return null;
    return toCanvas(img, true);
  } catch (err) {
    console.warn('[EUMETSAT] precipitation for the requested extent unavailable:', err);
    return null;
  }
}

/**
 * Finds the newest POLAR frame that actually carries data.
 *
 * Metop cannot use the Meteosat frame time. A geostationary satellite images the same disc
 * continuously, so the newest frame is always complete; a polar orbiter only has the swaths it
 * happened to fly over, so the last couple of hours are routinely EMPTY and occasional passes
 * are missing altogether (measured: 1h and 2h ago empty, 4h and 6h ago full, 9h ago empty again).
 *
 * Feeding it the Meteosat timestamp is why the global layer painted nothing and only the Meteosat
 * discs appeared — half the planet bare.
 *
 * A frame is accepted only if it decodes to real pixels, because an empty frame is still a
 * perfectly valid PNG, so size and status cannot distinguish them.
 */
export async function resolvePolarFrameTime(maxHoursBack = 24): Promise<Date | null> {
  for (let hours = 3; hours <= maxHoursBack; hours++) {
    const t = new Date(Date.now() - hours * 3_600_000);
    try {
      const img = await loadImage(buildWmsUrl(POLAR_LAYER, t, 128, 128, GLOBAL_BBOX));
      if (!img.width || !img.height) continue;

      const probe = toCanvas(img, true);
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data;

      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 10) lit++;
      if (lit / (probe.width * probe.height) > 0.05) return t;
    } catch {
      // no pass at this time — keep walking back
    }
  }
  console.warn('[EUMETSAT] no polar frame with data found in the last day');
  return null;
}

/**
 * The polar IR frame as raw pixels, for client-side transparency.
 *
 * Unlike the tiled polar layer this is a single image over a whole-world extent, because keying
 * transparency on brightness means reading the pixels — which Cesium's tile pipeline cannot do.
 * That costs sharpness at high zoom: this trades the streamed tiles for the transparency trick.
 */
export async function fetchPolarCanvas(
  frameTime: Date,
  bbox: LonLatBbox = GLOBAL_BBOX,
  width = 1600,
  height = 800
): Promise<HTMLCanvasElement | null> {
  try {
    const img = await loadImage(buildWmsUrl(POLAR_LAYER, frameTime, width, height, bbox));
    if (!img.width || !img.height) return null;
    return toCanvas(img, true);
  } catch (err) {
    console.warn('[EUMETSAT] polar frame unavailable for decoding:', err);
    return null;
  }
}
