import React from 'react';
import { Cloud, Lock, RotateCw, ArrowLeft, Layers, Radio, Sparkles, Satellite } from 'lucide-react';
import { WeatherMode } from '../types';

export type FlyToTarget = 'overview' | 'erbil' | 'halgurd' | 'suli' | 'duhok' | 'zakho' | 'sinjar' | 'lakes';

interface BrowserTopBarProps {
  onFlyTo: (target: FlyToTarget) => void;
  wireframe: boolean;
  onToggleWireframe: () => void;
  onResetView: () => void;
  weatherMode: WeatherMode;
  onSelectWeatherMode: (mode: WeatherMode) => void;
  satelliteLayer: 'nasa' | 'hd';
  onToggleSatelliteLayer: () => void;
  isWeatherLoading?: boolean;
}

export const BrowserTopBar: React.FC<BrowserTopBarProps> = ({
  onFlyTo,
  wireframe,
  onToggleWireframe,
  onResetView,
  weatherMode,
  onSelectWeatherMode,
  satelliteLayer,
  onToggleSatelliteLayer,
  isWeatherLoading = false
}) => {
  return (
    <header className="w-full bg-[#161B22] border-b border-[#30363D] text-slate-200 select-none z-30">
      {/* Top Window Bar with Tab & Region Quick Jumps */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1.5 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {/* Window dots */}
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/50 inline-block shadow-sm"></span>
            <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/50 inline-block shadow-sm"></span>
            <span className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/50 inline-block shadow-sm"></span>
          </div>

          {/* Active Browser Tab */}
          <div className="flex items-center gap-2 px-3 py-1 bg-[#0D1117] rounded-t-md border-t border-x border-[#30363D] text-xs font-medium text-slate-300 shadow-sm">
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-slate-100">Northern Iraq & Borders</span>
            <span className="text-[10px] text-cyan-300 font-mono px-1 rounded bg-cyan-950/60 border border-cyan-800/40">3D Real DEM</span>
          </div>
        </div>

        {/* Quick Camera Jump Presets across Northern Iraq & Borders */}
        <div className="flex items-center gap-1 text-xs text-slate-400 overflow-x-auto py-0.5 max-w-full">
          <span className="text-[10px] font-mono text-slate-500 mr-1 hidden md:inline">FLY TO:</span>
          <button
            onClick={() => onFlyTo('overview')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-cyan-300 border border-slate-700/60 transition-colors whitespace-nowrap text-[11px]"
          >
            All North Iraq
          </button>
          <button
            onClick={() => onFlyTo('erbil')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-amber-300 border border-slate-700/60 transition-colors whitespace-nowrap text-[11px]"
          >
            Erbil Citadel
          </button>
          <button
            onClick={() => onFlyTo('halgurd')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-purple-300 border border-slate-700/60 transition-colors whitespace-nowrap text-[11px]"
          >
            Mt. Halgurd (3,607m)
          </button>
          <button
            onClick={() => onFlyTo('suli')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-emerald-300 border border-slate-700/60 transition-colors whitespace-nowrap text-[11px]"
          >
            Sulaymaniyah
          </button>
          <button
            onClick={() => onFlyTo('duhok')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-sky-300 border border-slate-700/60 transition-colors whitespace-nowrap text-[11px]"
          >
            Duhok & Mosul
          </button>
          <button
            onClick={() => onFlyTo('zakho')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-rose-300 border border-slate-700/60 transition-colors whitespace-nowrap text-[11px]"
          >
            Zakho (Turkey)
          </button>
          <button
            onClick={() => onFlyTo('sinjar')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-orange-300 border border-slate-700/60 transition-colors whitespace-nowrap text-[11px]"
          >
            Sinjar (Syria)
          </button>
          <button
            onClick={() => onFlyTo('lakes')}
            className="px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-teal-300 border border-slate-700/60 transition-colors whitespace-nowrap text-[11px]"
          >
            Dukan & Darbandikhan
          </button>
        </div>
      </div>

      {/* URL Address Bar and Mode Controls */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-1 border-t border-[#21262D] flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-1 text-slate-400">
          <button 
            onClick={onResetView}
            title="Reset Perspective"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={onResetView} 
            title="Reload Weather Data"
            className={`p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 ${isWeatherLoading ? 'animate-spin text-cyan-400' : ''}`}
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Address Input Pill */}
        <div className="flex-1 max-w-xl mx-auto flex items-center gap-2 px-3 py-1 bg-[#0D1117] rounded-full border border-[#30363D] text-xs text-slate-300 shadow-inner min-w-[240px]">
          <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="font-mono text-slate-400">https://</span>
          <span className="font-mono font-medium text-slate-200 truncate">north-iraq-borders.3d-terrain.nasa.sim</span>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[10px] font-mono rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
              NASA + OPEN-METEO
            </span>
          </div>
        </div>

        {/* Satellite Layer Toggle, Weather Mode Switcher & Wireframe Toggle */}
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          {/* Satellite Layer Toggle */}
          <button
            onClick={onToggleSatelliteLayer}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors ${
              satelliteLayer === 'nasa'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60 font-semibold'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 font-semibold'
            }`}
            title="Toggle between NASA Daily Satellite and HD Ortho Satellite"
          >
            <Satellite className="w-3 h-3" />
            <span>{satelliteLayer === 'nasa' ? 'NASA Daily (24h)' : 'HD Ortho'}</span>
          </button>

          {/* Weather Simulation Mode */}
          <div className="flex items-center bg-[#0D1117] p-0.5 rounded-lg border border-[#30363D] text-[11px]">
            <button
              onClick={() => onSelectWeatherMode('live')}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${
                weatherMode === 'live'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Drive skies with live Open-Meteo observations"
            >
              <Radio className="w-3 h-3" />
              <span>Live API</span>
            </button>
            <button
              onClick={() => onSelectWeatherMode('forecast')}
              className={`px-2 py-0.5 rounded transition-colors ${
                weatherMode === 'forecast'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Scrub real 72h Open-Meteo forecast timeline"
            >
              72h Forecast
            </button>
            <button
              onClick={() => onSelectWeatherMode('storm_simulation')}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${
                weatherMode === 'storm_simulation'
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Simulate towering convective cumulonimbus cell"
            >
              <Sparkles className="w-3 h-3" />
              <span>Storm Cell</span>
            </button>
          </div>

          <button
            onClick={onToggleWireframe}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
              wireframe
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border-slate-700/60'
            }`}
            title="Toggle Chunk Wireframe Mesh"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Wireframe</span>
          </button>
        </div>
      </div>
    </header>
  );
};
