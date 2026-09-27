import React, { useRef, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsType } from 'three-stdlib';
import { TerrainChunk } from './TerrainChunk';
import { VolumetricClouds } from './VolumetricClouds';
import { HighAltitudeCirrusParticles } from './HighAltitudeCirrusParticles';
import { RainParticles } from './RainParticles';
import { LandmarkPins, Landmark } from './LandmarkPins';
import { AtmosphericFogAndDust } from './AtmosphericFogAndDust';
import { GridChunkData, ShaderParameters } from '../types';
import { CloudClassification, CLOUD_PROFILES } from '../services/cloudClassificationService';
import { SunPositionResult } from '../utils/sunPosition';

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
  satelliteLayer,
  nasaCloudTexture,
  phenomenaTexture,
  groundTexture,
  sunPosition,
  onSelectLandmark,
  targetCameraPose,
  onClearTargetPose,
  onUpdateFps
}) => {
  const controlsRef = useRef<OrbitControlsType>(null);
  const { camera } = useThree();

  // Filter chunks that are currently active in the spatial cache
  const activeChunksToRender = useMemo(() => {
    return chunks.filter(c => activeChunkIds.has(c.id));
  }, [chunks, activeChunkIds]);

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

    // Smooth camera transition if a target pose was requested
    if (targetCameraPose && controlsRef.current) {
      const targetVec = new THREE.Vector3(...targetCameraPose.pos);
      const lookAtVec = new THREE.Vector3(...targetCameraPose.target);

      camera.position.lerp(targetVec, 0.05);
      controlsRef.current.target.lerp(lookAtVec, 0.05);
      controlsRef.current.update();

      if (camera.position.distanceTo(targetVec) < 150) {
        onClearTargetPose();
      }
    }
  });

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

      {/* 1. SPATIAL CHUNKING: High-Definition Kurdistan Basemap (HD Base) with Ground Snow Cover & Cloud Shadows */}
      <group>
        {activeChunksToRender.map((chunk) => (
          <TerrainChunk
            key={chunk.id}
            id={chunk.id}
            gridX={chunk.gridX}
            gridY={chunk.gridY}
            wireframe={wireframe}
            isSelected={selectedChunkId === chunk.id}
            terrainExaggeration={shaderParams.terrainExaggeration ?? 1.25}
            customTexture={groundTexture}
            phenomenaTexture={phenomenaTexture}
            sunPosition={sunPosition}
          />
        ))}
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

      {/* 2b. Hybrid Particle-Shader High-Altitude Cirrus Layer (8,200m - 10,800m Subtropical Jet Stream) */}
      {showClouds && (
        <HighAltitudeCirrusParticles
          weatherTexture={weatherTexture}
          sunPosition={sunPosition}
          windSpeed={shaderParams.windSpeed}
          visible={showClouds}
        />
      )}

      {/* 3. Precipitation Effect (Strictly only renders Rain if raining, or Falling Snow at freezing elevations) */}
      {showRain && (
        <RainParticles
          weatherTexture={weatherTexture}
          rainThreshold={shaderParams.rainThreshold}
          snowTempThreshold={shaderParams.snowTempThreshold}
          activeMaxPrecipitation={activeMaxPrecipitation}
          hasActivePrecipitation={hasActivePrecipitation}
          windSpeed={shaderParams.windSpeed}
        />
      )}

      {/* 5. 3D Landmark Pins across Northern Iraq and Borders */}
      <LandmarkPins
        visible={showPins}
        onSelectLandmark={onSelectLandmark}
      />

      {/* Camera Controls */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        autoRotate={autoRotate}
        autoRotateSpeed={0.4}
        maxPolarAngle={Math.PI / 2.05} // Prevent camera from dipping beneath the terrain plane
        minDistance={500}
        maxDistance={250000}
        enableDamping={true}
        dampingFactor={0.06}
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
}

export const WeatherSimulationView: React.FC<WeatherSimulationViewProps> = (props) => {
  return (
    <div className="w-full h-full relative bg-[#090C10] overflow-hidden">
      <WebGLErrorBoundary>
        <Canvas
          shadows={false}
          camera={{
            position: [0, 68000, 85000],
            fov: 52,
            near: 100,
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
