import React, { useState, useMemo } from 'react';
import {
  Compass,
  RotateCcw,
  RotateCw,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe2,
  MapPin,
  Cloud
} from 'lucide-react';
import { KURDISTAN_LANDMARKS } from '../utils/realSulaymaniyahTerrain';
import { Landmark } from '../types';

interface Ground360ControlBarProps {
  selectedLandmarkId: string;
  onSelectLandmark: (lm: Landmark) => void;
  isGround360Mode: boolean;
  onToggleGround360Mode: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  compassHeading: number;
  onCameraAction: (type: 'left' | 'right' | 'look_up' | 'horizon') => void;
}

function getCardinalLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((deg % 360) / 45)) % 8;
  return dirs[idx];
}

export const Ground360ControlBar: React.FC<Ground360ControlBarProps> = ({
  selectedLandmarkId,
  onSelectLandmark,
  isGround360Mode,
  onToggleGround360Mode,
  autoRotate,
  onToggleAutoRotate,
  compassHeading,
  onCameraAction
}) => {
  const [activeCategory, setActiveCategory] = useState<'all' | 'city' | 'mountain' | 'water' | 'border'>('all');

  const currentLandmark = useMemo(() => {
    return KURDISTAN_LANDMARKS.find((l) => l.id === selectedLandmarkId) || KURDISTAN_LANDMARKS[0];
  }, [selectedLandmarkId]);

  const filteredLandmarks = useMemo(() => {
    if (activeCategory === 'all') return KURDISTAN_LANDMARKS;
    return KURDISTAN_LANDMARKS.filter((l) => l.type === activeCategory);
  }, [activeCategory]);

  const handleStepLocation = (delta: number) => {
    const idx = KURDISTAN_LANDMARKS.findIndex((l) => l.id === selectedLandmarkId);
    const nextIdx = (idx + delta + KURDISTAN_LANDMARKS.length) % KURDISTAN_LANDMARKS.length;
    onSelectLandmark(KURDISTAN_LANDMARKS[nextIdx]);
  };

  const cardinal = getCardinalLabel(compassHeading);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto w-[calc(100vw-2rem)] max-w-2xl select-none">
      <div className="bg-slate-950/92 backdrop-blur-2xl border border-slate-700/80 rounded-2xl shadow-2xl px-3 py-2.5 text-slate-100">
        {/* Top Row: 360° Ground Mode Toggle, Current Spot Info, Compass & Same-Spot Rotation Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/90">
          {/* Left: Mode Switch + Step Prev/Next Location */}
          <div className="flex items-center gap-1.5">
            <button
              id="btn-toggle-ground-360-mode"
              onClick={onToggleGround360Mode}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer border ${
                isGround360Mode
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 border-emerald-300 shadow-md shadow-emerald-500/25'
                  : 'bg-slate-900 hover:bg-slate-800 text-cyan-300 border-cyan-500/40'
              }`}
              title={
                isGround360Mode
                  ? 'Currently standing at Ground Level in 360° Spot Mode • Click to switch to Aerial Map View'
                  : 'Click to drop down to Ground Level at this location and rotate 360° on the same spot'
              }
            >
              {isGround360Mode ? (
                <>
                  <Compass className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '14s' }} />
                  <span>360° GROUND SPOT</span>
                </>
              ) : (
                <>
                  <Globe2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>ENTER 360° GROUND</span>
                </>
              )}
            </button>

            {/* Prev / Next Location Steppers */}
            <div className="flex items-center bg-slate-900/90 border border-slate-700/70 rounded-xl overflow-hidden">
              <button
                id="btn-prev-360-location"
                onClick={() => handleStepLocation(-1)}
                className="p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Previous 360° Ground Location"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="px-2 py-1 flex items-center gap-1 text-xs font-semibold text-white max-w-[160px] sm:max-w-[210px] truncate">
                <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="truncate">{currentLandmark.name}</span>
              </div>
              <button
                id="btn-next-360-location"
                onClick={() => handleStepLocation(1)}
                className="p-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Next 360° Ground Location"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Right: Live 360° Compass Heading & Same-Spot Camera Rotation Buttons */}
          <div className="flex items-center gap-1 text-[11px] font-mono">
            {/* Compass Heading Readout */}
            <div
              className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700/80 text-amber-300 font-bold flex items-center gap-1"
              title="Live 360° Camera Compass Heading"
            >
              <Compass className="w-3 h-3 text-amber-400" />
              <span>{compassHeading}°</span>
              <span className="text-slate-400">{cardinal}</span>
            </div>

            {/* Rotate Left 30° on same spot */}
            <button
              id="btn-360-turn-left"
              onClick={() => onCameraAction('left')}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/70 text-slate-200 hover:text-white transition-colors cursor-pointer"
              title="Rotate camera 30° Left on the same spot"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Continuous 360° Auto-Spin on same spot */}
            <button
              id="btn-360-auto-spin"
              onClick={onToggleAutoRotate}
              className={`px-2 py-1 rounded-lg border font-bold flex items-center gap-1 transition-all cursor-pointer ${
                autoRotate
                  ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700/70 text-slate-300 hover:text-white'
              }`}
              title="Automatically spin 360° around this exact spot"
            >
              <RefreshCw className={`w-3 h-3 ${autoRotate ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">360° Spin</span>
            </button>

            {/* Rotate Right 30° on same spot */}
            <button
              id="btn-360-turn-right"
              onClick={() => onCameraAction('right')}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/70 text-slate-200 hover:text-white transition-colors cursor-pointer"
              title="Rotate camera 30° Right on the same spot"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            {/* Tilt Up to Clouds / Horizon */}
            <button
              id="btn-360-look-clouds"
              onClick={() => onCameraAction('look_up')}
              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/70 text-cyan-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
              title="Look up at the 3D clouds & rain from ground level"
            >
              <Cloud className="w-3 h-3" />
              <span className="hidden md:inline">Sky</span>
            </button>
            <button
              id="btn-360-look-horizon"
              onClick={() => onCameraAction('horizon')}
              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/70 text-emerald-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
              title="Level camera at 360° Ground Horizon"
            >
              <Eye className="w-3 h-3" />
              <span className="hidden md:inline">Horizon</span>
            </button>
          </div>
        </div>

        {/* Category Filter Tabs + Scrollable 28 Ground-Level Locations */}
        <div className="pt-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
              {[
                { id: 'all', label: `All (${KURDISTAN_LANDMARKS.length})` },
                { id: 'city', label: 'Cities & Citadels' },
                { id: 'mountain', label: 'Mountain Peaks' },
                { id: 'water', label: 'Lakes & Canyons' },
                { id: 'border', label: 'Alpine Passes' }
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id as typeof activeCategory)}
                  className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    activeCategory === cat.id
                      ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <span className="text-slate-400 hidden sm:inline shrink-0">
              {isGround360Mode ? 'Drag to look 360° on spot • Solid ground locked' : 'Click any location for 360° Ground View'}
            </span>
          </div>

          {/* Horizontal Scrollable Pills for all 28 Locations */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            {filteredLandmarks.map((lm) => {
              const isSelected = lm.id === selectedLandmarkId;
              return (
                <button
                  key={lm.id}
                  id={`btn-ground360-loc-${lm.id}`}
                  onClick={() => onSelectLandmark(lm)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 border ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 border-emerald-300 font-bold shadow-md shadow-emerald-500/20'
                      : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-slate-800'
                  }`}
                >
                  <span>{lm.name.split(' (')[0]}</span>
                  {lm.elevationM !== undefined && (
                    <span
                      className={`text-[9px] font-mono px-1 rounded ${
                        isSelected ? 'bg-black/20 text-slate-950 font-extrabold' : 'bg-black/40 text-slate-400'
                      }`}
                    >
                      {lm.elevationM}m
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
