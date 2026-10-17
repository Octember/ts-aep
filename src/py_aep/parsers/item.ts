import { ValueError } from "../../pyrt/index.ts";
import type { ListChunk } from "../binary/chunk.ts";
import type { CmtaChunk, IdtaChunk } from "../binary/item_chunks.ts";
import type { LdatChunk, Lhd3Chunk } from "../binary/ldat_chunks.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import { ChunkNotFoundError, filter_by_list_type, find_by_list_type, find_by_type } from "../binary/utils.ts";
import { ItemType } from "../enums/index.ts";
import { Guide } from "../models/guide.ts";
import { FolderItem } from "../models/items/folder.ts";
import { parse_composition } from "./composition.ts";
import { parse_footage } from "./footage.ts";
import { parse_viewers } from "./view.ts";
import type { Chunk } from "../binary/chunk.ts";
import type { CompItem } from "../models/items/composition.ts";
import type { FootageItem } from "../models/items/footage.ts";
import type { Project } from "../models/project.ts";

/**
 * Parse an item (composition, footage or folder).
 *
 * @param item_chunk - The LIST chunk to parse.
 * @param project - The project.
 * @param parent_folder - The parent folder.
 */
export function parse_item(
  item_chunk: ListChunk,
  project: Project,
  parent_folder: FolderItem,
): CompItem | FolderItem | FootageItem {
  const child_chunks = item_chunk.chunks;

  const idta = find_by_type(child_chunks, "idta") as IdtaChunk;
  const name_utf8 = find_by_type(child_chunks, "Utf8") as Utf8Chunk;
  let cmta: CmtaChunk | null;
  try {
    cmta = find_by_type(child_chunks, "cmta") as CmtaChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    cmta = null;
  }

  let gide: ListChunk | null;
  try {
    gide = find_by_list_type(item_chunk.chunks, "Gide");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    gide = null;
  }

  const item_type = idta.item_type;

  let item: FolderItem | FootageItem | CompItem;
  if (item_type === ItemType.FOLDER) {
    item = parse_folder(
      false,
      child_chunks,
      project,
      idta,
      name_utf8,
      cmta,
      item_chunk,
      gide,
      parent_folder,
    );
  } else if (item_type === ItemType.FOOTAGE) {
    item = parse_footage(
      child_chunks,
      idta,
      name_utf8,
      cmta,
      item_chunk,
      gide,
      project,
      parent_folder,
    );
  } else if (item_type === ItemType.COMPOSITION) {
    item = parse_composition(
      child_chunks,
      idta,
      name_utf8,
      cmta,
      item_chunk,
      gide,
      project,
      parent_folder,
      project._effect_param_defs,
    );
  } else {
    throw new ValueError(`Unknown item type: ${item_type}`);
  }

  item._guides = _parse_guides(child_chunks);
  project.items.set(item.id, item);

  return item;
}

/**
 * Parse a folder item.
 *
 * @param is_root - Whether the folder is the root folder (ID 0).
 * @param child_chunks - child chunks of the folder LIST chunk.
 * @param project - The project.
 * @param _idta - The idta chunk (None for the root folder).
 * @param _name_utf8 - The Utf8 chunk containing the folder name.
 * @param _cmta - The cmta chunk (None if no comment).
 * @param _item_list - The LIST chunk for creating new chunks.
 * @param _gide - The LIST chunk for guides (None if no guides).
 * @param parent_folder - The folder's parent folder.
 */
export function parse_folder(
  is_root: boolean,
  child_chunks: Chunk[],
  project: Project,
  _idta: IdtaChunk | null,
  _name_utf8: Utf8Chunk | null,
  _cmta: CmtaChunk | null,
  _item_list: ListChunk,
  _gide: ListChunk | null,
  parent_folder: FolderItem | null,
): FolderItem {
  let folder_chunks: Chunk[];
  let children_container: Chunk[];
  if (is_root) {
    folder_chunks = child_chunks;
    children_container = _item_list.chunks;
  } else {
    const sfdr_chunk = find_by_list_type(child_chunks, "Sfdr");
    folder_chunks = sfdr_chunk.chunks;
    children_container = sfdr_chunk.chunks;
  }

  const folder = new FolderItem({
    _idta,
    _name_utf8,
    _cmta,
    _item_list,
    _gide,
    _children_container: children_container,
    project,
    parent_folder,
  });
  if (is_root) {
    // Avoid mutating chunk fields
    // Python writes folder.__dict__["name"] to bypass the property; defining an own
    // property on the instance does the same.
    Object.defineProperty(folder, "name", {
      value: "root",
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  const child_item_chunks = filter_by_list_type(folder_chunks, "Item");
  for (const child_item_chunk of child_item_chunks) {
    const child_item = parse_item(child_item_chunk, project, folder);
    folder.items.push(child_item);
  }

  folder._viewers = parse_viewers(folder_chunks, folder.items);

  return folder;
}

/**
 * Parse composition guides from the LIST:Gide chunk.
 *
 * @param child_chunks - child chunks of the item LIST chunk.
 * @returns List of Guide objects, empty if no guides are defined.
 */
export function _parse_guides(child_chunks: Chunk[]): Guide[] {
  let gide_list: ListChunk;
  try {
    gide_list = find_by_list_type(child_chunks, "Gide");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return [];
  }

  const list_chunk = find_by_list_type(gide_list.chunks, "list");
  const lhd3 = find_by_type(list_chunk.chunks, "lhd3") as Lhd3Chunk;
  if (lhd3.count === 0) {
    return [];
  }

  const ldat = find_by_type(list_chunk.chunks, "ldat") as LdatChunk;
  return ldat.items.map((item) => new Guide(item));
}
