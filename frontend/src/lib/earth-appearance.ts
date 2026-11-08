/**
 * BugVoyage's graphic, self-illuminated atlas material.
 * Geographic color is computed in geographic coordinates, so turning the camera
 * never moves gradients or makes a country disappear into an unlit hemisphere.
 */
export const geographicMaterialShader = `
uniform vec3 landDeep; uniform vec3 landEmerald; uniform vec3 landTurquoise;
uniform vec3 landAqua; uniform vec3 landMint; uniform vec3 oceanDeep;
uniform vec3 oceanBlue; uniform vec3 oceanHighlight;
float geoHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.17, 0.31, 0.53));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float geoNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(geoHash(i),geoHash(i+vec3(1,0,0)),f.x),
        mix(geoHash(i+vec3(0,1,0)),geoHash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(geoHash(i+vec3(0,0,1)),geoHash(i+vec3(1,0,1)),f.x),
        mix(geoHash(i+vec3(0,1,1)),geoHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
vec3 geoPalette(float t) {
  vec3 c = mix(landDeep, landEmerald, smoothstep(0.03,0.34,t));
  c = mix(c, landTurquoise, smoothstep(0.25,0.57,t));
  c = mix(c, landAqua, smoothstep(0.48,0.79,t));
  return mix(c, landMint, smoothstep(0.75,1.05,t));
}
`;

/** Replacement of MeshBasicMaterial's map chunk: no direct lights, HDRI,
 * metalness, clearcoat, specular hotspots, or day/night darkness.
 * Texture G separates land from ocean in the bundled original color atlas.
 */
export const geographicMapFragment = `
#ifdef USE_MAP
  vec4 atlas = texture2D(map, vMapUv);
  float lon = (vMapUv.x-0.5)*6.2831853;
  float lat = (0.5-vMapUv.y)*3.14159265;
  vec3 geo = vec3(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon));
  // Broad continuous regions rather than moving spotlights or grainy pixels.
  float broad = geoNoise(geo*2.8+vec3(7.1,2.4,5.8));
  float regional = geoNoise(geo*6.3+vec3(2.3,9.2,1.4));
  float flowing = geoNoise(geo*11.0+vec3(6.4,3.1,9.2));
  float tone = clamp(0.11 + broad*0.59 + regional*0.25 + flowing*0.12, 0.0,1.0);
  // The supplied base-color PNG has blue-green oceans; the missing
  // luminous atlas used a different range. Samples are linear sRGB here.
  float land = smoothstep(0.24,0.43,atlas.g);
  vec3 surface = geoPalette(tone);
  // Deliberately gentle, non-black surface curvature shading.
  float illumination = mix(0.88,1.06,smoothstep(-0.55,0.95,geo.y*0.38 + geo.z*0.32));
  surface *= illumination;
  vec3 ocean = mix(oceanDeep,oceanBlue, 0.24+0.65*broad);
  ocean = mix(ocean,oceanHighlight,0.08+regional*0.08);
  // Fine geography stays very faint; no noisy stippling or blown-out veins.
  // The atlas contributes shape, not a second bright line/noise overlay.
  diffuseColor.rgb = mix(ocean,surface,land);
#endif
`;

// Retained for compatibility with older globe appearance imports.
export const geographicEmissionFragment = ``;

export const atmosphereVertexShader = `
varying vec3 worldPoint;
void main() {
  vec4 world = modelMatrix * vec4(position,1.0);
  worldPoint = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const atmosphereFragmentShader = `
uniform vec3 cyan;
uniform vec3 blue;
uniform float scaleHeight;
uniform float strength;
uniform float outerRadius;
varying vec3 worldPoint;
void main() {
  vec3 ray = normalize(worldPoint-cameraPosition);
  float impact = length(cross(cameraPosition,ray));
  float altitude = max(0.0, impact-1.0);
  // The visible atmosphere exists outside the geographic silhouette only.
  float clearOfPlanet = smoothstep(0.999,1.006,impact);
  // Exponential density fades away well before the mesh ends; no cyan band.
  float density = exp(-pow(altitude/max(scaleHeight,0.0001),1.40));
  float fadeAtShell = 1.0-smoothstep(outerRadius-0.027,outerRadius,impact);
  float alpha = clamp(strength*clearOfPlanet*density*fadeAtShell,0.0,0.48);
  vec3 color = mix(cyan,blue,smoothstep(0.0,0.055,altitude));
  gl_FragColor = vec4(color,alpha);
  #include <colorspace_fragment>
}
`;
