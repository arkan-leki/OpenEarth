import React, { useMemo, useRef, useEffect } from 'react';
import {
  DOMAIN_WIDTH_METERS,
  DOMAIN_HEIGHT_METERS,
  HALF_DOMAIN_WIDTH,
  HALF_DOMAIN_HEIGHT,
} from '../utils/realSulaymaniyahTerrain';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SunPositionResult } from '../utils/sunPosition';
import { CloudClassification } from '../services/cloudClassificationService';
import { ShaderParameters } from '../types';

interface CloudShadowDepthProjectorProps {
  weatherTexture: THREE.Texture;
  sunPosition?: SunPositionResult;
  classification: CloudClassification;
  shaderParams: ShaderParameters;
  onShadowBufferReady: (shadowDepthTexture: THREE.Texture) => void;
}

/**
 * Secondary Offscreen Depth-Buffer-Based Cloud Shadow & Multi-Octave FBM Optical Depth Projector.
 *
 * Renders a 512x512 GPU FBM Optical-Depth & Effective Cloud-Height Map along the solar ray vector:
 * - R channel: Multi-Octave 5-level FBM + 3D Worley integrated optical depth (tau_FBM)
 * - G channel: Effective normalized cloud shadow-caster depth/elevation (z_cloud)
 * - B channel: FBM fringe penumbra softness
 * - A channel: Beer-Lambert shadow transmittance exp(-tau_FBM)
 */
