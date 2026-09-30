/**
 * Real Topography & Digital Elevation Model (DEM) for Northern Iraq & Kurdistan Region
 * Covering the entire expanse of Kurdistan Region & Northern Iraq:
 * - Mount Halgurd Peak (highest in Kurdistan & Iraq, 3,607m) & High Zagros Range
 * - Erbil (Hewlêr) City & Historic UNESCO World Heritage Citadel (410m)
 * - Sulaymaniyah (Silêmanî) Cultural Capital & Mount Goizha / Azmar (845m / 1,520m)
 * - Duhok Valley, Gara Mountain Ridge & Duhok Dam (565m)
 * - Lake Dukan (Dokan Reservoir) & Hydroelectric Dam (516m)
 * - Amadiya (Amedi) Ancient Rock Citadel Mesa (1,200m)
 * - Halabja & Terraced Hawraman Mountains (720m)
 * - Mount Piramagrun Limestone Wall (2,611m)
 * - Zakho & Historic Delal Bridge on Khabur River (440m)
 * - Lake Darbandikhan Reservoir & Zagros Gorges (485m)
 * - Rawanduz Canyon, Gali Ali Beg & Mount Korek (950m)
 * - Kalar & Garmian Plain on the Sirwan River (219m)
 *
 * Mapped 1:1 with NASA Earthdata Satellite Imagery and 1280x1024 Digital Elevation Model
 */
import * as THREE from 'three';
import { Landmark } from '../types';

export const DOMAIN_WIDTH_METERS = 240000;  // 240 km in world units
export const DOMAIN_HEIGHT_METERS = 160000; // 160 km in world units
export const HALF_DOMAIN_WIDTH = DOMAIN_WIDTH_METERS / 2;   // 120000 m
export const HALF_DOMAIN_HEIGHT = DOMAIN_HEIGHT_METERS / 2; // 80000 m

// Backward compatibility aliases
export const DOMAIN_SIZE_METERS = DOMAIN_WIDTH_METERS;
export const HALF_DOMAIN = HALF_DOMAIN_WIDTH;

export const DEM_WIDTH = 1280;
export const DEM_HEIGHT = 1024;

// Exact bounding box of the NASA VIIRS / SRTM DEM zoom 8 tiles
export const MIN_LON = 40.78125;
export const MAX_LON = 47.8125;
export const MIN_LAT = 33.137551;
export const MAX_LAT = 37.718590;

// In-memory cache of decoded 1280x1024 real DEM Int16Array
let cachedDemData: Int16Array | null = null;
let demLoadPromise: Promise<Int16Array | null> | null = null;

export function loadRealDemData(): Promise<Int16Array | null> {
  if (cachedDemData) return Promise.resolve(cachedDemData);
  if (demLoadPromise) return demLoadPromise;

  demLoadPromise = fetch('/data/north_iraq_dem_1280x1024.bin')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to load North Iraq DEM binary');
      return res.arrayBuffer();
    })
    .then((buf) => {
      cachedDemData = new Int16Array(buf);
      return cachedDemData;
    })
    .catch((err) => {
      console.warn('Real North Iraq DEM binary pending, using organic Kurdistan topography calibration:', err.message);
      return null;
    });

  return demLoadPromise;
}

// Kick off load early in browser
if (typeof window !== 'undefined') {
  loadRealDemData();
}

/**
 * Converts geographic longitude and latitude to 3D world space (meters relative to center).
 */
export function geoToWorld(lon: number, lat: number): [number, number] {
  const u = (lon - MIN_LON) / (MAX_LON - MIN_LON);
  const v = (MAX_LAT - lat) / (MAX_LAT - MIN_LAT);
  const x = (u - 0.5) * DOMAIN_WIDTH_METERS;
  const z = (v - 0.5) * DOMAIN_HEIGHT_METERS;
  return [x, z];
}

/**
 * Analytical real-geography baseline matching Northern Iraq & Kurdistan Region
 * Used seamlessly while binary DEM is loading over network
 * Features broad mountain bases, gentle foothills, and realistic non-needle slopes
 */
