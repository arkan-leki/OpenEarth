import React, { useState, useRef, useEffect } from 'react';
import { Cloud, CloudRain, MapPin, RotateCw, Compass, Sliders, X, Layers, Sun, Eye, EyeOff, Trees, Globe } from 'lucide-react';
import { ShaderParameters } from '../types';

interface ZoomEarthFloatingControlsProps {
  showClouds: boolean;
  onToggleClouds: () => void;
  showRain: boolean;
  onToggleRain: () => void;
  showPins: boolean;
  onTogglePins: () => void;
  showWorldFeatures?: boolean;
  onToggleWorldFeatures?: () => void;
  is360GroundMode?: boolean;
  onToggle360GroundMode?: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  onResetCamera: () => void;
  params: ShaderParameters;
  onParamsChange: (params: ShaderParameters) => void;
  onOpenSatelliteModal?: () => void;
  isDaytimeMode?: boolean;
  onToggleDaytimeMode?: () => void;
  hideAll?: boolean;
  onToggleHideAll?: () => void;
  /** CesiumJS globe (streamed terrain/imagery) vs the original three.js scene. */
  cesiumGlobe?: boolean;
  onToggleCesiumGlobe?: () => void;
}

export const ZoomEarthFloatingControls: React.FC<ZoomEarthFloatingControlsProps> = ({
  showClouds,
  onToggleClouds,
  showRain,
  onToggleRain,
  showPins,
  onTogglePins,
  showWorldFeatures = true,
  onToggleWorldFeatures,
  is360GroundMode = false,
  onToggle360GroundMode,
  autoRotate,
  onToggleAutoRotate,
  onResetCamera,
  params,
  onParamsChange,
  onOpenSatelliteModal,
  isDaytimeMode = false,
  onToggleDaytimeMode,
  hideAll = false,
  onToggleHideAll,
  cesiumGlobe = false,
  onToggleCesiumGlobe
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    }
    if (settingsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [settingsOpen]);

  // When hideAll is active, only render the floating Eye button to restore everything
  if (hideAll) {
    return (
      <div className="absolute top-4 right-4 z-50 pointer-events-auto">
        <button
          id="btn-toggle-hide-all"
          onClick={onToggleHideAll}
          className="w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border border-emerald-400/70 bg-slate-950/75 hover:bg-slate-900 text-emerald-300 hover:text-white transition-all shadow-xl hover:scale-105 cursor-pointer"
          title="Show All UI & Controls"
        >
          <EyeOff className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Floating Vertical Tool Dock */}
      <div className="absolute top-24 sm:top-24 right-2 sm:right-4 z-30 flex flex-col gap-2 pointer-events-auto">
        {/* Eye Button: Hide All Things (UI Overlays, Panels, Bars & Pins) */}
        {onToggleHideAll && (
          <button
            id="btn-toggle-hide-all"
            onClick={() => {
              setSettingsOpen(false);
              onToggleHideAll();
            }}
            className="w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border border-slate-700/60 bg-slate-950/80 hover:bg-slate-800/90 text-slate-300 hover:text-white transition-all shadow-xl hover:scale-105 cursor-pointer"
            title="Hide All UI & Markers (Clean 3D View)"
          >
            <Eye className="w-5 h-5" />
          </button>
        )}

        {/* Open 2D Satellite & Met Radar Viewer Modal */}
        {onOpenSatelliteModal && (
          <button
            id="btn-dock-open-satellite-modal"
            onClick={onOpenSatelliteModal}
            className="w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border border-cyan-500/60 bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 hover:text-white transition-all shadow-xl hover:scale-105 cursor-pointer"
            title="Inspect Satellite Imagery, Clouds & Rain Radar"
          >
            <Layers className="w-5 h-5" />
          </button>
        )}

        {/* Toggle Daytime Mode (Turns off live datetime mode so you can see clearly at night) */}
        {onToggleDaytimeMode && (
          <button
            id="btn-dock-toggle-daytime"
            onClick={onToggleDaytimeMode}
            className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl cursor-pointer ${
              isDaytimeMode
                ? 'bg-amber-500/25 border-amber-400 text-amber-300 ring-2 ring-amber-400/40 shadow-amber-500/20'
                : 'bg-slate-950/80 border-slate-700/60 text-slate-400 hover:text-white'
            }`}
            title={
              isDaytimeMode
                ? 'Daytime Mode is ON (Direct midday sunlight) • Click to return to Live DateTime mode'
                : 'Daytime Mode is OFF (Live DateTime) • Click to toggle ON daytime mode'
            }
          >
            <Sun className={`w-5 h-5 ${isDaytimeMode ? 'text-amber-400' : 'text-slate-400'}`} />
          </button>
        )}

        {/* Toggle Clouds */}
        <button
          onClick={onToggleClouds}
          className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl ${
            showClouds
              ? 'bg-sky-500/25 border-sky-400 text-sky-300'
              : 'bg-slate-950/80 border-slate-700/60 text-slate-400 hover:text-white'
          }`}
          title="Toggle 3D Clouds"
        >
          <Cloud className="w-5 h-5" />
        </button>

        {/* Toggle Precipitation */}
        <button
          onClick={onToggleRain}
          className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl ${
            showRain
              ? 'bg-blue-500/25 border-blue-400 text-blue-300'
              : 'bg-slate-950/80 border-slate-700/60 text-slate-400 hover:text-white'
          }`}
          title="Toggle Rain & Precipitation"
        >
          <CloudRain className="w-5 h-5" />
        </button>

        {/* Toggle Landmarks */}
        <button
          onClick={onTogglePins}
          className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl cursor-pointer ${
            showPins
              ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300'
              : 'bg-slate-950/80 border-slate-700/60 text-slate-400 hover:text-white'
          }`}
          title="Toggle Landmark Markers"
        >
          <MapPin className="w-5 h-5" />
        </button>

        {/* Toggle 3D Water, Trees & Cities */}
        {onToggleWorldFeatures && (
          <button
            onClick={onToggleWorldFeatures}
            className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl cursor-pointer ${
              showWorldFeatures
                ? 'bg-teal-500/25 border-teal-400 text-teal-300'
                : 'bg-slate-950/80 border-slate-700/60 text-slate-400 hover:text-white'
            }`}
            title="Toggle 3D Water (Lakes & Rivers), Trees & Cities"
          >
            <Trees className="w-5 h-5" />
          </button>
        )}

        {/* Toggle 360° Ground-Level Same-Spot View */}
        {onToggle360GroundMode && (
          <button
            onClick={onToggle360GroundMode}
            className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl font-mono text-[11px] font-black cursor-pointer ${
              is360GroundMode
                ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow-emerald-500/30'
                : 'bg-slate-950/80 border-slate-700/60 text-emerald-300 hover:text-white'
            }`}
            title="Toggle 360° Ground-Level Same-Spot Panorama View"
          >
            360°
          </button>
        )}

        {/* CesiumJS globe: streamed terrain + imagery instead of the hand-rolled three.js scene */}
        {onToggleCesiumGlobe && (
          <button
            id="btn-dock-toggle-cesium"
            onClick={onToggleCesiumGlobe}
            className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl cursor-pointer ${
              cesiumGlobe
                ? 'bg-cyan-500/30 border-cyan-400 text-cyan-100 ring-2 ring-cyan-400/40'
                : 'bg-slate-950/80 border-slate-700/60 text-slate-400 hover:text-white'
            }`}
            title={
              cesiumGlobe
                ? 'CesiumJS globe ON — streamed terrain, imagery and LOD. Click for the three.js scene.'
                : 'CesiumJS globe OFF — click to switch to the streamed CesiumJS globe'
            }
          >
            <Globe className="w-5 h-5" />
          </button>
        )}

        {/* Toggle Cinematic Orbit */}
        <button
          onClick={onToggleAutoRotate}
          className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl ${
            autoRotate
              ? 'bg-amber-500/25 border-amber-400 text-amber-300 animate-spin'
              : 'bg-slate-950/80 border-slate-700/60 text-slate-400 hover:text-white'
          }`}
          style={autoRotate ? { animationDuration: '10s' } : undefined}
          title="Toggle Cinematic Orbit"
        >
          <RotateCw className="w-5 h-5" />
        </button>

        {/* Reset Overview Camera */}
        <button
          onClick={onResetCamera}
          className="w-10 h-10 rounded-2xl flex items-center justify-center bg-slate-950/80 hover:bg-slate-800/80 border border-slate-700/60 text-slate-300 hover:text-white backdrop-blur-xl shadow-xl transition-all"
          title="Reset Camera Overview"
        >
          <Compass className="w-5 h-5" />
        </button>

        {/* Tuning Settings */}
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={`w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-xl border transition-all shadow-xl ${
            settingsOpen
              ? 'bg-purple-500/25 border-purple-400 text-purple-300'
              : 'bg-slate-950/80 border-slate-700/60 text-slate-400 hover:text-white'
          }`}
          title="3D Terrain & Atmospheric Tuning"
        >
          <Sliders className="w-5 h-5" />
        </button>
      </div>

      {/* Settings Modal */}
      {settingsOpen && (
        <div
          ref={modalRef}
          className="absolute top-20 right-16 z-40 w-80 bg-slate-950/95 backdrop-blur-2xl border border-slate-700/80 rounded-2xl p-4 shadow-2xl shadow-black/90 pointer-events-auto"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">3D Environment Tuning</span>
            </div>
            <button
              onClick={() => setSettingsOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4 text-xs">
            {/* Mountain Relief Scale */}
            <div>
              <div className="flex items-center justify-between text-slate-300 mb-1 font-medium">
                <span>Mountain Relief Scale</span>
                <span className="font-mono text-cyan-400 font-bold">
                  {(params.terrainExaggeration ?? 1.25).toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.75"
                max="2.5"
                step="0.05"
                value={params.terrainExaggeration ?? 1.25}
                onChange={(e) =>
                  onParamsChange({ ...params, terrainExaggeration: parseFloat(e.target.value) })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                <span>Gentle (0.75x)</span>
                <span>Realistic (1.25x)</span>
                <span>Exaggerated (2.5x)</span>
              </div>
            </div>

            {/* Cloud Density */}
            <div>
              <div className="flex items-center justify-between text-slate-300 mb-1 font-medium">
                <span>Cloud Density</span>
                <span className="font-mono text-sky-400 font-bold">
                  {params.cloudDensityMultiplier.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={params.cloudDensityMultiplier}
                onChange={(e) =>
                  onParamsChange({ ...params, cloudDensityMultiplier: parseFloat(e.target.value) })
                }
                className="w-full accent-sky-400 cursor-pointer"
              />
            </div>

            {/* Cloud Altitude */}
            <div>
              <div className="flex items-center justify-between text-slate-300 mb-1 font-medium">
                <span>Cloud Base Altitude</span>
                <span className="font-mono text-blue-400 font-bold">
                  {Math.round(params.cloudAltitude)} m
                </span>
              </div>
              <input
                type="range"
                min="2000"
                max="6000"
                step="200"
                value={params.cloudAltitude}
                onChange={(e) =>
                  onParamsChange({ ...params, cloudAltitude: parseFloat(e.target.value) })
                }
                className="w-full accent-blue-400 cursor-pointer"
              />
            </div>

            {/* Wind Speed */}
            <div>
              <div className="flex items-center justify-between text-slate-300 mb-1 font-medium">
                <span>Wind Speed</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {params.windSpeed.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="2.5"
                step="0.1"
                value={params.windSpeed}
                onChange={(e) =>
                  onParamsChange({ ...params, windSpeed: parseFloat(e.target.value) })
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
