import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  MAP_RADIUS_METERS,
  DOMAIN_WIDTH_METERS,
  DOMAIN_HEIGHT_METERS,
  getEarthCurvatureDropMeters
} from '../utils/realSulaymaniyahTerrain';

/**
 * Solid base slab beneath the circular map.
 *
 * Two things make this more than a decorative box:
 *
 *  1. It is a CYLINDER matching MAP_RADIUS_METERS, not a square box. The rendered map is a
 *     circle, so a box would show four square corners sticking out beyond the terrain.
 *
 *  2. Its curvature is baked into the vertices with the SAME formula the terrain shader uses.
 *     Previously the base was a flat slab while only the terrain curved — so wherever the
 *     terrain curved below the slab's top face (which, with correct Earth curvature, is
 *     50 km at the rim) the slab punched through and hid the map. Baking the drop means the
 *     base tracks the terrain everywhere.
 *
 * The curvature reference is the domain centre (0,0), matching the terrain's aerial mode.
 * In 360° ground mode the reference moves to the observer, but the base is far below the
 * surface and not visible from there.
 */

/** Height of the slab's top face relative to sea level, in metres. */
const CRUST_TOP_Y = -500;
const CRUST_THICKNESS = 14000;

export const PlanetaryCrustBase: React.FC = () => {
  const geometry = useMemo(() => {
    // Box, not a cylinder: the terrain now fills the full square domain, so the corners
    // need a floor under them too.
    const geom = new THREE.BoxGeometry(DOMAIN_WIDTH_METERS, CRUST_THICKNESS, DOMAIN_HEIGHT_METERS, 96, 1, 96);

    // A cylinder is centred on y=0, so shift it so the TOP cap lands at CRUST_TOP_Y.
    const yShift = CRUST_TOP_Y - CRUST_THICKNESS / 2;
    const pos = geom.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, pos.getY(i) + yShift + getEarthCurvatureDropMeters(x, z, 0, 0));
    }

    pos.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    return geom;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} receiveShadow={false} renderOrder={-1}>
      <meshStandardMaterial color="#162133" roughness={0.95} metalness={0.02} />
    </mesh>
  );
};
