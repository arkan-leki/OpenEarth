import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import {
  Cloud,
  Droplets,
  Thermometer,
  Layers,
  Download,
  Maximize2,
  Minimize2,
  MapPin,
  RefreshCw,
  Info,
  Radio,
  Sparkles,
  ExternalLink,
  Image as ImageIcon
} from 'lucide-react';
import { WeatherMode, Landmark } from '../types';
import { SulaymaniyahWeatherPayload } from '../services/weatherService';
import { LANDMARKS } from './LandmarkPins';
import { NASA_HISTORY_DAYS, subscribeToNasaTextureUpdates } from '../services/nasaHistoryService';

export type TextureChannelView = 'clouds' | 'rain' | 'temp' | 'composite' | 'satellite_overlay' | 'true_color';

interface RenderedWeatherImageViewerProps {
  weatherTexture: THREE.Texture;
  weatherMode: WeatherMode;
  selectedHistoryDate: string;
  onSelectHistoryDate?: (date: string) => void;
  currentHourOffset: number;
  weatherPayload?: SulaymaniyahWeatherPayload | null;
  liveCloudSource?: 'openmeteo' | 'nasa';
  onChangeLiveCloudSource?: (source: 'openmeteo' | 'nasa') => void;
}

export const RenderedWeatherImageViewer: React.FC<RenderedWeatherImageViewerProps> = ({
  weatherTexture,
  weatherMode,
  selectedHistoryDate,
  onSelectHistoryDate,
  currentHourOffset,
  weatherPayload,
  liveCloudSource = 'openmeteo',
  onChangeLiveCloudSource
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeChannel, setActiveChannel] = useState<TextureChannelView>('clouds');
  const [showLandmarkOverlay, setShowLandmarkOverlay] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [satelliteBgImage, setSatelliteBgImage] = useState<HTMLImageElement | null>(null);
  const [statsSummary, setStatsSummary] = useState({
    avgCloudPct: 0,
    maxRainMm: 0,
    avgTempC: 32,
    resolution: '1024 × 1024 px'
  });

  // Subscription to texture updates to trigger canvas redraw when async textures decode
  const [textureRevision, setTextureRevision] = useState(0);
  useEffect(() => {
    return subscribeToNasaTextureUpdates(() => {
      setTextureRevision((r) => r + 1);
    });
  }, []);

  // Load satellite basemap for satellite overlay & true-color mode (updates with selectedHistoryDate in history mode)
  useEffect(() => {
    const targetSrc =
      weatherMode === 'history'
        ? `/tiles/nasa_history/${selectedHistoryDate}.jpg`
        : '/tiles/north_iraq_hd_satellite.jpg';

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = targetSrc;
    img.onload = () => {
      setSatelliteBgImage(img);
      setTextureRevision((r) => r + 1);
    };
  }, [weatherMode, selectedHistoryDate]);

  // Extract pixel buffer from THREE.Texture (handles DataTexture, CanvasTexture, and ImageTexture)
  const extractTexturePixels = useCallback((): { pixels: Uint8ClampedArray; width: number; height: number } | null => {
    if (!weatherTexture) return null;

    // Case 1: DataTexture with direct rawData
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

    // Case 2: CanvasTexture or Image
    if (weatherTexture.image) {
      const src = weatherTexture.image as (CanvasImageSource & { width?: number; height?: number });
      const w = src.width || 512;
      const h = src.height || 512;
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      return {
        pixels: imgData.data,
        width: w,
        height: h
      };
    }

    return null;
  }, [weatherTexture]);

  // Render the selected channel to the display canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const texData = extractTexturePixels();
    if (!texData) return;

    const { pixels, width, height } = texData;
    canvas.width = width;
    canvas.height = height;

    const outImgData = ctx.createImageData(width, height);
    const out = outImgData.data;

    let totalCloud = 0;
    let maxRainRaw = 0;
    let totalTemp = 0;
    const numPixels = width * height;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i + 0]; // Cloud Density (0..255)
      const g = pixels[i + 1]; // Rain Intensity (0..255)
      const b = pixels[i + 2]; // Temp encoded (0..255)

      totalCloud += r;
      if (g > maxRainRaw) maxRainRaw = g;
      totalTemp += b;

      if (activeChannel === 'clouds') {
        // Red channel: Pure Grayscale Cloud Density Mask
        out[i + 0] = r;
        out[i + 1] = r;
        out[i + 2] = r;
        out[i + 3] = 255;
      } else if (activeChannel === 'rain') {
        // Green channel: Precipitation Radar Heatmap
        if (g < 4) {
          out[i + 0] = 13;
          out[i + 1] = 17;
          out[i + 2] = 23;
          out[i + 3] = 255;
        } else {
          const normG = g / 255.0;
          if (normG < 0.3) {
            // Light rain: Cyan / Blue
            out[i + 0] = Math.round(normG * 3.3 * 50);
            out[i + 1] = Math.round(180 + normG * 200);
            out[i + 2] = 255;
          } else if (normG < 0.7) {
            // Moderate rain: Green / Yellow
            out[i + 0] = Math.round((normG - 0.3) * 2.5 * 255);
            out[i + 1] = 255;
            out[i + 2] = 50;
          } else {
            // Heavy convective downpour: Orange / Red / Magenta
            out[i + 0] = 255;
            out[i + 1] = Math.round((1.0 - normG) * 3.0 * 200);
            out[i + 2] = Math.round((normG - 0.7) * 3.0 * 255);
          }
          out[i + 3] = 255;
        }
      } else if (activeChannel === 'temp') {
        // Blue channel: Surface Temperature Heatmap
        const tempC = (b / 255.0) * 47.0 - 5.0;
        // Map 10C to 40C
        const normT = Math.min(1.0, Math.max(0.0, (tempC - 10.0) / 30.0));
        out[i + 0] = Math.round(normT * 255);
        out[i + 1] = Math.round(Math.sin(normT * Math.PI) * 220);
        out[i + 2] = Math.round((1.0 - normT) * 255);
        out[i + 3] = 255;
      } else if (activeChannel === 'composite') {
        // Raw RGBA composite as fed to shader
        out[i + 0] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
      } else if (activeChannel === 'satellite_overlay') {
        // Placeholder for satellite overlay (will blend below)
        out[i + 0] = r;
        out[i + 1] = r;
        out[i + 2] = r;
        out[i + 3] = r;
      }
    }

    if (activeChannel === 'true_color') {
      // Direct raw NASA / HD satellite photograph
      if (satelliteBgImage) {
        ctx.drawImage(satelliteBgImage, 0, 0, width, height);
      } else {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#38bdf8';
        ctx.font = '13px monospace';
        ctx.fillText('Loading Satellite Imagery...', 20, 40);
      }
    } else if (activeChannel === 'satellite_overlay' && satelliteBgImage) {
      // Draw satellite terrain basemap first
      ctx.drawImage(satelliteBgImage, 0, 0, width, height);

      // Create semi-transparent white cloud layer
      const cloudCanvas = document.createElement('canvas');
      cloudCanvas.width = width;
      cloudCanvas.height = height;
      const cCtx = cloudCanvas.getContext('2d')!;
      cCtx.putImageData(outImgData, 0, 0);

      // Blend clouds over terrain with soft screen blend
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.88;
      ctx.drawImage(cloudCanvas, 0, 0);
      ctx.restore();
    } else {
      ctx.putImageData(outImgData, 0, 0);
    }

    // Draw regional landmark dots directly on the rendered image
    if (showLandmarkOverlay) {
      ctx.save();
      LANDMARKS.forEach((lm) => {
        // Domain is [-90000, 90000] in X, [-72000, 72000] in Z
        const u = (lm.position[0] + 90000.0) / 180000.0;
        const v = (lm.position[2] + 72000.0) / 144000.0;
        const px = u * width;
        const py = v * height;

        if (px >= 0 && px <= width && py >= 0 && py <= height) {
          // Pin outer halo
          ctx.beginPath();
          ctx.arc(px, py, width > 512 ? 8 : 5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(6, 182, 212, 0.45)';
          ctx.fill();

          // Pin center dot
          ctx.beginPath();
          ctx.arc(px, py, width > 512 ? 4 : 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          // Label
          ctx.font = width > 512 ? 'bold 16px monospace' : 'bold 10px monospace';
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#000000';
          ctx.shadowBlur = 4;
          ctx.fillText(lm.name, px + (width > 512 ? 10 : 7), py + 4);
        }
      });
      ctx.restore();
    }

    // Compute diagnostic metrics
    const avgCloud = Math.round((totalCloud / (numPixels * 255)) * 1000) / 10;
    const maxRainMm = Math.round((maxRainRaw / 255.0) * 8.0 * 10) / 10;
    const avgTempC = Math.round((((totalTemp / numPixels) / 255.0) * 47.0 - 5.0) * 10) / 10;

    setStatsSummary({
      avgCloudPct: avgCloud,
      maxRainMm,
      avgTempC,
      resolution: `${width} × ${height} px`
    });
  }, [extractTexturePixels, activeChannel, showLandmarkOverlay, satelliteBgImage, textureRevision]);

  // Export current canvas image to PNG
  const handleDownloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `rendered_weather_texture_${weatherMode}_${activeChannel}.png`;
    a.click();
  };

  return (
    <div className="p-3 sm:p-4 bg-[#0D1117] border-b border-[#30363D] select-none text-slate-100">
      {/* Header with Title and Mode Indicator */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                RENDERED WEATHER IMAGE
              </h3>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold">
                ACTIVE GPU TEXTURE
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              The exact multi-channel image mapped to terrain & volumetric sky
            </p>
          </div>
        </div>

        {/* Quick Download & Fullscreen Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleDownloadImage}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            title="Download rendered texture as PNG"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            title="Inspect in full resolution modal"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live Mode Source Selector (Open-Meteo Synoptic Grid vs NASA Satellite Pass) */}
      {weatherMode === 'live' && onChangeLiveCloudSource && (
        <div className="mb-3 p-2 bg-[#161B22] rounded-xl border border-[#30363D]">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5">
            <span>LIVE CLOUD SOURCE:</span>
            <span className="text-cyan-400 font-bold uppercase">{liveCloudSource}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => onChangeLiveCloudSource('openmeteo')}
              className={`px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all text-center ${
                liveCloudSource === 'openmeteo'
                  ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 shadow-sm'
                  : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              📡 Open-Meteo Synoptic
            </button>
            <button
              onClick={() => onChangeLiveCloudSource('nasa')}
              className={`px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold transition-all text-center ${
                liveCloudSource === 'nasa'
                  ? 'bg-sky-500/25 text-sky-300 border border-sky-500/50 shadow-sm'
                  : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              🛰️ NASA Satellite Pass
            </button>
          </div>
        </div>
      )}

      {/* History Mode Day Selector for Quick Verification */}
      {weatherMode === 'history' && onSelectHistoryDate && (
        <div className="mb-3 p-2 bg-[#161B22] rounded-xl border border-[#30363D]">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1.5">
            <span>HISTORICAL NASA PASS:</span>
            <span className="text-sky-300 font-bold">{selectedHistoryDate}</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {NASA_HISTORY_DAYS.map((d) => (
              <button
                key={d.date}
                onClick={() => onSelectHistoryDate(d.date)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 ${
                  selectedHistoryDate === d.date
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/30'
                    : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title={`${d.label} • ${d.cloudGenus}`}
              >
                <span>{d.cloudEmoji}</span>
                <span>{d.date.slice(5)}</span>
                <span className="opacity-75">({d.cloudCoveragePct}%)</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[9px] font-mono text-cyan-300">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Direct NASA Satellite Cloud Recognition
            </span>
            <span className="text-slate-400 font-normal">Only rendered as 3D clouds</span>
          </div>
        </div>
      )}

      {/* Channel Inspection Tabs (Cloud, Rain, Temp, Composite, Satellite Overlay) */}
      <div className="flex items-center gap-1 mb-2 bg-[#161B22] p-1 rounded-xl border border-[#30363D] overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveChannel('clouds')}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all shrink-0 ${
            activeChannel === 'clouds'
              ? 'bg-slate-700 text-white shadow'
              : 'text-slate-400 hover:text-white'
          }`}
          title="Inspect the Red channel: Cloud Density Mask (0 to 100% white)"
        >
          <Cloud className="w-3 h-3 text-sky-300" />
          <span>Clouds (R)</span>
        </button>

        <button
          onClick={() => setActiveChannel('rain')}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all shrink-0 ${
            activeChannel === 'rain'
              ? 'bg-slate-700 text-cyan-300 shadow'
              : 'text-slate-400 hover:text-white'
          }`}
          title="Inspect the Green channel: Rain Radar Heatmap (mm/h)"
        >
          <Droplets className="w-3 h-3 text-cyan-400" />
          <span>Rain (G)</span>
        </button>

        <button
          onClick={() => setActiveChannel('temp')}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all shrink-0 ${
            activeChannel === 'temp'
              ? 'bg-slate-700 text-amber-300 shadow'
              : 'text-slate-400 hover:text-white'
          }`}
          title="Inspect the Blue channel: Surface Temperature Gradient"
        >
          <Thermometer className="w-3 h-3 text-amber-400" />
          <span>Temp (B)</span>
        </button>

        <button
          onClick={() => setActiveChannel('composite')}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all shrink-0 ${
            activeChannel === 'composite'
              ? 'bg-slate-700 text-purple-300 shadow'
              : 'text-slate-400 hover:text-white'
          }`}
          title="Inspect the Raw Multi-channel RGBA Texture as decoded by WebGL shaders"
        >
          <Layers className="w-3 h-3 text-purple-400" />
          <span>RGBA</span>
        </button>

        <button
          onClick={() => setActiveChannel('satellite_overlay')}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all shrink-0 ${
            activeChannel === 'satellite_overlay'
              ? 'bg-slate-700 text-emerald-300 shadow'
              : 'text-slate-400 hover:text-white'
          }`}
          title="Blend the rendered clouds directly over the real satellite map of Northern Iraq"
        >
          <Sparkles className="w-3 h-3 text-emerald-400" />
          <span>Satellite Blend</span>
        </button>

        <button
          onClick={() => setActiveChannel('true_color')}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all shrink-0 ${
            activeChannel === 'true_color'
              ? 'bg-amber-600 text-white shadow'
              : 'text-slate-400 hover:text-white'
          }`}
          title="Direct True Color satellite photograph of Northern Iraq for this day"
        >
          <ImageIcon className="w-3 h-3 text-amber-300" />
          <span>Sat Photo (RGB)</span>
        </button>
      </div>

      {/* Rendered Canvas Texture Display Container */}
      <div className="relative aspect-square w-full rounded-xl overflow-hidden border border-[#30363D] bg-black shadow-inner group">
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain cursor-zoom-in"
          onClick={() => setIsModalOpen(true)}
        />

        {/* Channel Indicator Badge */}
        <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-black/75 backdrop-blur-md border border-slate-700/80 text-[10px] font-mono font-bold text-white flex items-center gap-1.5 pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span>
            {activeChannel === 'clouds' && 'CLOUD DENSITY MASK (R)'}
            {activeChannel === 'rain' && 'PRECIPITATION RADAR (G)'}
            {activeChannel === 'temp' && 'THERMAL DISTRIBUTION (B)'}
            {activeChannel === 'composite' && 'RAW MULTI-CHANNEL RGBA'}
            {activeChannel === 'satellite_overlay' && 'SATELLITE + CLOUDS COMPOSITE'}
            {activeChannel === 'true_color' && 'NASA TRUE-COLOR SATELLITE PHOTO'}
          </span>
        </div>

        {/* Toggle Landmark Pins Overlay */}
        <button
          onClick={() => setShowLandmarkOverlay(!showLandmarkOverlay)}
          className={`absolute top-2 right-2 px-2 py-1 rounded-md text-[10px] font-mono border backdrop-blur-md transition-all ${
            showLandmarkOverlay
              ? 'bg-cyan-500/30 text-cyan-200 border-cyan-500/50'
              : 'bg-black/70 text-slate-400 border-slate-700 hover:text-white'
          }`}
          title="Toggle Regional Landmark Pins"
        >
          <MapPin className="w-3 h-3 inline mr-1" />
          <span>{showLandmarkOverlay ? 'Pins ON' : 'Pins OFF'}</span>
        </button>

        {/* Bottom Hover Hint */}
        <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded bg-black/70 backdrop-blur-md border border-slate-800 text-[9px] font-mono text-slate-400 flex items-center justify-between opacity-80 group-hover:opacity-100 transition-opacity">
          <span>{statsSummary.resolution}</span>
          <span className="text-cyan-300">Click to expand</span>
        </div>
      </div>

      {/* Telemetry & Image Diagnostics Grid */}
      <div className="grid grid-cols-3 gap-1.5 mt-2 text-[10px] font-mono">
        <div className="p-1.5 bg-[#161B22] rounded-lg border border-[#30363D]">
          <div className="text-[9px] text-slate-400 uppercase">Avg Cloud Cover</div>
          <div className="text-slate-100 font-bold text-xs">{statsSummary.avgCloudPct}%</div>
        </div>
        <div className="p-1.5 bg-[#161B22] rounded-lg border border-[#30363D]">
          <div className="text-[9px] text-slate-400 uppercase">Max Rain</div>
          <div className="text-cyan-300 font-bold text-xs">
            {statsSummary.maxRainMm > 0 ? `${statsSummary.maxRainMm} mm/h` : '0.0 mm/h'}
          </div>
        </div>
        <div className="p-1.5 bg-[#161B22] rounded-lg border border-[#30363D]">
          <div className="text-[9px] text-slate-400 uppercase">Avg Temp</div>
          <div className="text-amber-300 font-bold text-xs">{statsSummary.avgTempC}°C</div>
        </div>
      </div>

      {/* Explanatory Data Source Note */}
      <div className="mt-2.5 p-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[10px] font-mono text-slate-300 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          {weatherMode === 'live' && liveCloudSource === 'openmeteo' && (
            <span>
              <strong>Open-Meteo Synoptic Grid:</strong> Real-time observational telemetry from 10 stations across Northern Iraq interpolated across 180×144 km domain.
            </span>
          )}
          {weatherMode === 'live' && liveCloudSource === 'nasa' && (
            <span>
              <strong>NASA Orbital Pass:</strong> Real daily satellite cloud mask captured from MODIS Terra/Aqua satellite for the Kurdistan basin.
            </span>
          )}
          {weatherMode === 'history' && (
            <span>
              <strong>NASA Satellite Cloud Recognition:</strong> Clouds are algorithmically recognized from the raw NASA true-color satellite photograph for {selectedHistoryDate} (spectral whiteness & luminance contrast). The recognized clouds are used exclusively to render 3D atmospheric cloud volumes; ground terrain remains clean, high-definition satellite topography.
            </span>
          )}
          {weatherMode === 'forecast' && (
            <span>
              <strong>72-Hour Numerical Model:</strong> Synoptic progression at offset +{currentHourOffset}h.
            </span>
          )}
        </div>
      </div>

      {/* Fullscreen High-Resolution Inspection Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-4 sm:p-6"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="relative w-full max-w-2xl bg-[#0D1117] border border-[#30363D] rounded-2xl p-4 shadow-2xl flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#30363D] pb-3">
              <div>
                <h4 className="text-sm font-bold text-white font-mono uppercase tracking-wide">
                  FULL RESOLUTION WEATHER TEXTURE INSPECTOR
                </h4>
                <p className="text-xs text-slate-400 font-mono">
                  {statsSummary.resolution} • Mode: {weatherMode.toUpperCase()} • Channel: {activeChannel.toUpperCase()}
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>

            <div className="relative aspect-square w-full rounded-xl overflow-hidden border border-slate-700 bg-black flex items-center justify-center">
              <img
                src={canvasRef.current?.toDataURL('image/png')}
                alt="Rendered Weather Texture"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="text-xs font-mono text-slate-400">
                Cloud: <span className="text-white font-bold">{statsSummary.avgCloudPct}%</span> · Rain:{' '}
                <span className="text-cyan-300 font-bold">{statsSummary.maxRainMm} mm/h</span> · Temp:{' '}
                <span className="text-amber-300 font-bold">{statsSummary.avgTempC}°C</span>
              </div>
              <button
                onClick={handleDownloadImage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold font-mono text-xs transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Export PNG</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
