/**
 * Real Planetary Globe Topography & Digital Elevation Model (DEM) for:
 * - Northern Iraq (Southern Kurdistan / Bashur: Erbil, Sulaymaniyah, Duhok, Mosul, Kirkuk, Sinjar, Halabja, Halgurd)
 * - Eastern Turkey (Northern Kurdistan / Bakur: Diyarbakır, Mardin, Lake Van, Hakkari / Cilo, Şırnak / Cudi, Cizre)
 * - Eastern Syria (Rojava / Western Kurdistan: Qamishli, Al-Hasakah, Derik, Amuda, Khabur & Jazira Plains)
 * - Western Iran (Eastern Kurdistan / Rojhelat: Lake Urmia, Mahabad, Sanandaj, Kermanshah, Marivan, Piranshahr, Ilam)
 *
 * Mapped across a 480 km x 320 km curved Earth Globe segment where:
 * - At 50 km distance, Earth's curvature drops by ~454 m (flat land disappears over the horizon)
 * - At 100 km distance, Earth's curvature drops by ~1,818 m (mountains disappear over the horizon)
 */
import * as THREE from 'three';
import { Landmark } from '../types';

export const DOMAIN_WIDTH_METERS = 1600000;  // 1600 km across: an 800 km-radius circle around Erbil
export const DOMAIN_HEIGHT_METERS = 1600000; // 1600 km tall (square domain containing the circle)
/**
 * The rendered map is a CIRCLE of this radius centred on the domain, not the full square.
 * The square bounding box exists only because the DEM and imagery are stored as a grid.
 */
export const MAP_RADIUS_METERS = 800000;

/**
 * Map edge shape: a rounded square (superellipse), not a rectangle and not a circle.
 *
 *   |x/HALF|^N + |z/HALF|^N = 1
 *
 * N = 2 gives an ellipse/circle (which threw away 21.5% of the domain in the corners).
 * N = 4 gives a squircle: the corners are rounded off but ~92% of the domain still renders,
 * so we get the soft edge without paying the circle's waste. Larger N approaches a rectangle.
 */
export const MAP_EDGE_EXPONENT = 2;

/** Normalised superellipse radius: 1.0 exactly on the map edge, <1 inside. */
export function mapEdgeDistance(worldX: number, worldZ: number): number {
  const ax = Math.abs(worldX) / HALF_DOMAIN_WIDTH;
  const az = Math.abs(worldZ) / HALF_DOMAIN_HEIGHT;
  return Math.pow(Math.pow(ax, MAP_EDGE_EXPONENT) + Math.pow(az, MAP_EDGE_EXPONENT), 1 / MAP_EDGE_EXPONENT);
}

/** Fraction of the shape's radius over which terrain fades to sea level at the edge. */
export const EDGE_TAPER_FRACTION = 0.06;

/**
 * Elevation floor. The old value (160 m) flattened real depressions; the Dead Sea shore sits
 * at -430 m and is inside this map. Kept above the subterranean crust slab top (-500 m).
 */
export const MIN_TERRAIN_ELEVATION_M = -440;

/** Width of the fade band, in metres, over which terrain meets sea level at the map rim. */
export const RIM_TAPER_METERS = 60000;

/**
 * Converts a chunk's world rectangle into geographic bounds, so per-chunk satellite imagery
 * can be requested from its exact bounding box at full sensor resolution.
 */
export function worldRectToLonLatBounds(
  gridX: number,
  gridY: number,
  widthMeters: number,
  heightMeters: number
): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
  const lonAt = (x: number) => MIN_LON + (x / DOMAIN_WIDTH_METERS + 0.5) * (MAX_LON - MIN_LON);
  const latAt = (z: number) => MAX_LAT - (z / DOMAIN_HEIGHT_METERS + 0.5) * (MAX_LAT - MIN_LAT);
  return {
    minLon: lonAt(gridX - widthMeters / 2),
    maxLon: lonAt(gridX + widthMeters / 2),
    // +z is south, so the NORTH edge comes from the smaller z.
    minLat: latAt(gridY + heightMeters / 2),
    maxLat: latAt(gridY - heightMeters / 2)
  };
}

