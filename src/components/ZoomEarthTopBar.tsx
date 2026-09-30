import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Globe, MapPin, ChevronDown, ChevronLeft, ChevronRight, Check, Layers, Calendar, Radio, Sparkles, Sun, Wind } from 'lucide-react';
import { KURDISTAN_LANDMARKS } from '../utils/realSulaymaniyahTerrain';
import { Landmark } from '../types';
import { SatelliteSourceMode, getTodayDateIso, LOCAL_NASA_HISTORY_DATES } from '../services/liveSatelliteService';
import { getNowInKurdistan } from '../utils/sunPosition';

interface ZoomEarthTopBarProps {
  onFlyTo: (target: { pos: [number, number, number]; target: [number, number, number] }) => void;
  selectedLandmarkId: string;
  onSelectLandmark: (lm: Landmark) => void;
  currentStationTemp?: number;
  currentStationCondition?: string;
  onOpenSatelliteModal?: () => void;
  satelliteMode?: SatelliteSourceMode;
  onChangeSatelliteMode?: (mode: SatelliteSourceMode) => void;
  satelliteDate?: string;
  onSelectSatelliteDate?: (dateIso: string) => void;
  satelliteCloudCoveragePct?: number;
  isSatelliteCloudLoading?: boolean;
  isTodayPending?: boolean;
  actualPassDate?: string;
  isDaytimeMode?: boolean;
  onToggleDaytimeMode?: () => void;
  onTriggerAdvectionAnim?: () => void;
  metroWindSpeed?: number;
  metroWindDirDeg?: number;
}

