import * as THREE from 'three';

/**
 * Astronomical Solar Position Calculator for Northern Iraq & Kurdistan Region
 * Coordinates: Latitude 36.1911° N (Erbil & Central Kurdistan), Longitude 44.0092° E
 * Timezone: UTC+3 (Arabia Standard Time / AST)
 */

export const KURDISTAN_LATITUDE = 36.1911;
export const KURDISTAN_LONGITUDE = 44.0092;
export const KURDISTAN_UTC_OFFSET_HOURS = 3;

// Backward compatibility aliases
export const HANOI_LATITUDE = KURDISTAN_LATITUDE;
export const HANOI_LONGITUDE = KURDISTAN_LONGITUDE;
export const HANOI_UTC_OFFSET_HOURS = KURDISTAN_UTC_OFFSET_HOURS;

export type SolarPeriod =
  | 'night'
  | 'astronomical_twilight'
  | 'nautical_twilight'
  | 'civil_twilight'
  | 'sunrise_sunset'
  | 'golden_hour'
  | 'daylight';

export interface SunPositionResult {
  elevationDeg: number;       // Solar altitude (-90° to +90°)
  azimuthDeg: number;         // Solar azimuth (0° North, 90° East, 180° South, 270° West)
  period: SolarPeriod;
  isDaylight: boolean;
  sunDirection: THREE.Vector3; // Normalized unit vector pointing towards sun in Three.js space
  lightPosition: [number, number, number]; // Position for DirectionalLight
  lightColor: string;
  lightIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  skyColor: string;
  fogColor: string;
  cloudSunScatter: number;
  kurdistanTimeString: string;
  hanoiTimeString: string; // Backward compatibility
  solarNoonString: string;
  sunriseString: string;
  sunsetString: string;
}

/**
 * Get current Date converted to Kurdistan local time (UTC+3 AST)
 */
export function getNowInKurdistan(): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + KURDISTAN_UTC_OFFSET_HOURS * 3600000);
}

// Backward compatibility alias
export const getNowInHanoi = getNowInKurdistan;

/**
 * Create a Date object for a specific hour/minute in Kurdistan today
 */
export function createKurdistanDate(hours: number, minutes = 0, seconds = 0): Date {
  const kurdNow = getNowInKurdistan();
  kurdNow.setHours(hours, minutes, seconds, 0);
  return kurdNow;
}

// Backward compatibility alias
export const createHanoiDate = createKurdistanDate;

/**
 * High-precision NOAA Solar Position Algorithm calibrated for Kurdistan & Zagros Mountains
 */
