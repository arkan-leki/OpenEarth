import React, { useMemo, useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  KURDISTAN_LANDMARKS,
  getRealKurdistanElevation,
  loadRealDemData
} from '../utils/realSulaymaniyahTerrain';
import { SunPositionResult } from '../utils/sunPosition';

interface KurdistanWorldFeaturesProps {
  terrainExaggeration?: number;
  sunPosition?: SunPositionResult;
  visible?: boolean;
}

const WaterWaveShader = {
  vertexShader: `
    precision highp float;
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vec3 pos = position;
      // Gentle surface wave undulation
      float wave = sin(pos.x * 0.015 + uTime * 2.2) * cos(pos.z * 0.015 + uTime * 1.8) * 2.0;
      pos.y += wave;
      vec4 wp = modelMatrix * vec4(pos, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;

    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vec2 centered = (vUv - 0.5) * 2.0;
      float r2 = dot(centered, centered);
      if (r2 > 1.0) discard;

      // Soft shoreline feathering
      float shoreFade = smoothstep(1.0, 0.38, r2);

      // Animated capillary water ripples
      float w1 = sin(vWorldPos.x * 0.048 + uTime * 2.8 + sin(vWorldPos.z * 0.032)) * 0.5 + 0.5;
      float w2 = cos(vWorldPos.z * 0.054 - uTime * 2.3 + cos(vWorldPos.x * 0.036)) * 0.5 + 0.5;
      float ripple = (w1 + w2) * 0.5;

      vec3 waterNormal = normalize(vec3(
        (w1 - 0.5) * 0.24,
        1.0,
        (w2 - 0.5) * 0.24
      ));

      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fresnel = pow(1.0 - max(0.0, dot(viewDir, waterNormal)), 3.0);

      // Sun specular glint on reservoir & river water
      vec3 halfVec = normalize(uSunDir + viewDir);
      float spec = pow(max(0.0, dot(waterNormal, halfVec)), 52.0) * max(0.15, uSunDir.y);

      vec3 shallowTurquoise = vec3(0.04, 0.62, 0.72);
      vec3 deepReservoirBlue = vec3(0.02, 0.29, 0.52);
      vec3 baseWater = mix(shallowTurquoise, deepReservoirBlue, smoothstep(0.85, 0.15, r2));

      float daylight = clamp(uSunDir.y * 1.6 + 0.28, 0.20, 1.0);
      vec3 reflectedSky = mix(baseWater * daylight, uSkyColor * 0.85, fresnel * 0.58);
      vec3 finalColor = reflectedSky + uSunColor * spec * 1.45 + vec3(0.04, 0.11, 0.15) * ripple * daylight;

      gl_FragColor = vec4(finalColor, shoreFade * 0.88);
    }
  `
};

/**
 * Renders 3D Water Bodies (Lakes, Reservoirs & River Basins), 3D Instanced Trees/Forests,
 * and 3D Instanced Cities & Ancient Citadels anchored directly on the solid Kurdistan terrain.
 */
