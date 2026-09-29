/**
 * Photorealistic 3D Volumetric Cloud Shader with:
 * 1. Multi-Octave Perlin-Worley FBM for organic puffy edges & wave-cloud undulation
 * 2. Top-Down Vertical Optical Depth Self-Shadowing:
 *    - Cloud tops (seen from satellite / overhead view) receive direct solar illumination
 *      with luminous FBM billow relief.
 *    - Cloud bottoms / bases (relAltitude < 0.38) are naturally darker due to overlying
 *      FBM column optical depth attenuation and ambient occlusion.
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

    // 3D Octave Rotation Matrix for isotropic, artifact-free multi-octave FBM
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

    // Quintic C2 3D Noise
    float noise3D(vec3 x) {
      vec3 p = floor(x);
      vec3 f = fract(x);
      f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(
        mix(mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
            mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
            mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x), f.y), f.z);
    }

    // 3D Spherical Worley Cellular Noise for soft cumulus puffs
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

    // 5-Octave Fractional Brownian Motion (FBM) with soft billow-puff harmonics
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

    // Multi-scale Gaussian-like 9-tap satellite sampler for ultra-smooth, feathered cloud transitions
    vec4 sampleWeatherSmooth(vec2 worldXZ) {
      vec2 uv = getSatelliteUV(worldXZ);
      vec2 texel = vec2(1.5 / 1024.0);
      vec4 c0 = texture2D(uWeatherData, uv) * 0.36;
      vec4 c1 = texture2D(uWeatherData, clamp(uv + vec2( texel.x,  0.0), 0.001, 0.999)) * 0.11;
      vec4 c2 = texture2D(uWeatherData, clamp(uv + vec2(-texel.x,  0.0), 0.001, 0.999)) * 0.11;
      vec4 c3 = texture2D(uWeatherData, clamp(uv + vec2( 0.0,  texel.y), 0.001, 0.999)) * 0.11;
      vec4 c4 = texture2D(uWeatherData, clamp(uv + vec2( 0.0, -texel.y), 0.001, 0.999)) * 0.11;
      vec4 c5 = texture2D(uWeatherData, clamp(uv + vec2( texel.x,  texel.y), 0.001, 0.999)) * 0.05;
      vec4 c6 = texture2D(uWeatherData, clamp(uv + vec2(-texel.x,  texel.y), 0.001, 0.999)) * 0.05;
      vec4 c7 = texture2D(uWeatherData, clamp(uv + vec2( texel.x, -texel.y), 0.001, 0.999)) * 0.05;
      vec4 c8 = texture2D(uWeatherData, clamp(uv + vec2(-texel.x, -texel.y), 0.001, 0.999)) * 0.05;

      vec4 res = c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8;
      float prog = clamp(uTransitionProgress, 0.0, 1.0);
      res.r *= prog;
      res.a *= prog;
      return res;
    }

    // Dual-Lobe Henyey-Greenstein Phase Function for soft forward & backward light scattering
    float dualLobePhaseHG(float cosTheta, float gForward, float gBackward, float forwardWeight) {
      float gf2 = gForward * gForward;
      float gb2 = gBackward * gBackward;
      float phaseF = (1.0 - gf2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + gf2 - 2.0 * gForward * cosTheta), 1.5));
      float phaseB = (1.0 - gb2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + gb2 - 2.0 * gBackward * cosTheta), 1.5));
      return mix(phaseB, phaseF, forwardWeight);
    }

    // Computes soft, feathered, non-uniform 3D cloud & haze density matching real satellite imagery
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
      cloudTopHeightOut = 0.5;
      vec3 boxCenter = (uBoxMin + uBoxMax) * 0.5;
      vec3 boxHalf = (uBoxMax - uBoxMin) * 0.5;
      vec3 distFromCenter = abs(p - boxCenter) / boxHalf;
      float boxFalloff = smoothstep(1.0, 0.88, distFromCenter.x) *
                         smoothstep(1.0, 0.88, distFromCenter.z) *
                         smoothstep(1.0, 0.90, distFromCenter.y);
      if (boxFalloff <= 0.001) return 0.0;

      float h = clamp((p.y - uBoxMin.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0);
      relativeAltitude = h;

      // Sample continuous, smoothly feathered satellite cloud field
      vec4 weather = sampleWeatherSmooth(p.xz);
      satHazeDepth = weather.r;
      satCoreStrength = max(weather.a, satHazeDepth * 0.85);
      rainIntensity = weather.g;
      isStorm = step(0.45, rainIntensity);

      if (satHazeDepth < 0.012) return 0.0;

      // Vertical envelope: flat condensation base and rounded dome top proportional to optical thickness
      float cloudTop = mix(0.38, 0.94, smoothstep(0.02, 0.75, satCoreStrength));
      cloudTopHeightOut = cloudTop;
      float softBase = smoothstep(0.01, 0.20, h);
      float softTop  = 1.0 - smoothstep(cloudTop - 0.28, cloudTop + 0.04, h);
      float verticalProfile = softBase * softTop;
      if (verticalProfile <= 0.001) return 0.0;

      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec3 coord = vec3(
        (p.x - dynamicDrift.x) * (uWorleyFreq * 1.15),
        p.y * (uWorleyFreq * 2.10),
        (p.z - dynamicDrift.y) * (uWorleyFreq * 1.15)
      );

      // Multi-octave 5-level FBM + spherical Worley cellular puffs + atmospheric wave undulation
      float fbm5 = fbmPuffy5(coord);
      float worleyPuff = 1.0 - worley3D(coord * 1.35 + vec3(2.4, 5.1, 7.3));
      float waveRipple = 0.5 + 0.5 * sin((p.x * 0.0022 + p.z * 0.0009) + fbm5 * 4.2);

      fbmSignal = fbm5 * 0.52 + worleyPuff * 0.34 + waveRipple * 0.14;

      // Smoothly feather the outer cloud fringes with FBM without punching sharp cutout holes
      float softSatelliteEnvelope = pow(smoothstep(0.012, 0.78, satHazeDepth), 1.15);
      float fringeFeather = mix(
        smoothstep(0.28, 0.76, fbmSignal),
        mix(0.68, 1.26, fbmSignal),
        smoothstep(0.03, 0.32, satHazeDepth)
      );

      float finalDensity =
        softSatelliteEnvelope *
        fringeFeather *
        verticalProfile *
        boxFalloff *
        uCloudDensityMultiplier *
        1.18;

      return max(0.0, finalDensity);
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
      int maxSteps = min(uSteps, 52);
      float stepLength = clamp(totalDist / float(maxSteps), 60.0, 1400.0);
      int actualSteps = int(min(float(maxSteps), ceil(totalDist / stepLength)));

      float jitter = hash(vWorldPosition * 0.01 + vec3(uTime * 0.05)) * 0.75;
      float t = tNear + stepLength * jitter;

      float transmittance = 1.0;
      vec3 accumulatedLight = vec3(0.0);

      float cosTheta = dot(rd, uSunDir);
      vec2 sunHoriz = normalize(uSunDir.xz + vec2(1e-5));

      // Detect whether we are viewing from satellite/overhead (seeing sunlit cloud tops)
      // vs viewing from low/underneath (seeing shadowed cloud bottoms)
      float satelliteTopViewFactor = smoothstep(-0.05, 0.45, -rd.y);

      for (int i = 0; i < 52; i++) {
        if (i >= actualSteps) break;
        if (transmittance < 0.06) break;

        vec3 p = ro + rd * t;

        float isStorm = 0.0;
        float rainIntensity = 0.0;
        float relAltitude = 0.0;
        float satCoreStrength = 0.0;
        float satHazeDepth = 0.0;
        float fbmSignal = 0.5;
        float cloudTopHeight = 0.5;
        float density = getCloudDensity(
          p,
          isStorm,
          rainIntensity,
          relAltitude,
          satCoreStrength,
          satHazeDepth,
          fbmSignal,
          cloudTopHeight
        );

        if (density > 0.002) {
          // -------------------------------------------------------------------
          // 1. TOP-OF-CLOUD vs BOTTOM-OF-CLOUD VERTICAL OPTICAL DEPTH SHADOWING
          // -------------------------------------------------------------------
          // Normalized height within THIS specific cloud column (0.0 = cloud base/bottom, 1.0 = cloud top/crown)
          float localColumnHeight = clamp(relAltitude / max(0.22, cloudTopHeight), 0.0, 1.0);

          // Overlying cloud mass above sample p:
          // - At the top of the cloud (localColumnHeight -> 1.0, what satellite sees), overlyingMass -> 0.0 (bright sunlit top!)
          // - At the bottom/underside of the cloud (localColumnHeight -> 0.0), overlyingMass is high (darker shadowed base!)
          float overlyingMass = max(0.0, 1.0 - localColumnHeight) * (0.45 + 0.85 * satCoreStrength) * (0.65 + 0.55 * fbmSignal);

          // Horizontal sun-slope self-shadowing from neighboring cloud billows
          float sNear = sampleWeatherSmooth(p.xz + sunHoriz * 650.0).r;
          float sFar  = sampleWeatherSmooth(p.xz + sunHoriz * 1800.0).r;

          float lateralSunDepth =
            max(0.0, (sNear * 0.60 + sFar * 0.40) * (1.15 - localColumnHeight * 0.75)) * density * 0.45;
          float totalOpticalDepthToSun = overlyingMass * 1.45 + lateralSunDepth;

          // 3-Octave Multiple-Scattering Light Transport
          float multiScatteredEnergy = 0.0;
          float atten = 1.0;
          float contrib = 1.0;
          float phaseEcc = 1.0;

          for (int ms = 0; ms < 3; ms++) {
            float beer = exp(-totalOpticalDepthToSun * atten * 1.35);
            float powder = 1.0 - exp(-density * 2.2 * atten);
            float softPowder = mix(1.0, powder * 1.25 + 0.25, 0.52);
            float octavePhase = dualLobePhaseHG(
              cosTheta,
              0.62 * phaseEcc,
              -0.24 * phaseEcc,
              0.65
            );
            multiScatteredEnergy += contrib * beer * softPowder * (0.62 + octavePhase * uSunScatterIntensity * 0.65);

            atten *= 0.48;
            contrib *= 0.52;
            phaseEcc *= 0.58;
          }

          float slopeLight = clamp((satHazeDepth - sNear) * 1.25 + (fbmSignal - 0.5) * 0.35, -0.28, 0.45);
          float sunVisibility = clamp(multiScatteredEnergy * 0.54 + slopeLight * 0.32, 0.26, 1.14);

          // -------------------------------------------------------------------
          // 2. DARKER SELF-SHADOWED CLOUD BASES vs BRIGHT SUNLIT SATELLITE TOPS
          // -------------------------------------------------------------------
          // Bottom of cloud is darker (cool slate-grey/blue shadow due to overlying cloud attenuation)
          vec3 darkCloudBottom = mix(
            vec3(0.42, 0.48, 0.58), // deep shadowed underside core
            vec3(0.62, 0.68, 0.77), // lighter peripheral base
            1.0 - clamp(satCoreStrength * 0.85, 0.0, 0.85)
          );

          // Top of cloud (what you see from satellite view) is luminous ivory-white sculpted by FBM billows
          vec3 brightCloudTop = mix(
            vec3(0.88, 0.91, 0.95),
            uSunColor * 0.98,
            clamp(0.45 + 0.55 * fbmSignal, 0.0, 1.0)
          );

          // Smooth vertical transition from darker shadowed bottom (0.0..0.38) to bright sunlit top (0.45..1.0)
          float topBottomBlend = smoothstep(0.06, 0.68, localColumnHeight);
          // From satellite overhead view, emphasize the sunlit upper FBM crown while keeping crevices & bases shaded
          float effectiveTopWeight = clamp(
            topBottomBlend * (0.65 + 0.35 * sunVisibility) + satelliteTopViewFactor * localColumnHeight * 0.18,
            0.0,
            1.0
          );

          vec3 cloudColor = mix(darkCloudBottom, brightCloudTop, effectiveTopWeight);
          if (isStorm > 0.4) {
            cloudColor = mix(cloudColor, vec3(0.38, 0.44, 0.54), isStorm * 0.50);
          }

          // Apply vertical self-shadowing occlusion so the underside is visibly darker than the top
          float baseShadowOcclusion = mix(0.54, 1.02, smoothstep(0.0, 0.62, localColumnHeight));
          vec3 stepLighting = cloudColor * (0.76 + 0.24 * sunVisibility) * baseShadowOcclusion;

          if (uLightning > 0.05 && isStorm > 0.3) {
            stepLighting += vec3(0.92, 0.96, 1.0) * uLightning * 3.5;
          }

          // Gentle optical extinction preserves natural satellite semi-translucency
          float extinction = density * uAbsorption * 0.00085;
          float stepTransmittance = exp(-extinction * stepLength);

          accumulatedLight += stepLighting * (1.0 - stepTransmittance) * transmittance;
          transmittance *= stepTransmittance;
        }

        t += stepLength;
        if (t > tFar) break;
      }

      float rawAlpha = clamp(1.0 - transmittance, 0.0, 0.84);
      float featheredAlpha = smoothstep(0.003, 0.035, rawAlpha) * rawAlpha;
      if (featheredAlpha < 0.003) discard;

      gl_FragColor = vec4(accumulatedLight / max(1e-4, 1.0 - transmittance), featheredAlpha);
    }
  `
};
