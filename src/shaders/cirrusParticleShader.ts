/**
 * Satellite-Faithful Multi-Layered Geometry Shell Shader (Strategy 1)
 * & Clustered Cumulus Particle Billboard Shader (Strategy 3)
 *
 * Strictly renders ONLY what is present in the NASA / RainViewer satellite pass (uWeatherData):
 * - Zero fake high clouds over clear sky
 * - Zero upwind/crosswind artificial padding
 * - 100% locked to the exact satellite UV footprint and wind advection vector
 *
 * Implements:
 * 1. MultiLayerCloudShellShader:
 *    - Low-Level Stratus & Stratocumulus cellular blankets + Zagros Mountain Gravity Wave bands
 *    - Thin, wispy Cirrus/Cirrostratus stretched UV filaments ONLY on thin semi-transparent fringes
 *      where ground features remain visible beneath them
 * 2. ClusteredCumulusBillboardShader:
 *    - THREE.InstancedMesh alpha-blended cumulus puffs spawned strictly inside satellite-detected
 *      cumulus clusters (1,900m - 3,200m MSL) with Beer's Law top-lit / dark-bottom shading.
 */
import * as THREE from 'three';

export const MultiLayerCloudShellShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uTransitionProgress: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uSunColor: { value: new THREE.Color('#fffdf8') },
    uSkyColor: { value: new THREE.Color('#476487') },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uWindSpeed: { value: 0.8 },
    uLayerType: { value: 0.0 }, // 0.0 = Low/Mid Stratus & Gravity Wave Shell, 1.0 = Thin Wispy Cirrus Fringe Shell
    uShellAltitude: { value: 2150.0 }
  },

  vertexShader: `
    precision highp float;

    uniform float uShellAltitude;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vec3 pos = position;
      // Subtle planetary shell curvature across the 240km x 160km domain
      float r2 = (pos.x * pos.x + pos.z * pos.z) / (140000.0 * 140000.0);
      pos.y = uShellAltitude - r2 * 180.0;

      vec4 wp = modelMatrix * vec4(pos, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,

  fragmentShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform float uTransitionProgress;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform vec2 uWindDir;
    uniform float uWindSpeed;
    uniform float uLayerType;

    varying vec2 vUv;
    varying vec3 vWorldPos;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise2D(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbmShell(vec2 p) {
      float v = 0.0;
      float amp = 0.52;
      mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
      for (int i = 0; i < 5; i++) {
        v += amp * noise2D(p);
        p = rot * p * 2.04 + vec2(7.3, 13.1);
        amp *= 0.48;
      }
      return v;
    }

    void main() {
      // Exact same satellite UV advection as CloudShader so shells never drift away from real clouds
      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec2 advectedXZ = vWorldPos.xz - dynamicDrift;
      vec2 satUv = clamp(vec2(
        (advectedXZ.x + 120000.0) / 240000.0,
        (advectedXZ.y + 80000.0) / 160000.0
      ), 0.002, 0.998);

      // Domain edge fade
      vec2 edgeNorm = abs(vWorldPos.xz) / vec2(120000.0, 80000.0);
      float domainFade = smoothstep(1.0, 0.88, edgeNorm.x) * smoothstep(1.0, 0.88, edgeNorm.y);
      if (domainFade <= 0.005) discard;

      vec4 w = texture2D(uWeatherData, satUv);
      float prog = clamp(uTransitionProgress, 0.0, 1.0);
      float satHaze = w.r * prog;
      float satCore = w.a * prog;

      // Strictly discard if satellite sees clear sky
      if (satHaze < 0.015) discard;

      vec2 driftedKm = advectedXZ * 0.00018;
      float alpha = 0.0;
      float structure = 0.5;

      if (uLayerType < 0.5) {
        // SHELL 0: Low/Mid Stratus, Stratocumulus Cellular Blanket & Mountain Gravity Waves
        float stratusMask = smoothstep(0.02, 0.22, satHaze);
        float fbm = fbmShell(driftedKm * 2.4);
        // Parallel Gravity Wave ripple bands formed over the Zagros mountain ranges
        float gravityWaves = 0.5 + 0.5 * sin((advectedXZ.x * 0.0024 + advectedXZ.y * 0.0010) + fbm * 3.6);
        // Open/closed-cell Stratocumulus honeycomb pattern
        float cell = 1.0 - abs(noise2D(driftedKm * 5.2) * 2.0 - 1.0);
        structure = fbm * 0.50 + gravityWaves * 0.30 + cell * 0.20;

        alpha = stratusMask * smoothstep(0.24, 0.78, structure) * satHaze * 0.38 * domainFade;
      } else {
        // SHELL 1: Thin Wispy Cirrus / Cirrostratus Filaments
        // ONLY rendered on thin, semi-transparent satellite cloud fringes (0.015 < satHaze < 0.32)
        // where ground features remain clearly visible beneath them
        float thinFringeMask = smoothstep(0.015, 0.08, satHaze) * (1.0 - smoothstep(0.22, 0.48, satCore));
        if (thinFringeMask <= 0.01) discard;

        // Stretch UV coordinates strongly along wind-shear direction to simulate wispy ice crystals
        vec2 shearDir = normalize(vec2(-uWindDir.y, uWindDir.x));
        vec2 stretchedUv = vec2(
          dot(driftedKm, uWindDir) * 1.6,
          dot(driftedKm, shearDir) * 7.8
        );
        float wispyFbm = fbmShell(stretchedUv + vec2(uTime * 0.008, 0.0));
        float iceStrands = smoothstep(0.38, 0.78, wispyFbm);
        structure = iceStrands;

        // Semi-transparent so ground features are always visible beneath cirrus
        alpha = thinFringeMask * iceStrands * 0.26 * domainFade;
      }

      if (alpha < 0.005) discard;

      // Top-vs-bottom lighting based on viewing angle
      vec3 viewDir = normalize(vWorldPos - cameraPosition);
      float lookingDown = smoothstep(-0.02, -0.35, viewDir.y);
      vec3 topWhite = uSunColor * mix(0.92, 1.0, structure);
      vec3 bottomShade = mix(vec3(0.56, 0.63, 0.72), uSkyColor * 0.78 + vec3(0.22), 0.5);
      vec3 finalCol = mix(bottomShade, topWhite, clamp(0.45 + 0.55 * lookingDown, 0.0, 1.0));

      gl_FragColor = vec4(finalCol, clamp(alpha, 0.0, 0.36));
    }
  `
};

export const ClusteredCumulusBillboardShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uTransitionProgress: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uSunColor: { value: new THREE.Color('#fffdf8') },
    uSkyColor: { value: new THREE.Color('#476487') },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uWindSpeed: { value: 0.8 }
  },

  vertexShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform float uTransitionProgress;
    uniform vec2 uWindDir;
    uniform float uWindSpeed;

    attribute vec3 aPuffOrigin;
    attribute vec2 aPuffScale;
    attribute float aPuffSeed;
    attribute float aHeightNorm;

    varying vec2 vUv;
    varying float vSeed;
    varying float vHeightNorm;
    varying float vCloudStrength;
    varying float vRainStrength;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vSeed = aPuffSeed;
      vHeightNorm = aHeightNorm;

      // Advect puff in 100% lockstep with the volumetric satellite cloud field
      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec3 centerWorld = vec3(
        aPuffOrigin.x + dynamicDrift.x,
        aPuffOrigin.y,
        aPuffOrigin.z + dynamicDrift.y
      );

      // Sample satellite texture at the exact puff origin
      vec2 satUv = clamp(vec2(
        (aPuffOrigin.x + 120000.0) / 240000.0,
        (aPuffOrigin.z + 80000.0) / 160000.0
      ), 0.002, 0.998);

      vec4 w = texture2D(uWeatherData, satUv);
      float prog = clamp(uTransitionProgress, 0.0, 1.0);
      vCloudStrength = w.r * prog;
      vRainStrength  = w.g * prog;

      // Hide billboard immediately if this cell has no satellite cloud
      if (vCloudStrength < 0.05) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }

      // Camera-facing / horizon-stabilized billboard basis for 3D lumpy Cumulus volume
      vec3 toCam = normalize(cameraPosition - centerWorld);
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam + vec3(1e-5)));
      vec3 up = normalize(cross(toCam, right));

      // Blend between horizontal dome and camera-facing puff so it looks 3D from both orbit and valley
      up = normalize(mix(up, vec3(0.0, 1.0, 0.0), 0.35));

      vec2 offset2D = (uv - 0.5) * aPuffScale * (0.75 + 0.45 * vCloudStrength);
      vec3 worldPos = centerWorld + right * offset2D.x + up * offset2D.y;
      vWorldPos = worldPos;

      gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    }
  `,

  fragmentShader: `
    precision highp float;

    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;

    varying vec2 vUv;
    varying float vSeed;
    varying float vHeightNorm;
    varying float vCloudStrength;
    varying float vRainStrength;
    varying vec3 vWorldPos;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise2D(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
        mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float fbmPuff(vec2 p) {
      float v = 0.0;
      float amp = 0.54;
      for (int i = 0; i < 4; i++) {
        float n = noise2D(p);
        float billow = 1.0 - abs(n * 2.0 - 1.0);
        v += mix(n, sqrt(max(0.0, billow)), 0.55) * amp;
        p = p * 2.12 + vec2(5.7, 9.3);
        amp *= 0.46;
      }
      return v;
    }

    void main() {
      if (vCloudStrength < 0.05) discard;

      vec2 centered = (vUv - 0.5) * 2.0;
      float r2 = dot(centered, centered);
      if (r2 >= 1.0) discard;

      // Soft spherical puff normal & multi-octave FBM edge sculpting
      float sphereZ = sqrt(max(0.0, 1.0 - r2));
      float fbm = fbmPuff(vUv * 3.8 + vec2(vSeed * 13.7, vSeed * 7.3));
      float radialEnvelope = pow(1.0 - r2, 1.55);
      float puffDensity = smoothstep(0.22, 0.78, radialEnvelope * (0.62 + 0.55 * fbm));
      if (puffDensity <= 0.01) discard;

      // Beer's Law self-shadowing:
      // - Upper puffs and top hemisphere (centered.y > 0) receive direct sunlight
      // - Lower puffs and cloud base (vHeightNorm -> 0, centered.y < 0) are dark in shadow
      vec3 puffNormal = normalize(vec3(centered.x, -centered.y, sphereZ));
      float sunFacing = clamp(dot(puffNormal, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
      float verticalLight = clamp(vHeightNorm * 0.68 + sunFacing * 0.32, 0.0, 1.0);
      float beerShadow = exp(-(1.0 - verticalLight) * (1.35 + vRainStrength * 0.95));

      vec3 topColor = uSunColor * mix(0.93, 1.0, fbm);
      vec3 bottomShadow = mix(
        vec3(0.42, 0.48, 0.57),
        vec3(0.27, 0.32, 0.40),
        clamp(vRainStrength * 1.2, 0.0, 1.0)
      );

      vec3 col = mix(bottomShadow, topColor, clamp(beerShadow, 0.08, 1.0));
      float alpha = puffDensity * vCloudStrength * 0.28;

      gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.32));
    }
  `
};
