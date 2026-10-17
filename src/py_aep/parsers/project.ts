// `from __future__ import annotations` and `from typing import TYPE_CHECKING, cast`
// are dropped: annotations are types only and `cast(...)` is `as` in TS.
import { getattr } from "../../pyrt/index.ts";
import type { Path } from "../../pyrt/index.ts";
import { HeadChunk, NhedChunk, NnhdChunk } from "../binary/item_chunks.ts";
import { DwgaChunk } from "../binary/misc_chunks.ts";
import { F8Chunk, U1Chunk, U4Chunk, Utf8Chunk } from "../binary/scalar_chunks.ts";
import type { Chunk, ListChunk } from "../binary/chunk.ts";
import { ChunkNotFoundError, filter_by_type, find_by_list_type, find_by_type } from "../binary/utils.ts";
import { GpuAccelType } from "../enums/index.ts";
import { _suppress_materialization } from "../models/descriptors.ts";
import { Project } from "../models/project.ts";
import { parse_effect_definitions } from "./effect.ts";
import { parse_folder } from "./item.ts";
import { parse_render_queue } from "./render_queue.ts";

/**
 * The color-profile `Utf8` AE writes immediately after `marker`.
 *
 * `marker` is `PwCs` (working space) or `pdvc` (display space). The slot is
 * identified by its marker rather than by the order the envelopes appear in:
 * an unset slot holds a literal `{}`, so keying on "first profile envelope
 * wins" reads a display space as the working space whenever the working space
 * is unset. Mirrors `Project._rewrite_color_profile`, which writes by this
 * same rule.
 *
 * Returns:
 *     The `Utf8Chunk` holding the profile envelope, or `null` when the marker
 *     is absent or its slot is unset.
 */
export function _color_profile_utf8(root_chunks: Chunk[], marker: string): Utf8Chunk | null {
  for (const [i, chunk] of root_chunks.entries()) {
    if (chunk.chunk_type !== marker || i + 1 >= root_chunks.length) continue;
    const following = root_chunks[i + 1];
    if (following.chunk_type !== "Utf8") continue;
    const utf8 = following as Utf8Chunk;
    if (utf8.value.includes("baseColorProfile")) return utf8;
  }
  return null;
}

// The project settings nhed holds as nnhd does, in its older layout.
export const _NHED_SETTINGS = [
  "_display_byte",
  "footage_timecode_display_start_type",
  "_feet_byte",
  "timecode_default_base",
  "frames_count_type",
  "bits_per_channel",
  "transparency_grid_thumbnails",
] as const;

/** A synthetic nnhd carrying the settings of a project that has only nhed. */
export function _nnhd_from_nhed(nhed: NhedChunk): NnhdChunk {
  const nnhd = new NnhdChunk({ synthetic: true });
  for (const name of _NHED_SETTINGS) {
    // setattr(nnhd, name, getattr(nhed, name)) with a computed name
    (nnhd as any)[name] = getattr(nhed, name);
  }
  return nnhd;
}

/**
 * Parse an After Effects (.aep) project file into a Project.
 *
 * Args:
 *     rifx: The parsed binary RIFX root chunk.
 *     xmp: The XMP metadata string from the file trailer.
 *     file_path: Path to the `.aep` file (stored on the Project).
 *     ae_preferences_dir: Optional path to the AE preferences directory
 *         for template lookup.
 */
