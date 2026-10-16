import { at } from "../../pyrt/index.ts";
import type { Chunk, ListChunk } from "../binary/chunk.ts";
import type { CmtaChunk, IdtaChunk } from "../binary/item_chunks.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import { filter_by_list_type } from "../binary/utils.ts";
import { FootageItem } from "../models/items/footage.ts";
import type { FolderItem } from "../models/items/folder.ts";
import type { FileSource } from "../models/sources/file.ts";
import type { PlaceholderSource } from "../models/sources/placeholder.ts";
import type { SolidSource } from "../models/sources/solid.ts";
import type { Project } from "../models/project.ts";
import { parse_source } from "./source.ts";

/**
 * Parse a footage item.
 *
 * Args:
 *     child_chunks: The footage item child chunks.
 *     _idta: The idta chunk.
 *     _name_utf8: The Utf8 chunk containing the item name.
 *     _cmta: The cmta chunk (None if no comment).
 *     _item_list: The LIST chunk for creating new chunks.
 *     _gide: The LIST chunk for guides (None if no guides).
 *     project: The project.
 *     parent_folder: The item's parent folder.
 */
export function parse_footage(
  child_chunks: Chunk[],
  _idta: IdtaChunk,
  _name_utf8: Utf8Chunk,
  _cmta: CmtaChunk | null,
  _item_list: ListChunk,
  _gide: ListChunk | null,
  project: Project,
  parent_folder: FolderItem,
): FootageItem {
  const pin_chunks = filter_by_list_type(child_chunks, "Pin ");

  const main_source = parse_source(at(pin_chunks, 0));
  const proxy_source: FileSource | SolidSource | PlaceholderSource | null =
    pin_chunks.length > 1 ? parse_source(pin_chunks[1]) : null;

  return new FootageItem({
    _idta,
    _name_utf8,
    _cmta,
    _item_list,
    _gide,
    _pin_chunks: pin_chunks,
    project,
    parent_folder,
    main_source,
    proxy_source,
  });
}
