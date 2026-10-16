/**
 * Corpus self-validation: AE-written files must satisfy our own tables.
 *
 * This is the independent oracle for the rules data: every value AE itself
 * stored must be inside the allowed set our tables claim for it. A failure
 * here means a wrong or too-narrow table row, not a bad file (this is how
 * the MP3 mono/stereo column swap and the Targa RGB+32bpp case were
 * caught).
 */

import { expect, test } from "bun:test";
import { parse_app, SAMPLES_DIR } from "../helpers.ts";
import { Path, py_eq, sorted } from "../../src/pyrt/index.ts";

const _CORPUS_ROOTS = [
  SAMPLES_DIR.div("models", "format_options"),
  SAMPLES_DIR.div("models", "renderqueue"),
  SAMPLES_DIR.div("unused", "output_module"),
  SAMPLES_DIR.div("unused", "output_module_settings"),
  SAMPLES_DIR.div("unused", "renderqueue"),
  SAMPLES_DIR.div("unused", "models", "renderqueue"),
];

const _CORPUS: Path[] = sorted(
  _CORPUS_ROOTS.filter((root) => root.is_dir()).flatMap((root) => root.rglob("*.aep")),
  (path: Path) => path.parts,
);

// TODO(port): pytest `ids=` (sample paths relative to SAMPLES_DIR) are not kept;
// bun's `test.each` names come from `%#` (row index) only.
test.each(_CORPUS.map((p) => [p]))("test_ae_written_state_passes_our_tables[%#]", (aep_path: Path) => {
  const app = parse_app(aep_path);
  for (const rqi of app.project.render_queue.items) {
    for (const om of rqi.output_modules) {
      expect(py_eq(om.validate_state(), [])).toBe(true);
    }
  }
});
