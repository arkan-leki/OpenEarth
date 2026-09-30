/**
 * Satellite-True Multi-Regime 3D Volumetric Cloud Raymarching Shader
 *
 * Renders ALL clouds visible in the NASA / RainViewer satellite imagery:
 * 1. Huge High-Level Cloud Networks (Cirrus, Cirrostratus, Altostratus webs & sheets):
 *    - Extensive semi-transparent upper-level cloud networks (h ~ 0.50 .. 0.94) with
 *      wind-sheared fibrous filaments and continuous connectivity (never carved into holes).
 * 2. Small Spread-Out Clouds (Scattered Cumulus & Altocumulus Floccus):
 *    - Preserves every small scattered cloud puff across ridges, valleys, and plains
 *      using high-resolution 5-tap + center-weighted satellite sampling.
 * 3. Low/Mid-Level Stratus, Cellular Stratocumulus & Mountain Gravity Wave Bands:
 *    - Parallel ripple bands over Zagros ridges and cellular cloud blankets.
 * 4. Vertically Developed Cumulonimbus & Rain-Bearing Storm Cores:
 *    - Boiling 3D Perlin-Worley cauliflower domes, anvil tops, and Beer's Law secondary
 *      sun-ray self-shadowing (bright sunlit tops from space, dark shadowed bottoms).
 */
import * as THREE from 'three';

