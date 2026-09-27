import React, { useMemo, useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import gsap from 'gsap';
import {
  buildRealChunkGeometry,
  getKurdistanSatelliteTexture,
  loadRealDemData
} from '../utils/realSulaymaniyahTerrain';
import { CHUNK_WIDTH_METERS, CHUNK_HEIGHT_METERS } from '../utils/weatherDataPipeline';
import { SunPositionResult } from '../utils/sunPosition';

interface TerrainChunkProps {
  id: string;
  gridX: number;
  gridY: number;
  wireframe?: boolean;
  isSelected?: boolean;
  terrainExaggeration?: number;
  customTexture?: THREE.Texture | null;
  phenomenaTexture?: THREE.Texture | null;
  sunPosition?: SunPositionResult;
}

/**
 * Renders a 3D Topographic Chunk of Northern Iraq & Kurdistan.
 * - Ground texture is ALWAYS the crisp High-Definition Kurdistan Orthomosaic (HD Base),
 *   or HD Base + Live Doppler Radar when in radar mode.
 * - Injects physical Ground Snow Cover (on high Zagros alpine peaks & freezing ridges)
 *   and soft 3D Cloud Shadows from the active NASA satellite pass with fluid GSAP transitions.
 */
export const TerrainChunk: React.FC<TerrainChunkProps> = ({
  gridX,
  gridY,
  wireframe = false,
  isSelected = false,
  terrainExaggeration = 1.35,
  customTexture = null,
  phenomenaTexture = null,
  sunPosition
}) => {
  const [demLoaded, setDemLoaded] = useState(false);
  const prevPhenomRef = useRef<THREE.Texture | null>(phenomenaTexture);
  const shaderUniformsRef = useRef<{
    uPhenomena: { value: THREE.Texture | null };
    uPhenomenaPrev: { value: THREE.Texture | null };
    uTransitionProgress: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uTerrainExaggeration: { value: number };
  }>({
    uPhenomena: { value: phenomenaTexture },
    uPhenomenaPrev: { value: phenomenaTexture },
    uTransitionProgress: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uTerrainExaggeration: { value: terrainExaggeration }
  });

  useEffect(() => {
    if (prevPhenomRef.current !== phenomenaTexture) {
      shaderUniformsRef.current.uPhenomenaPrev.value = prevPhenomRef.current;
      shaderUniformsRef.current.uPhenomena.value = phenomenaTexture;
      prevPhenomRef.current = phenomenaTexture;

      gsap.killTweensOf(shaderUniformsRef.current.uTransitionProgress);
      gsap.fromTo(
        shaderUniformsRef.current.uTransitionProgress,
        { value: 0.0 },
        { value: 1.0, duration: 1.35, ease: 'power2.inOut' }
      );
    }
  }, [phenomenaTexture]);

  useEffect(() => {
    let mounted = true;
    loadRealDemData().then((data) => {
      if (mounted && data) {
        setDemLoaded(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const geometry = useMemo(() => {
    const res = isSelected ? 96 : 80;
    return buildRealChunkGeometry(
      gridX,
      gridY,
      CHUNK_WIDTH_METERS,
      CHUNK_HEIGHT_METERS,
      res,
      terrainExaggeration
    );
  }, [gridX, gridY, demLoaded, terrainExaggeration, isSelected]);

  // Always use the crisp HD Base texture unless a radar composite is explicitly supplied
  const satelliteTexture = useMemo(() => {
    if (customTexture) return customTexture;
    return getKurdistanSatelliteTexture('hd');
  }, [customTexture]);

  useFrame(() => {
    shaderUniformsRef.current.uTerrainExaggeration.value = terrainExaggeration;
    if (sunPosition) {
      shaderUniformsRef.current.uSunDir.value.copy(sunPosition.sunDirection);
    }
  });

  const handleBeforeCompile = useMemo(() => {
    return (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPhenomena = shaderUniformsRef.current.uPhenomena;
      shader.uniforms.uPhenomenaPrev = shaderUniformsRef.current.uPhenomenaPrev;
      shader.uniforms.uTransitionProgress = shaderUniformsRef.current.uTransitionProgress;
      shader.uniforms.uSunDir = shaderUniformsRef.current.uSunDir;
      shader.uniforms.uTerrainExaggeration = shaderUniformsRef.current.uTerrainExaggeration;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldNorm;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWorldPos = wp.xyz;
        vWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uPhenomena;
        uniform sampler2D uPhenomenaPrev;
        uniform float uTransitionProgress;
        uniform vec3 uSunDir;
        uniform float uTerrainExaggeration;
        varying vec3 vWorldPos;
        varying vec3 vWorldNorm;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Map world XZ (-120km..+120km, -80km..+80km) to domain UV (0..1)
        vec2 domainUv = clamp(vec2(
          (vWorldPos.x + 120000.0) / 240000.0,
          (vWorldPos.z + 80000.0) / 160000.0
        ), 0.002, 0.998);

        vec4 phenom = texture2D(uPhenomena, domainUv) * clamp(uTransitionProgress, 0.0, 1.0);
        float satSnowCover = phenom.r;

        // 1. Real Ground Snow Cover (strictly from real satellite snow detection / freezing snow depth)
        float slopeUp = clamp(vWorldNorm.y, 0.0, 1.0);
        float totalSnowCover = clamp(satSnowCover * smoothstep(0.35, 0.72, slopeUp), 0.0, 0.92);

        if (totalSnowCover > 0.02) {
          float sunFacing = clamp(dot(vWorldNorm, uSunDir), 0.0, 1.0);
          vec3 snowAlbedo = mix(vec3(0.80, 0.88, 0.97), vec3(0.98, 0.99, 1.0), sunFacing);
          diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, totalSnowCover);
        }

        // 2. Soft 3D Cloud Shadows projected onto the HD Base terrain along solar vector
        vec2 shadowOffset = uSunDir.xz * (2600.0 / max(0.25, uSunDir.y));
        vec2 shadowUv = clamp(vec2(
          (vWorldPos.x - shadowOffset.x + 120000.0) / 240000.0,
          (vWorldPos.z - shadowOffset.y + 80000.0) / 160000.0
        ), 0.002, 0.998);
        float cloudAbove = texture2D(uPhenomena, shadowUv).a * clamp(uTransitionProgress, 0.0, 1.0);
        float cloudShadow = 1.0 - smoothstep(0.12, 0.75, cloudAbove) * 0.36;
        diffuseColor.rgb *= cloudShadow;`
      );
    };
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  return (
    <group position={[gridX, 0, gridY]}>
      <mesh geometry={geometry} receiveShadow castShadow>
        <meshStandardMaterial
          key={satelliteTexture ? `${satelliteTexture.uuid}_hd_snow` : 'none'}
          map={wireframe ? null : satelliteTexture}
          vertexColors={wireframe}
          roughness={0.82}
          metalness={0.06}
          wireframe={wireframe}
          flatShading={false}
          onBeforeCompile={handleBeforeCompile}
        />
      </mesh>
    </group>
  );
};
