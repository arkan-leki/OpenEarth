import React, { useRef, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsType } from 'three-stdlib';
import { TerrainChunk } from './TerrainChunk';
import { VolumetricClouds } from './VolumetricClouds';
import { HighAltitudeCirrusParticles } from './HighAltitudeCirrusParticles';
import { CloudShadowDepthProjector } from './CloudShadowDepthProjector';
import { RainParticles } from './RainParticles';
import { LandmarkPins, Landmark } from './LandmarkPins';
import { AtmosphericFogAndDust } from './AtmosphericFogAndDust';
import { GridChunkData, ShaderParameters } from '../types';
import { CloudClassification, CLOUD_PROFILES } from '../services/cloudClassificationService';
import { SunPositionResult } from '../utils/sunPosition';
import {
  getRealKurdistanElevation,
  HALF_DOMAIN_WIDTH,
  HALF_DOMAIN_HEIGHT
} from '../utils/realSulaymaniyahTerrain';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

class WebGLErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMsg: error?.message || 'WebGL Context Initialization Issue' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('WebGL Engine caught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMsg: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#090C10] text-slate-300 p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 text-2xl mb-4 shadow-lg shadow-cyan-950/40">
            ☁️
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Restoring 3D Weather Canvas</h3>
          <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
            The GPU graphics context was briefly reset by the browser. Click below to reconnect the 3D atmospheric simulation.
          </p>
          <button
            onClick={this.handleRetry}
            className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-sm transition-all shadow-lg shadow-cyan-500/25 active:scale-95"
          >
            Reconnect 3D Engine
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Samples the solid terrain elevation across a safety footprint around (x, z)
 * so the camera can never clip into mountain slopes or go underground.
 */
function getSolidGroundElevationAt(x: number, z: number, exaggeration: number, sampleRadius = 45): number {
  const c = getRealKurdistanElevation(x, z);
  const n = getRealKurdistanElevation(x, z - sampleRadius);
  const s = getRealKurdistanElevation(x, z + sampleRadius);
  const e = getRealKurdistanElevation(x + sampleRadius, z);
  const w = getRealKurdistanElevation(x - sampleRadius, z);
  const d = sampleRadius * 0.707;
  const ne = getRealKurdistanElevation(x + d, z - d);
  const nw = getRealKurdistanElevation(x - d, z - d);
  const se = getRealKurdistanElevation(x + d, z + d);
  const sw = getRealKurdistanElevation(x - d, z + d);
  return Math.max(c, n, s, e, w, ne, nw, se, sw) * exaggeration;
}

interface SceneContentProps {
  chunks: GridChunkData[];
  activeChunkIds: Set<string>;
  selectedChunkId: string | null;
  weatherTexture: THREE.Texture;
  shaderParams: ShaderParameters;
  classification?: CloudClassification;
  wireframe: boolean;
  showPins: boolean;
  showClouds?: boolean;
  showRain?: boolean;
  activeMaxPrecipitation?: number;
  hasActivePrecipitation?: boolean;
  autoRotate: boolean;
  satelliteLayer: 'nasa' | 'hd';
  nasaCloudTexture?: THREE.Texture | null;
  phenomenaTexture?: THREE.Texture | null;
  groundTexture?: THREE.Texture | null;
  sunPosition?: SunPositionResult;
  onSelectLandmark: (lm: Landmark) => void;
  targetCameraPose: { pos: [number, number, number]; target: [number, number, number] } | null;
  onClearTargetPose: () => void;
  onUpdateFps: (fps: number) => void;
  isGround360Mode?: boolean;
  ground360Spot?: { x: number; z: number } | null;
  onSpotGroundClick?: (x: number, z: number) => void;
  cameraActionTick?: { type: 'left' | 'right' | 'look_up' | 'horizon'; seq: number } | null;
  onUpdateCompassHeading?: (deg: number) => void;
}

const SceneContent: React.FC<SceneContentProps> = ({
  chunks,
  activeChunkIds,
  selectedChunkId,
  weatherTexture,
  shaderParams,
  classification = CLOUD_PROFILES.cumulus_humilis,
  wireframe,
  showPins,
  showClouds = true,
  showRain = true,
  activeMaxPrecipitation = 0.0,
  hasActivePrecipitation = false,
  autoRotate,
  groundTexture,
  phenomenaTexture,
  sunPosition,
  onSelectLandmark,
  targetCameraPose,
  onClearTargetPose,
  onUpdateFps,
  isGround360Mode = false,
  ground360Spot = null,
  onSpotGroundClick,
  cameraActionTick = null,
  onUpdateCompassHeading
}) => {
  const controlsRef = useRef<OrbitControlsType>(null);
  const { camera } = useThree();
  const [cloudShadowDepthTexture, setCloudShadowDepthTexture] = React.useState<THREE.Texture | null>(null);
  const lastActionSeqRef = useRef<number>(0);
  const lastHeadingRef = useRef<number>(-1);

  // Filter chunks that are currently active in the spatial cache
  const activeChunksToRender = useMemo(() => {
    return chunks.filter(c => activeChunkIds.has(c.id));
  }, [chunks, activeChunkIds]);

  const terrainExaggeration = shaderParams.terrainExaggeration ?? 1.35;

  // Telemetry FPS tracker
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());

  useFrame(() => {
    frameCount.current++;
    const now = performance.now();
    if (now - lastTime.current >= 1000) {
      onUpdateFps(Math.round((frameCount.current * 1000) / (now - lastTime.current)));
      frameCount.current = 0;
      lastTime.current = now;
    }

    const ctrl = controlsRef.current;
    if (!ctrl) return;

    // Handle discrete 360° HUD rotation/pitch button actions
    if (cameraActionTick && cameraActionTick.seq !== lastActionSeqRef.current) {
      lastActionSeqRef.current = cameraActionTick.seq;
      const offset = camera.position.clone().sub(ctrl.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (cameraActionTick.type === 'left') {
        spherical.theta += Math.PI / 6; // Rotate 30° left on the same spot
      } else if (cameraActionTick.type === 'right') {
        spherical.theta -= Math.PI / 6; // Rotate 30° right on the same spot
      } else if (cameraActionTick.type === 'look_up') {
        // Tilt camera upward to look at the 3D clouds and falling rain from the ground
        spherical.phi = Math.PI * 0.68;
      } else if (cameraActionTick.type === 'horizon') {
        // Level camera horizontally at the 360° ground horizon
        spherical.phi = Math.PI * 0.50;
      }
      offset.setFromSpherical(spherical);
      camera.position.copy(ctrl.target).add(offset);
      ctrl.update();
    }

    // 1. Smooth camera transition if a target pose was requested
    if (targetCameraPose) {
      const targetVec = new THREE.Vector3(...targetCameraPose.pos);
      const lookAtVec = new THREE.Vector3(...targetCameraPose.target);

      camera.position.lerp(targetVec, 0.10);
      ctrl.target.lerp(lookAtVec, 0.12);

      // Keep camera strictly above solid ground during flight over mountain ridges
      const flightFloorY = getSolidGroundElevationAt(camera.position.x, camera.position.z, terrainExaggeration, 45) + 60;
      if (camera.position.y < flightFloorY) {
        camera.position.y = flightFloorY;
      }

      ctrl.update();

      if (camera.position.distanceTo(targetVec) < 35 && ctrl.target.distanceTo(lookAtVec) < 35) {
        camera.position.copy(targetVec);
        ctrl.target.copy(lookAtVec);
        ctrl.update();
        onClearTargetPose();
      }
    } else if (isGround360Mode && ground360Spot) {
      // 2. GROUND-LEVEL 360° SPOT MODE:
      // Keep the camera anchored at ground level on the exact same spot (ground360Spot.x, ground360Spot.z)
      // so dragging rotates 360° around the spot without drifting away or going underground.
      const spotX = THREE.MathUtils.clamp(ground360Spot.x, -HALF_DOMAIN_WIDTH + 400, HALF_DOMAIN_WIDTH - 400);
      const spotZ = THREE.MathUtils.clamp(ground360Spot.z, -HALF_DOMAIN_HEIGHT + 400, HALF_DOMAIN_HEIGHT - 400);
      const solidGroundY = getSolidGroundElevationAt(spotX, spotZ, terrainExaggeration, 35);
      const eyeY = solidGroundY + 65;

      // Preserve current 360° look direction (spherical angles) while locking target to the exact ground spot
      const offset = camera.position.clone().sub(ctrl.target);
      if (offset.lengthSq() < 0.001) {
        offset.set(0, 0.3, 2.0);
      } else {
        offset.setLength(2.0);
      }

      ctrl.target.set(spotX, eyeY, spotZ);
      camera.position.copy(ctrl.target).add(offset);

      // Hard solid-ground enforcement at the camera's exact position
      const localFloorY = getSolidGroundElevationAt(camera.position.x, camera.position.z, terrainExaggeration, 25) + 55;
      if (camera.position.y < localFloorY) {
        camera.position.y = localFloorY;
      }
      ctrl.update();
    } else {
      // 3. AERIAL ORBIT MODE:
      // Enforce 100% solid ground collision so the camera and orbit target can NEVER go beneath the terrain
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, -HALF_DOMAIN_WIDTH + 400, HALF_DOMAIN_WIDTH - 400);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, -HALF_DOMAIN_HEIGHT + 400, HALF_DOMAIN_HEIGHT - 400);
      ctrl.target.x = THREE.MathUtils.clamp(ctrl.target.x, -HALF_DOMAIN_WIDTH + 400, HALF_DOMAIN_WIDTH - 400);
      ctrl.target.z = THREE.MathUtils.clamp(ctrl.target.z, -HALF_DOMAIN_HEIGHT + 400, HALF_DOMAIN_HEIGHT - 400);

      const solidTargetFloorY = getSolidGroundElevationAt(ctrl.target.x, ctrl.target.z, terrainExaggeration, 40) + 25;
      if (ctrl.target.y < solidTargetFloorY) {
        ctrl.target.y = solidTargetFloorY;
      }

      const solidCamFloorY = getSolidGroundElevationAt(camera.position.x, camera.position.z, terrainExaggeration, 65) + 80;
      if (camera.position.y < solidCamFloorY) {
        camera.position.y = solidCamFloorY;
        ctrl.update();
      }
    }

    // Report live 360° compass heading (0° = North/-Z, 90° = East/+X, 180° = South/+Z, 270° = West/-X)
    if (onUpdateCompassHeading) {
      const lookDir = new THREE.Vector3();
      camera.getWorldDirection(lookDir);
      const deg = (Math.round((Math.atan2(lookDir.x, -lookDir.z) * 180) / Math.PI) + 360) % 360;
      if (Math.abs(deg - lastHeadingRef.current) >= 1) {
        lastHeadingRef.current = deg;
        onUpdateCompassHeading(deg);
      }
    }
  });

  // Double-clicking any point on the solid ground places the 360° Ground Camera right on that spot
  const handleTerrainDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (onSpotGroundClick && e.point) {
      onSpotGroundClick(e.point.x, e.point.z);
    }
  };

  return (
    <>
      {/* Dynamic Astronomical Atmospheric Lighting */}
      <ambientLight
        intensity={sunPosition ? sunPosition.ambientIntensity : 0.7}
        color={sunPosition ? sunPosition.ambientColor : '#dbeafe'}
      />
      <directionalLight
        position={sunPosition ? sunPosition.lightPosition : [90000, 120000, 70000]}
        intensity={sunPosition ? sunPosition.lightIntensity : 1.5}
        color={sunPosition ? sunPosition.lightColor : '#fff5e6'}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1000}
        shadow-camera-far={420000}
        shadow-camera-left={-140000}
        shadow-camera-right={140000}
        shadow-camera-top={100000}
        shadow-camera-bottom={-100000}
        shadow-bias={-0.0002}
        shadow-normalBias={0.04}
      />
      {/* Sky bounce fill light */}
      <directionalLight
        position={[-80000, 50000, -80000]}
        intensity={sunPosition ? sunPosition.ambientIntensity * 0.45 : 0.55}
        color={sunPosition ? sunPosition.ambientColor : '#7dd3fc'}
      />

      {/* 0. Secondary Offscreen GPU Depth-Buffer & Multi-Octave FBM Cloud Shadow Projector */}
      {showClouds && (
        <CloudShadowDepthProjector
          weatherTexture={weatherTexture}
          sunPosition={sunPosition}
          classification={classification}
          shaderParams={shaderParams}
          onShadowBufferReady={setCloudShadowDepthTexture}
        />
      )}

      {/* 1. SPATIAL CHUNKING: Solid 3D High-Definition Kurdistan Terrain + Geological Bedrock Base */}
      <group onDoubleClick={handleTerrainDoubleClick}>
        {activeChunksToRender.map((chunk) => (
          <TerrainChunk
            key={chunk.id}
            id={chunk.id}
            gridX={chunk.gridX}
            gridY={chunk.gridY}
            wireframe={wireframe}
            isSelected={selectedChunkId === chunk.id}
            terrainExaggeration={terrainExaggeration}
            customTexture={groundTexture}
            phenomenaTexture={phenomenaTexture}
            cloudShadowDepthTexture={showClouds ? cloudShadowDepthTexture : null}
            cloudBaseY={classification.baseAltitudeM}
            cloudTopY={classification.topAltitudeM}
            sunPosition={sunPosition}
          />
        ))}

        {/* Solid Subterranean Bedrock Slab underneath the entire 240km x 160km terrain domain */}
        <mesh position={[0, -3900, 0]} receiveShadow={false}>
          <boxGeometry args={[240000, 8000, 160000]} />
          <meshStandardMaterial color="#161412" roughness={0.96} metalness={0.02} />
        </mesh>
      </group>

      {/* 1b. 3D Volumetric Valley Fog & Suspended Mesopotamian Desert Dust Plumes */}
      {showClouds && phenomenaTexture && (
        <AtmosphericFogAndDust
          phenomenaTexture={phenomenaTexture}
          sunPosition={sunPosition}
          windSpeed={shaderParams.windSpeed}
          visible={showClouds}
        />
      )}

      {/* 2. Lower/Mid-Level Volumetric Raymarching 3D Clouds (☁️ Cumulus & Cumulonimbus Columns) */}
      {showClouds && (
        <VolumetricClouds
          weatherTexture={weatherTexture}
          params={shaderParams}
          classification={classification}
          sunPosition={sunPosition}
        />
      )}

      {/* 2b. Localized Satellite-Conforming Cloud Shell & Cumulus Billboards (Anchored at cloudBaseY) */}
      {showClouds && (
        <HighAltitudeCirrusParticles
          weatherTexture={weatherTexture}
          sunPosition={sunPosition}
          windSpeed={shaderParams.windSpeed}
          cloudBaseY={classification.baseAltitudeM}
          visible={showClouds}
        />
      )}

      {/* 3. Cloud-Locked Precipitation (Pours directly from cloudBaseY in areas where Rain Radar shows rain) */}
      {showRain && (
        <RainParticles
          weatherTexture={weatherTexture}
          rainThreshold={shaderParams.rainThreshold}
          snowTempThreshold={shaderParams.snowTempThreshold}
          activeMaxPrecipitation={activeMaxPrecipitation}
          hasActivePrecipitation={hasActivePrecipitation}
          windSpeed={shaderParams.windSpeed}
          cloudBaseY={classification.baseAltitudeM}
        />
      )}

      {/* 5. 3D Landmark Pins across all 28 Kurdistan & Northern Iraq locations */}
      <LandmarkPins
        visible={showPins}
        terrainExaggeration={terrainExaggeration}
        selectedLandmarkId={selectedChunkId || undefined}
        isGround360Mode={isGround360Mode}
        onSelectLandmark={onSelectLandmark}
      />

      {/* Camera Controls: Supports both 360° Ground Spot Mode (rotates 360° on the exact same spot) & Solid Aerial Orbit */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        autoRotate={autoRotate}
        autoRotateSpeed={isGround360Mode ? 1.1 : 0.4}
        enablePan={!isGround360Mode}
        enableZoom={!isGround360Mode}
        rotateSpeed={isGround360Mode ? -0.45 : 0.75}
        minPolarAngle={isGround360Mode ? Math.PI * 0.16 : 0.05}
        maxPolarAngle={isGround360Mode ? Math.PI * 0.82 : Math.PI / 2.06}
        minDistance={isGround360Mode ? 2.0 : 400}
        maxDistance={isGround360Mode ? 2.0 : 250000}
        enableDamping={true}
        dampingFactor={0.07}
      />
    </>
  );
};

