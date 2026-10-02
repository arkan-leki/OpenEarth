/**
 * Real Meteorological Data Pipeline for Northern Iraq & Kurdistan Region
 * Integrates live Open-Meteo observations across Erbil Citadel, Sulaymaniyah & Mount Goizha,
 * Mount Halgurd, Duhok Valley, Lake Dukan, Amadiya, and Halabja.
 */
import * as THREE from 'three';
import { GridChunkData, WeatherCondition } from '../types';
import {
  KURDISTAN_STATIONS,
  WEATHER_SAMPLE_POINTS,
  KurdistanWeatherPayload,
  mapWmoToCondition
} from '../services/weatherService';
import {
  getRealKurdistanElevation,
  MIN_LON,
  MAX_LON,
  MIN_LAT,
  MAX_LAT,
  DOMAIN_WIDTH_METERS,
  DOMAIN_HEIGHT_METERS,
  HALF_DOMAIN_WIDTH,
  HALF_DOMAIN_HEIGHT
} from './realSulaymaniyahTerrain';

export const CHUNK_GRID_COLS = ['A', 'B', 'C', 'D'];
export const CHUNK_GRID_ROWS = [1, 2, 3, 4];

/**
 * NON-UNIFORM chunk layout centred on Erbil.
 *
 * Axis splits in km from the domain centre. The two middle bands are narrow (300 km) and
 * the outer two wide (500 km), so the same 16 chunks tile the 1600 km map while the CENTRE
 * gets mesh resolution the rim does not need. A uniform grid spends the triangle budget
 * evenly, which is what left the mountains smoothed off.
 *
 *   splits: -800 | -300 | 0 | +300 | +800
 *   bands :  500  | 300 | 300 | 300 | 500
 */
export const CHUNK_AXIS_SPLITS_KM = [-800, -300, 0, 300, 800];

/** Target vertex spacing per ring, metres: fine centre, coarse rim. */
export const CHUNK_TARGET_SPACING_M = { centre: 1500, middle: 2500, outer: 4000 } as const;

export function chunkExtentKm(index: number): { startKm: number; sizeKm: number } {
  const s = CHUNK_AXIS_SPLITS_KM;
  return { startKm: s[index], sizeKm: s[index + 1] - s[index] };
}

/** Mesh subdivisions for a chunk, from its ring index (0 = centre block, 2 = outer rim). */
export function chunkSubdivisionsFor(ring: number, widthMeters: number, heightMeters: number): number {
  const spacing =
    ring === 0
      ? CHUNK_TARGET_SPACING_M.centre
      : ring === 1
        ? CHUNK_TARGET_SPACING_M.middle
        : CHUNK_TARGET_SPACING_M.outer;
  return Math.max(24, Math.round(Math.max(widthMeters, heightMeters) / spacing));
}

// Nominal size, kept for compatibility with code that still asks for one.
export const CHUNK_WIDTH_METERS = 300000;
export const CHUNK_HEIGHT_METERS = 300000;
export const CHUNK_SIZE_METERS = 300000;

export const KURDISTAN_SECTOR_NAMES: Record<string, string> = {
  A1: 'Black Sea Coast & North Anatolia (Samsun • Trabzon)',
  B1: 'Northeast Anatolia & Georgia (Kars • Batumi)',
  C1: 'South Caucasus & Azerbaijan (Tbilisi • Ganja)',
  D1: 'Caspian Sea & Baku',

  A2: 'Central Anatolia (Kayseri • Malatya)',
  B2: 'North Kurdistan (Diyarbakir • Batman • Van)',
  C2: 'West Iran & Lake Urmia (Tabriz • Urmia)',
  D2: 'South Caspian & Alborz (Rasht)',

  A3: 'Syria & the Levant (Aleppo • Homs • Palmyra)',
  B3: 'Nineveh & Erbil Plain (Mosul • Erbil)',
  C3: 'Zagros: Sulaymaniyah & Kermanshah',
  D3: 'Central Iran & Tehran',

  A4: 'Jordan & North Arabia (Amman)',
  B4: 'West Iraq & the Euphrates',
  C4: 'South Iraq & Basra',
  D4: 'Persian Gulf & Kuwait'
};


