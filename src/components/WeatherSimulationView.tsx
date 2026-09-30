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
import { AtmosphericSkyDome } from './AtmosphericSkyDome';
import { GridChunkData, ShaderParameters } from '../types';
import { CloudClassification, CLOUD_PROFILES } from '../services/cloudClassificationService';
import { SunPositionResult } from '../utils/sunPosition';
import {
  getRealKurdistanElevation,
  getEarthCurvatureDropMeters,
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
 * Samples the solid curved Earth Globe terrain elevation across a safety footprint around (x, z)
 * so the camera can never clip into mountain slopes or go underground.
 */
function getSolidGroundElevationAt(
  x: number,
  z: number,
  exaggeration: number,
  refX = 0,
  refZ = 0,
  sampleRadius = 45
): number {
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
  const curveDrop = getEarthCurvatureDropMeters(x, z, refX, refZ);
  return Math.max(c, n, s, e, w, ne, nw, se, sw) * exaggeration + curveDrop;
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

  const activeChunksToRender = useMemo(() => {
    return chunks.filter(c => activeChunkIds.has(c.id));
  }, [chunks, activeChunkIds]);

  const terrainExaggeration = shaderParams.terrainExaggeration ?? 1.35;

  // Reference apex of the spherical Earth Globe:
  // - In 360° Ground Spot Mode: centered on the observer's exact location so the Earth curves down
  //   symmetrically in all 360° directions (-454m at 50km, -1,818m at 100km).
  // - In Aerial Globe Mode: centered at (0, 0) so the entire 480km x 320km region forms a 3D globe cap.
  const globeRefXZ = useMemo<[number, number]>(() => {
    if (isGround360Mode && ground360Spot) {
      return [ground360Spot.x, ground360Spot.z];
    }
    return [0, 0];
  }, [isGround360Mode, ground360Spot]);

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

    const [refX, refZ] = globeRefXZ;

    if (cameraActionTick && cameraActionTick.seq !== lastActionSeqRef.current) {
      lastActionSeqRef.current = cameraActionTick.seq;
      const offset = camera.position.clone().sub(ctrl.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (cameraActionTick.type === 'left') {
        spherical.theta += Math.PI / 6;
      } else if (cameraActionTick.type === 'right') {
        spherical.theta -= Math.PI / 6;
      } else if (cameraActionTick.type === 'look_up') {
        spherical.phi = Math.PI * 0.68;
      } else if (cameraActionTick.type === 'horizon') {
        spherical.phi = Math.PI * 0.50;
      }
      offset.setFromSpherical(spherical);
      camera.position.copy(ctrl.target).add(offset);
      ctrl.update();
    }

    if (targetCameraPose) {
      const targetVec = new THREE.Vector3(...targetCameraPose.pos);
      const lookAtVec = new THREE.Vector3(...targetCameraPose.target);

      camera.position.lerp(targetVec, 0.11);
      ctrl.target.lerp(lookAtVec, 0.13);

      const flightFloorY = getSolidGroundElevationAt(camera.position.x, camera.position.z, terrainExaggeration, refX, refZ, 45) + 60;
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
      const spotX = THREE.MathUtils.clamp(ground360Spot.x, -HALF_DOMAIN_WIDTH + 400, HALF_DOMAIN_WIDTH - 400);
      const spotZ = THREE.MathUtils.clamp(ground360Spot.z, -HALF_DOMAIN_HEIGHT + 400, HALF_DOMAIN_HEIGHT - 400);
      const solidGroundY = getSolidGroundElevationAt(spotX, spotZ, terrainExaggeration, refX, refZ, 35);
      const eyeY = solidGroundY + 65;

      const offset = camera.position.clone().sub(ctrl.target);
      if (offset.lengthSq() < 0.001) {
        offset.set(0, 0.3, 2.0);
      } else {
        offset.setLength(2.0);
      }

      ctrl.target.set(spotX, eyeY, spotZ);
      camera.position.copy(ctrl.target).add(offset);

      const localFloorY = getSolidGroundElevationAt(camera.position.x, camera.position.z, terrainExaggeration, refX, refZ, 25) + 55;
      if (camera.position.y < localFloorY) {
        camera.position.y = localFloorY;
      }
      ctrl.update();
    } else {
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, -HALF_DOMAIN_WIDTH + 400, HALF_DOMAIN_WIDTH - 400);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, -HALF_DOMAIN_HEIGHT + 400, HALF_DOMAIN_HEIGHT - 400);
      ctrl.target.x = THREE.MathUtils.clamp(ctrl.target.x, -HALF_DOMAIN_WIDTH + 400, HALF_DOMAIN_WIDTH - 400);
      ctrl.target.z = THREE.MathUtils.clamp(ctrl.target.z, -HALF_DOMAIN_HEIGHT + 400, HALF_DOMAIN_HEIGHT - 400);

      const solidTargetFloorY = getSolidGroundElevationAt(ctrl.target.x, ctrl.target.z, terrainExaggeration, refX, refZ, 40) + 25;
      if (ctrl.target.y < solidTargetFloorY) {
        ctrl.target.y = solidTargetFloorY;
      }

      const solidCamFloorY = getSolidGroundElevationAt(camera.position.x, camera.position.z, terrainExaggeration, refX, refZ, 65) + 80;
      if (camera.position.y < solidCamFloorY) {
        camera.position.y = solidCamFloorY;
        ctrl.update();
      }
    }

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

  const handleTerrainDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (onSpotGroundClick && e.point) {
      onSpotGroundClick(e.point.x, e.point.z);
    }
  };

  return (
    <>
      {/* 0a. 3D Rayleigh & Mie Atmospheric Blue Sky Dome */}
      <AtmosphericSkyDome sunPosition={sunPosition} />

      {/* Dynamic Astronomical Atmospheric Lighting */}
      <ambientLight
        intensity={sunPosition ? sunPosition.ambientIntensity : 0.8}
        color={sunPosition ? sunPosition.ambientColor : '#dbeafe'}
      />
      <directionalLight
        position={sunPosition ? sunPosition.lightPosition : [120000, 160000, 90000]}
        intensity={sunPosition ? sunPosition.lightIntensity : 1.75}
        color={sunPosition ? sunPosition.lightColor : '#fff8ee'}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1000}
        shadow-camera-far={620000}
        shadow-camera-left={-250000}
        shadow-camera-right={250000}
        shadow-camera-top={180000}
        shadow-camera-bottom={-180000}
        shadow-bias={-0.0002}
        shadow-normalBias={0.04}
      />
      {/* Sky bounce fill light */}
      <directionalLight
        position={[-120000, 80000, -120000]}
        intensity={sunPosition ? sunPosition.ambientIntensity * 0.5 : 0.6}
        color={sunPosition ? sunPosition.ambientColor : '#7dd3fc'}
      />

      {/* 0b. Secondary Offscreen GPU Depth-Buffer & Multi-Octave FBM Cloud Shadow Projector */}
      {showClouds && (
        <CloudShadowDepthProjector
          weatherTexture={weatherTexture}
          sunPosition={sunPosition}
          classification={classification}
          shaderParams={shaderParams}
          onShadowBufferReady={setCloudShadowDepthTexture}
        />
      )}

      {/* 1. SPATIAL CHUNKING: Solid 480km x 320km Curved Earth Globe Terrain (East Turkey, East Syria, North Iraq, West Iran) */}
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
            weatherTexture={weatherTexture}
            cloudShadowDepthTexture={showClouds ? cloudShadowDepthTexture : null}
            cloudBaseY={classification.baseAltitudeM}
            cloudTopY={classification.topAltitudeM}
            sunPosition={sunPosition}
            globeRefXZ={globeRefXZ}
          />
        ))}

        {/* Solid Subterranean Planetary Crust Base beneath the curved globe domain */}
        <mesh position={[0, -14500, 0]} receiveShadow={false}>
          <boxGeometry args={[480000, 14000, 320000]} />
          <meshStandardMaterial color="#162133" roughness={0.95} metalness={0.02} />
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

      {/* 2. Lower/Mid-Level Volumetric Raymarching 3D Clouds (Curved over Earth Globe + Distant Blue Scatter) */}
      {showClouds && (
        <VolumetricClouds
          weatherTexture={weatherTexture}
          params={shaderParams}
          classification={classification}
          sunPosition={sunPosition}
          globeRefXZ={globeRefXZ}
        />
      )}

      {/* 2b. Localized Satellite-Conforming Cumulus Billboards (Anchored at cloudBaseY + Earth Globe Curvature) */}
      {showClouds && (
        <HighAltitudeCirrusParticles
          weatherTexture={weatherTexture}
          sunPosition={sunPosition}
          windSpeed={shaderParams.windSpeed}
          cloudBaseY={classification.baseAltitudeM}
          visible={showClouds}
          globeRefXZ={globeRefXZ}
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
          globeRefXZ={globeRefXZ}
        />
      )}

      {/* 5. 3D Landmark Pins across all 36 locations in East Turkey, East Syria, West Iran & North Iraq */}
      <LandmarkPins
        visible={showPins}
        terrainExaggeration={terrainExaggeration}
        selectedLandmarkId={selectedChunkId || undefined}
        isGround360Mode={isGround360Mode}
        globeRefXZ={globeRefXZ}
        onSelectLandmark={onSelectLandmark}
      />

      {/* Camera Controls: Supports both 360° Ground Spot Mode & Solid Aerial Globe Orbit */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        autoRotate={autoRotate}
        autoRotateSpeed={isGround360Mode ? 1.1 : 0.35}
        enablePan={!isGround360Mode}
        enableZoom={!isGround360Mode}
        rotateSpeed={isGround360Mode ? -0.45 : 0.75}
        minPolarAngle={isGround360Mode ? Math.PI * 0.16 : 0.05}
        maxPolarAngle={isGround360Mode ? Math.PI * 0.82 : Math.PI / 2.06}
        minDistance={isGround360Mode ? 2.0 : 400}
        maxDistance={isGround360Mode ? 2.0 : 460000}
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
    <div className="w-full h-full relative bg-[#1c64b8] overflow-hidden">
      <WebGLErrorBoundary>
        <Canvas
          shadows={false}
          camera={{
            position: [0, 125000, 175000],
            fov: 55,
            near: 8,
            far: 850000
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
          <color attach="background" args={[props.sunPosition?.skyColor ?? '#1c64b8']} />
          <fog attach="fog" args={[props.sunPosition?.fogColor ?? '#72b6fa', 120000, 520000]} />
          <SceneContent {...props} />
        </Canvas>
      </WebGLErrorBoundary>
    </div>
  );
};
