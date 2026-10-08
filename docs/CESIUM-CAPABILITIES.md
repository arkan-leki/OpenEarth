# Building the best real-world globe with CesiumJS

Everything CesiumJS 1.146 offers for this app, what we already use, and what is still
available. Every API named here was checked against the installed
`node_modules/cesium/Source/Cesium.d.ts`, not recalled from documentation.

---

## 1. What we already use

| Capability | API |
|---|---|
| Imagery layers | `ImageryLayer`, `WebMapServiceImageryProvider`, `UrlTemplateImageryProvider`, `SingleTileImageryProvider` |
| Per-layer colour control | `layer.brightness` / `contrast` / `saturation` / `hue` / `gamma` / `alpha` |
| Terrain | `CustomHeightmapTerrainProvider` (streamed terrarium tiles, no token) |
| Sky | `SkyAtmosphere`, `SkyBox`, `Sun`, `Moon`, `Fog` |
| Lighting | `globe.enableLighting`, `dynamicAtmosphereLighting`, `dynamicAtmosphereLightingFromSun`, `lambertDiffuseMultiplier` |
| Weather at altitude | Entities with `rectangle` + `ImageMaterialProperty` |
| Camera | `camera.setView` / `flyTo`, `ScreenSpaceCameraController`, `verticalExaggeration` |
| Interaction | `ScreenSpaceEventHandler`, `scene.pick` |
| Entities | points, labels, rectangles |

---

## 2. Imagery and data sources

**Providers available:** WMS, WMTS, `UrlTemplate`, ArcGIS, OSM, Bing, Google, TMS,
`SingleTile`, ion. Custom providers by subclassing `ImageryProvider`.

**Time-dynamic imagery** — NOT YET USED, highest-value gap:
`WebMapServiceImageryProvider` accepts both `clock` and `times: TimeIntervalCollection`.
Cesium then animates through the frames itself, driven by `viewer.clock`. Combined with the
built-in `Timeline` and `Animation` widgets (currently disabled), this replaces our four
hand-rolled LIVE/6H/12H/24H buttons with a real scrubber and play/pause.

**Mapbox Vector Tiles (MVT)** — NOT YET USED:
`MVTDataProvider` is present and typed in 1.146, so vector basemaps are possible — crisp
borders and labels at any zoom instead of raster tiles. (`buildVectorGltfFromMVT` also
appears in the shipped bundle but is NOT in the type definitions, so treat it as unsupported
surface.)

**Keyless imagery sources verified working in this project:**

| Source | What | Global? |
|---|---|---|
| Esri World Imagery | HD satellite mosaic, ~0.3–1 m in places | yes |
| NASA GIBS `VIIRS_SNPP_CorrectedReflectance_TrueColor` | daily true colour | yes |
| NASA GIBS `MODIS_Terra_Cloud_Fraction_Day` | cloud fraction, rainbow ramp, **no published legend** | yes |
| NASA GIBS `IMERG_Precipitation_Rate` | precipitation, 23–27% coverage measured | yes |
| NASA GIBS `IMERG_Precipitation_Rate_30min` | near-live precipitation — returned 0% at one test timestamp, timing unresolved | yes |
| NASA GIBS **GOES-East / GOES-West `ABI_GeoColor`** | true colour by day, IR + city lights by night | Americas, Pacific |
| NASA GIBS **`Himawari_AHI_Band13_Clean_Infrared`** | IR, no GeoColor published for Himawari | east Asia |
| EUMETSAT `msg_iodc:clm` / `msg_fes:clm` | cloud classification, `min(R,G,B)` isolates cloud exactly | two discs |
| EUMETSAT `msg_iodc:h63` | precipitation estimate | IODC disc only |
| EUMETSAT `eps:m01_ir108` | Metop polar IR — every longitude, but swaths and hours old | yes |
| EUMETSAT/Copernicus `daily_sentinel3ab_olci_l1_rgb_fulres` | **daily global true-colour composite, 2.4 MB, Sentinel-3 ~300 m** | **yes, single layer** |
| EUMETSAT `backgrounds:ne_background` | Natural Earth global reference map | yes |
| OSM / Carto / OpenTopoMap | street and terrain maps | yes |

**Unused EUMETSAT products found:** `msg_iodc:cth` (cloud top height),
`mtg_fd:rgb_cloudtype` / `rgb_cloudphase` (cloud classification from the newer
Meteosat Third Generation), `mtg_fd:li_afa` (Lightning Imager), `msg_fes:h60b`
(possible precipitation equivalent for the 0° disc — untested).

---

## 3. Terrain

- `sampleTerrain` / `sampleTerrainMostDetailed` — query real heights
- `scene.verticalExaggeration` — relief multiplier
- `ClippingPlaneCollection` — slice the globe or tilesets
- Providers: `CesiumTerrainProvider`, ArcGIS, Google, `Cesium3DTilesTerrainProvider`

---

## 4. Sky, atmosphere and light

- `ShadowMap` + `globe.shadows` — **real terrain shadows from the sun.** Not yet used;
  this is the honest fix for terrain reading as flat.
- `scene.postProcessStages.exposure`, `tonemapper` — HDR control
- `SkyBox`, `SkyAtmosphere` tunables: `atmosphereLightIntensity`,
  `atmosphereRayleighCoefficient`, `brightnessShift`, `hueShift`, `saturationShift`

---

## 5. Weather rendering — the technique ladder

