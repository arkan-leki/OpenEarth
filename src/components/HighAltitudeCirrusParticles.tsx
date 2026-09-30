import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { ClusteredCumulusBillboardShader } from '../shaders/cirrusParticleShader';
import { SunPositionResult } from '../utils/sunPosition';

interface HighAltitudeCirrusParticlesProps {
  weatherTexture: THREE.Texture;
  sunPosition?: SunPositionResult;
  windSpeed?: number;
  cloudBaseY?: number;
  visible?: boolean;
}

const MAX_CUMULUS_PUFFS = 900;

/**
 * Clustered Cumulus Particle Billboards (Strategy 3)
 *
 * Spawns THREE.InstancedMesh alpha-blended cumulus puffs strictly inside satellite-detected
 * cumulus cores at the active `cloudBaseY` altitude (never slicing through mountains with
 * flat planes and never floating at fake high altitudes).
 */
export const HighAltitudeCirrusParticles: React.FC<HighAltitudeCirrusParticlesProps> = ({
  weatherTexture,
  sunPosition,
  windSpeed = 0.8,
  cloudBaseY = 3400,
  visible = true
}) => {
  const puffMatRef = useRef<THREE.ShaderMaterial>(null);
  const prevTexRef = useRef<THREE.Texture>(weatherTexture);

  const { puffGeometry, activePuffCount } = useMemo(() => {
    const baseQuad = new THREE.PlaneGeometry(1, 1, 1, 1);
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseQuad.index;
    instGeo.attributes.position = baseQuad.attributes.position;
    instGeo.attributes.uv = baseQuad.attributes.uv;

    const origins = new Float32Array(MAX_CUMULUS_PUFFS * 3);
    const scales = new Float32Array(MAX_CUMULUS_PUFFS * 2);
    const seeds = new Float32Array(MAX_CUMULUS_PUFFS);
    const heightNorms = new Float32Array(MAX_CUMULUS_PUFFS);

    const dataTex = weatherTexture as THREE.DataTexture;
    const raw = dataTex?.image?.data as Uint8Array | undefined;
    const w = dataTex?.image?.width || 0;
    const h = dataTex?.image?.height || 0;

    const cloudCells: Array<{ u: number; v: number; strength: number }> = [];
    if (raw && w > 0 && h > 0) {
      const step = Math.max(2, Math.floor(w / 128));
      for (let py = 2; py < h - 2; py += step) {
        for (let px = 2; px < w - 2; px += step) {
          const idx = (py * w + px) * 4;
          const cR = raw[idx] / 255.0;
          const cA = raw[idx + 3] / 255.0;
          if (cR > 0.25 && cA > 0.30) {
            cloudCells.push({
              u: px / w,
              v: py / h,
              strength: Math.max(cR, cA)
            });
          }
        }
      }
    }

    let count = 0;
    if (cloudCells.length > 0) {
      let s = 48271;
      const nextRand = () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
      };

      count = Math.min(MAX_CUMULUS_PUFFS, cloudCells.length * 2);
      for (let i = 0; i < count; i++) {
        const cell = cloudCells[(i * 7) % cloudCells.length];
        const jitterX = (nextRand() - 0.5) * 2600;
        const jitterZ = (nextRand() - 0.5) * 2600;
        const hNorm = nextRand();

        const worldX = cell.u * 240000 - 120000 + jitterX;
        const worldZ = cell.v * 160000 - 80000 + jitterZ;
        // Relative vertical offset above cloudBaseY (200m to 1,250m above base)
        const relY = 200 + hNorm * (650 + cell.strength * 450);

        origins[i * 3] = worldX;
        origins[i * 3 + 1] = relY;
        origins[i * 3 + 2] = worldZ;

        const size = 3800 + nextRand() * 4200;
        scales[i * 2] = size * 1.2;
        scales[i * 2 + 1] = size * 0.82;

        seeds[i] = nextRand();
        heightNorms[i] = hNorm;
      }
    }

    instGeo.setAttribute('aPuffOrigin', new THREE.InstancedBufferAttribute(origins, 3));
    instGeo.setAttribute('aPuffScale', new THREE.InstancedBufferAttribute(scales, 2));
    instGeo.setAttribute('aPuffSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    instGeo.setAttribute('aHeightNorm', new THREE.InstancedBufferAttribute(heightNorms, 1));
    instGeo.instanceCount = count;

    return { puffGeometry: instGeo, activePuffCount: count };
  }, [weatherTexture]);

  const puffUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWeatherData: { value: weatherTexture },
      uTransitionProgress: { value: 1.0 },
      uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
      uSunColor: { value: new THREE.Color('#fffdf8') },
      uSkyColor: { value: new THREE.Color('#476487') },
      uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
      uWindSpeed: { value: windSpeed }
    }),
    []
  );

  useEffect(() => {
    if (prevTexRef.current !== weatherTexture && puffMatRef.current) {
      prevTexRef.current = weatherTexture;
      puffMatRef.current.uniforms.uWeatherData.value = weatherTexture;
      gsap.killTweensOf(puffMatRef.current.uniforms.uTransitionProgress);
      gsap.fromTo(
        puffMatRef.current.uniforms.uTransitionProgress,
        { value: 0.0 },
        { value: 1.0, duration: 0.9, ease: 'power2.out' }
      );
    }
  }, [weatherTexture]);

  useFrame((state) => {
    const mat = puffMatRef.current;
    if (!mat) return;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uWeatherData.value = weatherTexture;
    mat.uniforms.uWindSpeed.value = windSpeed;
    if (sunPosition) {
      mat.uniforms.uSunDir.value.copy(sunPosition.sunDirection);
      mat.uniforms.uSunColor.value.set(sunPosition.lightColor);
      mat.uniforms.uSkyColor.value.set(sunPosition.ambientColor);
    }
  });

  if (!visible || activePuffCount === 0) return null;

  return (
    <group position={[0, cloudBaseY, 0]}>
      <mesh geometry={puffGeometry} frustumCulled={false}>
        <shaderMaterial
          ref={puffMatRef}
          uniforms={puffUniforms}
          vertexShader={ClusteredCumulusBillboardShader.vertexShader}
          fragmentShader={ClusteredCumulusBillboardShader.fragmentShader}
          transparent={true}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};
