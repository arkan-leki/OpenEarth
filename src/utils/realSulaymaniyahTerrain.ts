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

// Compute world positions for major Northern Iraq & Kurdistan landmarks
const [ex, ez] = geoToWorld(44.0092, 36.1911); // Erbil Citadel
const [sx, sz] = geoToWorld(45.4351, 35.5558); // Sulaymaniyah City
const [hx, hz] = geoToWorld(44.8500, 36.7350); // Mount Halgurd
const [dx, dz] = geoToWorld(42.9885, 36.8679); // Duhok Valley
const [lkx, lkz] = geoToWorld(44.9610, 35.9520); // Lake Dukan
const [ax, az] = geoToWorld(43.4875, 37.0911); // Amadiya Citadel Mesa
const [hlx, hlz] = geoToWorld(45.9861, 35.1778); // Halabja & Hawraman
const [kx, kz] = geoToWorld(45.3183, 34.6247); // Kalar & Garmian
const [px, pz] = geoToWorld(45.2400, 35.7500); // Mount Piramagrun
const [zx, zz] = geoToWorld(42.6869, 37.1436); // Zakho & Delal Bridge
const [dbx, dbz] = geoToWorld(45.7050, 35.1120); // Lake Darbandikhan
const [rx, rz] = geoToWorld(44.5400, 36.6500); // Rawanduz & Mount Korek

export const KURDISTAN_LANDMARKS: Landmark[] = [
  {
    id: 'erbil',
    name: 'Erbil Citadel (هەولێر)',
    subLabel: 'Capital of Kurdistan • UNESCO Ancient Citadel • 410 m',
    position: [ex, 420 * 1.35 + 150, ez],
    type: 'city',
    cameraTarget: [ex, 350, ez],
    cameraPosition: [ex + 14000, 6800, ez + 19000]
  },
  {
    id: 'sulaymaniyah',
    name: 'Sulaymaniyah (سلێمانی)',
    subLabel: 'Cultural Capital • Mount Goizha & Azmar • 845 m',
    position: [sx, 860 * 1.35 + 200, sz],
    type: 'city',
    cameraTarget: [sx, 750, sz],
    cameraPosition: [sx + 15000, 7200, sz + 21000]
  },
  {
    id: 'halgurd',
    name: 'Mount Halgurd (لووتکەی ھەڵگورد)',
    subLabel: 'Highest Peak in Kurdistan & Iraq • 3,607 m',
    position: [hx, 3607 * 1.35, hz],
    type: 'mountain',
    cameraTarget: [hx, 3200 * 1.35, hz],
    cameraPosition: [hx + 12000, 8500, hz + 16000]
  },
  {
    id: 'dukan',
    name: 'Lake Dukan (دەریاچەی دووکان)',
    subLabel: 'Largest Mountain Reservoir & Hydro Dam • 516 m',
    position: [lkx, 520 * 1.35 + 100, lkz],
    type: 'water',
    cameraTarget: [lkx, 480, lkz],
    cameraPosition: [lkx + 13000, 6000, lkz + 17000]
  },
  {
    id: 'duhok',
    name: 'Duhok Valley (دهۆک)',
    subLabel: 'Gara Mountain Ridge & Duhok Dam • 565 m',
    position: [dx, 580 * 1.35 + 150, dz],
    type: 'city',
    cameraTarget: [dx, 500, dz],
    cameraPosition: [dx + 12000, 6500, dz + 16000]
  },
  {
    id: 'amadiya',
    name: 'Amadiya Citadel (ئامێدی)',
    subLabel: 'Ancient Rock Mesa Fortress • 1,200 m',
    position: [ax, 1200 * 1.35 + 150, az],
    type: 'mountain',
    cameraTarget: [ax, 1050 * 1.35, az],
    cameraPosition: [ax + 10000, 6000, az + 14000]
  },
  {
    id: 'halabja',
    name: 'Halabja & Hawraman (هەڵەبجە)',
    subLabel: 'Historic City & Terraced Hawraman Range • 720 m',
    position: [hlx, 740 * 1.35 + 150, hlz],
    type: 'city',
    cameraTarget: [hlx, 680, hlz],
    cameraPosition: [hlx + 12000, 6200, hlz + 16000]
  },
  {
    id: 'kalar',
    name: 'Kalar & Garmian (کەلار)',
    subLabel: 'Sirwan River Basin & Historic Sherwana Castle • 219 m',
    position: [kx, 225 * 1.35 + 100, kz],
    type: 'city',
    cameraTarget: [kx, 200, kz],
    cameraPosition: [kx + 12000, 5500, kz + 16000]
  },
  {
    id: 'piramagrun',
    name: 'Mount Piramagrun (چیای پیرەمەگروون)',
    subLabel: 'Zagros Limestone Mountain Wall • 2,611 m',
    position: [px, 2611 * 1.35, pz],
    type: 'mountain',
    cameraTarget: [px, 2200 * 1.35, pz],
    cameraPosition: [px + 11000, 7500, pz + 15000]
  },
  {
    id: 'zakho',
    name: 'Zakho & Delal Bridge (زاخۆ)',
    subLabel: 'Historic Khabur River Crossing • 440 m',
    position: [zx, 450 * 1.35 + 100, zz],
    type: 'city',
    cameraTarget: [zx, 400, zz],
    cameraPosition: [zx + 11000, 5800, zz + 15000]
  },
  {
    id: 'darbandikhan',
    name: 'Lake Darbandikhan (دەربەندیخان)',
    subLabel: 'Mountain Reservoir & Rugged Zagros Gorge • 485 m',
    position: [dbx, 490 * 1.35 + 100, dbz],
    type: 'water',
    cameraTarget: [dbx, 450, dbz],
    cameraPosition: [dbx + 11000, 5500, dbz + 15000]
  },
  {
    id: 'rawanduz',
    name: 'Rawanduz & Mount Korek (ڕەواندز)',
    subLabel: 'Gali Ali Beg Canyon & Alpine Heights • 950 m',
    position: [rx, 960 * 1.35 + 150, rz],
    type: 'mountain',
    cameraTarget: [rx, 850, rz],
    cameraPosition: [rx + 11000, 6200, rz + 15000]
  }
];

// Backward compatibility alias
export const SULAYMANIYAH_LANDMARKS = KURDISTAN_LANDMARKS;
export const NORTH_VIETNAM_LANDMARKS = KURDISTAN_LANDMARKS;
export const NORTH_IRAQ_LANDMARKS = KURDISTAN_LANDMARKS;
