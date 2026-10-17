import { ValueError } from "../../../pyrt/index.ts";
import type { ViewOptions } from "./view_options.ts";
import type { Viewer } from "./viewer.ts";

/**
 * The `View` object represents a specific view.
 *
 * @example
 * ```python
 * from py_aep import parse
 *
 * app = parse("project.aep")
 * view = app.active_viewer.views[0]
 * print(view.options)
 * ```
 * @see https://ae-scripting.docsforadobe.dev/other/view/
 */
export class View {
  declare _viewer: Viewer;
  declare _options: ViewOptions;

  constructor(kw: { _viewer: Viewer; options: ViewOptions }) {
    const { _viewer, options } = kw;
    this._viewer = _viewer;
    this._options = options;
  }

  /**
   * When `True`, indicates if the view is the active view in its
   * viewer. Read-only.
   *
   * **Note:** The active locked view index is not persisted in the binary
   * format. It defaults to 0 (first view) and can be changed via
   * `set_active()` or by setting `viewer.active_view_index`.
   */
  get active(): boolean {
    return this._viewer.active_view_index === this._index();
  }

  /**
   * Make this the active view in its viewer.
   *
   * This sets the parent viewer's `active_view_index` to this view's
   * index. If the viewer is associated with a composition, this also
   * affects which view's ROI is used for output module effective
   * dimensions.
   */
  set_active(): void {
    this._viewer.active_view_index = this._index();
  }

  /** list.index(self) parity: View has no __eq__, so identity; raises ValueError when absent. */
  private _index(): number {
    const i = this._viewer.views.indexOf(this);
    if (i < 0) throw new ValueError("<View object> is not in list");
    return i;
  }

  /** Options object for this View. Read-only. */
  get options(): ViewOptions {
    return this._options;
  }
}
