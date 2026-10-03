/** Minimal column-major mat4 helpers (allocation-free variants take an `out`). */

export type Mat4 = Float32Array;

export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function perspective(out: Mat4, fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let rr = 0; rr < 4; rr++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + rr]! * b[c * 4 + k]!;
      r[c * 4 + rr] = s;
    }
  out.set(r);
  return out;
}

/** View rotation for a camera with yaw (around Y) and pitch (around X), vanilla convention:
 *  yaw 0 looks toward +Z (south), yaw 90 toward −X (west); pitch positive looks down. */
export function viewRotation(out: Mat4, yawDeg: number, pitchDeg: number, rollDeg = 0): Mat4 {
  const ya = ((yawDeg + 180) * Math.PI) / 180;
  const pa = (pitchDeg * Math.PI) / 180;
  const ra = (rollDeg * Math.PI) / 180;
  const cy = Math.cos(ya), sy = Math.sin(ya), cp = Math.cos(pa), sp = Math.sin(pa);
  // R = Rz(roll) * Rx(pitch) * Ry(yaw)
  const ry = mat4();
  ry[0] = cy; ry[2] = -sy; ry[8] = sy; ry[10] = cy;
  const rx = mat4();
  rx[5] = cp; rx[6] = sp; rx[9] = -sp; rx[10] = cp;
  const rz = mat4();
  const cr = Math.cos(ra), sr = Math.sin(ra);
  rz[0] = cr; rz[1] = sr; rz[4] = -sr; rz[5] = cr;
  multiply(out, rx, ry);
  if (rollDeg !== 0) multiply(out, rz, out);
  return out;
}

export function translate(out: Mat4, m: Mat4, x: number, y: number, z: number): Mat4 {
  out.set(m);
  out[12] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  out[13] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  out[14] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  out[15] = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return out;
}

/** Extract the 6 normalised frustum planes (a,b,c,d) from a view-projection matrix. */
export function frustumPlanes(out: Float32Array, m: Mat4): Float32Array {
  const rows = (i: number) => [m[i]!, m[4 + i]!, m[8 + i]!, m[12 + i]!];
  const r0 = rows(0), r1 = rows(1), r2 = rows(2), r3 = rows(3);
  const planes = [
    r3.map((v, i) => v + r0[i]!), r3.map((v, i) => v - r0[i]!),
    r3.map((v, i) => v + r1[i]!), r3.map((v, i) => v - r1[i]!),
    r3.map((v, i) => v + r2[i]!), r3.map((v, i) => v - r2[i]!),
  ];
  planes.forEach((p, i) => {
    const len = Math.hypot(p[0]!, p[1]!, p[2]!);
    for (let k = 0; k < 4; k++) out[i * 4 + k] = p[k]! / len;
  });
  return out;
}

/** True if the AABB intersects the frustum (camera-relative coordinates). */
export function aabbInFrustum(planes: Float32Array, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4]!, b = planes[i * 4 + 1]!, c = planes[i * 4 + 2]!, d = planes[i * 4 + 3]!;
    const x = a >= 0 ? maxX : minX, y = b >= 0 ? maxY : minY, z = c >= 0 ? maxZ : minZ;
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(t: number, a: number, b: number): number {
  return a + (b - a) * t;
}
