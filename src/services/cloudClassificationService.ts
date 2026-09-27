import { WeatherMode } from '../types';
import { SulaymaniyahWeatherPayload } from './weatherService';

export type CloudClassificationType =
  | 'cumulus_humilis'     // ☁️ Fair-Weather Cumulus (Flat base, rounded puffy cotton balls)
  | 'cumulus_congestus'   // ☁️ Towering Mountain Cumulus (Bulging buoyant cauliflower billows)
  | 'cumulonimbus'        // ⛈️ Deep Convective Storm / Anvil Head
  | 'altocumulus'         // ☁️ Mid-Altitude Puffy Rolls / Mackerel Sky
  | 'cirrus'              // 🌤️ High Wispy Ice Veils
  | 'clear_sky';          // ☀️ Clear Sky with isolated mountain thermal puffs

export interface CloudClassification {
  type: CloudClassificationType;
  displayName: string;
  emoji: string;
  description: string;
  baseAltitudeM: number;
  topAltitudeM: number;
  thicknessM: number;
  worleyFrequency: number;
  puffyFactor: number;
  flatBaseSharpness: number;
  domeRoundness: number;
  densityBoost: number;
  hasAnvil: boolean;
  hasLightning: boolean;
}

/**
 * High-accuracy meteorological classification profiles for distinct cloud genera.
 * Derived from WMO (World Meteorological Organization) cloud atlas standards.
 */
export const CLOUD_PROFILES: Record<CloudClassificationType, CloudClassification> = {
  cumulus_humilis: {
    type: 'cumulus_humilis',
    displayName: 'Cumulus Humilis (Connected Fair-Weather Cloud Decks)',
    emoji: '☁️',
    description: 'Flat-bottomed cumulus formations and connected decks with rounded billowy dome tops matching satellite coverage.',
    baseAltitudeM: 4400,
    topAltitudeM: 6400,
    thicknessM: 2000,
    worleyFrequency: 0.00045,
    puffyFactor: 0.88,
    flatBaseSharpness: 0.16,
    domeRoundness: 0.88,
    densityBoost: 1.35,
    hasAnvil: false,
    hasLightning: false,
  },
  cumulus_congestus: {
    type: 'cumulus_congestus',
    displayName: 'Cumulus Congestus (Towering Cumulus & Connected Formations)',
    emoji: '☁️',
    description: 'Vast connected cloud formations and towering cumulus columns sculpted directly from NASA satellite passes.',
    baseAltitudeM: 4400,
    topAltitudeM: 7400,
    thicknessM: 3000,
    worleyFrequency: 0.00038,
    puffyFactor: 0.88,
    flatBaseSharpness: 0.18,
    domeRoundness: 0.88,
    densityBoost: 1.45,
    hasAnvil: false,
    hasLightning: false,
  },
  cumulonimbus: {
    type: 'cumulonimbus',
    displayName: 'Cumulonimbus (Massive Storm Systems & Convective Shields)',
    emoji: '⛈️',
    description: 'Vast connected storm shields and towering deep convective columns across Kurdistan mountain ranges.',
    baseAltitudeM: 4200,
    topAltitudeM: 9600,
    thicknessM: 5400,
    worleyFrequency: 0.00032,
    puffyFactor: 0.90,
    flatBaseSharpness: 0.20,
    domeRoundness: 0.85,
    densityBoost: 1.55,
    hasAnvil: true,
    hasLightning: true,
  },
  altocumulus: {
    type: 'altocumulus',
    displayName: 'Altocumulus (Stratified Cloud Sheets)',
    emoji: '☁️',
    description: 'Mid-troposphere rolls and expansive stratified cloud sheets.',
    baseAltitudeM: 5200,
    topAltitudeM: 7200,
    thicknessM: 2000,
    worleyFrequency: 0.00055,
    puffyFactor: 0.75,
    flatBaseSharpness: 0.18,
    domeRoundness: 0.78,
    densityBoost: 1.20,
    hasAnvil: false,
    hasLightning: false,
  },
  cirrus: {
    type: 'cirrus',
    displayName: 'Cirrus (High Wispy Ice Veil)',
    emoji: '🌤️',
    description: 'High-altitude fibrous ice crystals and wispy streaks trailing across the sky.',
    baseAltitudeM: 7400,
    topAltitudeM: 9200,
    thicknessM: 1800,
    worleyFrequency: 0.00028,
    puffyFactor: 0.45,
    flatBaseSharpness: 0.22,
    domeRoundness: 0.55,
    densityBoost: 1.05,
    hasAnvil: false,
    hasLightning: false,
  },
  clear_sky: {
    type: 'clear_sky',
    displayName: 'Clear Sky (Isolated Mountain Thermal Puffs)',
    emoji: '☀️',
    description: 'Pristine atmosphere with occasional thermal puffs on high peaks.',
    baseAltitudeM: 4600,
    topAltitudeM: 6200,
    thicknessM: 1600,
    worleyFrequency: 0.00050,
    puffyFactor: 0.65,
    flatBaseSharpness: 0.15,
    domeRoundness: 0.80,
    densityBoost: 1.05,
    hasAnvil: false,
    hasLightning: false,
  }
};

/**
 * Computes the real meteorological Cloud Base Altitude (Lifting Condensation Level - LCL)
 * from live station temperature and relative humidity using Espy's / WMO equation:
 *   LCL_AGL (m) = 125 * (T - T_dew)
 * Combined with the regional mountain elevation baseline so clouds always sit above the Zagros peaks.
 */
