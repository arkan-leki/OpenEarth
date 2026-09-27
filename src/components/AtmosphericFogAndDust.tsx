import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DOMAIN_WIDTH_METERS, DOMAIN_HEIGHT_METERS } from '../utils/realSulaymaniyahTerrain';
import { SunPositionResult } from '../utils/sunPosition';

interface AtmosphericFogAndDustProps {
  phenomenaTexture?: THREE.Texture | null;
  sunPosition?: SunPositionResult;
  windSpeed?: number;
  visible?: boolean;
}

/**
 * Renders 3D Valley Radiation Fog / Mountain Mist (G channel of phenomenaTexture)
 * and 3D Suspended Mesopotamian Desert Dust Plumes (B channel of phenomenaTexture).
 * Only renders where fog or airborne dust is actually present.
 */
export const AtmosphericFogAndDust: React.FC<AtmosphericFogAndDustProps> = ({
  phenomenaTexture,
  sunPosition,
  windSpeed = 0.8,
  visible = true
}) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => {
    return {
      uPhenomena: { value: phenomenaTexture || null },
      uTime: { value: 0 },
      uWindSpeed: { value: windSpeed },
      uSunColor: { value: new THREE.Color('#fff7ed') },
      uSkyColor: { value: new THREE.Color('#93c5fd') },
      uSunElevation: { value: 45.0 }
    };
  }, [phenomenaTexture, windSpeed]);

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    materialRef.current.uniforms.uPhenomena.value = phenomenaTexture || null;
    materialRef.current.uniforms.uWindSpeed.value = windSpeed;
    if (sunPosition) {
      materialRef.current.uniforms.uSunColor.value.set(sunPosition.lightColor);
      materialRef.current.uniforms.uSkyColor.value.set(sunPosition.ambientColor);
      materialRef.current.uniforms.uSunElevation.value = sunPosition.elevationDeg;
    }
  });

  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    attribute float aLayerHeight;
    varying float vLayerFrac;

    void main() {
      vUv = uv;
      vLayerFrac = aLayerHeight;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const fragmentShader = `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying float vLayerFrac;

    uniform sampler2D uPhenomena;
    uniform float uTime;
    uniform float uWindSpeed;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform float uSunElevation;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise2D(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main() {
      // Sample phenomena texture (R: Snow Cover, G: Valley Fog, B: Suspended Dust)
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
      vec4 phenom = texture2D(uPhenomena, uv);

      float fogDensity = phenom.g;
      float dustDensity = phenom.b;

      if (fogDensity < 0.05 && dustDensity < 0.05) {
        discard;
      }

      // Animated atmospheric drift
      vec2 drift = vec2(-0.75, -0.45) * uTime * uWindSpeed * 0.012;
      float n1 = noise2D(uv * 18.0 + drift);
      float n2 = noise2D(uv * 42.0 - drift * 1.4);
      float wispy = n1 * 0.65 + n2 * 0.35;

      // Vertical profile: fog hugs lower valleys (vLayerFrac 0.0..0.6), dust extends higher (0.0..1.0)
      float fogVertical = smoothstep(0.0, 0.2, vLayerFrac) * (1.0 - smoothstep(0.35, 0.75, vLayerFrac));
      float dustVertical = smoothstep(0.0, 0.15, vLayerFrac) * (1.0 - smoothstep(0.55, 1.0, vLayerFrac));

      float finalFog = fogDensity * fogVertical * (0.7 + 0.5 * wispy);
      float finalDust = dustDensity * dustVertical * (0.75 + 0.45 * wispy);

      float totalAlpha = clamp(finalFog * 0.42 + finalDust * 0.38, 0.0, 0.68);
      if (totalAlpha < 0.012) discard;

      // Daylight illumination factor
      float dayFactor = clamp((uSunElevation + 6.0) / 35.0, 0.18, 1.0);

      // Cool misty valley fog color vs Warm Mesopotamian ochre dust color
      vec3 fogColor = mix(vec3(0.76, 0.84, 0.92), uSunColor * 0.95, 0.35) * dayFactor;
      vec3 dustColor = mix(vec3(0.82, 0.66, 0.44), uSunColor * vec3(0.95, 0.78, 0.54), 0.45) * dayFactor;

      float dustWeight = finalDust / max(0.001, finalFog + finalDust);
      vec3 finalColor = mix(fogColor, dustColor, dustWeight);

      // Domain boundary fade
      float edgeFade = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x) *
                       smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);

      gl_FragColor = vec4(finalColor, totalAlpha * edgeFade);
    }
  `;

  // Multi-slice stacked atmospheric planes (from 380m to 1850m) for smooth 3D volumetric parallax
  const slices = useMemo(() => {
    const altitudes = [380, 620, 920, 1300, 1750];
    return altitudes.map((alt, idx) => {
      const geo = new THREE.PlaneGeometry(DOMAIN_WIDTH_METERS, DOMAIN_HEIGHT_METERS, 32, 32);
      const count = geo.attributes.position.count;
      const layerFrac = new Float32Array(count).fill(idx / (altitudes.length - 1));
      geo.setAttribute('aLayerHeight', new THREE.BufferAttribute(layerFrac, 1));
      return { altitude: alt, geometry: geo };
    });
  }, []);

  if (!visible || !phenomenaTexture) return null;

  return (
    <group>
      {slices.map((s) => (
        <mesh
          key={s.altitude}
          geometry={s.geometry}
          position={[0, s.altitude, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <shaderMaterial
            ref={s.altitude === 620 ? materialRef : undefined}
            uniforms={uniforms}
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            transparent={true}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
};
