/**
 * Decode Photoshop vector-mask path records into AE mask shapes.
 *
 * A `vmsk`/`vsms` block body is a 4-byte version (3) + 4-byte flags + a run of
 * 26-byte path records. Knot coordinates are signed 8.24 fixed-point fractions
 * of the CANVAS dimensions, vertical first. After Effects converts them to
 * layer-pixel bezier vertices with tangents relative to the anchor (pinned by
 * the psd_vector_mask/psd_shape_layer fixtures).
 */

import { bytes_, len, range, struct } from "../../pyrt/index.ts";
import { Shape } from "../models/properties/shape.ts";

// Path record selectors (PSD spec "Path resource format").
const _CLOSED_LENGTH = 0;
const _OPEN_LENGTH = 3;
const _KNOT_SELECTORS: ReadonlySet<number> = new Set([1, 2, 4, 5]);

/** Decode a knot record to `[in_point, anchor, out_point]` pixel coords. */
export function _knot(record: Uint8Array, canvas_w: number, canvas_h: number): number[][] {
  const points: number[][] = [];
  for (const i of range(3)) {
    const [vert, horiz] = struct.unpack(">ii", bytes_.slice(record, 2 + i * 8, 10 + i * 8));
    points.push([(horiz / 0x1000000) * canvas_w, (vert / 0x1000000) * canvas_h]);
  }
  return points;
}

/**
 * Decode a `vmsk`/`vsms` block into one [Shape][] per subpath.
 *
 * @param block The raw tagged-block body (version + flags + path records).
 * @param canvas_w Document canvas width in pixels.
 * @param canvas_h Document canvas height in pixels.
 * @returns The subpaths in file order (usually one). A malformed block yields
 *   the subpaths decoded so far.
 */
export function parse_vector_mask(block: Uint8Array, canvas_w: number, canvas_h: number): Shape[] {
  const shapes: Shape[] = [];
  const vertices: number[][] = [];
  const in_tangents: number[][] = [];
  const out_tangents: number[][] = [];
  let closed = true;

  const flush = (): void => {
    if (vertices.length) {
      shapes.push(
        new Shape({
          vertices: [...vertices],
          in_tangents: [...in_tangents],
          out_tangents: [...out_tangents],
          closed,
        }),
      );
      vertices.splice(0, vertices.length);
      in_tangents.splice(0, in_tangents.length);
      out_tangents.splice(0, out_tangents.length);
    }
  };

  let pos = 8; // version (3) + flags
  while (pos + 26 <= len(block)) {
    const record = bytes_.slice(block, pos, pos + 26);
    const selector = struct.unpack(">H", bytes_.slice(record, 0, 2))[0];
    if (selector === _CLOSED_LENGTH || selector === _OPEN_LENGTH) {
      flush();
      closed = selector === _CLOSED_LENGTH;
    } else if (_KNOT_SELECTORS.has(selector)) {
      const [in_point, anchor, out_point] = _knot(record, canvas_w, canvas_h);
      vertices.push(anchor);
      in_tangents.push([in_point[0] - anchor[0], in_point[1] - anchor[1]]);
      out_tangents.push([out_point[0] - anchor[0], out_point[1] - anchor[1]]);
    }
    pos += 26;
  }
  flush();
  return shapes;
}
