import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import {
  X,
  Layers,
  Cloud,
  Droplets,
  Thermometer,
  Wind,
  Mountain,
  MapPin,
  Download,
  Radio,
  Eye,
  Check,
  Calendar,
  Sparkles,
  RefreshCw,
  Info,
  Clock
} from 'lucide-react';
import { KurdistanWeatherPayload } from '../services/weatherService';
import { Landmark } from '../types';
import {
  KURDISTAN_LANDMARKS,
  MIN_LON,
  MAX_LON,
  MIN_LAT,
  MAX_LAT
} from '../utils/realSulaymaniyahTerrain';
import {
  NASA_SATELLITE_LAYERS,
  LOCAL_NASA_HISTORY_DATES,
  SatelliteSourceMode,
  getTodayDateIso,
  formatDisplayDate,
  getNasaGibsWmsUrl,
  fetchRainViewerMetadata,
  createRainViewerRadarCanvas,
  RainViewerMetadata,
  loadRobustSatelliteImage,
  isBlankSatelliteImage
} from '../services/liveSatelliteService';
import { fetchEumetsatLayerFrame } from '../services/eumetsatService';

export type MetLayerType = 'composite' | 'radar' | 'clouds' | 'temperature' | 'satellite';

interface SatelliteMetViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  weatherPayload: KurdistanWeatherPayload;
  weatherTexture?: THREE.Texture | null;
  onFlyToLandmark?: (lm: Landmark) => void;
  activeSatelliteDate?: string;
  onSelectSatelliteDate?: (date: string) => void;
  activeSatelliteMode?: SatelliteSourceMode;
  onChangeSatelliteMode?: (mode: SatelliteSourceMode) => void;
  activeSensor?: string;
  onSelectSensor?: (sensor: string) => void;
}

