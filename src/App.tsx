import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { ZoomEarthTopBar } from './components/ZoomEarthTopBar';
import { ZoomEarthFloatingControls } from './components/ZoomEarthFloatingControls';
import { NorthVietnamWeatherCard } from './components/NorthVietnamWeatherCard';
import { WeatherSimulationView } from './components/WeatherSimulationView';
import { SatelliteMetViewerModal } from './components/SatelliteMetViewerModal';
import { HanoiSolarController } from './components/HanoiSolarController';
import {
  getNowInHanoi,
  createHanoiDate,
  getHanoiSunPosition,
  SunPositionResult
} from './utils/sunPosition';
import {
  generateInitialChunkGrid,
  createWeatherDataTexture
} from './utils/weatherDataPipeline';
import {
  fetchLiveNorthVietnamWeather,
  FALLBACK_WEATHER_DATA,
  NorthVietnamWeatherPayload
} from './services/weatherService';
import {
  KURDISTAN_LANDMARKS
} from './utils/realSulaymaniyahTerrain';
import { CLOUD_PROFILES, computeRealCloudBaseMeters } from './services/cloudClassificationService';
import { GridChunkData, ShaderParameters, Landmark } from './types';
import {
  SatelliteSourceMode,
  getTodayDateIso,
  loadLiveNasaTexture,
  fetchRainViewerMetadata,
  createRainViewerRadarCanvas,
  createRainViewerSatelliteCanvas
} from './services/liveSatelliteService';
import {
  loadLiveSatelliteCloudPass,
  buildCombinedLiveWeatherAndCloudTexture,
  SatelliteCloudAnalysis
} from './services/satelliteCloudService';

const DEFAULT_SHADER_PARAMS: ShaderParameters = {
  raymarchSteps: 36,
  cloudDensityMultiplier: 1.5,
  absorptionFactor: 0.65,
  sunScatterIntensity: 1.6,
  windSpeed: 0.8,
  rainThreshold: 0.25,
  snowTempThreshold: 3.0,
  cloudAltitude: 2200,
  cloudThickness: 1800,
  lightningFrequency: 0.7,
  terrainExaggeration: 1.35,
};