/** True when a world-space point lies inside the rendered circle. */
export function isInsideMapCircle(worldX: number, worldZ: number, marginMeters = 0): boolean {
  const r = MAP_RADIUS_METERS + marginMeters;
  return worldX * worldX + worldZ * worldZ <= r * r;
}

export const HALF_DOMAIN_WIDTH = DOMAIN_WIDTH_METERS / 2;   // 800000 m
export const HALF_DOMAIN_HEIGHT = DOMAIN_HEIGHT_METERS / 2; // 800000 m

export const DOMAIN_SIZE_METERS = DOMAIN_WIDTH_METERS;
export const HALF_DOMAIN = HALF_DOMAIN_WIDTH;

// Spherical Earth Globe curvature divisor:
// Drop = -d^2 / (2R) with R = 6371 km. At 50 km: -196 m. At 800 km (map edge): -50 km.
// The previous divisor (5,500,000) exaggerated curvature 2.3x, which made a 1600 km map sag
// 116 km at its rim instead of the correct 50 km.
export const EARTH_CURVATURE_DIVISOR = 12742000.0;

export const DEM_WIDTH = 4096;
export const DEM_HEIGHT = 4096;

// Exact bounding box of the NASA VIIRS / SRTM DEM zoom 8 tiles covering
// East Syria (40.78°E), East Turkey (37.72°N), North Iraq, and West Iran (47.81°E)
export const MIN_LON = 35.10439430714793;
export const MAX_LON = 52.91360569285207;
export const MIN_LAT = 28.956026136343084;
export const MAX_LAT = 43.42597386365692;

// In-memory cache of the decoded 4096x4096 real DEM Int16Array
let cachedDemData: Int16Array | null = null;
let demLoadPromise: Promise<Int16Array | null> | null = null;