export function generateInitialChunkGrid(
  weatherPayload?: KurdistanWeatherPayload | null,
  hourOffset = 0
): GridChunkData[] {
  const chunks: GridChunkData[] = [];

  for (let r = 0; r < CHUNK_GRID_ROWS.length; r++) {
    for (let c = 0; c < CHUNK_GRID_COLS.length; c++) {
      const colLetter = CHUNK_GRID_COLS[c];
      const rowNum = CHUNK_GRID_ROWS[r];
      const id = `${colLetter}${rowNum}`;

      // Real extent of this chunk from the non-uniform split table.
      const colExtent = chunkExtentKm(c);
      const rowExtent = chunkExtentKm(r);
      const widthMeters = colExtent.sizeKm * 1000;
      const heightMeters = rowExtent.sizeKm * 1000;

      // Chunk CENTRE in metres relative to the domain centre.
      const gridX = (colExtent.startKm + colExtent.sizeKm / 2) * 1000;
      const gridY = (rowExtent.startKm + rowExtent.sizeKm / 2) * 1000;

      // Ring index drives mesh density: 0 = central block, 1 = middle band, 2 = outer rim.
      const ringDistance = Math.max(Math.abs(c - 1.5), Math.abs(r - 1.5));
      const ringIndex = ringDistance < 1 ? 0 : ringDistance < 1.6 ? 1 : 2;
      const subdivisions = chunkSubdivisionsFor(ringIndex, widthMeters, heightMeters);

      // Real terrain elevation peak in this chunk
      const centerElevation = Math.round(getRealKurdistanElevation(gridX, gridY));

      let condition: WeatherCondition = 'partly_cloudy';
      let badge: string | undefined = undefined;
      let cloudDensity = 0.20;
      let rainIntensity = 0.0;
      let precipitationMm = 0.0;
      let temperature = 24;

      if (weatherPayload && weatherPayload.stations.length > 0) {
        // Normalised position of this chunk's CENTRE in the domain. The old c/3, r/3
        // assumed a uniform grid; with non-uniform chunks it samples the weather field
        // from the wrong place.
        const u = (gridX + HALF_DOMAIN_WIDTH) / DOMAIN_WIDTH_METERS;
        const v = (gridY + HALF_DOMAIN_HEIGHT) / DOMAIN_HEIGHT_METERS;

        let totalWeight = 0;
        let weightedTemp = 0;
        let weightedCloud = 0;
        let weightedPrecip = 0;
        let dominantCode = 0;
        let minStationDist = 999;
        let nearestStation = weatherPayload.stations[0];

        const hourIdx = Math.max(0, Math.min(23, weatherPayload.currentHourIndex + hourOffset));

        weatherPayload.stations.forEach((st, sIdx) => {
          const meta = WEATHER_SAMPLE_POINTS[sIdx] || KURDISTAN_STATIONS[0];
          const stU = (meta.lon - MIN_LON) / (MAX_LON - MIN_LON);
          const stV = (MAX_LAT - meta.lat) / (MAX_LAT - MIN_LAT);
          const dist = Math.hypot(u - stU, v - stV) + 0.12;
          const weight = 1.0 / (dist * dist);

          const sTemp = weatherPayload.hourly.temperatures[sIdx]?.[hourIdx] ?? st.temperature;
          const sCloud = (weatherPayload.hourly.cloudCovers[sIdx]?.[hourIdx] ?? st.cloudCover) / 100.0;
          const sPrecip = (weatherPayload.hourly.precipitations[sIdx]?.[hourIdx] ?? st.precipitation);
          const sCode = weatherPayload.hourly.weatherCodes[sIdx]?.[hourIdx] ?? st.weatherCode;

          weightedTemp += sTemp * weight;
          weightedCloud += sCloud * weight;
          weightedPrecip += sPrecip * weight;
          totalWeight += weight;

          if (dist < minStationDist) {
            minStationDist = dist;
            dominantCode = sCode;
            nearestStation = st;
          }
        });

        temperature = Math.round((weightedTemp / totalWeight) * 10) / 10;
        cloudDensity = Math.min(1.0, Math.max(0.0, weightedCloud / totalWeight));
        precipitationMm = weightedPrecip / totalWeight;

        if (precipitationMm > 0.1) {
          rainIntensity = Math.min(1.0, (precipitationMm - 0.1) / 6.0);
        } else {
          rainIntensity = 0.0;
        }

        condition = mapWmoToCondition(dominantCode);

        // Special regional badges
        if (id === 'D1') badge = 'Mount Halgurd 3,607m';
        else if (id === 'B3') badge = 'Erbil Citadel 410m';
        else if (id === 'C3') badge = 'Lake Dukan Reservoir 516m';
        else if (id === 'D3') badge = 'Mount Goizha 1,520m';
        else if (id === 'B1') badge = 'Amadiya Citadel Mesa 1,200m';
        else if (id === 'D4') badge = 'Hawraman Mountains 720m';
      }

      chunks.push({
        id,
        col: colLetter,
        row: rowNum,
        label: KURDISTAN_SECTOR_NAMES[id] || `Kurdistan Sector ${id}`,
        gridX,
        gridY,
        widthMeters,
        heightMeters,
        subdivisions,
        condition,
        badge,
        cloudDensity,
        rainIntensity,
        precipitationMm,
        temperature,
        elevationPeak: centerElevation
      });
    }
  }

  return chunks;
}

