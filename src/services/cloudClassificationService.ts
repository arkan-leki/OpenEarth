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
    displayName: 'Low-Level Cumulus & Stratocumulus (Surface to 6,500 ft AGL)',
    emoji: '☁️',
    description: 'Low-level stratus sheets, cellular stratocumulus blankets, and lumpy thermal cumulus clouds above valleys and ridges.',
    baseAltitudeM: 3300,
    topAltitudeM: 4900,
    thicknessM: 1600,
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
    displayName: 'Low/Mid Cumulus & Mountain Gravity Waves',
    emoji: '☁️',
    description: 'Low-to-mid level cumulus clusters, altocumulus sheets, and parallel orographic gravity-wave bands.',
    baseAltitudeM: 3400,
    topAltitudeM: 5500,
    thicknessM: 2100,
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
    displayName: 'Vertically Developed Cumulonimbus (Storm Towers & Anvils)',
    emoji: '⛈️',
    description: 'Deep convective storm clusters rising from dark rain bases to high anvil tops with heavy radar precipitation.',
    baseAltitudeM: 3100,
    topAltitudeM: 6800,
    thicknessM: 3700,
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
    displayName: 'Mid-Level Altocumulus / Altostratus (6,500 to 20,000 ft)',
    emoji: '☁️',
    description: 'Patchy, ribbed, or continuous semi-transparent mid-level layers and mountain wave ripples.',
    baseAltitudeM: 3600,
    topAltitudeM: 5400,
    thicknessM: 1800,
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
    displayName: 'High-Level Cirrus / Cirrostratus (Thin Ice Filaments)',
    emoji: '🌤️',
    description: 'Thin, wispy, semi-transparent ice-crystal streaks where ground features remain visible beneath them.',
    baseAltitudeM: 4200,
    topAltitudeM: 5800,
    thicknessM: 1600,
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
    displayName: 'Clear Sky (Isolated Low Thermal Puffs)',
    emoji: '☀️',
    description: 'Clear atmosphere with occasional low-level thermal puffs.',
    baseAltitudeM: 3300,
    topAltitudeM: 4700,
    thicknessM: 1400,
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
 * Computes the meteorologically & topographically accurate Cloud Base Altitude in 3D scene meters.
 * Accounts for the 1.35x terrain relief scale over Kurdistan's valleys (~1,100m-2,200m scaled) and
 * Zagros ridges (~2,700m-3,400m scaled) so Low/Mid clouds sit ~1,200m-1,800m AGL (~4,000-6,000 ft AGL)
 * cleanly above the ridges without clipping into mountains or floating too high.
 */
export function computeRealCloudBaseMeters(weatherPayload?: SulaymaniyahWeatherPayload | null): number {
  if (!weatherPayload?.stations || weatherPayload.stations.length === 0) {
    return 3400;
  }
  const stations = weatherPayload.stations;
  const avgTemp = stations.reduce((acc, s) => acc + (s.temperature ?? 24), 0) / stations.length;
  const avgRh = Math.max(15, Math.min(98, stations.reduce((acc, s) => acc + (s.humidity ?? 40), 0) / stations.length));

  // Magnus-Tetens dewpoint approximation
  const alpha = (17.27 * avgTemp) / (237.7 + avgTemp) + Math.log(avgRh / 100.0);
  const dewPoint = (237.7 * alpha) / (17.27 - alpha);

  // LCL spread above the 1.35x scaled Kurdistan foothill/ridge baseline (2,650m)
  const lclOffset = Math.max(550, Math.min(1150, 50.0 * Math.max(0, avgTemp - dewPoint)));

  return Math.round(Math.max(3100, Math.min(3800, 2650 + lclOffset)));
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
