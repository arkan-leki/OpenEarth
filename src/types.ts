/**
 * Types for Kalar Volumetric Weather Simulation
 */

export type WeatherCondition = 'clear' | 'partly_cloudy' | 'rain' | 'thunderstorm' | 'snow' | 'dust';

export interface GridChunkData {
  id: string; // e.g. "A1", "D3"
  col: number | string; // 0..4 or "A".."E"
  row: number;
  label: string;
  gridX: number;
  gridY: number;
  /** Chunk extent. Chunks are NON-UNIFORM: small and fine near the centre,
   *  large and coarse at the rim, so detail is spent where it is looked at. */
  widthMeters?: number;
  heightMeters?: number;
  /** Mesh subdivisions for this chunk, chosen to hit a target vertex spacing. */
  subdivisions?: number;
  condition: WeatherCondition;
  badge?: string;
  cloudDensity: number; // 0.0 - 1.0
  rainIntensity: number; // 0.0 - 1.0
  precipitationMm?: number; // Real precipitation in mm/h from Open-Meteo
  temperature: number; // Celsius (-5 to 42)
  elevationPeak: number; // meters
  elevationAvg?: number; // meters
  centerCity?: string;
}

export interface Landmark {
  id: string;
  name: string;
  subLabel?: string;
  lon?: number;
  lat?: number;
  elevationM?: number;
  region?:
    | 'north_iraq'
    | 'south_iraq'
    | 'east_turkey'
    | 'east_syria'
    | 'west_iran'
    | 'levant'
    | 'caucasus';
  position: [number, number, number];
  type: 'city' | 'water' | 'mountain' | 'weather' | 'border';
  cameraTarget?: [number, number, number];
  cameraPosition?: [number, number, number];
}

export interface ShaderParameters {
  raymarchSteps: number; // default: 48 (up to 96)
  cloudDensityMultiplier: number; // default: 1.2
  absorptionFactor: number; // default: 0.8
  sunScatterIntensity: number; // default: 1.4
  windSpeed: number; // default: 0.8
  rainThreshold: number; // default: 0.35
  snowTempThreshold: number; // default: 3.0
  cloudAltitude: number; // default: 2200
  cloudThickness: number; // default: 2800
  lightningFrequency: number; // default: 0.7
  terrainExaggeration?: number; // default: 1.25 (realistic mountain slope, prevents needle distortion)
}

export interface SystemStats {
  fps: number;
  gpuVendor: string;
  samples: number;
  textureResolution: number; // e.g. 512
  ramUsageGb: number; // e.g. 1.2
  activeChunksCount: number; // e.g. 9
  totalChunksCount: number; // e.g. 36
  drawCalls: number;
  particleCount: number;
}

export interface LiveWeatherStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  temperature: number;
  relativeHumidity: number;
  windSpeed: number;
  windDirection: number;
  cloudCover: number;
  precipitation: number;
  condition: WeatherCondition;
  weatherCode: number;
  surfacePressure: number;
  time: string;
  date?: string;
  dateFormatted?: string;
}

export type WeatherMode = 'live' | 'forecast' | 'history' | 'storm_simulation';

export interface NasaHistoryDay {
  date: string;
  label: string;
  image: string;
  clouds: string;
  cloudCoveragePct: number;
  cloudEmoji?: string;
  cloudGenus?: string;
}

export interface TimelineKeyframe {
  hourOffset: number; // -24 to +48
  label: string;
  displayTime: string;
  icon: string;
  overallCondition: string;
  temperatureAvg: number;
  windSpeedKmh: number;
  stormIntensity: number;
}