export const parse_project = _suppress_materialization()(function parse_project(
  rifx: ListChunk,
  xmp: string,
  file_path: string,
  ae_preferences_dir: Path | null = null,
): Project {
  const root_chunks = rifx.chunks;

  const root_folder_chunk = find_by_list_type(root_chunks, "Fold");
  const head_chunk = find_by_type(root_chunks, "head") as HeadChunk;
  const nhed_chunk = find_by_type(root_chunks, "nhed") as NhedChunk;
  const acer_chunk = find_by_type(root_chunks, "acer") as U1Chunk;
  const adfr_chunk = find_by_type(root_chunks, "adfr") as F8Chunk;
  // Older projects (AE CC 12.0) have none of nnhd, dwga and gpuG: their
  // settings come from nhed, and the others take their defaults. The
  // stand-ins are synthetic, so the file is written back without them.
  let nnhd_chunk: NnhdChunk;
  try {
    nnhd_chunk = find_by_type(root_chunks, "nnhd") as NnhdChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    nnhd_chunk = _nnhd_from_nhed(nhed_chunk);
  }
  let dwga_chunk: DwgaChunk;
  try {
    dwga_chunk = find_by_type(root_chunks, "dwga") as DwgaChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    dwga_chunk = new DwgaChunk({ synthetic: true });
  }
  let gpug_utf8: Utf8Chunk;
  try {
    const gpug_chunk = find_by_list_type(root_chunks, "gpuG");
    gpug_utf8 = find_by_type(gpug_chunk.chunks, "Utf8") as Utf8Chunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    // AE 2026 reports SOFTWARE for a CC 12.0 project.
    gpug_utf8 = new Utf8Chunk({
      value: GpuAccelType.to_binary(GpuAccelType.SOFTWARE),
      synthetic: true,
    });
  }

  // Expression engine: LIST:ExEn > Utf8
  let exen_utf8: Utf8Chunk | null = null;
  try {
    const exen_chunk = find_by_list_type(root_chunks, "ExEn");
    exen_utf8 = find_by_type(exen_chunk.chunks, "Utf8") as Utf8Chunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
  }

  // CMS settings JSON
  let cms_utf8: Utf8Chunk | null = null;
  for (const c of filter_by_type(root_chunks, "Utf8") as Utf8Chunk[]) {
    const content = c.value;
    // The color-management settings JSON is fragmented across AE versions:
    // some files store `{"colorManagementSystem":..,"ocioConfigurationFile":..}`,
    // others `{"graphicsWhiteLuminance":..,"lutInterpolationMethod":..}`. Prefer
    // the `colorManagementSystem` chunk (so OCIO projects are detected), but
    // fall back to a `lutInterpolationMethod`-only chunk when there is none.
    if (content.includes("colorManagementSystem")) {
      cms_utf8 = c;
    } else if (cms_utf8 == null && content.includes("lutInterpolationMethod")) {
      cms_utf8 = c;
    }
  }

  const ws_utf8 = _color_profile_utf8(root_chunks, "PwCs");
  const dcs_utf8 = _color_profile_utf8(root_chunks, "pdvc");

  const project = new Project({
    _nhed: nhed_chunk,
    _nnhd: nnhd_chunk,
    _head: head_chunk,
    _acer: acer_chunk,
    _adfr: adfr_chunk,
    _dwga: dwga_chunk,
    _gpug_utf8: gpug_utf8,
    _exen_utf8: exen_utf8,
    _cms_utf8: cms_utf8,
    _ws_utf8: ws_utf8,
    _dcs_utf8: dcs_utf8,
    _rifx: rifx,
    _xmp: xmp,
    file: file_path,
    items: new Map(),
    render_queue: null,
    ae_preferences_dir: ae_preferences_dir,
  });

  project._effect_param_defs = parse_effect_definitions(root_chunks);

  const root_folder = parse_folder(
    true, // is_root
    root_folder_chunk.chunks, // child_chunks
    project, // project
    null, // _idta
    null, // _name_utf8
    null, // _cmta
    root_folder_chunk, // _item_list
    null, // _gide
    null, // parent_folder
  );
  project.items.set(0, root_folder);

  project._render_queue = parse_render_queue(root_chunks, project);

  try {
    const fcid_chunk = find_by_type(root_chunks, "fcid") as U4Chunk;
    // `fcid` can name an item that no longer exists (After Effects leaves
    // the id behind when the active item is deleted outside its own
    // bookkeeping, and opens such a file with nothing selected). Treat a
    // dangling id as "no active item" rather than failing the parse.
    project._active_item = project.items.get(fcid_chunk.value) ?? null;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
  }

  return project;
});
