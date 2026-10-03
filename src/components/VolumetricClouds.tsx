import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { CloudShader } from '../shaders/cloudShader';
import { ShaderParameters } from '../types';
import { CloudClassification } from '../services/cloudClassificationService';
import { SunPositionResult } from '../utils/sunPosition';
import {
  DOMAIN_WIDTH_METERS,
  DOMAIN_HEIGHT_METERS,
  HALF_DOMAIN_WIDTH,
  HALF_DOMAIN_HEIGHT
} from '../utils/realSulaymaniyahTerrain';

interface VolumetricCloudsProps {
  weatherTexture: THREE.Texture;
  params: ShaderParameters;
  classification: CloudClassification;
  sunPosition?: SunPositionResult;
  globeRefXZ?: [number, number];
}

export const VolumetricClouds: React.FC<VolumetricCloudsProps> = ({
  weatherTexture,
  params,
  classification,
  sunPosition,
  globeRefXZ = [0, 0]
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);
  const prevTextureRef = useRef<THREE.Texture>(weatherTexture);
  const lightningTimer = useRef(0);
  const lightningFlash = useRef(0);

  const { baseAltitudeM, topAltitudeM, thicknessM } = classification;
  // Expand vertical bounding box downward by 11,500m to enclose clouds that curve down over the 480km x 320km Earth Globe
  const boxBottomY = baseAltitudeM - 11500;
  const boxTopY = topAltitudeM + 200;
  const boxHeight = boxTopY - boxBottomY;
  const boxCenterY = boxBottomY + boxHeight / 2;

  const uniforms = useMemo(() => {
    return {
      uTime: { value: 0 },
      uWeatherData: { value: weatherTexture },
      uWeatherDataPrev: { value: weatherTexture },
      uTransitionProgress: { value: 1.0 },
      uCameraPos: { value: new THREE.Vector3(0, 4000, 20000) },
      uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
      uSunColor: { value: new THREE.Color('#fffbf0') },
      uSkyColor: { value: new THREE.Color('#3b82f6') },
      // Sized from the domain constants, not hardcoded: the old fixed box (-240000..240000)
      // only covered the centre of the map, so clouds never reached the edges.
      uBoxMin: { value: new THREE.Vector3(-HALF_DOMAIN_WIDTH, baseAltitudeM - 11500, -HALF_DOMAIN_HEIGHT) },
      uBoxMax: { value: new THREE.Vector3(HALF_DOMAIN_WIDTH, topAltitudeM + 200, HALF_DOMAIN_HEIGHT) },
      uDomainMinXZ: { value: new THREE.Vector2(-HALF_DOMAIN_WIDTH, -HALF_DOMAIN_HEIGHT) },
      uDomainSizeXZ: { value: new THREE.Vector2(DOMAIN_WIDTH_METERS, DOMAIN_HEIGHT_METERS) },
      uCloudBaseY: { value: baseAltitudeM },
      uCloudTopY: { value: topAltitudeM },
      uGlobeRefXZ: { value: new THREE.Vector2(globeRefXZ[0], globeRefXZ[1]) },
      uSteps: { value: params.raymarchSteps || 56 },
      uCloudDensityMultiplier: { value: (params.cloudDensityMultiplier || 1.5) * classification.densityBoost },
      uAbsorption: { value: params.absorptionFactor || 0.55 },
      uSunScatterIntensity: { value: params.sunScatterIntensity || 1.5 },
      uWindSpeed: { value: params.windSpeed || 0.8 },
      uLightning: { value: 0.0 },
      uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
      uPredictedOffset: { value: new THREE.Vector2(0.0, 0.0) },
      uWorleyFreq: { value: classification.worleyFrequency },
      uPuffyFactor: { value: classification.puffyFactor },
      uFlatBaseSharpness: { value: classification.flatBaseSharpness },
      uDomeRoundness: { value: classification.domeRoundness },
      uHasAnvil: { value: classification.hasAnvil ? 1.0 : 0.0 }
    };
  }, []);

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
          duration: 0.95,
          ease: 'power2.out'
        }
      );
    }
  }, [weatherTexture]);

  useEffect(() => {
    if (!shaderMatRef.current) return;
    const mat = shaderMatRef.current;

    const targetDensity = (params.cloudDensityMultiplier || 1.5) * classification.densityBoost;
    const targetAbsorption = params.absorptionFactor || 0.55;
    const targetWorley = classification.worleyFrequency;
    const targetPuffy = classification.puffyFactor;
    const targetFlatBase = classification.flatBaseSharpness;
    const targetDome = classification.domeRoundness;

    gsap.to(mat.uniforms.uCloudDensityMultiplier, {
      value: targetDensity,
      duration: 1.2,
      ease: 'power2.out',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uAbsorption, {
      value: targetAbsorption,
      duration: 1.2,
      ease: 'power2.out',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uWorleyFreq, {
      value: targetWorley,
      duration: 1.2,
      ease: 'power2.out',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uPuffyFactor, {
      value: targetPuffy,
      duration: 1.2,
      ease: 'power2.out',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uFlatBaseSharpness, {
      value: targetFlatBase,
      duration: 1.2,
      ease: 'power2.out',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uDomeRoundness, {
      value: targetDome,
      duration: 1.2,
      ease: 'power2.out',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uCloudBaseY, {
      value: baseAltitudeM,
      duration: 1.35,
      ease: 'power2.inOut',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uCloudTopY, {
      value: topAltitudeM,
      duration: 1.35,
      ease: 'power2.inOut',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uBoxMin.value, {
      y: baseAltitudeM - 11500,
      duration: 1.35,
      ease: 'power2.inOut',
      overwrite: 'auto'
    });
    gsap.to(mat.uniforms.uBoxMax.value, {
      y: topAltitudeM + 200,
      duration: 1.35,
      ease: 'power2.inOut',
      overwrite: 'auto'
    });
  }, [
    params.cloudDensityMultiplier,
    params.absorptionFactor,
    classification,
    baseAltitudeM,
    topAltitudeM
  ]);

  useFrame((state, delta) => {
    if (!shaderMatRef.current) return;
    const mat = shaderMatRef.current;

    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uCameraPos.value.copy(state.camera.position);
    mat.uniforms.uWeatherData.value = weatherTexture;
    // Distance-adaptive step count: full quality at normal viewing distances, easing off
    // only at extreme zoom-out where the clouds are tiny on screen (keeps the far zoom smooth).
    const camDist = state.camera.position.length();
    const stepScale = camDist < 2000000 ? 1.0 : 0.62;
    mat.uniforms.uSteps.value = Math.max(32, Math.round((params.raymarchSteps || 96) * stepScale));
    mat.uniforms.uWindSpeed.value = params.windSpeed || 0.8;
    mat.uniforms.uHasAnvil.value = classification.hasAnvil ? 1.0 : 0.0;
    mat.uniforms.uGlobeRefXZ.value.set(globeRefXZ[0], globeRefXZ[1]);

    if (sunPosition) {
      mat.uniforms.uSunDir.value.copy(sunPosition.sunDirection);
      mat.uniforms.uSunColor.value.set(sunPosition.lightColor);
      mat.uniforms.uSkyColor.value.set(sunPosition.ambientColor);
      mat.uniforms.uSunScatterIntensity.value =
        (params.sunScatterIntensity || 1.5) * (sunPosition.cloudSunScatter / 1.5);
    } else {
      mat.uniforms.uSunScatterIntensity.value = params.sunScatterIntensity || 1.5;
    }

    if (classification.hasLightning) {
      lightningTimer.current += delta;
      if (lightningTimer.current > 3.5 / Math.max(0.1, params.lightningFrequency)) {
        lightningFlash.current = 1.0;
        lightningTimer.current = Math.random() * 1.2;
      }

      if (lightningFlash.current > 0.01) {
        lightningFlash.current *= 0.84;
        mat.uniforms.uLightning.value = lightningFlash.current;
      } else {
        mat.uniforms.uLightning.value = 0.0;
      }
    } else {
      mat.uniforms.uLightning.value = 0.0;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, boxCenterY, 0]} frustumCulled={false}>
      <boxGeometry args={[DOMAIN_WIDTH_METERS, boxHeight, DOMAIN_HEIGHT_METERS]} />
      <shaderMaterial
        ref={shaderMatRef}
        uniforms={uniforms}
        vertexShader={CloudShader.vertexShader}
        fragmentShader={CloudShader.fragmentShader}
        transparent={true}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};