export const SatelliteMetViewerModal: React.FC<SatelliteMetViewerModalProps> = ({
  isOpen,
  onClose,
  weatherPayload,
  weatherTexture,
  onFlyToLandmark,
  activeSatelliteDate,
  onSelectSatelliteDate,
  activeSatelliteMode,
  onChangeSatelliteMode,
  activeSensor,
  onSelectSensor
}) => {
  const [activeLayer, setActiveLayer] = useState<MetLayerType>('composite');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.75);
  const [showPins, setShowPins] = useState<boolean>(true);
  const [selectedStationId, setSelectedStationId] = useState<string>('erbil');
  const [hoveredStationId, setHoveredStationId] = useState<string | null>(null);

  // Satellite Date and Sensor selector
  const todayIso = useMemo(() => getTodayDateIso(0), []);
  const yesterdayIso = useMemo(() => getTodayDateIso(-1), []);
  const [selectedDate, setSelectedDate] = useState<string>(activeSatelliteDate || todayIso);
  const [selectedSensor, setSelectedSensor] = useState<string>('VIIRS_SNPP_CorrectedReflectance_TrueColor');
  const [useHdBase, setUseHdBase] = useState<boolean>(activeSatelliteMode === 'hd_base');
  /** Live EUMETSAT source, mirroring the 3D scene's Live mode. */
  const [useEumetsatLive, setUseEumetsatLive] = useState<boolean>(
    activeSatelliteMode === 'radar_live'
  );

  // Sync modal state when opened or when parent props change
  useEffect(() => {
    if (activeSatelliteDate) {
      setSelectedDate(activeSatelliteDate);
    }
  }, [activeSatelliteDate]);

  useEffect(() => {
    setUseHdBase(activeSatelliteMode === 'hd_base');
  }, [activeSatelliteMode]);

  useEffect(() => {
    setUseEumetsatLive(activeSatelliteMode === 'radar_live');
  }, [activeSatelliteMode]);

  const [orbitalStatusNote, setOrbitalStatusNote] = useState<string>('');
  const [isTodayPending, setIsTodayPending] = useState<boolean>(false);
  const [actualPassDate, setActualPassDate] = useState<string>(todayIso);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentSatImage, setCurrentSatImage] = useState<HTMLImageElement | null>(null);
  const [imageLoading, setImageLoading] = useState<boolean>(false);
  const [imageLoadError, setImageLoadError] = useState<boolean>(false);

  // RainViewer live radar feed
  const [rainViewerMeta, setRainViewerMeta] = useState<RainViewerMetadata | null>(null);
  const [radarCanvas, setRadarCanvas] = useState<HTMLCanvasElement | null>(null);

  // Fetch real-time RainViewer radar
  useEffect(() => {
    let mounted = true;
    fetchRainViewerMetadata().then((meta) => {
      if (mounted && meta) {
        setRainViewerMeta(meta);
        createRainViewerRadarCanvas(meta).then((c) => {
          if (mounted && c) setRadarCanvas(c);
        });
      }
    });
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  // Load satellite image dynamically with multi-tier verification (NASA GIBS -> latest pass -> HD base)
  useEffect(() => {
    if (!isOpen) return;

    let isCurrent = true;
    setImageLoading(true);
    setImageLoadError(false);

    if (useHdBase) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!isCurrent) return;
        setCurrentSatImage(img);
        setImageLoading(false);
        setOrbitalStatusNote('Clean High-Definition Kurdistan & Northern Iraq Satellite Orthomosaic');
        setIsTodayPending(false);
        setActualPassDate('Kurdistan HD Base');
      };
      img.onerror = () => {
        if (!isCurrent) return;
        setImageLoading(false);
        setImageLoadError(true);
      };
      img.src = 'tiles/erbil_map_hd.jpg?v=erbil_map_hd';
      return;
    }

    // LIVE — EUMETSAT Meteosat, the same source the 3D Live mode renders from.
    if (useEumetsatLive) {
      fetchEumetsatLayerFrame().then((frame) => {
        if (!isCurrent) return;
        if (!frame) {
          setImageLoading(false);
          setImageLoadError(true);
          return;
        }
        const stamp = `${frame.frameTime.toISOString().slice(0, 16).replace('T', ' ')}Z`;
        setCurrentSatImage(frame.image);
        setImageLoading(false);
        setIsTodayPending(false);
        setActualPassDate(stamp);
        setOrbitalStatusNote(`EUMETSAT Meteosat IODC — live cloud imagery (observation ${stamp})`);
      });
      return;
    }

    loadRobustSatelliteImage(selectedSensor, selectedDate)
      .then((res) => {
        if (!isCurrent) return;
        setCurrentSatImage(res.image);
        setImageLoading(false);
        setIsTodayPending(res.isTodayPending);
        setOrbitalStatusNote(res.statusNote);
        setActualPassDate(res.actualDate);
      })
      .catch((err) => {
        if (!isCurrent) return;
        console.error('Failed to load robust satellite image:', err);
        setImageLoading(false);
        setImageLoadError(true);
      });

    return () => {
      isCurrent = false;
    };
  }, [isOpen, selectedDate, selectedSensor, useHdBase, useEumetsatLive]);

  // Keyboard shortcut: close with Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Extract pixel buffer from THREE.DataTexture
  const extractTexturePixels = useCallback((): { pixels: Uint8ClampedArray; width: number; height: number } | null => {
    if (!weatherTexture) return null;
    const dataTex = weatherTexture as THREE.DataTexture;
    if (dataTex.image && dataTex.image.data) {
      const w = dataTex.image.width || 512;
      const h = dataTex.image.height || 512;
      return {
        pixels: new Uint8ClampedArray(dataTex.image.data.buffer),
        width: w,
        height: h
      };
    }
    return null;
  }, [weatherTexture]);

  // Draw composite map on canvas
  const drawMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw Base Satellite Image
    if (currentSatImage && !imageLoading) {
      ctx.drawImage(currentSatImage, 0, 0, width, height);
    } else {
      // Dark placeholder if image still downloading
      ctx.fillStyle = '#090D16';
      ctx.fillRect(0, 0, width, height);
      // Subtle grid
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    if (activeLayer === 'satellite') {
      return; // Pure satellite image requested
    }

    // 2. If Rain Radar and we have live RainViewer Doppler radar canvas, blend it!
    if (activeLayer === 'radar' && radarCanvas) {
      ctx.globalAlpha = overlayOpacity;
      ctx.drawImage(radarCanvas, 0, 0, width, height);
      ctx.globalAlpha = 1.0;
    }

    // 3. Render Meteorological Overlay from Open-Meteo pipeline
    const texData = extractTexturePixels();
    if (!texData) return;

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = texData.width;
    overlayCanvas.height = texData.height;
    const oCtx = overlayCanvas.getContext('2d');
    if (!oCtx) return;

    const imgData = oCtx.createImageData(texData.width, texData.height);
    const dst = imgData.data;
    const src = texData.pixels;

    for (let i = 0; i < src.length; i += 4) {
      const cloudNorm = src[i] / 255.0;      // R: Cloud coverage
      const rainNorm = src[i + 1] / 255.0;  // G: Rain radar intensity
      const tempNorm = src[i + 2] / 255.0;  // B: Temp normalized (-5 to 42 C)
      const tempC = tempNorm * 47.0 - 5.0;

      if (activeLayer === 'radar') {
        // Rain Radar reflectivity color palette (Doppler-style)
        if (rainNorm > 0.04) {
          if (rainNorm < 0.25) {
            // Light green drizzle
            dst[i] = 34; dst[i + 1] = 197; dst[i + 2] = 94; dst[i + 3] = Math.round(180 * (rainNorm / 0.25));
          } else if (rainNorm < 0.5) {
            // Yellow moderate showers
            const t = (rainNorm - 0.25) / 0.25;
            dst[i] = Math.round(34 + t * 200); dst[i + 1] = Math.round(197 - t * 18); dst[i + 2] = Math.round(94 - t * 86); dst[i + 3] = 210;
          } else if (rainNorm < 0.75) {
            // Orange-red heavy downpour
            const t = (rainNorm - 0.5) / 0.25;
            dst[i] = 249; dst[i + 1] = Math.round(115 - t * 80); dst[i + 2] = 22; dst[i + 3] = 235;
          } else {
            // Purple/magenta severe storm
            dst[i] = 217; dst[i + 1] = 70; dst[i + 2] = 239; dst[i + 3] = 250;
          }
        } else {
          dst[i + 3] = 0;
        }
      } else if (activeLayer === 'clouds') {
        // Volumetric clouds mask
        if (cloudNorm > 0.05) {
          const alpha = Math.min(240, Math.round(cloudNorm * 230));
          dst[i] = 245; dst[i + 1] = 250; dst[i + 2] = 255; dst[i + 3] = alpha;
        } else {
          dst[i + 3] = 0;
        }
      } else if (activeLayer === 'temperature') {
        // Thermal heat map across Northern Iraq & Kurdistan
        const t = Math.max(0, Math.min(1, (tempC - 14) / 20));
        let r = 0, g = 0, b = 0;
        if (t < 0.33) {
          const sub = t / 0.33;
          r = Math.round(14 + sub * 20); g = Math.round(165 + sub * 30); b = 233; // Cool Cyan
        } else if (t < 0.66) {
          const sub = (t - 0.33) / 0.33;
          r = Math.round(34 + sub * 200); g = Math.round(195 - sub * 15); b = Math.round(233 - sub * 200); // Emerald to Yellow
        } else {
          const sub = (t - 0.66) / 0.34;
          r = 239; g = Math.round(180 - sub * 110); b = Math.round(33 - sub * 10); // Amber to Coral Red
        }
        dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = 190;
      } else if (activeLayer === 'composite') {
        // Multi-layer Composite: Clouds + Radar
        if (rainNorm > 0.05) {
          if (rainNorm < 0.3) {
            dst[i] = 52; dst[i + 1] = 211; dst[i + 2] = 153; dst[i + 3] = 200;
          } else if (rainNorm < 0.65) {
            dst[i] = 251; dst[i + 1] = 191; dst[i + 2] = 36; dst[i + 3] = 220;
          } else {
            dst[i] = 244; dst[i + 1] = 63; dst[i + 2] = 94; dst[i + 3] = 240;
          }
        } else if (cloudNorm > 0.08) {
          dst[i] = 245; dst[i + 1] = 250; dst[i + 2] = 255; dst[i + 3] = Math.round(cloudNorm * 180);
        } else {
          dst[i + 3] = 0;
        }
      }
    }

    oCtx.putImageData(imgData, 0, 0);

    // Blit overlay on top of satellite with user-selected opacity
    ctx.globalAlpha = overlayOpacity;
    ctx.drawImage(overlayCanvas, 0, 0, width, height);
    ctx.globalAlpha = 1.0;
  }, [currentSatImage, imageLoading, activeLayer, overlayOpacity, extractTexturePixels, radarCanvas]);

  useEffect(() => {
    if (isOpen) {
      drawMap();
    }
  }, [isOpen, drawMap]);

  // Download high-resolution PNG snapshot of the combined image
  const handleDownloadSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `kurdistan_satellite_${selectedDate}_${activeLayer}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const currentStation = useMemo(() => {
    return (
      weatherPayload.stations.find((s) => s.id === selectedStationId) ||
      weatherPayload.stations[0]
    );
  }, [weatherPayload, selectedStationId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl max-h-[96vh] flex flex-col bg-slate-950 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden">
        {/* Modal Top Header with Prominent Today Date */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-800 bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                  Live Satellite Imagery & Doppler Radar
                </h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {useHdBase ? 'KURDISTAN HD BASE' : selectedDate === yesterdayIso ? 'YESTERDAY PASS' : selectedDate === todayIso ? 'LIVE TODAY' : `ARCHIVE ${selectedDate}`}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300 font-mono mt-0.5">
                <span className="text-cyan-300 font-semibold flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                  Captured: {useHdBase ? 'Kurdistan HD Orthomosaic' : formatDisplayDate(selectedDate)}
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-400">NASA GIBS & RainViewer Middle East (Kurdistan)</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-download-satellite-map"
              onClick={handleDownloadSnapshot}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white transition-colors border border-slate-700 cursor-pointer"
              title="Download image snapshot with meteorological layers"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Export PNG</span>
            </button>

            <button
              id="btn-close-satellite-modal"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Close modal (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Date & Sensor Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 border-b border-slate-800/80 bg-slate-950/80 text-xs font-mono">
          {/* Satellite Source Switcher */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-400 text-[11px] font-bold">Orbit:</span>
            <button
              id="btn-sat-today"
              onClick={() => {
                setSelectedDate(todayIso);
                setUseHdBase(false);
                if (onSelectSatelliteDate) onSelectSatelliteDate(todayIso);
                if (onChangeSatelliteMode) onChangeSatelliteMode('nasa_today');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedDate === todayIso && !useHdBase
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              ⭐ Today ({todayIso.slice(5)})
            </button>

            <button
              id="btn-sat-yesterday"
              onClick={() => {
                setSelectedDate(yesterdayIso);
                setUseHdBase(false);
                if (onSelectSatelliteDate) onSelectSatelliteDate(yesterdayIso);
                if (onChangeSatelliteMode) onChangeSatelliteMode('nasa_yesterday');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedDate === yesterdayIso && !useHdBase
                  ? 'bg-indigo-500 text-white font-bold shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              Yesterday ({yesterdayIso.slice(5)})
            </button>

            <button
              id="btn-sat-hd-base"
              onClick={() => {
                setUseHdBase(true);
                if (onChangeSatelliteMode) onChangeSatelliteMode('hd_base');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                useHdBase
                  ? 'bg-slate-300 text-slate-950 font-bold shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
              }`}
            >
              🏔️ HD Base
            </button>

            {/* Historical Archive Pass Date Picker */}
            <select
              value={useHdBase ? 'hd_base' : useEumetsatLive ? 'live_eumetsat' : selectedDate}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'hd_base') {
                  setUseHdBase(true);
                  setUseEumetsatLive(false);
                  if (onChangeSatelliteMode) onChangeSatelliteMode('hd_base');
                } else if (val === 'live_eumetsat') {
                  setUseHdBase(false);
                  setUseEumetsatLive(true);
                  if (onChangeSatelliteMode) onChangeSatelliteMode('radar_live');
                } else {
                  setUseHdBase(false);
                  setUseEumetsatLive(false);
                  setSelectedDate(val);
                  if (onSelectSatelliteDate) onSelectSatelliteDate(val);
                  if (onChangeSatelliteMode) {
                    onChangeSatelliteMode(val === yesterdayIso ? 'nasa_yesterday' : 'nasa_today');
                  }
                }
              }}
              className="bg-slate-900 border border-slate-800 text-indigo-300 text-xs px-2 py-1 rounded-lg cursor-pointer focus:outline-none focus:border-indigo-500"
              title="Select the satellite source to render in 2D and 3D"
            >
              <option value="live_eumetsat">● LIVE — EUMETSAT Meteosat (clouds + rain)</option>
              <option value={todayIso}>Pass: Today ({todayIso})</option>
              <option value={yesterdayIso}>Pass: Yesterday ({yesterdayIso})</option>
              {LOCAL_NASA_HISTORY_DATES.map((d) => (
                <option key={d} value={d}>
                  Archive Pass: {d}
                </option>
              ))}
              <option value="hd_base">Kurdistan HD Orthomosaic Base</option>
            </select>

            {!useHdBase && !useEumetsatLive && (
              <select
                value={activeSensor || selectedSensor}
                onChange={(e) => {
                  setSelectedSensor(e.target.value);
                  if (onSelectSensor) onSelectSensor(e.target.value);
                }}
                className="bg-slate-900 border border-slate-800 text-cyan-300 text-xs px-2 py-1 rounded-lg cursor-pointer ml-1 focus:outline-none focus:border-cyan-500"
              >
                {NASA_SATELLITE_LAYERS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.agency})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Radar Frame Status */}
          {rainViewerMeta && rainViewerMeta.latestFrame && (
            <div className="flex items-center gap-1.5 text-emerald-400 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span>Radar Echo: {rainViewerMeta.latestFrame.formattedTime} AST</span>
            </div>
          )}
        </div>

        {/* Real-time Orbital Telemetry & Downlink Status Banner */}
        <div className="bg-gradient-to-r from-cyan-950/70 via-slate-900/90 to-blue-950/70 border-b border-cyan-800/40 px-4 py-2.5 sm:px-6 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-cyan-200 min-w-0">
            <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 font-mono font-bold text-[10px] tracking-wider flex items-center gap-1 shrink-0 border border-cyan-400/30">
              <Sparkles className="w-3 h-3 text-amber-300" />
              <span>ORBIT STATUS</span>
            </span>
            <div className="text-slate-300 text-xs truncate">
              {isTodayPending ? (
                <>
                  <span className="text-amber-300 font-bold">Today's orbit downlink in progress:</span>
                  <span className="text-slate-300 ml-1">
                    Kurdistan local time is early morning ({new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baghdad' })} AST). Polar satellites (VIIRS / MODIS) pass overhead ~10:30 AM & 1:30 PM AST. Currently displaying latest confirmed orbital pass with live Doppler radar.
                  </span>
                </>
              ) : (
                <>
                  <span className="text-emerald-300 font-bold">Active Satellite Orbit:</span>
                  <span className="text-slate-300 ml-1">
                    {orbitalStatusNote || 'NASA GIBS Earthdata active downlink feed'}. Full multi-spectral imagery calibrated across Northern Iraq & Kurdistan Region.
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
            <span className="bg-slate-800/90 px-2.5 py-1 rounded-lg border border-slate-700 text-cyan-300 shadow-inner">
              Pass: {actualPassDate}
            </span>
            <span className="bg-emerald-950/80 px-2.5 py-1 rounded-lg border border-emerald-700/50 text-emerald-300 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Radar Active
            </span>
          </div>
        </div>

        {/* Layer Selector Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 border-b border-slate-800/80 bg-slate-900/40">
          {/* Layer Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
            <button
              id="tab-layer-composite"
              onClick={() => setActiveLayer('composite')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeLayer === 'composite'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/25'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Composite</span>
            </button>

            <button
              id="tab-layer-radar"
              onClick={() => setActiveLayer('radar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeLayer === 'radar'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/25'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              <Droplets className="w-3.5 h-3.5" />
              <span>Rain Radar</span>
            </button>

            <button
              id="tab-layer-clouds"
              onClick={() => setActiveLayer('clouds')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeLayer === 'clouds'
                  ? 'bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/25'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>Cloud Deck</span>
            </button>

            <button
              id="tab-layer-temp"
              onClick={() => setActiveLayer('temperature')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeLayer === 'temperature'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/25'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              <Thermometer className="w-3.5 h-3.5" />
              <span>Temperature</span>
            </button>

            <button
              id="tab-layer-satellite"
              onClick={() => setActiveLayer('satellite')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeLayer === 'satellite'
                  ? 'bg-slate-200 text-slate-950 font-bold shadow-md'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>True-Color Sat</span>
            </button>
          </div>

          {/* Controls: Opacity Slider & Pins Toggle */}
          <div className="flex items-center gap-3 text-xs font-mono">
            {activeLayer !== 'satellite' && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-[11px]">Overlay Blend:</span>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                  className="w-20 sm:w-28 accent-cyan-400 cursor-pointer"
                  title="Adjust overlay opacity"
                />
                <span className="text-slate-300 text-[10px] w-8">
                  {Math.round(overlayOpacity * 100)}%
                </span>
              </div>
            )}

            <button
              id="btn-toggle-modal-pins"
              onClick={() => setShowPins(!showPins)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors border cursor-pointer ${
                showPins
                  ? 'bg-slate-800 text-cyan-300 border-slate-700'
                  : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Pins</span>
            </button>
          </div>
        </div>

        {/* Modal Main Body */}
        <div className="flex-1 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-0">
          {/* Left / Center: Interactive Image & Canvas Display (8 Cols) */}
          <div className="lg:col-span-8 p-3 sm:p-5 flex flex-col items-center justify-center bg-slate-950/60 relative">
            <div className="relative w-full max-w-[800px] aspect-[3/2] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-black">
              {/* Render Canvas */}
              <canvas
                ref={canvasRef}
                width={1024}
                height={683}
                className="w-full h-full object-cover select-none"
              />

              {/* Loading Indicator */}
              {imageLoading && (
                <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-cyan-300 font-mono text-xs z-30">
                  <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                  <span>Loading {useHdBase ? 'HD Basemap' : `NASA GIBS pass for ${selectedDate}`}...</span>
                </div>
              )}

              {/* Landmark Pins Overlaid on 2D Satellite Canvas */}
              {showPins && !imageLoading && (
                <div className="absolute inset-0 pointer-events-none">
                  {KURDISTAN_LANDMARKS.map((lm) => {
                    const st = weatherPayload.stations.find((s) => s.id === lm.id);
                    const lon = st ? st.lon : 44.01;
                    const lat = st ? st.lat : 36.19;

                    const u = (lon - MIN_LON) / (MAX_LON - MIN_LON);
                    const v = (MAX_LAT - lat) / (MAX_LAT - MIN_LAT);

                    const leftPct = Math.max(2, Math.min(96, u * 100));
                    const topPct = Math.max(2, Math.min(94, v * 100));

                    const isSelected = selectedStationId === lm.id;

                    return (
                      <div
                        key={lm.id}
                        style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                      >
                        <button
                          id={`pin-satellite-map-${lm.id}`}
                          onClick={() => {
                            setSelectedStationId(lm.id);
                          }}
                          onMouseEnter={() => setHoveredStationId(lm.id)}
                          onMouseLeave={() => setHoveredStationId(null)}
                          className={`group flex items-center gap-1 px-1.5 py-0.5 rounded-lg border backdrop-blur-md shadow-lg transition-all duration-200 cursor-pointer ${
                            isSelected
                              ? 'bg-cyan-500 text-slate-950 border-white scale-110 z-20 ring-2 ring-cyan-400/50'
                              : 'bg-slate-950/85 text-slate-200 border-slate-700/80 hover:bg-slate-900 hover:scale-105 hover:border-cyan-400 z-10'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-slate-950' : 'bg-cyan-400 animate-pulse'}`} />
                          <span className="text-[10px] font-mono font-bold whitespace-nowrap">
                            {lm.name.split(' ')[0]}
                          </span>
                          {st && (
                            <span className={`text-[9px] font-mono font-bold px-1 rounded ${isSelected ? 'bg-slate-950 text-cyan-300' : 'text-slate-300'}`}>
                              {st.temperature}°
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Layer Legend Overlay at Bottom-Right of the Map */}
              <div className="absolute bottom-2.5 right-2.5 z-20 pointer-events-auto bg-slate-950/90 backdrop-blur-xl border border-slate-800/80 rounded-xl px-2.5 py-1.5 text-[10px] font-mono shadow-xl flex items-center gap-2 text-slate-300">
                {activeLayer === 'radar' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Rain Echo:</span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2 rounded bg-emerald-500" />
                      <span>Light</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2 rounded bg-amber-400" />
                      <span>Mod</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2 rounded bg-rose-500" />
                      <span>Heavy</span>
                    </span>
                  </div>
                )}
                {activeLayer === 'temperature' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Temp:</span>
                    <span className="text-cyan-300">14°C</span>
                    <div className="w-16 h-2 rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 via-amber-400 to-rose-500" />
                    <span className="text-rose-400">34°C+</span>
                  </div>
                )}
                {activeLayer === 'clouds' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Cloud Deck:</span>
                    <span className="text-slate-500">0%</span>
                    <div className="w-14 h-2 rounded-full bg-gradient-to-r from-slate-800 to-white" />
                    <span className="text-white">100%</span>
                  </div>
                )}
                {activeLayer === 'composite' && (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-slate-200">
                      <span className="w-2 h-2 rounded-full bg-white opacity-80" /> Clouds
                    </span>
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" /> Radar
                    </span>
                  </div>
                )}
                {activeLayer === 'satellite' && (
                  <span className="text-cyan-300">NASA True-Color {selectedDate}</span>
                )}
              </div>
            </div>

            {/* Geographical Bounds Bar */}
            <div className="mt-2.5 w-full max-w-[800px] flex items-center justify-between text-[11px] font-mono text-slate-400 px-1">
              <span>Domain: 240 × 160 km Northern Iraq & Kurdistan</span>
              <span>40.78°E – 47.81°E • 33.14°N – 37.72°N</span>
            </div>
          </div>

          {/* Right: Meteorological Station Telemetry & Details (4 Cols) */}
          <div className="lg:col-span-4 p-4 sm:p-5 border-t lg:border-t-0 lg:border-l border-slate-800/80 bg-slate-900/30 flex flex-col justify-between overflow-y-auto max-h-[500px] lg:max-h-none">
            <div>
              {/* Station Card Header */}
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-800">
                <div>
                  <div className="text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider">
                    Station Telemetry • Today
                  </div>
                  <h3 className="text-base font-bold text-white flex items-center gap-1.5 mt-0.5">
                    <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>{currentStation.name}</span>
                  </h3>
                  <div className="text-xs text-slate-400 capitalize mt-0.5">
                    {currentStation.condition.replace('_', ' ')} • Elev {currentStation.elevation} m
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-3xl font-black text-white font-mono">
                    {currentStation.temperature}°
                  </div>
                  <div className="text-xs text-slate-400 font-mono">Celsius</div>
                </div>
              </div>

              {/* Station Telemetry 6-Grid */}
              <div className="grid grid-cols-2 gap-2 my-3 text-xs font-mono">
                {/* Rain / Radar */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[10px] uppercase">
                    <Droplets className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Radar Precip</span>
                  </div>
                  <div className="text-sm font-bold text-white mt-1">
                    {currentStation.precipitation.toFixed(1)} mm/h
                  </div>
                </div>

                {/* Cloud Cover */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[10px] uppercase">
                    <Cloud className="w-3.5 h-3.5 text-sky-400" />
                    <span>Cloud Cover</span>
                  </div>
                  <div className="text-sm font-bold text-white mt-1">
                    {currentStation.cloudCover}%
                  </div>
                </div>

                {/* Wind Vector */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[10px] uppercase">
                    <Wind className="w-3.5 h-3.5 text-teal-400" />
                    <span>Surface Wind</span>
                  </div>
                  <div className="text-sm font-bold text-white mt-1">
                    {currentStation.windSpeed} km/h • {currentStation.windDirection}°
                  </div>
                </div>

                {/* Relative Humidity */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[10px] uppercase">
                    <Droplets className="w-3.5 h-3.5 text-blue-400" />
                    <span>Humidity</span>
                  </div>
                  <div className="text-sm font-bold text-white mt-1">
                    {currentStation.relativeHumidity}%
                  </div>
                </div>

                {/* Barometric Pressure */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[10px] uppercase">
                    <Mountain className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Atm Pressure</span>
                  </div>
                  <div className="text-sm font-bold text-white mt-1">
                    {currentStation.surfacePressure} hPa
                  </div>
                </div>

                {/* Station Observation Date & Time */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-slate-400 text-[10px] uppercase">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Captured Time</span>
                  </div>
                  <div className="text-sm font-bold text-white mt-1">
                    {currentStation.time} AST
                  </div>
                </div>
              </div>

              {/* Station Quick Selector Dropdown / Pills */}
              <div className="mt-2">
                <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1.5">
                  Switch Station Focus
                </div>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {weatherPayload.stations.map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setSelectedStationId(st.id)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-colors cursor-pointer ${
                        selectedStationId === st.id
                          ? 'bg-cyan-500 text-slate-950 font-bold'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                      }`}
                    >
                      {st.name.split(' ')[0]} ({st.temperature}°)
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Actions: Fly to 3D Landmark */}
            <div className="pt-3 mt-3 border-t border-slate-800">
              {onFlyToLandmark && (
                <button
                  id="btn-modal-fly-to-landmark"
                  onClick={() => {
                    const lm = KURDISTAN_LANDMARKS.find((l) => l.id === selectedStationId);
                    if (lm) {
                      onFlyToLandmark(lm);
                      onClose();
                    }
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold font-mono tracking-wider uppercase transition-all shadow-lg shadow-cyan-600/25 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Fly 3D Camera to {currentStation.name.split(' ')[0]}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
