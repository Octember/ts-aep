import { at, getattr, getitem, py_or, sorted } from "../../pyrt/index.ts";
import { ContainerChunk, ListChunk } from "../binary/chunk.ts";
import type { Chunk } from "../binary/chunk.ts";
import { LdatChunk } from "../binary/ldat_chunks.ts";
import type { Lhd3Chunk } from "../binary/ldat_chunks.ts";
import { LRDR_CHILD_ORDER, build_rq_settings_list } from "../binary/mutations.ts";
import { ROUT_ITEMS_PER_RQ_ITEM, ArsiChunk, RoutChunk } from "../binary/render_chunks.ts";
import type { RenderSettingsItem, RoutItem } from "../binary/render_chunks.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import { ChunkNotFoundError, find_by_list_type, find_by_type, split_on_type } from "../binary/utils.ts";
import type { CompItem } from "../models/items/composition.ts";
import { RenderQueue } from "../models/renderqueue/render_queue.ts";
import { RenderQueueItem } from "../models/renderqueue/render_queue_item.ts";
import type { Project } from "../models/project.ts";
import { parse_output_module } from "./output_module.ts";

/**
 * Parse the render queue from the top-level chunks.
 *
 * @param root_chunks - The top-level chunks from the AEP file.
 * @param project - The Project object being constructed, used to link comp references in render
 *   queue items.
 */
export function parse_render_queue(root_chunks: Chunk[], project: Project): RenderQueue {
  let lrdr_chunk: ListChunk;
  try {
    lrdr_chunk = find_by_list_type(root_chunks, "LRdr");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    // Legacy/hand-built files may omit the render-queue scaffold entirely
    // (AE always writes an LRdr, but a minimal file need not). Synthesize an
    // empty queue and attach its LRdr to the root, marked synthetic so
    // write_aep skips it - an untouched queue-less file still round-trips
    // byte-identically. The first add() materializes the tree.
    const render_queue = RenderQueue._new(project);
    render_queue._lrdr.synthetic = true;
    // AE writes LRdr immediately before LIST:PTRE (the workspace blob), so
    // insert at that canonical root position rather than appending past it.
    const ptre_found = root_chunks.findIndex(
      (c) => c instanceof ListChunk && c.list_type === "PTRE",
    );
    const ptre_idx = ptre_found === -1 ? root_chunks.length : ptre_found;
    root_chunks.splice(ptre_idx, 0, render_queue._lrdr);
    return render_queue;
  }
  const lrdr_child_chunks = lrdr_chunk.chunks;
  let synthesized = false;

  let list_settings_chunk: ListChunk;
  try {
    list_settings_chunk = find_by_list_type(lrdr_child_chunks, "list");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    synthesized = true;
    // An LRdr present but lacking its settings 'list' is degenerate;
    // rebuild it so the parse still yields an empty queue instead of
    // raising.
    [list_settings_chunk] = build_rq_settings_list({ synthetic: true });
    lrdr_child_chunks.push(list_settings_chunk);
  }
  const settings_lhd3 = find_by_type(list_settings_chunk.chunks, "lhd3") as Lhd3Chunk;

  // Legacy/minimal files may omit the queue scaffolding (Rout, LItm,
  // LSIf/ARsi). Substitute synthetic placeholders attached to the tree so
  // the parse still yields an (empty) render queue; write_aep() skips
  // synthetic chunks, so untouched files round-trip byte-identically.
  let rout_chunk: RoutChunk;
  try {
    rout_chunk = find_by_type(lrdr_child_chunks, "Rout") as RoutChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    synthesized = true;
    rout_chunk = new RoutChunk({ synthetic: true });
    lrdr_child_chunks.push(rout_chunk);
  }

  let litm_chunk: ListChunk;
  try {
    litm_chunk = find_by_list_type(lrdr_child_chunks, "LItm");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    synthesized = true;
    litm_chunk = new ListChunk({ list_type: "LItm", synthetic: true });
    lrdr_child_chunks.push(litm_chunk);
  }

  let lsif_chunk: ListChunk;
  try {
    lsif_chunk = find_by_list_type(lrdr_child_chunks, "LSIf");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    synthesized = true;
    lsif_chunk = new ListChunk({ list_type: "LSIf", synthetic: true });
    lrdr_child_chunks.push(lsif_chunk);
  }
  let arsi_chunk: ArsiChunk;
  try {
    arsi_chunk = find_by_type(lsif_chunk.chunks, "ARsi") as ArsiChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    arsi_chunk = new ArsiChunk({ synthetic: true });
    lsif_chunk.chunks.push(arsi_chunk);
  }

  if (synthesized) {
    // The synthesized placeholders were appended out of AE's canonical LRdr
    // child order; reorder so a populated queue (after add() materializes
    // them) is written canonically. Only when we synthesized something, so
    // an untouched real file's order - hence its round-trip - is untouched.
    const _canon = new Map<string, number>(
      LRDR_CHILD_ORDER.map((t, i): [string, number] => [t, i]),
    );
    lrdr_child_chunks.splice(
      0,
      lrdr_child_chunks.length,
      ...sorted(lrdr_child_chunks, (c) =>
        _canon.get(py_or(getattr(c, "list_type", null), c.chunk_type)) ?? _canon.size,
      ),
    );
  }

  let settings_ldat: LdatChunk;
  if (settings_lhd3.count === 0) {
    // Empty render queue: AE writes the settings 'list' with only an lhd3
    // (no ldat). Create a synthetic ldat and attach it to the tree so the
    // model and tree agree. write_aep() skips synthetic chunks, so an
    // untouched empty queue still round-trips byte-identically; the first
    // add() flips it to non-synthetic. (AE may instead write an empty ldat
    // with count==0; reuse it when present.)
    try {
      settings_ldat = find_by_type(list_settings_chunk.chunks, "ldat") as LdatChunk;
    } catch (e) {
      if (!(e instanceof ChunkNotFoundError)) throw e;
      settings_ldat = new LdatChunk({ chunk_type: "ldat", synthetic: true });
      list_settings_chunk.chunks.push(settings_ldat);
    }
  } else {
    settings_ldat = find_by_type(list_settings_chunk.chunks, "ldat") as LdatChunk;
  }

  const render_queue = new RenderQueue({
    _lrdr: lrdr_chunk,
    _rs_lhd3: settings_lhd3,
    _rs_ldat: settings_ldat,
    _rout: rout_chunk,
    _litm: litm_chunk,
    _arsi: arsi_chunk,
    parent: project,
    items: [],
  });

  if (settings_lhd3.count > 0) {
    render_queue._items = parse_render_queue_items(
      litm_chunk,
      settings_ldat.items,
      rout_chunk.items,
      project,
      render_queue,
    );
  }
  return render_queue;
}

