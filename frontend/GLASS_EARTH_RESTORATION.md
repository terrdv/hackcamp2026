# Glass Earth restoration status

## Diagnosis

Glass is the default route state. Its lazy component previously loaded both model and color texture through `/__l5e/assets-v1/` URLs. Neither binary was in the export. The installed Lovable Vite configuration only proxies those URLs when `LOVABLE_PREVIEW_HOST` is configured; that variable is absent here. The route's error handler selected Original on loading failure, hiding the problem.

This establishes the missing local asset dependency and silent fallback path. Actual HTTP responses and browser failures could not be observed: opening Vite's port 8080 is prohibited by the execution sandbox (`listen EPERM`), no browser connector is provided, and outbound DNS also failed. Shader failure remains a possible additional runtime issue, not a verified cause.

## Implemented

Recovered the actual model and base-color PNG from the user's supplied local archive into `public/earth/`, with stable public paths. Verified the GLB header, indexed position/UV attributes, embedded images, archive byte equality, and exact manifest model size. No replacement sphere or static globe was introduced.

Loading, geometry validation, shader compilation, rendering exceptions, WebGL initialization and context loss now report errors visibly and in the console. Glass errors no longer select Original automatically. Readiness is set only after shader precompilation and an initial render. Fly-to requests received during model loading retain their completion callback.

The source PNG differs from the unavailable luminous texture. Adjusted the shader's land-mask range for its brighter ocean values. This adjustment is not visually verified.

Original renderer and application controls/data/UI remain in place.

## Validation and remaining work

- TypeScript: `npx tsc --noEmit` passed.
- Existing tests: 2 files, 3 tests passed.
- Production build: passed; existing large-chunk warnings remain.
- Browser/network/WebGL visual verification: blocked by sandbox networking; not performed.
- Mode switching, Thailand/Brazil fly-to, highlights/markers and distant/close atmosphere: require browser testing.

Per the requested incremental workflow, further appearance changes are deferred until the restored real model can be seen rendering. The inherited MeshBasicMaterial and single-shell atmosphere are still present; the physical-material gradients and two bounded scattering shells required by AGENTS.md have not been implemented in this restoration stage. Existing code uses Three shader chunks present in the installed version, but build success does not validate GLSL compilation.

The unavailable luminous atlas must be recovered or regenerated from the same Natural Earth 10m source as destination outlines. The supplied base texture includes triangulation linework and ocean highlights; suppressing these through color replacement also suppresses its border detail. Worldwide crisp geographic boundaries, physical material shading, refined land/ocean palettes, and the two-shell halo remain work to do after initial browser validation. Original's own Lovable satellite asset URLs are unchanged and retain their external hosting dependency.
