import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DOMAIN_WIDTH_METERS, DOMAIN_HEIGHT_METERS } from '../utils/realSulaymaniyahTerrain';

interface NasaCloudDeckProps {
  cloudTexture: THREE.Texture;
  altitude?: number;
  opacity?: number;
  visible?: boolean;
}

/**
 * High-Altitude Atmospheric Satellite Cloud Sheet (Cirrus / Altocumulus / Stratocumulus Veil).
 * Uses 9-tap Gaussian spatial filtering and sunlit rim scattering so NASA Today and Yesterday
 * satellite clouds look smooth, volumetric, and natural above the 3D cumulus layer.
 */
export const NasaCloudDeck: React.FC<NasaCloudDeckProps> = ({
  cloudTexture,
  altitude = 5200,
  opacity = 0.55,
  visible = true
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(DOMAIN_WIDTH_METERS, DOMAIN_HEIGHT_METERS, 64, 64);
  }, []);

  const uniforms = useMemo(() => {
    return {
      uCloudTexture: { value: cloudTexture },
      uAltitude: { value: altitude },
      uOpacity: { value: opacity },
      uTime: { value: 0 }
    };
  }, [cloudTexture, altitude, opacity]);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
      materialRef.current.uniforms.uCloudTexture.value = cloudTexture;
      materialRef.current.uniforms.uOpacity.value = opacity;
    }
  });

  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const fragmentShader = `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    uniform sampler2D uCloudTexture;
    uniform float uOpacity;
    uniform float uTime;

    float sampleCloudAlpha(vec2 uv) {
      vec4 m = texture2D(uCloudTexture, clamp(uv, 0.002, 0.998));
      return m.a > 0.0 ? m.a : m.r;
    }

    void main() {
      // Flip V so PlaneGeometry matches world Z (-80km North to +80km South)
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

      // 9-tap smooth filter to eliminate any pixelation from satellite tiles
      vec2 texel = vec2(1.0 / 512.0);
      float cCenter = sampleCloudAlpha(uv) * 0.28;
      float cSides = (
        sampleCloudAlpha(uv + vec2(texel.x, 0.0)) +
        sampleCloudAlpha(uv - vec2(texel.x, 0.0)) +
        sampleCloudAlpha(uv + vec2(0.0, texel.y)) +
        sampleCloudAlpha(uv - vec2(0.0, texel.y))
      ) * 0.12;
      float cCorners = (
        sampleCloudAlpha(uv + texel) +
        sampleCloudAlpha(uv - texel) +
        sampleCloudAlpha(uv + vec2(texel.x, -texel.y)) +
        sampleCloudAlpha(uv + vec2(-texel.x, texel.y))
      ) * 0.06;

      float cloud = cCenter + cSides + cCorners;

      if (cloud < 0.05) discard;

      // Subtle internal atmospheric billow modulation
      float drift = sin(uv.x * 28.0 + uTime * 0.08) * cos(uv.y * 24.0 - uTime * 0.06) * 0.04;
      float finalDensity = clamp(cloud + drift, 0.0, 1.0);

      // Sunlit cloud top shading: soft blue-grey shadow underbase, warm ivory sunlit tops
      vec3 shadowTint = vec3(0.84, 0.89, 0.96);
      vec3 sunlitTop = vec3(0.99, 0.99, 0.98);
      vec3 cloudColor = mix(shadowTint, sunlitTop, smoothstep(0.10, 0.68, finalDensity));

      // Domain boundary fade
      float edgeFade = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x) *
                       smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);

      float alpha = smoothstep(0.05, 0.62, finalDensity) * uOpacity * edgeFade;
      if (alpha < 0.01) discard;

      gl_FragColor = vec4(cloudColor, alpha);
    }
  `;

  if (!visible) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={[0, altitude, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};