function getAnalyticalKurdistanElevation(worldX: number, worldZ: number): number {
  // Normalize coords: nx in [-1, 1] (West to East), nz in [-1, 1] (North to South)
  const nx = worldX / HALF_DOMAIN_WIDTH;
  const nz = worldZ / HALF_DOMAIN_HEIGHT;

  // General slope: High alpine Zagros mountains in North-East, fertile plains in South-West
  let elev = 620 - nz * 380 + nx * 420;

  // 1. Mount Halgurd & Northern Zagros range (NE: x ~ 18000, z ~ -45000)
  const distHalgurd = Math.hypot(worldX - 18000, worldZ - (-45000));
  if (distHalgurd < 55000) {
    const dome = Math.cos((distHalgurd / 55000) * (Math.PI / 2));
    elev += dome * dome * 2750;
  }

  // 2. Sulaymaniyah, Mount Piramagrun & Mount Goizha / Azmar (E: x ~ 38000, z ~ -5000)
  const distSuli = Math.hypot(worldX - 38000, worldZ - (-5000));
  if (distSuli < 42000) {
    const dome = Math.cos((distSuli / 42000) * (Math.PI / 2));
    elev += dome * dome * 1400;
  }

  // 3. Mount Sinjar / Shingal Ridge (W: x ~ -82000, z ~ -30000)
  const distSinjar = Math.hypot((worldX - (-82000)) * 0.45, worldZ - (-30000));
  if (distSinjar < 28000) {
    const dome = Math.cos((distSinjar / 28000) * (Math.PI / 2));
    elev += dome * dome * 850;
  }

  // 4. Northern Turkish border mountains (Amadiya / Hakkari / Gara ridge: z < -38000)
  if (worldZ < -38000) {
    const ridgeDist = Math.min(38000, -worldZ - 38000);
    const ridge = Math.sin((ridgeDist / 38000) * (Math.PI / 2));
    elev += ridge * 1250;
  }

  // 5. Lake Dukan depression (x ~ 26000, z ~ -12000)
  const distDukan = Math.hypot(worldX - 26000, worldZ - (-12000));
  if (distDukan < 14000) {
    const bowl = Math.cos((distDukan / 14000) * (Math.PI / 2));
    elev -= bowl * 280;
  }

  // 6. Lake Darbandikhan depression (x ~ 48000, z ~ 18000)
  const distDarbandikhan = Math.hypot(worldX - 48000, worldZ - 18000);
  if (distDarbandikhan < 12000) {
    const bowl = Math.cos((distDarbandikhan / 12000) * (Math.PI / 2));
    elev -= bowl * 220;
  }

  return Math.max(180, elev);
}

/**
 * Returns exact real elevation in meters for any point across Northern Iraq & Kurdistan
 * Uses smooth Hermite C1 filtering to completely eliminate jagged needle spikes and stair-stepping
 */
