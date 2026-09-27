/**
 * Proximity-Based Rain and Snow Particle Shader & Rain Shaft Shader
 * Uses Instanced/Point particles and samples the THREE.DataTexture to only precipitate
 * where rain/snow intensity is active.
 */
import * as THREE from 'three';

export const PrecipitationShader = {
  uniforms: {
    uTime: { value: 0 },
    uWeatherData: { value: null as THREE.DataTexture | null },
    uCameraPos: { value: new THREE.Vector3(0, 0, 0) },
    uBoxSize: { value: new THREE.Vector3(240000, 3200, 160000) },
    uRainThreshold: { value: 0.25 },
    uSnowTempThreshold: { value: 3.0 }, // below 3 deg C -> snow
    uFallSpeed: { value: 2400.0 },
    uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
    uPredictedOffset: { value: new THREE.Vector2(0.0, 0.0) },
    uWindSpeed: { value: 0.8 },
    uParticleScale: { value: 28.0 },
  },

  vertexShader: `
    uniform float uTime;
    uniform sampler2D uWeatherData;
    uniform vec3 uCameraPos;
    uniform vec3 uBoxSize;
    uniform float uRainThreshold;
    uniform float uSnowTempThreshold;
    uniform float uFallSpeed;
    uniform vec2 uWindDir;
    uniform vec2 uPredictedOffset;
    uniform float uWindSpeed;
    uniform float uParticleScale;

    attribute float aSeed;
    attribute float aSpeedOffset;

    varying float vType; // 0.0 = rain, 1.0 = snow
    varying float vIntensity;
    varying float vAlpha;

    void main() {
      // Local particle position
      vec3 pos = position;

      // Vertical falling loop (from sub-cloud level down to ground)
      float fall = uTime * (uFallSpeed * (0.85 + aSpeedOffset * 0.35));
      pos.y = mod(pos.y - fall, uBoxSize.y);

      // Slanted precipitation angle matching wind direction
      float dropSlant = (uBoxSize.y - pos.y) * 0.16;
      pos.x += uWindDir.x * dropSlant + sin(uTime * 1.5 + aSeed * 6.28) * 35.0;
      pos.z += uWindDir.y * dropSlant + cos(uTime * 1.5 + aSeed * 6.28) * 35.0;

      // World position spanning terrain domain
      vec3 worldPos;
      worldPos.x = pos.x;
      worldPos.y = 80.0 + pos.y;
      worldPos.z = pos.z;

      // Unified advection matching clouds 100% so rain and clouds move together in lockstep
      vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 10.0);
      vec2 advectedPos = worldPos.xz - (uPredictedOffset + dynamicDrift);
      vec2 uv = vec2(
        (advectedPos.x + 120000.0) / 240000.0,
        (advectedPos.y + 80000.0) / 160000.0
      );
      uv = clamp(uv, 0.002, 0.998);
      vec4 weather = texture2D(uWeatherData, uv);

      float rainIntensity = weather.g;
      float temp = (weather.b * 47.0) - 5.0; // decode -5C to 42C

      // If no rain in this grid cell, hide particle completely
      if (rainIntensity <= 0.01 || rainIntensity < uRainThreshold) {
        gl_PointSize = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // offscreen
        vAlpha = 0.0;
        return;
      }

      // Check if snow vs rain
      float isSnow = step(temp, uSnowTempThreshold);
      vType = isSnow;
      vIntensity = rainIntensity;

      // Distance attenuation
      vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
      float dist = -mvPosition.z;
      
      // Point size based on distance and intensity
      float size = (isSnow > 0.5 ? 28.0 : uParticleScale * 1.5) * (0.8 + rainIntensity * 1.4);
      gl_PointSize = clamp(size * (12000.0 / max(dist, 1000.0)), 2.5, 48.0);

      // Fade out near camera and smoothly at great distances up to 140km
      float nearFade = smoothstep(40.0, 300.0, dist);
      float farFade = 1.0 - smoothstep(70000.0, 140000.0, dist);
      vAlpha = nearFade * farFade * clamp(rainIntensity * 1.7, 0.0, 0.95);

      gl_Position = projectionMatrix * mvPosition;
    }
  `,

  fragmentShader: `
    precision highp float;

    varying float vType;
    varying float vIntensity;
    varying float vAlpha;

    void main() {
      if (vAlpha <= 0.01) discard;

      vec2 pt = gl_PointCoord - vec2(0.5);

      if (vType > 0.5) {
        // Snow flake: soft round flake with fuzzy edge
        float r = length(pt);
        if (r > 0.5) discard;
        float snowSoft = smoothstep(0.5, 0.05, r);
        gl_FragColor = vec4(0.95, 0.98, 1.0, vAlpha * snowSoft * 0.90);
      } else {
        // Rain streak: elongated vertical streak
        if (abs(pt.x) > 0.22 || abs(pt.y) > 0.5) discard;
        float streak = (1.0 - abs(pt.x) / 0.22) * (1.0 - abs(pt.y) / 0.5);
        // Cool atmospheric rain streak color with specular glint
        vec3 dropColor = mix(vec3(0.70, 0.82, 0.94), vec3(0.92, 0.96, 1.0), vIntensity * 0.5);
        gl_FragColor = vec4(dropColor, vAlpha * streak * 0.85);
      }
    }
  `
};

/**
 * Rain Shaft Shader for the dramatic atmospheric precipitation curtain beneath clouds
 */
export const RainShaftShader = {
  uniforms: {
    uTime: { value: 0 },
    uRainIntensity: { value: 0.85 },
    uWindAngle: { value: 0.15 },
    uColor: { value: new THREE.Color(0.6, 0.68, 0.76) }
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    uniform float uWindAngle;

    void main() {
      vUv = uv;
      vec3 pos = position;
      // Angle the rain shaft with the wind as it nears the ground
      pos.x += (1.0 - uv.y) * 400.0 * uWindAngle;
      vec4 wp = modelMatrix * vec4(pos, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uRainIntensity;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    float hash(float n) { return fract(sin(n) * 43758.5453); }

    void main() {
      // Vertical rain streaks moving downwards
      float streakCoord = vUv.x * 60.0 + vWorldPos.z * 0.005;
      float speed = uTime * 4.0;
      float streaks = sin((vUv.y * 30.0 + speed) * 3.14159) * 0.5 + 0.5;
      float noise = fract(sin(floor(streakCoord)) * 43758.5453);
      streaks *= step(0.4, noise);

      // Vertical fade: dense at cloud bottom, mist at ground
      float verticalFade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
      // Horizontal soft falloff
      float edgeFade = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);

      float alpha = (0.2 + streaks * 0.35) * verticalFade * edgeFade * uRainIntensity;
      if (alpha < 0.01) discard;

      gl_FragColor = vec4(uColor, alpha * 0.45);
    }
  `
};
