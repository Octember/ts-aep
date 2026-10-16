/**
 * The tangents After Effects draws a RotoBezier mask path with.
 *
 * A RotoBezier mask ignores its stored direction handles: After Effects
 * derives every vertex's tangents from the vertices and a per-vertex tension
 * (the shape value's `omtn` chunk), and reports those through
 * `Shape.in_tangents` / `out_tangents`. Rules measured on After Effects 2026
 * by reading back masks with patched tensions and aspects (3-6 vertices, open
 * and closed paths, collinear and repeated vertices, keyed paths):
 *
 * - Tangents are computed in normalized mask space with x scaled by the Mask
 *   Path's stored aspect (`Tdb4Chunk.pixel_aspect`: the layer's width /
 *   height, so pixel space, in current files).
 * - With `k = (1 - tension) / 2`, an interior vertex (every vertex of a closed
 *   path) points along `next - prev`: its in tangent is `k` times the distance
 *   to the previous vertex, its out tangent `k` times the distance to the
 *   next one. A zero `next - prev` chord gives zero tangents.
 * - An open path's last vertex aims its in tangent at the previous vertex's
 *   out handle, then its first vertex aims its out tangent at the second
 *   vertex's in handle, each scaled by the end's own `k`; the outer tangents
 *   stay zero.
 * - A shape value without tensions uses 1/3 for every vertex.
 * - Between keyframes, the tensions blend linearly with the path's progress. A
 *   keyframe without tensions contributes 1 at a vertex whose stored handles
 *   are both zero, 1/3 at any other.
 */

import { mod, zip } from "../../pyrt/index.ts";

export const DEFAULT_TENSION = 1.0 / 3.0;

function _decompose(v: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, Math.abs(v));
  const bits = buf.getBigUint64(0);
  const exp = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  return exp === 0 ? [frac, -1074] : [frac | (1n << 52n), exp - 1075];
}

function _isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

// TODO(pyrt): math.hypot for two args (needs a pyrt shim). CPython 3.12's
// vector_norm is not guaranteed correctly rounded (compensated, <1 ulp, rare
// 1-ulp misses); V8's Math.hypot is less accurate. This computes the correctly
// rounded sqrt(x*x + y*y) exactly with BigInt, so it can differ from CPython
// only on those rare inputs. Parity held on all 644 differential samples.
function hypot(x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return Math.hypot(x, y);
  }
  if (x === 0 && y === 0) return 0.0;
  const [ma, ea] = _decompose(x);
  const [mb, eb] = _decompose(y);
  const e = Math.min(ea, eb);
  const a = ma << BigInt(ea - e);
  const b = mb << BigInt(eb - e);
  const s = a * a + b * b;
  const k = Math.max(0, 60 - (s.toString(2).length >> 1));
  const shifted = s << BigInt(2 * k);
  const r = _isqrt(shifted);
  let sticky = r * r === shifted ? 0n : 1n;
  // Reduce to 62 significant bits, folding the dropped bits into sticky.
  const drop = Math.max(0, r.toString(2).length - 62);
  const kept = r >> BigInt(drop);
  if (kept << BigInt(drop) !== r) sticky = 1n;
  // The appended sticky bit makes the final rounding exact.
  const scaled = Number((kept << 1n) | sticky);
  const exp = e - k - 1 + drop;
  const half = Math.trunc(exp / 2);
  return scaled * 2 ** half * 2 ** (exp - half);
}

/**
 * `(in_tangents, out_tangents)` of a RotoBezier path.
 *
 * Args:
 *     vertices: The path's vertices, in layer pixels.
 *     closed: Whether the path is closed.
 *     tensions: One tension per vertex.
 *     scale_x: Multiplier from layer pixels to the measuring space along x
 *         (the stored aspect over the layer width).
 *     scale_y: The same along y (one over the layer height).
 */
export function roto_bezier_tangents(
  vertices: number[][],
  closed: boolean,
  tensions: number[],
  scale_x: number,
  scale_y: number,
): [number[][], number[][]] {
  const points: [number, number][] = vertices.map(
    ([x, y]): [number, number] => [x * scale_x, y * scale_y],
  );
  const count = points.length;
  const ks = tensions.map((t) => (1.0 - t) * 0.5);
  const ins: number[][] = Array.from({ length: count }, () => [0.0, 0.0]);
  const outs: number[][] = Array.from({ length: count }, () => [0.0, 0.0]);
  const loop_start = closed ? 0 : 1;
  const loop_stop = closed ? count : count - 1;
  for (let i = loop_start; i < loop_stop; i++) {
    const [vx, vy] = points[i];
    const [px, py] = points.at(i - 1)!;
    const [nx, ny] = points[mod(i + 1, count)];
    const chord = hypot(nx - px, ny - py);
    if (chord < 1e-12) {
      continue;
    }
    const ux = (nx - px) / chord;
    const uy = (ny - py) / chord;
    const before = hypot(vx - px, vy - py) * ks[i];
    const after = hypot(nx - vx, ny - vy) * ks[i];
    ins[i] = [-ux * before, -uy * before];
    outs[i] = [ux * after, uy * after];
  }
  if (!closed && count >= 2) {
    const [lx, ly] = points.at(-1)!;
    const [bx, by] = points.at(-2)!;
    ins[count - 1] = [
      (bx + outs.at(-2)![0] - lx) * ks.at(-1)!,
      (by + outs.at(-2)![1] - ly) * ks.at(-1)!,
    ];
    const [fx, fy] = points[0];
    const [sx, sy] = points[1];
    outs[0] = [
      (sx + ins[1][0] - fx) * ks[0],
      (sy + ins[1][1] - fy) * ks[0],
    ];
  }
  return [
    ins.map(([x, y]) => [x / scale_x, y / scale_y]),
    outs.map(([x, y]) => [x / scale_x, y / scale_y]),
  ];
}

/**
 * The tensions a keyframe's path contributes to an in-between value:
 * its own, or, when it has none, 1 at a vertex whose stored handles are
 * both zero and 1/3 at any other.
 */
export function keyframe_tensions(
  tensions: number[],
  in_tangents: number[][],
  out_tangents: number[][],
): number[] {
  if (tensions.length === in_tangents.length) {
    return [...tensions];
  }
  return zip(in_tangents, out_tangents).map(([a, b]) =>
    // Python any() over floats: truthy when any element is nonzero.
    !a.some((v) => v !== 0) && !b.some((v) => v !== 0) ? 1.0 : DEFAULT_TENSION,
  );
}