/**
 * Creates and fills a THREE.DataTexture with real Kurdistan multi-channel weather data:
 * R: Cloud Density (0..255)
 * G: Rain Intensity (0..255)
 * B: Temperature (0..255)
 * A: Storm Lightning / Reflectivity
 */
export function createWeatherDataTexture(
  size = 1024,
  weatherPayload?: KurdistanWeatherPayload | null
): { texture: THREE.DataTexture; rawData: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  const hourIdx = weatherPayload ? weatherPayload.currentHourIndex : 0;

  for (let y = 0; y < size; y++) {
    const v = y / size; // North to South
    for (let x = 0; x < size; x++) {
      const u = x / size; // West to East
      const idx = (y * size + x) * 4;

      let cloud = 0.15;
      let rain = 0.0;
      let tempC = 24;

      if (weatherPayload && weatherPayload.stations.length > 0) {
        let totalWeight = 0;
        let weightedCloud = 0;
        let weightedPrecip = 0;
        let weightedTemp = 0;

        weatherPayload.stations.forEach((st, sIdx) => {
          const meta = WEATHER_SAMPLE_POINTS[sIdx] || KURDISTAN_STATIONS[0];
          const stU = (meta.lon - MIN_LON) / (MAX_LON - MIN_LON);
          const stV = (MAX_LAT - meta.lat) / (MAX_LAT - MIN_LAT);

          const dx = u - stU;
          const dy = v - stV;
          const d2 = dx * dx + dy * dy + 0.015;
          const weight = 1.0 / d2;

          const sCloud = (weatherPayload.hourly.cloudCovers[sIdx]?.[hourIdx] ?? st.cloudCover) / 100.0;
          const sPrecip = weatherPayload.hourly.precipitations[sIdx]?.[hourIdx] ?? st.precipitation;
          const sTemp = weatherPayload.hourly.temperatures[sIdx]?.[hourIdx] ?? st.temperature;

          weightedCloud += sCloud * weight;
          weightedPrecip += sPrecip * weight;
          weightedTemp += sTemp * weight;
          totalWeight += weight;
        });

        const baseCloud = weightedCloud / totalWeight;
        const basePrecip = weightedPrecip / totalWeight;
        tempC = weightedTemp / totalWeight;

        if (baseCloud > 0.08) {
          const turbulence = Math.sin(u * 14.0 + v * 12.0) * Math.cos(u * 20.0 - v * 15.0) * 0.15;
          cloud = Math.min(1.0, Math.max(0.0, Math.pow(baseCloud, 0.8) * 1.25 + turbulence));
        } else {
          cloud = 0.0;
        }

        if (basePrecip > 0.1) {
          rain = Math.min(1.0, Math.max(0.0, (basePrecip - 0.1) / 7.0));
        } else {
          rain = 0.0;
        }
      }

      data[idx] = Math.round(cloud * 255);
      data[idx + 1] = Math.round(rain * 255);
      const normTemp = Math.min(1.0, Math.max(0.0, (tempC + 5) / 47.0));
      data[idx + 2] = Math.round(normTemp * 255);
      data[idx + 3] = rain > 0.5 ? 255 : Math.round(rain * 150);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  return { texture, rawData: data };
}

export interface TimelineKeyframe {
  hourOffset: number;
  displayTime: string;
  overallCondition: string;
  temperatureAvg: number;
  windSpeedKmh: number;
}

export const TIMELINE_KEYFRAMES: TimelineKeyframe[] = [
  { hourOffset: 0, displayTime: 'Now', overallCondition: 'Partly Cloudy', temperatureAvg: 28, windSpeedKmh: 9 },
  { hourOffset: 6, displayTime: '+6h', overallCondition: 'Clear', temperatureAvg: 26, windSpeedKmh: 8 },
  { hourOffset: 12, displayTime: '+12h', overallCondition: 'Sunny', temperatureAvg: 31, windSpeedKmh: 11 },
  { hourOffset: 24, displayTime: '+24h', overallCondition: 'Scattered Showers', temperatureAvg: 27, windSpeedKmh: 12 },
  { hourOffset: 48, displayTime: '+48h', overallCondition: 'Partly Cloudy', temperatureAvg: 29, windSpeedKmh: 10 },
  { hourOffset: 72, displayTime: '+72h', overallCondition: 'Clear', temperatureAvg: 30, windSpeedKmh: 9 }
];