export default function App() {
  const [weatherPayload, setWeatherPayload] = useState<NorthVietnamWeatherPayload>(FALLBACK_WEATHER_DATA);
  const [, setIsWeatherLoading] = useState<boolean>(false);

  // Selected landmark in Kurdistan (default: Erbil Citadel)
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string>('erbil');

  // Bottom live weather feed minimized state
  const [isFeedMinimized, setIsFeedMinimized] = useState<boolean>(false);

  // Satellite Imagery & Meteorological Radar modal open state
  const [isSatelliteModalOpen, setIsSatelliteModalOpen] = useState<boolean>(false);

  // Live Satellite and Radar Map Source
  const [satelliteMode, setSatelliteMode] = useState<SatelliteSourceMode>('nasa_today');
  const [satelliteDate, setSatelliteDate] = useState<string>(() => getTodayDateIso(0));
  const [selectedSensor, setSelectedSensor] = useState<string>('VIIRS_SNPP_CorrectedReflectance_TrueColor');
  const [activeRadarGroundTexture, setActiveRadarGroundTexture] = useState<THREE.Texture | null>(null);
  const [liveIrCanvas, setLiveIrCanvas] = useState<HTMLCanvasElement | null>(null);
  const [liveRadarCanvas, setLiveRadarCanvas] = useState<HTMLCanvasElement | null>(null);

  const handleChangeSatelliteMode = useCallback((mode: SatelliteSourceMode) => {
    setSatelliteMode(mode);
    if (mode === 'nasa_today') {
      setSatelliteDate(getTodayDateIso(0));
    } else if (mode === 'nasa_yesterday') {
      setSatelliteDate(getTodayDateIso(-1));
    }
  }, []);

  const handleSelectSatelliteDate = useCallback((date: string) => {
    setSatelliteDate(date);
    if (date === getTodayDateIso(-1)) {
      setSatelliteMode('nasa_yesterday');
    } else {
      setSatelliteMode('nasa_today');
    }
  }, []);

  // Real-time extracted satellite cloud data (3D Volumetric + Cloud Deck + Ground Pass)
  const [satelliteCloudAnalysis, setSatelliteCloudAnalysis] = useState<SatelliteCloudAnalysis | null>(null);
  const [isSatelliteCloudLoading, setIsSatelliteCloudLoading] = useState<boolean>(true);

  const effectiveSatelliteDate = useMemo(() => {
    if (satelliteMode === 'nasa_yesterday') {
      return getTodayDateIso(-1);
    }
    return satelliteDate;
  }, [satelliteMode, satelliteDate]);

  // Ingest NASA satellite orbital pass for Today, Yesterday, or selected Archive date and extract 3D clouds
  useEffect(() => {
    let isCurrent = true;
    setIsSatelliteCloudLoading(true);
    // Clean previous date's clouds immediately when switching between Today and Yesterday
    setSatelliteCloudAnalysis(null);

    loadLiveSatelliteCloudPass(effectiveSatelliteDate, selectedSensor, weatherPayload)
      .then((analysis) => {
        if (isCurrent && analysis) {
          setSatelliteCloudAnalysis(analysis);
          setIsSatelliteCloudLoading(false);
        }
      })
      .catch((err) => {
        console.warn('Satellite cloud pass notice:', err);
        if (isCurrent) setIsSatelliteCloudLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [effectiveSatelliteDate, selectedSensor, weatherPayload]);

  // Load Live RainViewer Doppler Radar & Geostationary Infrared Clouds for 'radar_live'
  useEffect(() => {
    let isCurrent = true;

    fetchRainViewerMetadata().then(async (meta) => {
      if (!isCurrent || !meta) return;
      const [irCanv, radCanv, radGroundCanv] = await Promise.all([
        createRainViewerSatelliteCanvas(meta),
        createRainViewerRadarCanvas(meta, undefined, false),
        satelliteMode === 'radar_live'
          ? createRainViewerRadarCanvas(meta, undefined, true)
          : Promise.resolve(null)
      ]);
      if (!isCurrent) return;
      setLiveIrCanvas(irCanv);
      setLiveRadarCanvas(radCanv);
      if (radGroundCanv && satelliteMode === 'radar_live') {
        const radarTex = new THREE.CanvasTexture(radGroundCanv);
        radarTex.colorSpace = THREE.SRGBColorSpace;
        radarTex.anisotropy = 16;
        radarTex.needsUpdate = true;
        setActiveRadarGroundTexture(radarTex);
      } else if (satelliteMode !== 'radar_live') {
        setActiveRadarGroundTexture(null);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [satelliteMode]);

  // Active 3D Ground Texture:
  // Ground is ALWAYS the crisp High-Definition Kurdistan Orthomosaic (HD Base),
  // with live Doppler Radar overlaid when in 'radar_live' mode.
  const activeGroundTexture = useMemo(() => {
    if (satelliteMode === 'radar_live') {
      return activeRadarGroundTexture;
    }
    return null;
  }, [satelliteMode, activeRadarGroundTexture]);

  // Dynamic Sun Position & Shadow state based on local time in Hanoi
  // isDaytimeMode: turns off live datetime mode so the user can easily see the terrain at night.
  // By default off as requested.
  const [isDaytimeMode, setIsDaytimeMode] = useState<boolean>(false);
  const [isLiveTime, setIsLiveTime] = useState<boolean>(true);
  const [hanoiClock, setHanoiClock] = useState<Date>(() => getNowInHanoi());
  const [simulatedMinutes, setSimulatedMinutes] = useState<number>(() => {
    const d = getNowInHanoi();
    return d.getHours() * 60 + d.getMinutes();
  });

  // Real-time clock tick (updates every second when locked to live Hanoi time)
  useEffect(() => {
    if (!isLiveTime || isDaytimeMode) return;
    const interval = setInterval(() => {
      setHanoiClock(getNowInHanoi());
    }, 1000);
    return () => clearInterval(interval);
  }, [isLiveTime, isDaytimeMode]);

  // Active date used for astronomical solar coordinates calculation
  const activeSolarDate = useMemo(() => {
    if (isDaytimeMode) {
      // Optimal high noon in Hanoi (12:00 PM ICT) for direct, crystal-clear daylight visibility
      return createHanoiDate(12, 0, 0);
    }
    if (isLiveTime) {
      return hanoiClock;
    }
    return createHanoiDate(Math.floor(simulatedMinutes / 60), simulatedMinutes % 60);
  }, [isDaytimeMode, isLiveTime, hanoiClock, simulatedMinutes]);

  // Dynamic astronomical sun position result (elevation, azimuth, light intensity, colors, shadow vectors)
  const sunPosition = useMemo<SunPositionResult>(() => {
    return getHanoiSunPosition(activeSolarDate);
  }, [activeSolarDate]);

  // Display toggles
  const [showClouds, setShowClouds] = useState<boolean>(true);
  const [showRain, setShowRain] = useState<boolean>(true);
  const [showPins, setShowPins] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // 3D Shader parameters (mountain relief, cloud density, etc.)
  const [shaderParams, setShaderParams] = useState<ShaderParameters>(DEFAULT_SHADER_PARAMS);
  const [, setFps] = useState<number>(60);

  // Camera target pose for smooth navigation
  const [targetCameraPose, setTargetCameraPose] = useState<{
    pos: [number, number, number];
    target: [number, number, number];
  } | null>(null);

  // Fetch real-time North Vietnam meteorological telemetry from Open-Meteo
  const loadLiveWeather = useCallback(async () => {
    setIsWeatherLoading(true);
    try {
      const data = await fetchLiveNorthVietnamWeather();
      setWeatherPayload(data);
    } catch (err) {
      console.warn('Using fallback North Vietnam meteorological observations:', err);
    } finally {
      setIsWeatherLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLiveWeather();
    const interval = setInterval(loadLiveWeather, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadLiveWeather]);

  // Spatial chunks covering 240km x 160km North Vietnam topography
  const [chunks, setChunks] = useState<GridChunkData[]>(() =>
    generateInitialChunkGrid(FALLBACK_WEATHER_DATA, 0)
  );

  useEffect(() => {
    setChunks(generateInitialChunkGrid(weatherPayload, 0));
  }, [weatherPayload]);

  const activeChunkIds = useMemo(() => {
    const active = new Set<string>();
    chunks.forEach(c => active.add(c.id));
    return active;
  }, [chunks]);

  // Real multi-channel live weather texture across North Vietnam (Station-interpolated baseline)
  const weatherTexture = useMemo(() => {
    const { texture } = createWeatherDataTexture(512, weatherPayload);
    return texture;
  }, [weatherPayload]);

  // Dedicated Live Weather + Live Satellite IR + Live Radar Cloud Texture for 'radar_live' (Live mode)
  const liveCombinedCloud = useMemo(() => {
    return buildCombinedLiveWeatherAndCloudTexture(weatherPayload, liveIrCanvas, liveRadarCanvas, 512);
  }, [weatherPayload, liveIrCanvas, liveRadarCanvas]);

  // Clean zero-cloud texture for HD Base mode or while switching passes
  const clearWeatherTexture = useMemo(() => {
    const bytes = new Uint8Array(64 * 64 * 4);
    const tex = new THREE.DataTexture(bytes, 64, 64, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Active multi-channel weather texture:
  // - 'nasa_today' & 'nasa_yesterday': cleans previous mode and renders ONLY that day's NASA satellite pass
  // - 'radar_live': cleans NASA pass and renders Live Clouds & Weather (Open-Meteo stations + RainViewer IR & Radar)
  // - 'hd_base': keeps sky clear so the HD Kurdistan basemap is unobstructed
  const activeWeatherTexture = useMemo(() => {
    if (satelliteMode === 'nasa_today' || satelliteMode === 'nasa_yesterday') {
      return satelliteCloudAnalysis?.weatherDataTexture || clearWeatherTexture;
    }
    if (satelliteMode === 'radar_live') {
      return liveCombinedCloud.weatherDataTexture || weatherTexture;
    }
    return clearWeatherTexture;
  }, [satelliteMode, satelliteCloudAnalysis, liveCombinedCloud, weatherTexture, clearWeatherTexture]);

  // Active high-altitude satellite cloud deck texture for Today, Yesterday, and Live modes
  const activeNasaCloudTexture = useMemo(() => {
    if ((satelliteMode === 'nasa_today' || satelliteMode === 'nasa_yesterday') && satelliteCloudAnalysis?.cloudDeckTexture) {
      return satelliteCloudAnalysis.cloudDeckTexture;
    }
    if (satelliteMode === 'radar_live') {
      return liveCombinedCloud.cloudDeckTexture;
    }
    return null;
  }, [satelliteMode, satelliteCloudAnalysis, liveCombinedCloud]);

  // Active surface & atmospheric phenomena texture (R: Ground Snow Cover, G: Valley Fog, B: Dust Plumes, A: Cloud Shadows)
  const activePhenomenaTexture = useMemo(() => {
    if (satelliteMode === 'nasa_today' || satelliteMode === 'nasa_yesterday') {
      return satelliteCloudAnalysis?.phenomenaTexture || clearWeatherTexture;
    }
    if (satelliteMode === 'radar_live') {
      return liveCombinedCloud.phenomenaTexture;
    }
    return null;
  }, [satelliteMode, satelliteCloudAnalysis, liveCombinedCloud, clearWeatherTexture]);

  // Strictly only render rain or snow if it was actually raining/snowing in the active pass
  const hasActivePrecipitation = useMemo(() => {
    if (satelliteMode === 'nasa_today' || satelliteMode === 'nasa_yesterday') {
      return Boolean(satelliteCloudAnalysis?.hasActiveRain || satelliteCloudAnalysis?.hasActiveSnow);
    }
    if (satelliteMode === 'radar_live') {
      return liveCombinedCloud.hasLivePrecipitation;
    }
    return false;
  }, [satelliteMode, satelliteCloudAnalysis, liveCombinedCloud]);

  // Active cloud coverage percentage for TopBar display across Today, Yesterday, and Live modes
  const activeCloudCoveragePct = useMemo(() => {
    if (satelliteMode === 'radar_live') {
      return liveCombinedCloud.liveCoveragePct;
    }
    return satelliteCloudAnalysis?.cloudCoveragePct;
  }, [satelliteMode, liveCombinedCloud, satelliteCloudAnalysis]);

  // Camera Fly-To handler
  const handleFlyTo = useCallback((target: { pos: [number, number, number]; target: [number, number, number] }) => {
    setTargetCameraPose(target);
  }, []);

  const handleSelectLandmark = useCallback((landmark: Landmark) => {
    setSelectedLandmarkId(landmark.id);
    if (landmark.cameraPosition && landmark.cameraTarget) {
      setTargetCameraPose({
        pos: landmark.cameraPosition,
        target: landmark.cameraTarget
      });
    }
  }, []);

  const handleSelectLandmarkById = useCallback((id: string) => {
    const lm = KURDISTAN_LANDMARKS.find(l => l.id === id);
    if (lm) {
      handleSelectLandmark(lm);
    }
  }, [handleSelectLandmark]);

  const handleResetCamera = useCallback(() => {
    setTargetCameraPose({
      pos: [0, 75000, 95000],
      target: [0, 1000, -5000]
    });
  }, []);

  // Station corresponding to the selected landmark
  const currentStation = useMemo(() => {
    if (!weatherPayload?.stations) return FALLBACK_WEATHER_DATA.stations[0];
    const match = weatherPayload.stations.find(s => s.id === selectedLandmarkId);
    return match || weatherPayload.stations[0];
  }, [weatherPayload, selectedLandmarkId]);

  // Regional maximum precipitation in mm/h from real meteorological observations
  const activeMaxPrecipitation = useMemo(() => {
    if (!weatherPayload?.stations || weatherPayload.stations.length === 0) return 0.0;
    return Math.max(...weatherPayload.stations.map(s => s.precipitation ?? 0.0));
  }, [weatherPayload]);

  // Active 3D atmospheric cloud classification with real meteorological LCL Cloud Base altitude
  const activeClassification = useMemo(() => {
    const cov = activeCloudCoveragePct ?? satelliteCloudAnalysis?.cloudCoveragePct ?? 5.0;
    let baseProfile = CLOUD_PROFILES.cumulus_humilis;
    if (cov > 30 && activeMaxPrecipitation > 1.5) {
      baseProfile = CLOUD_PROFILES.cumulonimbus;
    } else if (cov > 12) {
      baseProfile = CLOUD_PROFILES.cumulus_congestus;
    } else if (cov > 0.2) {
      baseProfile = CLOUD_PROFILES.cumulus_humilis;
    } else {
      baseProfile = CLOUD_PROFILES.clear_sky;
    }

    const realBaseM = computeRealCloudBaseMeters(weatherPayload);
    return {
      ...baseProfile,
      baseAltitudeM: realBaseM,
      topAltitudeM: realBaseM + baseProfile.thicknessM
    };
  }, [activeCloudCoveragePct, satelliteCloudAnalysis, activeMaxPrecipitation, weatherPayload]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#07090E] select-none">
      {/* 1. Full-Screen 3D Topographic Simulation for Northern Iraq & Kurdistan */}
      <WeatherSimulationView
        chunks={chunks}
        activeChunkIds={activeChunkIds}
        selectedChunkId={selectedLandmarkId}
        weatherTexture={activeWeatherTexture}
        nasaCloudTexture={activeNasaCloudTexture}
        phenomenaTexture={activePhenomenaTexture}
        shaderParams={shaderParams}
        classification={activeClassification}
        wireframe={false}
        showPins={showPins}
        showClouds={showClouds}
        showRain={showRain}
        activeMaxPrecipitation={activeMaxPrecipitation}
        hasActivePrecipitation={hasActivePrecipitation}
        autoRotate={autoRotate}
        satelliteLayer="hd"
        groundTexture={activeGroundTexture}
        sunPosition={sunPosition}
        onSelectLandmark={handleSelectLandmark}
        targetCameraPose={targetCameraPose}
        onClearTargetPose={() => setTargetCameraPose(null)}
        onUpdateFps={setFps}
      />

      {/* 2. Sleek Floating Top Bar: Branding, Live Date, Landmark Selector & Satellite Modal Button */}
      <ZoomEarthTopBar
        onFlyTo={handleFlyTo}
        selectedLandmarkId={selectedLandmarkId}
        onSelectLandmark={handleSelectLandmark}
        currentStationTemp={currentStation?.temperature ?? 28}
        currentStationCondition={currentStation?.condition ?? 'Partly Cloudy'}
        onOpenSatelliteModal={() => setIsSatelliteModalOpen(true)}
        satelliteMode={satelliteMode}
        onChangeSatelliteMode={handleChangeSatelliteMode}
        satelliteDate={effectiveSatelliteDate}
        satelliteCloudCoveragePct={activeCloudCoveragePct}
        isSatelliteCloudLoading={isSatelliteCloudLoading}
        isTodayPending={satelliteCloudAnalysis?.isTodayPending}
        actualPassDate={satelliteCloudAnalysis?.date}
        isDaytimeMode={isDaytimeMode}
        onToggleDaytimeMode={() => setIsDaytimeMode(prev => !prev)}
      />

      {/* 3. Floating Hanoi Dynamic Sun Position, Shadow & Time Controller */}
      <HanoiSolarController
        sunPosition={sunPosition}
        isLiveTime={isLiveTime}
        simulatedMinutes={simulatedMinutes}
        onToggleLiveTime={setIsLiveTime}
        onSetSimulatedMinutes={setSimulatedMinutes}
        isDaytimeMode={isDaytimeMode}
        onToggleDaytimeMode={setIsDaytimeMode}
      />

      {/* 4. Floating Tool Dock (Right side: Satellite Viewer, Daytime, Clouds, Rain, Pins, Orbit, Reset, Tuning) */}
      <ZoomEarthFloatingControls
        isDaytimeMode={isDaytimeMode}
        onToggleDaytimeMode={() => setIsDaytimeMode(prev => !prev)}
        showClouds={showClouds}
        onToggleClouds={() => setShowClouds(!showClouds)}
        showRain={showRain}
        onToggleRain={() => setShowRain(!showRain)}
        showPins={showPins}
        onTogglePins={() => setShowPins(!showPins)}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate(!autoRotate)}
        onResetCamera={handleResetCamera}
        params={shaderParams}
        onParamsChange={setShaderParams}
        onOpenSatelliteModal={() => setIsSatelliteModalOpen(true)}
      />

      {/* 5. Live Weather & Landmark Telemetry Card (Bottom Left, Minimizeable) */}
      <NorthVietnamWeatherCard
        station={currentStation}
        selectedLandmarkId={selectedLandmarkId}
        onSelectLandmarkId={handleSelectLandmarkById}
        isMinimized={isFeedMinimized}
        onToggleMinimize={() => setIsFeedMinimized(prev => !prev)}
        onOpenSatelliteModal={() => setIsSatelliteModalOpen(true)}
        sunPosition={sunPosition}
      />

      {/* 6. Full-Featured Satellite Imagery & Meteorological Radar Modal */}
      <SatelliteMetViewerModal
        isOpen={isSatelliteModalOpen}
        onClose={() => setIsSatelliteModalOpen(false)}
        weatherPayload={weatherPayload}
        weatherTexture={activeWeatherTexture}
        onFlyToLandmark={handleSelectLandmark}
        activeSatelliteDate={effectiveSatelliteDate}
        onSelectSatelliteDate={handleSelectSatelliteDate}
        activeSatelliteMode={satelliteMode}
        onChangeSatelliteMode={handleChangeSatelliteMode}
        activeSensor={selectedSensor}
        onSelectSensor={setSelectedSensor}
      />
    </div>
  );
}