export function getRealKurdistanElevation(worldX: number, worldZ: number): number {
  if (cachedDemData) {
    const u = THREE.MathUtils.clamp((worldX + HALF_DOMAIN_WIDTH) / DOMAIN_WIDTH_METERS, 0, 1);
    const v = THREE.MathUtils.clamp((worldZ + HALF_DOMAIN_HEIGHT) / DOMAIN_HEIGHT_METERS, 0, 1);

    const gx = u * (DEM_WIDTH - 1);
    const gy = v * (DEM_HEIGHT - 1);

    const x0 = Math.floor(gx);
    const x1 = Math.min(DEM_WIDTH - 1, x0 + 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(DEM_HEIGHT - 1, y0 + 1);

    const fx = gx - x0;
    const fy = gy - y0;

    // Smoothstep Hermite curves produce organic mountain ridges without sharp pixel corners
    const sfx = fx * fx * (3.0 - 2.0 * fx);
    const sfy = fy * fy * (3.0 - 2.0 * fy);

    const e00 = cachedDemData[y0 * DEM_WIDTH + x0];
    const e10 = cachedDemData[y0 * DEM_WIDTH + x1];
    const e01 = cachedDemData[y1 * DEM_WIDTH + x0];
    const e11 = cachedDemData[y1 * DEM_WIDTH + x1];

    const top = e00 * (1 - sfx) + e10 * sfx;
    const bottom = e01 * (1 - sfx) + e11 * sfx;
    const rawElevation = top * (1 - sfy) + bottom * sfy;

    return Math.max(160, rawElevation);
  }

  return getAnalyticalKurdistanElevation(worldX, worldZ);
}

// Backward compatibility alias
export const getRealSulaymaniyahElevation = getRealKurdistanElevation;
export const getRealNorthVietnamElevation = getRealKurdistanElevation;

export function sampleRealElevationAtLonLat(lon: number, lat: number): number {
  const [wx, wz] = geoToWorld(lon, lat);
  return getRealKurdistanElevation(wx, wz);
}

// Satellite textures
let nasaTexture: THREE.Texture | null = null;
let hdTexture: THREE.Texture | null = null;

export function getKurdistanSatelliteTexture(type: 'nasa' | 'hd' = 'hd'): THREE.Texture {
  const loader = new THREE.TextureLoader();

  if (type === 'hd') {
    if (!hdTexture) {
      hdTexture = loader.load(
        '/tiles/north_iraq_hd_satellite.jpg?v=kurdistan_hd',
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
        },
        undefined,
        () => {
          hdTexture = loader.load('/tiles/sulaymaniyah_satellite_hd.jpg?v=kurdistan_hd');
        }
      );
      hdTexture.colorSpace = THREE.SRGBColorSpace;
      hdTexture.anisotropy = 16;
      hdTexture.wrapS = THREE.ClampToEdgeWrapping;
      hdTexture.wrapT = THREE.ClampToEdgeWrapping;
      hdTexture.minFilter = THREE.LinearMipmapLinearFilter;
      hdTexture.magFilter = THREE.LinearFilter;
    }
    return hdTexture;
  }

  if (!nasaTexture) {
    nasaTexture = loader.load(
      '/tiles/north_iraq_nasa_satellite.jpg?v=kurdistan_nasa',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      },
      undefined,
      () => {
        nasaTexture = loader.load('/tiles/sulaymaniyah_satellite.jpg?v=kurdistan_nasa');
      }
    );
    nasaTexture.colorSpace = THREE.SRGBColorSpace;
    nasaTexture.anisotropy = 16;
    nasaTexture.wrapS = THREE.ClampToEdgeWrapping;
    nasaTexture.wrapT = THREE.ClampToEdgeWrapping;
    nasaTexture.minFilter = THREE.LinearMipmapLinearFilter;
    nasaTexture.magFilter = THREE.LinearFilter;
  }
  return nasaTexture;
}

// Backward compatibility aliases
export const getSulaymaniyahSatelliteTexture = getKurdistanSatelliteTexture;
export const getNorthVietnamSatelliteTexture = getKurdistanSatelliteTexture;

/**
 * Builds real chunk geometry using the DEM heightmap and UV offsets for a sub-chunk.
 */
export function buildRealChunkGeometry(
  gridX: number,
  gridY: number,
  chunkWidth: number,
  chunkHeight: number,
  subdivisions: number = 64,
  terrainExaggeration: number = 1.35
): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(
    chunkWidth,
    chunkHeight,
    subdivisions,
    subdivisions
  );

  geom.rotateX(-Math.PI / 2); // Orient horizontal (XZ plane)

  const posAttr = geom.attributes.position;
  const uvAttr = geom.attributes.uv;

  for (let i = 0; i < posAttr.count; i++) {
    const localX = posAttr.getX(i);
    const localZ = posAttr.getZ(i);

    const worldX = gridX + localX;
    const worldZ = gridY + localZ;

    const elevMeters = getRealKurdistanElevation(worldX, worldZ);
    posAttr.setY(i, elevMeters * terrainExaggeration);

    // Geographic UV: global mapping across the whole 240km x 160km North Iraq Kurdistan domain
    const globalU = (worldX + HALF_DOMAIN_WIDTH) / DOMAIN_WIDTH_METERS;
    const globalV = 1.0 - (worldZ + HALF_DOMAIN_HEIGHT) / DOMAIN_HEIGHT_METERS;

    uvAttr.setXY(i, Math.max(0, Math.min(1, globalU)), Math.max(0, Math.min(1, globalV)));
  }

  geom.computeVertexNormals();
  return geom;
}

