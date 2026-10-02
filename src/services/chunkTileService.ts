import * as THREE from 'three';

/**
 * Loads the per-chunk imagery tile built by scripts/build_chunk_tiles.cjs.
 *
 * Every terrain chunk has its OWN texture rendered separately, instead of all 16 chunks
 * sharing a single image stretched across the whole map. That is what restores ground
 * detail: the central chunks get ~146 m/pixel rather than ~391 m/pixel everywhere.
 *
 * Geometry for these chunks must use LOCAL UVs (0..1 within the chunk) — see
 * buildRealChunkGeometry.
 */

const cache = new Map<string, THREE.Texture>();
const pending = new Map<string, Promise<THREE.Texture | null>>();

export function chunkTilePath(chunkId: string): string {
  return `tiles/erbil_chunk_${chunkId}.jpg`;
}

export function loadChunkTile(chunkId: string): Promise<THREE.Texture | null> {
  const cached = cache.get(chunkId);
  if (cached) return Promise.resolve(cached);

  const inFlight = pending.get(chunkId);
  if (inFlight) return inFlight;

  const promise = new Promise<THREE.Texture | null>((resolve) => {
    new THREE.TextureLoader().load(
      chunkTilePath(chunkId),
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 16;
        // Tiles are exact crops: they must clamp, never wrap.
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        cache.set(chunkId, tex);
        resolve(tex);
      },
      undefined,
      () => {
        console.warn(`[ChunkTile] missing tile for chunk ${chunkId} — run scripts/build_chunk_tiles.cjs`);
        resolve(null);
      }
    );
  });

  pending.set(chunkId, promise);
  return promise;
}