export const ZoomEarthTopBar: React.FC<ZoomEarthTopBarProps> = ({
  onFlyTo,
  selectedLandmarkId,
  onSelectLandmark,
  currentStationTemp = 24,
  currentStationCondition = 'Clear',
  onOpenSatelliteModal,
  satelliteMode = 'nasa_today',
  onChangeSatelliteMode,
  satelliteDate = new Date().toISOString().slice(0, 10),
  onSelectSatelliteDate,
  satelliteCloudCoveragePct,
  isSatelliteCloudLoading = false,
  isTodayPending = false,
  actualPassDate,
  isDaytimeMode = false,
  onToggleDaytimeMode,
  onTriggerAdvectionAnim,
  metroWindSpeed,
  metroWindDirDeg
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const datePickerRef = useRef<HTMLDivElement>(null);

  const todayIso = useMemo(() => getTodayDateIso(0), []);
  const yesterdayIso = useMemo(() => getTodayDateIso(-1), []);

  // Generate recent 10 days + confirmed Kurdistan archive dates for quick 1-click selection
  const quickDates = useMemo(() => {
    const list: Array<{ iso: string; label: string; tag: string }> = [];
    for (let i = 0; i <= 9; i++) {
      const iso = getTodayDateIso(-i);
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      const shortStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dayName = dt.toLocaleDateString('en-US', { weekday: 'short' });
      list.push({
        iso,
        label: `${dayName}, ${shortStr}`,
        tag: i === 0 ? 'TODAY' : i === 1 ? 'YESTERDAY' : `-${i}d`
      });
    }
    return list;
  }, []);

  const stepSatelliteDay = (deltaDays: number) => {
    if (!onSelectSatelliteDate) return;
    const [y, m, d] = satelliteDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + deltaDays);
    const nextIso = dt.toISOString().slice(0, 10);
    if (nextIso > todayIso) return;
    onSelectSatelliteDate(nextIso);
  };

  const formattedSelectedSatDate = useMemo(() => {
    if (!satelliteDate) return 'Today';
    if (satelliteDate === todayIso && satelliteMode === 'nasa_today') return 'Today Sat';
    if (satelliteDate === yesterdayIso && satelliteMode === 'nasa_yesterday') return 'Yesterday';
    const [y, m, d] = satelliteDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, [satelliteDate, todayIso, yesterdayIso, satelliteMode]);

  // Live ticking clock in Kurdistan AST (UTC+3) time
  const [liveDate, setLiveDate] = useState<Date>(() => getNowInKurdistan());

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveDate(getNowInKurdistan());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setDatePickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentLandmark = KURDISTAN_LANDMARKS.find(l => l.id === selectedLandmarkId) || KURDISTAN_LANDMARKS[0];

  const handleSelect = (lm: Landmark) => {
    onSelectLandmark(lm);
    setDropdownOpen(false);
  };

  const formattedKurdistanDate = liveDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const formattedKurdistanTime = liveDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return (
    <div className="absolute top-2 left-2 right-2 sm:top-4 sm:left-4 sm:right-4 z-30 pointer-events-none flex flex-wrap items-center justify-between gap-2 select-none">
      {/* Brand, Location Title & Live Today Clock */}
      <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 bg-slate-950/90 backdrop-blur-xl border border-slate-700/80 px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl shadow-2xl">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
          <Globe className="w-4 h-4 sm:w-4.5 sm:h-4.5 animate-spin" style={{ animationDuration: '40s' }} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm font-bold tracking-wide text-white">KURDISTAN • NORTH IRAQ</span>
            <span className="flex items-center gap-1 text-[9px] sm:text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-300 font-bold border border-emerald-500/40">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE TODAY
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-mono text-slate-300">
            <span className="flex items-center gap-1 text-cyan-300 font-semibold">
              <Calendar className="w-3 h-3 text-cyan-400 shrink-0" />
              {formattedKurdistanDate}
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-emerald-400 font-bold">{formattedKurdistanTime} AST</span>
          </div>
        </div>
      </div>

      {/* Center/Right: 3D Map Satellite Source Switcher */}
      {onChangeSatelliteMode && (
        <div className="pointer-events-auto flex flex-wrap items-center bg-slate-950/90 backdrop-blur-xl border border-slate-700/80 p-1 rounded-2xl shadow-xl text-xs font-mono gap-0.5">
          {/* Primary: Real-Time Live Radar & Observations */}
          <button
            id="btn-mode-radar-live"
            onClick={() => onChangeSatelliteMode('radar_live')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              satelliteMode === 'radar_live'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold shadow-md shadow-emerald-500/30 ring-1 ring-emerald-300/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
            title="100% Real-Time Live Doppler Weather Radar (RainViewer) & Live Open-Meteo Observations (Updated every 10 min)"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-300 animate-pulse" />
            <span>Live Radar & Met</span>
            {satelliteMode === 'radar_live' && satelliteCloudCoveragePct !== undefined ? (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/40 text-emerald-200 font-bold border border-emerald-400/30">
                {satelliteCloudCoveragePct}%
              </span>
            ) : (
              <span className="text-[9px] px-1 py-0.2 rounded bg-black/40 text-emerald-300 font-bold border border-emerald-400/30 hidden sm:inline">
                LIVE NOW
              </span>
            )}
          </button>

          {/* NASA Today Daylight Satellite Pass */}
          <button
            id="btn-mode-nasa-today"
            onClick={() => onChangeSatelliteMode('nasa_today')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              satelliteMode === 'nasa_today'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-md shadow-cyan-500/30 ring-1 ring-cyan-300/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
            title="Render Today's NASA VIIRS Daytime Optical Satellite Pass (~11:30 AM AST) & 3D Clouds"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Today Sat</span>
            {satelliteMode === 'nasa_today' && satelliteCloudCoveragePct !== undefined && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/40 text-cyan-200 font-bold border border-cyan-400/30">
                {satelliteCloudCoveragePct}%
              </span>
            )}
            {satelliteMode === 'nasa_today' && isSatelliteCloudLoading && (
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-ping" />
            )}
          </button>

          {/* NASA Yesterday Satellite Pass */}
          <button
            id="btn-mode-nasa-yesterday"
            onClick={() => onChangeSatelliteMode('nasa_yesterday')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              satelliteMode === 'nasa_yesterday'
                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold shadow-md shadow-indigo-500/30 ring-1 ring-indigo-300/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
            title="Render Yesterday's Confirmed NASA Orbital Satellite Pass & 3D Clouds across Kurdistan"
          >
            <Calendar className="w-3.5 h-3.5 text-indigo-300" />
            <span>Yesterday</span>
            {satelliteMode === 'nasa_yesterday' && satelliteCloudCoveragePct !== undefined && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/40 text-indigo-200 font-bold border border-indigo-400/30">
                {satelliteCloudCoveragePct}%
              </span>
            )}
            {satelliteMode === 'nasa_yesterday' && isSatelliteCloudLoading && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 animate-ping" />
            )}
          </button>

          {/* Interactive Any-Date Selector & Day-by-Day Stepper (< Date >) */}
          {onSelectSatelliteDate && (
            <div className="relative flex items-center" ref={datePickerRef}>
              <div
                className={`flex items-center rounded-xl border transition-all ${
                  satelliteDate !== todayIso && satelliteDate !== yesterdayIso && (satelliteMode === 'nasa_today' || satelliteMode === 'nasa_yesterday')
                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold border-violet-300/50 shadow-md shadow-violet-500/30'
                    : 'bg-slate-900/90 border-slate-700/80 text-slate-200 hover:border-cyan-400/50'
                }`}
              >
                <button
                  id="btn-prev-sat-day"
                  onClick={() => stepSatelliteDay(-1)}
                  className="px-1.5 py-1.5 hover:bg-white/10 rounded-l-xl text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Previous Day Satellite Pass (-1 Day)"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <button
                  id="btn-open-date-picker"
                  onClick={() => setDatePickerOpen((prev) => !prev)}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] sm:text-xs font-mono cursor-pointer hover:bg-white/5"
                  title="Select any historical date to render NASA Satellite Clouds & Weather"
                >
                  <Calendar className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                  <span>{ satelliteDate }</span>
                  {satelliteDate !== todayIso &&
                    satelliteDate !== yesterdayIso &&
                    satelliteCloudCoveragePct !== undefined && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/40 text-fuchsia-200 font-bold border border-fuchsia-300/30">
                        {satelliteCloudCoveragePct}%
                      </span>
                    )}
                  <ChevronDown className={`w-3 h-3 opacity-75 transition-transform ${datePickerOpen ? 'rotate-180' : ''}`} />
                </button>

                <button
                  id="btn-next-sat-day"
                  onClick={() => stepSatelliteDay(1)}
                  disabled={satelliteDate >= todayIso}
                  className={`px-1.5 py-1.5 rounded-r-xl transition-colors ${
                    satelliteDate >= todayIso
                      ? 'text-slate-600 cursor-not-allowed'
                      : 'hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer'
                  }`}
                  title="Next Day Satellite Pass (+1 Day)"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Dropdown Calendar & Historical Pass Selector */}
              {datePickerOpen && (
                <div className="absolute top-full mt-2 left-0 sm:left-auto sm:right-0 w-72 bg-slate-950/95 backdrop-blur-2xl border border-slate-700/90 rounded-2xl shadow-2xl p-3 z-50 text-left">
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                      Select Satellite Pass Date
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {formattedSelectedSatDate}
                    </span>
                  </div>

                  {/* Custom Calendar Date Input */}
                  <div className="mb-3">
                    <label className="block text-[10px] text-slate-400 mb-1">
                      Pick Any Custom Date (NASA GIBS Archive):
                    </label>
                    <input
                      type="date"
                      value={satelliteDate}
                      max={todayIso}
                      min="2012-01-01"
                      onChange={(e) => {
                        if (e.target.value) {
                          onSelectSatelliteDate(e.target.value);
                          setDatePickerOpen(false);
                        }
                      }}
                      className="w-full bg-slate-900 border border-slate-700 hover:border-cyan-400/60 focus:border-cyan-400 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono outline-none cursor-pointer"
                    />
                  </div>

                  {/* Quick Recent 10 Days */}
                  <div className="mb-2.5">
                    <div className="text-[10px] text-slate-400 mb-1 font-semibold">
                      Recent Daily Passes:
                    </div>
                    <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto pr-0.5">
                      {quickDates.map((item) => {
                        const active = satelliteDate === item.iso;
                        return (
                          <button
                            key={item.iso}
                            onClick={() => {
                              onSelectSatelliteDate(item.iso);
                              setDatePickerOpen(false);
                            }}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-[10px] font-mono transition-all cursor-pointer border ${
                              active
                                ? 'bg-cyan-500/25 border-cyan-400 text-white font-bold'
                                : 'bg-slate-900/70 border-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                            }`}
                          >
                            <span className="truncate">{item.label}</span>
                            <span className="text-[9px] px-1 rounded bg-black/40 text-cyan-300 ml-1 shrink-0">
                              {item.tag}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pre-Verified Kurdistan Cloud Archive Passes */}
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1 font-semibold">
                      Confirmed Kurdistan Cloud Passes:
                    </div>
                    <div className="grid grid-cols-2 gap-1 max-h-28 overflow-y-auto pr-0.5">
                      {LOCAL_NASA_HISTORY_DATES.map((iso) => {
                        const active = satelliteDate === iso;
                        return (
                          <button
                            key={iso}
                            onClick={() => {
                              onSelectSatelliteDate(iso);
                              setDatePickerOpen(false);
                            }}
                            className={`flex items-center justify-between px-2 py-1 rounded-lg text-[10px] font-mono transition-all cursor-pointer border ${
                              active
                                ? 'bg-indigo-500/30 border-indigo-400 text-white font-bold'
                                : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                            }`}
                          >
                            <span>{iso}</span>
                            {active && <Check className="w-3 h-3 text-indigo-300" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Clean HD Base Terrain */}
          <button
            id="btn-mode-hd-base"
            onClick={() => onChangeSatelliteMode('hd_base')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
              satelliteMode === 'hd_base'
                ? 'bg-slate-700 text-white font-bold shadow-md ring-1 ring-slate-400/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
            title="High-definition static Northern Iraq & Kurdistan terrain orthomosaic basemap"
          >
            <span>HD Base</span>
          </button>
        </div>
      )}

      {/* Right Controls: Animate to Metro + Daytime Toggle + Satellite & Radar Modal Button + Landmark Dropdown */}
      <div className="pointer-events-auto flex items-center gap-2">
        {/* Animate Clouds: NASA → Live Metro button */}
        {onTriggerAdvectionAnim && (
          <button
            id="btn-animate-clouds-to-metro"
            onClick={onTriggerAdvectionAnim}
            className="flex items-center gap-1.5 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-2xl bg-gradient-to-r from-emerald-950/85 to-teal-950/85 hover:from-emerald-900/90 hover:to-teal-900/90 text-emerald-300 hover:text-white border border-emerald-500/40 hover:border-emerald-400 text-xs sm:text-sm font-semibold shadow-xl backdrop-blur-xl transition-all cursor-pointer group"
            title="Animate NASA satellite clouds flowing to the current Open-Meteo position based on live wind"
          >
            <Wind className="w-3.5 h-3.5 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
            <span className="hidden md:inline">Animate to Metro</span>
            <span className="md:hidden">Flow</span>
            {metroWindSpeed !== undefined && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/40 text-emerald-200 font-mono border border-emerald-400/30">
                {metroWindSpeed} km/h
              </span>
            )}
          </button>
        )}

        {/* Daytime / Datetime Mode Toggle Button */}
        {onToggleDaytimeMode && (
          <button
            id="btn-toggle-daytime-mode"
            onClick={onToggleDaytimeMode}
            className={`flex items-center gap-1.5 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-2xl transition-all border text-xs sm:text-sm font-semibold shadow-xl backdrop-blur-xl cursor-pointer ${
              isDaytimeMode
                ? 'bg-amber-500/25 border-amber-400 text-amber-300 ring-1 ring-amber-400/50 shadow-amber-500/20'
                : 'bg-slate-950/85 hover:bg-slate-900 border-slate-700/70 text-slate-300 hover:text-white hover:border-slate-500'
            }`}
            title={
              isDaytimeMode
                ? 'Daytime Mode is ON (Direct midday sun) • Click to return to Live DateTime mode'
                : 'Daytime Mode is OFF (Live DateTime) • Click to turn ON daytime lighting'
            }
          >
            <Sun className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isDaytimeMode ? 'text-amber-400 animate-spin-slow' : 'text-slate-400'}`} />
            <span>Daytime:</span>
            <span className={`font-mono font-bold text-xs ${isDaytimeMode ? 'text-amber-300' : 'text-slate-400'}`}>
              {isDaytimeMode ? 'ON' : 'OFF'}
            </span>
          </button>
        )}

        {onOpenSatelliteModal && (
          <button
            id="btn-open-satellite-radar-modal"
            onClick={onOpenSatelliteModal}
            className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 sm:px-4 sm:py-2.5 bg-gradient-to-r from-cyan-950/90 to-slate-950/90 hover:from-cyan-900/95 hover:to-slate-900/95 text-cyan-300 hover:text-white backdrop-blur-xl border border-cyan-500/50 hover:border-cyan-400 rounded-2xl text-xs sm:text-sm font-semibold shadow-xl transition-all touch-manipulation cursor-pointer group"
            title="Inspect Satellite Imagery, Clouds & Rain Radar"
          >
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 group-hover:rotate-12 transition-transform" />
            <span className="hidden xs:inline">Satellite & Radar</span>
            <span className="xs:hidden">Imagery</span>
          </button>
        )}

        {/* Fly-To Landmark Dropdown & Quick Selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            id="btn-landmark-dropdown-toggle"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 bg-slate-950/85 hover:bg-slate-900 backdrop-blur-xl border border-slate-700/70 rounded-2xl text-xs sm:text-sm font-medium text-slate-100 shadow-xl transition-all touch-manipulation cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" />
            <span className="font-semibold text-white truncate max-w-[100px] sm:max-w-[160px]">
              {currentLandmark.name}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu */}
          {dropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-64 sm:w-72 bg-slate-950/95 backdrop-blur-2xl border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden py-1.5 z-40">
              <div className="px-3 py-1.5 text-[10px] font-mono uppercase text-slate-400 font-bold border-b border-slate-800">
                Kurdistan Landmarks
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {KURDISTAN_LANDMARKS.map((lm) => {
                  const isSelected = selectedLandmarkId === lm.id;
                  return (
                    <button
                      key={lm.id}
                      onClick={() => handleSelect(lm)}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                      }`}
                    >
                      <div className="truncate">
                        <div className="text-xs truncate">{lm.name}</div>
                        {lm.subLabel && (
                          <div className="text-[10px] text-slate-400 truncate">{lm.subLabel}</div>
                        )}
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
