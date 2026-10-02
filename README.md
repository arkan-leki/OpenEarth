# OpenEarth — Kurdistan Volumetric Weather Simulation

A real-time, 3D weather visualisation of **Kurdistan & Northern Iraq**. It renders a
curved-Earth terrain segment built from a real digital elevation model, drives
raymarched volumetric clouds from live Open-Meteo telemetry, and drapes real NASA
satellite imagery over the ground.

This is a **weather-research and visualisation tool**, not a game or a map viewer. The
point is to see the region's *actual* weather — clouds, rain, snow, fog, dust, and sun
position — rendered from live, real data.

## What it does

- **Live weather** — fetches current + hourly Open-Meteo observations across 12 named
  Kurdistan stations plus a 220 km sampling lattice covering the full map.
- **Volumetric clouds** — a raymarched cloud field sampled from a multi-channel weather
  texture (`R` = cloud density, `G` = rain, `B` = temperature, `A` = lightning).
- **Real satellite imagery** — NASA GIBS VIIRS (SNPP / NOAA-20) and MODIS (Terra / Aqua)
  true-colour passes, fetched live per terrain chunk.
- **Radar** — RainViewer Doppler radar overlaid in "Live Radar" mode.
- **Terrain** — a 1600 km LOD grid (16 non-uniform chunks) displaced from a 4096² DEM,
  with Earth-curvature drop and a rim taper.
- **64 landmarks** across Iraq, Turkey, Syria, Iran, the Levant and the Caucasus, with a
  360° ground-level camera mode and a sun-position / time-of-day controller.

## Data sources

| Data | Source | Notes |
| --- | --- | --- |
| Weather | [Open-Meteo](https://open-meteo.com/) forecast & archive APIs | `timezone=Asia/Baghdad`, refreshed every 10 min |
| Satellite | [NASA GIBS](https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs) WMS | VIIRS SNPP / NOAA-20, MODIS Terra / Aqua, EPSG:4326 |
| Radar | [RainViewer](https://www.rainviewer.com/) public API | Slippy-map tiles stitched to the domain |
| Elevation | Mapzen / AWS *terrarium* DEM (zoom 9) | Pre-decoded to `public/data/erbil_map_dem.bin` (4096×4096, Int16 metres) |

The rendered domain is an 800 km-radius circle centred on Erbil
(lon 35.1°–52.9°, lat 29.0°–43.4°).

## How it works (pipeline)

1. **Ingest** — `weatherService` pulls Open-Meteo current + hourly data and normalises it
   into `KurdistanWeatherPayload`.
2. **Weather texture** — `weatherDataPipeline.createWeatherDataTexture()` writes a
   1024² `DataTexture` with cloud / rain / temperature / lightning channels.
3. **Satellite clouds** — `satelliteCloudService.loadLiveSatelliteCloudPass()` loads the
   day's NASA pass and extracts cloud cover, snow, fog and dust.
4. **Per-chunk imagery** — `chunkSatelliteService` requests each terrain chunk's own
   GIBS bounding box so every region gets full sensor resolution.
5. **Render** — `WeatherSimulationView` (three.js via `@react-three/fiber`) raymarches the
   clouds and displaces terrain vertices with the DEM in a custom `onBeforeCompile` shader.

Satellite modes: **HD Base** (clean orthomosaic), **NASA Today**, **NASA Yesterday**,
**Live Radar**.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build → dist/
npm run lint     # type-check (tsc --noEmit)
```

It's a static Vite app — `dist/` can be served from any static host (GitHub Pages, etc.).

## Known limitations

- **Water bodies render as depressions.** The DEM contains spurious sub-sea-level values
  in the Black Sea / Caspian / Persian Gulf (minimum −2589 m, deeper than any real surface
  point). They are clamped to −440 m, but seas still appear as pits rather than flat water.
  The Kurdistan *landmass* itself is accurately elevated (peaks reach ~5570 m ≈ Damavand).
- **"Today" may show yesterday's pass.** NASA polar-orbiter imagery for the current day is
  often not published yet; the app transparently falls back to the latest available pass.
- **Ground radar is sparse over Iraq.** RainViewer coverage depends on ground stations, so
  "Live Radar" is frequently empty in this region.
- **Large bundle** (~1.5 MB JS) — single chunk, no code-splitting yet.

## Project status

The codebase was re-grounded in 2025: the type-check (`tsc --noEmit`) is clean, a
humidity field bug that silently fixed the cloud-base LCL at 40 % was corrected, frozen
2026-09 archive dates were replaced with dynamic dates, and the legacy Vietnam/Hanoi
naming was removed in favour of Kurdish names throughout.
