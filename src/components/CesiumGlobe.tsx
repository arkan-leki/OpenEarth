import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createLiveTerrainProvider, getTerrainStats } from '../services/cesiumTerrainService';
import { BaseMapId, createBaseMapLayer, createLabelLayer } from '../services/cesiumBaseMaps';
import {
  CloudMaskExtent,
  createCloudOverlay,
  createTiledEumetsatLayer,
  createPolarCloudLayer
} from '../services/cesiumClouds';
import {
  resolveEumetsatFrameTime,
  fetchEumetsatCloudMaskExtent,
  IODC_DISC_BBOX,
  FES_WEST_BBOX
} from '../services/eumetsatService';

/**
 * A painted Cesium Earth.
 *
 * The 3D volumetric clouds are gone. At globe scale they were the most expensive and least
 * informative thing in the app: a few translucent blobs standing in for a cloud field that a
 * satellite image already describes exactly. Painting real observations onto the globe is both
 * cheaper and more honest.
 *
 * THE STACK, bottom to top:
 *   0  HD satellite imagery   (Esri World Imagery — keyless)
 *   1  Cloud deck             (EUMETSAT cloud mask, painted white where cloudy)
 *   2  Precipitation          (EUMETSAT h63, transparent where dry — the radar paint)
 *   +  Terrain                (streamed terrarium tiles, no token)
 *   +  Sky                    (SkyAtmosphere + star box + real sun/moon)
 *
 * Everything above the base streams as tiles, and only for the area on screen.
 */

const HOME_LON = 44.0;
const HOME_LAT = 36.19;
/** ~3.5 Earth radii: far enough that the whole globe reads on first load. */
const HOME_HEIGHT_M = 22_000_000;

/** Kurdistan is UTC+3, so local noon is 09:00 UTC. */
function kurdistanNoonUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 0, 0));
}

export interface GlobeStatus {
  ready: boolean;
  cloudCoveragePct: number | null;
  frameTime: Date | null;
  terrainTiles: number;
  terrainFailed: number;
}

interface CesiumGlobeProps {
  baseMap: BaseMapId;
  /** Paint the EUMETSAT cloud mask exactly as published. */
  showClouds: boolean;
  /** Paint the EUMETSAT precipitation estimate — the radar layer. */
  showPrecip: boolean;
  /** City labels and boundaries, drawn over everything else. */
  showLabels: boolean;
  /** Date for the NASA imagery layers, `YYYY-MM-DD`. */
  nasaDate: string;
  showSky: boolean;
  lighting: boolean;
  dayMode: 'live' | 'noon';
  /** How far back to ask EUMETSAT for a frame: 0 = live, 6 = six hours ago, and so on. */
  frameHoursAgo: number;
  onStatus?: (status: GlobeStatus) => void;
}

const EUMETVIEW_CREDIT = 'EUMETSAT Meteosat IODC';

