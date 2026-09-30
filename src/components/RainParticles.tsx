import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RainStreakLineShader, RainShaftCurtainShader } from '../shaders/rainShader';

interface RainParticlesProps {
  weatherTexture: THREE.Texture;
  rainThreshold?: number;
  snowTempThreshold?: number;
  activeMaxPrecipitation?: number;
  hasActivePrecipitation?: boolean;
  windSpeed?: number;
  cloudBaseY?: number;
  globeRefXZ?: [number, number];
}

const MAX_RAIN_STREAKS = 28000;
const MAX_RAIN_SHAFTS = 420;

/**
 * Renders 3D Falling Rain Streaks (THREE.LineSegments) and Sub-Cloud Volumetric Rain Shafts
 * strictly emerging from the bottom of the 3D clouds (cloudBaseY) down to the curved Earth Globe terrain
 * in the exact areas where the Rain Radar channel (weatherTexture.g > 0.04) shows rain.
 */
export const RainParticles: React.FC<RainParticlesProps> = ({
  weatherTexture,
  snowTempThreshold = 2.5,
  windSpeed = 0.8,
  cloudBaseY = 3400,
  globeRefXZ = [0, 0]
}) => {
  const streakMatRef = useRef<THREE.ShaderMaterial>(null);
  const shaftMatRef = useRef<THREE.ShaderMaterial>(null);

  const { streakGeometry, shaftGeometry, hasRadarRainCells } = useMemo(() => {
    const dataTex = weatherTexture as THREE.DataTexture;
    const raw = dataTex?.image?.data as Uint8Array | undefined;
    const w = dataTex?.image?.width || 0;
    const h = dataTex?.image?.height || 0;

    const radarCells: Array<{ u: number; v: number; rainNorm: number }> = [];
    if (raw && w > 0 && h > 0) {
      const step = Math.max(1, Math.floor(w / 256));
      for (let py = 2; py < h - 2; py += step) {
        for (let px = 2; px < w - 2; px += step) {
          const idx = (py * w + px) * 4;
          const cloudNorm = raw[idx] / 255.0;
          const rainNorm = raw[idx + 1] / 255.0;
          if (rainNorm > 0.04 && cloudNorm > 0.12) {
            radarCells.push({
              u: px / w,
              v: py / h,
              rainNorm
            });
          }
        }
      }
    }

    if (radarCells.length === 0) {
      return {
        streakGeometry: new THREE.BufferGeometry(),
        shaftGeometry: new THREE.InstancedBufferGeometry(),
        hasRadarRainCells: false
      };
    }

    let seedState = 918273;
    const nextRand = () => {
      seedState = (seedState * 16807) % 2147483647;
      return (seedState - 1) / 2147483646;
    };

    const activeStreaks = Math.min(MAX_RAIN_STREAKS, Math.max(4500, radarCells.length * 14));
    const positions = new Float32Array(activeStreaks * 2 * 3);
    const cloudOrigins = new Float32Array(activeStreaks * 2 * 3);
    const vertexEnds = new Float32Array(activeStreaks * 2);
    const seeds = new Float32Array(activeStreaks * 2);

    const cellSpacingX = 480000 / Math.min(256, w);
    const cellSpacingZ = 320000 / Math.min(256, h);

    for (let i = 0; i < activeStreaks; i++) {
      const cell = radarCells[(i * 13) % radarCells.length];
      const worldX = cell.u * 480000 - 240000 + (nextRand() - 0.5) * cellSpacingX * 1.35;
      const worldZ = cell.v * 320000 - 160000 + (nextRand() - 0.5) * cellSpacingZ * 1.35;
      const phase = nextRand();
      const sVal = nextRand();

      const v0 = i * 2;
      const v1 = i * 2 + 1;

      cloudOrigins[v0 * 3] = worldX;
      cloudOrigins[v0 * 3 + 1] = phase;
      cloudOrigins[v0 * 3 + 2] = worldZ;

      cloudOrigins[v1 * 3] = worldX;
      cloudOrigins[v1 * 3 + 1] = phase;
      cloudOrigins[v1 * 3 + 2] = worldZ;

      vertexEnds[v0] = 0.0;
      vertexEnds[v1] = 1.0;

      seeds[v0] = sVal;
      seeds[v1] = sVal;
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    lineGeo.setAttribute('aCloudOrigin', new THREE.BufferAttribute(cloudOrigins, 3));
    lineGeo.setAttribute('aVertexEnd', new THREE.BufferAttribute(vertexEnds, 1));
    lineGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const baseQuad = new THREE.PlaneGeometry(1, 1, 1, 1);
    const shaftGeo = new THREE.InstancedBufferGeometry();
    shaftGeo.index = baseQuad.index;
    shaftGeo.attributes.position = baseQuad.attributes.position;
    shaftGeo.attributes.uv = baseQuad.attributes.uv;

    const shaftCount = Math.min(MAX_RAIN_SHAFTS, radarCells.length);
    const shaftOrigins = new Float32Array(shaftCount * 3);
    const shaftWidths = new Float32Array(shaftCount);

    for (let i = 0; i < shaftCount; i++) {
      const cell = radarCells[Math.floor((i / shaftCount) * radarCells.length)];
      shaftOrigins[i * 3] = cell.u * 480000 - 240000;
      shaftOrigins[i * 3 + 1] = nextRand() * Math.PI;
      shaftOrigins[i * 3 + 2] = cell.v * 320000 - 160000;
      shaftWidths[i] = 6200 + cell.rainNorm * 5400;
    }

    shaftGeo.setAttribute('aShaftOrigin', new THREE.InstancedBufferAttribute(shaftOrigins, 3));
    shaftGeo.setAttribute('aShaftWidth', new THREE.InstancedBufferAttribute(shaftWidths, 1));
    shaftGeo.instanceCount = shaftCount;

    return {
      streakGeometry: lineGeo,
      shaftGeometry: shaftGeo,
      hasRadarRainCells: true
    };
  }, [weatherTexture]);

  const streakUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWeatherData: { value: weatherTexture },
      uCloudBaseY: { value: cloudBaseY },
      uSnowTempThreshold: { value: snowTempThreshold },
      uFallSpeed: { value: 1850.0 },
      uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
      uWindSpeed: { value: windSpeed },
      uGlobeRefXZ: { value: new THREE.Vector2(globeRefXZ[0], globeRefXZ[1]) }
    }),
    []
  );

  const shaftUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uWeatherData: { value: weatherTexture },
      uCloudBaseY: { value: cloudBaseY },
      uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
      uWindSpeed: { value: windSpeed },
      uGlobeRefXZ: { value: new THREE.Vector2(globeRefXZ[0], globeRefXZ[1]) }
    }),
    []
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (streakMatRef.current) {
      streakMatRef.current.uniforms.uTime.value = t;
      streakMatRef.current.uniforms.uWeatherData.value = weatherTexture;
      streakMatRef.current.uniforms.uCloudBaseY.value = cloudBaseY;
      streakMatRef.current.uniforms.uSnowTempThreshold.value = snowTempThreshold;
      streakMatRef.current.uniforms.uWindSpeed.value = windSpeed;
      streakMatRef.current.uniforms.uGlobeRefXZ.value.set(globeRefXZ[0], globeRefXZ[1]);
    }
    if (shaftMatRef.current) {
      shaftMatRef.current.uniforms.uTime.value = t;
      shaftMatRef.current.uniforms.uWeatherData.value = weatherTexture;
      shaftMatRef.current.uniforms.uCloudBaseY.value = cloudBaseY;
      shaftMatRef.current.uniforms.uWindSpeed.value = windSpeed;
      shaftMatRef.current.uniforms.uGlobeRefXZ.value.set(globeRefXZ[0], globeRefXZ[1]);
    }
  });

  if (!hasRadarRainCells) {
    return null;
  }

  return (
    <group>
      <mesh geometry={shaftGeometry} frustumCulled={false}>
        <shaderMaterial
          ref={shaftMatRef}
          uniforms={shaftUniforms}
          vertexShader={RainShaftCurtainShader.vertexShader}
          fragmentShader={RainShaftCurtainShader.fragmentShader}
          transparent={true}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <lineSegments geometry={streakGeometry} frustumCulled={false}>
        <shaderMaterial
          ref={streakMatRef}
          uniforms={streakUniforms}
          vertexShader={RainStreakLineShader.vertexShader}
          fragmentShader={RainStreakLineShader.fragmentShader}
          transparent={true}
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
      </lineSegments>
    </group>
  );
};
