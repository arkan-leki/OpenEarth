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

import * as Cesium from 'cesium';

const EUMETVIEW_WMS = 'https://view.eumetsat.int/geoserver/wms';

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
 * up to this cap. An earlier version always rendered to a fixed 1024, which silently downscaled
 * the 1536px Kurdistan patch back to 1024 — paying for detail and then discarding it, and
 * upscaling the 1024px disc fetches at the same time for no gain.
 */
const OVERLAY_MAX_SIZE = 1536;

/**
 * CLOUD OVERLAY — the cloud class only, opacity driven by coverage.
 *
 * The published mask paints every class: cloud white, clear land green, clear sea blue. Painted
 * over satellite ground that hides the ground and tints it green.
 *
 * The separation is EUMETSAT's own, not a heuristic of ours. In that product cloud is the only
 * class that is white, so `min(R,G,B)` is an exact cloud discriminator: white → 255, green land
 * → 0 (its red and blue are both zero), blue sea → 0. Anything that is not cloud therefore
 * falls to zero on its own.
 *
 * Opacity follows coverage LINEARLY. A gamma curve would be tempting for a prettier picture, but
 * any lift brightens partial pixels and fills the gaps between cloud — the mask's holes are real
 * information about where the sky is clear, so they are left alone.
 */
export function createCloudOverlay(
  maskCanvas: HTMLCanvasElement,
  extent: CloudMaskExtent,
  credit: string,
  opacity = 1
): Cesium.ImageryLayer | null {
  const out = deriveOverlay(maskCanvas, extent, (r, g, b) => {
    const coverage = Math.min(r, g, b) / 255;
    // Linear, no gamma lift: a clear pixel stays fully transparent, so holes read as holes.
    return { r: 255, g: 255, b: 255, a: coverage };
  });
  if (!out) return null;

  const layer = new Cesium.ImageryLayer(
    new Cesium.SingleTileImageryProvider({
      url: out.canvas.toDataURL('image/png'),
      rectangle: Cesium.Rectangle.fromDegrees(extent.minLon, extent.minLat, extent.maxLon, extent.maxLat),
      tileWidth: out.canvas.width,
      tileHeight: out.canvas.height,
      credit
    })
  );
  layer.alpha = opacity;
  return layer;
}

/**
 * RADAR OVERLAY — precipitation in white and grey.
 *
 * The product's rainbow ramp is replaced with a monochrome scale: DARK GREY for light rain
 * through to GREY for heavy. It deliberately stops short of white, because white is the cloud
 * layer's colour — rain reading as white would be indistinguishable from the cloud sitting
 * above it. Intensity comes from the brightest channel, preserving the ramp's own ordering.
 *
 * Alpha is binary: rain at this pixel or not. Colour carries how much, so leaving alpha partial
 * as well only made the radar washed out over imagery.
 */
export function createRadarOverlay(
  precipCanvas: HTMLCanvasElement,
  extent: CloudMaskExtent,
  credit: string,
  opacity = 1
): Cesium.ImageryLayer | null {
  const out = deriveOverlay(precipCanvas, extent, (r, g, b, a) => {
    // The brightest channel preserves the ramp's own ordering, so heavy rain stays heaviest.
    const intensity = Math.max(r, g, b) / 255;
    // VERY LIGHT grey for heavy rain down to DARK grey for light rain. Never pure white:
    // that is the cloud layer's territory, and the two must stay distinguishable.
    const level = Math.round(210 - 130 * intensity);
    return { r: level, g: level, b: level, a: a > 8 ? 1 : 0 };
  });
  if (!out) return null;

  const layer = new Cesium.ImageryLayer(
    new Cesium.SingleTileImageryProvider({
      url: out.canvas.toDataURL('image/png'),
      rectangle: Cesium.Rectangle.fromDegrees(extent.minLon, extent.minLat, extent.maxLon, extent.maxLat),
      tileWidth: out.canvas.width,
      tileHeight: out.canvas.height,
      credit
    })
  );
  layer.alpha = opacity;
  return layer;
}

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
  map: (r: number, g: number, b: number, a: number) => { r: number; g: number; b: number; a: number }
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
  return { canvas };
}

export interface PaintTuning {
  alpha?: number;
  contrast?: number;
  saturation?: number;
  brightness?: number;
}

export function createEumetsatPaintLayer(
  layerId: string,
  frameTime: Date,
  extent: CloudMaskExtent,
  credit: string,
  tuning: PaintTuning = {}
): Cesium.ImageryLayer {
  const layer = new Cesium.ImageryLayer(
    new Cesium.WebMapServiceImageryProvider({
      url: EUMETVIEW_WMS,
      layers: layerId,
      parameters: {
        format: 'image/png',
        transparent: true,
        // Explicit observation time, so the paint on screen has known provenance.
        time: frameTime.toISOString()
      },
      tilingScheme: new Cesium.GeographicTilingScheme(),
      tileWidth: 256,
      tileHeight: 256,
      // Only ask inside the disc that actually has data.
      rectangle: Cesium.Rectangle.fromDegrees(
        extent.minLon,
        extent.minLat,
        extent.maxLon,
        extent.maxLat
      ),
      credit
    })
  );
  layer.alpha = tuning.alpha ?? 1;
  /**
   * EUMETSAT's precipitation estimate is a soft IR + microwave blend, so painted raw it reads
   * as a muddy grey wash rather than rain. Cesium composites these per-layer, which lifts the
   * signal out without us reprocessing any pixels.
   */
  layer.contrast = tuning.contrast ?? 1;
  layer.saturation = tuning.saturation ?? 1;
  layer.brightness = tuning.brightness ?? 1;
  return layer;
}

