import React, { useState } from 'react';
import { Sliders, Code2, Cpu, Activity, Zap, RefreshCw } from 'lucide-react';
import { SystemStats, ShaderParameters } from '../types';

interface SystemStatsAndShaderProps {
  stats: SystemStats;
  params: ShaderParameters;
  onParamsChange: (newParams: ShaderParameters) => void;
  onResetParams: () => void;
}

export const SystemStatsAndShader: React.FC<SystemStatsAndShaderProps> = ({
  stats,
  params,
  onParamsChange,
  onResetParams
}) => {
  const [activeTab, setActiveTab] = useState<'shader' | 'params'>('shader');

  // Helper for radial circular arc SVG gauge
  const renderRadialGauge = (
    value: number,
    max: number,
    color: string,
    label: string,
    subValue: string
  ) => {
    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(1, Math.max(0, value / max));
    const strokeDashoffset = circumference - progress * (circumference * 0.75); // 270 degree arc

    return (
      <div className="flex items-center gap-3 bg-[#0D1117]/80 p-2 rounded border border-slate-800/80">
        <div className="relative w-11 h-11 flex items-center justify-center shrink-0">
          <svg className="w-11 h-11 -rotate-135" viewBox="0 0 44 44">
            {/* Background track */}
            <circle
              cx="22"
              cy="22"
              r={radius}
              className="stroke-slate-800"
              strokeWidth="3.5"
              fill="transparent"
              strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
              strokeLinecap="round"
            />
            {/* Progress arc */}
            <circle
              cx="22"
              cy="22"
              r={radius}
              stroke={color}
              strokeWidth="3.5"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-500 ease-out"
            />
          </svg>
          <Activity className="w-3.5 h-3.5 absolute text-slate-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase font-mono text-slate-400 font-semibold tracking-wide">
            {label}
          </div>
          <div className="text-xs font-mono font-bold text-slate-200 truncate">
            {subValue}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="pb-6">
      {/* Section Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161B22]/80 border-y border-[#30363D]">
        <div className="text-xs font-bold tracking-wider text-slate-200 uppercase font-mono">
          3. SYSTEM STATS & GLSL SHADER EDITOR
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('shader')}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'shader'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            GLSL
          </button>
          <button
            onClick={() => setActiveTab('params')}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'params'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            TUNING
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
        {/* Left Column: STATS (Matching Screenshot with 3 Arc Gauges) */}
        <div className="md:col-span-5 flex flex-col gap-2">
          <div className="text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider mb-1">
            STATS
          </div>

          {/* Gauge 1: Data Texture Size */}
          {renderRadialGauge(
            512,
            1024,
            '#38bdf8', // sky blue
            'DATA TEXTURE',
            `SIZE ${stats.textureResolution}x${stats.textureResolution}`
          )}

          {/* Gauge 2: RAM Usage */}
          {renderRadialGauge(
            stats.ramUsageGb,
            2.0,
            '#f59e0b', // amber / orange
            'RAM USAGE:',
            `${stats.ramUsageGb.toFixed(1)}GB`
          )}

          {/* Gauge 3: Chunk Cache */}
          {renderRadialGauge(
            stats.activeChunksCount,
            stats.totalChunksCount,
            '#10b981', // emerald green
            'CHUNK CACHE:',
            `${stats.activeChunksCount}/${stats.totalChunksCount}`
          )}
        </div>

        {/* Right Column: SHADER (Matching Screenshot Code View or Param Sliders) */}
        <div className="md:col-span-7 flex flex-col">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 font-bold uppercase tracking-wider mb-1">
            <span>SHADER</span>
            {activeTab === 'params' && (
              <button
                onClick={onResetParams}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 font-normal lowercase"
                title="Reset Parameters"
              >
                <RefreshCw className="w-3 h-3" /> reset
              </button>
            )}
          </div>

          {activeTab === 'shader' ? (
            /* Syntax-Styled GLSL Snippet Matching Screenshot */
            <div className="h-full min-h-[160px] bg-[#0A0D12] rounded-lg border border-[#30363D] p-3 font-mono text-[11px] leading-relaxed overflow-x-auto shadow-inner select-text">
              <div className="text-slate-500">// VOLUMETRIC RAYMARCHING CLOUD SHADER</div>
              <div className="text-slate-500">// Samples: density(X,Y,Z), light_scattering</div>
              <div className="text-slate-500 mb-2">// Local precipitation based on uWeatherData.g</div>

              <div>
                <span className="text-purple-400">void </span>
                <span className="text-blue-300">main</span>
                <span className="text-slate-300">() {'{'}</span>
              </div>
              <div className="pl-3 text-slate-300">
                <span className="text-purple-400">const </span>
                <span className="text-sky-300">vec3</span> u_pos = density(X, Y, Z);
              </div>
              <div className="pl-3 text-slate-300">
                <span className="text-purple-400">int</span> steps = <span className="text-amber-300">{params.raymarchSteps}</span>;
              </div>
              <div className="pl-3 text-slate-300">
                <span className="text-purple-400">float</span> scatter = <span className="text-amber-300">{params.sunScatterIntensity.toFixed(1)}</span>;
              </div>
              <div className="pl-3 text-slate-300">
                <span className="text-purple-400">float</span> density_mult = <span className="text-amber-300">{params.cloudDensityMultiplier.toFixed(2)}</span>;
              </div>
              <div className="pl-3 text-slate-300">
                <span className="text-purple-400">for</span> (int i = 0; i &lt; steps; i++) {'{'}
              </div>
              <div className="pl-6 text-slate-300">
                uWeatherData = <span className="text-yellow-300">texture2D</span>(uWeather, uv);
              </div>
              <div className="pl-6 text-slate-300">
                <span className="text-emerald-400">if</span> (uWeatherData.g &gt; {params.rainThreshold}) spawn_rain();
              </div>
              <div className="pl-3 text-slate-300">{'}'}</div>
              <div className="text-slate-300">{'}'}</div>
            </div>
          ) : (
            /* Live Shader Parameter Tuning Sliders */
            <div className="bg-[#0A0D12] rounded-lg border border-[#30363D] p-3 space-y-2.5 font-mono text-[11px]">
              {/* Quick Preset Buttons */}
              <div className="grid grid-cols-2 gap-1.5 pt-1 pb-1">
                <button
                  onClick={() => onParamsChange({
                    ...params,
                    raymarchSteps: 64,
                    cloudDensityMultiplier: 1.5,
                    sunScatterIntensity: 1.6,
                    cloudAltitude: 2400,
                    cloudThickness: 2000,
                    absorptionFactor: 0.55
                  })}
                  className="py-1 px-2 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 text-[10px] font-bold text-center transition-colors"
                >
                  ☁️ Puffy Cumulus
                </button>
                <button
                  onClick={() => onParamsChange({
                    ...params,
                    raymarchSteps: 72,
                    cloudDensityMultiplier: 2.2,
                    sunScatterIntensity: 1.8,
                    cloudAltitude: 1600,
                    cloudThickness: 11000,
                    absorptionFactor: 0.70
                  })}
                  className="py-1 px-2 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold text-center transition-colors"
                >
                  ⛈️ Anvil Storm
                </button>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Raymarch Steps</span>
                  <span className="text-sky-400 font-bold">{params.raymarchSteps}</span>
                </div>
                <input
                  type="range"
                  min="24"
                  max="96"
                  step="8"
                  value={params.raymarchSteps}
                  onChange={(e) => onParamsChange({ ...params, raymarchSteps: parseInt(e.target.value) })}
                  className="w-full h-1 bg-slate-700 rounded accent-sky-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Cloud Density Mult</span>
                  <span className="text-sky-400 font-bold">{params.cloudDensityMultiplier.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="3.5"
                  step="0.05"
                  value={params.cloudDensityMultiplier}
                  onChange={(e) => onParamsChange({ ...params, cloudDensityMultiplier: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-slate-700 rounded accent-sky-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Sunlight Scattering</span>
                  <span className="text-amber-400 font-bold">{params.sunScatterIntensity.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.1"
                  value={params.sunScatterIntensity}
                  onChange={(e) => onParamsChange({ ...params, sunScatterIntensity: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-slate-700 rounded accent-amber-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Wind Velocity</span>
                  <span className="text-emerald-400 font-bold">{params.windSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="3.0"
                  step="0.1"
                  value={params.windSpeed}
                  onChange={(e) => onParamsChange({ ...params, windSpeed: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-slate-700 rounded accent-emerald-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Mountain Relief Scale</span>
                  <span className="text-purple-400 font-bold">{(params.terrainExaggeration ?? 1.25).toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.05"
                  value={params.terrainExaggeration ?? 1.25}
                  onChange={(e) => onParamsChange({ ...params, terrainExaggeration: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-slate-700 rounded accent-purple-400 cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
