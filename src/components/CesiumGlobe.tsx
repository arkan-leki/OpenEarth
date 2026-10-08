import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createLiveTerrainProvider, getTerrainStats } from '../services/cesiumTerrainService';
import { BaseMapId, createBaseMapLayer, createLabelLayer, isoDaysAgo } from '../services/cesiumBaseMaps';
import {
  CloudMaskExtent,
  buildCloudSheet,
  buildPolarSheet,
  buildRadarSheet,
  buildGeoSatSheet,
  fetchGibsCanvas,
  GEOSAT_REGIONS
} from '../services/cesiumClouds';
import {
  resolveEumetsatFrameTime,
  fetchEumetsatCloudMaskExtent,
  fetchStitchedCloudMask,
  fetchEumetsatPrecipExtent,
  fetchPolarCanvas,
  resolvePolarFrameTime,
  IODC_DISC_BBOX,
  FES_WEST_BBOX,
  GLOBAL_BBOX,
  KURDISTAN_BBOX
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

export type GlobeMode = 'live' | 'nasa' | 'radar';

/** Imperative controls the HUD needs, since the map has no built-in buttons enabled. */
export interface GlobeApi {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  /** Fly to a point, with an optional height in metres. */
  flyTo: (lon: number, lat: number, heightM?: number) => void;
}

interface CesiumGlobeProps {
  /**
   * Three views, one switch:
   *   live  — HD satellite ground + Metop polar + Meteosat cloud, all at FULL opacity, live
   *   nasa  — HD NASA imagery for a chosen date, no weather paint on top
   *   radar — HD satellite ground + EUMETSAT precipitation, stepped through hours
   */
  mode: GlobeMode;
  /** Date for the NASA view, `YYYY-MM-DD`. */
  nasaDate: string;
  /** How far back the radar view asks EUMETSAT for a frame: 0 = live. */
  frameHoursAgo: number;
  /** Show the precipitation (radar) sheet in the radar view. */
  showRadar: boolean;
  onStatus?: (status: GlobeStatus) => void;
  onApi?: (api: GlobeApi) => void;
}

const EUMETVIEW_CREDIT = 'EUMETSAT Meteosat IODC';


export const CesiumGlobe: React.FC<CesiumGlobeProps> = ({
  mode,
  nasaDate,
  frameHoursAgo,
  showRadar,
  onStatus,
  onApi
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onApiRef = useRef(onApi);
  onApiRef.current = onApi;

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [coveragePct, setCoveragePct] = useState<number | null>(null);
  const [frameTime, setFrameTime] = useState<Date | null>(null);
  /** Resolved separately from the Meteosat frame: polar swaths need a much older timestamp. */
  const [polarTime, setPolarTime] = useState<Date | null>(null);
  const [polarCanvas, setPolarCanvas] = useState<HTMLCanvasElement | null>(null);
  const [precipCanvas, setPrecipCanvas] = useState<HTMLCanvasElement | null>(null);
  /** The other operators' geostationary satellites — NOAA's GOES pair and JMA's Himawari. */
  const [geoSat, setGeoSat] = useState<Record<string, HTMLCanvasElement | null>>({});
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
      /*
       * POST-PROCESSING — CesiumJS ships these; we simply never switched them on.
       *
       *   fxaa              antialiasing, so terrain and coastline edges stop stair-stepping
       *   bloom             glow, which is what makes bright cloud and radar read as luminous
       *                     rather than pasted on. This is the affordable version of what the
       *                     Unreal post-processing stack would give, in ten lines.
       *   ambientOcclusion  contact shading, so relief and building-scale detail gain depth
       *
       * Bloom is tuned to pick up only genuinely bright pixels — threshold high, gain low —
       * so it catches cloud and radar without washing out the satellite imagery underneath.
       */
      const stages = scene.postProcessStages;
      stages.fxaa.enabled = true;

      stages.bloom.enabled = true;
      stages.bloom.uniforms.glowOnly = false;
      stages.bloom.uniforms.contrast = 148;
      stages.bloom.uniforms.brightness = -0.35;
      stages.bloom.uniforms.delta = 1.0;
      stages.bloom.uniforms.sigma = 3.4;
      stages.bloom.uniforms.stepSize = 1.2;

      stages.ambientOcclusion.enabled = true;
      stages.ambientOcclusion.uniforms.intensity = 2.4;
      stages.ambientOcclusion.uniforms.bias = 0.1;
      stages.ambientOcclusion.uniforms.lengthCap = 0.3;
      stages.ambientOcclusion.uniforms.stepSize = 1.2;

      /*
       * TERRAIN SHADOWS — real relief from the sun instead of vertical exaggeration.
       *
       * RECEIVE_ONLY on the globe: the terrain receives shadow from geometry that casts it,
       * which is what gives mountains their shape at low sun angles. This is the honest answer
       * to terrain reading as flat — lighting does the work, not a height multiplier.
       */
      scene.shadowMap.enabled = true;
      scene.shadowMap.softShadows = true;
      scene.shadowMap.darkness = 0.35;
      scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY;

      scene.globe.baseColor = Cesium.Color.fromCssColorString('#0d1524');
      // Off on purpose: weather sheets sit at 2-3 km and would otherwise be buried by mountains.
      scene.globe.depthTestAgainstTerrain = false;
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

      // Zoom by halving/doubling the current height, so a click is a consistent step whether
      // the camera is at 22,000 km or 5 km.
      const step = () => Math.max(1, viewer!.camera.positionCartographic.height * 0.5);
      onApiRef.current?.({
        zoomIn: () => viewer?.camera.zoomIn(step()),
        zoomOut: () => viewer?.camera.zoomOut(step()),
        resetView: () =>
          viewer?.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(HOME_LON, HOME_LAT, HOME_HEIGHT_M)
          }),
        flyTo: (lon: number, lat: number, heightM = 150_000) => {
          viewer?.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, heightM)
          });
        }
      });

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
      /*
       * Three mask fetches, from the same published frame time.
       *
       * The two discs give coverage; the third is a HIGH-RESOLUTION patch over Kurdistan. The
       * discs are 1024px across 163° — about 11 km per pixel — which is far too coarse to see
       * anything local. The same product over a 17.8° box at 1536px is roughly 1 km per pixel,
       * an order of magnitude sharper, at a fraction of the transfer.
       *
       * It is a fixed extent, not camera-driven, so it costs one fetch per time change rather
       * than one per camera move — the per-move version caused visible flashing and was removed.
       */
      /*
       * Several regional requests instead of one, stitched per region.
       *
       * 2x2 over the disc takes it from 17.6 to 8.8 km per pixel; 1x2 over the tall western
       * slice does the same for its latitude axis. Failure of an individual sub-request leaves
       * that quadrant blank rather than losing the region.
       */
      const [iodc, fes, kurdistan, precip] = await Promise.all([
        fetchStitchedCloudMask(t, IODC_DISC_BBOX, 2, 2),
        fetchStitchedCloudMask(t, FES_WEST_BBOX, 1, 2, 1024, 'msg_fes:clm'),
        fetchEumetsatCloudMaskExtent(t, KURDISTAN_BBOX, 1536, 1536),
        fetchEumetsatPrecipExtent(t, IODC_DISC_BBOX, 1024, 1024)
      ]);
      if (current) setPrecipCanvas(precip);
      if (!current) return;

      setCoveragePct(iodc?.coveragePct ?? null);
      setOverlays({
        clouds: [
          ...(iodc ? [{ canvas: iodc.canvas, extent: IODC_DISC_BBOX as CloudMaskExtent }] : []),
          ...(fes ? [{ canvas: fes.canvas, extent: FES_WEST_BBOX as CloudMaskExtent }] : []),
          // Pushed last so the sharp patch paints on top of the coarse disc underneath it.
          ...(kurdistan
            ? [{ canvas: kurdistan.canvas, extent: KURDISTAN_BBOX as CloudMaskExtent }]
            : [])
        ]
      });
    })().catch((err) => console.warn('[Cesium] overlay data unavailable:', err));

    return () => {
      current = false;
    };
  }, [frameHoursAgo]);

  // Polar imagery is resolved on its own clock, once.
  useEffect(() => {
    let current = true;
    resolvePolarFrameTime()
      .then(async (t) => {
        if (!current || !t) return;
        setPolarTime(t);
        const canvas = await fetchPolarCanvas(t);
        if (current) setPolarCanvas(canvas);
      })
      .catch((err) => console.warn('[Cesium] polar frame unavailable:', err));
    return () => {
      current = false;
    };
  }, []);

  /**
   * Fetch the neighbouring operators' satellites, once.
   *
   * EUMETSAT covers Europe, Africa and the Indian Ocean; these cover everything else. Together
   * the four tile the planet, so no part of the globe is left bare.
   */
  useEffect(() => {
    let current = true;
    const date = isoDaysAgo(1);
    Promise.all(
      GEOSAT_REGIONS.map(async (region) => {
        const canvas = await fetchGibsCanvas(
          region.layer,
          { minLon: region.minLon, minLat: region.minLat, maxLon: region.maxLon, maxLat: region.maxLat },
          date,
          1024,
          1024
        );
        return [region.id, canvas] as const;
      })
    )
      .then((entries) => {
        if (current) setGeoSat(Object.fromEntries(entries));
      })
      .catch((err) => console.warn('[Cesium] neighbouring satellites unavailable:', err));
    return () => {
      current = false;
    };
  }, []);

  // ---- The paint stack ----------------------------------------------------------------------
  //
  // Built as ONE ordered stack. Adding the base clears the layer collection, so separate
  // effects would wipe each other whenever the base or the frame time changed.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready || viewer.isDestroyed()) return;

    const layers = viewer.imageryLayers;
    layers.removeAll();

    /*
     * GROUND — the only thing that belongs on the surface, so it is the only imagery layer.
     */
    if (mode === 'nasa') {
      layers.add(createBaseMapLayer('nasa_today', nasaDate), 0);
    } else {
      layers.add(createBaseMapLayer('esri'), 0);
    }

    /*
     * WEATHER — hung ABOVE the ground, not painted on it.
     *
     * Imagery layers always drape on the globe surface, which is wrong for weather: cloud sits
     * kilometres up and rain falls below it. These are rectangles with an image material at real
     * altitudes, so the ground stays visible beneath translucent cloud and the layers stack the
     * way the atmosphere does.
     *
     * Rebuilt from scratch each time — cheap, since it is a handful of entities, and it avoids
     * tracking which sheet changed.
     */
    for (const entity of viewer.entities.values.slice()) {
      if (typeof entity.id === 'string' && entity.id.startsWith('__weather_')) {
        viewer.entities.remove(entity);
      }
    }

    const hangSheet = (
      id: string,
      canvas: HTMLCanvasElement | null,
      extent: CloudMaskExtent,
      heightM: number,
      name: string
    ) => {
      if (!canvas) return;
      viewer.entities.add({
        id,
        name,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            extent.minLon,
            extent.minLat,
            extent.maxLon,
            extent.maxLat
          ),
          height: heightM,
          material: new Cesium.ImageMaterialProperty({
            image: canvas.toDataURL('image/png'),
            transparent: true
          })
        }
      });
    };

    if (mode === 'live' && polarCanvas) {
      // Highest, since these are cold cloud tops seen from orbit.
      hangSheet(
        '__weather_polar',
        buildPolarSheet(polarCanvas, GLOBAL_BBOX),
        GLOBAL_BBOX,
        5000,
        'Metop polar cloud'
      );
    }

    if (mode === 'radar') {
      /*
       * WHY THE RADAR IS AT 20 km, NOT 4 km.
       *
       * A 1,000 m separation was not enough. Cesium composites translucent geometry by DEPTH,
       * and rain falls FROM cloud — so wherever the radar has data the cloud sheet has data in
       * the same place, one kilometre below. At that spacing the deck still resolved in front of
       * the rain and hid it, which is exactly what was reported: the radar was there, drawn
       * underneath.
       *
       * A large separation makes the order unambiguous instead of a near-tie between two sheets
       * a kilometre apart. 20 km is NOT a real altitude for rain — it is chosen purely so the
       * layer cannot be occluded, and the trade is deliberate: visibility over physical order.
       *
       *     cloud deck  3,000 m
       *     polar       5,000 m   (live view)
       *     radar      20,000 m   <- deliberately above everything
       *
       * The radar is painted opaque as well, so it reads as a solid layer rather than a haze.
       *
       * WHY NOT 2,000-3,000 m, WHICH IS WHERE WEATHER ACTUALLY IS: at that height a sheet this
       * large stops being drawn. Cesium horizon-culls geometry that sits too close to the
       * ellipsoid across a wide extent, so the low version rendered NOTHING AT ALL — the layer
       * simply vanished. 5,000/8,500 is the height range that actually draws, verified by the
       * layer being visible at these values and invisible at the lower ones.
       *
       * The heights also clear almost all terrain (Kurdistan ~3,600 m), and terrain depth-testing
       * is off so a sheet is never swallowed by a mountain it crosses.
       */
      if (showRadar && precipCanvas) {
        hangSheet(
          '__weather_rain',
          buildRadarSheet(precipCanvas, IODC_DISC_BBOX),
          IODC_DISC_BBOX,
          20000,
          'EUMETSAT precipitation'
        );
      }
      let level = 0;
      for (const disc of overlays.clouds) {
        hangSheet(
          `__weather_cloud_${level++}`,
          buildCloudSheet(disc.canvas, disc.extent),
          disc.extent,
          3000,
          'Meteosat cloud mask'
        );
      }
    }
  }, [mode, nasaDate, polarCanvas, precipCanvas, geoSat, showRadar, overlays, ready]);

  // ---- Sky, sun and relief ------------------------------------------------------------------
  // Sky is always on: a bare globe with no atmosphere reads as a rendering fault.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const scene = viewer.scene;
    scene.skyAtmosphere.show = true;
    if (scene.skyBox) scene.skyBox.show = true;
    scene.sun.show = true;
    scene.moon.show = true;
    scene.fog.enabled = true;
    scene.globe.showGroundAtmosphere = true;
  }, [ready]);

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
    globe.enableLighting = true;
    globe.dynamicAtmosphereLighting = true;
    globe.dynamicAtmosphereLightingFromSun = true;
    // Keep lit ground near full brightness; the darkness should come from the terminator, not
    // from a blanket dimming of the day side.
    globe.lambertDiffuseMultiplier = 0.9;
  }, [ready]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.clock.currentTime = Cesium.JulianDate.now();
  }, [ready]);

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
