/**
 * Cloud-Locked Rain Radar Precipitation Shader (3D Rain Streaks & Sub-Cloud Rain Shafts).
 * UVs are derived from the live domain constants, NOT the original 480x320 km bounds: those
 * hardcoded values pinned rain to the old central region and clamped everywhere else to a
 * single edge texel - the same bug that confined the sky clouds.
 */
import * as THREE from 'three';
import {
  DOMAIN_WIDTH_METERS,
  DOMAIN_HEIGHT_METERS,
  HALF_DOMAIN_WIDTH,
  HALF_DOMAIN_HEIGHT
} from '../utils/realSulaymaniyahTerrain';

export const RainStreakLineShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uCloudBaseY: { value: 3400.0 },
    uSnowTempThreshold: { value: 2.5 },
    uFallSpeed: { value: 1850.0 },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uWindSpeed: { value: 0.8 },
    uGlobeRefXZ: { value: new THREE.Vector2(0.0, 0.0) }
  },

  vertexShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform float uCloudBaseY;
    uniform float uSnowTempThreshold;
    uniform float uFallSpeed;
    uniform vec2 uWindDir;
    uniform float uWindSpeed;
    uniform vec2 uGlobeRefXZ;

    attribute vec3 aCloudOrigin;
    attribute float aVertexEnd;
    attribute float aSeed;

    varying float vEnd;
    varying float vIntensity;
    varying float vIsSnow;
    varying float vAlpha;

    void main() {
      vEnd = aVertexEnd;

      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec2 cloudXZ = aCloudOrigin.xz + dynamicDrift;

      vec2 uv = clamp(vec2(
        (aCloudOrigin.x + ${HALF_DOMAIN_WIDTH.toFixed(1)}) / ${DOMAIN_WIDTH_METERS.toFixed(1)},
        (aCloudOrigin.z + ${HALF_DOMAIN_HEIGHT.toFixed(1)}) / ${DOMAIN_HEIGHT_METERS.toFixed(1)}
      ), 0.002, 0.998);

      vec4 weather = texture2D(uWeatherData, uv);
      float cloudDensity = weather.r;
      float rainIntensity = weather.g;
      float tempC = (weather.b * 47.0) - 5.0;

      if (rainIntensity < 0.04 || cloudDensity < 0.12) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vAlpha = 0.0;
        return;
      }

      vIntensity = rainIntensity;
      float isSnow = step(tempC, uSnowTempThreshold);
      vIsSnow = isSnow;

      // Apply spherical Earth Globe curvature drop at cloudXZ
      vec2 dGlobe = cloudXZ - uGlobeRefXZ;
      float globeDrop = -dot(dGlobe, dGlobe) / 12742000.0;  // must match EARTH_CURVATURE_DIVISOR (2R)

      float topY = uCloudBaseY + 240.0 + globeDrop;
      float bottomY = 260.0 + globeDrop;
      float columnHeight = max(800.0, topY - bottomY);

      float speed = (isSnow > 0.5 ? uFallSpeed * 0.38 : uFallSpeed) * (0.82 + aSeed * 0.36);
      float fallPhase = fract(aCloudOrigin.y + (uTime * speed) / columnHeight);

      float headY = mix(topY, bottomY, fallPhase);
      float streakLen = isSnow > 0.5
        ? 45.0
        : mix(155.0, 295.0, clamp(rainIntensity, 0.0, 1.0));

      float vertY = headY - aVertexEnd * streakLen;

      float dropProgress = clamp((topY - vertY) / columnHeight, 0.0, 1.0);
      vec2 windSlantXZ = uWindDir * (dropProgress * 240.0 * uWindSpeed);

      vec3 worldPos = vec3(
        cloudXZ.x + windSlantXZ.x,
        vertY,
        cloudXZ.y + windSlantXZ.y
      );

      float cloudExitFade = smoothstep(0.0, 0.12, fallPhase);
      float groundHitFade = 1.0 - smoothstep(0.86, 1.0, fallPhase);
      vAlpha = cloudExitFade * groundHitFade * clamp(0.45 + rainIntensity * 0.65, 0.0, 0.95);

      gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    }
  `,

  fragmentShader: `
    precision highp float;

    varying float vEnd;
    varying float vIntensity;
    varying float vIsSnow;
    varying float vAlpha;

    void main() {
      if (vAlpha <= 0.01) discard;

      float tipGlow = smoothstep(0.0, 0.85, vEnd);
      vec3 rainCol = mix(
        vec3(0.68, 0.82, 0.96),
        vec3(0.88, 0.95, 1.00),
        tipGlow * 0.7 + vIntensity * 0.3
      );
      vec3 snowCol = vec3(0.96, 0.98, 1.00);
      vec3 finalCol = mix(rainCol, snowCol, vIsSnow);

      gl_FragColor = vec4(finalCol, vAlpha * (0.45 + 0.55 * tipGlow));
    }
  `
};

export const RainShaftCurtainShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uCloudBaseY: { value: 3400.0 },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uWindSpeed: { value: 0.8 },
    uGlobeRefXZ: { value: new THREE.Vector2(0.0, 0.0) }
  },

  vertexShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform float uCloudBaseY;
    uniform vec2 uWindDir;
    uniform float uWindSpeed;
    uniform vec2 uGlobeRefXZ;

    attribute vec3 aShaftOrigin;
    attribute float aShaftWidth;

    varying vec2 vUv;
    varying float vRainIntensity;

    void main() {
      vUv = uv;

      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec2 centerXZ = aShaftOrigin.xz + dynamicDrift;

      vec2 satUv = clamp(vec2(
        (aShaftOrigin.x + ${HALF_DOMAIN_WIDTH.toFixed(1)}) / ${DOMAIN_WIDTH_METERS.toFixed(1)},
        (aShaftOrigin.z + ${HALF_DOMAIN_HEIGHT.toFixed(1)}) / ${DOMAIN_HEIGHT_METERS.toFixed(1)}
      ), 0.002, 0.998);

      vec4 w = texture2D(uWeatherData, satUv);
      float cloudVal = w.r;
      float rainVal = w.g;
      vRainIntensity = rainVal;

      if (rainVal < 0.04 || cloudVal < 0.12) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }

      vec2 dGlobe = centerXZ - uGlobeRefXZ;
      float globeDrop = -dot(dGlobe, dGlobe) / 12742000.0;  // must match EARTH_CURVATURE_DIVISOR (2R)

      float topY = uCloudBaseY + 260.0 + globeDrop;
      float bottomY = 240.0 + globeDrop;
      float worldY = mix(bottomY, topY, uv.y);

      float angle = aShaftOrigin.y;
      vec2 horizDir = vec2(cos(angle), sin(angle));
      vec2 slant = uWindDir * ((1.0 - uv.y) * 220.0 * uWindSpeed);

      vec3 worldPos = vec3(
        centerXZ.x + horizDir.x * (uv.x - 0.5) * aShaftWidth + slant.x,
        worldY,
        centerXZ.y + horizDir.y * (uv.x - 0.5) * aShaftWidth + slant.y
      );

      gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    }
  `,

  fragmentShader: `
    precision highp float;

    uniform float uTime;
    varying vec2 vUv;
    varying float vRainIntensity;

    float hash11(float p) {
      p = fract(p * 0.1031);
      p *= p + 33.33;
      p *= p + p;
      return fract(p);
    }

    void main() {
      if (vRainIntensity < 0.04) discard;

      float horizFade = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x);
      float vertFade  = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.82, vUv.y);

      float colId = floor(vUv.x * 28.0);
      float streakWave = 0.5 + 0.5 * sin((vUv.y * 22.0 + uTime * 5.5 + hash11(colId) * 6.28));
      float curtain = mix(0.55, 1.0, streakWave) * horizFade * vertFade;

      float alpha = curtain * clamp(vRainIntensity * 0.26, 0.0, 0.22);
      if (alpha < 0.004) discard;

      vec3 shaftColor = mix(vec3(0.64, 0.75, 0.88), vec3(0.78, 0.87, 0.96), vUv.y);
      gl_FragColor = vec4(shaftColor, alpha);
    }
  `
};