export const CloudShadowDepthProjector: React.FC<CloudShadowDepthProjectorProps> = ({
  weatherTexture,
  sunPosition,
  classification,
  shaderParams,
  onShadowBufferReady
}) => {
  const { gl } = useThree();

  const renderTarget = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(512, 512, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true
    });
    return rt;
  }, []);

  const orthoCamera = useMemo(() => {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return cam;
  }, []);

  const offscreenScene = useMemo(() => new THREE.Scene(), []);

  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  const shadowMaterial = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWeatherData: { value: weatherTexture },
        uSunDir: { value: new THREE.Vector3(0.55, 0.78, 0.28).normalize() },
        uWindDir: { value: new THREE.Vector2(-0.85, -0.52).normalize() },
        uWindSpeed: { value: shaderParams.windSpeed || 0.8 },
        uWorleyFreq: { value: classification.worleyFrequency || 0.00045 },
        uCloudDensityMultiplier: {
          value: (shaderParams.cloudDensityMultiplier || 1.5) * classification.densityBoost
        },
        uCloudBaseY: { value: classification.baseAltitudeM },
        uCloudTopY: { value: classification.topAltitudeM }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;

        uniform float uTime;
        uniform sampler2D uWeatherData;
        uniform vec3 uSunDir;
        uniform vec2 uWindDir;
        uniform float uWindSpeed;
        uniform float uWorleyFreq;
        uniform float uCloudDensityMultiplier;
        uniform float uCloudBaseY;
        uniform float uCloudTopY;

        varying vec2 vUv;

        const mat3 m3 = mat3(
           0.00,  0.80,  0.60,
          -0.80,  0.36, -0.48,
          -0.60, -0.48,  0.64
        );

        vec3 hash33(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.xxy + p.yxx) * p.zyx);
        }

        float hash(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float noise3D(vec3 x) {
          vec3 p = floor(x);
          vec3 f = fract(x);
          f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
          return mix(
            mix(mix(hash(p + vec3(0,0,0)), hash(p + vec3(1,0,0)), f.x),
                mix(hash(p + vec3(0,1,0)), hash(p + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(p + vec3(0,0,1)), hash(p + vec3(1,0,1)), f.x),
                mix(hash(p + vec3(0,1,1)), hash(p + vec3(1,1,1)), f.x), f.y), f.z);
        }

        float worley3D(vec3 p) {
          vec3 id = floor(p);
          vec3 f = fract(p);
          float minDist = 1.0;
          for (int z = -1; z <= 1; z++) {
            for (int y = -1; y <= 1; y++) {
              for (int x = -1; x <= 1; x++) {
                vec3 neighbor = vec3(float(x), float(y), float(z));
                vec3 point = hash33(id + neighbor);
                vec3 diff = neighbor + point - f;
                minDist = min(minDist, dot(diff, diff));
              }
            }
          }
          return sqrt(minDist);
        }

        // 5-Octave Fractional Brownian Motion (FBM) matching CloudShader
        float fbmPuffy5(vec3 p) {
          float value = 0.0;
          float amplitude = 0.50;
          float norm = 0.0;
          for (int i = 0; i < 5; i++) {
            float n = noise3D(p);
            float billow = 1.0 - abs(n * 2.0 - 1.0);
            float puffOctave = mix(n, sqrt(max(0.0, billow)), 0.52);
            value += amplitude * puffOctave;
            norm += amplitude;
            p = m3 * p * 2.05 + vec3(17.3, 31.7, 11.9);
            amplitude *= 0.50;
          }
          return value / norm;
        }

        void main() {
          // World XZ coordinate at cloud-base reference plane (480km x 320km globe domain)
          vec2 worldXZ = vec2(
            vUv.x * ${DOMAIN_WIDTH_METERS.toFixed(1)} - ${HALF_DOMAIN_WIDTH.toFixed(1)},
            vUv.y * ${DOMAIN_HEIGHT_METERS.toFixed(1)} - ${HALF_DOMAIN_HEIGHT.toFixed(1)}
          );

          vec2 dynamicDrift = uWindDir * (uTime * uWindSpeed * 3.5);

          // March 4 depth strata along the solar ray through the 3D cloud slab [uCloudBaseY, uCloudTopY]
          float totalOpticalDepth = 0.0;
          float weightedDepthSum = 0.0;
          float weightSum = 0.0001;
          float fbmPenumbraAccum = 0.0;

          float slabThickness = max(800.0, uCloudTopY - uCloudBaseY);

          for (int s = 0; s < 4; s++) {
            float h = (float(s) + 0.5) / 4.0;
            float altY = mix(uCloudBaseY, uCloudTopY, h);

            // Slanted solar ray intersection at altitude altY relative to cloud base
            vec2 rayXZ = worldXZ + uSunDir.xz * ((altY - uCloudBaseY) / max(0.22, uSunDir.y));
            vec2 advectedXZ = rayXZ - dynamicDrift;
            vec2 satUv = clamp(vec2(
              (advectedXZ.x + ${HALF_DOMAIN_WIDTH.toFixed(1)}) / ${DOMAIN_WIDTH_METERS.toFixed(1)},
              (advectedXZ.y + ${HALF_DOMAIN_HEIGHT.toFixed(1)}) / ${DOMAIN_HEIGHT_METERS.toFixed(1)}
            ), 0.002, 0.998);

            vec4 w = texture2D(uWeatherData, satUv);
            float satHaze = w.r;
            float satCore = max(w.a, satHaze * 0.85);

            if (satHaze > 0.012) {
              float cloudTop = mix(0.38, 0.94, smoothstep(0.02, 0.75, satCore));
              float softBase = smoothstep(0.01, 0.20, h);
              float softTop  = 1.0 - smoothstep(cloudTop - 0.28, cloudTop + 0.04, h);
              float verticalProfile = softBase * softTop;

              if (verticalProfile > 0.001) {
                vec3 coord = vec3(
                  advectedXZ.x * (uWorleyFreq * 1.15),
                  altY * (uWorleyFreq * 2.10),
                  advectedXZ.y * (uWorleyFreq * 1.15)
                );

                float fbm5 = fbmPuffy5(coord);
                float worleyPuff = 1.0 - worley3D(coord * 1.35 + vec3(2.4, 5.1, 7.3));
                float waveRipple = 0.5 + 0.5 * sin((rayXZ.x * 0.0022 + rayXZ.y * 0.0009) + fbm5 * 4.2);
                float fbmSignal = fbm5 * 0.52 + worleyPuff * 0.34 + waveRipple * 0.14;

                float softSatelliteEnvelope = pow(smoothstep(0.012, 0.78, satHaze), 1.15);
                float fringeFeather = mix(
                  smoothstep(0.28, 0.76, fbmSignal),
                  mix(0.68, 1.26, fbmSignal),
                  smoothstep(0.03, 0.32, satHaze)
                );

                float sliceDensity = softSatelliteEnvelope * fringeFeather * verticalProfile * uCloudDensityMultiplier;
                totalOpticalDepth += sliceDensity * 0.28;
                weightedDepthSum += h * sliceDensity;
                weightSum += sliceDensity;
                fbmPenumbraAccum += fbmSignal * 0.25;
              }
            }
          }

          float normalizedOpticalDepth = clamp(totalOpticalDepth * 0.85, 0.0, 1.0);
          float effectiveCasterDepth = clamp(weightedDepthSum / weightSum, 0.0, 1.0);
          float transmittance = exp(-totalOpticalDepth * 1.45);

          gl_FragColor = vec4(
            normalizedOpticalDepth,
            effectiveCasterDepth,
            clamp(fbmPenumbraAccum, 0.0, 1.0),
            clamp(1.0 - transmittance, 0.0, 1.0)
          );
        }
      `,
      depthWrite: false,
      depthTest: false
    });
    materialRef.current = mat;
    return mat;
  }, []);

  useEffect(() => {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shadowMaterial);
    offscreenScene.add(quad);
    onShadowBufferReady(renderTarget.texture);

    return () => {
      offscreenScene.remove(quad);
      quad.geometry.dispose();
      shadowMaterial.dispose();
      renderTarget.dispose();
    };
  }, [offscreenScene, shadowMaterial, renderTarget, onShadowBufferReady]);

  useFrame((state) => {
    if (!materialRef.current) return;
    const mat = materialRef.current;

    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uWeatherData.value = weatherTexture;
    mat.uniforms.uWindSpeed.value = shaderParams.windSpeed || 0.8;
    mat.uniforms.uWorleyFreq.value = classification.worleyFrequency || 0.00045;
    mat.uniforms.uCloudDensityMultiplier.value =
      (shaderParams.cloudDensityMultiplier || 1.5) * classification.densityBoost;
    mat.uniforms.uCloudBaseY.value = classification.baseAltitudeM;
    mat.uniforms.uCloudTopY.value = classification.topAltitudeM;

    if (sunPosition) {
      mat.uniforms.uSunDir.value.copy(sunPosition.sunDirection);
    }

    // Render secondary depth-projected FBM optical shadow buffer
    const prevTarget = gl.getRenderTarget();
    gl.setRenderTarget(renderTarget);
    gl.render(offscreenScene, orthoCamera);
    gl.setRenderTarget(prevTarget);
  });

  return null;
};
