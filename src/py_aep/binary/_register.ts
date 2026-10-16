// Trigger registration of typed chunk classes.
//
// Python ends `binary/chunk.py` with `import py_aep.binary.*_chunks`
// lines run for their `@register` side effects. Those imports live here so
// `chunk.ts` never imports the chunk modules that extend it. Modules that
// need every chunk type registered import this file.

import "./chunk.ts";
import "./composition_chunks.ts";
import "./footage_chunks.ts";
import "./item_chunks.ts";
import "./layer_chunks.ts";
import "./ldat_chunks.ts";
import "./misc_chunks.ts";
import "./project_chunks.ts";
import "./property_chunks.ts";
import "./render_chunks.ts";
import "./scalar_chunks.ts";
