/**
 * High-Definition 3D Satellite Puffy Cumulus + Atmospheric Haze Raymarching Shader
 *
 * Combines TWO authentic satellite cloud regimes from the 1024x1024 NASA pass:
 * 1. Puffy 3D Cumulus & Convective Billows (driven by weather.a core mask + 3D spherical Worley cotton puffs)
 * 2. Translucent Satellite Atmospheric Cloud Haze / Veil (driven by weather.r haze optical depth)
 *
 * This reproduces both the rounded, puffy cauliflower cloud tops AND the soft, milky
 * atmospheric haze veil seen in real NASA MODIS/VIIRS satellite photographs.
 */
import * as THREE from 'three';

export const CloudShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uWeatherDataPrev: { value: null as THREE.Texture | null },
    uTransitionProgress: { value: 1.0 },
    uCameraPos: { value: new THREE.Vector3(0, 4000, 20000) },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.99, 0.97) },
    uSkyColor: { value: new THREE.Color(0.45, 0.64, 0.88) },
    uBoxMin: { value: new THREE.Vector3(-120000, 4200, -80000) },
    uBoxMax: { value: new THREE.Vector3(120000, 6800, 80000) },
    uSteps: { value: 64 },
    uCloudDensityMultiplier: { value: 1.5 },
    uAbsorption: { value: 0.55 },
    uSunScatterIntensity: { value: 1.5 },
    uWindSpeed: { value: 0.8 },
    uLightning: { value: 0.0 },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uPredictedOffset: { value: new THREE.Vector2(0.0, 0.0) },
    uWorleyFreq: { value: 0.00045 },
    uPuffyFactor: { value: 0.90 },
    uFlatBaseSharpness: { value: 0.14 },
    uDomeRoundness: { value: 0.90 },
    uHasAnvil: { value: 0.0 }
  },

  vertexShader: `
    varying vec3 vWorldPosition;
    varying vec3 vLocalPosition;

    void main() {
      vLocalPosition = position;
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,

  fragmentShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform sampler2D uWeatherDataPrev;
    uniform float uTransitionProgress;
    uniform vec3 uCameraPos;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform vec3 uBoxMin;
    uniform vec3 uBoxMax;
    uniform int uSteps;
    uniform float uCloudDensityMultiplier;
    uniform float uAbsorption;
    uniform float uSunScatterIntensity;
    uniform float uWindSpeed;
    uniform float uLightning;
    uniform vec2 uWindDir;
    uniform vec2 uPredictedOffset;

    uniform float uWorleyFreq;
    uniform float uPuffyFactor;
    uniform float uFlatBaseSharpness;
    uniform float uDomeRoundness;
    uniform float uHasAnvil;

    varying vec3 vWorldPosition;
    varying vec3 vLocalPosition;

    vec3 hash33(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.xxy + p.yxx) * p.zyx);
    }

    // 3D Spherical Worley (Voronoi) Cellular Noise for Rounded Puffy Cumulus Bubbles (☁️)
    float worley3D(vec3 p) {
      vec3 id = floor(p);
      vec3 f = fract(p);
      float minDist = 1.0;
      for (int z = -1; z <= 1; z++) {
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec3 neighbor = vec3(float(x), float(y), float(z));
            vec3 point = hash33(id + neighbor);
            vec3 diff = neighbor + point - f;
            minDist = min(minDist, dot(diff, diff));
          }
        }
      }
      return sqrt(minDist);
    }

    float hash(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float smoothNoise3D(vec3 x) {
      vec3 p = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
            mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
            mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x), f.y), f.z);
    }

    vec2 rayBoxIntersection(vec3 ro, vec3 rd, vec3 boxMin, vec3 boxMax) {
      vec3 invRd = 1.0 / (rd + vec3(1e-6));
      vec3 t0 = (boxMin - ro) * invRd;
      vec3 t1 = (boxMax - ro) * invRd;
      vec3 tMin = min(t0, t1);
      vec3 tMax = max(t0, t1);
      float tNear = max(max(tMin.x, tMin.y), tMin.z);
      float tFar = min(min(tMax.x, tMax.y), tMax.z);
      return vec2(tNear, tFar);
    }

    vec2 getSatelliteUV(vec2 worldXZ) {
      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 4.0);
      vec2 pos = worldXZ - (uPredictedOffset + dynamicDrift);
      vec2 uv = vec2(
        (pos.x + 120000.0) / 240000.0,
        (pos.y + 80000.0) / 160000.0
      );
      return clamp(uv, 0.001, 0.999);
    }

    // Samples only the active mode's satellite/live cloud texture and fades in via GSAP
    vec4 sampleWeather(vec2 worldXZ) {
      vec2 uv = getSatelliteUV(worldXZ);
      vec4 curr = texture2D(uWeatherData, uv);
      float prog = clamp(uTransitionProgress, 0.0, 1.0);
      curr.r *= prog;
      curr.a *= prog;
      return curr;
    }

    float phaseHG(float cosTheta, float g) {
      float g2 = g * g;
      return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
    }

    // Computes 3D Puffy Cumulus Cores + Surrounding Translucent Satellite Haze
    float getCloudDensity(
      vec3 p,
      out float isStorm,
      out float rainIntensity,
      out float relativeAltitude,
      out float puffyCoreMask,
      out float satHazeDepth
    ) {
      vec3 boxCenter = (uBoxMin + uBoxMax) * 0.5;
      vec3 boxHalf = (uBoxMax - uBoxMin) * 0.5;
      vec3 distFromCenter = abs(p - boxCenter) / boxHalf;
      float boxFalloff = smoothstep(1.0, 0.90, distFromCenter.x) *
                         smoothstep(1.0, 0.90, distFromCenter.z) *
                         smoothstep(1.0, 0.92, distFromCenter.y);
      if (boxFalloff <= 0.001) return 0.0;

      float h = clamp((p.y - uBoxMin.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
      relativeAltitude = h;

      // Orographic Zagros mountain clearance so clouds always float cleanly above Mount Halgurd (3607m)
      float uNorm = clamp((p.x + 120000.0) / 240000.0, 0.0, 1.0);
      float vNorm = clamp((p.z + 80000.0) / 160000.0, 0.0, 1.0);
      float zagrosRidge = max(0.0, uNorm * (1.0 - vNorm));
      float estMountainTop = zagrosRidge * 3800.0;
      float mountainClearance = smoothstep(estMountainTop + 150.0, estMountainTop + 700.0, p.y);
      if (mountainClearance <= 0.001) return 0.0;

      // Sample 5-tap softened neighborhood for the atmospheric haze veil + exact center for puffy cores
      vec2 baseUv = getSatelliteUV(p.xz);
      vec2 texel = vec2(1.0 / 1024.0);
      vec4 wCenter = texture2D(uWeatherData, baseUv);
      float hN = texture2D(uWeatherData, clamp(baseUv + vec2(0.0, -texel.y * 2.0), 0.001, 0.999)).r;
      float hS = texture2D(uWeatherData, clamp(baseUv + vec2(0.0,  texel.y * 2.0), 0.001, 0.999)).r;
      float hE = texture2D(uWeatherData, clamp(baseUv + vec2( texel.x * 2.0, 0.0), 0.001, 0.999)).r;
      float hW = texture2D(uWeatherData, clamp(baseUv + vec2(-texel.x * 2.0, 0.0), 0.001, 0.999)).r;

      float prog = clamp(uTransitionProgress, 0.0, 1.0);
      satHazeDepth = (wCenter.r * 0.48 + (hN + hS + hE + hW) * 0.13) * prog;
      puffyCoreMask = max(wCenter.a * prog, satHazeDepth * 0.85);
      rainIntensity = wCenter.g;
      isStorm = step(0.45, rainIntensity);

      if (satHazeDepth < 0.025) return 0.0;

      // -----------------------------------------------------------------------
      // REGIME 1: SOFT TRANSLUCENT SATELLITE ATMOSPHERIC HAZE VEIL
      // Forms the smooth, misty, semi-transparent cloud haze sheet seen in satellite imagery
      // -----------------------------------------------------------------------
      float hazeVertical = smoothstep(0.02, 0.18, h) * (1.0 - smoothstep(0.38, 0.72, h));
      float hazeWisps = 0.82 + 0.18 * smoothNoise3D(vec3(p.x * 0.0005, p.y * 0.0012, p.z * 0.0005));
      float hazeDensity = smoothstep(0.025, 0.42, satHazeDepth) * hazeVertical * hazeWisps * 0.38;

      // -----------------------------------------------------------------------
      // REGIME 2: 3D PUFFY CUMULUS CAULIFLOWER DOMES (☁️)
      // Spherical Worley cellular puffs rising above the flat LCL condensation base
      // -----------------------------------------------------------------------
      float puffyDensity = 0.0;
      if (puffyCoreMask > 0.08) {
        float coreMask = smoothstep(0.08, 0.52, puffyCoreMask);
        float columnHeight = mix(0.42, 0.96, smoothstep(0.08, 0.78, puffyCoreMask));

        // Flat LCL base + rounded cauliflower dome top
        float flatBase = smoothstep(0.02, 0.12, h);
        float domeTop = 1.0 - smoothstep(columnHeight - 0.24, columnHeight, h);
        float heightProfile = flatBase * domeTop;

        if (heightProfile > 0.001) {
          vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 4.0);
          // Multi-scale spherical Worley puffs (~1.4km primary cotton mounds + ~600m cauliflower florets)
          vec3 pCoord = vec3(
            (p.x - dynamicDrift.x) * (uWorleyFreq * 1.35),
            p.y * (uWorleyFreq * 2.8),
            (p.z - dynamicDrift.y) * (uWorleyFreq * 1.35)
          );

          float puff1 = 1.0 - worley3D(pCoord);
          float puff2 = 1.0 - worley3D(pCoord * 2.35 + vec3(4.2, 8.1, 2.7));
          float fluff3 = smoothNoise3D(pCoord * 4.8);

          // Combine spherical Worley bubbles for lush, rounded 3D cumulus puffs
          float puffyMounds = puff1 * 0.58 + puff2 * 0.30 + fluff3 * 0.12;

          // Round dome bulge on top of each cumulus cell
          float domeBulge = (puff1 - 0.38) * 0.26;
          float roundedProfile = clamp(heightProfile + domeBulge, 0.0, 1.0);

          float puffThreshold = mix(0.42, 0.16, coreMask);
          float sculptedPuff = smoothstep(puffThreshold, puffThreshold + 0.32, puffyMounds) * roundedProfile;

          puffyDensity = sculptedPuff * coreMask * 1.35;
        }
      }

      // Combine the Puffy 3D Cumulus Cores with the Soft Satellite Haze Veil
      float combinedShape = max(puffyDensity, hazeDensity) + min(puffyDensity, hazeDensity) * 0.35;
      if (combinedShape <= 0.004) return 0.0;

      return combinedShape * mountainClearance * boxFalloff * uCloudDensityMultiplier * 3.8;
    }

    void main() {
      vec3 ro = uCameraPos;
      vec3 rd = normalize(vWorldPosition - uCameraPos);

      bool cameraInside = (ro.x >= uBoxMin.x && ro.x <= uBoxMax.x &&
                           ro.y >= uBoxMin.y && ro.y <= uBoxMax.y &&
                           ro.z >= uBoxMin.z && ro.z <= uBoxMax.z);

      if (cameraInside && gl_FrontFacing) discard;
      if (!cameraInside && !gl_FrontFacing) discard;

      vec2 hit = rayBoxIntersection(ro, rd, uBoxMin, uBoxMax);
      float tNear = max(hit.x, 0.0);
      float tFar = hit.y;

      if (tNear >= tFar || tFar <= 0.0) discard;

      float totalDist = tFar - tNear;
      int maxSteps = min(uSteps, 54);
      float stepLength = clamp(totalDist / float(maxSteps), 55.0, 1400.0);
      int actualSteps = int(min(float(maxSteps), ceil(totalDist / stepLength)));

      float jitter = hash(vWorldPosition * 0.01 + vec3(uTime * 0.05)) * 0.75;
      float t = tNear + stepLength * jitter;

      float transmittance = 1.0;
      vec3 accumulatedLight = vec3(0.0);

      float cosTheta = dot(rd, uSunDir);
      float forwardScatter = phaseHG(cosTheta, 0.65) * uSunScatterIntensity;
      float backScatter = phaseHG(cosTheta, -0.22) * 0.82;
      float phase = mix(backScatter, forwardScatter, 0.68);

      vec2 sunHoriz = normalize(uSunDir.xz + vec2(1e-5));

      for (int i = 0; i < 54; i++) {
        if (i >= actualSteps) break;
        if (transmittance < 0.012) break;

        vec3 p = ro + rd * t;

        float isStorm = 0.0;
        float rainIntensity = 0.0;
        float relAltitude = 0.0;
        float puffyCoreMask = 0.0;
        float satHazeDepth = 0.0;
        float density = getCloudDensity(p, isStorm, rainIntensity, relAltitude, puffyCoreMask, satHazeDepth);

        if (density > 0.003) {
          // Directional 3D sun-slope relief + soft self-shadowing across puffy domes
          float sNear = sampleWeather(p.xz + sunHoriz * 550.0).r;
          float sFar  = sampleWeather(p.xz + sunHoriz * 1600.0).r;
          float slopeLight = clamp((satHazeDepth - sNear) * 1.8, -0.38, 0.52);

          float shadowDepth = max(0.0, sNear * 0.65 + sFar * 0.35) * density * 0.42;
          float sunVisibility = exp(-shadowDepth) * clamp(0.82 + slopeLight * 0.55, 0.35, 1.25);

          // Powder sugar multiple-scattering effect makes puffy rims & haze glow softly in sunlight
          float powder = 1.0 - exp(-density * 3.4);

          // How much of this sample is Puffy Core (1.0) vs Soft Satellite Haze (0.0)
          float puffVsHaze = smoothstep(0.12, 0.55, puffyCoreMask);

          // Soft atmospheric haze color (milky sky-tinted white) vs Puffy Cumulus color (bright ivory crown + cool base)
          vec3 hazeColor = mix(uSkyColor * 0.88 + vec3(0.22), uSunColor * 0.98, 0.68);
          float verticalLight = smoothstep(0.05, 0.65, relAltitude);
          vec3 puffBaseShade = mix(vec3(0.66, 0.74, 0.86), vec3(0.88, 0.92, 0.97), verticalLight);
          vec3 puffCrownColor = uSunColor * 1.03;
          vec3 puffyColor = mix(puffBaseShade, puffCrownColor, clamp(sunVisibility * (0.42 + 0.58 * verticalLight), 0.0, 1.0));

          vec3 cloudBodyColor = mix(hazeColor, puffyColor, puffVsHaze);
          if (isStorm > 0.4) {
            cloudBodyColor = mix(cloudBodyColor, vec3(0.48, 0.54, 0.64), isStorm * 0.45);
          }

          vec3 directRim = uSunColor * (sunVisibility * phase * 1.45 * powder);
          vec3 stepLighting = cloudBodyColor * (0.78 + 0.28 * sunVisibility) + directRim * 0.26;

          if (uLightning > 0.05 && isStorm > 0.3) {
            stepLighting += vec3(0.92, 0.96, 1.0) * uLightning * 4.0;
          }

          float extinction = density * uAbsorption * 0.0020;
          float stepTransmittance = exp(-extinction * stepLength);

          accumulatedLight += stepLighting * (1.0 - stepTransmittance) * transmittance;
          transmittance *= stepTransmittance;
        }

        t += stepLength;
        if (t > tFar) break;
      }

      float alpha = clamp(1.0 - transmittance, 0.0, 1.0);
      if (alpha < 0.005) discard;

      gl_FragColor = vec4(accumulatedLight, alpha);
    }
  `
};
