import type { ViewOptions } from "./view_options.ts";
import type { Viewer } from "./viewer.ts";

/**
 * The `View` object represents a specific view.
 *
 * Example:
 *     ```python
 *     from py_aep import parse
 *
 *     app = parse("project.aep")
 *     view = app.active_viewer.views[0]
 *     print(view.options)
 *     ```
 *
 * See: https://ae-scripting.docsforadobe.dev/other/view/
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
   * Note: The active locked view index is not persisted in the binary
   * format. It defaults to 0 (first view) and can be changed via
   * `set_active()` or by setting `viewer.active_view_index`.
   */
  get active(): boolean {
    // TODO(port): Python list.index raises ValueError when the view is absent;
    // indexOf returns -1 instead. View has no __eq__, so identity matches.
    return this._viewer.active_view_index === this._viewer.views.indexOf(this);
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
    // TODO(port): Python list.index raises ValueError when the view is absent;
    // indexOf returns -1 instead.
    this._viewer.active_view_index = this._viewer.views.indexOf(this);
  }

  /** Options object for this View. Read-only. */
  get options(): ViewOptions {
    return this._options;
  }
}
