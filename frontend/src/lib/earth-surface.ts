// Texture coordinates are the geographic source of truth for the uploaded GLB.
// Its UVs warp relative to XYZ, so project onto triangles in UV space, not a sphere.
export function geographicUV(longitude: number, latitude: number): [number, number] {
  return [((longitude + 180) / 360 + 1) % 1, (90 - latitude) / 180];
}

export function createSurfaceProjector(positions: ArrayLike<number>, uv: ArrayLike<number>, indices: ArrayLike<number>) {
  const columns = 180, rows = 90;
  const bins = new Map<number, number[]>();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (a === undefined || b === undefined || c === undefined) continue;
    const us = [uv[a * 2] ?? 0, uv[b * 2] ?? 0, uv[c * 2] ?? 0];
    const vs = [uv[a * 2 + 1] ?? 0, uv[b * 2 + 1] ?? 0, uv[c * 2 + 1] ?? 0];
    const minX = Math.floor(Math.min(...us) * columns), maxX = Math.floor(Math.max(...us) * columns);
    const minY = Math.max(0, Math.floor(Math.min(...vs) * rows)), maxY = Math.min(rows - 1, Math.floor(Math.max(...vs) * rows));
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const key = ((x % columns + columns) % columns) + y * columns;
      const bin = bins.get(key) ?? [];
      bin.push(i); bins.set(key, bin);
    }
  }
  return (longitude: number, latitude: number): [number, number, number] => {
    const [u, v] = geographicUV(longitude, latitude);
    const candidates = bins.get(Math.floor(u * columns) + Math.min(rows - 1, Math.floor(v * rows)) * columns) ?? [];
    for (const i of candidates) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      if (a === undefined || b === undefined || c === undefined) continue;
      const ax = uv[a * 2] ?? 0, ay = uv[a * 2 + 1] ?? 0;
      const bx = uv[b * 2] ?? 0, by = uv[b * 2 + 1] ?? 0;
      const cx = uv[c * 2] ?? 0, cy = uv[c * 2 + 1] ?? 0;
      const wrappedU = u + Math.round((ax + bx + cx) / 3 - u);
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      const wa = ((by - cy) * (wrappedU - cx) + (cx - bx) * (v - cy)) / det;
      const wb = ((cy - ay) * (wrappedU - cx) + (ax - cx) * (v - cy)) / det;
      const wc = 1 - wa - wb;
      if (Math.min(wa, wb, wc) < -1e-5) continue;
      return [0, 1, 2].map((axis) => (positions[a * 3 + axis] ?? 0) * wa + (positions[b * 3 + axis] ?? 0) * wb + (positions[c * 3 + axis] ?? 0) * wc) as [number, number, number];
    }
    const lon = longitude * Math.PI / 180, lat = latitude * Math.PI / 180;
    return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  };
}