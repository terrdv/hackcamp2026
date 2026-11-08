import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Polygon, MultiPolygon } from "geojson";
import { detailedCountryShapes as countryShapes } from "@/data/detailedCountryShapes";
import { destinations } from "@/data/destinations";
import { createSurfaceProjector } from "@/lib/earth-surface";
import { geographicMaterialShader, geographicMapFragment, atmosphereVertexShader, atmosphereFragmentShader } from "@/lib/earth-appearance";
import { Button } from "@/components/ui/button";
import type { GlobeHandle, GlobeOutbreak } from "./GlobeMap";

// Keep the supplied model portable: Lovable asset URLs are not served by Vite.
const earthUrl = "/earth/glass-earth.glb";
const colorUrl = "/earth/earth-basecolor.png";

interface Props {
  outbreaks: GlobeOutbreak[];
  selectedDiseaseId: string | null;
  selectedDestinationId: string | null;
  onSelectDisease: (id: string) => void;
  onError: (error: Error) => void;
}

export const GlassEarth = forwardRef<GlobeHandle, Props>(function GlassEarth(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<{ fly: GlobeHandle["flyTo"]; reset: () => void; update: () => void } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<GlobeOutbreak | null>(null);

  useImperativeHandle(ref, () => ({
    flyTo: (coords, zoom, done) => { runtime.current?.fly(coords, zoom, done); },
    reset: () => { runtime.current?.reset(); setPopup(null); },
  }), []);

  useEffect(() => {
    const currentHost = host.current;
    if (!currentHost) return;
    const element: HTMLDivElement = currentHost;
    let stopped = false, failed = false, frame = 0;
    const scene = new THREE.Scene();
    const earth = new THREE.Group();
    const overlays = new THREE.Group();
    scene.add(earth, overlays);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
    function fail(cause: unknown) {
      if (stopped || failed) return;
      failed = true;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      console.error("[Glass Earth]", error);
      setError(error.message);
      setLoading(false);
      cancelAnimationFrame(frame);
      element.setAttribute("data-globe-ready", "false");
      latest.current.onError(error);
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (cause) {
      fail(cause);
      return;
    }
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      fail(new Error(`Shader compilation failed: ${gl.getProgramInfoLog(program)}\n${gl.getShaderInfoLog(vertex)}\n${gl.getShaderInfoLog(fragment)}`));
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      fail(new Error("WebGL context was lost. Reload to retry Glass Earth."));
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Unlit atlas colors are intentionally not subject to photographic exposure.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.08;
    controls.maxDistance = 6;
    const theme = getComputedStyle(element);
    const tokenColor = (name: string) => new THREE.Color(theme.getPropertyValue(name).trim());
    // The atlas is self-illuminated. Removing the four high-intensity lights
    // eliminates dark continents, artificial circular highlights, and reflections.
    const atmosphere = new THREE.Group();
    scene.add(atmosphere);
    // One feathered, back-facing atmospheric shell rather than stacked bright
    // reflective spheres. Alpha approaches zero before its geometric edge.
    {
      const radius = 1.12;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          cyan: { value: tokenColor("--earth-atmosphere") },
          blue: { value: tokenColor("--earth-atmosphere-haze") },
          strength: { value: 0.34 },
          scaleHeight: { value: 0.027 },
          outerRadius: { value: radius },
        },
        vertexShader: atmosphereVertexShader,
        fragmentShader: atmosphereFragmentShader,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      });
      const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 96), material);
      shell.renderOrder = 2;
      atmosphere.add(shell);
    }
    let project: ((lon: number, lat: number) => [number, number, number]) | null = null;
    let searchView = !latest.current.selectedDestinationId;
    let motion: { start: number; from: THREE.Vector3; to: THREE.Vector3; done: (() => void) | undefined } | null = null;
    const lineMaterials: LineMaterial[] = [];
    const markers: THREE.Mesh[] = [];
    const accent = theme.getPropertyValue("--earth-outline").trim();
    const pointAt = (lon: number, lat: number, offset = 0.003) => {
      const p = project ? new THREE.Vector3(...project(lon, lat)) : new THREE.Vector3();
      return p.addScaledVector(p.clone().normalize(), offset);
    };
    function layout() {
      const w = element.clientWidth, h = element.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h;
      camera.clearViewOffset();
      if (searchView) {
        const distance = Math.max(1.18, Math.sqrt(1 + (h / (1.8 * w * Math.tan(THREE.MathUtils.degToRad(17.5)))) ** 2));
        camera.position.copy(pointAt(10, 20, 0).normalize().multiplyScalar(distance));
        const radius = h / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)) * Math.sqrt(distance * distance - 1));
        camera.setViewOffset(w, h, 0, h / 2 - (h * 0.72 + radius), w, h);
      } else if (w > 900) {
        camera.setViewOffset(w, h, 210, 0, w, h);
      } else {
        camera.setViewOffset(w, h, 0, h * 0.2, w, h);
      }
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      lineMaterials.forEach((m) => m.resolution.set(w, h));
    }
    function clearOverlays() {
      overlays.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof Line2) {
          o.geometry.dispose();
          const materials = Array.isArray(o.material) ? o.material : [o.material];
          materials.forEach((m) => m.dispose());
        }
      });
      overlays.clear(); markers.length = 0; lineMaterials.length = 0;
    }
    function drawLine(coords: number[][], width: number, opacity: number, offset = 0.004, color = accent) {
      if (coords.length < 2) return;
      const points: number[] = [];
      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i];
        if (!a || !b) continue;
        const ax = a[0] ?? 0, ay = a[1] ?? 0, bx = b[0] ?? 0, by = b[1] ?? 0;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.15));
        for (let s = i === 1 ? 0 : 1; s <= steps; s++) points.push(...pointAt(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps, offset).toArray());
      }
      const geometry = new LineGeometry(); geometry.setPositions(points);
      const material = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
      material.resolution.set(element?.clientWidth ?? 1, element?.clientHeight ?? 1);
      lineMaterials.push(material);
      overlays.add(new Line2(geometry, material));
    }
    function inside(lon: number, lat: number, ring: number[][]) {
      let result = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if (!a || !b) continue;
        const ax = a[0] ?? 0, ay = a[1] ?? 0, bx = b[0] ?? 0, by = b[1] ?? 0;
        if ((ay > lat) !== (by > lat) && lon < (bx - ax) * (lat - ay) / (by - ay) + ax) result = !result;
      }
      return result;
    }
    function update() {
      if (!project) return;
      clearOverlays();
      const p = latest.current;
      const shape = p.selectedDestinationId ? countryShapes[p.selectedDestinationId] : null;
      if (shape) {
        const geometry = shape.geometry as Polygon | MultiPolygon;
        const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
        for (const polygon of polygons) {
          for (const ring of polygon) {
            drawLine(ring, 2.1, 0.35, 0.002, theme.getPropertyValue("--earth-groove").trim());
            drawLine(ring, 2.0, 0.06); drawLine(ring, 0.85, 0.83);
          }
          const ring = polygon[0];
          if (!ring) continue;
          const xs = ring.map((v) => v[0] ?? 0), ys = ring.map((v) => v[1] ?? 0);
          const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
          const spacing = p.selectedDestinationId === "brazil" ? 1.2 : 0.5;
          const inLand = (x: number, y: number) => inside(x, y, ring) && !polygon.slice(1).some((hole) => inside(x, y, hole));
          for (let axis = 0; axis < 2; axis++) {
            const start = axis === 0 ? minX : minY, end = axis === 0 ? maxX : maxY;
            for (let fixed = Math.ceil(start / spacing) * spacing; fixed <= end; fixed += spacing) {
              let segment: number[][] = [];
              const flush = () => { if (segment.length > 1) { drawLine(segment, 3, 0.07); drawLine(segment, 0.6, 0.48); } segment = []; };
              for (let moving = axis === 0 ? minY : minX; moving <= (axis === 0 ? maxY : maxX); moving += 0.12) {
                const x = axis === 0 ? fixed : moving, y = axis === 0 ? moving : fixed;
                if (inLand(x, y)) segment.push([x, y]); else flush();
              }
              flush();
            }
          }
        }
      }
      const visible = p.selectedDiseaseId ? p.outbreaks.filter((o) => o.diseaseId === p.selectedDiseaseId) : p.outbreaks;
      visible.forEach((o) => {
        const color = theme.getPropertyValue(`--earth-marker-${o.level === "elevated" ? "high" : o.level === "moderate" ? "moderate" : "low"}`).trim();
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.003 + Math.min(Math.sqrt(o.cases) * 0.00008, 0.009), 16, 12), new THREE.MeshBasicMaterial({ color }));
        mesh.position.copy(pointAt(o.longitude, o.latitude, 0.008));
        mesh.userData['observation'] = o; overlays.add(mesh); markers.push(mesh);
      });
    }
    let pendingFly: { coords: [number, number]; zoom: number; done: (() => void) | undefined } | null = null;
    function fly(coords: [number, number], zoom: number, done?: () => void) {
      if (!project) { pendingFly = { coords, zoom, done }; return; }
      searchView = false; setPopup(null); layout();
      const distance = zoom >= 4.9 ? 1.75 : zoom >= 4.5 ? 1.85 : 2.5;
      motion = { start: performance.now(), from: camera.position.clone(), to: pointAt(...coords, 0).normalize().multiplyScalar(distance), done };
      controls.enabled = false;
    }
    function reset() { pendingFly = null; motion = null; searchView = true; controls.enabled = false; layout(); }
    runtime.current = { fly, reset, update };
    controls.enabled = !searchView;
    const observer = new ResizeObserver(layout); observer.observe(element);
    const raycaster = new THREE.Raycaster();
    let pointerStart = [0, 0];
    const down = (e: PointerEvent) => { pointerStart = [e.clientX, e.clientY]; };
    const click = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - (pointerStart[0] ?? 0), e.clientY - (pointerStart[1] ?? 0)) > 5) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((e.clientX - bounds.left) / bounds.width * 2 - 1, -(e.clientY - bounds.top) / bounds.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects([...markers, ...earth.children], true)[0];
      const observation = hit?.object.userData['observation'] as GlobeOutbreak | undefined;
      if (observation) { setPopup(observation); latest.current.onSelectDisease(observation.diseaseId); }
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", click);
    new GLTFLoader().load(earthUrl, async (gltf) => {
      try {
        if (stopped) return;
        const textureLoader = new THREE.TextureLoader();
        const maps = [await textureLoader.loadAsync(colorUrl).catch((cause: unknown) => {
          throw new Error(`Unable to load Glass Earth texture ${colorUrl}`, { cause });
        })] as const;
        if (stopped) { maps.forEach((t) => t.dispose()); return; }
        maps.forEach((texture) => {
          texture.flipY = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          texture.wrapS = THREE.RepeatWrapping;
          texture.needsUpdate = true;
        });
        gltf.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.geometry = o.geometry.clone();
          const uv = o.geometry.getAttribute("uv"), position = o.geometry.getAttribute("position"), index = o.geometry.index;
          if (position) {
            for (let i = 0; i < position.count; i++) {
              const vertex = new THREE.Vector3().fromBufferAttribute(position, i);
              const radius = vertex.length();
              // Flatten existing 3.2% relief to a subtle 0.4%, preserving UV directions.
              if (radius > 0) vertex.multiplyScalar((1 + (radius - 1) * 0.12) / radius);
              position.setXYZ(i, vertex.x, vertex.y, vertex.z);
            }
            position.needsUpdate = true;
            o.geometry.computeVertexNormals();
            o.geometry.computeBoundingSphere();
          }
          if (!uv || !position || !index) throw new Error("Glass Earth requires indexed geometry with geographic UVs.");
          project = createSurfaceProjector(position.array, uv.array, index.array);
          // The original GLB materials were physically reflective and were being
          // amplified by several directional lights. Replace with an unlit atlas.
          const oldMaterials = Array.isArray(o.material) ? o.material : [o.material];
          const material = new THREE.MeshBasicMaterial({ color: 0xffffff, map: maps[0], side: THREE.FrontSide });
          // Geographic colors remain anchored to the supplied model UVs.
          material.onBeforeCompile = (shader) => {
            const colors = {
              landDeep: "--earth-land-deep", landEmerald: "--earth-land-emerald",
              landTurquoise: "--earth-land-turquoise", landAqua: "--earth-land-aqua",
              landMint: "--earth-land-mint", oceanDeep: "--earth-ocean-deep",
              oceanBlue: "--earth-ocean-blue", oceanHighlight: "--earth-ocean-highlight",
            };
            for (const [name, token] of Object.entries(colors)) shader.uniforms[name] = { value: tokenColor(token) };
            shader.fragmentShader = shader.fragmentShader
              .replace("#include <common>", "#include <common>\n" + geographicMaterialShader)
              .replace("#include <map_fragment>", geographicMapFragment);
          };
          material.customProgramCacheKey = () => "bugvoyage-graphic-atlas-v3";
          oldMaterials.forEach((m) => m.dispose());
          o.material = material;
        });
        if (!project) throw new Error("Glass Earth model contains no projectable mesh.");
        earth.add(gltf.scene); update(); layout();
        // Compile and render before announcing readiness. Shader failures stay visible.
        await renderer.compileAsync(scene, camera);
        if (stopped || failed) return;
        renderer.render(scene, camera);
        if (failed) return;
        const destination = destinations.find((d) => d.id === latest.current.selectedDestinationId);
        if (pendingFly) { const pending = pendingFly; pendingFly = null; fly(pending.coords, pending.zoom, pending.done); }
        else if (destination) { fly(destination.coords, destination.zoom); }
        element.setAttribute("data-globe-ready", "true"); setLoading(false);
      } catch (cause) { fail(cause); }
    }, undefined, (cause) => { fail(new Error(`Unable to load Glass Earth model ${earthUrl}`, { cause })); });
    function animate(now: number) {
      if (stopped || failed) return;
      frame = requestAnimationFrame(animate);
      if (motion) {
        const t = Math.min((now - motion.start) / (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 2600), 1);
        const smooth = t * t * (3 - 2 * t);
        const from = motion.from.clone().normalize(), to = motion.to.clone().normalize();
        const rotation = new THREE.Quaternion().setFromUnitVectors(from, to);
        const q = new THREE.Quaternion().slerp(rotation, smooth);
        camera.position.copy(from.applyQuaternion(q).multiplyScalar(THREE.MathUtils.lerp(motion.from.length(), motion.to.length(), smooth)));
        camera.lookAt(0, 0, 0);
        if (t === 1) { const done = motion.done; motion = null; controls.enabled = true; done?.(); }
      } else if (!searchView) controls.update();
      try { renderer.render(scene, camera); } catch (cause) { fail(cause); }
    }
    layout(); frame = requestAnimationFrame(animate);
    return () => {
      stopped = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); clearOverlays();
      earth.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach((m) => { for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose(); m.dispose(); }); } });
      atmosphere.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); o.material.dispose(); } });
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.dispose(); renderer.domElement.remove(); runtime.current = null;
    };
  }, []);

  useEffect(() => { runtime.current?.update(); }, [props.outbreaks, props.selectedDiseaseId, props.selectedDestinationId]);
  useEffect(() => { setPopup(null); }, [props.selectedDestinationId]);

  return <div className="globe-bg absolute inset-0">
    <div ref={host} className="glass-earth-canvas h-full w-full" aria-label="Interactive glass Earth" />
    {error && <div className="glass-solid pointer-events-auto absolute bottom-6 left-1/2 z-20 w-[min(90vw,32rem)] -translate-x-1/2 rounded-lg p-4 text-sm" role="alert"><strong>Glass Earth could not render.</strong><p className="mt-1">{error}</p><p className="mt-2 text-muted-foreground">Reload to retry, or select Original above.</p></div>}
    {loading && <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-muted-foreground" role="status">Loading Earth…</div>}
    {props.outbreaks.length > 0 && <div className="glass-solid pointer-events-auto absolute left-4 top-20 z-10 rounded-lg px-3 py-2 text-xs md:bottom-4 md:top-auto md:px-4 md:py-3"><p className="mb-2 font-semibold text-muted-foreground">Reported activity (demo)</p><div className="flex gap-3 md:grid md:gap-1.5"><span className="flex items-center gap-2"><span className="legend-dot legend-dot-elevated" /> Elevated</span><span className="flex items-center gap-2"><span className="legend-dot legend-dot-moderate" /> Moderate</span><span className="flex items-center gap-2"><span className="legend-dot legend-dot-low" /> Low</span></div></div>}
    {popup && <div className="glass-solid absolute bottom-40 left-4 z-20 max-w-64 rounded-lg p-3 text-xs"><strong>{popup.locationName}</strong><p>{popup.diseaseName} — {popup.cases.toLocaleString()} reported cases</p><p className="mt-1 text-muted-foreground">{popup.reportDate} · {popup.source} (demo data)</p><Button variant="ghost" size="sm" onClick={() => setPopup(null)}>Close</Button></div>}
  </div>;
});