/**
 * An EUMETSAT product pasted straight onto the globe, streamed as tiles.
 *
 * NO PIXEL PROCESSING OF OURS. The published image is used exactly as EUMETSAT renders it; the
 * only transformation is `saturation = 0`, which is Cesium's own neutral desaturation applied
 * during compositing. That keeps the product's intensity structure — which lives in its colours
 * — intact as luminance, and keeps the product's own alpha, so it stays transparent where it is
 * dry. It is also a tile layer, so it streams and stays sharp at any zoom instead of being
 * capped at a decoded image size.
 */
export function createTiledEumetsatLayer(
  layerId: string,
  frameTime: Date,
  extent: CloudMaskExtent,
  credit: string,
  greyscale = false
): Cesium.ImageryLayer {
  const layer = new Cesium.ImageryLayer(
    new Cesium.WebMapServiceImageryProvider({
      url: EUMETVIEW_WMS,
      layers: layerId,
      parameters: {
        format: 'image/png',
        transparent: true,
        time: frameTime.toISOString()
      },
      tilingScheme: new Cesium.GeographicTilingScheme(),
      tileWidth: 256,
      tileHeight: 256,
      rectangle: Cesium.Rectangle.fromDegrees(
        extent.minLon,
        extent.minLat,
        extent.maxLon,
        extent.maxLat
      ),
      credit
    })
  );
  if (greyscale) layer.saturation = 0;
  return layer;
}

/**
 * GLOBAL cloud — EUMETSAT's POLAR orbiter (Metop), natural colour, streamed as tiles.
 *
 * This is the fix for half the planet having no cloud. The geostationary Meteosat discs only
 * reach longitudes -81.3 to 126.8; a polar orbiter passes over every longitude, and measured
 * against the same request that Meteosat answers with 0.0% data, this returns 100% over the
 * Americas and 88.5% over a whole-world extent.
 *
 * IT IS COLOUR IMAGERY, NOT A CLASSIFICATION. Meteosat's `clm` gives a cloud/no-cloud class, which
 * is why the mask can be painted as pure white with exact holes. This composite is a photograph:
 * cloud reads white, and land and sea keep their own colour. It is therefore imagery, not a mask.
 *
 * No desaturation is applied. An earlier version forced `saturation = 0` while it was using the
 * IR channel — pointless, since that product is 100% grey already, and wrong here because it
 * would throw away the colour that is the reason for choosing this product.
 *
 * POLAR IMAGERY ARRIVES IN SWATHS, so one frame has gaps between orbital strips; the missing
 * ~11% of a global request is those gaps. Later passes fill them in.
 */
export function createPolarCloudLayer(frameTime: Date, credit: string, alpha = 1): Cesium.ImageryLayer {
  const layer = new Cesium.ImageryLayer(
    new Cesium.WebMapServiceImageryProvider({
      url: EUMETVIEW_WMS,
      layers: 'eps:m01_ir108',
      parameters: {
        format: 'image/png',
        transparent: true,
        time: frameTime.toISOString()
      },
      tilingScheme: new Cesium.GeographicTilingScheme(),
      tileWidth: 256,
      tileHeight: 256,
      // No rectangle: this one genuinely covers the planet.
      credit
    })
  );
  layer.alpha = alpha;
  return layer;
}

/**
 * The Metop polar image, faded by brightness on a continuous scale.
 *
 * NOT A CLOUD LAYER, and not a mask. Two earlier versions got this wrong in opposite directions:
 * one recoloured every surviving pixel to pure white, inventing a cloud product out of an image;
 * the next cut hard at a threshold, which is still a mask rather than a picture.
 *
 * This does neither. The satellite's own pixels are passed through UNCHANGED, and only their
 * opacity is scaled by brightness:
 *
 *     dark grey  ->  fully transparent   (warm land and sea, dropped out)
 *     mid grey   ->  ~50% opaque
 *     light grey ->  ~80% opaque
 *     white      ->  100% opaque         (cold cloud tops, at full strength)
 *
 * So the image fades in as it gets colder instead of being cut or recoloured, and everything on
 * screen is still what the instrument measured.
 */
export function createPolarBrightnessFadedOverlay(
  polarCanvas: HTMLCanvasElement,
  extent: CloudMaskExtent,
  credit: string,
  opacity = 1
): Cesium.ImageryLayer | null {
  const out = deriveOverlay(polarCanvas, extent, (r, g, b, a) => {
    if (a < 10) return { r, g, b, a: 0 };
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    // Brightness IS the alpha: the darker the pixel, the more it fades out.
    return { r, g, b, a: lum };
  });
  if (!out) return null;

  const layer = new Cesium.ImageryLayer(
    new Cesium.SingleTileImageryProvider({
      url: out.canvas.toDataURL('image/png'),
      rectangle: Cesium.Rectangle.fromDegrees(extent.minLon, extent.minLat, extent.maxLon, extent.maxLat),
      tileWidth: out.canvas.width,
      tileHeight: out.canvas.height,
      credit
    })
  );
  layer.alpha = opacity;
  return layer;
}
