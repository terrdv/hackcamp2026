# PreZero — appearance-only globe update

Updated `src/components/GlassEarth.tsx` and `src/lib/earth-appearance.ts`.

- Replaced reflective physical globe material with a controlled graphic/unlit atlas material.
- Removed intense directional lights that darkened entire countries and caused circular specular hotspots.
- Multi-scale, low-frequency geographic gradients blend teal, emerald, aqua and mint within each landmass. No camera-following light spots.
- Simplified the atmosphere to one transparent, soft-falloff shader shell; removed stacked opaque glow layers.
- Removed bump/normal/metal/clearcoat effects and excess procedural fine-grained noise.
- Reduced overly bright highlighted-country outlines.
- Left navigation, destination search, camera, zoom, disease markers and panels unchanged.

## Important preview limitation

The exported Lovable project contains **asset references** (`src/assets/*.asset.json`) rather than the actual 15 MB GLB globe or its WebP color atlas. The original assets remain referenced for production on Lovable. To run this project outside Lovable, replace those reference URLs with accessible local asset files (or supply valid public asset URLs); otherwise the existing `onError` globe fallback can trigger. The provided PNG is a design-faithful *concept visualization* rendered from Natural Earth geographic outlines, **not** an actual Chromium screenshot of the application, and was not produced by its Three.js shader.

## Running

Install dependencies with `npm install`, then `npm run dev`. Because package installation and remote Lovable assets are inaccessible in this sandbox, a full browser build of the exported app could not be verified here.
