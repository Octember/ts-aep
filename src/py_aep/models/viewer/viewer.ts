import { ViewerType } from "../../enums/index.ts";
import { ChunkField } from "../descriptors.ts";
import { _validate_number } from "../validators.ts";
import { descriptor, py_bool } from "../../pyrt/index.ts";
import type { AsciiChunk, U1Chunk } from "../../binary/scalar_chunks.ts";
import type { View } from "./view.ts";

/**
 * The `Viewer` object represents a Composition, Layer, or Footage panel.
 *
 * Example:
 * ```python
 * from py_aep import parse
 *
 * app = parse("project.aep")
 * viewer = app.active_viewer
 * print(viewer.type)
 * ```
 *
 * See: https://ae-scripting.docsforadobe.dev/other/viewer/
 */
export class Viewer {
  /**
   * The content in the viewer panel. Read-only.
   */
  declare type: ViewerType;

  declare _fitt: AsciiChunk;
  declare _foac: U1Chunk;
  declare _fiac: U1Chunk;
  declare _views: View[];
  declare _active_view_index: number;

  constructor(kw: { _fitt: AsciiChunk; _foac: U1Chunk; _fiac: U1Chunk }) {
    const { _fitt, _foac, _fiac } = kw;
    this._fitt = _fitt;
    this._foac = _foac;
    this._fiac = _fiac;
    this._views = [];
    this._active_view_index = 0;
  }

  /**
   * All of the [View][] objects associated with this viewer.
   * Read-only.
   */
  get views(): View[] {
    return this._views;
  }

  /**
   * The index of the active view in the viewer's `views` list.
   * Read / Write.
   *
   * Note: The active locked view index is not persisted in the binary
   * format. It defaults to 0 (first view). Set it manually or call
   * `View.set_active()` to change which view is active.
   */
  get active_view_index(): number {
    return this._active_view_index;
  }

  set active_view_index(value: number) {
    // With no views the index is moot; clamp the upper bound to 0 so the
    // bound stays valid (an empty views list would otherwise give max=-1,
    // rejecting every value including 0).
    const max_index = this._views.length > 0 ? this._views.length - 1 : 0;
    _validate_number({ min: 0, max: max_index, integer: true })(value);
    this._active_view_index = value;
  }

  /**
   * When `True`, indicates if the viewer panel is active.
   * Read-only.
   */
  get active(): boolean {
    return py_bool(this._foac) && py_bool(this._foac.value) && py_bool(this._fiac) && py_bool(this._fiac.value);
  }
}

descriptor(
  Viewer,
  "type",
  ChunkField.enum<ViewerType>(ViewerType, "_fitt", "value", {
    transform: ViewerType.from_string,
    read_only: true,
  }),
);
