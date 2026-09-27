import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PrecipitationShader } from '../shaders/rainShader';

interface RainParticlesProps {
  weatherTexture: THREE.Texture;
  rainThreshold?: number;
  snowTempThreshold?: number;
  activeMaxPrecipitation?: number;
  hasActivePrecipitation?: boolean;
  windSpeed?: number;
}

export const RainParticles: React.FC<RainParticlesProps> = ({
  weatherTexture,
  rainThreshold = 0.18,
  snowTempThreshold = 2.5,
  activeMaxPrecipitation = 0.0,
  hasActivePrecipitation = false,
  windSpeed = 0.8,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);

  // Strictly only render rain or snow if it is actually raining/snowing
  const hasPrecipitation = hasActivePrecipitation || activeMaxPrecipitation > 0.1;

  // Particle count (24000 points provides dense, realistic precipitation streaks across North Vietnam)
  const particleCount = 24000;

  const { geometry, uniforms } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const seeds = new Float32Array(particleCount);
    const speedOffsets = new Float32Array(particleCount);

    // Box size: spans the full 240km x 160km North Vietnam domain
    // Vertical span: 3200m from cloud base down towards mountain valleys and plains
    const boxSize = [240000, 3200, 160000];

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * boxSize[0];
      positions[i * 3 + 1] = Math.random() * boxSize[1];
      positions[i * 3 + 2] = (Math.random() - 0.5) * boxSize[2];

      seeds[i] = Math.random();
      speedOffsets[i] = Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aSpeedOffset', new THREE.BufferAttribute(speedOffsets, 1));

    const uni = {
      uTime: { value: 0 },
      uWeatherData: { value: weatherTexture },
      uCameraPos: { value: new THREE.Vector3() },
      uBoxSize: { value: new THREE.Vector3(boxSize[0], boxSize[1], boxSize[2]) },
      uRainThreshold: { value: rainThreshold },
      uSnowTempThreshold: { value: snowTempThreshold },
      uFallSpeed: { value: 2400.0 },
      uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
      uPredictedOffset: { value: new THREE.Vector2(0.0, 0.0) },
      uWindSpeed: { value: 0.8 },
      uParticleScale: { value: 28.0 },
    };

    return { geometry: geo, uniforms: uni };
  }, [weatherTexture, rainThreshold, snowTempThreshold]);

  useFrame((state) => {
    if (shaderMatRef.current) {
      shaderMatRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      shaderMatRef.current.uniforms.uCameraPos.value.copy(state.camera.position);
      shaderMatRef.current.uniforms.uWeatherData.value = weatherTexture;
      shaderMatRef.current.uniforms.uRainThreshold.value = rainThreshold;
      shaderMatRef.current.uniforms.uWindSpeed.value = windSpeed;
    }
  });

  // If completely dry across the region, omit particles entirely to save GPU cycles and prevent false rain
  if (!hasPrecipitation) {
    return null;
  }

  return (
    <group>
      {/* Dynamic Radar-Driven Precipitation Particles (Rain streaks / Snowflakes locked to Cloud Advection) */}
      <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={shaderMatRef}
          uniforms={uniforms}
          vertexShader={PrecipitationShader.vertexShader}
          fragmentShader={PrecipitationShader.fragmentShader}
          transparent={true}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
};
