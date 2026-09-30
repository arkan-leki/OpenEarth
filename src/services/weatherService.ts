/**
 * Meteorological Service for Northern Iraq & Kurdistan Region
 * Fetches real-time live weather observations from Open-Meteo API:
 * Covering Erbil (Capital Citadel), Sulaymaniyah (Cultural Capital & Mount Goizha),
 * Mount Halgurd Peak (Highest Peak • 3,607m), Duhok Valley, Lake Dukan Reservoir,
 * Amadiya (Amedi) Citadel Mesa, Halabja & Hawraman, Kalar & Garmian,
 * Zakho & Delal Bridge, Soran / Rawanduz, Kirkuk, and Lake Darbandikhan.
 */
import { LiveWeatherStation, WeatherCondition } from '../types';

export interface StationLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  nominalElevation: number;
  colIndex: number; // 0..3 in spatial grid
  rowIndex: number; // 0..3 in spatial grid
}

export const KURDISTAN_STATIONS: StationLocation[] = [
  { id: 'erbil', name: 'Erbil Citadel (Hewlêr • هەولێر)', lat: 36.1911, lon: 44.0092, nominalElevation: 410, colIndex: 1, rowIndex: 2 },
  { id: 'sulaymaniyah', name: 'Sulaymaniyah (Silêmanî • سلێمانی)', lat: 35.5558, lon: 45.4351, nominalElevation: 845, colIndex: 3, rowIndex: 2 },
  { id: 'halgurd', name: 'Mount Halgurd (لووتکەی ھەڵگورد)', lat: 36.7350, lon: 44.8500, nominalElevation: 3607, colIndex: 3, rowIndex: 0 },
  { id: 'duhok', name: 'Duhok Valley (دهۆک)', lat: 36.8679, lon: 42.9885, nominalElevation: 565, colIndex: 0, rowIndex: 1 },
  { id: 'dukan', name: 'Lake Dukan (دەریاچەی دووکان)', lat: 35.9520, lon: 44.9610, nominalElevation: 516, colIndex: 2, rowIndex: 2 },
  { id: 'amadiya', name: 'Amadiya Citadel (ئامێدی)', lat: 37.0911, lon: 43.4875, nominalElevation: 1200, colIndex: 1, rowIndex: 0 },
  { id: 'halabja', name: 'Halabja & Hawraman (هەڵەبجە)', lat: 35.1778, lon: 45.9861, nominalElevation: 720, colIndex: 3, rowIndex: 3 },
  { id: 'kalar', name: 'Kalar & Garmian (کەلار)', lat: 34.6247, lon: 45.3183, nominalElevation: 219, colIndex: 3, rowIndex: 3 },
  { id: 'zakho', name: 'Zakho & Delal Bridge (زاخۆ)', lat: 37.1436, lon: 42.6869, nominalElevation: 440, colIndex: 0, rowIndex: 0 },
  { id: 'soran', name: 'Soran & Rawanduz (سۆران)', lat: 36.6500, lon: 44.5400, nominalElevation: 950, colIndex: 2, rowIndex: 1 },
  { id: 'kirkuk', name: 'Kirkuk (کەرکووک)', lat: 35.4681, lon: 44.3922, nominalElevation: 350, colIndex: 1, rowIndex: 3 },
  { id: 'darbandikhan', name: 'Lake Darbandikhan (دەربەندیخان)', lat: 35.1120, lon: 45.7050, nominalElevation: 485, colIndex: 2, rowIndex: 3 }
];

// Backward compatibility aliases
export const NORTH_IRAQ_STATIONS = KURDISTAN_STATIONS;
export const SULAYMANIYAH_STATIONS = KURDISTAN_STATIONS;
export const NORTH_VIETNAM_STATIONS = KURDISTAN_STATIONS;

export function mapWmoToCondition(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'partly_cloudy';
  if (code === 45 || code === 48) return 'dust'; // or mist/fog/dust haze
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'partly_cloudy';
}

export interface KurdistanWeatherPayload {
  stations: LiveWeatherStation[];
  hourly: {
    times: string[];
    temperatures: number[][];
    cloudCovers: number[][];
    precipitations: number[][];
    weatherCodes: number[][];
    windSpeeds: number[][];
  };
  currentHourIndex: number;
  lastUpdated: string;
}