export function calculateSolarCoordinates(date: Date, lat = KURDISTAN_LATITUDE, lon = KURDISTAN_LONGITUDE) {
  // Day of Year
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - startOfYear.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);

  // Fractional time in hours
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;

  // Fractional year in radians
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);

  // Equation of Time in minutes
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Solar declination in radians
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // Time offset in minutes
  const timeOffset = eqtime + 4 * lon - 60 * KURDISTAN_UTC_OFFSET_HOURS;

  // True solar time in minutes
  const tst = hours * 60 + timeOffset;

  // Solar hour angle in degrees
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  if (ha > 180) ha -= 360;
  const haRad = (ha * Math.PI) / 180;

  const latRad = (lat * Math.PI) / 180;

  // Solar zenith angle
  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(haRad);
  const zenithRad = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const zenithDeg = (zenithRad * 180) / Math.PI;

  // Solar altitude/elevation angle
  let elevationDeg = 90 - zenithDeg;

  // Atmospheric refraction correction for realistic golden hour horizon rays
  if (elevationDeg > -5) {
    let refr = 0;
    if (elevationDeg > 5) {
      refr = 58.1 / Math.tan((elevationDeg * Math.PI) / 180) - 0.07 / Math.pow(Math.tan((elevationDeg * Math.PI) / 180), 3) + 0.000086 / Math.pow(Math.tan((elevationDeg * Math.PI) / 180), 5);
    } else if (elevationDeg > -0.575) {
      refr = 1735 + elevationDeg * (-518.2 + elevationDeg * (103.4 + elevationDeg * (-12.79 + elevationDeg * 0.711)));
    } else {
      refr = -20.774 / Math.tan((elevationDeg * Math.PI) / 180);
    }
    refr = refr / 3600;
    elevationDeg += refr;
  }

  // Solar Azimuth Angle (clockwise from North: 0° N, 90° E, 180° S, 270° W)
  const cosAzimuth =
    (Math.sin(decl) - Math.sin(latRad) * Math.cos(zenithRad)) /
    (Math.cos(latRad) * Math.sin(zenithRad));
  let azimuthDeg = (Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) * 180) / Math.PI;
  if (ha > 0) {
    azimuthDeg = 360 - azimuthDeg;
  }

  // Approximate Sunrise & Sunset (Zenith = 90.833°)
  const cosHaSunrise =
    (Math.cos((90.833 * Math.PI) / 180) - Math.sin(latRad) * Math.sin(decl)) /
    (Math.cos(latRad) * Math.cos(decl));

  let sunriseString = '06:05';
  let sunsetString = '18:15';
  let solarNoonString = '12:10';

  if (cosHaSunrise >= -1 && cosHaSunrise <= 1) {
    const haSunriseDeg = (Math.acos(cosHaSunrise) * 180) / Math.PI;
    const sunriseTst = (180 - haSunriseDeg) * 4;
    const sunsetTst = (180 + haSunriseDeg) * 4;
    const noonTst = 180 * 4;

    const sunriseMins = sunriseTst - timeOffset;
    const sunsetMins = sunsetTst - timeOffset;
    const noonMins = noonTst - timeOffset;

    const formatTimeMinutes = (mins: number) => {
      const h = Math.floor(mins / 60) % 24;
      const m = Math.floor(mins % 60);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    sunriseString = formatTimeMinutes(sunriseMins);
    sunsetString = formatTimeMinutes(sunsetMins);
    solarNoonString = formatTimeMinutes(noonMins);
  }

  return {
    elevationDeg,
    azimuthDeg,
    sunriseString,
    sunsetString,
    solarNoonString
  };
}

/**
 * Calculate complete 3D lighting, shadow parameters, and colors for Northern Iraq & Kurdistan scene
 */
