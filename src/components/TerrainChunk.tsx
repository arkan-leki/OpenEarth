import React, { useMemo, useEffect, useState, useRef } from 'react';
import {
  DOMAIN_WIDTH_METERS,
  DOMAIN_HEIGHT_METERS,
  HALF_DOMAIN_WIDTH,
  HALF_DOMAIN_HEIGHT,
} from '../utils/realSulaymaniyahTerrain';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import gsap from 'gsap';
import {
  buildRealChunkGeometry,
  getKurdistanSatelliteTexture,
  loadRealDemData
} from '../utils/realSulaymaniyahTerrain';
import {
  CHUNK_WIDTH_METERS,
  CHUNK_HEIGHT_METERS,
  chunkSubdivisionsFor
} from '../utils/weatherDataPipeline';
import { loadChunkTile } from '../services/chunkTileService';
import { SunPositionResult } from '../utils/sunPosition';

interface TerrainChunkProps {
  id: string;
  gridX: number;
  gridY: number;
  /** Chunk extent in metres. Non-uniform: small+fine near the centre, large+coarse at the rim. */
  widthMeters?: number;
  heightMeters?: number;
  /** Pre-computed mesh subdivisions for this chunk's ring. */
  subdivisions?: number;
  /** Satellite pass for THIS chunk on the active date, fetched at runtime. */
  chunkSatelliteTexture?: THREE.Texture | null;
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
  id,
  gridX,
  gridY,
  widthMeters = CHUNK_WIDTH_METERS,
  heightMeters = CHUNK_HEIGHT_METERS,
  subdivisions,
  chunkSatelliteTexture = null,
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
    /** Domain-wide ground overlay (live radar). Uses the DOMAIN uv, not the chunk-local one. */
    uGroundOverlay: { value: THREE.Texture | null };
    uHasGroundOverlay: { value: number };
    /** 0..1 weight of the live radar overlay over the HD ground. */
    uGroundOverlayStrength: { value: number };
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
    uGroundOverlay: { value: null as THREE.Texture | null },
    uHasGroundOverlay: { value: 0 },
    uGroundOverlayStrength: { value: 0.45 },
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
    // Density comes from the chunk's ring (CHUNK_TARGET_SPACING_M): the central band
    // gets ~1.5 km vertex spacing, the rim ~4 km. Selecting a chunk refines it one step.
    const base = subdivisions ?? chunkSubdivisionsFor(1, widthMeters, heightMeters);
    const res = isSelected ? Math.round(base * 1.25) : base;
    return buildRealChunkGeometry(
      gridX,
      gridY,
      widthMeters,
      heightMeters,
      res,
      terrainExaggeration
    );
  }, [gridX, gridY, widthMeters, heightMeters, subdivisions, demLoaded, terrainExaggeration, isSelected]);

  // Each chunk renders with its OWN high-resolution imagery tile. UVs from
  // buildRealChunkGeometry are local to the chunk, so the tile lines up exactly.
  const [chunkTile, setChunkTile] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let mounted = true;
    loadChunkTile(id).then((tex) => {
      if (mounted && tex) setChunkTile(tex);
    });
    return () => {
      mounted = false;
    };
  }, [id]);

  // GROUND IS ALWAYS THE HD BASE MAP.
  //
  // The daily satellite pass is NOT draped on the terrain: it belongs to the cloud layer.
  // customTexture stays ahead of the HD tile so the live radar overlay still lands on the
  // ground in radar mode.
  // Ground base is ALWAYS the HD tile. customTexture (live radar) comes through its own
  // domain-wide overlay uniform so the local per-chunk UVs cannot tile it.
  const satelliteTexture = chunkTile;

  useFrame(() => {
    shaderUniformsRef.current.uTerrainExaggeration.value = terrainExaggeration;
    shaderUniformsRef.current.uWeatherData.value = weatherTexture;
    shaderUniformsRef.current.uGroundOverlay.value = customTexture ?? null;
    shaderUniformsRef.current.uHasGroundOverlay.value = customTexture ? 1 : 0;
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
      shader.uniforms.uGroundOverlay = shaderUniformsRef.current.uGroundOverlay;
      shader.uniforms.uHasGroundOverlay = shaderUniformsRef.current.uHasGroundOverlay;
      shader.uniforms.uGroundOverlayStrength = shaderUniformsRef.current.uGroundOverlayStrength;
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
        // MUST match EARTH_CURVATURE_DIVISOR in realSulaymaniyahTerrain (12,742,000 = 2R).
        // This was left at the old 5,500,000 while the base slab and cloud shader moved to
        // the real value, so the terrain curved 2.3x more than its own base and sank below
        // it — the base slab then covered the map from the rim inward.
        float globeCurveDrop = -dot(dGlobe, dGlobe) / 12742000.0;
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
        uniform sampler2D uGroundOverlay;
        uniform float uHasGroundOverlay;
        uniform float uGroundOverlayStrength;
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
        // Map world XZ to domain UV (0..1). These bounds MUST match the terrain domain:
        // this UV feeds the weather texture (cloud density), the phenomena layer and the
        // cloud-shadow lookup. Hardcoded 480x320 km bounds meant that on the 1600 km map
        // every sample past the old rim clamped to the edge, so clouds only appeared over
        // the centre and the rest of the map read a single stretched edge texel.
        vec2 domainUv = clamp(vec2(
          (vWorldPos.x + ${HALF_DOMAIN_WIDTH.toFixed(1)}) / ${DOMAIN_WIDTH_METERS.toFixed(1)},
          (vWorldPos.z + ${HALF_DOMAIN_HEIGHT.toFixed(1)}) / ${DOMAIN_HEIGHT_METERS.toFixed(1)}
        ), 0.002, 0.998);

        // LIVE RADAR OVERLAY - sampled at domainUv because it spans the whole map. Fed through
        // the chunk-local uv it repeated once per chunk ("dozens of small maps").
        // Uses the overlay's OWN alpha: forcing a 55% floor washed every pixel, including
        // areas with no radar echo, which muddied the HD ground across the whole map.
        if (uHasGroundOverlay > 0.5) {
          vec4 groundOverlay = texture2D(uGroundOverlay, domainUv);
          // Weighted DOWN so the HD ground stays the dominant layer: at full overlay alpha
          // the radar/IR canvas covered most of the map and buried the HD imagery.
          float overlayAlpha = clamp(groundOverlay.a, 0.0, 1.0) * uGroundOverlayStrength;
          if (overlayAlpha > 0.02) {
            diffuseColor.rgb = mix(diffuseColor.rgb, groundOverlay.rgb, overlayAlpha);
          }
        }

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
          (initialRayXZ.x + ${HALF_DOMAIN_WIDTH.toFixed(1)}) / ${DOMAIN_WIDTH_METERS.toFixed(1)},
          (initialRayXZ.y + ${HALF_DOMAIN_HEIGHT.toFixed(1)}) / ${DOMAIN_HEIGHT_METERS.toFixed(1)}
        ), 0.002, 0.998);

        vec4 depthPass1 = texture2D(uCloudShadowDepth, initialShadowUv);
        float effectiveCasterHeight = mix(uCloudBaseY, uCloudTopY, depthPass1.g);

        float refinedDepthDelta = max(150.0, effectiveCasterHeight - vUnCurvedY);
        vec2 refinedRayXZ = vWorldPos.xz + uSunDir.xz * (refinedDepthDelta / sunElevY);
        vec2 refinedShadowUv = clamp(vec2(
          (refinedRayXZ.x + ${HALF_DOMAIN_WIDTH.toFixed(1)}) / ${DOMAIN_WIDTH_METERS.toFixed(1)},
          (refinedRayXZ.y + ${HALF_DOMAIN_HEIGHT.toFixed(1)}) / ${DOMAIN_HEIGHT_METERS.toFixed(1)}
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
        // Atmospheric Rayleigh haze over distant land.
        //
        // The distances ADAPT to viewing altitude so the gradient always spans the visible
        // map. Previously they were fixed at 18-125 km, tuned for the original 480 km map seen
        // from ~215 km; on a 1600 km map viewed from ~1700 km up every pixel sat past 125 km
        // and the whole map was blended 82% into cobalt blue. Simply disabling the effect from
        // orbit lost the blue atmosphere entirely, so instead the fade distance grows with
        // altitude: a real, gradual blue haze at the horizon in every mode, never a blanket.
        const float MAP_SCALE = 3.3333;           // 1600 km / 480 km
        float camAltKm = cameraPosition.y * 0.001;
        float hazeScale = max(MAP_SCALE, camAltKm / 40.0);
        float blueStartKm = mix(28.0, 18.0, coldAirFactor) * hazeScale;
        float blueFullKm  = mix(125.0, 92.0, coldAirFactor) * hazeScale;
        float rayleighBlueAmount = smoothstep(blueStartKm, blueFullKm, distKm)
                                 * mix(0.58, 0.78, coldAirFactor)
                                 * 0.85;

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
