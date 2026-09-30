/**
 * Real Meteorological Data Pipeline for Northern Iraq & Kurdistan Region
 * Integrates live Open-Meteo observations across Erbil Citadel, Sulaymaniyah & Mount Goizha,
 * Mount Halgurd, Duhok Valley, Lake Dukan, Amadiya, and Halabja.
 */
import * as THREE from 'three';
import { GridChunkData, WeatherCondition } from '../types';
import {
  KURDISTAN_STATIONS,
  KurdistanWeatherPayload,
  mapWmoToCondition
} from '../services/weatherService';
import {
  getRealKurdistanElevation,
  MIN_LON,
  MAX_LON,
  MIN_LAT,
  MAX_LAT
} from './realSulaymaniyahTerrain';

export const CHUNK_GRID_COLS = ['A', 'B', 'C', 'D'];
export const CHUNK_GRID_ROWS = [1, 2, 3, 4];
export const CHUNK_WIDTH_METERS = 120000; // 120 km per chunk (Total: 480 km across 4 cols)
export const CHUNK_HEIGHT_METERS = 80000; // 80 km per chunk (Total: 320 km across 4 rows)
export const CHUNK_SIZE_METERS = 120000;  // Backward compatibility

export const KURDISTAN_SECTOR_NAMES: Record<string, string> = {
  A1: 'Zakho & Khabur River Valley (Delal Bridge)',
  B1: 'Amadiya (Amedi) Citadel Mesa & Gara Ridge',
  C1: 'Rawanduz Canyon & Mount Korek (Soran)',
  D1: 'Mount Halgurd (3,607m) & High Zagros Alpine',

  A2: 'Duhok Valley & Duhok Dam Reservoir',
  B2: 'Erbil Northern Plain & Great Zab Basin',
  C2: 'Ranya Plain & Mount Betwen Foothills',
  D2: 'Choman & Iranian Border Alpine Passes',

  A3: 'Nineveh Plains & Tigris River Confluence',
  B3: 'Erbil Capital City (Ancient Citadel • 410m)',
  C3: 'Lake Dukan Reservoir (Hydroelectric Dam • 516m)',
  D3: 'Sulaymaniyah & Mount Goizha / Azmar (845m)',

  A4: 'Kirkuk Citadel & Baba Gurgur Basin',
  B4: 'Taq Taq & Little Zab River Valley',
  C4: 'Lake Darbandikhan & Sirwan River Gorge',
  D4: 'Halabja & Hawraman Mountain Terraces / Kalar'
};

// Backward compatibility aliases
export const NORTH_IRAQ_SECTOR_NAMES = KURDISTAN_SECTOR_NAMES;
export const NORTH_VIETNAM_SECTOR_NAMES = KURDISTAN_SECTOR_NAMES;

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

      // Cartesian center in meters relative to (0,0) across 240km x 160km
      const gridX = (c - 1.5) * CHUNK_WIDTH_METERS;
      const gridY = (r - 1.5) * CHUNK_HEIGHT_METERS;

      // Real terrain elevation peak in this chunk
      const centerElevation = Math.round(getRealKurdistanElevation(gridX, gridY));

      let condition: WeatherCondition = 'partly_cloudy';
      let badge: string | undefined = undefined;
      let cloudDensity = 0.20;
      let rainIntensity = 0.0;
      let precipitationMm = 0.0;
      let temperature = 24;

      if (weatherPayload && weatherPayload.stations.length > 0) {
        const u = c / 3.0;
        const v = r / 3.0;

        let totalWeight = 0;
        let weightedTemp = 0;
        let weightedCloud = 0;
        let weightedPrecip = 0;
        let dominantCode = 0;
        let minStationDist = 999;
        let nearestStation = weatherPayload.stations[0];

        const hourIdx = Math.max(0, Math.min(23, weatherPayload.currentHourIndex + hourOffset));

        weatherPayload.stations.forEach((st, sIdx) => {
          const meta = KURDISTAN_STATIONS[sIdx] || KURDISTAN_STATIONS[0];
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
 * Creates and fills a THREE.DataTexture with real North Vietnam multi-channel weather data:
 * R: Cloud Density (0..255)
 * G: Rain Intensity (0..255)
 * B: Temperature (0..255)
 * A: Storm Lightning / Reflectivity
 */
export function createWeatherDataTexture(
  size = 512,
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
          const meta = KURDISTAN_STATIONS[sIdx] || KURDISTAN_STATIONS[0];
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