export function getKurdistanSunPosition(date: Date): SunPositionResult {
  const coords = calculateSolarCoordinates(date);
  const elev = coords.elevationDeg;
  const az = coords.azimuthDeg;

  // Determine Solar Period
  let period: SolarPeriod = 'night';
  if (elev > 10) {
    period = 'daylight';
  } else if (elev > 0) {
    period = 'golden_hour';
  } else if (elev > -1.5) {
    period = 'sunrise_sunset';
  } else if (elev > -6) {
    period = 'civil_twilight';
  } else if (elev > -12) {
    period = 'nautical_twilight';
  } else if (elev > -18) {
    period = 'astronomical_twilight';
  } else {
    period = 'night';
  }

  const isDaylight = elev > -1.0;

  // Three.js Coordinate Space Mapping:
  // X = East (+X) / West (-X)
  // Y = Altitude / Up (+Y)
  // Z = South (+Z) / North (-Z)
  // Azimuth: 0° = North (-Z), 90° = East (+X), 180° = South (+Z), 270° = West (-X)
  const azRad = (az * Math.PI) / 180;
  const elevRad = (elev * Math.PI) / 180;

  // True unit vector towards astronomical sun
  const rawSunDir = new THREE.Vector3(
    Math.sin(azRad) * Math.cos(elevRad),
    Math.sin(elevRad),
    -Math.cos(azRad) * Math.cos(elevRad)
  ).normalize();

  const LIGHT_DISTANCE = 160000;
  let lightPosVec = rawSunDir.clone();

  if (elev <= 0) {
    // Night: Moon position is roughly opposite sun for silvery Zagros mountain shadows
    const moonElevRad = THREE.MathUtils.degToRad(Math.max(22, 45 - Math.abs(elev) * 0.5));
    const moonAzRad = azRad + Math.PI;
    lightPosVec.set(
      Math.sin(moonAzRad) * Math.cos(moonElevRad),
      Math.sin(moonElevRad),
      -Math.cos(moonAzRad) * Math.cos(moonElevRad)
    ).normalize();
  } else if (elev < 8) {
    // Low sun golden hour: clamp minimum Y so light doesn't clip through bottom of ground
    const clampedElevRad = THREE.MathUtils.degToRad(Math.max(5.5, elev));
    lightPosVec.set(
      Math.sin(azRad) * Math.cos(clampedElevRad),
      Math.sin(clampedElevRad),
      -Math.cos(azRad) * Math.cos(clampedElevRad)
    ).normalize();
  }

  const lightPosition: [number, number, number] = [
    lightPosVec.x * LIGHT_DISTANCE,
    Math.max(18000, lightPosVec.y * LIGHT_DISTANCE),
    lightPosVec.z * LIGHT_DISTANCE
  ];

  // Dynamic Lighting Intensity and Colors
  let lightColor = '#fff5e6';
  let lightIntensity = 1.6;
  let ambientColor = '#dbeafe';
  let ambientIntensity = 0.65;
  let skyColor = '#0b0e14';
  let fogColor = '#0f172a';
  let cloudSunScatter = 1.5;

  if (elev > 45) {
    // High midday sun over Kurdistan
    lightColor = '#ffffff';
    lightIntensity = 1.85;
    ambientColor = '#e2e8f0';
    ambientIntensity = 0.75;
    skyColor = '#090d16';
    fogColor = '#0f172a';
    cloudSunScatter = 1.6;
  } else if (elev > 20) {
    // Standard daylight
    lightColor = '#fff8ee';
    lightIntensity = 1.7;
    ambientColor = '#dbeafe';
    ambientIntensity = 0.7;
    skyColor = '#0b1120';
    fogColor = '#111827';
    cloudSunScatter = 1.5;
  } else if (elev > 8) {
    // Late afternoon
    lightColor = '#ffeed6';
    lightIntensity = 1.55;
    ambientColor = '#fed7aa';
    ambientIntensity = 0.65;
    skyColor = '#0f172a';
    fogColor = '#1e1b4b';
    cloudSunScatter = 1.8;
  } else if (elev > 0) {
    // Golden Hour: Rich amber sunbeams casting long shadows across Mount Halgurd & Piramagrun
    lightColor = '#ff9838';
    lightIntensity = 1.95;
    ambientColor = '#c2410c';
    ambientIntensity = 0.6;
    skyColor = '#1e112a';
    fogColor = '#2e1065';
    cloudSunScatter = 2.4;
  } else if (elev > -6) {
    // Civil Twilight / Sunset Dusk: Magenta & Deep Indigo
    lightColor = '#e11d48';
    lightIntensity = 0.95;
    ambientColor = '#431407';
    ambientIntensity = 0.45;
    skyColor = '#0f0c29';
    fogColor = '#1e1b4b';
    cloudSunScatter = 1.4;
  } else if (elev > -12) {
    // Nautical Twilight: Deep Blue Hour
    lightColor = '#3b82f6';
    lightIntensity = 0.55;
    ambientColor = '#172554';
    ambientIntensity = 0.35;
    skyColor = '#050814';
    fogColor = '#0a0f24';
    cloudSunScatter = 0.9;
  } else {
    // Night: Silvery Moonlight
    lightColor = '#93c5fd';
    lightIntensity = 0.42;
    ambientColor = '#0f172a';
    ambientIntensity = 0.28;
    skyColor = '#090d1a';
    fogColor = '#0d1326';
    cloudSunScatter = 0.65;
  }

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const kurdistanTimeString = `${hours}:${minutes}:${seconds} AST`;

  return {
    elevationDeg: Math.round(elev * 10) / 10,
    azimuthDeg: Math.round(az * 10) / 10,
    period,
    isDaylight,
    sunDirection: rawSunDir,
    lightPosition,
    lightColor,
    lightIntensity,
    ambientColor,
    ambientIntensity,
    skyColor,
    fogColor,
    cloudSunScatter,
    kurdistanTimeString,
    hanoiTimeString: kurdistanTimeString,
    solarNoonString: coords.solarNoonString,
    sunriseString: coords.sunriseString,
    sunsetString: coords.sunsetString
  };
}

// Backward compatibility alias
export const getHanoiSunPosition = getKurdistanSunPosition;

/**
 * Returns fixed high-noon daytime sun position (12:00 PM in Kurdistan)
 */
export function getDaytimeSunPosition(): SunPositionResult {
  return getKurdistanSunPosition(createKurdistanDate(12, 0, 0));
}