export function loadRealDemData(): Promise<Int16Array | null> {
  if (cachedDemData) return Promise.resolve(cachedDemData);
  if (demLoadPromise) return demLoadPromise;

  demLoadPromise = fetch('data/erbil_map_dem.bin')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to load regional DEM binary');
      return res.arrayBuffer();
    })
    .then((buf) => {
      cachedDemData = new Int16Array(buf);
      return cachedDemData;
    })
    .catch((err) => {
      console.warn('Regional DEM binary pending, using analytical topography calibration:', err.message);
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
 * Computes the vertical Earth Globe curvature drop (negative meters) at (worldX, worldZ)
 * relative to the local reference point (refX, refZ):
 * - At 50 km distance: -454.5 m (plains disappear over the globe horizon)
 * - At 100 km distance: -1,818.2 m (mountains disappear over the globe horizon)
 */
export function getEarthCurvatureDropMeters(
  worldX: number,
  worldZ: number,
  refX = 0,
  refZ = 0
): number {
  const dx = worldX - refX;
  const dz = worldZ - refZ;
  return -((dx * dx + dz * dz) / EARTH_CURVATURE_DIVISOR);
}

/**
 * Analytical real-geography baseline matching Eastern Turkey, Eastern Syria, Northern Iraq, and Western Iran
 * Used seamlessly while binary DEM is loading over network.
 */
function getAnalyticalKurdistanElevation(worldX: number, worldZ: number): number {
  // Normalize coords: nx in [-1, 1] (West: East Syria/Diyarbakır to East: West Iran/Sanandaj), nz in [-1, 1] (North: Lake Van to South: Ilam/Kalar)
  const nx = worldX / HALF_DOMAIN_WIDTH;
  const nz = worldZ / HALF_DOMAIN_HEIGHT;

  // General slope: High alpine Taurus & Zagros mountains in North & East, Jazira/Mesopotamian plains in South-West
  let elev = 620 - nz * 390 + nx * 440;

  // 1. Mount Halgurd, Hakkari / Cilo & Northern Zagros-Taurus range (x ~ 36000, z ~ -90000)
  const distHalgurd = Math.hypot(worldX - 36000, worldZ - (-90000));
  if (distHalgurd < 110000) {
    const dome = Math.cos((distHalgurd / 110000) * (Math.PI / 2));
    elev += dome * dome * 2750;
  }

  // 2. Sulaymaniyah, Mount Piramagrun, Hawraman & Sanandaj / Kermanshah Zagros Wall (x ~ 95000, z ~ 10000)
  const distSuli = Math.hypot(worldX - 95000, worldZ - 10000);
  if (distSuli < 105000) {
    const dome = Math.cos((distSuli / 105000) * (Math.PI / 2));
    elev += dome * dome * 1650;
  }

  // 3. Mount Sinjar / Shingal Ridge near Syria-Iraq border (W: x ~ -164000, z ~ -60000)
  const distSinjar = Math.hypot((worldX - (-164000)) * 0.45, worldZ - (-60000));
  if (distSinjar < 56000) {
    const dome = Math.cos((distSinjar / 56000) * (Math.PI / 2));
    elev += dome * dome * 880;
  }

  // 4. Eastern Turkey Taurus Mountains (Diyarbakır / Mardin / Şırnak / Hakkari / Van: z < -76000)
  if (worldZ < -76000) {
    const ridgeDist = Math.min(76000, -worldZ - 76000);
    const ridge = Math.sin((ridgeDist / 76000) * (Math.PI / 2));
    elev += ridge * 1350;
  }

  // 5. Lake Dukan depression (x ~ 52000, z ~ -24000)
  const distDukan = Math.hypot(worldX - 52000, worldZ - (-24000));
  if (distDukan < 28000) {
    const bowl = Math.cos((distDukan / 28000) * (Math.PI / 2));
    elev -= bowl * 280;
  }

  // 6. Lake Darbandikhan depression (x ~ 96000, z ~ 36000)
  const distDarbandikhan = Math.hypot(worldX - 96000, worldZ - 36000);
  if (distDarbandikhan < 24000) {
    const bowl = Math.cos((distDarbandikhan / 24000) * (Math.PI / 2));
    elev -= bowl * 220;
  }

  return Math.max(180, elev);
}

/**
 * Returns exact real elevation in meters above sea level (un-curved) for any point
 * across Eastern Turkey, Eastern Syria, Northern Iraq, and Western Iran.
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

    return Math.max(MIN_TERRAIN_ELEVATION_M, rawElevation);
  }

  return getAnalyticalKurdistanElevation(worldX, worldZ);
}


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
        'tiles/erbil_map_hd.jpg?v=erbil_map_hd',
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
        },
        undefined,
        () => {
          console.warn('Erbil HD base map missing — run scripts/build_erbil_map_assets.cjs');
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
      'tiles/erbil_map_hd.jpg?v=erbil_map_hd',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      },
      undefined,
      () => {
        nasaTexture = loader.load('tiles/erbil_map_hd.jpg?v=erbil_map_hd');
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

export const getSulaymaniyahSatelliteTexture = getKurdistanSatelliteTexture;

/**
 * Builds real chunk geometry using the DEM heightmap and UV offsets for a sub-chunk.
 * Note: Earth Globe Curvature (-d^2 / 5,500,000) is applied dynamically in the GPU vertex shader
 * so the globe horizon curves smoothly around the active vantage point.
 */
export function buildRealChunkGeometry(
  gridX: number,
  gridY: number,
  chunkWidth: number,
  chunkHeight: number,
  subdivisions: number = 72,
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

    // Fade elevation down to sea level over the last few percent before the rounded edge, so
    // the map finishes in a smooth curved rim rather than a cliff.
    const edgeDist = mapEdgeDistance(worldX, worldZ);
    const rimFade = 1 - THREE.MathUtils.smoothstep(edgeDist, 1 - EDGE_TAPER_FRACTION, 1);

    posAttr.setY(i, elevMeters * terrainExaggeration * rimFade);

    // LOCAL UV, 0..1 within THIS chunk, because every chunk now carries its own
    // high-resolution imagery tile and is rendered with it separately. The previous
    // global UV meant all 16 chunks shared one 4096px image stretched over the whole
    // map, which is what cost the ground detail.
    const u = (localX + chunkWidth / 2) / chunkWidth;
    const v = (chunkHeight / 2 - localZ) / chunkHeight; // v = 1 at the north edge

    uvAttr.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
  }

  // Drop every triangle whose centre falls outside the circle. Vertices are left in place
  // (harmless: unreferenced) so the index stays simple and the buffer layout is unchanged.
  const index = geom.getIndex();
  if (index) {
    const src = index.array;
    const kept: number[] = [];
    for (let t = 0; t < src.length; t += 3) {
      const a = src[t];
      const b = src[t + 1];
      const c = src[t + 2];
      const cx = (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3 + gridX;
      const cz = (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3 + gridY;
      if (mapEdgeDistance(cx, cz) <= 1) kept.push(a, b, c);
    }
    geom.setIndex(kept);
  }

  geom.computeVertexNormals();
  return geom;
}

// Compute world positions for 36 major locations across Northern Iraq, Eastern Turkey, Eastern Syria, and Western Iran
function makeLandmark(
  id: string,
  name: string,
  subLabel: string,
  lon: number,
  lat: number,
  nominalElevM: number,
  type: Landmark['type'],
  region: NonNullable<Landmark['region']>
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
    region,
    position: [wx, groundY + 120, wz],
    type,
    // Ground-level 360° vantage point right on the same spot
    cameraTarget: [wx, groundY + 65, wz],
    cameraPosition: [wx, groundY + 65.4, wz + 2.0]
  };
}

export const KURDISTAN_LANDMARKS: Landmark[] = [
  // ================= NORTHERN IRAQ (BASHUR) =================
  makeLandmark('erbil', 'Erbil Citadel (هەولێر)', 'North Iraq • UNESCO Ancient Citadel • 410 m', 44.0092, 36.1911, 410, 'city', 'north_iraq'),
  makeLandmark('sulaymaniyah', 'Sulaymaniyah (سلێمانی)', 'North Iraq • Mount Goizha & Azmar • 845 m', 45.4351, 35.5558, 845, 'city', 'north_iraq'),
  makeLandmark('duhok', 'Duhok Valley (دهۆک)', 'North Iraq • Gara Ridge & Duhok Dam • 565 m', 42.9885, 36.8679, 565, 'city', 'north_iraq'),
  makeLandmark('mosul', 'Mosul & Nineveh (مووسڵ)', 'North Iraq • Tigris River & Nineveh Plains • 225 m', 43.1300, 36.3400, 225, 'city', 'north_iraq'),
  makeLandmark('kirkuk', 'Kirkuk Citadel (کەرکووک)', 'North Iraq • Ancient Citadel & Baba Gurgur • 350 m', 44.3922, 35.4681, 350, 'city', 'north_iraq'),
  makeLandmark('halabja', 'Halabja & Hawraman (هەڵەبجە)', 'North Iraq • Terraced Hawraman Range • 720 m', 45.9861, 35.1778, 720, 'city', 'north_iraq'),
  makeLandmark('zakho', 'Zakho & Delal Bridge (زاخۆ)', 'North Iraq • Ancient Khabur Crossing • 440 m', 42.6869, 37.1436, 440, 'city', 'north_iraq'),
  makeLandmark('sinjar', 'Mount Sinjar / Shingal (چیای شنگال)', 'North Iraq • Western Limestone Ridge • 1,463 m', 41.8500, 36.3800, 1463, 'mountain', 'north_iraq'),
  makeLandmark('halgurd', 'Mount Halgurd (لووتکەی ھەڵگورد)', 'North Iraq • Highest Peak in Iraq • 3,607 m', 44.8500, 36.7350, 3607, 'mountain', 'north_iraq'),
  makeLandmark('piramagrun', 'Mount Piramagrun (چیای پیرەمەگروون)', 'North Iraq • Zagros Limestone Peak • 2,611 m', 45.2400, 35.7500, 2611, 'mountain', 'north_iraq'),
  makeLandmark('korek', 'Mount Korek & Rawanduz (چیای کۆڕەک)', 'North Iraq • Deep Rawanduz Gorge • 2,127 m', 44.5400, 36.6500, 2127, 'mountain', 'north_iraq'),
  makeLandmark('amadiya', 'Amadiya Citadel (ئامێدی)', 'North Iraq • Ancient Mountain Mesa • 1,200 m', 43.4875, 37.0911, 1200, 'mountain', 'north_iraq'),
  makeLandmark('qandil', 'Qandil Alpine Range (چیاکانی قەندیل)', 'North Iraq / Iran Border Crags • 3,450 m', 45.0500, 36.5200, 3450, 'mountain', 'north_iraq'),
  makeLandmark('dukan', 'Lake Dukan (دەریاچەی دووکان)', 'North Iraq • Largest Mountain Reservoir • 516 m', 44.9610, 35.9520, 516, 'water', 'north_iraq'),
  makeLandmark('darbandikhan', 'Lake Darbandikhan (دەریاچەی دەربەندیخان)', 'North Iraq • Emerald Gorge Reservoir • 485 m', 45.7050, 35.1120, 485, 'water', 'north_iraq'),
  makeLandmark('akre', 'Akre Historic Town (ئاکرێ)', 'North Iraq • Terraced Mountain Amphitheater • 760 m', 43.8930, 36.7410, 760, 'city', 'north_iraq'),
  makeLandmark('kalar', 'Kalar & Garmian (کەلار)', 'North Iraq • Sirwan Basin & Sherwana Castle • 219 m', 45.3183, 34.6247, 219, 'city', 'north_iraq'),

  // ================= EASTERN TURKEY (BAKUR) =================
  makeLandmark('diyarbakir', 'Diyarbakır / Amed (ئامەد)', 'East Turkey • Tigris Valley & Basalt Walls • 675 m', 40.9200, 37.6800, 675, 'city', 'east_turkey'),
  makeLandmark('mardin', 'Mardin Citadel (مێردین)', 'East Turkey • Hilltop Stone City Above Plains • 1,083 m', 40.8600, 37.3150, 1083, 'city', 'east_turkey'),
  makeLandmark('lakevan', 'Lake Van & Van (دەریاچەی وان)', 'East Turkey • Largest Alpine Soda Lake • 1,640 m', 43.3800, 37.6850, 1640, 'water', 'east_turkey'),
  makeLandmark('hakkari', 'Hakkari & Mount Cilo (جۆلەمێرگ)', 'East Turkey • Glaciated Cilo-Sat Peaks • 4,135 m', 43.7400, 37.5600, 4135, 'mountain', 'east_turkey'),
  makeLandmark('sirnak', 'Şırnak & Mount Cudi (شڕنەخ • جودی)', 'East Turkey • Historic Mount Cudi Ridge • 2,114 m', 42.4600, 37.4200, 2114, 'mountain', 'east_turkey'),
  makeLandmark('cizre', 'Cizre on the Tigris (جزیرە)', 'East Turkey • Tigris River Bend & Bohtan • 400 m', 42.1900, 37.3300, 400, 'city', 'east_turkey'),
  makeLandmark('yuksekova', 'Yüksekova / Gever (گەڤەر)', 'East Turkey • High Alpine Border Basin • 1,950 m', 44.2800, 37.5700, 1950, 'border', 'east_turkey'),

  // ================= EASTERN SYRIA (ROJAVA) =================
  makeLandmark('qamishli', 'Qamishli (قامیشلۆ)', 'East Syria • Jaghjagh River & Northern Jazira • 455 m', 41.2200, 37.0500, 455, 'city', 'east_syria'),
  makeLandmark('hasakah', 'Al-Hasakah & Khabur (حەسیچە)', 'East Syria • Khabur River Confluence • 300 m', 40.8500, 36.5000, 300, 'city', 'east_syria'),
  makeLandmark('derik', 'Derik / Al-Malikiyah (دێرک)', 'East Syria • Tigris Tri-Border & Qarachok • 500 m', 42.1400, 37.1600, 500, 'city', 'east_syria'),
  makeLandmark('amuda', 'Amuda & Jazira Steppe (عاموودا)', 'East Syria • Fertile Upper Mesopotamian Plain • 475 m', 40.9300, 37.1000, 475, 'city', 'east_syria'),
  makeLandmark('qahtaniyah', 'Tirbespiyê / Qahtaniyah (تربەسپی)', 'East Syria • Eastern Jazira Basin • 420 m', 41.5500, 37.0300, 420, 'city', 'east_syria'),

  // ================= WESTERN IRAN (ROJHELAT) =================
  makeLandmark('urmia', 'Lake Urmia & Urmia (ورمێ)', 'West Iran • Hypersaline Mountain Lake • 1,330 m', 45.0700, 37.5500, 1330, 'water', 'west_iran'),
  makeLandmark('mahabad', 'Mahabad & Dam Valley (مەهاباد)', 'West Iran • Mukriyan Cultural Capital • 1,320 m', 45.7200, 36.7600, 1320, 'city', 'west_iran'),
  makeLandmark('sanandaj', 'Sanandaj / Sine (سنە)', 'West Iran • Mount Abidar & Kurdistan Capital • 1,480 m', 46.9900, 35.3100, 1480, 'city', 'west_iran'),
  makeLandmark('kermanshah', 'Kermanshah & Taq-e Bostan (کرماشان)', 'West Iran • Mount Bisotun & Zagros Cliffs • 1,350 m', 47.0600, 34.3100, 1350, 'city', 'west_iran'),
  makeLandmark('marivan', 'Marivan & Lake Zarivar (مەریوان)', 'West Iran • Alpine Lake & Hawraman East • 1,285 m', 46.1700, 35.5200, 1285, 'water', 'west_iran'),
  makeLandmark('piranshahr', 'Piranshahr & Sardasht (پیرانشار)', 'West Iran • Little Zab Headwaters & Gorges • 1,450 m', 45.1400, 36.6900, 1450, 'mountain', 'west_iran'),
  makeLandmark('ilam', 'Ilam & Kabir Kuh (ئیلام)', 'West Iran • Southern Zagros Oak Highlands • 1,387 m', 46.4200, 33.6300, 1387, 'mountain', 'west_iran'),

  // ================= SOUTHERN IRAQ (MESOPOTAMIA) =================
  makeLandmark('baghdad', 'Baghdad (بەغدا)', 'South Iraq • Tigris River & Abbasid Capital • 34 m', 44.3610, 33.3150, 34, 'city', 'south_iraq'),
  makeLandmark('basra', 'Basra (بەسرە)', 'South Iraq • Shatt al-Arab Waterway • 5 m', 47.7830, 30.5080, 5, 'city', 'south_iraq'),
  makeLandmark('najaf', 'Najaf (نەجەف)', 'South Iraq • Imam Ali Shrine & Desert Plateau • 60 m', 44.3140, 32.0000, 60, 'city', 'south_iraq'),
  makeLandmark('karbala', 'Karbala (کەربەلا)', 'South Iraq • Shrine City on the Desert Edge • 40 m', 44.0240, 32.6160, 40, 'city', 'south_iraq'),
  makeLandmark('samarra', 'Samarra & Malwiya (سامەڕا)', 'South Iraq • Spiral Minaret & Tigris Bluffs • 75 m', 43.8760, 34.1980, 75, 'city', 'south_iraq'),
  makeLandmark('tharthar', 'Lake Tharthar (دەریاچەی سەرسار)', 'South Iraq • Vast Desert Depression Lake • 60 m', 43.2000, 34.0000, 60, 'water', 'south_iraq'),
  makeLandmark('ammar', 'Amarah & the Marshes (عەمارە)', 'South Iraq • Mesopotamian Marshlands • 10 m', 47.1450, 31.8350, 10, 'water', 'south_iraq'),

  // ================= THE LEVANT =================
  makeLandmark('damascus', 'Damascus (دیمەشق)', 'Levant • Oldest Inhabited Capital on Earth • 680 m', 36.2920, 33.5130, 680, 'city', 'levant'),
  makeLandmark('aleppo', 'Aleppo (حەلەب)', 'Levant • Ancient Citadel & Silk Road Hub • 390 m', 37.1620, 36.2020, 390, 'city', 'levant'),
  makeLandmark('beirut', 'Beirut (بەیروت)', 'Levant • Mediterranean Harbour & Mount Lebanon • 30 m', 35.5010, 33.8930, 30, 'city', 'levant'),
  makeLandmark('amman', 'Amman (عەممان)', 'Levant • Citadel Hill & Jordan Plateau • 900 m', 35.9100, 31.9560, 900, 'city', 'levant'),
  makeLandmark('jerusalem', 'Jerusalem (قودس)', 'Levant • Old City & Judaean Hills • 754 m', 35.2140, 31.7680, 754, 'city', 'levant'),
  makeLandmark('palmyra', 'Palmyra / Tadmur (تەدمور)', 'Levant • Desert Oasis Ruins • 380 m', 38.2840, 34.5520, 380, 'city', 'levant'),
  makeLandmark('deadsea', 'The Dead Sea (دەریای مردوو)', 'Levant • Lowest Land Point on Earth • -430 m', 35.5000, 31.5000, -430, 'water', 'levant'),

  // ================= CAUCASUS & CASPIAN =================
  makeLandmark('baku', 'Baku (باکو)', 'Caucasus • Absheron Peninsula on the Caspian • -28 m', 49.8670, 40.4090, -28, 'city', 'caucasus'),
  makeLandmark('tbilisi', 'Tbilisi (تبلیس)', 'Caucasus • Mtkvari River & Caucasus Foothills • 450 m', 44.8270, 41.7160, 450, 'city', 'caucasus'),
  makeLandmark('yerevan', 'Yerevan (یەریڤان)', 'Caucasus • Ararat Plain • 990 m', 44.5130, 40.1790, 990, 'city', 'caucasus'),
  makeLandmark('ararat', 'Mount Ararat (ئارارات)', 'Caucasus • 5,137 m Volcanic Massif', 44.2980, 39.7020, 5137, 'mountain', 'caucasus'),
  makeLandmark('sevan', 'Lake Sevan (دەریاچەی سێڤان)', 'Caucasus • High Alpine Lake • 1,900 m', 45.3000, 40.3000, 1900, 'water', 'caucasus'),

  // ================= CENTRAL IRAN & ADDITIONS =================
  makeLandmark('tehran', 'Tehran (تاران)', 'West Iran • Alborz Foothills Capital • 1,200 m', 51.3890, 35.6890, 1200, 'city', 'west_iran'),
  makeLandmark('tabriz', 'Tabriz (تەورێز)', 'West Iran • Sahand Slopes & Silk Road • 1,350 m', 46.2920, 38.0800, 1350, 'city', 'west_iran'),
  makeLandmark('damavand', 'Mount Damavand (دەماوەند)', 'West Iran • Highest Peak in the Middle East • 5,610 m', 52.1100, 35.9550, 5610, 'mountain', 'west_iran'),
  makeLandmark('van', 'Lake Van (دەریاچەی وان)', 'East Turkey • Largest Lake in Turkey • 1,640 m', 43.0000, 38.6000, 1640, 'water', 'east_turkey'),
  makeLandmark('cukurca', 'Hakkari & Cilo-Sat (Colemêrg)', 'East Turkey • Deepest Alpine Gorges • 1,700 m', 43.7400, 37.5750, 1700, 'mountain', 'east_turkey'),
  makeLandmark('cizre', 'Cizre & Tigris Border (Cizîr)', 'East Turkey • Tigris Crossing into Syria • 380 m', 42.1900, 37.3300, 380, 'city', 'east_turkey'),
  makeLandmark('raqqa', 'Raqqa (ڕەققە)', 'East Syria • Euphrates Valley • 250 m', 39.0100, 35.9500, 250, 'city', 'east_syria'),
  makeLandmark('deirezzor', 'Deir ez-Zor (دێرەزوور)', 'East Syria • Euphrates Oasis • 210 m', 40.1400, 35.3330, 210, 'city', 'east_syria')
];

/**
 * Computes the exact Ground-Level 360° camera pose at any landmark or (x, z) coordinate
 * including Earth Globe curvature drop relative to (refX, refZ), so the camera stands
 * on solid ground and rotates 360° on the exact same spot.
 */
export function getGround360CameraPose(
  worldX: number,
  worldZ: number,
  terrainExaggeration = 1.35,
  eyeHeightAboveGround = 65,
  refX = worldX,
  refZ = worldZ
): { pos: [number, number, number]; target: [number, number, number]; groundY: number } {
  const c = getRealKurdistanElevation(worldX, worldZ);
  const n = getRealKurdistanElevation(worldX, worldZ - 45);
  const s = getRealKurdistanElevation(worldX, worldZ + 45);
  const e = getRealKurdistanElevation(worldX + 45, worldZ);
  const w = getRealKurdistanElevation(worldX - 45, worldZ);
  const curveDrop = getEarthCurvatureDropMeters(worldX, worldZ, refX, refZ);
  const groundY = Math.max(c, n, s, e, w) * terrainExaggeration + curveDrop;
  const eyeY = groundY + eyeHeightAboveGround;
  return {
    groundY,
    target: [worldX, eyeY, worldZ],
    pos: [worldX, eyeY + 0.4, worldZ + 2.0]
  };
}

