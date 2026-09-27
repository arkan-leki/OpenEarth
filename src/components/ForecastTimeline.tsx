import React, { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, Clock, Sun, CloudRain, CloudLightning, Moon, CloudSun, FastForward } from 'lucide-react';
import { TIMELINE_KEYFRAMES } from '../utils/weatherDataPipeline';

interface ForecastTimelineProps {
  currentHourOffset: number;
  onHourOffsetChange: (hours: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackSpeed: number;
  onChangeSpeed: (speed: number) => void;
}

export const ForecastTimeline: React.FC<ForecastTimelineProps> = ({
  currentHourOffset,
  onHourOffsetChange,
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onChangeSpeed
}) => {
  // Find current nearest keyframe
  const currentKeyframe = TIMELINE_KEYFRAMES.reduce((prev, curr) => {
    return Math.abs(curr.hourOffset - currentHourOffset) < Math.abs(prev.hourOffset - currentHourOffset)
      ? curr
      : prev;
  }, TIMELINE_KEYFRAMES[2]);

  // Convert -24 .. +48 range to 0 .. 100% slider
  const sliderValue = ((currentHourOffset + 24) / 72) * 100;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = parseFloat(e.target.value);
    const hours = Math.round((pct / 100) * 72 - 24);
    onHourOffsetChange(hours);
  };

  return (
    <div className="border-b border-[#21262D] pb-4">
      {/* Section Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161B22]/80 border-y border-[#30363D]">
        <div className="text-xs font-bold tracking-wider text-slate-200 uppercase font-mono">
          2. FORECAST TIMELINE
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-sky-400">
          <Clock className="w-3.5 h-3.5" />
          <span>{currentHourOffset >= 0 ? `+${currentHourOffset}h` : `${currentHourOffset}h`}</span>
        </div>
      </div>

      <div className="p-4">
        {/* Timeline Header Bounds */}
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 font-semibold mb-2">
          <span>PAST 24H</span>
          <span className="text-sky-400 font-bold">
            {currentHourOffset === 0 ? 'LIVE RADAR (T=0)' : currentKeyframe.displayTime}
          </span>
          <span>+48H FORECAST</span>
        </div>

        {/* Custom Styled Scrubbing Slider */}
        <div className="relative py-2">
          <input
            type="range"
            min="0"
            max="100"
            step="0.5"
            value={sliderValue}
            onChange={handleSliderChange}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
            style={{
              background: `linear-gradient(to right, #38bdf8 0%, #38bdf8 ${sliderValue}%, #334155 ${sliderValue}%, #334155 100%)`
            }}
          />
        </div>

        {/* Weather Milestone Icons (Matching the 5 icons in screenshot) */}
        <div className="flex items-center justify-between pt-1 px-1 text-slate-400">
          {/* 1. Night / Moon with clouds */}
          <button
            onClick={() => onHourOffsetChange(-24)}
            className="p-1 rounded hover:text-sky-300 transition-colors group flex flex-col items-center"
            title="-24h: Overnight"
          >
            <Moon className="w-5 h-5 text-indigo-400/80 group-hover:scale-110 transition-transform" />
          </button>

          {/* 2. Bright Sun */}
          <button
            onClick={() => onHourOffsetChange(-12)}
            className="p-1 rounded hover:text-amber-300 transition-colors group flex flex-col items-center"
            title="-12h: Clear Sunlight"
          >
            <Sun className="w-5 h-5 text-amber-400 group-hover:scale-110 transition-transform" />
          </button>

          {/* 3. Cloud with Rain */}
          <button
            onClick={() => onHourOffsetChange(0)}
            className="p-1 rounded hover:text-sky-300 transition-colors group flex flex-col items-center"
            title="0h: Heavy Rain / Storm"
          >
            <CloudRain className="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
          </button>

          {/* 4. Clock / Current */}
          <button
            onClick={() => onHourOffsetChange(12)}
            className="p-1 rounded hover:text-slate-200 transition-colors group flex flex-col items-center"
            title="+12h: Overnight Transition"
          >
            <Clock className="w-5 h-5 text-slate-300 group-hover:scale-110 transition-transform" />
          </button>

          {/* 5. Thunderstorm */}
          <button
            onClick={() => onHourOffsetChange(24)}
            className="p-1 rounded hover:text-amber-400 transition-colors group flex flex-col items-center"
            title="+24h: Secondary Front"
          >
            <CloudLightning className="w-5 h-5 text-amber-300 group-hover:scale-110 transition-transform" />
          </button>
        </div>

        {/* Playback Controls & Status Summary */}
        <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={onTogglePlay}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold transition-colors shadow-sm"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isPlaying ? 'PAUSE' : 'PLAY SIM'}</span>
            </button>

            <button
              onClick={() => onHourOffsetChange(0)}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
              title="Reset to Live (T=0)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Playback speed selector */}
          <div className="flex items-center gap-1 font-mono text-[11px] text-slate-400">
            <span>Speed:</span>
            {[1, 5, 15].map(spd => (
              <button
                key={spd}
                onClick={() => onChangeSpeed(spd)}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  playbackSpeed === spd
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 font-bold'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Active Meteorological State Summary */}
        <div className="mt-2.5 px-3 py-2 rounded bg-[#0D1117] border border-slate-800 text-[11px] font-mono text-slate-400 flex items-center justify-between">
          <span>Pattern: <strong className="text-slate-200">{currentKeyframe.overallCondition}</strong></span>
          <span>Wind: <strong className="text-sky-300">{currentKeyframe.windSpeedKmh} km/h</strong></span>
          <span>Temp: <strong className="text-amber-300">{currentKeyframe.temperatureAvg}°C</strong></span>
        </div>
      </div>
    </div>
  );
};