export function computeRealCloudBaseMeters(weatherPayload?: SulaymaniyahWeatherPayload | null): number {
  if (!weatherPayload?.stations || weatherPayload.stations.length === 0) {
    return 4500;
  }
  const stations = weatherPayload.stations;
  const avgTemp = stations.reduce((acc, s) => acc + (s.temperature ?? 24), 0) / stations.length;
  const avgRh = Math.max(15, Math.min(98, stations.reduce((acc, s) => acc + (s.humidity ?? 40), 0) / stations.length));

  // Magnus-Tetens dewpoint approximation
  const alpha = (17.27 * avgTemp) / (237.7 + avgTemp) + Math.log(avgRh / 100.0);
  const dewPoint = (237.7 * alpha) / (17.27 - alpha);

  // Espy's LCL formula: 125m per 1°C of temperature-dewpoint spread
  const lclAgl = Math.max(1200, Math.min(3400, 125.0 * Math.max(0, avgTemp - dewPoint)));

  // Add Kurdistan regional mountain plateau + Zagros clearance baseline (~2200m)
  return Math.round(Math.max(4200, Math.min(5600, 2200 + lclAgl)));
}

/**
 * Historical cloud classification mapping for the 10 NASA MODIS daily satellite images.
 */
export const NASA_HISTORY_CLASSIFICATIONS: Record<string, CloudClassificationType> = {
  '2026-09-07': 'cumulonimbus',       // 14% cloud cover: Giant convective frontal squall line & anvil
  '2026-09-08': 'cumulus_congestus', // 4% cloud cover: Towering mountain orographic cauliflowers
  '2026-09-11': 'altocumulus',        // 2% cloud cover: Clustered puffy altocumulus rolls over valleys
  '2026-09-06': 'cirrus',             // 2% cloud cover: High northern anvil blowoff streaks
  '2026-09-12': 'cumulus_humilis',    // 0.6% cloud cover: Classic fair-weather ☁️ cotton puffs
  '2026-09-13': 'cumulus_humilis',    // 0.5% cloud cover: Scattered ☁️ puffs
  '2026-09-14': 'cumulus_humilis',    // 0.3% cloud cover: Isolated fair-weather ☁️ puffs
  '2026-09-15': 'clear_sky',          // 0.02% cloud cover: Pristine clear sky
  '2026-09-10': 'clear_sky',          // 0.02% cloud cover: Dry sunny autumn thermal
  '2026-09-09': 'clear_sky',          // 0.02% cloud cover: Desert high-pressure clear sky
};

/**
 * Dynamically identifies the cloud classification based on satellite date or synoptic observations.
 */
export function identifyCloudClassification(
  mode: WeatherMode,
  historyDate: string,
  weatherPayload?: SulaymaniyahWeatherPayload | null,
  forecastHourOffset: number = 0
): CloudClassification {
  if (mode === 'history') {
    const cloudType = NASA_HISTORY_CLASSIFICATIONS[historyDate] || 'cumulus_humilis';
    return CLOUD_PROFILES[cloudType];
  }

  if (mode === 'forecast') {
    if (weatherPayload?.hourly?.precipitations && weatherPayload.hourly.precipitations.length > 0) {
      const hourIdx = Math.max(0, Math.min(72, weatherPayload.currentHourIndex + forecastHourOffset));
      const maxPrecip = Math.max(...weatherPayload.hourly.precipitations.map(stPrecip => stPrecip[hourIdx] ?? 0));
      const avgCloud = weatherPayload.hourly.cloudCovers.reduce((acc, stCloud) => acc + (stCloud[hourIdx] ?? 0), 0) / weatherPayload.hourly.cloudCovers.length;
      const maxCode = Math.max(...weatherPayload.hourly.weatherCodes.map(stCode => stCode[hourIdx] ?? 0));

      if (maxPrecip > 1.2 || maxCode >= 80) {
        return CLOUD_PROFILES.cumulonimbus;
      }
      if (avgCloud > 50) {
        return CLOUD_PROFILES.cumulus_congestus;
      }
      if (avgCloud > 18) {
        return CLOUD_PROFILES.cumulus_humilis;
      }
      return CLOUD_PROFILES.clear_sky;
    }

    return CLOUD_PROFILES.cumulus_humilis;
  }

  // Live Mode: Analyze Open-Meteo telemetry
  if (weatherPayload?.stations && weatherPayload.stations.length > 0) {
    const stations = weatherPayload.stations;
    const avgCloud = stations.reduce((acc, s) => acc + (s.cloudCover || 0), 0) / stations.length;
    const maxPrecip = Math.max(...stations.map(s => s.precipitation || 0));
    const maxCode = Math.max(...stations.map(s => s.weatherCode || 0));

    if (maxPrecip > 1.0 || maxCode >= 80) {
      return CLOUD_PROFILES.cumulonimbus;
    }
    if (avgCloud > 50) {
      return CLOUD_PROFILES.cumulus_congestus;
    }
    if (avgCloud > 18) {
      return CLOUD_PROFILES.cumulus_humilis;
    }
    return CLOUD_PROFILES.clear_sky;
  }

  // Default fallback: Classic fair-weather ☁️
  return CLOUD_PROFILES.cumulus_humilis;
}