/**
 * Parse render queue items from the child chunks of LItm.
 *
 * Each item consists of:
 * - An optional RCom chunk with the item comment
 * - A LIST 'list' chunk with OM metadata (lhd3 + ldat)
 * - A LIST 'LOm ' chunk with output module chunks
 *
 * @param litm_chunk - The LIST 'LItm' chunk containing per-item groups.
 * @param render_settings - The parsed RenderSettingsItem list from LRdr's ldat.
 * @param rout_items - The parsed RoutItem list from the Rout chunk.
 * @param project - The Project object, used to resolve comp references.
 * @param render_queue - The parent RenderQueue being constructed.
 */
export function parse_render_queue_items(
  litm_chunk: ListChunk,
  render_settings: RenderSettingsItem[],
  rout_items: RoutItem[],
  project: Project,
  render_queue: RenderQueue,
): RenderQueueItem[] {
  const items: RenderQueueItem[] = [];
  let item_index = 0;
  let rcom_container: ContainerChunk | null = null;
  let rcom_utf8: Utf8Chunk | null = null;
  let list_chunk: ListChunk | null = null;

  for (const chunk of litm_chunk.chunks) {
    if (chunk instanceof ContainerChunk && chunk.chunk_type === "RCom") {
      rcom_container = chunk;
      rcom_utf8 = find_by_type(chunk.chunks, "Utf8") as Utf8Chunk;
    } else if (chunk instanceof ListChunk) {
      if (chunk.list_type === "list") {
        list_chunk = chunk;
      } else if (chunk.list_type === "LOm " && list_chunk != null) {
        const rout_start = item_index * ROUT_ITEMS_PER_RQ_ITEM;
        const item = parse_render_queue_item(
          list_chunk,
          chunk,
          at(render_settings, item_index),
          rcom_container,
          rcom_utf8,
          rout_items.slice(rout_start, rout_start + ROUT_ITEMS_PER_RQ_ITEM),
          litm_chunk,
          project,
          render_queue,
        );
        items.push(item);
        item_index += 1;
        rcom_container = null;
        rcom_utf8 = null;
        list_chunk = null;
      }
    }
  }

  return items;
}

/**
 * Parse a single render queue item from its component chunks.
 *
 * @param list_chunk - The LIST 'list' chunk containing OM metadata.
 * @param lom_chunk - The LIST 'LOm ' chunk containing output modules.
 * @param ldat_body - The RenderSettingsItem for this item.
 * @param rcom_container - The RCom ContainerChunk, or None if absent.
 * @param rcom_utf8 - The Utf8 chunk inside RCom, or None if absent.
 * @param rout_items - This item's block of RoutItems (AE writes 5 per item).
 * @param litm_chunk - The LIST 'LItm' chunk.
 * @param project - The Project object, used to resolve comp references.
 * @param render_queue - The parent RenderQueue being constructed.
 */
export function parse_render_queue_item(
  list_chunk: ListChunk,
  lom_chunk: ListChunk,
  ldat_body: RenderSettingsItem,
  rcom_container: ContainerChunk | null,
  rcom_utf8: Utf8Chunk | null,
  rout_items: RoutItem[],
  litm_chunk: ListChunk,
  project: Project,
  render_queue: RenderQueue,
): RenderQueueItem {
  const om_ldat = find_by_type(list_chunk.chunks, "ldat") as LdatChunk;
  const om_ldat_items = om_ldat.items;

  const comp_id = ldat_body.comp_id;
  const comp = getitem(project.items, comp_id) as CompItem;

  // Group chunks by Roou - each Roou starts a new output module
  const om_groups = split_on_type(lom_chunk.chunks, "Roou");

  const render_queue_item = new RenderQueueItem({
    _ldat: ldat_body,
    _litm: litm_chunk,
    _list_chunk: list_chunk,
    _lom: lom_chunk,
    _rcom: rcom_container,
    _rcom_utf8: rcom_utf8,
    _rout_items: rout_items,
    parent: render_queue,
    comp,
    output_modules: [],
  });

  const output_modules = [];
  for (const [om_index, group] of om_groups.entries()) {
    const output_module = parse_output_module(
      group,
      at(om_ldat_items, om_index),
      render_queue_item,
    );
    output_modules.push(output_module);
  }

  render_queue_item._output_modules = output_modules;

  return render_queue_item;
}
