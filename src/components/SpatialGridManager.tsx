import React from 'react';
import { Sun, CloudRain, CloudLightning, Wind, MapPin, Zap, Layers, Eye } from 'lucide-react';
import { GridChunkData } from '../types';

interface SpatialGridManagerProps {
  chunks: GridChunkData[];
  activeChunkIds: Set<string>;
  selectedChunkId: string | null;
  onSelectChunk: (chunk: GridChunkData) => void;
  cacheRadius: number;
  onChangeCacheRadius: (radius: number) => void;
  satelliteLayer?: 'nasa' | 'hd';
  isSingleChunkMode?: boolean;
  onToggleSingleChunkMode?: (single: boolean) => void;
  onRenderAll?: () => void;
}

export const SpatialGridManager: React.FC<SpatialGridManagerProps> = ({
  chunks,
  activeChunkIds,
  selectedChunkId,
  onSelectChunk,
  satelliteLayer = 'nasa',
  isSingleChunkMode = false,
  onToggleSingleChunkMode,
  onRenderAll
}) => {
  const selectedChunk = chunks.find(c => c.id === selectedChunkId) || chunks[0] || null;

  const bgImage = satelliteLayer === 'hd'
    ? '/tiles/north_iraq_hd_satellite.jpg'
    : '/tiles/north_iraq_nasa_satellite.jpg';

  const getWeatherIcon = (cond: string) => {
    switch (cond) {
      case 'rain':
      case 'snow':
        return <CloudRain className="w-3 h-3 text-sky-300" />;
      case 'thunderstorm':
        return <CloudLightning className="w-3 h-3 text-amber-300" />;
      case 'dust':
        return <Wind className="w-3 h-3 text-amber-200" />;
      default:
        return <Sun className="w-3 h-3 text-amber-400" />;
    }
  };

  return (
    <div className="border-b border-[#21262D] pb-3 sm:pb-4">
      {/* Section Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-[#161B22]/90 border-y border-[#30363D]">
        <div className="text-xs font-bold tracking-wider text-slate-200 uppercase font-mono flex items-center gap-1.5">
          <span className="text-sky-400">1.</span>
          <span>SPATIAL GRID MANAGER</span>
          <span className="hidden sm:inline text-[10px] text-slate-400 font-normal">(16 CHUNKS)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-cyan-400 font-semibold uppercase px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/40">
            {satelliteLayer === 'hd' ? 'HD SATELLITE' : 'NASA MODIS'}
          </span>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        {/* Render Mode Selector: Render 1 Sector (Super Fast) vs Render All 16 */}
        <div className="flex items-center justify-between gap-2 mb-2.5 bg-[#0D1117] p-1.5 rounded-lg border border-[#30363D]">
          <div className="text-[11px] font-mono text-slate-300 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-semibold">RENDER SCOPE:</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onToggleSingleChunkMode && onToggleSingleChunkMode(true)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-all flex items-center gap-1 min-h-[32px] sm:min-h-0 ${
                isSingleChunkMode
                  ? 'bg-amber-500/25 text-amber-300 border border-amber-500/60 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Render only the selected sector for maximum FPS"
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>RENDER ONE</span>
            </button>

            <button
              onClick={() => {
                if (onToggleSingleChunkMode) onToggleSingleChunkMode(false);
                if (onRenderAll) onRenderAll();
              }}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-all flex items-center gap-1 min-h-[32px] sm:min-h-0 ${
                !isSingleChunkMode
                  ? 'bg-sky-500/25 text-sky-300 border border-sky-500/60 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Render all 16 sectors simultaneously"
            >
              <Eye className="w-3 h-3 text-sky-400" />
              <span>ALL 16</span>
            </button>
          </div>
        </div>

        {/* 16-Square Grid Overlay (4 cols x 4 rows) directly on NASA satellite map */}
        <div className="relative w-full aspect-square max-w-[380px] mx-auto rounded-lg overflow-hidden border border-[#30363D] bg-[#0d151e] shadow-xl select-none">
          {/* Satellite Map Background */}
          <div 
            className="absolute inset-0 opacity-80 bg-cover bg-center filter contrast-110 brightness-95 pointer-events-none"
            style={{
              backgroundImage: `url('${bgImage}')`
            }}
          />

          {/* Grid of exactly 16 Chunks (4x4) */}
          <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 p-1 gap-1">
            {chunks.map((chunk) => {
              const isActive = activeChunkIds.has(chunk.id);
              const isSelected = selectedChunkId === chunk.id;

              let cellBg = 'bg-slate-950/50 hover:bg-slate-900/80 active:bg-slate-800';
              let borderStyle = 'border border-slate-700/60';

              if (isSelected) {
                cellBg = 'bg-cyan-500/35 ring-2 ring-cyan-400';
                borderStyle = 'border-2 border-cyan-300 shadow-lg';
              } else if (chunk.id === 'B2') {
                // Erbil Capital
                cellBg = 'bg-sky-950/45 hover:bg-sky-900/60';
                borderStyle = 'border border-sky-400/80 shadow-sm';
              } else if (chunk.id === 'C1') {
                // Mount Halgurd peak
                cellBg = 'bg-amber-950/45 hover:bg-amber-900/60';
                borderStyle = 'border border-amber-400/70';
              } else if (chunk.id === 'D3') {
                // Sulaymaniyah
                cellBg = 'bg-emerald-950/45 hover:bg-emerald-900/60';
                borderStyle = 'border border-emerald-400/70';
              } else if (chunk.id === 'D4') {
                // Kalar & Darbandikhan
                cellBg = 'bg-indigo-950/45 hover:bg-indigo-900/60';
                borderStyle = 'border border-indigo-400/70';
              } else if (isActive) {
                cellBg = 'bg-slate-900/60';
                borderStyle = 'border border-cyan-500/40';
              }

              return (
                <button
                  key={chunk.id}
                  onClick={() => onSelectChunk(chunk)}
                  className={`relative flex flex-col items-center justify-between p-1 rounded transition-all group overflow-hidden touch-manipulation active:scale-[0.98] ${cellBg} ${borderStyle}`}
                  title={`${chunk.id}: ${chunk.label} (${isActive ? 'Rendering Active' : 'Standby'})`}
                >
                  {/* Top: Chunk Coordinate + Weather Icon */}
                  <div className="w-full flex items-center justify-between px-0.5">
                    <span className={`text-[10px] font-mono font-bold leading-none ${
                      isSelected ? 'text-cyan-200' : isActive ? 'text-cyan-300' : 'text-slate-300'
                    }`}>
                      {chunk.id}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {getWeatherIcon(chunk.condition)}
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      )}
                    </div>
                  </div>

                  {/* Middle: Badges / Key Landmarks */}
                  <div className="flex flex-col items-center my-auto px-0.5 text-center">
                    {chunk.id === 'B2' && (
                      <span className="text-[7.5px] font-extrabold text-amber-300 bg-black/85 px-1 py-0.5 rounded uppercase tracking-tighter whitespace-nowrap">
                        ERBIL
                      </span>
                    )}
                    {chunk.id === 'D3' && (
                      <span className="text-[7.5px] font-extrabold text-emerald-300 bg-black/85 px-1 py-0.5 rounded uppercase tracking-tighter whitespace-nowrap">
                        SULI
                      </span>
                    )}
                    {chunk.id === 'C1' && (
                      <span className="text-[7px] font-extrabold text-cyan-200 bg-black/85 px-1 py-0.5 rounded uppercase tracking-tighter whitespace-nowrap">
                        3607M
                      </span>
                    )}
                    {chunk.id === 'A2' && (
                      <span className="text-[7px] font-extrabold text-slate-200 bg-black/85 px-1 py-0.5 rounded uppercase tracking-tighter whitespace-nowrap">
                        MOSUL
                      </span>
                    )}
                    {chunk.id === 'A1' && (
                      <span className="text-[6.5px] font-extrabold text-rose-300 bg-black/85 px-0.5 py-0.2 rounded uppercase tracking-tighter whitespace-nowrap">
                        TURKEY BORDER
                      </span>
                    )}
                    {chunk.id === 'C2' && (
                      <span className="text-[6.5px] font-extrabold text-sky-300 bg-black/85 px-1 py-0.5 rounded uppercase tracking-tighter whitespace-nowrap">
                        DUKAN LAKE
                      </span>
                    )}
                    {chunk.id === 'D4' && (
                      <span className="text-[6.5px] font-extrabold text-indigo-300 bg-black/85 px-0.5 py-0.5 rounded uppercase tracking-tighter whitespace-nowrap">
                        KALAR/DARB
                      </span>
                    )}
                    {chunk.id === 'C3' && (
                      <span className="text-[7px] font-extrabold text-amber-200 bg-black/85 px-1 py-0.5 rounded uppercase tracking-tighter whitespace-nowrap">
                        KIRKUK
                      </span>
                    )}
                    {chunk.id === 'B1' && (
                      <span className="text-[6.5px] font-extrabold text-slate-300 bg-black/85 px-0.5 py-0.2 rounded uppercase tracking-tighter whitespace-nowrap">
                        AMADIYA
                      </span>
                    )}
                  </div>

                  {/* Bottom: Elevation */}
                  <div className="w-full flex items-center justify-between text-[8px] font-mono text-slate-400 px-0.5">
                    <span>{chunk.temperature}°C</span>
                    <span>{chunk.elevationPeak}m</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Sector Diagnostics & Fast Render Action */}
        {selectedChunk && (
          <div className="mt-3 p-2.5 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs font-mono">
            <div className="flex items-center justify-between text-slate-300 mb-2 pb-1.5 border-b border-slate-800">
              <span className="font-bold text-cyan-400 flex items-center gap-1.5 truncate">
                <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>SECTOR {selectedChunk.id}: {selectedChunk.label}</span>
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ml-1 ${
                activeChunkIds.has(selectedChunk.id)
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {activeChunkIds.has(selectedChunk.id) ? 'ACTIVE' : 'STANDBY'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-400 mb-2.5">
              <div className="bg-slate-900/70 p-1.5 rounded border border-slate-800">
                <div className="text-[9px] text-slate-500 uppercase">Surface Temp</div>
                <div className="text-slate-200 font-bold">{selectedChunk.temperature}°C</div>
              </div>
              <div className="bg-slate-900/70 p-1.5 rounded border border-slate-800">
                <div className="text-[9px] text-slate-500 uppercase">Cloud Cover</div>
                <div className="text-slate-200 font-bold">{Math.round(selectedChunk.cloudDensity * 100)}%</div>
              </div>
              <div className="bg-slate-900/70 p-1.5 rounded border border-slate-800">
                <div className="text-[9px] text-slate-500 uppercase">Precipitation</div>
                <div className="text-slate-200 font-bold">
                  {selectedChunk.precipitationMm !== undefined
                    ? `${selectedChunk.precipitationMm} mm/h`
                    : `${Math.round(selectedChunk.rainIntensity * 10 * 10) / 10} mm/h`}
                </div>
              </div>
              <div className="bg-slate-900/70 p-1.5 rounded border border-slate-800">
                <div className="text-[9px] text-slate-500 uppercase">Peak Elevation</div>
                <div className="text-cyan-300 font-bold">{selectedChunk.elevationPeak}m</div>
              </div>
            </div>

            {/* Quick Action Button to Focus & Render This Square */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (onToggleSingleChunkMode) onToggleSingleChunkMode(true);
                  onSelectChunk(selectedChunk);
                }}
                className="flex-1 py-1.5 px-2 bg-cyan-600/25 hover:bg-cyan-600/35 text-cyan-300 border border-cyan-500/50 rounded text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[36px]"
              >
                <Zap className="w-3.5 h-3.5 text-cyan-300" />
                <span>FOCUS & RENDER THIS SECTOR (FAST)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