| Technique | Status | Notes |
|---|---|---|
| Draped imagery layers | superseded | always paints ON the surface; wrong for weather |
| Altitude sheets (entities) | **in use** | what we do now, 3–20 km |
| **Depth occlusion** | available to borrow | sample `depthTexture`, reconstruct world position with `czm_windowToEyeCoordinates`, clip the weather pass at the opaque surface. Solves weather drawing through mountains — which we currently hack around with `depthTestAgainstTerrain = false` |
| **Beer Shadow Maps** | available to borrow | camera-following cascades storing front depth / mean extinction / max optical depth per light ray; terrain evaluates Beer–Lambert transmission → **real cloud shadows on the ground** |
| `ParticleSystem` + emitters | not used | animated rain/snow; `ConeEmitter`, `SphereEmitter`, `CircleEmitter`, `ParticleBurst` |
| `CloudCollection` / `CumulusCloud` | used and removed | billboard-based; unsuitable for global fields |
| `VoxelPrimitive` | not usable yet | no concrete `VoxelProvider` ships — you implement one and supply real 3D volume data. Our imagery is 2D |

**The key insight from `tatsuya-ogawa/cesium-volumetric-clouds`:** the depth and shadow
techniques are **data-agnostic** — they need a density field, not noise. Its own clouds are
procedural three-octave noise (synthesised weather, which this project rejected twice), but
its **occlusion and shadow machinery can be driven by our real cloud mask**.

---

## 6. Geometry and entities

- **Entity API** — points, billboards, labels, polylines, polygons, rectangles, ellipses,
  walls, corridors, cylinders, boxes, models (glTF)
- **Primitive API** — high-performance batched geometry
- `GroundPrimitive` / `ClassificationPrimitive` — shapes that **conform to terrain**
- Data sources: `CzmlDataSource` (**time-dynamic scenes**), `GeoJsonDataSource`,
  `KmlDataSource`, `CustomDataSource`
- 3D Tiles, glTF/GLB, Gaussian splats

---

## 7. Post-processing

Built in, one line each:
```js
scene.postProcessStages.fxaa
scene.postProcessStages.ambientOcclusion
scene.postProcessStages.bloom
scene.postProcessStages.exposure
```

Factory stages: blur, brightness, depth of field, **lens flare**, night vision,
silhouette, edge detection, black and white.

---

## 8. Time

- `Clock` with `clockRange`, `clockStep`, `multiplier`, `shouldAnimate`
- **`Timeline` and `Animation` widgets** — both currently disabled
- `TimeIntervalCollection` driving time-dynamic imagery
- CZML — Cesium's own format for time-dynamic scenes, so a weather timeline could be
  described as data rather than wired by hand

---

## 9. Camera and interaction

- `flyTo`, `setView`, `lookAt`, `HeadingPitchRange`, `computeViewRectangle`
- `ScreenSpaceCameraController` — `zoomFactor` (speed multiplier; Cesium default 5.0),
  min/max zoom distance, inertia, collision detection
- Scene modes: `SCENE2D`, `SCENE3D`, `COLUMBUS_VIEW`, morphing between them
- Geolocation → `flyTo` (implemented)

---

## 10. Performance

- `RequestScheduler` throttling, `globe.maximumScreenSpaceError`
- `useBrowserRecommendedResolution`
- `FrameRateMonitor`, `PerformanceDisplay`
- Texture discipline: our overlay cap is 2048 px; the stitched 2×2 disc fetch renders
  8.8 km/px, the Kurdistan patch 1.3 km/px

---

## 11. Priority plan

| # | Change | Effort | Payoff |
|---|---|---|---|
| 1 | **Time-dynamic imagery + Timeline/Animation widgets** | medium | real animated scrubber replaces 4 buttons; built in |
| 2 | **Bloom + FXAA + ambient occlusion** | ~10 lines | large visual gain, very low risk |
| 3 | **ShadowMap** — terrain shadows | small | honest fix for "terrain looks flat" |
| 4 | **Depth occlusion for weather sheets** | medium | weather stops drawing through mountains |
| 5 | **Cloud shadows from the real mask** (Beer maps) | large | measured cloud casting real shadows |
| 6 | **ParticleSystem rain/snow** | small–medium | restores motion the paint cannot show |
| 7 | **MVT vector borders and labels** | medium | crisp vector cartography |
| 8 | Wire `mtg_fd:rgb_cloudtype` | small | cloud classification from the newer satellite |
| 9 | Wire Sentinel-3 daily global composite | small | one layer, whole planet, ~300 m |
| 10 | `sampleTerrain` for ground-anchored placement | small | sit things on real ground |

---

## 12. Known limits

- **Geostationary physics.** Meteosat sees 45% of longitudes; four satellites (EUMETSAT +
  GOES-East/West + Himawari) tile the full 360°. Verified: the regions EUMETSAT returns
  0.0% for, GOES and Himawari return 100%.
- **No global cloud classification exists keylessly.** GIBS cloud-fraction products use an
  undocumented colour ramp; guessing it produces invented weather. EUMETSAT's `clm` is a
  real classification but disc-only.
- **Rain and geostationary imagery come from different spacecraft.** Measuring
  precipitation needs microwave sensors on polar orbiters, which is why no geostationary
  satellite publishes a radar layer.
- **Cesium for Unreal is a different product** — a native Unreal Engine plugin, not usable
  in this browser app. Post-processing is available here via CesiumJS instead.
- **ion-hosted assets** (Bing imagery, World Terrain, OSM Buildings, Google Photorealistic
  3D Tiles) all require a token, which this project avoids.
