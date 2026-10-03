/**
 * Satellite-True 3D Volumetric Cloud Raymarching Shader on a Curved Earth Globe (480km x 320km)
 *
 * Classifies and renders ONLY the clouds actually present in the optical/IR satellite pass
 * across Eastern Turkey, Eastern Syria, Northern Iraq, and Western Iran:
 * 1. Applies spherical Earth Globe curvature (-d^2 / 5,500,000) so clouds curve downward
 *    over the horizon at 50km-100km in exact lockstep with the curved terrain.
 * 2. Applies Temperature-Aware Rayleigh Blue Atmospheric Scattering on distant clouds:
 *    - When cold: distant clouds shift into deep alpine Rayleigh blue while keeping crisp structure.
 *    - When hot/warm: clouds preserve sharp sunlit cauliflower FBM detail with soft azure horizon scatter.
 */

import * as THREE from 'three';

export const CloudShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uWeatherDataPrev: { value: null as THREE.Texture | null },
    uTransitionProgress: { value: 1.0 },
    uCameraPos: { value: new THREE.Vector3(0, 5000, 15000) },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color('#fff9ee') },
    uSkyColor: { value: new THREE.Color('#3b82f6') },
    uBoxMin: { value: new THREE.Vector3(-800000, -8100, -800000) },
    uBoxMax: { value: new THREE.Vector3(800000, 5400, 800000) },
    // Weather-texture UV mapping. Supplied as uniforms so the cloud field can be
    // sampled per chunk as well as domain-wide.
    uDomainMinXZ: { value: new THREE.Vector2(-800000, -800000) },
    uDomainSizeXZ: { value: new THREE.Vector2(1600000, 1600000) },
    uCloudBaseY: { value: 3400.0 },
    uCloudTopY: { value: 5200.0 },
    uGlobeRefXZ: { value: new THREE.Vector2(0.0, 0.0) },
    uSteps: { value: 56 },
    uCloudDensityMultiplier: { value: 1.45 },
    uAbsorption: { value: 0.55 },
    uSunScatterIntensity: { value: 1.5 },
    uWindSpeed: { value: 0.8 },
    uLightning: { value: 0.0 },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uPredictedOffset: { value: new THREE.Vector2(0.0, 0.0) },
    uWorleyFreq: { value: 0.00045 },
    uPuffyFactor: { value: 0.85 },
    uFlatBaseSharpness: { value: 0.14 },
    uDomeRoundness: { value: 0.72 },
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

    varying vec3 vWorldPos;

    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform float uTransitionProgress;
    uniform vec3 uCameraPos;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform vec3 uBoxMin;
    uniform vec3 uBoxMax;
    uniform vec2 uDomainMinXZ;
    uniform vec2 uDomainSizeXZ;
    uniform float uCloudBaseY;
    uniform float uCloudTopY;
    uniform vec2 uGlobeRefXZ;
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

      float n000 = hash(p + vec3(0.0, 0.0, 0.0));
      float n100 = hash(p + vec3(1.0, 0.0, 0.0));
      float n010 = hash(p + vec3(0.0, 1.0, 0.0));
      float n110 = hash(p + vec3(1.0, 1.0, 0.0));
      float n001 = hash(p + vec3(0.0, 0.0, 1.0));
      float n101 = hash(p + vec3(1.0, 0.0, 1.0));
      float n011 = hash(p + vec3(0.0, 1.0, 1.0));
      float n111 = hash(p + vec3(1.0, 1.0, 1.0));

      return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
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

    // Spherical Earth Globe curvature drop (-454m at 50km, -1,818m at 100km)
    float getGlobeDrop(vec2 xz) {
      vec2 d = xz - uGlobeRefXZ;
      return -dot(d, d) / 12742000.0;  // real Earth: d^2 / (2R)
    }

    vec2 getSatelliteUV(vec2 worldXZ) {
      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec2 pos = worldXZ - (uPredictedOffset + dynamicDrift);
      // Domain-relative, from uniforms. This was hardcoded to the old 480x320 km map, so on
      // the 1600 km map every sample outside +/-240 km clamped to a single edge texel and the
      // cloud field was effectively blank everywhere except the centre.
      vec2 uv = (pos - uDomainMinXZ) / uDomainSizeXZ;
      return clamp(uv, 0.001, 0.999);
    }

    // SHARP sample. This used to be a weighted 3x3 blur (centre 0.36, neighbours 0.11,
    // diagonals 0.05) with a texel size hardcoded as 1.5/1024. On a 512px texture spanning
    // 1600 km one texel is 3,125 m, so every lookup averaged away roughly 9 km of cloud:
    // small clouds disappeared entirely and small gaps between clouds were filled in.
    // That is precisely what made the cloud layer look like a flat sheet.
    vec4 sampleWeatherSmooth(vec2 worldXZ) {
      vec2 uv = getSatelliteUV(worldXZ);
      return texture2D(uWeatherData, uv);
    }

    float dualLobePhaseHG(float cosTheta, float gForward, float gBackward, float forwardWeight) {
      float gf2 = gForward * gForward;
      float gb2 = gBackward * gBackward;
      float phaseF = (1.0 - gf2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + gf2 - 2.0 * gForward * cosTheta), 1.5));
      float phaseB = (1.0 - gb2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + gb2 - 2.0 * gBackward * cosTheta), 1.5));
      return mix(phaseB, phaseF, forwardWeight);
    }

    float getCloudDensity(
      vec3 p,
      out float isStorm,
      out float rainIntensity,
      out float relativeAltitude,
      out float satCoreStrength,
      out float satHazeDepth,
      out float fbmSignal,
      out float cloudTopHeightOut,
      out float normTempOut
    ) {
      fbmSignal = 0.5;
      cloudTopHeightOut = 0.45;
      normTempOut = 0.5;

      // Account for spherical Earth Globe curvature at p.xz
      float globeDrop = getGlobeDrop(p.xz);
      float unCurvedY = p.y - globeDrop;
      float slabThickness = max(400.0, uCloudTopY - uCloudBaseY);
      float h = (unCurvedY - uCloudBaseY) / slabThickness;

      if (h < 0.0 || h > 1.0) return 0.0;
      relativeAltitude = h;

      // Circular fade-out so the cloud field ends at the same radius as the terrain
      // rim fog (≈550–780 km). Per-axis fade left clouds hanging in the square corners.
      float distFromCenter = length(p.xz) / (uDomainSizeXZ.x * 0.5);
      float boxFalloff = 1.0 - smoothstep(0.85, 0.98, distFromCenter);
      if (boxFalloff <= 0.001) return 0.0;

      vec4 weather = sampleWeatherSmooth(p.xz);
      satHazeDepth = weather.r;
      satCoreStrength = max(weather.a, satHazeDepth * 0.85);
      rainIntensity = weather.g;
      normTempOut = weather.b;
      isStorm = step(0.18, rainIntensity);

      if (satHazeDepth < 0.012) return 0.0;

      float stormTowerBoost = smoothstep(0.05, 0.55, rainIntensity) * 0.28;
      float cloudTop = clamp(
        mix(0.34, 0.86, smoothstep(0.04, 0.82, satCoreStrength)) + stormTowerBoost,
        0.32,
        0.96
      );
      cloudTopHeightOut = cloudTop;

      float baseStart = mix(0.04, 0.0, smoothstep(0.04, 0.35, rainIntensity));
      float baseFull  = mix(0.18, 0.08, smoothstep(0.04, 0.35, rainIntensity));
      float softBase = smoothstep(baseStart, baseFull, h);
      float softTop  = 1.0 - smoothstep(cloudTop - 0.24, cloudTop + 0.03, h);

      float anvilSpread = 0.0;
      if (satCoreStrength > 0.72 || rainIntensity > 0.35) {
        anvilSpread = smoothstep(cloudTop - 0.18, cloudTop, h) * 0.22;
      }

      float verticalProfile = (softBase * softTop) + anvilSpread * softTop;
      if (verticalProfile <= 0.001) return 0.0;

      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec3 coord = vec3(
        (p.x - dynamicDrift.x) * (uWorleyFreq * 1.15),
        unCurvedY * (uWorleyFreq * 2.10),
        (p.z - dynamicDrift.y) * (uWorleyFreq * 1.15)
      );

      float fbm5 = fbmPuffy5(coord);
      float worleyPuff = 1.0 - worley3D(coord * 1.35 + vec3(2.4, 5.1, 7.3));

      float wavePhase = (p.x * 0.0021 + p.z * 0.00095) + fbm5 * 3.8;
      float gravityWaveRipple = 0.5 + 0.5 * sin(wavePhase);

      vec3 stretchedCoord = vec3(
        coord.x * 0.55 + coord.z * 0.35,
        coord.y * 2.5,
        coord.z * 2.4 - coord.x * 0.35
      );
      float wispyStreak = noise3D(stretchedCoord * 2.2);

      float thinWispyWeight = 1.0 - smoothstep(0.04, 0.26, satHazeDepth);
      float convectiveWeight = smoothstep(0.35, 0.78, satCoreStrength);

      float baseMorph = mix(
        mix(fbm5 * 0.55 + gravityWaveRipple * 0.45, fbm5 * 0.48 + worleyPuff * 0.52, convectiveWeight),
        mix(fbm5, wispyStreak, 0.60),
        thinWispyWeight
      );

      fbmSignal = clamp(baseMorph, 0.0, 1.0);

      float softSatelliteEnvelope = pow(smoothstep(0.012, 0.78, satHazeDepth), 1.12);
      float fringeFeather = mix(
        smoothstep(0.26, 0.74, fbmSignal),
        mix(0.70, 1.25, fbmSignal),
        smoothstep(0.03, 0.30, satHazeDepth)
      );

      float finalDensity = softSatelliteEnvelope * fringeFeather * verticalProfile * boxFalloff * uCloudDensityMultiplier;
      return max(0.0, finalDensity);
    }

    float marchSunLightRay(vec3 pos, float hNorm, float cloudTopH, float satCore, float rainInt, float fbmSig) {
      float tauSun = 0.0;
      float stepLen = 240.0;
      vec3 lightStep = uSunDir * stepLen;
      vec3 samplePos = pos;
      float slabThickness = max(400.0, uCloudTopY - uCloudBaseY);

      for (int s = 0; s < 3; s++) {
        samplePos += lightStep;
        float sh = ((samplePos.y - getGlobeDrop(samplePos.xz)) - uCloudBaseY) / slabThickness;
        if (sh <= 1.0 && sh >= 0.0) {
          vec4 wSun = texture2D(uWeatherData, getSatelliteUV(samplePos.xz));
          float sunHaze = wSun.r * clamp(uTransitionProgress, 0.0, 1.0);
          if (sunHaze > 0.02) {
            vec3 sCoord = samplePos * (uWorleyFreq * 1.35);
            float sNoise = noise3D(sCoord);
            float sVert = 1.0 - smoothstep(cloudTopH - 0.20, cloudTopH + 0.05, sh);
            tauSun += sunHaze * (0.65 + 0.35 * sNoise) * sVert * 0.75;
          }
        }
      }

      float depthFromTop = clamp((cloudTopH - hNorm) / max(0.22, cloudTopH), 0.0, 1.0);
      float rainBaseDarkening = smoothstep(0.04, 0.50, rainInt) * 0.95;
      float verticalTau = pow(depthFromTop, 1.25) * (1.55 + satCore * 1.45 + rainBaseDarkening) * (0.78 + 0.44 * (1.0 - fbmSig));

      return tauSun + verticalTau;
    }

    void main() {
      vec3 ro = uCameraPos;
      vec3 rd = normalize(vWorldPos - uCameraPos);

      vec2 hit = rayBoxIntersection(ro, rd, uBoxMin, uBoxMax);
      if (hit.x > hit.y || hit.y < 0.0) {
        discard;
      }

      float tNear = max(0.0, hit.x);
      // March distance. This was a hardcoded 440 km, sized for the original 480x320 km map
      // where it covered the whole domain. On the 1600 km map it capped clouds to a 440 km
      // radius around the camera, so sky clouds only appeared over the central region no
      // matter how much cloud the density data held (measured: outer bands carry 15.2% cloud
      // vs 9.7% in the centre, yet none of it rendered).
      // 440 km was the original cap, sized for the 480 km map - it confined clouds to the
      // central region. Marching the full 1600 km domain with enough samples to resolve a
      // 1.8 km slab dropped the frame rate to 1.2 fps, so the march is capped at 60% of the
      // domain: clouds now reach well past the old limit without the full-domain cost.
      // 440 km was the original cap, sized for the 480 km map - it confined clouds to the
      // central region. Marching the full 1600 km domain with enough samples to resolve a
      // 1.8 km slab dropped the frame rate to 1.2 fps, so the march is capped at 60% of the
      // domain: clouds now reach well past the old limit without the full-domain cost.
      float tFar = min(hit.y, uDomainSizeXZ.x * 0.60);
      if (tNear >= tFar) {
        discard;
      }

      // Raised to 128: at 44-68 steps the ~113 m finest FBM octave was undersampled, which
      // is exactly what produced the visible lines / blockiness across the cloud slab.
      int steps = clamp(uSteps, 32, 128);
      float stepSize = (tFar - tNear) / float(steps);

      // Interleaved gradient noise: a far better march-start dither than the old hash,
      // which left visible banding lines across the cloud slab.
      float dither = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));
      float t = tNear + stepSize * dither;

      vec3 accumulatedColor = vec3(0.0);
      float transmittance = 1.0;

      float cosTheta = dot(rd, uSunDir);
      float phase = dualLobePhaseHG(cosTheta, 0.62, -0.24, 0.70);

      for (int i = 0; i < 128; i++) {
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
        float normTemp = 0.5;
        float density = getCloudDensity(p, isStorm, rainInt, relAlt, satCore, satHaze, fbmSig, cloudTopH, normTemp);

        if (density > 0.001) {
          float extinction = density * 0.00088 * max(0.35, uAbsorption);
          float stepTransmittance = exp(-extinction * stepSize);

          float totalSunTau = marchSunLightRay(p, relAlt, cloudTopH, satCore, rainInt, fbmSig);
          float beerSunLight = exp(-totalSunTau * 0.88);
          float powderTop = 1.0 - 0.45 * exp(-density * 2.2) * (1.0 - relAlt);

          float viewFromAbove = smoothstep(-0.05, 0.45, -rd.y);
          float topSunlitCrown = smoothstep(0.28, 0.85, relAlt / max(0.25, cloudTopH));
          float topExposure = clamp(mix(topSunlitCrown, 1.0, viewFromAbove * 0.50), 0.0, 1.0);

          float rainUnderbelly = smoothstep(0.04, 0.55, rainInt) * (1.0 - topSunlitCrown);

          vec3 darkCloudBaseColor = mix(
            vec3(0.42, 0.50, 0.62),
            vec3(0.26, 0.34, 0.46),
            rainUnderbelly
          );
          vec3 midCloudBodyColor  = mix(uSkyColor * 0.52 + vec3(0.46, 0.50, 0.56), vec3(0.86, 0.89, 0.94), 0.58);
          vec3 sunlitCloudTopColor = mix(vec3(0.97, 0.98, 1.00), uSunColor, 0.28);

          vec3 baseShaded = mix(darkCloudBaseColor, midCloudBodyColor, smoothstep(0.08, 0.52, topExposure));
          vec3 cloudAlbedo = mix(baseShaded, sunlitCloudTopColor, smoothstep(0.32, 0.88, topExposure * 0.65 + beerSunLight * 0.35));

          vec3 directSun = sunlitCloudTopColor * (beerSunLight * powderTop) * (0.45 + phase * 0.42 * uSunScatterIntensity);
          vec3 sampleLight = cloudAlbedo * (0.66 + 0.34 * beerSunLight) + directSun * (0.28 + 0.52 * topExposure);

          // Temperature-Aware Rayleigh Blue Atmospheric Perspective on Distant Clouds:
          // - Distant clouds (22km to 125km away) turn atmospheric blue (deeper cobalt-azure when cold,
          //   sharper cauliflower FBM detail when warm/hot)
          float distKm = length(p.xz - uCameraPos.xz) * 0.001;
          float coldCloudFactor = clamp(1.0 - normTemp * 1.25 + (1.0 - relAlt) * 0.15, 0.0, 1.0);
          float hotCloudFactor  = 1.0 - coldCloudFactor;

          // Hot/warm air accentuates fine FBM cauliflower billow detail
          float fbmDetailContrast = mix(0.84, 1.18, fbmSig);
          sampleLight *= mix(1.0, fbmDetailContrast, 0.45 + 0.40 * hotCloudFactor);

          float blueCloudStartKm = mix(28.0, 18.0, coldCloudFactor);
          float blueCloudFullKm  = mix(130.0, 95.0, coldCloudFactor);
          float cloudBlueAmount  = smoothstep(blueCloudStartKm, blueCloudFullKm, distKm) * mix(0.48, 0.72, coldCloudFactor);

          vec3 coldDistantCloudBlue = vec3(0.32, 0.62, 0.95) * (0.76 + 0.36 * fbmSig);
          vec3 warmDistantCloudBlue = vec3(0.52, 0.78, 0.98) * (0.80 + 0.32 * fbmSig);
          vec3 targetCloudBlue = mix(warmDistantCloudBlue, coldDistantCloudBlue, coldCloudFactor);

          sampleLight = mix(sampleLight, targetCloudBlue, clamp(cloudBlueAmount, 0.0, 0.75));

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
      float finalAlpha = smoothstep(0.004, 0.88, rawAlpha) * 0.86;
      if (finalAlpha < 0.005) {
        discard;
      }

      vec3 finalRGB = accumulatedColor / max(0.001, 1.0 - transmittance);
      gl_FragColor = vec4(finalRGB, finalAlpha);
    }
  `
};
