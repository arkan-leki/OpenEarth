/**
 * Satellite base imagery for the globe.
 *
 * These are SATELLITE images, not street-map tiles. A base map of drawn roads and labels is
 * the wrong surface to read weather against; the reference should be the ground as seen from
 * orbit.
 *
 * Both services are keyless and send `Access-Control-Allow-Origin: *` (checked, not assumed):
 *
 *  - Esri World Imagery — the highest-detail global satellite mosaic available without a key,
 *    and the closest thing to a "satellite mode". Cesium's own satellite basemaps (Bing Maps
 *    Aerial / Cesium World Imagery) live on Cesium ion and require an access token, which this
 *    project deliberately avoids.
 *  - NASA GIBS true colour — a real daily satellite pass (VIIRS on Suomi NPP). Served as WMTS
 *    tiles rather than WMS GetMap, which is both faster and cacheable.
 */

import * as Cesium from 'cesium';

export type BaseMapId = 'esri' | 'nasa_today' | 'nasa_yesterday';

export interface BaseMapDefinition {
  id: BaseMapId;
  label: string;
  credit: string;
  hint: string;
}

export const BASE_MAPS: BaseMapDefinition[] = [
  {
    id: 'esri',
    label: 'SATELLITE',
    credit: 'Esri, Maxar, Earthstar Geographics',
    hint: 'High-detail global satellite mosaic'
  },
  {
    id: 'nasa_today',
    label: 'NASA TODAY',
    credit: 'NASA EOSDIS GIBS / VIIRS Suomi NPP',
    hint: "Today's real VIIRS satellite pass"
  },
  {
    id: 'nasa_yesterday',
    label: 'NASA YESTERDAY',
    credit: 'NASA EOSDIS GIBS / VIIRS Suomi NPP',
    hint: "Yesterday's real VIIRS satellite pass"
  }
];

const ESRI_WORLD_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/**
 * GIBS WMTS: the date is part of the path, so the URL is built per day.
 *
 * `dateIso` lets the caller pin an exact date from the picker. Without it the date falls back to
 * today or yesterday. GIBS retains imagery back to 2000, so the picker can reach historical
 * passes rather than only the last two days.
 */
function gibsTrueColorUrl(daysAgo: number, dateIso?: string): string {
  const date = dateIso || new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return (
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
    'VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' +
    `${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
  );
}

/** Builds the streamed satellite base layer for the chosen source. */
export function createBaseMapLayer(id: BaseMapId, dateIso?: string): Cesium.ImageryLayer {
  if (id === 'esri') {
    return new Cesium.ImageryLayer(
      new Cesium.UrlTemplateImageryProvider({
        url: ESRI_WORLD_IMAGERY,
        // XYZ tiles are web-mercator by definition, which is also this provider's default —
        // stated explicitly so the 1:1 indexing is obvious rather than incidental.
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        tileWidth: 256,
        tileHeight: 256,
        maximumLevel: 19,
        credit: 'Esri, Maxar, Earthstar Geographics'
      })
    );
  }

  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: gibsTrueColorUrl(id === 'nasa_yesterday' ? 1 : 0, dateIso),
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      tileWidth: 256,
      tileHeight: 256,
      // GoogleMapsCompatible_Level9 is the deepest matrix GIBS publishes for this layer.
      maximumLevel: 9,
      credit: 'NASA EOSDIS GIBS / VIIRS Suomi NPP'
    })
  );
}

/**
 * City labels AND country boundaries, as a transparent overlay above the satellite ground.
 *
 * This replaces CARTO's label-only tiles, which turned out to be watermarked: the service now
 * requires an API key and serves a small "API key required" placeholder image instead of
 * labels. The tiles looked non-empty (2 KB) so this was not obvious from a size check alone —
 * what gave it away was a 2005-byte palette image where real labels would be an order of
 * magnitude larger.
 *
 * Esri's reference service is keyless, sits on the same host as the imagery already in use, and
 * carries both place names and administrative boundaries. Nothing about places is hardcoded
 * here: the service redraws labels at the right density for each zoom, so they stay legible
 * rather than piling up.
 */
export function createLabelLayer(): Cesium.ImageryLayer {
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: 19,
      credit: 'Esri — Boundaries and Places'
    })
  );
}

/** Today / yesterday as `YYYY-MM-DD`, for seeding the date picker. */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}



