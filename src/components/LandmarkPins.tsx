import React from 'react';
import { Html } from '@react-three/drei';
import { Landmark } from '../types';
import {
  KURDISTAN_LANDMARKS,
  getRealKurdistanElevation,
  getEarthCurvatureDropMeters
} from '../utils/realSulaymaniyahTerrain';

export type { Landmark };
export const LANDMARKS: Landmark[] = KURDISTAN_LANDMARKS;

interface LandmarkPinsProps {
  onSelectLandmark: (landmark: Landmark) => void;
  visible?: boolean;
  terrainExaggeration?: number;
  selectedLandmarkId?: string;
  isGround360Mode?: boolean;
  globeRefXZ?: [number, number];
}

export const LandmarkPins: React.FC<LandmarkPinsProps> = ({
  onSelectLandmark,
  visible = true,
  terrainExaggeration = 1.35,
  selectedLandmarkId,
  isGround360Mode = false,
  globeRefXZ = [0, 0]
}) => {
  if (!visible) return null;

  return (
    <group>
      {LANDMARKS.map((lm) => {
        if (isGround360Mode && selectedLandmarkId === lm.id) {
          return null;
        }

        const isBorder = lm.type === 'border';
        const isMountain = lm.type === 'mountain';
        const isWater = lm.type === 'water';

        let badgeBg = 'bg-emerald-500/90 text-slate-950 border-emerald-300';
        let pinColor = '#10b981';

        if (isMountain) {
          badgeBg = 'bg-amber-500/90 text-slate-950 border-amber-300';
          pinColor = '#f59e0b';
        } else if (isWater) {
          badgeBg = 'bg-cyan-500/90 text-slate-950 border-cyan-300';
          pinColor = '#06b6d4';
        } else if (isBorder) {
          badgeBg = 'bg-rose-500/90 text-white border-rose-300';
          pinColor = '#f43f5e';
        }

        const wx = lm.position[0];
        const wz = lm.position[2];
        const globeDrop = getEarthCurvatureDropMeters(wx, wz, globeRefXZ[0], globeRefXZ[1]);
        const groundY = getRealKurdistanElevation(wx, wz) * terrainExaggeration + globeDrop;

        return (
          <group key={lm.id} position={[wx, groundY + 140, wz]}>
            {/* Vertical 3D locator beacon pillar */}
            <mesh position={[0, -70, 0]}>
              <cylinderGeometry args={[48, 16, 140, 8]} />
              <meshBasicMaterial color={pinColor} transparent opacity={0.65} />
            </mesh>

            {/* Glowing top orb */}
            <mesh position={[0, 18, 0]}>
              <sphereGeometry args={[75, 16, 16]} />
              <meshBasicMaterial color={pinColor} />
            </mesh>

            {/* Interactive HTML Billboard Marker */}
            <Html
              position={[0, 150, 0]}
              center
              distanceFactor={38000}
              zIndexRange={[100, 0]}
            >
              <button
                id={`btn-landmark-${lm.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectLandmark(lm);
                }}
                className="group flex flex-col items-center cursor-pointer transition-transform hover:scale-110 active:scale-95 focus:outline-none"
                title={`Enter 360° Ground View at ${lm.name}`}
              >
                <div
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider shadow-lg border backdrop-blur-sm whitespace-nowrap flex items-center gap-1.5 ${badgeBg}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span>{lm.name}</span>
                  <span className="px-1 py-0.1 rounded bg-black/25 text-[8px] font-extrabold">
                    360°
                  </span>
                </div>
                {lm.subLabel && (
                  <div className="mt-0.5 px-1.5 py-0.5 bg-slate-900/90 text-slate-300 text-[8px] font-mono rounded border border-slate-700/60 shadow whitespace-nowrap">
                    {lm.subLabel}
                  </div>
                )}
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
};