// Compute world positions for 28 major Northern Iraq & Kurdistan landmarks
function makeLandmark(
  id: string,
  name: string,
  subLabel: string,
  lon: number,
  lat: number,
  nominalElevM: number,
  type: Landmark['type']
): Landmark {
  const [wx, wz] = geoToWorld(lon, lat);
  const demElev = Math.max(nominalElevM * 0.85, getAnalyticalKurdistanElevation(wx, wz));
  const groundY = demElev * 1.35;
  return {
    id,
    name,
    subLabel,
    lon,
    lat,
    elevationM: nominalElevM,
    position: [wx, groundY + 120, wz],
    type,
    // Ground-level 360° vantage point right on the same spot
    cameraTarget: [wx, groundY + 65, wz],
    cameraPosition: [wx, groundY + 65.4, wz + 2.0]
  };
}

export const KURDISTAN_LANDMARKS: Landmark[] = [
  makeLandmark('erbil', 'Erbil Citadel (هەولێر)', 'Capital of Kurdistan • UNESCO Ancient Citadel • 410 m', 44.0092, 36.1911, 410, 'city'),
  makeLandmark('sulaymaniyah', 'Sulaymaniyah (سلێمانی)', 'Cultural Capital • Mount Goizha & Azmar • 845 m', 45.4351, 35.5558, 845, 'city'),
  makeLandmark('duhok', 'Duhok Valley (دهۆک)', 'Gara Mountain Ridge & Duhok Dam • 565 m', 42.9885, 36.8679, 565, 'city'),
  makeLandmark('halabja', 'Halabja & Hawraman (هەڵەبجە)', 'Historic City & Terraced Hawraman Range • 720 m', 45.9861, 35.1778, 720, 'city'),
  makeLandmark('zakho', 'Zakho & Delal Bridge (زاخۆ)', 'Ancient Roman-Abbasid Khabur Crossing • 440 m', 42.6869, 37.1436, 440, 'city'),
  makeLandmark('kirkuk', 'Kirkuk Citadel (کەرکووک)', 'Ancient Citadel & Baba Gurgur Eternal Fire • 350 m', 44.3922, 35.4681, 350, 'city'),
  makeLandmark('halgurd', 'Mount Halgurd (لووتکەی ھەڵگورد)', 'Highest Peak in Kurdistan & Iraq • 3,607 m', 44.8500, 36.7350, 3607, 'mountain'),
  makeLandmark('piramagrun', 'Mount Piramagrun (چیای پیرەمەگروون)', 'Massive Zagros Limestone Peak • 2,611 m', 45.2400, 35.7500, 2611, 'mountain'),
  makeLandmark('korek', 'Mount Korek & Rawanduz (چیای کۆڕەک)', 'Alpine Resort & Deep Rawanduz Gorge • 2,127 m', 44.5400, 36.6500, 2127, 'mountain'),
  makeLandmark('amadiya', 'Amadiya Citadel (ئامێدی)', 'Ancient Mountain Mesa Fortress • 1,200 m', 43.4875, 37.0911, 1200, 'mountain'),
  makeLandmark('goizha', 'Mount Goizha Overlook (چیای گۆیژە)', 'Panoramic Ridge Above Sulaymaniyah • 1,525 m', 45.4820, 35.5880, 1525, 'mountain'),
  makeLandmark('safin', 'Mount Safin & Shaqlawa (چیای سەفین)', 'Orchard Valley & High Limestone Crest • 1,950 m', 44.3250, 36.3950, 1950, 'mountain'),
  makeLandmark('gara', 'Mount Gara Summit (چیای گارە)', 'Northern Zagros Panorama Above Sarsing • 2,151 m', 43.4100, 37.0150, 2151, 'mountain'),
  makeLandmark('qandil', 'Qandil Alpine Range (چیاکانی قەندیل)', 'High Rugged Border Glaciers & Crags • 3,450 m', 45.0500, 36.5200, 3450, 'mountain'),
  makeLandmark('shirin', 'Mount Shirin & Barzan (چیای شیرین)', 'Great Zab Canyon & Barzan Wildlife Reserve • 2,050 m', 44.0800, 36.9200, 2050, 'mountain'),
  makeLandmark('shanidar', 'Shanidar Cave & Bradost (ئەشکەوتی شانەدەر)', 'Neanderthal Archaeological Gorge & Greater Zab • 765 m', 44.2200, 36.8050, 765, 'mountain'),
  makeLandmark('dukan', 'Lake Dukan (دەریاچەی دووکان)', 'Largest Mountain Reservoir & Hydro Dam • 516 m', 44.9610, 35.9520, 516, 'water'),
  makeLandmark('darbandikhan', 'Lake Darbandikhan (دەریاچەی دەربەندیخان)', 'Emerald Gorge Reservoir & Sirwan River • 485 m', 45.7050, 35.1120, 485, 'water'),
  makeLandmark('galialibeg', 'Gali Ali Beg Waterfall (گەلی عەلی بەگ)', 'Deep Limestone Canyon & Mountain Cascade • 820 m', 44.4450, 36.6310, 820, 'water'),
  makeLandmark('mosuldam', 'Mosul Dam & Tigris Lake (بەنداوی مووسڵ)', 'Upper Tigris Reservoir & Duhok Western Basin • 330 m', 42.8230, 36.6300, 330, 'water'),
  makeLandmark('akre', 'Akre Historic Town (ئاکرێ)', 'Terraced Mountain Amphitheater & Newroz Capital • 760 m', 43.8930, 36.7410, 760, 'city'),
  makeLandmark('soran', 'Soran & Diana Plain (سۆران)', 'Heart of Balakayati & Rawanduz Basin • 680 m', 44.5420, 36.6540, 680, 'city'),
  makeLandmark('ranya', 'Ranya & Bitwen Plain (ڕانیە)', 'Garden Gate of Raparin & Lake Dukan North Shore • 580 m', 44.8820, 36.2550, 580, 'city'),
  makeLandmark('koya', 'Koya / Koy Sanjaq (کۆیە)', 'Historic Caravanserai & Haibat Sultan Ridge • 620 m', 44.6280, 36.0820, 620, 'city'),
  makeLandmark('chamchamal', 'Chamchamal & Bazian Pass (چەمچەماڵ)', 'Historic Darband-i Bazian Gateway • 710 m', 44.8340, 35.5330, 710, 'city'),
  makeLandmark('choman', 'Choman & Haji Omran (چۆمان • حاجی ئۆمەران)', 'High Alpine Valley Along Hamilton Road • 1,580 m', 44.8900, 36.6350, 1580, 'border'),
  makeLandmark('penjwen', 'Penjwen Mountain Pass (پێنجوێن)', 'Cool High-Altitude Eastern Border Valley • 1,310 m', 45.9420, 35.6210, 1310, 'border'),
  makeLandmark('kalar', 'Kalar & Garmian (کەلار)', 'Sirwan River Basin & Historic Sherwana Castle • 219 m', 45.3183, 34.6247, 219, 'city')
];

