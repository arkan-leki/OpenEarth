/**
 * Satellite-Faithful Clustered Cumulus Particle Billboard Shader (Strategy 3)
 * across the 480km x 320km Curved Earth Globe
 */
import * as THREE from 'three';

export const MultiLayerCloudShellShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uTransitionProgress: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uSunColor: { value: new THREE.Color('#fffdf8') },
    uSkyColor: { value: new THREE.Color('#3b82f6') },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uWindSpeed: { value: 0.8 },
    uLayerType: { value: 0.0 },
    uShellAltitude: { value: 2150.0 }
  },
  vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `void main() { discard; }`
};

export const ClusteredCumulusBillboardShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uTransitionProgress: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uSunColor: { value: new THREE.Color('#fffdf8') },
    uSkyColor: { value: new THREE.Color('#3b82f6') },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uWindSpeed: { value: 0.8 },
    uGlobeRefXZ: { value: new THREE.Vector2(0.0, 0.0) }
  },

  vertexShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform float uTransitionProgress;
    uniform vec2 uWindDir;
    uniform float uWindSpeed;
    uniform vec2 uGlobeRefXZ;

    attribute vec3 aPuffOrigin;
    attribute vec2 aPuffScale;
    attribute float aPuffSeed;
    attribute float aHeightNorm;

    varying vec2 vUv;
    varying float vSeed;
    varying float vHeightNorm;
    varying float vCloudStrength;
    varying float vRainStrength;
    varying float vNormTemp;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vSeed = aPuffSeed;
      vHeightNorm = aHeightNorm;

      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);
      vec2 driftedXZ = aPuffOrigin.xz + dynamicDrift;

      // Apply spherical Earth Globe curvature drop (-454m at 50km, -1,818m at 100km)
      vec2 dGlobe = driftedXZ - uGlobeRefXZ;
      float globeDrop = -dot(dGlobe, dGlobe) / 5500000.0;

      vec3 centerWorld = vec3(
        driftedXZ.x,
        aPuffOrigin.y + globeDrop,
        driftedXZ.y
      );

      vec2 satUv = clamp(vec2(
        (aPuffOrigin.x + 240000.0) / 480000.0,
        (aPuffOrigin.z + 160000.0) / 320000.0
      ), 0.002, 0.998);

      vec4 w = texture2D(uWeatherData, satUv);
      float prog = clamp(uTransitionProgress, 0.0, 1.0);
      vCloudStrength = w.r * prog;
      vRainStrength  = w.g * prog;
      vNormTemp      = w.b;

      if (vCloudStrength < 0.12) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }

      vec3 toCam = normalize(cameraPosition - centerWorld);
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam + vec3(1e-5)));
      vec3 up = normalize(cross(toCam, right));
      up = normalize(mix(up, vec3(0.0, 1.0, 0.0), 0.35));

      vec2 offset2D = (uv - 0.5) * aPuffScale * (0.75 + 0.45 * vCloudStrength);
      vec3 worldPos = centerWorld + right * offset2D.x + up * offset2D.y;
      vWorldPos = (modelMatrix * vec4(worldPos, 1.0)).xyz;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
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
    varying float vNormTemp;
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
      if (vCloudStrength < 0.12) discard;

      vec2 centered = (vUv - 0.5) * 2.0;
      float r2 = dot(centered, centered);
      if (r2 >= 1.0) discard;

      float sphereZ = sqrt(max(0.0, 1.0 - r2));
      float fbm = fbmPuff(vUv * 3.8 + vec2(vSeed * 13.7, vSeed * 7.3));
      float radialEnvelope = pow(1.0 - r2, 1.55);
      float puffDensity = smoothstep(0.22, 0.78, radialEnvelope * (0.62 + 0.55 * fbm));
      if (puffDensity <= 0.01) discard;

      vec3 puffNormal = normalize(vec3(centered.x, -centered.y, sphereZ));
      float sunFacing = clamp(dot(puffNormal, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
      float verticalLight = clamp(vHeightNorm * 0.68 + sunFacing * 0.32, 0.0, 1.0);
      float beerShadow = exp(-(1.0 - verticalLight) * (1.35 + vRainStrength * 0.95));

      vec3 topColor = uSunColor * mix(0.93, 1.0, fbm);
      vec3 bottomShadow = mix(
        vec3(0.42, 0.50, 0.60),
        vec3(0.26, 0.34, 0.44),
        clamp(vRainStrength * 1.2, 0.0, 1.0)
      );

      vec3 col = mix(bottomShadow, topColor, clamp(beerShadow, 0.08, 1.0));

      // Temperature-aware Rayleigh blue scatter on distant cumulus puffs
      float distKm = length(vWorldPos.xz - cameraPosition.xz) * 0.001;
      float coldFactor = clamp(1.0 - vNormTemp * 1.25, 0.0, 1.0);
      float blueAmt = smoothstep(mix(28.0, 18.0, coldFactor), mix(125.0, 95.0, coldFactor), distKm) * mix(0.48, 0.72, coldFactor);
      vec3 blueTarget = mix(vec3(0.50, 0.76, 0.98), vec3(0.30, 0.60, 0.94), coldFactor) * (0.78 + 0.32 * fbm);
      col = mix(col, blueTarget, clamp(blueAmt, 0.0, 0.75));

      float alpha = puffDensity * vCloudStrength * 0.28;
      gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.32));
    }
  `
};
