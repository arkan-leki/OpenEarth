import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';
import { ZoomEarthTopBar } from './components/ZoomEarthTopBar';
import { ZoomEarthFloatingControls } from './components/ZoomEarthFloatingControls';
import { KurdistanWeatherCard } from './components/KurdistanWeatherCard';
import { WeatherSimulationView } from './components/WeatherSimulationView';
import { GlobeStatus, GlobeMode, GlobeApi } from './components/CesiumGlobe';
import { BASE_MAPS, BaseMapId, isoDaysAgo } from './services/cesiumBaseMaps';

/**
 * CesiumJS supplies ONLY the geospatial layer — globe, streamed terrain, imagery and camera —
 * for the volumetric cloud renderer and ground this app already has.
 *
 * It is a SEPARATE VIEW, chosen when the page loads, not a live toggle. Verified the hard way:
 * mounting Cesium while the three.js canvas is being torn down loses the WebGL context and
 * crashes the React tree, because two WebGL engines cannot safely share one page. Switching
 * therefore navigates and reloads.
 *
 * It is ~1.1 MB gzipped, so it is code-split and fetched only when that view is requested.
 */
const CesiumGlobe = React.lazy(() =>
  import('./components/CesiumGlobe').then((m) => ({ default: m.CesiumGlobe }))
);

/** The Cesium Earth IS the app now. The old volumetric view stays reachable at ?view=legacy. */
const LEGACY_VIEW =
  new URLSearchParams(window.location.search).get('view') === 'legacy';

/**
 * The Cesium Earth: HD satellite ground, with real observations painted over it.
 *
 * Its own page, deliberately. Two WebGL engines cannot safely share one document — mounting
 * Cesium while the three.js canvas was being torn down lost the WebGL context and crashed the
 * React tree — so the two views are reached by navigation, never by a live swap.
 */
/** Square icon button. Zoom Earth's toolbar is icons, not text, so it stays narrow. */
const HudButton: React.FC<{
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, active, children }) => (
  <button
    title={title}
    onClick={onClick}
    className={`w-9 h-9 flex items-center justify-center rounded-lg border backdrop-blur-md text-[14px] leading-none transition-colors ${
      active
        ? 'bg-emerald-400/25 text-emerald-100 border-emerald-300/30'
        : 'bg-[#0b111c]/85 text-slate-300 border-white/10 hover:text-white hover:bg-[#0b111c]'
    }`}
  >
    {children}
  </button>
);

const Chip: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = ''
}) => (
  <div
    className={`bg-[#0b111c]/85 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl ${className}`}
  >
    {children}
  </div>
);

/**
 * The Cesium Earth, laid out the way Zoom Earth does it: chrome lives in the CORNERS and
 * nowhere else, and the bottom is ONE flex row rather than several absolutely-positioned blocks.
 *
 * That is not cosmetic. Every overlap in this view came from stacking absolute panels that each
 * knew nothing about the others, so a collision was inevitable at some window width. Flex
 * containers with gaps cannot overlap by construction, which is the actual fix.
 *
 *   top-left      brand
 *   top-right     icon toolbar, and the layers panel that drops beneath it
 *   right-middle  zoom in / out
 *   bottom row    status (left) · timeline (centre) · reserved gap for Cesium's credits
 */
