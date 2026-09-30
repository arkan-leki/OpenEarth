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
  weatherTexture?: THREE.Texture | null;
  cloudShadowDepthTexture?: THREE.Texture | null;
  cloudBaseY?: number;
  cloudTopY?: number;
  sunPosition?: SunPositionResult;
  globeRefXZ?: [number, number];
}

/**
 * Renders a 3D Curved Planetary Globe Chunk of Eastern Turkey, Eastern Syria, Northern Iraq, and Western Iran (480km x 320km).
 * - Applies physical Earth Globe curvature (-d^2 / 5,500,000) so flat land drops below the horizon at ~50km
 *   and mountains drop below the horizon at ~100km.
 * - Applies Temperature-Aware Rayleigh Blue Atmospheric Perspective on distant mountains & land:
 *   - Cold air / high peaks: deep alpine cobalt-azure blue scattering on distant mountains while preserving ridge detail
 *   - Warm / hot air: sharp high-contrast surface details with soft cerulean horizon blue at 50km-110km.
 */
export const TerrainChunk: React.FC<TerrainChunkProps> = ({
  gridX,
  gridY,
  wireframe = false,
  isSelected = false,
  terrainExaggeration = 1.35,
  customTexture = null,
  phenomenaTexture = null,
  weatherTexture = null,
  cloudShadowDepthTexture = null,
  cloudBaseY = 3400,
  cloudTopY = 5200,
  sunPosition,
  globeRefXZ = [0, 0]
}) => {
  const [demLoaded, setDemLoaded] = useState(false);
  const prevPhenomRef = useRef<THREE.Texture | null>(phenomenaTexture);
  const shaderUniformsRef = useRef<{
    uPhenomena: { value: THREE.Texture | null };
    uPhenomenaPrev: { value: THREE.Texture | null };
    uWeatherData: { value: THREE.Texture | null };
    uCloudShadowDepth: { value: THREE.Texture | null };
    uTransitionProgress: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uTerrainExaggeration: { value: number };
    uCloudBaseY: { value: number };
    uCloudTopY: { value: number };
    uGlobeRefXZ: { value: THREE.Vector2 };
  }>({
    uPhenomena: { value: phenomenaTexture },
    uPhenomenaPrev: { value: phenomenaTexture },
    uWeatherData: { value: weatherTexture },
    uCloudShadowDepth: { value: cloudShadowDepthTexture },
    uTransitionProgress: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uTerrainExaggeration: { value: terrainExaggeration },
    uCloudBaseY: { value: cloudBaseY },
    uCloudTopY: { value: cloudTopY },
    uGlobeRefXZ: { value: new THREE.Vector2(globeRefXZ[0], globeRefXZ[1]) }
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
    shaderUniformsRef.current.uWeatherData.value = weatherTexture;
    shaderUniformsRef.current.uCloudShadowDepth.value = cloudShadowDepthTexture;
    shaderUniformsRef.current.uCloudBaseY.value = cloudBaseY;
    shaderUniformsRef.current.uCloudTopY.value = cloudTopY;
    shaderUniformsRef.current.uGlobeRefXZ.value.set(globeRefXZ[0], globeRefXZ[1]);
    if (sunPosition) {
      shaderUniformsRef.current.uSunDir.value.copy(sunPosition.sunDirection);
    }
  });

  const handleBeforeCompile = useMemo(() => {
    return (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPhenomena = shaderUniformsRef.current.uPhenomena;
      shader.uniforms.uPhenomenaPrev = shaderUniformsRef.current.uPhenomenaPrev;
      shader.uniforms.uWeatherData = shaderUniformsRef.current.uWeatherData;
      shader.uniforms.uCloudShadowDepth = shaderUniformsRef.current.uCloudShadowDepth;
      shader.uniforms.uTransitionProgress = shaderUniformsRef.current.uTransitionProgress;
      shader.uniforms.uSunDir = shaderUniformsRef.current.uSunDir;
      shader.uniforms.uTerrainExaggeration = shaderUniformsRef.current.uTerrainExaggeration;
      shader.uniforms.uCloudBaseY = shaderUniformsRef.current.uCloudBaseY;
      shader.uniforms.uCloudTopY = shaderUniformsRef.current.uCloudTopY;
      shader.uniforms.uGlobeRefXZ = shaderUniformsRef.current.uGlobeRefXZ;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform vec2 uGlobeRefXZ;
        varying vec3 vWorldPos;
        varying float vUnCurvedY;
        varying vec3 vWorldNorm;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vUnCurvedY = wp.y;
        // Spherical Earth Globe Curvature:
        // At 50km distance, Earth drops by ~454m (flat plains disappear below horizon)
        // At 100km distance, Earth drops by ~1,818m (mountains disappear below horizon)
        vec2 dGlobe = wp.xz - uGlobeRefXZ;
        float globeCurveDrop = -dot(dGlobe, dGlobe) / 5500000.0;
        wp.y += globeCurveDrop;
        vWorldPos = wp.xyz;
        vWorldNorm = normalize(mat3(modelMatrix) * objectNormal);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uPhenomena;
        uniform sampler2D uPhenomenaPrev;
        uniform sampler2D uWeatherData;
        uniform sampler2D uCloudShadowDepth;
        uniform float uTransitionProgress;
        uniform vec3 uSunDir;
        uniform float uTerrainExaggeration;
        uniform float uCloudBaseY;
        uniform float uCloudTopY;
        varying vec3 vWorldPos;
        varying float vUnCurvedY;
        varying vec3 vWorldNorm;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Map world XZ (-240km..+240km, -160km..+160km) to domain UV (0..1)
        vec2 domainUv = clamp(vec2(
          (vWorldPos.x + 240000.0) / 480000.0,
          (vWorldPos.z + 160000.0) / 320000.0
        ), 0.002, 0.998);

        float transProg = clamp(uTransitionProgress, 0.0, 1.0);
        vec4 phenom = texture2D(uPhenomena, domainUv) * transProg;
        float satSnowCover = phenom.r;

        // 1. Real Ground Snow Cover
        float slopeUp = clamp(vWorldNorm.y, 0.0, 1.0);
        float totalSnowCover = clamp(satSnowCover * smoothstep(0.35, 0.72, slopeUp), 0.0, 0.92);

        if (totalSnowCover > 0.02) {
          float sunFacing = clamp(dot(vWorldNorm, uSunDir), 0.0, 1.0);
          vec3 snowAlbedo = mix(vec3(0.80, 0.88, 0.97), vec3(0.98, 0.99, 1.0), sunFacing);
          diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, totalSnowCover);
        }

        // 2. Secondary Depth-Buffer-Based Projection for Cloud Shadows Modulated by Multi-Octave FBM Density
        float sunElevY = max(0.22, uSunDir.y);
        float baseDepthDelta = max(150.0, uCloudBaseY - vUnCurvedY);
        vec2 initialRayXZ = vWorldPos.xz + uSunDir.xz * (baseDepthDelta / sunElevY);
        vec2 initialShadowUv = clamp(vec2(
          (initialRayXZ.x + 240000.0) / 480000.0,
          (initialRayXZ.y + 160000.0) / 320000.0
        ), 0.002, 0.998);

        vec4 depthPass1 = texture2D(uCloudShadowDepth, initialShadowUv);
        float effectiveCasterHeight = mix(uCloudBaseY, uCloudTopY, depthPass1.g);

        float refinedDepthDelta = max(150.0, effectiveCasterHeight - vUnCurvedY);
        vec2 refinedRayXZ = vWorldPos.xz + uSunDir.xz * (refinedDepthDelta / sunElevY);
        vec2 refinedShadowUv = clamp(vec2(
          (refinedRayXZ.x + 240000.0) / 480000.0,
          (refinedRayXZ.y + 160000.0) / 320000.0
        ), 0.002, 0.998);

        vec4 fbmShadowSample = texture2D(uCloudShadowDepth, refinedShadowUv);
        float fbmOpticalDepth = fbmShadowSample.r * transProg;
        float fbmPenumbraMod  = mix(0.72, 1.25, fbmShadowSample.b);
        float fbmShadowAlpha  = fbmShadowSample.a * fbmPenumbraMod * transProg;

        float sunSlopeFactor = smoothstep(-0.15, 0.45, dot(vWorldNorm, uSunDir));
        float shadowDarkening = clamp(
          (fbmShadowAlpha * 0.65 + fbmOpticalDepth * 0.35) * 0.44 * (0.65 + 0.35 * sunSlopeFactor),
          0.0,
          0.46
        );

        vec3 shadowedTerrain = diffuseColor.rgb * vec3(0.82, 0.88, 0.96) * (1.0 - shadowDarkening);
        diffuseColor.rgb = mix(diffuseColor.rgb, shadowedTerrain, smoothstep(0.01, 0.12, shadowDarkening));

        // 3. Temperature-Aware Rayleigh Blue Atmospheric Perspective on Distant Mountains & Land:
        // - Horizontal distance in km from the observer camera
        float distKm = length(vWorldPos.xz - cameraPosition.xz) * 0.001;
        vec4 localW = texture2D(uWeatherData, domainUv);
        float normTemp = localW.b; // 0 = -5°C (cold), 1 = +42°C (hot)
        float elevCold = clamp(vUnCurvedY / 3800.0, 0.0, 1.0);
        float coldAirFactor = clamp(1.0 - normTemp * 1.20 + elevCold * 0.42, 0.0, 1.0);
        float hotAirFactor  = clamp(1.0 - coldAirFactor, 0.0, 1.0);

        // When hot or clear, crisp topographic ridge details are accentuated
        float ridgeDetailContrast = clamp(dot(vWorldNorm, normalize(vec3(0.45, 0.75, 0.35))), 0.25, 1.15);
        float detailBoost = mix(1.0, 0.85 + 0.32 * ridgeDetailContrast, 0.45 + 0.45 * hotAirFactor);
        diffuseColor.rgb *= detailBoost;

        // Distant mountains & land turn atmospheric Rayleigh blue (stronger cobalt-blue when cold,
        // clearer detail with soft sky-azure tint at 45km-125km when warm/hot)
        float blueStartKm = mix(28.0, 18.0, coldAirFactor);
        float blueFullKm  = mix(125.0, 92.0, coldAirFactor);
        float rayleighBlueAmount = smoothstep(blueStartKm, blueFullKm, distKm) * mix(0.58, 0.78, coldAirFactor);

        // Preserve 3D mountain ridge relief details even inside distant blue mountains!
        vec3 coldMountainBlue = vec3(0.22, 0.52, 0.90) * (0.78 + 0.34 * ridgeDetailContrast);
        vec3 warmHorizonBlue  = vec3(0.42, 0.70, 0.96) * (0.82 + 0.30 * ridgeDetailContrast);
        vec3 atmosphericBlueTarget = mix(warmHorizonBlue, coldMountainBlue, coldAirFactor);

        diffuseColor.rgb = mix(diffuseColor.rgb, atmosphericBlueTarget, clamp(rayleighBlueAmount, 0.0, 0.82));`
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
          key={satelliteTexture ? `${satelliteTexture.uuid}_hd_globe` : 'none'}
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
