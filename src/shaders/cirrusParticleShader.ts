/**
 * Hybrid Particle-Shader for High-Altitude Cirrus Clouds (8,200m - 10,800m MSL)
 *
 * Renders upper-tropospheric ice-crystal cirrus filaments (Cirrus fibratus & Cirrus uncinus)
 * using an instanced noise-sculpted particle system that advects independently along the
 * high-altitude Subtropical Jet Stream vector, decoupled from lower-level cumulus/cumulonimbus motion.
 */
import * as THREE from 'three';

export const CirrusParticleShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.Texture | null },
    uTransitionProgress: { value: 1.0 },
    uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
    uSunColor: { value: new THREE.Color('#fffdf8') },
    uSkyColor: { value: new THREE.Color('#60a5fa') },
    // Independent high-altitude Subtropical Jet Stream vector (WSW -> ENE shear across Kurdistan)
    uJetStreamDir: { value: new THREE.Vector2(0.91, -0.41).normalize() },
    uJetStreamSpeed: { value: 1.65 },
    uOpacityMultiplier: { value: 0.62 }
  },

  vertexShader: `
    precision highp float;

    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform float uTransitionProgress;
    uniform vec2 uJetStreamDir;
    uniform float uJetStreamSpeed;

    attribute vec3 aInstancePos;
    attribute vec2 aScale;
    attribute float aSeed;
    attribute float aJetSpeedFactor;

    varying vec2 vUv;
    varying float vSeed;
    varying float vCloudMask;
    varying float vEdgeFade;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vSeed = aSeed;

      // Independent upper-tropospheric jet-stream advection (decoupled from lower cumulus wind)
      float driftSpeed = (42.0 + aJetSpeedFactor * 28.0) * uJetStreamSpeed;
      vec2 jetAdvection = uJetStreamDir * (uTime * driftSpeed);

      // Wrap particle position seamlessly within the 240km x 160km domain
      vec3 worldCenter = aInstancePos;
      worldCenter.x = mod(worldCenter.x + jetAdvection.x + 120000.0, 240000.0) - 120000.0;
      worldCenter.z = mod(worldCenter.z + jetAdvection.y + 80000.0, 160000.0) - 80000.0;
      worldCenter.y += sin(uTime * 0.25 + aSeed * 6.2831) * 65.0;

      // Sample satellite cloud & upper-level moisture field at current position and upwind anvil source
      vec2 satUv = clamp(vec2(
        (worldCenter.x + 120000.0) / 240000.0,
        (worldCenter.z + 80000.0) / 160000.0
      ), 0.002, 0.998);

      // Upwind sample simulates high-altitude cirrus anvil blow-off sheared by the jet stream
      vec2 upwindUv = clamp(satUv - uJetStreamDir * 0.028, 0.002, 0.998);
      vec2 crossUv  = clamp(satUv + vec2(-uJetStreamDir.y, uJetStreamDir.x) * 0.015, 0.002, 0.998);

      float cLocal  = texture2D(uWeatherData, satUv).r;
      float cUpwind = texture2D(uWeatherData, upwindUv).r;
      float cCross  = texture2D(uWeatherData, crossUv).r;

      // High-altitude cirrus presence driven by satellite haze/cloud field + jet-stream outflow
      float rawPresence = max(cLocal, max(cUpwind * 0.88, cCross * 0.72));
      vCloudMask = smoothstep(0.02, 0.36, rawPresence) * clamp(uTransitionProgress, 0.0, 1.0);

      // Hide particle offscreen if sky is completely clear at this location
      if (vCloudMask <= 0.005) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }

      // Orient the particle quad along the high-altitude jet-stream shear axis with slight per-particle splay
      float splayAngle = (aSeed - 0.5) * 0.42;
      float cosA = cos(splayAngle);
      float sinA = sin(splayAngle);
      vec2 dir = normalize(vec2(
        uJetStreamDir.x * cosA - uJetStreamDir.y * sinA,
        uJetStreamDir.x * sinA + uJetStreamDir.y * cosA
      ));
      vec2 perp = vec2(-dir.y, dir.x);

      // Scale particle ribbon (stretched along jet stream for fibrous cirrus streaks)
      vec2 centered = (uv - 0.5) * aScale * (0.75 + 0.45 * vCloudMask);
      vec3 offsetXZ = vec3(
        dir.x * centered.x + perp.x * centered.y,
        (uv.x - 0.5) * 140.0 * sin(aSeed * 12.0), // subtle vertical ice-fallvirga tilt
        dir.y * centered.x + perp.y * centered.y
      );

      vec3 finalWorldPos = worldCenter + offsetXZ;
      vWorldPos = finalWorldPos;

      // Domain boundary fade so particles never pop at the 240km x 160km edges
      vec2 normDomain = abs(finalWorldPos.xz) / vec2(120000.0, 80000.0);
      vEdgeFade = smoothstep(1.0, 0.86, normDomain.x) * smoothstep(1.0, 0.86, normDomain.y);

      gl_Position = projectionMatrix * viewMatrix * vec4(finalWorldPos, 1.0);
    }
  `,

  fragmentShader: `
    precision highp float;

    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform float uOpacityMultiplier;

    varying vec2 vUv;
    varying float vSeed;
    varying float vCloudMask;
    varying float vEdgeFade;
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

    // Anisotropic domain-warped FBM for fibrous ice-crystal filaments (Cirrus fibratus & uncinus hooks)
    float cirrusFilamentNoise(vec2 uv, float seed) {
      // Stretch coordinates strongly along X (jet stream axis) vs Y to form delicate hair-like streaks
      vec2 q = vec2(uv.x * 2.4 + seed * 11.3, uv.y * 8.5 + seed * 7.1);

      // Curl/hook warp ("mares' tails" ice crystal fall streaks)
      float warpX = noise2D(q * 0.85 + vec2(uTime * 0.015, 0.0));
      float warpY = noise2D(q * 1.35 + vec2(4.2, -uTime * 0.012));
      q += vec2(warpX * 0.65, (warpY - 0.5) * 1.45);

      float f = 0.0;
      float amp = 0.54;
      for (int i = 0; i < 4; i++) {
        float n = noise2D(q);
        // Fibrous silk transformation
        float strand = 1.0 - abs(n * 2.0 - 1.0);
        f += mix(n, strand * strand, 0.62) * amp;
        q = q * vec2(2.05, 2.35) + vec2(1.7, 3.1);
        amp *= 0.46;
      }
      return clamp(f, 0.0, 1.0);
    }

    void main() {
      if (vCloudMask <= 0.005 || vEdgeFade <= 0.005) discard;

      // Soft elliptical radial falloff so quad boundaries are 100% invisible
      vec2 centered = (vUv - 0.5) * 2.0;
      float radialDist = dot(centered * vec2(0.85, 1.15), centered * vec2(0.85, 1.15));
      if (radialDist >= 1.0) discard;
      float radialMask = pow(1.0 - radialDist, 1.65);

      // Evaluate fibrous ice-crystal streak noise + soft high-altitude veil
      float filaments = cirrusFilamentNoise(vUv, vSeed);
      float fineStreaks = smoothstep(0.30, 0.78, filaments);
      float softIceVeil = smoothstep(0.18, 0.62, filaments) * 0.42;

      float cirrusShape = (fineStreaks * 0.72 + softIceVeil * 0.28) * radialMask;
      float alpha = cirrusShape * vCloudMask * vEdgeFade * uOpacityMultiplier;

      if (alpha < 0.006) discard;

      // High-altitude ice crystal optical scattering (pearlescent white with solar halo shimmer)
      vec3 viewDir = normalize(vWorldPos - cameraPosition);
      float cosTheta = dot(viewDir, uSunDir);
      // Ice crystal forward scattering peak (22-degree halo / forward silver shimmer)
      float iceForwardScatter = pow(clamp(cosTheta * 0.5 + 0.5, 0.0, 1.0), 3.0) * 0.45;

      vec3 iceShadowTint = mix(uSkyColor * 0.92 + vec3(0.24), vec3(0.88, 0.93, 0.99), 0.65);
      vec3 iceSunlitTint = uSunColor * 1.04 + vec3(iceForwardScatter);
      vec3 finalCirrusColor = mix(iceShadowTint, iceSunlitTint, clamp(0.45 + 0.55 * fineStreaks, 0.0, 1.0));

      gl_FragColor = vec4(finalCirrusColor, clamp(alpha, 0.0, 0.78));
    }
  `
};
