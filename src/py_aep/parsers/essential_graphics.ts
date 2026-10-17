/** Parser for Essential Graphics panel data (LIST:CIF3 chunks). */

import { ChunkNotFoundError, filter_by_type, filter_by_list_type, find_by_type, find_by_list_type } from "../binary/utils.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import type { Chunk, ListChunk } from "../binary/chunk.ts";
import { _suppress_materialization } from "../models/descriptors.ts";
import { EssentialGraphicsController, SourcePropertyRef } from "../models/essential_graphics.ts";
import { at, dict_get, getitem, int, json_loads, py_eq, sorted } from "../../pyrt/index.ts";

// AE stores 0xFFFFFFFF in a CPrp path node's `index` to mean "match by name".
export const _BY_NAME_INDEX = 0xffffffff;

type PathNode = Map<"index", number | undefined> & Map<"matchName", string>;

/**
 * Parse a controller's `CPrp` path JSON into root-to-leaf refs.
 *
 * The JSON maps stringified positions (`"0"`, `"1"`, ...) to
 * `{"index", "matchName"}` nodes describing the path from the layer root to
 * the source property the controller exposes.
 */
export function _parse_source_property_path(raw: string): SourcePropertyRef[] {
  const nodes: Map<string, PathNode> = json_loads(raw);
  const path: SourcePropertyRef[] = [];
  for (const key of sorted(nodes.keys(), int)) {
    const node = getitem(nodes, key);
    const index = node.get("index") ?? null;
    path.push(
      new SourcePropertyRef(
        dict_get(node, "matchName", ""),
        py_eq(index, _BY_NAME_INDEX) ? null : index,
      ),
    );
  }
  return path;
}

/**
 * Parse a single LIST:CCtl chunk into a controller.
 *
 * @param cctl_chunk - A LIST:CCtl chunk.
 */
export function _parse_controller(cctl_chunk: ListChunk): EssentialGraphicsController {
  const cps2 = find_by_list_type(cctl_chunk.chunks, "CpS2");
  const name_utf8 = at(filter_by_type(cps2.chunks, "Utf8"), 0);

  const ctyp = find_by_type(cctl_chunk.chunks, "CTyp");

  const uuid_chunks = filter_by_type(cctl_chunk.chunks, "Utf8");
  const uuid = uuid_chunks?.length > 0 ? uuid_chunks[0].value : "";

  // The controlled-property path is the nested LIST:CPrp's Utf8 (JSON), a
  // different CPrp from the override-side OvG2/CPrp. Absent for some
  // controllers -> empty path.
  let source_property_path: SourcePropertyRef[] = [];
  let source_comp_id: number | null = null;
  let source_layer_id: number | null = null;
  let cprp: ListChunk | null;
  try {
    cprp = find_by_list_type(cctl_chunk.chunks, "CPrp");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    cprp = null;
  }
  if (cprp != null) {
    const path_utf8 = filter_by_type(cprp.chunks, "Utf8");
    if (path_utf8?.length > 0) {
      source_property_path = _parse_source_property_path(path_utf8[0].value);
    }
    // CCId / CLId identify the source comp + layer that own the
    // controlled property (the layer is matched by its `layer_id`).
    const ccid = filter_by_type(cprp.chunks, "CCId");
    if (ccid?.length > 0) {
      source_comp_id = ccid[0].value;
    }
    const clid = filter_by_type(cprp.chunks, "CLId");
    if (clid?.length > 0) {
      source_layer_id = clid[0].value;
    }
  }

  return new EssentialGraphicsController({
    _name_utf8: name_utf8,
    _ctyp: ctyp,
    uuid,
    source_property_path,
    source_comp_id,
    source_layer_id,
  });
}

/**
 * Parse the Essential Graphics panel from a composition's child chunks.
 *
 * Reads the Essential Graphics container and extracts the template name and
 * controllers. `CIF3` is the current, authoritative version (AE 2022+);
 * `CIF2`/`CIFO` are same-structure legacy versions that can be STALE
 * snapshots holding fewer (or zero) controllers than `CIF3` in the same
 * file. The `CIF3 -> CIF2 -> CIFO` order is therefore necessary - prefer
 * `CIF3` when present, and fall back to the legacy versions only so a
 * pre-CIF3 file still yields its template name and controllers rather than
 * silently parsing as no Essential Graphics.
 *
 * @param child_chunks - The child chunks of a composition LIST:Item chunk.
 * @returns A tuple of (template_name_utf8_chunk, controllers) if an Essential Graphics container is
 *   found, otherwise `null`.
 */
export const parse_essential_graphics = _suppress_materialization().decorate(
  function parse_essential_graphics(
    child_chunks: Chunk[],
  ): [Utf8Chunk, EssentialGraphicsController[]] | null {
    let cif: ListChunk | null = null;
    for (const list_type of ["CIF3", "CIF2", "CIFO"]) {
      try {
        cif = find_by_list_type(child_chunks, list_type);
        break;
      } catch (e) {
        if (e instanceof ChunkNotFoundError) continue;
        throw e;
      }
    }
    if (cif == null) return null;

    const cif_chunks = cif.chunks;

    // Template name from the first LIST:CpS2
    const cps2 = find_by_list_type(cif_chunks, "CpS2");
    const template_name_utf8 = at(filter_by_type(cps2.chunks, "Utf8"), 0);

    const cctl_chunks = filter_by_list_type(cif_chunks, "CCtl");
    const controllers = cctl_chunks.map((cctl) => _parse_controller(cctl));

    return [template_name_utf8, controllers];
  },
);
