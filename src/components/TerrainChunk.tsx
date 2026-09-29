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
  cloudShadowDepthTexture?: THREE.Texture | null;
  cloudBaseY?: number;
  cloudTopY?: number;
  sunPosition?: SunPositionResult;
}

/**
 * Renders a 3D Topographic Chunk of Northern Iraq & Kurdistan.
 * - Ground texture is ALWAYS the crisp High-Definition Kurdistan Orthomosaic (HD Base),
 *   or HD Base + Live Doppler Radar when in radar mode.
 * - Uses Secondary Depth-Buffer-Based Projection (`uCloudShadowDepth`) for cloud shadows
 *   on the 3D terrain, modulating shadow intensity by the multi-octave FBM density map
 *   and true terrain-to-cloud elevation depth parallax (`vWorldPos.y` vs `uCloudBaseY..uCloudTopY`).
 */
export const TerrainChunk: React.FC<TerrainChunkProps> = ({
  gridX,
  gridY,
  wireframe = false,
  isSelected = false,
  terrainExaggeration = 1.35,
  customTexture = null,
  phenomenaTexture = null,
  cloudShadowDepthTexture = null,
  cloudBaseY = 4400,
  cloudTopY = 6600,
  sunPosition
}) => {
  const [demLoaded, setDemLoaded] = useState(false);
  const prevPhenomRef = useRef<THREE.Texture | null>(phenomenaTexture);
  const shaderUniformsRef = useRef<{
    uPhenomena: { value: THREE.Texture | null };
    uPhenomenaPrev: { value: THREE.Texture | null };
    uCloudShadowDepth: { value: THREE.Texture | null };
    uTransitionProgress: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uTerrainExaggeration: { value: number };
    uCloudBaseY: { value: number };
    uCloudTopY: { value: number };
  }>({
    uPhenomena: { value: phenomenaTexture },
    uPhenomenaPrev: { value: phenomenaTexture },
    uCloudShadowDepth: { value: cloudShadowDepthTexture },
    uTransitionProgress: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uTerrainExaggeration: { value: terrainExaggeration },
    uCloudBaseY: { value: cloudBaseY },
    uCloudTopY: { value: cloudTopY }
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

  const satelliteTexture = useMemo(() => {
    if (customTexture) return customTexture;
    return getKurdistanSatelliteTexture('hd');
  }, [customTexture]);

  useFrame(() => {
    shaderUniformsRef.current.uTerrainExaggeration.value = terrainExaggeration;
    shaderUniformsRef.current.uCloudShadowDepth.value = cloudShadowDepthTexture;
    shaderUniformsRef.current.uCloudBaseY.value = cloudBaseY;
    shaderUniformsRef.current.uCloudTopY.value = cloudTopY;
    if (sunPosition) {
      shaderUniformsRef.current.uSunDir.value.copy(sunPosition.sunDirection);
    }
  });

  const handleBeforeCompile = useMemo(() => {
    return (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPhenomena = shaderUniformsRef.current.uPhenomena;
      shader.uniforms.uPhenomenaPrev = shaderUniformsRef.current.uPhenomenaPrev;
      shader.uniforms.uCloudShadowDepth = shaderUniformsRef.current.uCloudShadowDepth;
      shader.uniforms.uTransitionProgress = shaderUniformsRef.current.uTransitionProgress;
      shader.uniforms.uSunDir = shaderUniformsRef.current.uSunDir;
      shader.uniforms.uTerrainExaggeration = shaderUniformsRef.current.uTerrainExaggeration;
      shader.uniforms.uCloudBaseY = shaderUniformsRef.current.uCloudBaseY;
      shader.uniforms.uCloudTopY = shaderUniformsRef.current.uCloudTopY;

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
        uniform sampler2D uCloudShadowDepth;
        uniform float uTransitionProgress;
        uniform vec3 uSunDir;
        uniform float uTerrainExaggeration;
        uniform float uCloudBaseY;
        uniform float uCloudTopY;
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

        float transProg = clamp(uTransitionProgress, 0.0, 1.0);
        vec4 phenom = texture2D(uPhenomena, domainUv) * transProg;
        float satSnowCover = phenom.r;

        // 1. Real Ground Snow Cover (strictly from real satellite snow detection / freezing snow depth)
        float slopeUp = clamp(vWorldNorm.y, 0.0, 1.0);
        float totalSnowCover = clamp(satSnowCover * smoothstep(0.35, 0.72, slopeUp), 0.0, 0.92);

        if (totalSnowCover > 0.02) {
          float sunFacing = clamp(dot(vWorldNorm, uSunDir), 0.0, 1.0);
          vec3 snowAlbedo = mix(vec3(0.80, 0.88, 0.97), vec3(0.98, 0.99, 1.0), sunFacing);
          diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, totalSnowCover);
        }

        // 2. Secondary Depth-Buffer-Based Projection for Cloud Shadows Modulated by Multi-Octave FBM Density:
        // Step A: Initial depth-parallax ray projection from terrain elevation vWorldPos.y to uCloudBaseY
        float sunElevY = max(0.22, uSunDir.y);
        float baseDepthDelta = max(150.0, uCloudBaseY - vWorldPos.y);
        vec2 initialRayXZ = vWorldPos.xz + uSunDir.xz * (baseDepthDelta / sunElevY);
        vec2 initialShadowUv = clamp(vec2(
          (initialRayXZ.x + 120000.0) / 240000.0,
          (initialRayXZ.y + 80000.0) / 160000.0
        ), 0.002, 0.998);

        // Read effective cloud caster depth (G channel) from the secondary FBM shadow depth buffer
        vec4 depthPass1 = texture2D(uCloudShadowDepth, initialShadowUv);
        float effectiveCasterHeight = mix(uCloudBaseY, uCloudTopY, depthPass1.g);

        // Step B: Refined 2-step Depth-Buffer Parallax Projection using actual cloud-caster height vs terrain depth
        float refinedDepthDelta = max(150.0, effectiveCasterHeight - vWorldPos.y);
        vec2 refinedRayXZ = vWorldPos.xz + uSunDir.xz * (refinedDepthDelta / sunElevY);
        vec2 refinedShadowUv = clamp(vec2(
          (refinedRayXZ.x + 120000.0) / 240000.0,
          (refinedRayXZ.y + 80000.0) / 160000.0
        ), 0.002, 0.998);

        // Sample FBM optical depth (R), FBM fringe penumbra (B), and Beer-Lambert occlusion (A)
        vec4 fbmShadowSample = texture2D(uCloudShadowDepth, refinedShadowUv);
        float fbmOpticalDepth = fbmShadowSample.r * transProg;
        float fbmPenumbraMod  = mix(0.72, 1.25, fbmShadowSample.b);
        float fbmShadowAlpha  = fbmShadowSample.a * fbmPenumbraMod * transProg;

        // Modulate shadow intensity by multi-octave FBM optical depth & terrain slope sun-incidence
        float sunSlopeFactor = smoothstep(-0.15, 0.45, dot(vWorldNorm, uSunDir));
        float shadowDarkening = clamp(
          (fbmShadowAlpha * 0.65 + fbmOpticalDepth * 0.35) * 0.44 * (0.65 + 0.35 * sunSlopeFactor),
          0.0,
          0.46
        );

        // Cool atmospheric Rayleigh tint inside FBM-projected cloud shadows
        vec3 shadowedTerrain = diffuseColor.rgb * vec3(0.84, 0.89, 0.96) * (1.0 - shadowDarkening);
        diffuseColor.rgb = mix(diffuseColor.rgb, shadowedTerrain, smoothstep(0.01, 0.12, shadowDarkening));`
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