export const CesiumGlobe: React.FC<CesiumGlobeProps> = ({
  baseMap,
  showClouds,
  showPrecip,
  showLabels,
  nasaDate,
  showSky,
  lighting,
  dayMode,
  frameHoursAgo,
  onStatus
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [coveragePct, setCoveragePct] = useState<number | null>(null);
  const [frameTime, setFrameTime] = useState<Date | null>(null);
  /** One cloud overlay per satellite disc — two discs cover far more of the planet than one. */
  const [overlays, setOverlays] = useState<{
    clouds: Array<{ canvas: HTMLCanvasElement; extent: CloudMaskExtent }>;
  }>({ clouds: [] });

  // ---- Viewer construction: once per mount ------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    host.style.position = 'absolute';
    host.style.inset = '0';
    container.appendChild(host);

    let viewer: Cesium.Viewer | null = null;

    try {
      viewer = new Cesium.Viewer(host, {
        baseLayer: createBaseMapLayer('esri'),
        terrainProvider: createLiveTerrainProvider(),
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: false,
        useBrowserRecommendedResolution: true
      });

      /**
       * Camera limits and zoom speed.
       *
       * `zoomFactor` is a MULTIPLIER FOR SPEED, not a step size — higher is faster. Cesium
       * defaults it to 5.0. An earlier attempt set it to 2.0 reading it as "gentler steps",
       * which literally halved-plus the zoom speed and made zooming feel sluggish. It is 10
       * here: twice Cesium's default, which is decisive without overshooting.
       *
       * The distance limits replace Cesium's defaults (1 m and infinity) so zoom-out stops at
       * a sensible whole-Earth view instead of receding indefinitely.
       */
      const controller = viewer.scene.screenSpaceCameraController;
      controller.minimumZoomDistance = 5;
      controller.maximumZoomDistance = 4.5e7;
      controller.zoomFactor = 10;
      controller.enableCollisionDetection = true;

      const scene = viewer.scene;
      scene.globe.baseColor = Cesium.Color.fromCssColorString('#0d1524');
      scene.globe.depthTestAgainstTerrain = true;
      scene.skyAtmosphere.show = true;
      scene.globe.showGroundAtmosphere = true;
      scene.fog.enabled = true;
      if (scene.skyBox) scene.skyBox.show = true;
      scene.sun.show = true;
      scene.moon.show = true;

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(HOME_LON, HOME_LAT, HOME_HEIGHT_M)
      });

      viewerRef.current = viewer;
      setError(null);
      setReady(true);
    } catch (err) {
      console.error('[Cesium] globe failed to initialise:', err);
      setError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
      setReady(false);
    };
  }, []);

  // ---- Resolve which frame to paint, re-run whenever the requested time changes -------------
  useEffect(() => {
    let current = true;
    setFrameTime(null);
    setCoveragePct(null);

    (async () => {
      const t = await resolveEumetsatFrameTime(frameHoursAgo);
      if (!current || !t) return;
      setFrameTime(t);

      // The two products are decoded once per frame time and rebuilt into transparent
      // overlays. They are single images rather than tile layers, so this is two fetches per
      // time change, not a stream.
      // Both discs, in parallel, from the same published frame time.
      const [iodc, fes] = await Promise.all([
        fetchEumetsatCloudMaskExtent(t, IODC_DISC_BBOX, 1024, 1024),
        fetchEumetsatCloudMaskExtent(t, FES_WEST_BBOX, 1024, 1024, 0, 'msg_fes:clm')
      ]);
      if (!current) return;

      setCoveragePct(iodc?.coveragePct ?? null);
      setOverlays({
        clouds: [
          ...(iodc ? [{ canvas: iodc.canvas, extent: IODC_DISC_BBOX as CloudMaskExtent }] : []),
          ...(fes ? [{ canvas: fes.canvas, extent: FES_WEST_BBOX as CloudMaskExtent }] : [])
        ]
      });
    })().catch((err) => console.warn('[Cesium] overlay data unavailable:', err));

    return () => {
      current = false;
    };
  }, [frameHoursAgo]);

  // ---- The paint stack ----------------------------------------------------------------------
  //
  // Built as ONE ordered stack. Adding the base clears the layer collection, so separate
  // effects would wipe each other whenever the base or the frame time changed.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready || viewer.isDestroyed()) return;

    const layers = viewer.imageryLayers;
    layers.removeAll();

    // 0 — the ground.
    layers.add(createBaseMapLayer(baseMap, nasaDate), 0);
    let index = 1;

    /**
     * Weather paint is shown ONLY over the satellite ground.
     *
     * The NASA layers are whole-day composites from one instrument; the EUMETSAT paint is a
     * single 15-minute frame from another. Overlaying them would put a rain field on a map from
     * a different day, with nothing on screen to say so — misleading in a way that silence makes
     * worse. In the NASA modes the imagery stands alone.
     */
    const paintAllowed = baseMap === 'esri';

    // 1 — GLOBAL cloud from the polar orbiter, so no part of the planet is left bare.
    if (paintAllowed && showClouds && frameTime) {
      // Correct attribution: this layer is Metop, not Meteosat.
      layers.add(createPolarCloudLayer(frameTime, 'EUMETSAT Metop (polar orbiter)'), index++);
    }

    // 2 — cloud mask, one overlay per disc: white, transparent, green removed. Painted over the
    // polar layer because inside its discs it is the more precise product.
    if (paintAllowed && showClouds) {
      for (const disc of overlays.clouds) {
        const cloud = createCloudOverlay(disc.canvas, disc.extent, EUMETVIEW_CREDIT, 0.9);
        if (cloud) layers.add(cloud, index++);
      }
    }

    // 3 — precipitation: EUMETSAT's own image pasted on, desaturated. Nothing else applied.
    if (paintAllowed && showPrecip && frameTime) {
      layers.add(
        createTiledEumetsatLayer('msg_iodc:h63', frameTime, IODC_DISC_BBOX, EUMETVIEW_CREDIT, true),
        index++
      );
    }

    // 4 — labels last, so place names read on top of cloud and rain rather than under them.
    if (showLabels) layers.add(createLabelLayer(), index++);
  }, [baseMap, nasaDate, frameTime, showClouds, showPrecip, showLabels, overlays, ready]);

  // ---- Sky, sun and relief ------------------------------------------------------------------
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;
    scene.skyAtmosphere.show = showSky;
    if (scene.skyBox) scene.skyBox.show = showSky;
    scene.sun.show = showSky;
    scene.moon.show = showSky;
    scene.fog.enabled = showSky;
    scene.globe.showGroundAtmosphere = showSky;
  }, [showSky, ready]);

  /**
   * Live day/night. Cesium shades the globe from the real sun, so the ground genuinely darkens
   * and brightens as the terminator sweeps past — driven by the clock set below, which follows
   * real time unless noon mode is on.
   *
   * `dynamicAtmosphereLightingFromSun` makes the air glow track the sun as well, so the whole
   * scene shifts together rather than the ground darkening under a permanently lit sky.
   */
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const globe = viewer.scene.globe;
    globe.enableLighting = lighting;
    globe.dynamicAtmosphereLighting = lighting;
    globe.dynamicAtmosphereLightingFromSun = true;
    // Keep lit ground near full brightness; the darkness should come from the terminator, not
    // from a blanket dimming of the day side.
    globe.lambertDiffuseMultiplier = 0.9;
  }, [lighting, ready]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.clock.currentTime =
      dayMode === 'noon'
        ? Cesium.JulianDate.fromDate(kurdistanNoonUtc())
        : Cesium.JulianDate.now();
  }, [dayMode, ready]);

  // ---- Report status upward for the HUD -----------------------------------------------------
  useEffect(() => {
    if (!ready) {
      onStatusRef.current?.({
        ready: false,
        cloudCoveragePct: null,
        frameTime: null,
        terrainTiles: 0,
        terrainFailed: 0
      });
      return;
    }

    const emit = () => {
      const stats = getTerrainStats();
      onStatusRef.current?.({
        ready: true,
        cloudCoveragePct: coveragePct,
        frameTime,
        terrainTiles: stats.loaded,
        terrainFailed: stats.failed
      });
    };

    emit();
    const interval = setInterval(emit, 1000);
    return () => clearInterval(interval);
  }, [ready, frameTime, coveragePct]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#07090E]/95 p-6">
          <div className="max-w-lg text-center">
            <div className="text-rose-300 font-bold text-sm mb-2">CesiumJS globe failed to start</div>
            <pre className="text-[11px] text-rose-200/80 whitespace-pre-wrap font-mono">{error}</pre>
            <div className="text-[11px] text-slate-400 mt-3">
              Check the browser console — Cesium logs the underlying WebGL/tile error there.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
