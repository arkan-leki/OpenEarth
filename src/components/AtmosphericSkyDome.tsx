import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { SunPositionResult } from '../utils/sunPosition';

interface AtmosphericSkyDomeProps {
  sunPosition?: SunPositionResult;
}

/**
 * 3D Rayleigh & Mie Atmospheric Blue Sky Dome
 * Envelops the entire 480km x 320km curved Earth Globe with:
 * - Deep Royal/Cobalt Blue zenith overhead
 * - Vibrant Cerulean mid-sky
 * - Luminous Azure Rayleigh horizon scatter where distant mountains & clouds disappear at 50km-100km
 * - Solar Mie Aureole & Sun Disk
 */
export const AtmosphericSkyDome: React.FC<AtmosphericSkyDomeProps> = ({ sunPosition }) => {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.32).normalize() },
      uSunElevation: { value: 52.0 },
      uSunColor: { value: new THREE.Color('#ffffff') }
    }),
    []
  );

  useFrame(({ camera }) => {
    if (!matRef.current) return;
    if (sunPosition) {
      matRef.current.uniforms.uSunDir.value.copy(sunPosition.sunDirection);
      matRef.current.uniforms.uSunElevation.value = sunPosition.elevationDeg;
      matRef.current.uniforms.uSunColor.value.set(sunPosition.lightColor);
    }
    // Keep sky dome centered on camera XZ
    matRef.current.needsUpdate = false;
    void camera;
  });

  const vertexShader = `
    varying vec3 vWorldDir;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldDir = normalize(position);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const fragmentShader = `
    precision highp float;
    varying vec3 vWorldDir;

    uniform vec3 uSunDir;
    uniform float uSunElevation;
    uniform vec3 uSunColor;

    void main() {
      vec3 dir = normalize(vWorldDir);
      // Elevation angle above the curved globe horizon
      float horizonY = clamp(dir.y + 0.08, 0.0, 1.0);

      // Daylight factor (1.0 in daylight, transitions smoothly for golden hour / twilight)
      float dayFactor = smoothstep(-8.0, 14.0, uSunElevation);
      float goldenFactor = smoothstep(-3.0, 6.0, uSunElevation) * (1.0 - smoothstep(8.0, 22.0, uSunElevation));

      // Authentic Rayleigh Blue Sky palette:
      // Zenith: Deep alpine cobalt blue | Mid-sky: Cerulean blue | Horizon: Luminous sky-azure scatter
      vec3 dayZenith  = vec3(0.08, 0.34, 0.72);
      vec3 dayMidSky  = vec3(0.18, 0.50, 0.88);
      vec3 dayHorizon = vec3(0.54, 0.80, 0.99);

      vec3 nightZenith  = vec3(0.03, 0.06, 0.14);
      vec3 nightHorizon = vec3(0.08, 0.15, 0.28);

      vec3 zenithCol  = mix(nightZenith, dayZenith, dayFactor);
      vec3 midSkyCol  = mix(nightHorizon, dayMidSky, dayFactor);
      vec3 horizonCol = mix(nightHorizon, dayHorizon, dayFactor);

      // Golden hour horizon warmth
      horizonCol = mix(horizonCol, vec3(0.96, 0.62, 0.36), goldenFactor * 0.55);

      // Smooth vertical Rayleigh gradient from horizon to zenith
      float lowerBlend = smoothstep(0.0, 0.28, horizonY);
      float upperBlend = smoothstep(0.22, 0.88, horizonY);
      vec3 skyRGB = mix(horizonCol, midSkyCol, lowerBlend);
      skyRGB = mix(skyRGB, zenithCol, upperBlend);

      // Atmospheric horizon glow band where the 50km-100km globe edge meets the sky
      float horizonRim = exp(-abs(dir.y + 0.015) * 14.0);
      skyRGB = mix(skyRGB, horizonCol * 1.08, horizonRim * 0.55 * dayFactor);

      // Solar Mie Aureole & Sun Disk
      float cosSun = max(0.0, dot(dir, normalize(uSunDir)));
      float mieGlow = pow(cosSun, 8.0) * 0.28 + pow(cosSun, 64.0) * 0.45;
      float sunDisk = smoothstep(0.9992, 0.99985, cosSun);
      skyRGB += uSunColor * (mieGlow * dayFactor + sunDisk * 1.4 * dayFactor);

      gl_FragColor = vec4(skyRGB, 1.0);
    }
  `;

  return (
    <mesh position={[0, 0, 0]} frustumCulled={false} renderOrder={-10}>
      <sphereGeometry args={[3000000, 64, 48]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
};
