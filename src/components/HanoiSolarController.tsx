import React, { useState } from 'react';
import { Sun, Moon, Sunrise, Sunset, Clock, Sparkles, ChevronDown, ChevronUp, Compass, Flame } from 'lucide-react';
import { SunPositionResult } from '../utils/sunPosition';

interface HanoiSolarControllerProps {
  sunPosition: SunPositionResult;
  isLiveTime: boolean;
  simulatedMinutes: number; // 0 to 1439
  onToggleLiveTime: (live: boolean) => void;
  onSetSimulatedMinutes: (mins: number) => void;
  isDaytimeMode?: boolean;
  onToggleDaytimeMode?: (daytime: boolean) => void;
}

export const HanoiSolarController: React.FC<HanoiSolarControllerProps> = ({
  sunPosition,
  isLiveTime,
  simulatedMinutes,
  onToggleLiveTime,
  onSetSimulatedMinutes,
  isDaytimeMode = false,
  onToggleDaytimeMode
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Quick preset definitions (in minutes from midnight)
  const presets = [
    { label: 'Dawn', timeStr: '05:45', mins: 5 * 60 + 45, icon: Sunrise, desc: 'Ultra-long dawn shadows' },
    { label: 'Morning', timeStr: '08:30', mins: 8 * 60 + 30, icon: Sun, desc: 'Crisp morning light' },
    { label: 'Noon', timeStr: '12:00', mins: 12 * 60, icon: Sun, desc: 'High overhead sun' },
    { label: 'Golden Hour', timeStr: '17:15', mins: 17 * 60 + 15, icon: Sunset, desc: 'Rich amber ridge shadows' },
    { label: 'Blue Hour', timeStr: '18:15', mins: 18 * 60 + 15, icon: Sparkles, desc: 'Indigo twilight horizon' },
    { label: 'Night', timeStr: '22:00', mins: 22 * 60, icon: Moon, desc: 'Silvery moonlight' },
  ];

  // Helper to format minutes to HH:MM
  const formatMins = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.floor(mins % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  // Get status color based on solar period
  const getPeriodColor = () => {
    switch (sunPosition.period) {
      case 'golden_hour':
      case 'sunrise_sunset':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'daylight':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'civil_twilight':
      case 'nautical_twilight':
        return 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30';
      case 'night':
      default:
        return 'text-sky-300 bg-sky-500/10 border-sky-500/30';
    }
  };

  // Get period label
  const getPeriodLabel = () => {
    switch (sunPosition.period) {
      case 'golden_hour':
        return 'Golden Hour';
      case 'sunrise_sunset':
        return 'Sunrise / Sunset';
      case 'civil_twilight':
        return 'Civil Twilight';
      case 'nautical_twilight':
        return 'Nautical Twilight';
      case 'astronomical_twilight':
        return 'Deep Twilight';
      case 'daylight':
        return 'Daylight';
      case 'night':
      default:
        return 'Moonlit Night';
    }
  };

  return (
    <div className="absolute top-16 sm:top-18 left-2 sm:left-4 z-20 pointer-events-auto flex flex-col gap-1.5 max-w-[340px] sm:max-w-md">
      {/* Compact Interactive Header Pill */}
      <div
        id="solar-controller-pill"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-700/60 shadow-xl cursor-pointer hover:border-cyan-500/50 hover:bg-slate-900/90 transition-all select-none"
        title="Click to toggle real-time solar shadow & lighting controls"
      >
        {/* Dynamic Sun/Moon Icon */}
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800/80 border border-slate-700">
          {sunPosition.isDaylight ? (
            sunPosition.elevationDeg <= 8 ? (
              <Sunset className="w-4 h-4 text-amber-400 animate-pulse" />
            ) : (
              <Sun className="w-4 h-4 text-yellow-400" />
            )
          ) : (
            <Moon className="w-4 h-4 text-cyan-300" />
          )}
        </div>

        {/* Live Kurdistan Time & Solar Angle */}
        <div className="flex flex-col text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-semibold text-slate-100">
              {isDaytimeMode ? '12:00:00 AST' : (sunPosition.kurdistanTimeString || sunPosition.hanoiTimeString)}
            </span>
            {isDaytimeMode ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <Sun className="w-2.5 h-2.5 text-amber-400" />
                DAYTIME
              </span>
            ) : isLiveTime ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                LIVE
              </span>
            ) : (
              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                SIM
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
            <span className="flex items-center gap-0.5">
              Elev: <strong className={sunPosition.elevationDeg > 0 ? 'text-amber-300' : 'text-slate-300'}>
                {sunPosition.elevationDeg > 0 ? `+${sunPosition.elevationDeg}°` : `${sunPosition.elevationDeg}°`}
              </strong>
            </span>
            <span>•</span>
            <span className="text-slate-300 font-medium">
              {isDaytimeMode ? 'Daylight (Override)' : getPeriodLabel()}
            </span>
          </div>
        </div>

        {/* Toggle chevron */}
        <div className="ml-auto text-slate-400 hover:text-slate-200">
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Expanded Control & Telemetry Panel */}
      {isExpanded && (
        <div className="p-3.5 rounded-2xl bg-slate-950/92 backdrop-blur-xl border border-slate-700/70 shadow-2xl flex flex-col gap-3 text-slate-200 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header & Mode Switcher */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
              <Compass className="w-4 h-4 text-cyan-400" />
              <span>Kurdistan Dynamic Sun & Shadow Engine</span>
            </div>

            {/* Live vs Scrub Toggle */}
            <button
              onClick={() => {
                if (isDaytimeMode && onToggleDaytimeMode) onToggleDaytimeMode(false);
                onToggleLiveTime(!isLiveTime);
              }}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all flex items-center gap-1 border cursor-pointer ${
                isLiveTime && !isDaytimeMode
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-sm'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Clock className="w-3 h-3" />
              {isLiveTime && !isDaytimeMode ? 'Lock to Live Clock' : 'Scrubbing Time'}
            </button>
          </div>

          {/* Daytime Override Mode Toggle Card */}
          {onToggleDaytimeMode && (
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="flex items-center gap-2">
                <Sun className={`w-4 h-4 ${isDaytimeMode ? 'text-amber-400' : 'text-slate-400'}`} />
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-white">Daytime Lighting Mode</span>
                  <span className="text-[10px] text-slate-400">
                    {isDaytimeMode
                      ? 'High noon lighting active (clear view at night)'
                      : 'Astronomical datetime mode active'}
                  </span>
                </div>
              </div>
              <button
                id="btn-controller-toggle-daytime"
                onClick={() => onToggleDaytimeMode(!isDaytimeMode)}
                className={`px-3 py-1 rounded-lg text-[10px] font-mono font-bold border transition-all cursor-pointer ${
                  isDaytimeMode
                    ? 'bg-amber-500/25 border-amber-400 text-amber-300 shadow-sm'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {isDaytimeMode ? 'Daytime: ON' : 'Daytime: OFF'}
              </button>
            </div>
          )}

          {/* Time Scrubber Slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-400">Local Time of Day:</span>
              <span className="text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
                {isDaytimeMode ? '12:00 (Noon Override)' : isLiveTime ? (sunPosition.kurdistanTimeString || sunPosition.hanoiTimeString) : `${formatMins(simulatedMinutes)} AST`}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={1439}
              step={5}
              value={simulatedMinutes}
              onChange={(e) => {
                if (isDaytimeMode && onToggleDaytimeMode) onToggleDaytimeMode(false);
                onToggleLiveTime(false);
                onSetSimulatedMinutes(parseInt(e.target.value, 10));
              }}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 hover:accent-cyan-300"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>00:00 (Midnight)</span>
              <span>06:00 (Dawn)</span>
              <span>12:00 (Noon)</span>
              <span>18:00 (Sunset)</span>
              <span>23:59</span>
            </div>
          </div>

          {/* Quick Shadow Lighting Presets */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
              Shadow Angle Presets
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {presets.map((p) => {
                const Icon = p.icon;
                const isSelected = !isDaytimeMode && !isLiveTime && Math.abs(simulatedMinutes - p.mins) < 30;
                return (
                  <button
                    key={p.label}
                    onClick={() => {
                      if (isDaytimeMode && onToggleDaytimeMode) onToggleDaytimeMode(false);
                      onToggleLiveTime(false);
                      onSetSimulatedMinutes(p.mins);
                    }}
                    className={`px-2 py-1.5 rounded-xl text-left flex flex-col border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-950/70 border-cyan-400/80 text-cyan-200'
                        : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:border-slate-700'
                    }`}
                    title={p.desc}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[10px] font-bold">{p.label}</span>
                      <Icon className="w-3 h-3 text-amber-400" />
                    </div>
                    <span className="text-[9px] font-mono text-slate-400">{p.timeStr}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Real-time Astronomical Telemetry Grid */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[10px] font-mono">
            <div className="flex flex-col p-2 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-slate-400">Solar Altitude / Elev</span>
              <span className="text-xs font-bold text-amber-300">
                {sunPosition.elevationDeg > 0 ? `+${sunPosition.elevationDeg}°` : `${sunPosition.elevationDeg}°`}
              </span>
              <span className="text-[9px] text-slate-400">
                {sunPosition.elevationDeg > 45 ? 'Short vertical shadows' : sunPosition.elevationDeg > 0 ? 'Dramatic elongated shadows' : 'Night moon shadows'}
              </span>
            </div>

            <div className="flex flex-col p-2 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-slate-400">Solar Azimuth Angle</span>
              <span className="text-xs font-bold text-cyan-300">
                {sunPosition.azimuthDeg}°
              </span>
              <span className="text-[9px] text-slate-400">
                {sunPosition.azimuthDeg > 45 && sunPosition.azimuthDeg < 135
                  ? 'Facing East (Sunrise)'
                  : sunPosition.azimuthDeg >= 135 && sunPosition.azimuthDeg <= 225
                  ? 'Facing South (Midday)'
                  : sunPosition.azimuthDeg > 225 && sunPosition.azimuthDeg < 315
                  ? 'Facing West (Sunset)'
                  : 'Facing North'}
              </span>
            </div>

            <div className="flex flex-col p-2 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-slate-400">Direct Light Intensity</span>
              <span className="text-xs font-bold text-emerald-300">
                {sunPosition.lightIntensity.toFixed(2)}x
              </span>
              <span className="text-[9px] text-slate-400">
                {sunPosition.isDaylight ? 'Full Daylight Lux' : 'Cool Moonlit Lux'}
              </span>
            </div>

            <div className="flex flex-col p-2 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-slate-400">Kurdistan Solar Ephemeris</span>
              <span className="text-xs font-bold text-indigo-300">
                🌅 {sunPosition.sunriseString} • 🌇 {sunPosition.sunsetString}
              </span>
              <span className="text-[9px] text-slate-400">
                Noon: {sunPosition.solarNoonString} AST
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const KurdistanSolarController = HanoiSolarController;