export const CloudShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.DataTexture | null },
    uWeatherDataPrev: { value: null as THREE.DataTexture | null },
    uTransitionProgress: { value: 1.0 },
    uCameraPos: { value: new THREE.Vector3(0, 4000, 20000) },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uSunColor: { value: new THREE.Color('#fffdf8') },
    uSkyColor: { value: new THREE.Color('#384e6b') },
    uBoxMin: { value: new THREE.Vector3(-120000, 3300, -80000) },
    uBoxMax: { value: new THREE.Vector3(120000, 5400, 80000) },
    uSteps: { value: 48 },
    uCloudDensityMultiplier: { value: 1.5 },
    uAbsorption: { value: 0.65 },
    uSunScatterIntensity: { value: 1.5 },
    uWindSpeed: { value: 0.8 },
    uLightning: { value: 0.0 },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uPredictedOffset: { value: new THREE.Vector2(0.0, 0.0) },
    uWorleyFreq: { value: 0.00042 },
    uPuffyFactor: { value: 0.85 },
    uFlatBaseSharpness: { value: 0.16 },
    uDomeRoundness: { value: 0.85 },
    uHasAnvil: { value: 0.0 }
  },

  vertexShader: `
    varying vec3 vWorldPos;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,

  fragmentShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uWeatherData;
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

    varying vec3 vWorldPos;

    const mat3 m3 = mat3(
       0.00,  0.80,  0.60,
      -0.80,  0.36, -0.48,
      -0.60, -0.48,  0.64
    );

    vec3 hash33(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.xxy + p.yxx) * p.zyx);
    }

    float hash(vec3 p) {
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yxz + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float noise3D(vec3 x) {
      vec3 p = floor(x);
      vec3 f = fract(x);
      f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

      return mix(
        mix(
          mix(hash(p + vec3(0.0, 0.0, 0.0)), hash(p + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash(p + vec3(0.0, 1.0, 0.0)), hash(p + vec3(1.0, 1.0, 0.0)), f.x),
          f.y
        ),
        mix(
          mix(hash(p + vec3(0.0, 0.0, 1.0)), hash(p + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash(p + vec3(0.0, 1.0, 1.0)), hash(p + vec3(1.0, 1.0, 1.0)), f.x),
          f.y
        ),
        f.z
      );
    }

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

    // 5-Octave Fractional Brownian Motion (FBM) for Perlin-Worley clouds
    float fbmPuffy5(vec3 p) {
      float value = 0.0;
      float amplitude = 0.50;
      float norm = 0.0;
      for (int i = 0; i < 5; i++) {
        float n = noise3D(p);
        float billow = 1.0 - abs(n * 2.0 - 1.0);
        float puffOctave = mix(n, sqrt(max(0.0, billow)), 0.52);
        value += amplitude * puffOctave;
        norm += amplitude;
        p = m3 * p * 2.05 + vec3(17.3, 31.7, 11.9);
        amplitude *= 0.50;
      }
      return value / norm;
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
      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec2 pos = worldXZ - (uPredictedOffset + dynamicDrift);
      vec2 uv = vec2(
        (pos.x + 120000.0) / 240000.0,
        (pos.y + 80000.0) / 160000.0
      );
      return clamp(uv, 0.001, 0.999);
    }

    /**
     * Peak-preserving satellite sampler:
     * Preserves 100% of small spread-out clouds (via max(c0, smooth)) while keeping
     * smooth feathered transitions for huge high-level cloud networks and big formations!
     */
    vec4 sampleWeatherPreserveSmallAndHigh(vec2 worldXZ) {
      vec2 uv = getSatelliteUV(worldXZ);
      vec2 texel = vec2(1.25 / 1024.0);
      vec4 c0 = texture2D(uWeatherData, uv);
      vec4 c1 = texture2D(uWeatherData, clamp(uv + vec2( texel.x,  0.0), 0.001, 0.999));
      vec4 c2 = texture2D(uWeatherData, clamp(uv + vec2(-texel.x,  0.0), 0.001, 0.999));
      vec4 c3 = texture2D(uWeatherData, clamp(uv + vec2( 0.0,  texel.y), 0.001, 0.999));
      vec4 c4 = texture2D(uWeatherData, clamp(uv + vec2( 0.0, -texel.y), 0.001, 0.999));

      vec4 smooth5 = c0 * 0.44 + (c1 + c2 + c3 + c4) * 0.14;
      // Preserve small spread-out cloud peaks so tiny clouds are never averaged away
      vec4 res = vec4(
        max(c0.r * 0.92, smooth5.r),
        smooth5.g,
        c0.b,
        max(c0.a * 0.94, smooth5.a)
      );

      float prog = clamp(uTransitionProgress, 0.0, 1.0);
      res.r *= prog;
      res.g *= prog;
      res.a *= prog;
      return res;
    }

    float dualLobePhaseHG(float cosTheta, float gForward, float gBackward, float forwardWeight) {
      float gf2 = gForward * gForward;
      float gb2 = gBackward * gBackward;
      float phaseF = (1.0 - gf2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + gf2 - 2.0 * gForward * cosTheta), 1.5));
      float phaseB = (1.0 - gb2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + gb2 - 2.0 * gBackward * cosTheta), 1.5));
      return mix(phaseB, phaseF, forwardWeight);
    }

    /**
     * Multi-Regime 3D Cloud Density Evaluator:
     *Simultaneously renders:
     * 1. Huge High-Level Cloud Networks (Cirrus / Cirrostratus / Altostratus webs at h = 0.48..0.95)
     * 2. Small Spread-Out Cumulus Puffs & Cellular Stratocumulus (h = 0.05..0.68)
     * 3. Large Cumulus, Gravity Wave Sheets & Cumulonimbus Towers (h = 0.02..0.96)
     */
    float getCloudDensity(
      vec3 p,
      out float isStorm,
      out float rainIntensity,
      out float relativeAltitude,
      out float satCoreStrength,
      out float satHazeDepth,
      out float fbmSignal,
      out float cloudTopHeightOut
    ) {
      fbmSignal = 0.5;
      cloudTopHeightOut = 0.65;
      vec3 boxCenter = (uBoxMin + uBoxMax) * 0.5;
      vec3 boxHalf = (uBoxMax - uBoxMin) * 0.5;
      vec3 distFromCenter = abs(p - boxCenter) / boxHalf;
      float boxFalloff = smoothstep(1.0, 0.90, distFromCenter.x) *
                         smoothstep(1.0, 0.90, distFromCenter.z) *
                         smoothstep(1.0, 0.92, distFromCenter.y);
      if (boxFalloff <= 0.001) return 0.0;

      float h = clamp((p.y - uBoxMin.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
      relativeAltitude = h;

      vec4 weather = sampleWeatherPreserveSmallAndHigh(p.xz);
      satHazeDepth = weather.r;
      satCoreStrength = max(weather.a, satHazeDepth * 0.88);
      rainIntensity = weather.g;
      isStorm = step(0.18, rainIntensity);

      // Capture even the thinnest high-level cloud webs and smallest spread-out puffs
      if (satHazeDepth < 0.004) return 0.0;

      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec3 coord = vec3(
        (p.x - dynamicDrift.x) * (uWorleyFreq * 1.15),
        p.y * (uWorleyFreq * 2.10),
        (p.z - dynamicDrift.y) * (uWorleyFreq * 1.15)
      );

      // 1. Multi-octave 5-level Perlin-Worley FBM for small & large Cumulus puffs
      float fbm5 = fbmPuffy5(coord);
      float worleyPuff = 1.0 - worley3D(coord * 1.45 + vec3(2.4, 5.1, 7.3));

      // 2. Mountain Gravity Waves & High-Level Fibrous Cirrus/Altostratus Network Filaments
      float wavePhase = (p.x * 0.0021 + p.z * 0.00095) + fbm5 * 3.6;
      float gravityWaveRipple = 0.5 + 0.5 * sin(wavePhase);

      vec3 stretchedCoord = vec3(
        coord.x * 0.52 + coord.z * 0.34,
        coord.y * 2.2,
        coord.z * 2.1 - coord.x * 0.34
      );
      float highNetworkFilaments = 0.55 * noise3D(stretchedCoord * 1.8) + 0.45 * fbm5;

      // REGIME A: Huge High-Level Cloud Networks (Cirrus / Cirrostratus / Altostratus webs)
      // Present wherever satellite detects thin-to-moderate cloud networks (satHazeDepth >= 0.004),
      // occupying the upper tropospheric slab (h = 0.44 .. 0.94)
      float highNetProfile = smoothstep(0.38, 0.58, h) * (1.0 - smoothstep(0.84, 0.98, h));
      float highNetStrength = smoothstep(0.004, 0.38, satHazeDepth) * mix(0.68, 1.24, highNetworkFilaments);
      float highLevelDensity = highNetStrength * highNetProfile * 0.72;

      // REGIME B: Low & Mid-Level Small Spread-Out Cumulus, Gravity Waves & Large Convective Clouds
      float stormTowerBoost = smoothstep(0.05, 0.55, rainIntensity) * 0.25;
      float lowMidTop = clamp(
        mix(0.46, 0.90, smoothstep(0.02, 0.80, satCoreStrength)) + stormTowerBoost,
        0.42,
        0.96
      );
      float baseStart = mix(0.03, 0.0, smoothstep(0.04, 0.35, rainIntensity));
      float lowMidProfile = smoothstep(baseStart, baseStart + 0.14, h) *
                            (1.0 - smoothstep(lowMidTop - 0.22, lowMidTop + 0.04, h));

      float convectiveWeight = smoothstep(0.25, 0.72, satCoreStrength);
      float lowMidMorph = mix(
        fbm5 * 0.54 + gravityWaveRipple * 0.30 + worleyPuff * 0.16,
        fbm5 * 0.48 + worleyPuff * 0.42 + gravityWaveRipple * 0.10,
        convectiveWeight
      );

      // Continuous FBM modulation that NEVER carves holes into small spread-out clouds or networks
      float softEnvelope = pow(smoothstep(0.004, 0.72, satHazeDepth), 0.85);
      float detailModulation = mix(0.66, 1.28, lowMidMorph);
      float lowMidDensity = softEnvelope * detailModulation * lowMidProfile;

      cloudTopHeightOut = max(lowMidTop, 0.88 * step(0.01, highLevelDensity));
      fbmSignal = clamp(mix(highNetworkFilaments, lowMidMorph, smoothstep(0.18, 0.55, satCoreStrength)), 0.0, 1.0);

      float combinedDensity = max(lowMidDensity, highLevelDensity);
      return max(0.0, combinedDensity * boxFalloff * uCloudDensityMultiplier);
    }

    /**
     * Secondary Raymarching toward the Sun (Beer's Law Light Transport):
     * Shoots a secondary ray from the current 3D cloud sample point toward uSunDir
     * to accumulate optical depth from overlying/sunward cloud volume.
     */
    float marchSunLightRay(vec3 pos, float hNorm, float cloudTopH, float satCore, float rainInt, float fbmSig) {
      float tauSun = 0.0;
      float stepLen = 240.0;
      vec3 lightStep = uSunDir * stepLen;
      vec3 samplePos = pos;

      for (int s = 0; s < 3; s++) {
        samplePos += lightStep;
        float sh = clamp((samplePos.y - uBoxMin.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
        if (sh <= 1.0 && sh >= 0.0) {
          vec4 wSun = texture2D(uWeatherData, getSatelliteUV(samplePos.xz));
          float sunHaze = wSun.r * clamp(uTransitionProgress, 0.0, 1.0);
          if (sunHaze > 0.01) {
            vec3 sCoord = samplePos * (uWorleyFreq * 1.35);
            float sNoise = noise3D(sCoord);
            float sVert = 1.0 - smoothstep(cloudTopH - 0.20, cloudTopH + 0.05, sh);
            tauSun += sunHaze * (0.65 + 0.35 * sNoise) * sVert * 0.70;
          }
        }
      }

      // High-level thin cloud networks stay bright and pearlescent, while thick low/mid clouds have darker shadowed bottoms
      float thicknessFactor = smoothstep(0.12, 0.75, satCore);
      float depthFromTop = clamp((cloudTopH - hNorm) / max(0.22, cloudTopH), 0.0, 1.0);
      float rainBaseDarkening = smoothstep(0.04, 0.50, rainInt) * 0.95;
      float verticalTau = pow(depthFromTop, 1.25) * (0.65 + thicknessFactor * 1.85 + rainBaseDarkening) * (0.78 + 0.40 * (1.0 - fbmSig));

      return tauSun * (0.45 + 0.55 * thicknessFactor) + verticalTau;
    }

    void main() {
      vec3 ro = uCameraPos;
      vec3 rd = normalize(vWorldPos - uCameraPos);

      vec2 hit = rayBoxIntersection(ro, rd, uBoxMin, uBoxMax);
      if (hit.x > hit.y || hit.y < 0.0) {
        discard;
      }

      float tNear = max(0.0, hit.x);
      float tFar = min(hit.y, 260000.0);
      if (tNear >= tFar) {
        discard;
      }

      int steps = clamp(uSteps, 32, 64);
      float stepSize = (tFar - tNear) / float(steps);

      float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float t = tNear + stepSize * dither;

      vec3 accumulatedColor = vec3(0.0);
      float transmittance = 1.0;

      float cosTheta = dot(rd, uSunDir);
      float phase = dualLobePhaseHG(cosTheta, 0.62, -0.24, 0.70);

      for (int i = 0; i < 64; i++) {
        if (i >= steps) break;
        if (transmittance < 0.06) break;

        vec3 p = ro + rd * t;

        float isStorm = 0.0;
        float rainInt = 0.0;
        float relAlt = 0.0;
        float satCore = 0.0;
        float satHaze = 0.0;
        float fbmSig = 0.5;
        float cloudTopH = 0.5;
        float density = getCloudDensity(p, isStorm, rainInt, relAlt, satCore, satHaze, fbmSig, cloudTopH);

        if (density > 0.0008) {
          float extinction = density * 0.00095 * max(0.35, uAbsorption);
          float stepTransmittance = exp(-extinction * stepSize);

          float totalSunTau = marchSunLightRay(p, relAlt, cloudTopH, satCore, rainInt, fbmSig);
          float beerSunLight = exp(-totalSunTau * 0.85);

          float powderTop = 1.0 - 0.42 * exp(-density * 2.4) * (1.0 - relAlt);

          float viewFromAbove = smoothstep(-0.05, 0.45, -rd.y);
          float topSunlitCrown = smoothstep(0.24, 0.82, relAlt / max(0.25, cloudTopH));
          float topExposure = clamp(mix(topSunlitCrown, 1.0, viewFromAbove * 0.52), 0.0, 1.0);

          float rainUnderbelly = smoothstep(0.04, 0.55, rainInt) * (1.0 - topSunlitCrown);

          vec3 darkCloudBaseColor = mix(
            vec3(0.45, 0.50, 0.58),
            vec3(0.28, 0.33, 0.42),
            rainUnderbelly
          );
          vec3 midCloudBodyColor   = mix(uSkyColor * 0.52 + vec3(0.48, 0.50, 0.54), vec3(0.86, 0.88, 0.92), 0.62);
          vec3 sunlitCloudTopColor = mix(vec3(0.96, 0.97, 0.99), uSunColor, 0.30);

          vec3 baseShaded = mix(darkCloudBaseColor, midCloudBodyColor, smoothstep(0.06, 0.48, topExposure));
          vec3 cloudAlbedo = mix(baseShaded, sunlitCloudTopColor, smoothstep(0.28, 0.85, topExposure * 0.65 + beerSunLight * 0.35));

          vec3 directSun = sunlitCloudTopColor * (beerSunLight * powderTop) * (0.45 + phase * 0.42 * uSunScatterIntensity);
          vec3 sampleLight = cloudAlbedo * (0.68 + 0.32 * beerSunLight) + directSun * (0.28 + 0.52 * topExposure);

          if (uLightning > 0.01 && isStorm > 0.5) {
            sampleLight += vec3(0.75, 0.86, 1.0) * uLightning * 1.4;
          }

          float integral = (1.0 - stepTransmittance);
          accumulatedColor += transmittance * sampleLight * integral;
          transmittance *= stepTransmittance;
        }

        t += stepSize;
      }

      float rawAlpha = clamp(1.0 - transmittance, 0.0, 0.88);
      float finalAlpha = smoothstep(0.002, 0.86, rawAlpha) * 0.86;
      if (finalAlpha < 0.003) {
        discard;
      }

      vec3 finalRGB = accumulatedColor / max(0.001, 1.0 - transmittance);

      float viewDist = length(vWorldPos - uCameraPos);
      float horizonHaze = smoothstep(150000.0, 320000.0, viewDist);
      finalRGB = mix(finalRGB, uSkyColor * 0.90 + vec3(0.10), horizonHaze * 0.22);

      gl_FragColor = vec4(finalRGB, finalAlpha);
    }
  `
};