export interface WeatherSimulationViewProps {
  chunks: GridChunkData[];
  activeChunkIds: Set<string>;
  selectedChunkId: string | null;
  weatherTexture: THREE.Texture;
  shaderParams: ShaderParameters;
  classification?: CloudClassification;
  wireframe: boolean;
  showPins: boolean;
  showClouds?: boolean;
  showRain?: boolean;
  activeMaxPrecipitation?: number;
  hasActivePrecipitation?: boolean;
  autoRotate: boolean;
  satelliteLayer: 'nasa' | 'hd';
  nasaCloudTexture?: THREE.Texture | null;
  phenomenaTexture?: THREE.Texture | null;
  groundTexture?: THREE.Texture | null;
  sunPosition?: SunPositionResult;
  onSelectLandmark: (lm: Landmark) => void;
  targetCameraPose: { pos: [number, number, number]; target: [number, number, number] } | null;
  onClearTargetPose: () => void;
  onUpdateFps: (fps: number) => void;
  isGround360Mode?: boolean;
  ground360Spot?: { x: number; z: number } | null;
  onSpotGroundClick?: (x: number, z: number) => void;
  cameraActionTick?: { type: 'left' | 'right' | 'look_up' | 'horizon'; seq: number } | null;
  onUpdateCompassHeading?: (deg: number) => void;
}

export const WeatherSimulationView: React.FC<WeatherSimulationViewProps> = (props) => {
  return (
    <div className="w-full h-full relative bg-[#090C10] overflow-hidden">
      <WebGLErrorBoundary>
        <Canvas
          shadows={false}
          camera={{
            position: [0, 68000, 85000],
            fov: 55,
            near: 8,
            far: 500000
          }}
          gl={{
            antialias: true,
            powerPreference: 'default',
            alpha: false,
            failIfMajorPerformanceCaveat: false,
            preserveDrawingBuffer: false
          }}
          dpr={[1, 1.25]}
          onCreated={({ gl }) => {
            const canvasEl = gl.domElement;
            canvasEl.addEventListener('webglcontextlost', (event) => {
              event.preventDefault();
              console.warn('WebGL context lost - preventDefault() invoked to allow automatic restoration');
            }, false);
            canvasEl.addEventListener('webglcontextrestored', () => {
              console.info('WebGL context successfully restored');
            }, false);
          }}
        >
          <color attach="background" args={[props.sunPosition?.skyColor ?? '#0B0E14']} />
          <fog attach="fog" args={[props.sunPosition?.fogColor ?? '#0F172A', 190000, 480000]} />
          <SceneContent {...props} />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
};
