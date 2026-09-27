import React, { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Cloud, Sun, CloudRain, Wind, Sparkles, Calendar, Layers, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { WeatherMode } from '../types';
import { NASA_HISTORY_DAYS } from '../services/nasaHistoryService';
import { SulaymaniyahWeatherPayload } from '../services/weatherService';
import { CloudClassification, identifyCloudClassification } from '../services/cloudClassificationService';

interface ZoomEarthTimelineProps {
  weatherMode: WeatherMode;
  // History Mode state
  selectedHistoryDate: string;
  onSelectHistoryDate: (date: string) => void;
  // Forecast Mode state
  currentHourOffset: number; // 0 to 72
  onHourOffsetChange: (offset: number) => void;
  // Playback state
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackSpeed: number;
  onChangeSpeed: (speed: number) => void;
  // Weather payload & Cloud Classification
  weatherPayload?: SulaymaniyahWeatherPayload | null;
  classification?: CloudClassification;
}

export const ZoomEarthTimeline: React.FC<ZoomEarthTimelineProps> = ({
  weatherMode,
  selectedHistoryDate,
  onSelectHistoryDate,
  currentHourOffset,
  onHourOffsetChange,
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onChangeSpeed,
  weatherPayload,
  classification: propClassification
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Determine active cloud classification
  const activeClassification = propClassification || identifyCloudClassification(
    weatherMode,
    selectedHistoryDate,
    weatherPayload,
    currentHourOffset
  );

  // Automated playback ticker
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      if (weatherMode === 'history') {
        const currentIndex = NASA_HISTORY_DAYS.findIndex(d => d.date === selectedHistoryDate);
        const nextIndex = (currentIndex - 1 + NASA_HISTORY_DAYS.length) % NASA_HISTORY_DAYS.length;
        onSelectHistoryDate(NASA_HISTORY_DAYS[nextIndex].date);
      } else if (weatherMode === 'forecast') {
        onHourOffsetChange((currentHourOffset + 1) % 73);
      } else if (weatherMode === 'live') {
        onHourOffsetChange(((currentHourOffset + 7) % 7) - 6);
      }
    }, Math.max(250, 1200 / playbackSpeed));

    return () => clearInterval(interval);
  }, [isPlaying, weatherMode, selectedHistoryDate, currentHourOffset, playbackSpeed, onSelectHistoryDate, onHourOffsetChange]);

  // Step back / forward handlers
  const handleStepBack = () => {
    if (weatherMode === 'history') {
      const idx = NASA_HISTORY_DAYS.findIndex(d => d.date === selectedHistoryDate);
      const nextIdx = Math.min(NASA_HISTORY_DAYS.length - 1, idx + 1);
      onSelectHistoryDate(NASA_HISTORY_DAYS[nextIdx].date);
    } else {
      onHourOffsetChange(Math.max(0, currentHourOffset - 3));
    }
  };

  const handleStepForward = () => {
    if (weatherMode === 'history') {
      const idx = NASA_HISTORY_DAYS.findIndex(d => d.date === selectedHistoryDate);
      const nextIdx = Math.max(0, idx - 1);
      onSelectHistoryDate(NASA_HISTORY_DAYS[nextIdx].date);
    } else {
      onHourOffsetChange(Math.min(72, currentHourOffset + 3));
    }
  };

  const currentHistoryDay = NASA_HISTORY_DAYS.find(d => d.date === selectedHistoryDate) || NASA_HISTORY_DAYS[0];

  // Calculate forecast metrics for currentHourOffset
  const forecastHourTime = new Date();
  forecastHourTime.setHours(forecastHourTime.getHours() + currentHourOffset);
  const timeStr = forecastHourTime.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  const currentHourIdx = weatherPayload
    ? Math.max(0, Math.min(72, weatherPayload.currentHourIndex + currentHourOffset))
    : 0;

  const cloudCoverPct = weatherPayload && weatherPayload.hourly?.cloudCovers?.length > 0
    ? Math.round(
        weatherPayload.hourly.cloudCovers.reduce((acc, c) => acc + (c[currentHourIdx] ?? 0), 0) /
        weatherPayload.hourly.cloudCovers.length
      )
    : 20;

  const forecastTemp = weatherPayload && weatherPayload.hourly?.temperatures?.length > 0
    ? Math.round(
        weatherPayload.hourly.temperatures.reduce((acc, t) => acc + (t[currentHourIdx] ?? 0), 0) /
        weatherPayload.hourly.temperatures.length
      )
    : 32;

  const forecastPrecipMm = weatherPayload && weatherPayload.hourly?.precipitations?.length > 0
    ? Math.max(...weatherPayload.hourly.precipitations.map(p => p[currentHourIdx] ?? 0))
    : 0;

  // If collapsed for clear window mode:
  if (isCollapsed) {
    return (
      <div className="absolute bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto select-none">
        <div className="flex items-center gap-2 bg-slate-950/85 backdrop-blur-2xl border border-slate-700/80 px-3 py-1.5 rounded-full shadow-2xl">
          <button
            onClick={onTogglePlay}
            className={`p-1.5 rounded-full text-white font-bold transition-all shadow-md ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-400'
                : 'bg-cyan-500 hover:bg-cyan-400'
            }`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-white" />}
          </button>

          <span className="text-xs font-mono font-semibold text-slate-200">
            {weatherMode === 'history' && `NASA: ${selectedHistoryDate}`}
            {weatherMode === 'forecast' && `Forecast: +${currentHourOffset}h`}
            {weatherMode === 'live' && 'Real-Time Sync'}
          </span>

          <button
            onClick={() => setIsCollapsed(false)}
            className="p-1 rounded-full text-slate-400 hover:text-white transition-colors"
            title="Expand Timeline"
          >
            <ChevronUp className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-2 sm:bottom-5 left-1/2 -translate-x-1/2 w-[96%] max-w-4xl z-20 pointer-events-auto select-none">
      <div className="bg-slate-950/85 backdrop-blur-2xl border border-slate-700/70 rounded-2xl sm:rounded-3xl p-2.5 sm:p-4 shadow-2xl shadow-black/90">
        {/* Top Info Header */}
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 mb-2 border-b border-slate-800/80">
          {/* Left: Playback controls and mode description */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Play/Pause & Step Buttons */}
            <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-900/90 border border-slate-700/60 p-0.5 sm:p-1 rounded-2xl">
              <button
                onClick={handleStepBack}
                className="p-1 sm:p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors touch-manipulation min-h-[32px] min-w-[32px] flex items-center justify-center"
                title="Step backward"
              >
                <SkipBack className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
              <button
                onClick={onTogglePlay}
                className={`p-1.5 sm:p-2 rounded-xl text-white font-bold transition-all shadow-md touch-manipulation min-h-[32px] min-w-[32px] flex items-center justify-center ${
                  isPlaying
                    ? 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/30'
                    : 'bg-cyan-500 hover:bg-cyan-400 shadow-cyan-500/30'
                }`}
                title={isPlaying ? 'Pause timelapse' : 'Play timelapse'}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white" />}
              </button>
              <button
                onClick={handleStepForward}
                className="p-1 sm:p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors touch-manipulation min-h-[32px] min-w-[32px] flex items-center justify-center"
                title="Step forward"
              >
                <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>

            {/* Mode Title & Active Readout */}
            <div className="min-w-0">
              {weatherMode === 'history' && (
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <span className="text-[11px] sm:text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">NASA Terra/MODIS</span>
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-200 font-mono font-semibold">
                    {currentHistoryDay.label}
                  </span>
                  <span className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono font-bold flex items-center gap-1">
                    <span>{activeClassification.emoji}</span>
                    <span className="truncate">{activeClassification.displayName}</span>
                  </span>
                  <span className="text-[9px] sm:text-[10px] text-slate-400 font-mono hidden md:inline">
                    Base: {activeClassification.baseAltitudeM}m · Top: {activeClassification.topAltitudeM}m · Depth: {activeClassification.thicknessM}m
                  </span>
                </div>
              )}

              {weatherMode === 'forecast' && (
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <span className="text-[11px] sm:text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1">
                    <Cloud className="w-3.5 h-3.5 shrink-0" />
                    <span>72-Hour Model</span>
                  </span>
                  <span className="text-[11px] sm:text-xs text-white font-mono font-semibold">
                    +{currentHourOffset}h ({timeStr})
                  </span>
                  <span className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono font-bold flex items-center gap-1">
                    <span>{activeClassification.emoji}</span>
                    <span>{activeClassification.displayName}</span>
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-mono text-emerald-400">
                    {forecastTemp}°C
                  </span>
                  <span className={`text-[10px] sm:text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                    forecastPrecipMm > 0.1
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {forecastPrecipMm > 0.1 ? `${(Math.round(forecastPrecipMm * 10) / 10).toFixed(1)} mm/h` : '0.0 mm/h (Dry)'}
                  </span>
                </div>
              )}

              {weatherMode === 'live' && (
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <span className="text-[11px] sm:text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                    <span>Real-Time Synoptic Grid</span>
                  </span>
                  <span className="text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono font-bold flex items-center gap-1">
                    <span>{activeClassification.emoji}</span>
                    <span>{activeClassification.displayName}</span>
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-300 hidden md:inline truncate">
                    Erbil 34°C · Suli 32°C · Duhok 33°C · Halgurd 16°C
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Playback Speed Selector & Collapse Button */}
          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
            <div className="flex items-center gap-1 text-[10px] sm:text-[11px] font-mono text-slate-400">
              <span className="hidden xs:inline">Speed:</span>
              {[1, 2, 4].map(s => (
                <button
                  key={s}
                  onClick={() => onChangeSpeed(s)}
                  className={`px-1.5 sm:px-2 py-0.5 rounded-lg font-bold transition-all touch-manipulation min-h-[26px] ${
                    playbackSpeed === s
                      ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Collapse button for clear window */}
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors ml-1"
              title="Minimize Timeline (Clear Window)"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Timeline Content: Different for History vs Forecast vs Live */}
        {weatherMode === 'history' && (
          <div className="w-full">
            {/* 10 Date Buttons for Last 10 Days */}
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-1 sm:gap-1.5">
              {NASA_HISTORY_DAYS.map((day) => {
                const isSelected = day.date === selectedHistoryDate;
                return (
                  <button
                    key={day.date}
                    onClick={() => onSelectHistoryDate(day.date)}
                    title={`${day.label} • ${day.cloudGenus || 'Satellite Cloud Mask'}`}
                    className={`flex flex-col items-center justify-center p-1 sm:p-2 rounded-xl sm:rounded-2xl border transition-all touch-manipulation min-h-[42px] ${
                      isSelected
                        ? 'bg-amber-500/25 border-amber-400 shadow-md shadow-amber-500/30 text-amber-200 ring-1 ring-amber-400'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-850 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-xs">{day.cloudEmoji || '☁️'}</span>
                      <span className="text-[10px] sm:text-[11px] font-bold">
                        {day.date.slice(5)}
                      </span>
                    </div>
                    <span className="text-[8px] sm:text-[9px] font-mono opacity-80">
                      {day.cloudCoveragePct}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {weatherMode === 'forecast' && (
          <div className="space-y-1.5 sm:space-y-2">
            {/* 72-Hour Slider */}
            <div className="relative flex items-center">
              <input
                type="range"
                min="0"
                max="72"
                step="1"
                value={currentHourOffset}
                onChange={(e) => onHourOffsetChange(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
              />
            </div>

            {/* Time Ticks */}
            <div className="flex justify-between text-[9px] sm:text-[10px] font-mono text-slate-400 px-1">
              <span>Now (0h)</span>
              <span>+12h</span>
              <span>+24h (D1)</span>
              <span>+36h</span>
              <span>+48h (D2)</span>
              <span>+60h</span>
              <span>+72h (D3)</span>
            </div>
          </div>
        )}

        {weatherMode === 'live' && (
          <div className="flex items-center justify-between text-[11px] sm:text-xs font-mono text-slate-300 py-0.5 sm:py-1">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-emerald-400">● REAL-TIME SYNC</span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-400 truncate">NASA GIBS + Open-Meteo Synoptic Grid</span>
            </div>
            <div className="text-[10px] sm:text-[11px] text-slate-400 hidden xs:block">
              Clear HD Satellite Ground Active
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