const GlobeView: React.FC = () => {
  const [mode, setMode] = useState<GlobeMode>('live');
  const [nasaDate, setNasaDate] = useState(() => isoDaysAgo(1));
  const [hoursAgo, setHoursAgo] = useState(0);
  /** Radar on/off, independent of the cloud coverage it sits above. */
  const [showRadar, setShowRadar] = useState(true);
  const [status, setStatus] = useState<GlobeStatus | null>(null);
  const [globeApi, setGlobeApi] = useState<GlobeApi | null>(null);
  const globeApiRef = useRef<GlobeApi | null>(null);
  const askedForLocation = useRef(false);
  const [locating, setLocating] = useState(false);

  /**
   * Ask for the visitor's location and fly there.
   *
   * Kurdistan is the DEFAULT and remains the view in every case except an explicit grant: if the
   * browser declines, the prompt is dismissed, the API is missing, or the lookup times out, the
   * camera simply stays on Kurdistan. Nothing here can leave the app with no view.
   *
   * Browsers only grant geolocation on a secure origin, so this works on localhost and on
   * GitHub Pages (https) but not over plain http on a LAN address. Some browsers also require a
   * user gesture, which is why the same call is wired to the ⌖ button rather than only running
   * automatically.
   */
  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        globeApiRef.current?.flyTo(pos.coords.longitude, pos.coords.latitude, 150_000);
      },
      () => setLocating(false),
      { timeout: 10_000, maximumAge: 600_000 }
    );
  }, []);

  // Ask once, as soon as the globe can accept a flight.
  useEffect(() => {
    if (!globeApi || askedForLocation.current) return;
    askedForLocation.current = true;
    requestLocation();
  }, [globeApi, requestLocation]);

  const MODES: Array<{ id: GlobeMode; label: string; hint: string }> = [
    { id: 'live', label: 'Satellite Live', hint: 'HD satellite ground + Metop polar' },
    { id: 'nasa', label: 'NASA HD', hint: 'NASA imagery for a chosen date' },
    { id: 'radar', label: 'EUMETSAT Radar', hint: 'Meteosat cloud mask + precipitation' }
  ];

  const TIME_STEPS = [
    { hours: 0, label: 'LIVE' },
    { hours: 6, label: '6H' },
    { hours: 12, label: '12H' },
    { hours: 24, label: '24H' }
  ];

  const frameLabel = status?.frameTime
    ? `${status.frameTime.toISOString().slice(11, 16)}Z`
    : '—';
  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#07090E] select-none font-sans">
      <React.Suspense
        fallback={
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#07090E]">
            <div className="w-6 h-6 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin" />
            <div className="text-slate-500 text-[11px] font-mono tracking-widest">LOADING GLOBE</div>
          </div>
        }
      >
        <CesiumGlobe
          mode={mode}
          nasaDate={nasaDate}
          frameHoursAgo={hoursAgo}
          showRadar={showRadar}
          onStatus={setStatus}
          onApi={(api) => {
            globeApiRef.current = api;
            setGlobeApi(api);
          }}
        />
      </React.Suspense>

      {/* TOP — brand left, toolbar right. Separate flex children, so they cannot collide. */}
      <header className="absolute top-0 inset-x-0 z-20 flex items-start justify-between gap-3 p-3 pointer-events-none">
        <Chip className="pointer-events-auto px-3 py-2 flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[12px] font-semibold tracking-[0.18em] text-slate-100">
            OPENEARTH
          </span>
        </Chip>

        {/*
          Right column: modes STACKED and always visible, then the view controls beneath them.
          A single flex column at a fixed width, so nothing can overlap, and there is no hidden
          panel to discover — an earlier version hid the modes behind a toolbar button, which
          meant the primary choice in the app was invisible until you found a tiny icon.
        */}
        <div className="pointer-events-auto flex flex-col items-stretch gap-1.5 w-[9.5rem]">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              title={m.hint}
              className={`px-2.5 py-2 rounded-lg border backdrop-blur-md text-left text-[10px] font-semibold tracking-wider transition-colors ${
                mode === m.id
                  ? 'bg-emerald-400/25 text-emerald-100 border-emerald-300/30'
                  : 'bg-[#0b111c]/85 text-slate-300 border-white/10 hover:text-white'
              }`}
            >
              {m.label.toUpperCase()}
            </button>
          ))}

          {mode === 'radar' && (
            <button
              onClick={() => setShowRadar((v) => !v)}
              title="Show or hide the EUMETSAT precipitation (radar) sheet"
              className={`px-2.5 py-2 rounded-lg border backdrop-blur-md text-left text-[10px] font-semibold tracking-wider transition-colors ${
                showRadar
                  ? 'bg-emerald-400/25 text-emerald-100 border-emerald-300/30'
                  : 'bg-[#0b111c]/85 text-slate-500 border-white/10 hover:text-slate-300'
              }`}
            >
              RADAR {showRadar ? 'ON' : 'OFF'}
            </button>
          )}

          {mode === 'nasa' && (
            <div className="bg-[#0b111c]/85 backdrop-blur-md border border-white/10 rounded-lg px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Date</div>
              <input
                type="date"
                value={nasaDate}
                max={isoDaysAgo(0)}
                onChange={(e) => setNasaDate(e.target.value)}
                className="w-full bg-transparent text-[10px] text-slate-200 font-mono outline-none"
              />
            </div>
          )}

          <div className="h-px bg-white/10 my-0.5" />

          <div className="flex gap-1.5">
            <HudButton title="Zoom in" onClick={() => globeApi?.zoomIn()}>
              +
            </HudButton>
            <HudButton title="Zoom out" onClick={() => globeApi?.zoomOut()}>
              −
            </HudButton>
            <HudButton
              title={locating ? 'Locating…' : 'Go to my location'}
              active={locating}
              onClick={requestLocation}
            >
              ⌖
            </HudButton>
            <HudButton title="Reset to Kurdistan" onClick={() => globeApi?.resetView()}>
              ⌂
            </HudButton>
          </div>
        </div>
      </header>

      {/* BOTTOM — a single flex row: status · timeline · gap for the credits. */}
      <footer className="absolute bottom-0 inset-x-0 z-20 flex items-end justify-between gap-3 p-3 pointer-events-none">
        <Chip className="pointer-events-auto px-3 py-2">
          <div className="flex items-center gap-3 text-[10px] font-mono whitespace-nowrap">
            <span className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  status?.ready ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="text-slate-300">{activeMode.label.toUpperCase()}</span>
            </span>
            <span className="text-slate-500">
              CLOUD <span className="text-slate-200">{status?.cloudCoveragePct ?? '—'}%</span>
            </span>
            <span className="text-slate-500">
              FRAME <span className="text-slate-200">{frameLabel}</span>
            </span>
          </div>

          {/*
            Weather attribution.
            Cesium's credit line only knows about imagery layers. Once the weather moved to
            altitude sheets it stopped being an imagery layer, and the EUMETSAT credit silently
            vanished from the screen — these are other people's satellites and they have to be
            named, so the sources are stated here instead.
          */}
          {/*
            Attribution for FOUR operators, not one. The globe is tiled from EUMETSAT's Meteosat
            over Europe/Africa/Indian Ocean, NOAA's GOES pair over the Americas and Pacific, and
            JMA's Himawari over east Asia. Each is a different organisation's data and each has to
            be named — the Cesium credit line only tracks imagery layers, and these are sheets.
          */}
          <div className="mt-1 text-[9px] text-slate-600 whitespace-nowrap">
            Weather: EUMETSAT Meteosat/Metop · NOAA-CIRA GeoColor (GOES-East/West) · JMA Himawari
          </div>
        </Chip>

        {mode === 'radar' && (
          <Chip className="pointer-events-auto p-1 flex items-center gap-0.5">
            {TIME_STEPS.map((t) => (
              <button
                key={t.hours}
                onClick={() => setHoursAgo(t.hours)}
                title={`EUMETSAT frame ${t.label}`}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold tracking-wider transition-colors ${
                  hoursAgo === t.hours
                    ? 'bg-emerald-400/20 text-emerald-200'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </Chip>
        )}

        {/* Reserves the bottom-right corner so Cesium's credits never sit under the timeline. */}
        <div className="w-24 shrink-0" />
      </footer>
    </div>
  );
};
import { loadSatelliteTilesForChunks } from './services/chunkSatelliteService';
import { SatelliteMetViewerModal } from './components/SatelliteMetViewerModal';
import { KurdistanSolarController } from './components/KurdistanSolarController';
import { Ground360ControlBar } from './components/Ground360ControlBar';
import {
  getNowInKurdistan,
  createKurdistanDate,
  getKurdistanSunPosition,
  SunPositionResult
} from './utils/sunPosition';
import {
  generateInitialChunkGrid
} from './utils/weatherDataPipeline';
import {
  fetchLiveKurdistanWeather,
  FALLBACK_WEATHER_DATA,
  KurdistanWeatherPayload
} from './services/weatherService';
import {
  KURDISTAN_LANDMARKS,
  getGround360CameraPose
} from './utils/realSulaymaniyahTerrain';
import { CLOUD_PROFILES, computeRealCloudBaseMeters } from './services/cloudClassificationService';
import { worldRectToLonLatBounds } from './utils/realSulaymaniyahTerrain';
import { GridChunkData, ShaderParameters, Landmark } from './types';
import {
  SatelliteSourceMode,
  getTodayDateIso
} from './services/liveSatelliteService';
import { fetchEumetsatCloudCanvas } from './services/eumetsatService';
import {
  loadLiveSatelliteCloudPass,
  buildCombinedLiveWeatherAndCloudTexture,
  SatelliteCloudAnalysis
} from './services/satelliteCloudService';

const DEFAULT_SHADER_PARAMS: ShaderParameters = {
  raymarchSteps: 96,
  cloudDensityMultiplier: 1.5,
  absorptionFactor: 0.65,
  sunScatterIntensity: 1.6,
  windSpeed: 0.8,
  rainThreshold: 0.04,
  snowTempThreshold: 3.0,
  cloudAltitude: 3400,
  cloudThickness: 1800,
  lightningFrequency: 0.7,
  terrainExaggeration: 1.35,
};

export default function App() {
  const [weatherPayload, setWeatherPayload] = useState<KurdistanWeatherPayload>(FALLBACK_WEATHER_DATA);
  const [, setIsWeatherLoading] = useState<boolean>(false);

  // The Cesium globe lives on its own page (see GLOBE_VIEW), so this component never has to
  // host two WebGL engines at once.
  if (!LEGACY_VIEW) return <GlobeView />;

  // Selected landmark in Kurdistan (default: Erbil Citadel)
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string>('erbil');

  // Bottom live weather feed minimized state
  const [isFeedMinimized, setIsFeedMinimized] = useState<boolean>(false);

  // Satellite Imagery & Meteorological Radar modal open state
  const [isSatelliteModalOpen, setIsSatelliteModalOpen] = useState<boolean>(false);

  // Eye button state to hide all UI panels, bars, and 3D pins for an unobstructed view
  const [hideAll, setHideAll] = useState<boolean>(false);

  /**
   * Per-chunk satellite imagery for the active date + sensor, fetched at RUNTIME.
   * Deliberately not pre-rendered to files: every day's pass differs, so a product must
   * fetch live. Each chunk renders the satellite's own full-resolution view of its region
   * instead of one whole-domain image stretched across all 16 chunks.
   */
  const [chunkSatelliteTextures, setChunkSatelliteTextures] = useState<
    Map<string, THREE.Texture>
  >(() => new Map());

  // Live Satellite and Radar Map Source
  // Default to the HD base map. 'nasa_today' opens on the day's satellite pass, which is
// routinely 80-90% cloud over this region and hides the map entirely.
  const [satelliteMode, setSatelliteMode] = useState<SatelliteSourceMode>('radar_live');
  const [satelliteDate, setSatelliteDate] = useState<string>(() => getTodayDateIso(0));
  const [selectedSensor, setSelectedSensor] = useState<string>('VIIRS_SNPP_CorrectedReflectance_TrueColor');
  const [activeRadarGroundTexture, setActiveRadarGroundTexture] = useState<THREE.Texture | null>(null);
  const [liveIrCanvas, setLiveIrCanvas] = useState<HTMLCanvasElement | null>(null);
  const [liveRadarCanvas, setLiveRadarCanvas] = useState<HTMLCanvasElement | null>(null);
  const [eumetsatCoveragePct, setEumetsatCoveragePct] = useState<number | undefined>(undefined);
  const [eumetsatFrameTime, setEumetsatFrameTime] = useState<Date | undefined>(undefined);

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

  // Ingest NASA satellite orbital pass for Today / Yesterday and extract 3D clouds.
  //
  // Scheduled to the NASA modes ONLY. Live mode is dedicated to EUMETSAT, and this used to
  // run in every mode — which is how today's NASA pass could bleed into the live sky.
  useEffect(() => {
    const isNasaMode = satelliteMode === 'nasa_today' || satelliteMode === 'nasa_yesterday';
    if (!isNasaMode) {
      setSatelliteCloudAnalysis(null);
      setIsSatelliteCloudLoading(false);
      return;
    }

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
  }, [satelliteMode, effectiveSatelliteDate, selectedSensor, weatherPayload]);

  // Load EUMETSAT (Meteosat IODC) derived products for the Live mode:
  //  - `clm` Cloud Mask  → cloud density (EUMETSAT's own detection algorithm)
  //  - `h63` precip      → rain channel (transparent where dry)
  // Both carry an explicit observation TIME, so the frame on screen has known provenance.
  useEffect(() => {
    let isCurrent = true;

    if (satelliteMode !== 'radar_live') {
      setLiveIrCanvas(null);
      setLiveRadarCanvas(null);
      setActiveRadarGroundTexture(null);
      setEumetsatCoveragePct(undefined);
      setEumetsatFrameTime(undefined);
      return;
    }

    fetchEumetsatCloudCanvas().then((result) => {
      if (!isCurrent || !result) return;
      setLiveIrCanvas(result.cloudCanvas);
      setLiveRadarCanvas(result.precipCanvas);
      setActiveRadarGroundTexture(null);
      setEumetsatCoveragePct(result.cloudCoveragePct);
      setEumetsatFrameTime(result.frameTime);
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

  // Dynamic Sun Position & Shadow state:
  // Default isDaytimeMode to true so the 3D Rayleigh sky is vibrant blue and terrain/clouds are brightly lit
  const [isDaytimeMode, setIsDaytimeMode] = useState<boolean>(false);
  const [isLiveTime, setIsLiveTime] = useState<boolean>(true);
  const [kurdistanClock, setKurdistanClock] = useState<Date>(() => getNowInKurdistan());
  const [simulatedMinutes, setSimulatedMinutes] = useState<number>(() => {
    const d = getNowInKurdistan();
    return d.getHours() * 60 + d.getMinutes();
  });

  // Real-time clock tick (updates every second when locked to live Kurdistan time)
  useEffect(() => {
    if (!isLiveTime || isDaytimeMode) return;
    const interval = setInterval(() => {
      setKurdistanClock(getNowInKurdistan());
    }, 1000);
    return () => clearInterval(interval);
  }, [isLiveTime, isDaytimeMode]);

  // Active date used for astronomical solar coordinates calculation
  const activeSolarDate = useMemo(() => {
    if (isDaytimeMode) {
      // Optimal high noon in Kurdistan (12:00 PM AST) for direct, crystal-clear daylight visibility
      return createKurdistanDate(12, 0, 0);
    }
    if (isLiveTime) {
      return kurdistanClock;
    }
    return createKurdistanDate(Math.floor(simulatedMinutes / 60), simulatedMinutes % 60);
  }, [isDaytimeMode, isLiveTime, kurdistanClock, simulatedMinutes]);

  // Dynamic astronomical sun position result (elevation, azimuth, light intensity, colors, shadow vectors)
  const sunPosition = useMemo<SunPositionResult>(() => {
    return getKurdistanSunPosition(activeSolarDate);
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

  // 360° Ground-Level Spot Camera Mode & Live Compass Heading
  const [isGround360Mode, setIsGround360Mode] = useState<boolean>(false);
  const [ground360Spot, setGround360Spot] = useState<{ x: number; z: number } | null>(() => {
    const def = KURDISTAN_LANDMARKS[0];
    return { x: def.position[0], z: def.position[2] };
  });
  const [compassHeading, setCompassHeading] = useState<number>(0);
  const [cameraActionTick, setCameraActionTick] = useState<{
    type: 'left' | 'right' | 'look_up' | 'horizon';
    seq: number;
  } | null>(null);

  // Fetch real-time Kurdistan meteorological telemetry from Open-Meteo
  const loadLiveWeather = useCallback(async () => {
    setIsWeatherLoading(true);
    try {
      const data = await fetchLiveKurdistanWeather();
      setWeatherPayload(data);
    } catch (err) {
      console.warn('Using fallback Kurdistan meteorological observations:', err);
    } finally {
      setIsWeatherLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLiveWeather();
    const interval = setInterval(loadLiveWeather, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadLiveWeather]);

  // Spatial chunks covering 240km x 160km Kurdistan topography
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

  // Dedicated EUMETSAT Live Cloud Texture for 'radar_live' (Live mode)
  const liveCombinedCloud = useMemo(() => {
    return buildCombinedLiveWeatherAndCloudTexture(weatherPayload, liveIrCanvas, liveRadarCanvas, 1024);
  }, [weatherPayload, liveIrCanvas, liveRadarCanvas]);

  // Clean zero-cloud texture for HD Base mode or while switching passes
  const clearWeatherTexture = useMemo(() => {
    const bytes = new Uint8Array(64 * 64 * 4);
    const tex = new THREE.DataTexture(bytes, 64, 64, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }, []);

  // Active multi-channel weather texture:
  // - 'nasa_today' & 'nasa_yesterday': renders ONLY that day's NASA satellite pass
  // - 'radar_live': renders ONLY the EUMETSAT Cloud Mask (no procedural cloud)
  // - 'hd_base': keeps sky clear so the HD Kurdistan basemap is unobstructed
  const activeWeatherTexture = useMemo(() => {
    if (satelliteMode === 'nasa_today' || satelliteMode === 'nasa_yesterday') {
      return satelliteCloudAnalysis?.weatherDataTexture || clearWeatherTexture;
    }
    if (satelliteMode === 'radar_live') {
      // Live is dedicated to EUMETSAT: only the live cloud texture, no NASA pass fallback.
      return liveCombinedCloud.weatherDataTexture;
    }
    // HD Base is the clean basemap view — no weather overlay, by design.
    return clearWeatherTexture;
  }, [satelliteMode, satelliteCloudAnalysis, liveCombinedCloud, clearWeatherTexture]);

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
      return eumetsatCoveragePct ?? liveCombinedCloud.liveCoveragePct;
    }
    return satelliteCloudAnalysis?.cloudCoveragePct;
  }, [satelliteMode, eumetsatCoveragePct, liveCombinedCloud, satelliteCloudAnalysis]);

  // Camera Fly-To handler
  const handleFlyTo = useCallback((target: { pos: [number, number, number]; target: [number, number, number] }) => {
    setTargetCameraPose(target);
  }, []);

  // Selecting any location places the camera on solid ground at that exact spot in 360° Ground Mode
  const handleSelectLandmark = useCallback((landmark: Landmark) => {
    setSelectedLandmarkId(landmark.id);
    const wx = landmark.position[0];
    const wz = landmark.position[2];
    const exag = shaderParams.terrainExaggeration ?? 1.35;
    const pose = getGround360CameraPose(wx, wz, exag, 65);
    setIsGround360Mode(true);
    setGround360Spot({ x: wx, z: wz });
    setTargetCameraPose({
      pos: pose.pos,
      target: pose.target
    });
  }, [shaderParams.terrainExaggeration]);

  const handleSelectLandmarkById = useCallback((id: string) => {
    const lm = KURDISTAN_LANDMARKS.find(l => l.id === id);
    if (lm) {
      handleSelectLandmark(lm);
    }
  }, [handleSelectLandmark]);

  const handleSpotGroundClick = useCallback((x: number, z: number) => {
    const exag = shaderParams.terrainExaggeration ?? 1.35;
    const pose = getGround360CameraPose(x, z, exag, 65);
    setIsGround360Mode(true);
    setGround360Spot({ x, z });
    setTargetCameraPose({
      pos: pose.pos,
      target: pose.target
    });
  }, [shaderParams.terrainExaggeration]);

  // Load one satellite image per chunk whenever the date, sensor or mode changes.
  useEffect(() => {
    const isSatelliteMode = satelliteMode === 'nasa_today' || satelliteMode === 'nasa_yesterday';
    if (!isSatelliteMode || chunks.length === 0) {
      setChunkSatelliteTextures((prev) => (prev.size ? new Map() : prev));
      return;
    }

    let cancelled = false;
    const requests = chunks.map((c) => {
      const widthMeters = c.widthMeters ?? 300000;
      const heightMeters = c.heightMeters ?? 300000;
      return {
        id: c.id,
        widthKm: widthMeters / 1000,
        bounds: worldRectToLonLatBounds(c.gridX, c.gridY, widthMeters, heightMeters)
      };
    });

    loadSatelliteTilesForChunks(requests, selectedSensor, effectiveSatelliteDate).then((map) => {
      if (!cancelled) setChunkSatelliteTextures(map);
    });

    return () => {
      cancelled = true;
    };
  }, [satelliteMode, selectedSensor, effectiveSatelliteDate, chunks]);

  const handleResetCamera = useCallback(() => {
    setIsGround360Mode(false);
    setTargetCameraPose({
      pos: [0, 125000, 175000],
      target: [0, 500, -8000]
    });
  }, []);

  const handleToggleGround360Mode = useCallback(() => {
    if (isGround360Mode) {
      handleResetCamera();
    } else {
      const lm = KURDISTAN_LANDMARKS.find(l => l.id === selectedLandmarkId) || KURDISTAN_LANDMARKS[0];
      handleSelectLandmark(lm);
    }
  }, [isGround360Mode, selectedLandmarkId, handleResetCamera, handleSelectLandmark]);

  const handleCameraAction = useCallback((type: 'left' | 'right' | 'look_up' | 'horizon') => {
    setCameraActionTick(prev => ({ type, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  // Station corresponding to the selected landmark (supports all 28 locations with elevation lapse-rate calibration)
  const currentStation = useMemo(() => {
    const stations = weatherPayload?.stations?.length ? weatherPayload.stations : FALLBACK_WEATHER_DATA.stations;
    const exactMatch = stations.find(s => s.id === selectedLandmarkId);
    if (exactMatch) return exactMatch;

    const lm = KURDISTAN_LANDMARKS.find(l => l.id === selectedLandmarkId);
    if (!lm) return stations[0];

    const lmLon = lm.lon ?? 44.5;
    const lmLat = lm.lat ?? 36.2;
    const lmElev = lm.elevationM ?? 800;

    let nearest = stations[0];
    let minDist = Infinity;
    for (const s of stations) {
      const d = Math.hypot(s.lon - lmLon, s.lat - lmLat);
      if (d < minDist) {
        minDist = d;
        nearest = s;
      }
    }

    const elevDelta = lmElev - nearest.elevation;
    const adjustedTemp = Number((nearest.temperature - elevDelta * 0.0062).toFixed(1));
    return {
      ...nearest,
      id: lm.id,
      name: lm.name,
      lat: lmLat,
      lon: lmLon,
      elevation: lmElev,
      temperature: adjustedTemp
    };
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

    const lclBaseM = computeRealCloudBaseMeters(weatherPayload);
    const userAdjustedBaseM = shaderParams.cloudAltitude ?? lclBaseM;
    return {
      ...baseProfile,
      baseAltitudeM: userAdjustedBaseM,
      topAltitudeM: userAdjustedBaseM + baseProfile.thicknessM
    };
  }, [activeCloudCoveragePct, satelliteCloudAnalysis, activeMaxPrecipitation, weatherPayload, shaderParams.cloudAltitude]);

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
        showPins={!hideAll && showPins}
        showClouds={showClouds}
        showRain={showRain}
        activeMaxPrecipitation={activeMaxPrecipitation}
        hasActivePrecipitation={hasActivePrecipitation}
        autoRotate={autoRotate}
        satelliteLayer="hd"
        groundTexture={activeGroundTexture}
        chunkSatelliteTextures={chunkSatelliteTextures}
        sunPosition={sunPosition}
        onSelectLandmark={handleSelectLandmark}
        targetCameraPose={targetCameraPose}
        onClearTargetPose={() => setTargetCameraPose(null)}
        onUpdateFps={setFps}
        isGround360Mode={isGround360Mode}
        ground360Spot={ground360Spot}
        onSpotGroundClick={handleSpotGroundClick}
        cameraActionTick={cameraActionTick}
        onUpdateCompassHeading={setCompassHeading}
      />

      {/* 2. Sleek Floating Top Bar: Branding, Live Date, Landmark Selector & Satellite Modal Button */}
      {!hideAll && (
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
          onSelectSatelliteDate={handleSelectSatelliteDate}
          satelliteCloudCoveragePct={activeCloudCoveragePct}
          isSatelliteCloudLoading={isSatelliteCloudLoading}
          isTodayPending={satelliteCloudAnalysis?.isTodayPending}
          actualPassDate={satelliteCloudAnalysis?.date}
          eumetsatFrameLabel={
            eumetsatFrameTime
              ? `${eumetsatFrameTime.toISOString().slice(0, 16).replace('T', ' ')}Z`
              : undefined
          }
          isDaytimeMode={isDaytimeMode}
          onToggleDaytimeMode={() => setIsDaytimeMode(prev => !prev)}
        />
      )}

      {/* 3. Floating Kurdistan Dynamic Sun Position, Shadow & Time Controller */}
      {!hideAll && (
        <KurdistanSolarController
          sunPosition={sunPosition}
          isLiveTime={isLiveTime}
          simulatedMinutes={simulatedMinutes}
          onToggleLiveTime={setIsLiveTime}
          onSetSimulatedMinutes={setSimulatedMinutes}
          isDaytimeMode={isDaytimeMode}
          onToggleDaytimeMode={setIsDaytimeMode}
        />
      )}

      {/* 4. Floating Tool Dock (Right side: Eye Hide All, Satellite Viewer, Daytime, Clouds, Rain, Pins, Orbit, Reset, Tuning) */}
      <ZoomEarthFloatingControls
        hideAll={hideAll}
        onToggleHideAll={() => {
          setHideAll(prev => !prev);
          setIsSatelliteModalOpen(false);
        }}
        cesiumGlobe={false}
        onToggleCesiumGlobe={() => {
          window.location.href = '?view=globe';
        }}
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
      {!hideAll && (
        <KurdistanWeatherCard
          station={currentStation}
          selectedLandmarkId={selectedLandmarkId}
          onSelectLandmarkId={handleSelectLandmarkById}
          isMinimized={isFeedMinimized}
          onToggleMinimize={() => setIsFeedMinimized(prev => !prev)}
          onOpenSatelliteModal={() => setIsSatelliteModalOpen(true)}
          sunPosition={sunPosition}
        />
      )}

      {/* 5b. 360° Ground-Level Location Explorer & Same-Spot Camera Controller (Bottom Center) */}
      {!hideAll && (
        <Ground360ControlBar
          selectedLandmarkId={selectedLandmarkId}
          onSelectLandmark={handleSelectLandmark}
          isGround360Mode={isGround360Mode}
          onToggleGround360Mode={handleToggleGround360Mode}
          autoRotate={autoRotate}
          onToggleAutoRotate={() => setAutoRotate(prev => !prev)}
          compassHeading={compassHeading}
          onCameraAction={handleCameraAction}
        />
      )}

      {/* 6. Full-Featured Satellite Imagery & Meteorological Radar Modal */}
      {!hideAll && (
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
      )}
    </div>
  );
}
