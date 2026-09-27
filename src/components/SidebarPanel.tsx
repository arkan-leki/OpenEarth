import React, { useState } from 'react';
import * as THREE from 'three';
import {
  ChevronRight,
  ChevronLeft,
  Minimize2,
  Maximize2,
  X,
  Layers,
  Activity,
  Sliders,
  Sparkles,
  MapPin,
  Image as ImageIcon,
  Clock,
  Cpu
} from 'lucide-react';
import { SpatialGridManager } from './SpatialGridManager';
import { ForecastTimeline } from './ForecastTimeline';
import { SystemStatsAndShader } from './SystemStatsAndShader';
import { RenderedWeatherImageViewer } from './RenderedWeatherImageViewer';
import { WeatherMode, GridChunkData, ShaderParameters, SystemStats } from '../types';
import { SulaymaniyahWeatherPayload } from '../services/weatherService';

interface SidebarPanelProps {
  isMinimized: boolean;
  onToggleMinimize: () => void;
  chunks: GridChunkData[];
  activeChunkIds: Set<string>;
  selectedChunkId: string | null;
  onSelectChunk: (chunk: GridChunkData) => void;
  isSingleChunkMode: boolean;
  onToggleSingleChunkMode: (single: boolean) => void;
  onRenderAll: () => void;
  cacheRadius: number;
  onChangeCacheRadius: (radius: number) => void;
  satelliteLayer: 'nasa' | 'hd';
  currentHourOffset: number;
  onHourOffsetChange: (hour: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackSpeed: number;
  onChangeSpeed: (speed: number) => void;
  shaderParams: ShaderParameters;
  onParamsChange: (params: ShaderParameters) => void;
  onResetParams: () => void;
  stats: SystemStats;
  // Weather Texture & Mode Props for image inspection
  weatherTexture: THREE.Texture;
  weatherMode: WeatherMode;
  selectedHistoryDate: string;
  onSelectHistoryDate?: (date: string) => void;
  weatherPayload?: SulaymaniyahWeatherPayload | null;
  liveCloudSource?: 'openmeteo' | 'nasa';
  onChangeLiveCloudSource?: (source: 'openmeteo' | 'nasa') => void;
}

export const SidebarPanel: React.FC<SidebarPanelProps> = ({
  isMinimized,
  onToggleMinimize,
  chunks,
  activeChunkIds,
  selectedChunkId,
  onSelectChunk,
  isSingleChunkMode,
  onToggleSingleChunkMode,
  onRenderAll,
  cacheRadius,
  onChangeCacheRadius,
  satelliteLayer,
  currentHourOffset,
  onHourOffsetChange,
  isPlaying,
  onTogglePlay,
  playbackSpeed,
  onChangeSpeed,
  shaderParams,
  onParamsChange,
  onResetParams,
  stats,
  weatherTexture,
  weatherMode,
  selectedHistoryDate,
  onSelectHistoryDate,
  weatherPayload,
  liveCloudSource = 'openmeteo',
  onChangeLiveCloudSource
}) => {
  const [isExpandedFull, setIsExpandedFull] = useState(false);
  const [activeTab, setActiveTab] = useState<'image' | 'grid' | 'timeline' | 'shaders' | 'all'>('image');

  return (
    <>
      {/* 1. Minimized Floating Trigger Button (When sidebar is collapsed for clear 3D window) */}
      {isMinimized && (
        <div className="absolute top-16 right-3 sm:right-5 z-30 pointer-events-auto flex flex-col gap-2 items-end">
          <button
            onClick={onToggleMinimize}
            className="flex items-center gap-2 px-3.5 py-2.5 bg-[#0D1117]/95 hover:bg-[#161B22] text-slate-100 hover:text-cyan-300 border border-slate-700/80 hover:border-cyan-500/60 rounded-xl shadow-2xl backdrop-blur-md transition-all group font-mono text-xs touch-manipulation min-h-[44px]"
            title="Open Rendered Weather Image & Spatial Grid Manager"
          >
            <div className="w-2.5 h-2.5 rounded-sm bg-cyan-400 group-hover:scale-125 transition-transform" />
            <span className="font-semibold tracking-wide flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
              <span>RENDERED IMAGE & 16-GRID</span>
            </span>
            <ChevronLeft className="w-4 h-4 text-cyan-400 group-hover:-translate-x-0.5 transition-transform" />
          </button>
        </div>
      )}

      {/* 2. Backdrop Overlay on Mobile (Tapping outside closes the drawer) */}
      {!isMinimized && (
        <div
          onClick={onToggleMinimize}
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-30 md:hidden pointer-events-auto transition-opacity"
        />
      )}

      {/* 3. The Expandable / Minimizable Sidebar Container */}
      <div
        className={`fixed top-0 right-0 h-full z-40 flex flex-col bg-[#0D1117]/95 border-l border-[#30363D] shadow-2xl backdrop-blur-xl transition-all duration-300 ease-in-out pointer-events-auto ${
          isMinimized
            ? 'translate-x-full opacity-0 pointer-events-none'
            : 'translate-x-0 opacity-100'
        } ${
          isExpandedFull
            ? 'w-full md:w-[640px]'
            : 'w-[92vw] sm:w-[460px] md:w-[480px]'
        }`}
      >
        {/* Sidebar Header with Minimize / Maximize Controls */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-3 bg-[#161B22] border-b border-[#30363D] shrink-0 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-3 h-3 rounded-sm bg-gradient-to-tr from-sky-500 to-cyan-300 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-xs font-bold text-slate-100 uppercase tracking-wider font-mono truncate">
                RENDERED IMAGE & METEOROLOGY
              </h2>
              <p className="text-[10px] text-slate-400 font-mono hidden sm:block">
                Active Texture Inspector • 16-Grid • Volumetric Shader
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-2">
            {/* Toggle Full Width Expand / Normal Width */}
            <button
              onClick={() => setIsExpandedFull(!isExpandedFull)}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors hidden sm:flex"
              title={isExpandedFull ? 'Restore Width' : 'Expand Width'}
            >
              {isExpandedFull ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Minimize / Collapse Sidebar Button */}
            <button
              onClick={onToggleMinimize}
              className="p-1.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors flex items-center justify-center min-w-[36px] min-h-[36px]"
              title="Minimize Sidebar (Clear 3D Viewport Window)"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Section Tabs */}
        <div className="flex items-center gap-1 px-3 py-1.5 bg-[#090C10] border-b border-[#21262D] overflow-x-auto scrollbar-none shrink-0 text-[11px] font-mono">
          <button
            onClick={() => setActiveTab('image')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 ${
              activeTab === 'image'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>RENDERED IMAGE</span>
          </button>

          <button
            onClick={() => setActiveTab('grid')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 ${
              activeTab === 'grid'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>16-GRID</span>
          </button>

          <button
            onClick={() => setActiveTab('timeline')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 ${
              activeTab === 'timeline'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>TIMELINE</span>
          </button>

          <button
            onClick={() => setActiveTab('shaders')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 ${
              activeTab === 'shaders'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>SHADERS</span>
          </button>

          <button
            onClick={() => setActiveTab('all')}
            className={`px-2 py-1 rounded-lg font-bold transition-all shrink-0 ml-auto ${
              activeTab === 'all'
                ? 'bg-slate-700 text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Show All Sections in single scroll"
          >
            ALL
          </button>
        </div>

        {/* Scrollable Content: Dedicated Sections based on Active Tab */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden divide-y divide-[#21262D] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {/* SECTION 0: RENDERED WEATHER IMAGE INSPECTOR (User Requested) */}
          {(activeTab === 'image' || activeTab === 'all') && (
            <RenderedWeatherImageViewer
              weatherTexture={weatherTexture}
              weatherMode={weatherMode}
              selectedHistoryDate={selectedHistoryDate}
              onSelectHistoryDate={onSelectHistoryDate}
              currentHourOffset={currentHourOffset}
              weatherPayload={weatherPayload}
              liveCloudSource={liveCloudSource}
              onChangeLiveCloudSource={onChangeLiveCloudSource}
            />
          )}

          {/* SECTION 1: SPATIAL GRID MANAGER (16 SQUARES) */}
          {(activeTab === 'grid' || activeTab === 'all') && (
            <SpatialGridManager
              chunks={chunks}
              activeChunkIds={activeChunkIds}
              selectedChunkId={selectedChunkId}
              onSelectChunk={onSelectChunk}
              cacheRadius={cacheRadius}
              onChangeCacheRadius={onChangeCacheRadius}
              satelliteLayer={satelliteLayer}
              isSingleChunkMode={isSingleChunkMode}
              onToggleSingleChunkMode={onToggleSingleChunkMode}
              onRenderAll={onRenderAll}
            />
          )}

          {/* SECTION 2: FORECAST TIMELINE */}
          {(activeTab === 'timeline' || activeTab === 'all') && (
            <ForecastTimeline
              currentHourOffset={currentHourOffset}
              onHourOffsetChange={onHourOffsetChange}
              isPlaying={isPlaying}
              onTogglePlay={onTogglePlay}
              playbackSpeed={playbackSpeed}
              onChangeSpeed={onChangeSpeed}
            />
          )}

          {/* SECTION 3: SYSTEM STATS & GLSL SHADER EDITOR */}
          {(activeTab === 'shaders' || activeTab === 'all') && (
            <SystemStatsAndShader
              stats={stats}
              params={shaderParams}
              onParamsChange={onParamsChange}
              onResetParams={onResetParams}
            />
          )}
        </div>

        {/* Sidebar Footer with Status */}
        <div className="p-2.5 bg-[#161B22]/90 border-t border-[#30363D] flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-slate-300">GPU PIPELINE: {stats.fps} FPS</span>
          </div>
          <button
            onClick={onToggleMinimize}
            className="text-cyan-400 hover:text-cyan-300 underline text-[10px] uppercase font-semibold"
          >
            Clear Window
          </button>
        </div>
      </div>
    </>
  );
};

