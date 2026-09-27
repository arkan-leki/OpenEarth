import React from 'react';
import { Eye, EyeOff, Play, Pause, Compass, Radio, Wind, Thermometer, Cloud } from 'lucide-react';
import { SystemStats, WeatherCondition } from '../types';
import { SulaymaniyahWeatherPayload } from '../services/weatherService';

interface HUDOverlayProps {
  stats: SystemStats;
  showPins: boolean;
  onTogglePins: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  onResetCamera: () => void;
  weatherPayload?: SulaymaniyahWeatherPayload | null;
  selectedChunkLabel?: string;
  selectedCondition?: WeatherCondition;
  selectedTemp?: number;
  selectedElev?: number;
}

export const HUDOverlay: React.FC<HUDOverlayProps> = ({
  stats,
  showPins,
  onTogglePins,
  autoRotate,
  onToggleAutoRotate,
  onResetCamera,
  weatherPayload,
  selectedChunkLabel = 'D2 (Kalar)',
  selectedCondition = 'clear',
  selectedTemp = 36,
  selectedElev = 219
}) => {
  const suliStation = weatherPayload?.stations.find(s => s.id === 'suli') || weatherPayload?.stations[0];

  return (
    <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-3 sm:p-5 select-none">
      {/* Top Bar HUD */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        {/* Viewport Action Pills (Interactive) */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={onTogglePins}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium backdrop-blur-md border transition-all ${
              showPins
                ? 'bg-slate-900/80 text-sky-400 border-sky-500/40 shadow-sm'
                : 'bg-slate-900/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
            }`}
            title="Toggle Landmark Markers"
          >
            {showPins ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>Landmarks</span>
          </button>

          <button
            onClick={onToggleAutoRotate}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium backdrop-blur-md border transition-all ${
              autoRotate
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                : 'bg-slate-900/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
            }`}
            title="Toggle Cinematic Orbit"
          >
            {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>Orbit</span>
          </button>

          <button
            onClick={onResetCamera}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-900/60 text-slate-400 border border-slate-700/60 hover:text-slate-200 hover:bg-slate-800/80 backdrop-blur-md transition-all"
            title="Reset Perspective"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>

        {/* Top-Right Telemetry Badge */}
        <div className="bg-black/80 backdrop-blur-md border border-slate-800 px-3.5 py-1.5 rounded-lg text-right font-mono text-[11px] text-slate-300 shadow-xl flex items-center gap-3">
          <div>
            <span className="text-slate-500">FPS: </span>
            <span className="text-emerald-400 font-bold">{stats.fps}</span>
          </div>
          <div className="h-3 w-px bg-slate-700" />
          <div>
            <span className="text-slate-500">TERRAIN: </span>
            <span className="text-sky-400 font-semibold">NASA SRTM DEM + SATELLITE</span>
          </div>
          <div className="h-3 w-px bg-slate-700" />
          <div>
            <span className="text-slate-500">RAYMARCH: </span>
            <span className="text-amber-400 font-semibold">{stats.samples} SAMPLES</span>
          </div>
        </div>
      </div>

      {/* Middle Flow Annotation Banner (Matching Screenshot Architecture) */}
      <div className="hidden xl:flex justify-end my-auto pr-2">
        <div className="bg-black/85 backdrop-blur-md border border-slate-700/80 rounded-lg px-4 py-2 text-xs font-mono text-slate-300 shadow-2xl flex items-center gap-3">
          <div className="flex items-center gap-1 text-sky-300 font-medium">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>OPEN-METEO LIVE</span>
          </div>
          <span className="text-slate-500 text-[10px]">(Sulaymaniyah & Kalar Stations)</span>
          <span className="text-slate-400 font-bold">➔</span>
          <span className="text-amber-300 font-medium">REAL 3D DEM GROUND</span>
          <span className="text-slate-400 font-bold">➔</span>
          <span className="text-emerald-300 font-medium">VOLUMETRIC SKY SHADER</span>
        </div>
      </div>

      {/* Bottom Row HUD */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        {/* Bottom-Left Region Badge */}
        <div className="bg-black/85 backdrop-blur-md border border-slate-700/80 rounded-xl px-4 sm:px-5 py-3 shadow-2xl max-w-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
              SULAYMANIYAH
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              REAL GROUND
            </span>
          </div>
          <div className="text-xs sm:text-sm text-slate-400 font-medium mt-0.5">
            Sulaymaniyah Governorate, Iraq • HD Satellite Draped
          </div>

          {/* Meteorological Telemetry Row */}
          <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center gap-3 text-xs font-mono text-slate-300">
            <div className="flex items-center gap-1 text-amber-300">
              <Thermometer className="w-3.5 h-3.5" />
              <span>{selectedTemp}°C</span>
            </div>
            <div className="flex items-center gap-1 text-sky-300">
              <Cloud className="w-3.5 h-3.5" />
              <span className="capitalize">{selectedCondition.replace('_', ' ')}</span>
            </div>
            <div className="flex items-center gap-1 text-emerald-300">
              <span>Elev: {selectedElev}m</span>
            </div>
          </div>
        </div>

        {/* Bottom-Right Engine Badge */}
        <div className="bg-black/85 backdrop-blur-md border border-slate-700/80 rounded-lg px-4 py-2.5 text-right shadow-2xl">
          <div className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center justify-end gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-400"></span>
            <span>THREE.JS / REACT FIBER</span>
          </div>
          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
            Active Chunks: {stats.activeChunksCount}/36 • 48km Domain
          </div>
        </div>
      </div>
    </div>
  );
};

