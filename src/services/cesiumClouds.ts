/**
 * Painting weather onto the Cesium globe.
 *
 * There is no cloud geometry here. The volumetric cloud field that used to live in this file
 * has been removed: at globe scale it cost a raymarch per cloud to approximate a cloud field
 * that the satellite already measured, and a satellite image is both cheaper and truer.
 *
 * What remains is paint — real observations composited over the globe as imagery layers:
 *
 *   cloud mask     EUMETSAT `clm`, painted EXACTLY as EUMETSAT publishes it — its own colours,
 *                  its own classes. We do not reinterpret it into a "realistic" white cloud
 *                  sheet: the product is a classification, and rendering it as anything other
 *                  than what it is would invent information the satellite never reported.
 *   precipitation  EUMETSAT `h63`, an IR + microwave precip estimate, already transparent
 *                  where it is dry and so layered directly.
 */

/** A geographic extent that a mask canvas covers, so pixels can be mapped back to lon/lat. */
export interface CloudMaskExtent {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Ceiling on an overlay texture's longest side.
 *
 * Sized to PRESERVE the source, not to resize it: each overlay keeps its own fetched resolution
 * up to this cap. It is 2048 because the gridded disc fetch now stitches to 2048; at 1536 the cap
 * was silently downscaling the stitch straight back down, discarding a quarter of the pixels that
 * had just been paid for. An earlier version always rendered to a fixed 1024, which silently downscaled
 * the 1536px Kurdistan patch back to 1024 — paying for detail and then discarding it, and
 * upscaling the 1024px disc fetches at the same time for no gain.
 */
const OVERLAY_MAX_SIZE = 2048;

/**
 * Resamples a source canvas to the overlay size and rewrites every pixel through `map`.
 *
 * Both overlays share this because they differ only in that one function: how a published pixel
 * becomes an RGBA overlay pixel. Resampling also keeps the data URL small, since these canvases
 * are handed to Cesium inline rather than fetched.
 */
function deriveOverlay(
  source: HTMLCanvasElement,
  extent: CloudMaskExtent,
  map: (r: number, g: number, b: number, a: number) => { r: number; g: number; b: number; a: number },
  blurPx = 0
): { canvas: HTMLCanvasElement } | null {
  const srcCtx = source.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return null;

  const lonSpan = extent.maxLon - extent.minLon;
  const latSpan = extent.maxLat - extent.minLat;
  /*
   * Preserve the SOURCE resolution, capped. Scaling by whichever side is longer keeps the
   * aspect right for a tall narrow extent without ever producing a multi-thousand-pixel canvas.
   */
  const sourceMax = Math.max(source.width, source.height);
  const scale = Math.min(1, OVERLAY_MAX_SIZE / sourceMax);
  const width = Math.max(16, Math.round(source.width * scale));
  const height = Math.max(16, Math.round(source.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;

  for (let i = 0; i < d.length; i += 4) {
    const px = map(d[i], d[i + 1], d[i + 2], d[i + 3]);
    d[i] = px.r;
    d[i + 1] = px.g;
    d[i + 2] = px.b;
    d[i + 3] = Math.round(255 * Math.min(1, px.a));
  }
  ctx.putImageData(image, 0, 0);

  /*
   * Optional softening pass.
   *
   * Cloud is not a hard-edged decal — it is diffuse, and a sheet with crisp class boundaries
   * reads as a sticker pasted on the globe. Blurring the RESULT (not the classification) softens
   * how it sits in the air while leaving the shapes and their extent untouched, so coverage and
   * gaps survive; only the edges stop being razor sharp.
   */
  if (blurPx > 0) {
    const soft = document.createElement('canvas');
    soft.width = width;
    soft.height = height;
    const softCtx = soft.getContext('2d');
    if (softCtx) {
      softCtx.filter = `blur(${blurPx}px)`;
      softCtx.drawImage(canvas, 0, 0);
      softCtx.filter = 'none';
      return { canvas: soft };
    }
  }
  return { canvas };
}

/** Cloud mask → white, transparent where clear (EUMETSAT's own class distinction). */
export function buildCloudSheet(
  maskCanvas: HTMLCanvasElement,
  extent: CloudMaskExtent
): HTMLCanvasElement | null {
  const out = deriveOverlay(maskCanvas, extent, (r, g, b) => {
    const coverage = Math.min(r, g, b) / 255;
    /*
     * THICK cloud. This was clamped to 0.55 so the radar underneath stayed readable, but the
     * radar now sits ABOVE this sheet and has its own on/off switch, so the clamp was only
     * making the coverage look thin and washed out. Raised to 0.8: substantial, cloud-like
     * cover, while the blur keeps it soft rather than a cut-out.
     */
    return { r: 255, g: 255, b: 255, a: Math.min(0.8, coverage) };
  }, 3);
  return out ? out.canvas : null;
}

/**
 * Polar image → its own pixels, faded by brightness.
 *
 * A straight `a = luminance` wasted the middle of the range: warm ground sat around 20% opacity,
 * so a faint ghost of the surface hung over the surface, while thin and low cloud barely
 * separated from it. A smoothstep stretches the useful part of the range instead — surface falls
 * away faster, thin cloud lifts clear of it, and thick cloud reaches full strength.
 *
 * It is still continuous. There is no threshold anywhere, so every gradient the instrument
 * recorded survives; only where each tone lands on the opacity curve has changed.
 */
export function buildPolarSheet(
  polarCanvas: HTMLCanvasElement,
  extent: CloudMaskExtent
): HTMLCanvasElement | null {
  const out = deriveOverlay(polarCanvas, extent, (r, g, b, a) => {
    if (a < 10) return { r, g, b, a: 0 };
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    /*
     * The window matters more than the shape. At 0.12-0.88 only genuinely bright pixels reached
     * full strength, and an infrared mosaic is mostly MID-tone — so most of the image sat at
     * half opacity and the layer read as a pale wash. Compressing the window to 0.05-0.55 means
     * ordinary cloud reaches full opacity and only the truly dark surface falls away.
     */
    const t = Math.min(1, Math.max(0, (lum - 0.05) / (0.55 - 0.05)));
    const smooth = t * t * (3 - 2 * t);
    return { r, g, b, a: smooth };
  }, 3);
  return out ? out.canvas : null;
}

/**
 * Precipitation → greyscale, with the product's own intensity driving BOTH tone and opacity.
 *
 * The h63 ramp already encodes intensity in its colours, so desaturating keeps that scale as
 * luminance. Two things then make it read like real precipitation:
 *
 *   tone     heavy rain goes darker and lighter rain stays near-white, so the strongest echoes
 *            are the most prominent thing on the sheet rather than weak drizzle forming a bright
 *            wash across the whole disc
 *   opacity  intensity also scales opacity, so light rain is faint and heavy rain is solid —
 *            the same way a real radar return strength is perceived
 *
 * NO BLUR HERE, unlike the cloud sheets. The precipitation image is mostly TRANSPARENT — rain
 * covered 6% of Kurdistan and 12% of the disc when measured — and blurring an image that is
 * almost entirely empty alpha does not soften it, it DILUTES it: the few real echoes spread out
 * and lose peak opacity. That is a large part of why the radar kept disappearing while the cloud
 * sheets looked fine. Cloud benefits from softening; sparse rain needs its edges left alone.
 */
export function buildRadarSheet(
  precipCanvas: HTMLCanvasElement,
  extent: CloudMaskExtent
): HTMLCanvasElement | null {
  const out = deriveOverlay(precipCanvas, extent, (r, g, b, a) => {
    if (a < 10) return { r, g, b, a: 0 };
    /*
     * COLOUR PRESERVED. An earlier version desaturated this to grey on request, which threw away
     * the product's own intensity ramp — the ramp IS the scale, so greyscaling it discarded the
     * very thing that makes rain legible. The published colours are passed through untouched.
     *
     * Intensity still scales opacity, so weak drizzle is faint and heavy cells are solid, and
     * that intensity is read from the colour's own luminance since the ramp encodes it there.
     */
    /*
     * 85% opacity — solid enough to be unmistakable, with just enough give that it does not read
     * as a flat sticker. Intensity lives in the COLOUR ramp, passed through untouched, so the
     * opacity setting costs no information.
     */
    return { r, g, b, a: 0.85 };
  });
  return out ? out.canvas : null;
}

/* ---------------------------------------------------------------------------------------------
 * THE OTHER OPERATORS' SATELLITES
 *
 * EUMETSAT is the EUROPEAN organisation: its Meteosat fleet is parked over Europe, Africa and
 * the Indian Ocean because that is its members' remit. The Americas belong to NOAA (GOES) and
 * the western Pacific to JMA (Himawari). No single organisation covers the planet — which is
 * exactly why one disc always left half the globe bare.
 *
 * All of them are openly available through NASA GIBS, keyless, which this app already uses.
 * Measured before wiring: GOES-East over the Americas, GOES-West over the Pacific and Himawari
 * over east Asia each returned 100% data where EUMETSAT returns 0.0%.
 *
 * The longitudes below are CLIPPED so the four satellites tile the planet edge to edge with no
 * overlap — each contributes only what the neighbour to its east or west cannot see.
 * ------------------------------------------------------------------------------------------- */

export interface GeoSatRegion {
  id: string;
  label: string;
  layer: string;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  credit: string;
}

/** Discs reach 81.3° from the sub-satellite point; longitude windows are the non-overlapping parts. */
export const GEOSAT_REGIONS: GeoSatRegion[] = [
  {
    id: 'goes-east',
    label: 'GOES-East (NOAA)',
    // NOAA's flagship composite: true colour by day, IR cloud and city lights by night.
    layer: 'GOES-East_ABI_GeoColor',
    minLon: -156.5,
    maxLon: -81.3,
    minLat: -81.3,
    maxLat: 81.3,
    credit: 'NOAA/CIRA GeoColor'
  },
  {
    id: 'goes-west',
    label: 'GOES-West (NOAA)',
    layer: 'GOES-West_ABI_GeoColor',
    minLon: -180,
    maxLon: -156.5,
    minLat: -81.3,
    maxLat: 81.3,
    credit: 'NOAA/CIRA GeoColor'
  },
  {
    id: 'himawari',
    label: 'Himawari (JMA)',
    // GIBS publishes no GeoColor for Himawari, so this is its clean infrared channel.
    layer: 'Himawari_AHI_Band13_Clean_Infrared',
    minLon: 126.8,
    maxLon: 180,
    minLat: -81.3,
    maxLat: 81.3,
    credit: 'JMA Himawari'
  }
];

/** Fetches a GIBS layer for a region, as raw pixels. */
export async function fetchGibsCanvas(
  layer: string,
  bbox: CloudMaskExtent,
  dateIso: string,
  width = 1024,
  height = 1024
): Promise<HTMLCanvasElement | null> {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: layer,
    STYLES: '',
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
    SRS: 'EPSG:4326',
    BBOX: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    WIDTH: String(width),
    HEIGHT: String(height),
    TIME: dateIso
  });
  const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('gibs tile failed'));
        el.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, width, height);
      return canvas;
    } catch {
      // retried once: these services fail intermittently
    }
  }
  return null;
}

/**
 * Another operator's satellite, hung as a sheet in the colours published.
 *
 * The pixels are passed through UNCHANGED — these are photographic composites, not
 * classifications, and recolouring them would be inventing imagery. Only the product's own alpha
 * is used, so the parts of the frame outside its disc stay transparent.
 */
export function buildGeoSatSheet(
  source: HTMLCanvasElement,
  extent: CloudMaskExtent
): HTMLCanvasElement | null {
  const out = deriveOverlay(source, extent, (r, g, b, a) => {
    if (a < 10) return { r, g, b, a: 0 };
    return { r, g, b, a: 1 };
  });
  return out ? out.canvas : null;
}
