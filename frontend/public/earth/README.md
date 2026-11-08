# Portable Glass Earth assets

- `glass-earth.glb`: original model from the user-supplied `glass_earth_model.zip` (15,051,868 bytes, matching the exported GLB asset manifest). Includes embedded material images and indexed geographic UV geometry.
- `earth-basecolor.png`: unmodified `textures/earth_basecolor.png` from the same archive.

The component references `/earth/glass-earth.glb` and `/earth/earth-basecolor.png`. Both files must be included in deployment. No Lovable preview proxy is required for Glass Earth.

The exported `earth-luminous-color.webp` is unavailable locally. The supplied base-color PNG is used explicitly instead; its ocean values differ, so its shader mask threshold has been adjusted. This is not the previously generated Natural Earth 10m luminous map. Recover that map (or regenerate a complete geographic atlas from the Natural Earth 10m source) before claiming full registration between the worldwide texture and the existing destination outlines. Do not substitute a generic sphere for this model.
