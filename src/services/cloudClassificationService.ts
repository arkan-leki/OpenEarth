import { KurdistanWeatherPayload } from './weatherService';

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
export function computeRealCloudBaseMeters(weatherPayload?: KurdistanWeatherPayload | null): number {
  if (!weatherPayload?.stations || weatherPayload.stations.length === 0) {
    return 3400;
  }
  const stations = weatherPayload.stations;
  const avgTemp = stations.reduce((acc, s) => acc + (s.temperature ?? 24), 0) / stations.length;
  const avgRh = Math.max(15, Math.min(98, stations.reduce((acc, s) => acc + (s.relativeHumidity ?? 40), 0) / stations.length));

  // Magnus-Tetens dewpoint approximation
  const alpha = (17.27 * avgTemp) / (237.7 + avgTemp) + Math.log(avgRh / 100.0);
  const dewPoint = (237.7 * alpha) / (17.27 - alpha);

  // LCL spread above the 1.35x scaled Kurdistan foothill/ridge baseline (2,650m)
  const lclOffset = Math.max(550, Math.min(1150, 50.0 * Math.max(0, avgTemp - dewPoint)));

  return Math.round(Math.max(3100, Math.min(3800, 2650 + lclOffset)));
}
