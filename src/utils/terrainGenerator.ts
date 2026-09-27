/**
 * Terrain elevation DEM generator and texturing for the Kalar / Sulaymaniyah / Zagros region
 */
import * as THREE from 'three';

// 2D simplex / perlin noise generator for deterministic terrain
function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;

  // Smooth interpolation curves
  const sx = fx * fx * (3.0 - 2.0 * fx);
  const sy = fy * fy * (3.0 - 2.0 * fy);

  const n00 = hash2D(i, j);
  const n10 = hash2D(i + 1, j);
  const n01 = hash2D(i, j + 1);
  const n11 = hash2D(i + 1, j + 1);

  const nx0 = n00 * (1.0 - sx) + n10 * sx;
  const nx1 = n01 * (1.0 - sx) + n11 * sx;

  return nx0 * (1.0 - sy) + nx1 * sy;
}

export function fbmTerrain(x: number, y: number, octaves = 5): number {
  let val = 0;
  let amp = 0.55;
  let freq = 1.0;
  let maxAmp = 0;

  for (let o = 0; o < octaves; o++) {
    val += smoothNoise(x * freq, y * freq) * amp;
    maxAmp += amp;
    freq *= 2.02;
    amp *= 0.48;
  }
  return val / maxAmp;
}

// Ridged multifractal for Zagros fold mountains
function ridgedNoise(x: number, y: number): number {
  const n = smoothNoise(x, y);
  return 1.0 - Math.abs(n * 2.0 - 1.0);
}

/**
 * Returns terrain elevation in meters for Sulaymaniyah / Zagros / Kalar region
 * World coordinates in meters (centered at 0, 0 = Kalar / Sirwan Valley)
 */
export function getTerrainHeight(worldX: number, worldZ: number): number {
  // Normalize coords
  const nx = worldX * 0.00008;
  const nz = worldZ * 0.00008;

  // Regional macro features:
  // Zagros mountain fold runs from North-West to South-East (angle ~ -35 degrees)
  const foldAxis = nx * 0.8 + nz * 0.6;
  const crossFold = -nx * 0.6 + nz * 0.8;

  // Base elevation rises towards north/east
  let elevation = (crossFold * 0.5 + 0.3) * 1200.0;

  // Mountain ridges using periodic folded waveforms
  const ridgeFreq = 3.5;
  const ridge1 = ridgedNoise(foldAxis * 2.2, crossFold * ridgeFreq) * 1400.0;
  const ridge2 = ridgedNoise(foldAxis * 4.5 + 1.2, crossFold * ridgeFreq * 2.0) * 600.0;
  
  // High-frequency crag detail
  const crags = fbmTerrain(nx * 8.0, nz * 8.0, 4) * 450.0;

  elevation += (ridge1 + ridge2 + crags);

  // Carve Darbandikhan Reservoir lake canyon in the valley
  // Reservoir extends around worldX: -1500 to 4500, worldZ: 2000 to 9000
  const lakeDistX = (worldX - 1800) * 0.00028;
  const lakeDistZ = (worldZ - 5200) * 0.00022;
  const lakeShape = Math.sqrt(lakeDistX * lakeDistX + lakeDistZ * lakeDistZ * 0.6);
  
  if (lakeShape < 1.2) {
    const carve = Math.cos(lakeShape * Math.PI * 0.5);
    elevation -= carve * 750.0;
  }

  // Smooth riverbed gorge
  const riverX = Math.sin(worldZ * 0.0003) * 2000.0;
  const distToRiver = Math.abs(worldX - riverX);
  if (distToRiver < 1800.0) {
    const riverCarve = (1.0 - distToRiver / 1800.0) * 350.0;
    elevation -= riverCarve;
  }

  // Minimum floor: Lake water level is around 80m
  return elevation;
}

/**
 * Procedurally generates vertex colors and normal displacements for a terrain chunk
 */
export function buildChunkGeometry(
  chunkSize: number,
  resolution: number,
  worldOffsetX: number,
  worldOffsetZ: number
): { geometry: THREE.PlaneGeometry; maxElevation: number; minElevation: number } {
  const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, resolution, resolution);
  // Orient horizontally (XZ plane)
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  const colors: number[] = [];
  let maxElevation = -9999;
  let minElevation = 9999;

  // Pre-allocate color objects for fast blending
  const colorWaterDeep = new THREE.Color('#103b4d');
  const colorWaterShallow = new THREE.Color('#1a6b7d');
  const colorValleyLush = new THREE.Color('#3b4f3a');
  const colorAridPlains = new THREE.Color('#6f6b57');
  const colorRockBrown = new THREE.Color('#5c5449');
  const colorRockGrey = new THREE.Color('#787878');
  const colorSnow = new THREE.Color('#f0f4f8');

  for (let i = 0; i < posAttr.count; i++) {
    const localX = posAttr.getX(i);
    const localZ = posAttr.getZ(i);

    const worldX = localX + worldOffsetX;
    const worldZ = localZ + worldOffsetZ;

    const height = getTerrainHeight(worldX, worldZ);
    posAttr.setY(i, height);

    if (height > maxElevation) maxElevation = height;
    if (height < minElevation) minElevation = height;

    // Determine biome color based on elevation and slope
    const col = new THREE.Color();

    if (height < 95) {
      // Lake / shoreline
      const t = THREE.MathUtils.clamp((height - 50) / 45, 0, 1);
      col.copy(colorWaterDeep).lerp(colorWaterShallow, t);
    } else if (height < 320) {
      // Valley and riverbanks
      const t = (height - 95) / 225;
      col.copy(colorValleyLush).lerp(colorAridPlains, t);
    } else if (height < 850) {
      // Foothills & rocky shrubland
      const t = (height - 320) / 530;
      col.copy(colorAridPlains).lerp(colorRockBrown, t);
    } else if (height < 1400) {
      // Rugged limestone crags
      const t = (height - 850) / 550;
      col.copy(colorRockBrown).lerp(colorRockGrey, t);
    } else {
      // High Zagros snowy peaks
      const t = THREE.MathUtils.clamp((height - 1400) / 500, 0, 1);
      col.copy(colorRockGrey).lerp(colorSnow, t);
    }

    // Add geological bedding variation
    const stratum = Math.sin(height * 0.04) * 0.06;
    col.r = THREE.MathUtils.clamp(col.r + stratum, 0, 1);
    col.g = THREE.MathUtils.clamp(col.g + stratum, 0, 1);
    col.b = THREE.MathUtils.clamp(col.b + stratum, 0, 1);

    colors.push(col.r, col.g, col.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return { geometry, maxElevation, minElevation };
}