export const KurdistanWorldFeatures: React.FC<KurdistanWorldFeaturesProps> = ({
  terrainExaggeration = 1.35,
  sunPosition,
  visible = true
}) => {
  const [demReady, setDemReady] = useState(false);
  const treeCanopyRef = useRef<THREE.InstancedMesh>(null);
  const treeTrunkRef = useRef<THREE.InstancedMesh>(null);
  const cityBuildingRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    let mounted = true;
    loadRealDemData().then(() => {
      if (mounted) setDemReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Shared animated water shader material across all lakes & rivers
  const waterShaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
        uSunColor: { value: new THREE.Color('#fff7e6') },
        uSkyColor: { value: new THREE.Color('#38bdf8') }
      },
      vertexShader: WaterWaveShader.vertexShader,
      fragmentShader: WaterWaveShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }, []);

  // 1. Generate 3D Trees (Zagros Oak, Pine & Riverine Woodlands) across forests & all 20 landmarks
  const treeCount = 7200;
  const { canopyGeo, trunkGeo, treeData } = useMemo(() => {
    const cGeo = new THREE.ConeGeometry(1, 2.4, 7);
    cGeo.translate(0, 1.8, 0);
    const tGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.1, 6);
    tGeo.translate(0, 0.55, 0);

    let seed = 77123;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const forestHubs = KURDISTAN_LANDMARKS.map((lm) => ({
      x: lm.position[0],
      z: lm.position[2],
      type: lm.type,
      id: lm.id
    }));

    const instances: Array<{
      x: number;
      y: number;
      z: number;
      scaleXZ: number;
      scaleY: number;
      rotY: number;
      color: THREE.Color;
    }> = [];

    const palette = [
      new THREE.Color('#1e4d2b'), // Deep Zagros Oak Green
      new THREE.Color('#2d6a4f'), // Mountain Pine Green
      new THREE.Color('#3a7d44'), // Lush Valley Cypress
      new THREE.Color('#40916c'), // Sunlit Olive/Pistachio Green
      new THREE.Color('#1b4332')  // Dark Alpine Conifer
    ];

    for (let i = 0; i < treeCount; i++) {
      const hub = forestHubs[i % forestHubs.length];
      // Concentrate 60% of trees within 85m..2,400m of landmarks (for immersive 360° Ground View!)
      // and 40% across the broader mountain valleys and river corridors (2,400m..13,500m)
      const isNearSpot = i < treeCount * 0.60;
      const minRadius = hub.type === 'city' ? 105 : 60;
      const maxRadius = isNearSpot ? 2200 : 12800;

      const angle = rand() * Math.PI * 2;
      const r = minRadius + Math.pow(rand(), 0.72) * (maxRadius - minRadius);
      const wx = hub.x + Math.cos(angle) * r;
      const wz = hub.z + Math.sin(angle) * r;

      const rawElev = getRealKurdistanElevation(wx, wz);
      // Avoid placing trees above the 2,950m alpine snowline
      if (rawElev > 2950) continue;

      const wy = rawElev * terrainExaggeration;
      const baseSize = isNearSpot ? 13 + rand() * 17 : 22 + rand() * 32;
      const heightBoost = 0.85 + rand() * 0.55;

      instances.push({
        x: wx,
        y: wy - 1.5,
        z: wz,
        scaleXZ: baseSize,
        scaleY: baseSize * heightBoost,
        rotY: rand() * Math.PI * 2,
        color: palette[Math.floor(rand() * palette.length)]
      });
    }

    return { canopyGeo: cGeo, trunkGeo: tGeo, treeData: instances };
  }, [terrainExaggeration, demReady]);

  // 2. Generate 3D Cities, Terraced Mountain Towns & Ancient Citadels across all urban & heritage hubs
  const maxBuildings = 5200;
  const { buildingGeo, buildingData } = useMemo(() => {
    const bGeo = new THREE.BoxGeometry(1, 1, 1);
    bGeo.translate(0, 0.5, 0); // Origin at ground base

    let seed = 33917;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const cityHubs = KURDISTAN_LANDMARKS.filter(
      (lm) =>
        lm.type === 'city' ||
        lm.id === 'amadiya' ||
        lm.id === 'rawanduz' ||
        lm.id === 'penjwen' ||
        lm.id === 'dukan' ||
        lm.id === 'darbandikhan'
    );

    const instances: Array<{
      x: number;
      y: number;
      z: number;
      w: number;
      h: number;
      d: number;
      rotY: number;
      color: THREE.Color;
    }> = [];

    const urbanPalette = [
      new THREE.Color('#e2d5c1'), // Warm Mesopotamian Sandstone / Limestone
      new THREE.Color('#d6ccc2'), // Travertine Cream
      new THREE.Color('#cbd5e1'), // Modern Glass/Concrete Tower Silver
      new THREE.Color('#f1f5f9'), // Crisp White Urban Facade
      new THREE.Color('#c2b280'), // Ancient Citadel Ochre Brick
      new THREE.Color('#94a3b8')  // Slate Commercial Block
    ];

    for (let i = 0; i < maxBuildings; i++) {
      const hub = cityHubs[i % cityHubs.length];
      const isMajorMetropolis =
        hub.id === 'erbil' || hub.id === 'sulaymaniyah' || hub.id === 'duhok' || hub.id === 'kirkuk';

      const maxCityRadius = isMajorMetropolis ? 4400 : 2100;
      // Leave a 90m open central plaza at the exact 360° camera spot so the camera stands in an open square surrounded 360° by the city skyline!
      const minPlazaRadius = 90;

      const angle = rand() * Math.PI * 2;
      const dist = minPlazaRadius + Math.pow(rand(), 0.68) * (maxCityRadius - minPlazaRadius);

      const wx = hub.x + Math.cos(angle) * dist;
      const wz = hub.z + Math.sin(angle) * dist;
      const wy = getRealKurdistanElevation(wx, wz) * terrainExaggeration;

      const isDowntownCore = dist < maxCityRadius * 0.32;
      const width = 20 + rand() * 34;
      const depth = 20 + rand() * 34;
      const height = isDowntownCore
        ? (isMajorMetropolis ? 45 + rand() * 115 : 26 + rand() * 54)
        : (16 + rand() * 34);

      instances.push({
        x: wx,
        y: wy - 3,
        z: wz,
        w: width,
        h: height,
        d: depth,
        rotY: (Math.floor(rand() * 4) * Math.PI) / 4 + (rand() - 0.5) * 0.15,
        color: urbanPalette[Math.floor(rand() * urbanPalette.length)]
      });
    }

    return { buildingGeo: bGeo, buildingData: instances };
  }, [terrainExaggeration, demReady]);

  // 3. Populate InstancedMesh matrices & per-instance colors
  useEffect(() => {
    const dummy = new THREE.Object3D();

    if (treeCanopyRef.current && treeTrunkRef.current) {
      treeData.forEach((t, idx) => {
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(0, t.rotY, 0);
        dummy.scale.set(t.scaleXZ, t.scaleY, t.scaleXZ);
        dummy.updateMatrix();
        treeCanopyRef.current!.setMatrixAt(idx, dummy.matrix);
        treeCanopyRef.current!.setColorAt(idx, t.color);

        dummy.scale.set(t.scaleXZ * 0.7, t.scaleY * 0.7, t.scaleXZ * 0.7);
        dummy.updateMatrix();
        treeTrunkRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      treeCanopyRef.current.count = treeData.length;
      treeTrunkRef.current.count = treeData.length;
      treeCanopyRef.current.instanceMatrix.needsUpdate = true;
      if (treeCanopyRef.current.instanceColor) treeCanopyRef.current.instanceColor.needsUpdate = true;
      treeTrunkRef.current.instanceMatrix.needsUpdate = true;
    }

    if (cityBuildingRef.current) {
      buildingData.forEach((b, idx) => {
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(0, b.rotY, 0);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.updateMatrix();
        cityBuildingRef.current!.setMatrixAt(idx, dummy.matrix);
        cityBuildingRef.current!.setColorAt(idx, b.color);
      });
      cityBuildingRef.current.count = buildingData.length;
      cityBuildingRef.current.instanceMatrix.needsUpdate = true;
      if (cityBuildingRef.current.instanceColor) cityBuildingRef.current.instanceColor.needsUpdate = true;
    }
  }, [treeData, buildingData]);

  // 4. Water Bodies (Lake Dukan, Lake Darbandikhan, Duhok Dam, Great Zab, Khabur River, Little Zab, Sirwan River)
  const waterBodies = useMemo(() => {
    const waterLandmarks = KURDISTAN_LANDMARKS.filter(
      (lm) =>
        lm.type === 'water' ||
        lm.id === 'zakho' ||
        lm.id === 'ranya' ||
        lm.id === 'kalar' ||
        lm.id === 'rawanduz' ||
        lm.id === 'halabja'
    );
    return waterLandmarks.map((lm) => {
      const wx = lm.position[0];
      const wz = lm.position[2];
      // Sample local elevation at or near the landmark so the water surface sits visibly on the basin floor
      const centerElev = getRealKurdistanElevation(wx, wz);
      let minElev = centerElev;
      for (let dx = -450; dx <= 450; dx += 225) {
        for (let dz = -450; dz <= 450; dz += 225) {
          const e = getRealKurdistanElevation(wx + dx, wz + dz);
          if (e < minElev) minElev = e;
        }
      }
      const isLargeLake = lm.id === 'dukan' || lm.id === 'darbandikhan';
      const isWaterLandmark = lm.type === 'water';
      // Offset water body slightly from the 360° viewpoint so the camera stands on the scenic shoreline looking out over the water
      const offsetX = isWaterLandmark ? 950 : 680;
      const offsetZ = isWaterLandmark ? 750 : 520;
      const surfaceElev = Math.max(minElev + 8, centerElev - 6);

      return {
        id: lm.id,
        x: wx + offsetX,
        y: surfaceElev * terrainExaggeration + 6,
        z: wz + offsetZ,
        radiusX: isLargeLake ? 6400 : isWaterLandmark ? 3400 : 1850,
        radiusZ: isLargeLake ? 4800 : isWaterLandmark ? 2600 : 1400
      };
    });
  }, [terrainExaggeration, demReady]);

  const waterPlaneGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, 28, 28);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  useFrame((state) => {
    waterShaderMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    if (sunPosition) {
      waterShaderMaterial.uniforms.uSunDir.value.copy(sunPosition.sunDirection);
      waterShaderMaterial.uniforms.uSunColor.value.set(sunPosition.lightColor);
      waterShaderMaterial.uniforms.uSkyColor.value.set(sunPosition.ambientColor);
    }
  });

  if (!visible) return null;

  const isNight = sunPosition ? sunPosition.elevationDeg < 4 : false;

  return (
    <group>
      {/* 1. 3D Shimmering Lakes, Reservoirs & River Basins */}
      {waterBodies.map((wb) => (
        <mesh
          key={`water-${wb.id}`}
          geometry={waterPlaneGeo}
          material={waterShaderMaterial}
          position={[wb.x, wb.y, wb.z]}
          scale={[wb.radiusX * 2, 1, wb.radiusZ * 2]}
          frustumCulled={false}
        />
      ))}

      {/* 2. 3D Instanced Zagros Oak, Pine & Riverine Forests */}
      <instancedMesh
        ref={treeCanopyRef}
        args={[canopyGeo, undefined, treeCount]}
        frustumCulled={false}
        castShadow={false}
        receiveShadow={false}
      >
        <meshStandardMaterial roughness={0.82} metalness={0.05} />
      </instancedMesh>
      <instancedMesh
        ref={treeTrunkRef}
        args={[trunkGeo, undefined, treeCount]}
        frustumCulled={false}
      >
        <meshStandardMaterial color="#5c4033" roughness={0.92} />
      </instancedMesh>

      {/* 3. 3D Instanced Cities, Terraced Towns & Ancient Citadels */}
      <instancedMesh
        ref={cityBuildingRef}
        args={[buildingGeo, undefined, maxBuildings]}
        frustumCulled={false}
      >
        <meshStandardMaterial
          roughness={0.65}
          metalness={0.18}
          emissive={isNight ? '#f59e0b' : '#000000'}
          emissiveIntensity={isNight ? 0.38 : 0.0}
        />
      </instancedMesh>
    </group>
  );
};
