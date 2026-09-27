const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

const outDir = path.join(__dirname, '../public/tiles/nasa_history');
const refPath = path.join(__dirname, '../public/tiles/north_iraq_hd_satellite.jpg');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function fetchTile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

// 10 dates from 2026-09-06 to 2026-09-15
const DATES = [
  '2026-09-15',
  '2026-09-14',
  '2026-09-13',
  '2026-09-12',
  '2026-09-11',
  '2026-09-10',
  '2026-09-09',
  '2026-09-08',
  '2026-09-07',
  '2026-09-06',
];

const xs = [157, 158, 159, 160, 161];
const ys = [99, 100, 101, 102];

async function processDate(date, refData) {
  const jpgFile = path.join(outDir, `${date}.jpg`);
  const cloudFile = path.join(outDir, `${date}_clouds.png`);

  let stitchedBuffer;
  if (fs.existsSync(jpgFile)) {
    stitchedBuffer = fs.readFileSync(jpgFile);
  } else {
    console.log(`[FETCH] Processing date ${date}...`);
    const tilePromises = [];
    const coords = [];

    for (let r = 0; r < ys.length; r++) {
      for (let c = 0; c < xs.length; c++) {
        const y = ys[r];
        const x = xs[c];
        const url = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/8/${y}/${x}.jpg`;
        coords.push({ r, c });
        tilePromises.push(fetchTile(url).catch(err => {
          console.warn(`Tile fetch failed (${date} x=${x} y=${y}):`, err.message);
          return null;
        }));
      }
    }

    const buffers = await Promise.all(tilePromises);
    const composites = [];

    for (let i = 0; i < buffers.length; i++) {
      const buf = buffers[i];
      if (buf) {
        composites.push({
          input: buf,
          top: coords[i].r * 256,
          left: coords[i].c * 256
        });
      }
    }

    if (composites.length === 0) {
      console.warn(`No tiles available for ${date}`);
      return;
    }

    stitchedBuffer = await sharp({
      create: {
        width: 1280,
        height: 1024,
        channels: 3,
        background: { r: 160, g: 145, b: 120 }
      }
    }).composite(composites).jpeg({ quality: 85 }).toBuffer();

    await sharp(stitchedBuffer).toFile(jpgFile);
    console.log(`[SAVED] ${date}.jpg (${stitchedBuffer.length} bytes)`);
  }

  // Extract cloud mask using Ground Reference Subtraction & Spectral Filtration
  const { data, info } = await sharp(stitchedBuffer).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const rawCloud = Buffer.alloc(w * h * 4);

  let cloudPixelCount = 0;

  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];

    const rRef = refData[i * 3];
    const gRef = refData[i * 3 + 1];
    const bRef = refData[i * 3 + 2];

    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const lumRef = 0.299 * rRef + 0.587 * gRef + 0.114 * bRef;
    const diffLum = lum - lumRef;

    // 1. Sand rejection: sand has high red and low blue
    const isSand = (r - b > 20) || (r > 1.15 * b);

    // 2. City / Ground rejection: permanent features have small diff from reference
    const isPermanentGround = diffLum < 24;

    let cloudDensity = 0;
    if (!isSand && !isPermanentGround && lum > 168 && b > 152 && Math.min(r, g, b) > 145) {
      const factor = Math.min(1.0, (lum - 168) / 45.0) * Math.min(1.0, (diffLum - 20) / 30.0);
      cloudDensity = Math.min(255, Math.round(Math.pow(factor, 0.75) * 255));
    }

    if (cloudDensity > 35) cloudPixelCount++;

    const idx = i * 4;
    rawCloud[idx] = cloudDensity;     // R: Pure Cloud Density
    rawCloud[idx + 1] = 0;            // G: Dust (0 for clear ground)
    rawCloud[idx + 2] = Math.round(lum); // B
    rawCloud[idx + 3] = cloudDensity; // A: Opacity
  }

  // Spatial smoothing for cohesive giant cloud masses
  const smoothed = await sharp(rawCloud, { raw: { width: w, height: h, channels: 4 } })
    .blur(1.5)
    .png()
    .toBuffer();

  fs.writeFileSync(cloudFile, smoothed);
  const cloudCoveragePct = Math.round((cloudPixelCount / (w * h)) * 100);
  console.log(`[MASK] ${date}_clouds.png generated (Cloud cover: ${cloudCoveragePct}%)`);
}

async function run() {
  console.log('Starting NASA 10-day history generation with Ground Reference Subtraction...');
  const refBuf = await sharp(refPath).raw().toBuffer({ resolveWithObject: true });
  const refData = refBuf.data;
  const metadata = [];

  for (const d of DATES) {
    try {
      await processDate(d, refData);
      metadata.push({
        date: d,
        image: `/tiles/nasa_history/${d}.jpg`,
        clouds: `/tiles/nasa_history/${d}_clouds.png`
      });
    } catch (e) {
      console.error(`Error processing ${d}:`, e);
    }
  }

  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify({ dates: DATES, items: metadata }, null, 2)
  );
  console.log('NASA 10-day history metadata written to index.json.');
}

run();