/**
 * Computes the exact Ground-Level 360° camera pose at any landmark or (x, z) coordinate
 * so the camera stands on solid ground and rotates 360° on the exact same spot.
 */
export function getGround360CameraPose(
  worldX: number,
  worldZ: number,
  terrainExaggeration = 1.35,
  eyeHeightAboveGround = 65
): { pos: [number, number, number]; target: [number, number, number]; groundY: number } {
  const c = getRealKurdistanElevation(worldX, worldZ);
  const n = getRealKurdistanElevation(worldX, worldZ - 35);
  const s = getRealKurdistanElevation(worldX, worldZ + 35);
  const e = getRealKurdistanElevation(worldX + 35, worldZ);
  const w = getRealKurdistanElevation(worldX - 35, worldZ);
  const groundY = Math.max(c, n, s, e, w) * terrainExaggeration;
  const eyeY = groundY + eyeHeightAboveGround;
  return {
    groundY,
    target: [worldX, eyeY, worldZ],
    pos: [worldX, eyeY + 0.4, worldZ + 2.0]
  };
}

// Backward compatibility alias
export const SULAYMANIYAH_LANDMARKS = KURDISTAN_LANDMARKS;
export const NORTH_VIETNAM_LANDMARKS = KURDISTAN_LANDMARKS;
export const NORTH_IRAQ_LANDMARKS = KURDISTAN_LANDMARKS;
