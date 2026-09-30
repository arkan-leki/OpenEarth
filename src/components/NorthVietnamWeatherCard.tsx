import React, { useState } from 'react';
import {
  Cloud,
  Wind,
  Droplets,
  Mountain,
  MapPin,
  ChevronDown,
  ChevronUp,
  Minimize2,
  Maximize2,
  Sun,
  Moon
} from 'lucide-react';
import { LiveWeatherStation } from '../types';
import { KURDISTAN_LANDMARKS } from '../utils/realSulaymaniyahTerrain';
import { SunPositionResult } from '../utils/sunPosition';

interface NorthVietnamWeatherCardProps {
  station?: LiveWeatherStation;
  selectedLandmarkId: string;
  onSelectLandmarkId: (id: string) => void;
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
  onOpenSatelliteModal?: () => void;
  sunPosition?: SunPositionResult;
}

export const NorthVietnamWeatherCard: React.FC<NorthVietnamWeatherCardProps> = ({
  station,
  selectedLandmarkId,
  onSelectLandmarkId,
  isMinimized,
  onToggleMinimize,
  onOpenSatelliteModal,
  sunPosition
}) => {
  const [internalMinimized, setInternalMinimized] = useState(false);

  // Controlled or uncontrolled minimized state
  const isPanelMinimized = isMinimized !== undefined ? isMinimized : internalMinimized;
  const toggleMinimize = onToggleMinimize || (() => setInternalMinimized(prev => !prev));

  if (!station) return null;

  // Minimized Compact Floating Pill View
  if (isPanelMinimized) {
    return (
      <div className="absolute bottom-4 left-4 z-30 pointer-events-auto select-none">
        <button
          id="btn-expand-weather-feed"
          onClick={toggleMinimize}
          className="group flex items-center gap-2.5 px-3.5 py-2.5 bg-slate-950/90 hover:bg-slate-900/95 backdrop-blur-2xl border border-slate-700/80 hover:border-cyan-500/50 rounded-2xl shadow-2xl text-slate-100 transition-all duration-300 cursor-pointer"
          title="Expand Live Weather Feed"
        >
          {/* Live pulsing dot */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          </div>

          {/* Location & condition */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
            <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{station.name}</span>
          </div>

          {/* Temperature badge */}
          <span className="px-2 py-0.5 rounded-lg bg-slate-800/90 text-cyan-300 font-mono font-bold text-xs border border-slate-700/60">
            {station.temperature}°C
          </span>

          <span className="text-[11px] text-slate-400 capitalize hidden xs:inline">
            {station.condition.replace('_', ' ')}
          </span>

          {/* Expand icon */}
          <div className="w-6 h-6 rounded-lg bg-slate-800/80 group-hover:bg-cyan-500/20 group-hover:text-cyan-300 flex items-center justify-center text-slate-400 transition-colors ml-0.5">
            <ChevronUp className="w-4 h-4 transition-transform group-hover:-translate-y-0.5" />
          </div>
        </button>
      </div>
    );
  }

  // Expanded Comprehensive Weather Card
  return (
    <div className="absolute bottom-4 left-4 z-30 pointer-events-auto max-w-sm w-[calc(100vw-2rem)] sm:w-88 select-none">
      <div className="bg-slate-950/90 backdrop-blur-2xl border border-slate-700/70 rounded-2xl shadow-2xl p-4 text-slate-100 transition-all duration-300">
        {/* Header with Title, Live badge, and Minimize Button */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-mono font-bold tracking-wider text-emerald-400 uppercase">
              Live Weather • Today
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-cyan-300 font-semibold bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 rounded-md">
              {station.dateFormatted || 'Wed, Sep 23, 2026'}
            </span>
            <button
              id="btn-minimize-weather-feed"
              onClick={toggleMinimize}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 active:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1"
              title="Minimize panel"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Location & Big Temperature */}
        <div className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-wide flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>{station.name}</span>
              </h2>
              <p className="text-xs text-slate-400 capitalize mt-0.5">
                {station.condition.replace('_', ' ')} • Lat {station.lat.toFixed(2)}° N, Lon {station.lon.toFixed(2)}° E
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-3xl sm:text-4xl font-black text-white font-mono tracking-tight">
                {station.temperature}°
              </span>
              <span className="text-sm font-semibold text-slate-400">C</span>
            </div>
          </div>
        </div>

        {/* Key Quick Landmark Jump Pills (All 28 360° Ground Locations) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
          {KURDISTAN_LANDMARKS.map((lm) => {
            const isSelected = selectedLandmarkId === lm.id;
            return (
              <button
                key={lm.id}
                id={`btn-card-landmark-${lm.id}`}
                onClick={() => onSelectLandmarkId(lm.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all touch-manipulation cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20'
                    : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-700/50'
                }`}
                title={`Jump to 360° Ground View at ${lm.name}`}
              >
                {lm.name.split(' (')[0]}
              </button>
            );
          })}
        </div>

        {/* 4-Grid Meteorological Telemetry */}
        <div className="grid grid-cols-2 gap-2 pt-2 text-xs font-mono">
          {/* Wind */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400">
              <Wind className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Wind</div>
              <div className="font-bold text-white text-xs">
                {station.windSpeed} km/h
              </div>
            </div>
          </div>

          {/* Humidity */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
              <Droplets className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Humidity</div>
              <div className="font-bold text-white text-xs">
                {station.relativeHumidity}%
              </div>
            </div>
          </div>

          {/* Cloud Cover */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Cloud Cover</div>
              <div className="font-bold text-white text-xs">
                {station.cloudCover}%
              </div>
            </div>
          </div>

          {/* Elevation */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Mountain className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Elevation</div>
              <div className="font-bold text-white text-xs">
                {station.elevation} m
              </div>
            </div>
          </div>
        </div>

        {/* Solar Ephemeris & 3D Shadow Status */}
        {sunPosition && (
          <div className="mt-2.5 px-2.5 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between text-[10px] font-mono">
            <span className="flex items-center gap-1.5 text-slate-300">
              {sunPosition.isDaylight ? (
                <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
              )}
              <span>Sun Elev:</span>
              <strong className={sunPosition.elevationDeg > 0 ? 'text-amber-300' : 'text-slate-300'}>
                {sunPosition.elevationDeg > 0 ? `+${sunPosition.elevationDeg}°` : `${sunPosition.elevationDeg}°`}
              </strong>
            </span>
            <span className="text-slate-400">
              Az {sunPosition.azimuthDeg}° • {sunPosition.lightIntensity.toFixed(1)}x Lux
            </span>
          </div>
        )}

        {/* Bottom Sub-info: Satellite Imagery Status & View Button */}
        <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
          {onOpenSatelliteModal ? (
            <button
              id="btn-card-open-satellite-modal"
              onClick={onOpenSatelliteModal}
              className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 font-semibold transition-colors cursor-pointer group"
              title="Inspect optical satellite imagery & radar"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 group-hover:scale-125 transition-transform animate-pulse" />
              <span className="underline underline-offset-2">🛰️ Today's Sat Pass & Radar</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              NASA GIBS Sat Pass (Today)
            </span>
          )}
          <span className="text-emerald-400 font-semibold">{station.time} AST</span>
        </div>
      </div>
    </div>
  );
};

export const KurdistanWeatherCard = NorthVietnamWeatherCard;
export const NorthIraqWeatherCard = NorthVietnamWeatherCard;