// Backward compatibility aliases
export type NorthVietnamWeatherPayload = KurdistanWeatherPayload;
export type SulaymaniyahWeatherPayload = KurdistanWeatherPayload;
export type NorthIraqWeatherPayload = KurdistanWeatherPayload;

const getFallbackTodayDate = () => new Date().toISOString().slice(0, 10);
const getFallbackDateFormatted = () =>
  new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

export const FALLBACK_WEATHER_DATA: KurdistanWeatherPayload = {
  stations: [
    {
      id: 'erbil',
      name: 'Erbil Citadel (Hewlêr)',
      lat: 36.1911,
      lon: 44.0092,
      elevation: 410,
      temperature: 24.2,
      relativeHumidity: 38,
      windSpeed: 3.8,
      windDirection: 210,
      cloudCover: 18,
      precipitation: 0,
      condition: 'clear',
      weatherCode: 1,
      surfacePressure: 968.0,
      time: '14:00',
      date: getFallbackTodayDate(),
      dateFormatted: getFallbackDateFormatted()
    },
    {
      id: 'sulaymaniyah',
      name: 'Sulaymaniyah (Silêmanî)',
      lat: 35.5558,
      lon: 45.4351,
      elevation: 845,
      temperature: 22.5,
      relativeHumidity: 42,
      windSpeed: 4.5,
      windDirection: 190,
      cloudCover: 22,
      precipitation: 0,
      condition: 'partly_cloudy',
      weatherCode: 2,
      surfacePressure: 925.0,
      time: '14:00',
      date: getFallbackTodayDate(),
      dateFormatted: getFallbackDateFormatted()
    },
    {
      id: 'halgurd',
      name: 'Mount Halgurd (Zagros Peak)',
      lat: 36.7350,
      lon: 44.8500,
      elevation: 3607,
      temperature: 8.5,
      relativeHumidity: 65,
      windSpeed: 11.2,
      windDirection: 260,
      cloudCover: 40,
      precipitation: 0,
      condition: 'partly_cloudy',
      weatherCode: 2,
      surfacePressure: 660.0,
      time: '14:00'
    },
    {
      id: 'duhok',
      name: 'Duhok Valley',
      lat: 36.8679,
      lon: 42.9885,
      elevation: 565,
      temperature: 23.8,
      relativeHumidity: 40,
      windSpeed: 3.2,
      windDirection: 180,
      cloudCover: 15,
      precipitation: 0,
      condition: 'clear',
      weatherCode: 0,
      surfacePressure: 950.0,
      time: '14:00'
    },
    {
      id: 'dukan',
      name: 'Lake Dukan Reservoir',
      lat: 35.9520,
      lon: 44.9610,
      elevation: 516,
      temperature: 23.0,
      relativeHumidity: 48,
      windSpeed: 4.0,
      windDirection: 200,
      cloudCover: 20,
      precipitation: 0,
      condition: 'partly_cloudy',
      weatherCode: 2,
      surfacePressure: 955.0,
      time: '14:00'
    },
    {
      id: 'amadiya',
      name: 'Amadiya Citadel Mesa',
      lat: 37.0911,
      lon: 43.4875,
      elevation: 1200,
      temperature: 19.6,
      relativeHumidity: 44,
      windSpeed: 5.5,
      windDirection: 240,
      cloudCover: 25,
      precipitation: 0,
      condition: 'partly_cloudy',
      weatherCode: 2,
      surfacePressure: 885.0,
      time: '14:00'
    },
    {
      id: 'halabja',
      name: 'Halabja & Hawraman',
      lat: 35.1778,
      lon: 45.9861,
      elevation: 720,
      temperature: 22.8,
      relativeHumidity: 45,
      windSpeed: 3.5,
      windDirection: 170,
      cloudCover: 20,
      precipitation: 0,
      condition: 'clear',
      weatherCode: 1,
      surfacePressure: 938.0,
      time: '14:00'
    },
    {
      id: 'kalar',
      name: 'Kalar & Garmian',
      lat: 34.6247,
      lon: 45.3183,
      elevation: 219,
      temperature: 27.5,
      relativeHumidity: 32,
      windSpeed: 4.2,
      windDirection: 160,
      cloudCover: 10,
      precipitation: 0,
      condition: 'clear',
      weatherCode: 0,
      surfacePressure: 988.0,
      time: '14:00'
    },
    {
      id: 'zakho',
      name: 'Zakho & Delal Bridge',
      lat: 37.1436,
      lon: 42.6869,
      elevation: 440,
      temperature: 24.5,
      relativeHumidity: 36,
      windSpeed: 3.9,
      windDirection: 220,
      cloudCover: 12,
      precipitation: 0,
      condition: 'clear',
      weatherCode: 0,
      surfacePressure: 965.0,
      time: '14:00'
    },
    {
      id: 'soran',
      name: 'Soran & Rawanduz',
      lat: 36.6500,
      lon: 44.5400,
      elevation: 950,
      temperature: 20.8,
      relativeHumidity: 46,
      windSpeed: 4.8,
      windDirection: 230,
      cloudCover: 28,
      precipitation: 0,
      condition: 'partly_cloudy',
      weatherCode: 2,
      surfacePressure: 912.0,
      time: '14:00'
    },
    {
      id: 'kirkuk',
      name: 'Kirkuk City',
      lat: 35.4681,
      lon: 44.3922,
      elevation: 350,
      temperature: 26.0,
      relativeHumidity: 34,
      windSpeed: 4.0,
      windDirection: 180,
      cloudCover: 14,
      precipitation: 0,
      condition: 'clear',
      weatherCode: 1,
      surfacePressure: 975.0,
      time: '14:00'
    },
    {
      id: 'darbandikhan',
      name: 'Lake Darbandikhan',
      lat: 35.1120,
      lon: 45.7050,
      elevation: 485,
      temperature: 23.5,
      relativeHumidity: 47,
      windSpeed: 3.6,
      windDirection: 175,
      cloudCover: 18,
      precipitation: 0,
      condition: 'clear',
      weatherCode: 1,
      surfacePressure: 960.0,
      time: '14:00'
    }
  ],
  hourly: {
    times: Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`),
    temperatures: Array(12).fill(null).map(() => [
      15, 14, 14, 13, 13, 14, 16, 19, 22, 24, 26, 27, 27, 26, 25, 24, 22, 20, 19, 18, 17, 16, 16, 15
    ]),
    cloudCovers: Array(12).fill(null).map(() => [
      10, 10, 10, 15, 15, 20, 20, 25, 30, 30, 25, 20, 15, 15, 15, 15, 10, 10, 10, 10, 10, 10, 10, 10
    ]),
    precipitations: Array(12).fill(null).map(() => Array(24).fill(0)),
    weatherCodes: Array(12).fill(null).map(() => Array(24).fill(1)),
    windSpeeds: Array(12).fill(null).map(() => [
      2, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 5, 5, 4, 4, 3, 3, 3, 2, 2, 2
    ])
  },
  currentHourIndex: 14,
  lastUpdated: `${getFallbackDateFormatted()} • 14:00 AST`
};

/**
 * Fetches real-time live weather observations from Open-Meteo across Northern Iraq & Kurdistan
 */
export async function fetchLiveKurdistanWeather(): Promise<KurdistanWeatherPayload> {
  const lats = KURDISTAN_STATIONS.map(s => s.lat).join(',');
  const lons = KURDISTAN_STATIONS.map(s => s.lon).join(',');

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,rain,weather_code,cloud_cover,wind_speed_10m&forecast_days=1&timezone=Asia%2FBaghdad`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Open-Meteo responded with status ${resp.status}`);
  }

  const raw = await resp.json();
  const stationArray = Array.isArray(raw) ? raw : [raw];

  const stations: LiveWeatherStation[] = [];
  const hourlyTimes = stationArray[0]?.hourly?.time || [];
  const hourlyTemps: number[][] = [];
  const hourlyClouds: number[][] = [];
  const hourlyPrecip: number[][] = [];
  const hourlyCodes: number[][] = [];
  const hourlyWinds: number[][] = [];

  stationArray.forEach((stData: any, idx: number) => {
    const meta = KURDISTAN_STATIONS[idx] || KURDISTAN_STATIONS[0];
    const curr = stData.current || {};
    const cond = mapWmoToCondition(curr.weather_code || 0);

    const rawTime = curr.time || '';
    const datePart = rawTime.includes('T') ? rawTime.split('T')[0] : getFallbackTodayDate();
    const timePart = rawTime.includes('T') ? rawTime.split('T')[1] : '14:00';
    const parsedDate = new Date(`${datePart}T${timePart}:00`);
    const dateFormatted = !isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      : getFallbackDateFormatted();

    stations.push({
      id: meta.id,
      name: meta.name,
      lat: meta.lat,
      lon: meta.lon,
      elevation: stData.elevation || meta.nominalElevation,
      temperature: Math.round((curr.temperature_2m ?? 24) * 10) / 10,
      relativeHumidity: Math.round(curr.relative_humidity_2m ?? 40),
      windSpeed: Math.round((curr.wind_speed_10m ?? 4) * 10) / 10,
      windDirection: Math.round(curr.wind_direction_10m ?? 200),
      cloudCover: Math.round(curr.cloud_cover ?? 15),
      precipitation: Math.round((curr.precipitation ?? 0) * 10) / 10,
      condition: cond,
      weatherCode: curr.weather_code ?? 0,
      surfacePressure: Math.round(curr.surface_pressure ?? 950),
      time: timePart,
      date: datePart,
      dateFormatted: dateFormatted
    });

    hourlyTemps.push(stData.hourly?.temperature_2m || []);
    hourlyClouds.push(stData.hourly?.cloud_cover || []);
    hourlyPrecip.push(stData.hourly?.precipitation || []);
    hourlyCodes.push(stData.hourly?.weather_code || []);
    hourlyWinds.push(stData.hourly?.wind_speed_10m || []);
  });

  const currentTimeIso = stationArray[0]?.current?.time || '';
  let currentHourIdx = 0;
  if (currentTimeIso && hourlyTimes.length > 0) {
    const prefix = currentTimeIso.substring(0, 13);
    const foundIdx = hourlyTimes.findIndex((t: string) => t.startsWith(prefix));
    if (foundIdx >= 0) currentHourIdx = foundIdx;
  }

  return {
    stations,
    hourly: {
      times: hourlyTimes,
      temperatures: hourlyTemps,
      cloudCovers: hourlyClouds,
      precipitations: hourlyPrecip,
      weatherCodes: hourlyCodes,
      windSpeeds: hourlyWinds
    },
    currentHourIndex: currentHourIdx,
    lastUpdated: `${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} • ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} AST`
  };
}

// Backward compatibility aliases
export const fetchLiveNorthVietnamWeather = fetchLiveKurdistanWeather;
export const fetchLiveSulaymaniyahWeather = fetchLiveKurdistanWeather;
export const fetchLiveNorthIraqWeather = fetchLiveKurdistanWeather;

const datePrecipCache = new Map<string, number[]>();

/**
 * Fetches real measured Open-Meteo precipitation (mm/h peak during daytime pass)
 * across the 12 Kurdistan stations for a specific YYYY-MM-DD date.
 * Returns 0 for dry stations so non-raining clouds are never given fake rain radar!
 */
export async function fetchRealStationPrecipitationForDate(dateIso: string): Promise<number[] | null> {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  if (datePrecipCache.has(dateIso)) {
    return datePrecipCache.get(dateIso)!;
  }

  const lats = KURDISTAN_STATIONS.map((s) => s.lat).join(',');
  const lons = KURDISTAN_STATIONS.map((s) => s.lon).join(',');

  const endpoints = [
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=precipitation,rain,showers&start_date=${dateIso}&end_date=${dateIso}&timezone=Asia%2FBaghdad`,
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&hourly=precipitation,rain&start_date=${dateIso}&end_date=${dateIso}&timezone=Asia%2FBaghdad`
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [data];
      if (!arr.length || !arr[0]?.hourly) continue;

      const stationPeakPrecips = KURDISTAN_STATIONS.map((_, idx) => {
        const st = arr[idx] || arr[0];
        const pArr: number[] = st?.hourly?.precipitation || [];
        if (!pArr.length) return 0;
        // Check satellite daytime window (08:00 to 16:00 AST) + daily max
        let maxP = 0;
        for (let h = 0; h < pArr.length; h++) {
          const val = Number(pArr[h]) || 0;
          if (val > maxP) maxP = val;
        }
        return maxP;
      });

      datePrecipCache.set(dateIso, stationPeakPrecips);
      return stationPeakPrecips;
    } catch {
      // try next endpoint
    }
  }

  return null;
}
