import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { CirrusParticleShader } from '../shaders/cirrusParticleShader';
import { SunPositionResult } from '../utils/sunPosition';

interface HighAltitudeCirrusParticlesProps {
  weatherTexture: THREE.Texture;
  sunPosition?: SunPositionResult;
  windSpeed?: number;
  visible?: boolean;
}

/**
 * Hybrid Particle-Shader System for High-Altitude Cirrus Clouds (8,200m - 10,800m MSL).
 *
 * Uses 1,600 instanced anisotropic noise-sculpted cloud ribbons that advect independently
 * along the upper-tropospheric Subtropical Jet Stream vector (WSW -> ENE), moving at a
 * distinct speed and direction from the lower-level volumetric cumulus/cumulonimbus formations.
 */
export const HighAltitudeCirrusParticles: React.FC<HighAltitudeCirrusParticlesProps> = ({
  weatherTexture,
  sunPosition,
  windSpeed = 0.8,
  visible = true
}) => {
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);
  const prevTextureRef = useRef<THREE.Texture>(weatherTexture);

  const instanceCount = 1600;

  // Build instanced geometry for 1,600 high-altitude cirrus ribbon particles
  const instancedGeometry = useMemo(() => {
    const baseQuad = new THREE.PlaneGeometry(1, 1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseQuad.index;
    geo.attributes.position = baseQuad.attributes.position;
    geo.attributes.uv = baseQuad.attributes.uv;

    const instancePositions = new Float32Array(instanceCount * 3);
    const instanceScales = new Float32Array(instanceCount * 2);
    const instanceSeeds = new Float32Array(instanceCount);
    const instanceJetSpeeds = new Float32Array(instanceCount);

    // Deterministic Halton-like stratified distribution across the 240km x 160km domain
    for (let i = 0; i < instanceCount; i++) {
      const r1 = ((i * 1.61803398875) % 1.0);
      const r2 = ((i * 0.75487766624) % 1.0);
      const r3 = ((i * 0.56984029099) % 1.0);

      // World X (-118km .. +118km), World Y (8,200m .. 10,800m), World Z (-78km .. +78km)
      instancePositions[i * 3 + 0] = (r1 - 0.5) * 236000.0;
      instancePositions[i * 3 + 1] = 8200.0 + r3 * 2600.0;
      instancePositions[i * 3 + 2] = (r2 - 0.5) * 156000.0;

      // Elongated ribbon scale along the jet-stream axis (9km - 22km long, 3.5km - 9km wide)
      const lengthM = 9500.0 + ((i * 0.381966) % 1.0) * 13500.0;
      const widthM = 3800.0 + ((i * 0.276393) % 1.0) * 5400.0;
      instanceScales[i * 2 + 0] = lengthM;
      instanceScales[i * 2 + 1] = widthM;

      instanceSeeds[i] = (i * 0.1379) % 1.0;
      instanceJetSpeeds[i] = 0.65 + r3 * 0.85; // higher cirrus filaments move faster in the jet core
    }

    geo.setAttribute('aInstancePos', new THREE.InstancedBufferAttribute(instancePositions, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(instanceScales, 2));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(instanceSeeds, 1));
    geo.setAttribute('aJetSpeedFactor', new THREE.InstancedBufferAttribute(instanceJetSpeeds, 1));

    return geo;
  }, [instanceCount]);

  const uniforms = useMemo(() => {
    return {
      uTime: { value: 0 },
      uWeatherData: { value: weatherTexture },
      uTransitionProgress: { value: 1.0 },
      uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
      uSunColor: { value: new THREE.Color('#fffdf8') },
      uSkyColor: { value: new THREE.Color('#60a5fa') },
      // Independent Subtropical Jet Stream direction (WSW -> ENE, ~65 deg azimuth shear vs lower winds)
      uJetStreamDir: { value: new THREE.Vector2(0.91, -0.41).normalize() },
      uJetStreamSpeed: { value: 1.65 },
      uOpacityMultiplier: { value: 0.58 }
    };
  }, []);

  // Smooth GSAP transition when switching between Today, Yesterday, and Live modes
  useEffect(() => {
    if (!shaderMatRef.current) return;
    const mat = shaderMatRef.current;

    if (prevTextureRef.current !== weatherTexture) {
      mat.uniforms.uWeatherData.value = weatherTexture;
      prevTextureRef.current = weatherTexture;

      gsap.killTweensOf(mat.uniforms.uTransitionProgress);
      gsap.fromTo(
        mat.uniforms.uTransitionProgress,
        { value: 0.0 },
        {
          value: 1.0,
          duration: 1.05,
          ease: 'power2.out'
        }
      );
    }
  }, [weatherTexture]);

  useFrame((state) => {
    if (!shaderMatRef.current) return;
    const mat = shaderMatRef.current;

    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uWeatherData.value = weatherTexture;
    // Upper-level jet stream moves independently and faster than lower boundary-layer wind
    mat.uniforms.uJetStreamSpeed.value = Math.max(1.1, (windSpeed || 0.8) * 1.95);

    if (sunPosition) {
      mat.uniforms.uSunDir.value.copy(sunPosition.sunDirection);
      mat.uniforms.uSunColor.value.set(sunPosition.lightColor);
      mat.uniforms.uSkyColor.value.set(sunPosition.ambientColor);
    }
  });

  useEffect(() => {
    return () => {
      instancedGeometry.dispose();
    };
  }, [instancedGeometry]);

  if (!visible) return null;

  return (
    <mesh geometry={instancedGeometry} frustumCulled={false}>
      <shaderMaterial
        ref={shaderMatRef}
        uniforms={uniforms}
        vertexShader={CirrusParticleShader.vertexShader}
        fragmentShader={CirrusParticleShader.fragmentShader}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};
