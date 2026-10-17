/**
 * Parse COS (Carousel Object Structure) text data into text models.
 *
 * Transforms the dict returned by {@link CosParser | CosParser} for a
 * `btdk` chunk into {@link TextDocument | TextDocument} and
 * {@link FontObject | FontObject} instances.
 *
 * The COS data layout follows the structure documented in the
 * `lottie-docs AEP reference <https://github.com/nickt/lottie-docs/blob/main/docs/aep.md#list-btdk>`_.
 *
 * Fonts
 * -----
 * `data["0"]["1"]["0"]` contains an array of available fonts.  Each entry
 * carries a `CoolTypeFont` marker and exposes PostScript name, version, and
 * a flag at well-known sub-keys.
 *
 * Text documents
 * --------------
 * `data["1"]["1"]` is an array of text documents (one per keyframe).  Inside
 * each document:
 *
 * * `doc["0"]["0"]` - the text string
 * * `doc["0"]["5"]["0"]` - array of paragraph style runs
 * * `doc["0"]["6"]["0"]` - array of character style runs
 *
 * Default styles live at `data["1"]["2"]` (character) and
 * `data["1"]["3"]` (paragraph).
 */

import { py_bool, warn } from "../../pyrt/index.ts";
import { cos_get } from "../cos/index.ts";
import { FontObject } from "../models/text/font_object.ts";
import { TextDocument } from "../models/text/text_document.ts";
import type { ListChunk } from "../binary/chunk.ts";

// `logging.getLogger(__name__)`: this module logs nothing today, so only the
// warning path is wired to pyrt `warn`.
export const logger = {
  debug() {},
  info() {},
  warning: (m: string) => warn(m),
};

// ---------------------------------------------------------------------------
// Font parsing
// ---------------------------------------------------------------------------

/**
 * Parse font entries from COS data.
 *
 * Reads the font array at `cos_data["0"]["1"]["0"]`.  Each font entry
 * is a dict with structure::
 *
 *     entry["0"]["0"]["0"]  -\> PostScript name (str)
 *     entry["0"]["0"]["5"]  -\> version string (optional)
 *     entry["0"]["99"]      -\> "CoolTypeFont" marker
 *
 * @param cos_data - The parsed COS dict from a `btdk` chunk.
 * @returns List of {@link FontObject} instances in the same order as the COS
 *   array (the index is referenced by character styles).
 */
export function parse_fonts(cos_data: Map<string, any>): FontObject[] {
  const font_array = cos_get(cos_data, "0", "1", "0");
  if (!py_bool(font_array) || !Array.isArray(font_array)) {
    return [];
  }

  const fonts: FontObject[] = [];
  for (const entry of font_array) {
    const font_data = cos_get(entry, "0", "0");
    if (font_data == null || !(font_data instanceof Map)) {
      continue;
    }
    const font_entry = cos_get(entry, "0");
    const font = new FontObject({
      _font_data: font_data,
      _font_entry: font_entry instanceof Map ? font_entry : null,
    });
    fonts.push(font);
  }

  return fonts;
}

// ---------------------------------------------------------------------------
// Text document sub-dict extraction
// ---------------------------------------------------------------------------

/**
 * Return the first character style dict from a text document entry.
 *
 * Path: `doc["0"]["6"]["0"][0]["0"]["0"]["6"]`
 */
export function _get_first_char_style(doc: Map<string, any>): Map<string, any> | null {
  const result = cos_get(doc, "0", "6", "0", 0, "0", "0", "6");
  if (result instanceof Map) {
    return result;
  }
  return null;
}

/**
 * Return the first paragraph style dict from a text document entry.
 *
 * Path: `doc["0"]["5"]["0"][0]["0"]["0"]["5"]`
 */
export function _get_first_para_style(doc: Map<string, any>): Map<string, any> | null {
  const result = cos_get(doc, "0", "5", "0", 0, "0", "0", "5");
  if (result instanceof Map) {
    return result;
  }
  return null;
}

/**
 * Parse text documents from COS data.
 *
 * Reads the document array at `cos_data["1"]["1"]`.  Each entry's COS
 * sub-dicts are passed directly to {@link TextDocument} which lazily
 * extracts values via CosField descriptors.
 *
 * @param cos_data - The parsed COS dict from a `btdk` chunk.
 * @param fonts - The list of {@link FontObject} parsed by
 *   {@link parse_fonts} (font indices reference this list).
 * @param btdk_body - The btdk chunk body for COS write-back.
 * @returns List of {@link TextDocument} instances (one per keyframe).
 */
export function parse_text_documents(
  cos_data: Map<string, any>,
  fonts: FontObject[],
  btdk_body: ListChunk,
): TextDocument[] {
  const doc_array = cos_get(cos_data, "1", "1");
  if (!py_bool(doc_array) || !Array.isArray(doc_array)) {
    return [];
  }

  const documents: TextDocument[] = [];

  for (const doc_entry of doc_array) {
    const char_style = _get_first_char_style(doc_entry);
    const para_style = _get_first_para_style(doc_entry);

    documents.push(
      TextDocument._from_binary({
        _char_style: char_style,
        _para_style: para_style,
        _doc: doc_entry,
        _fonts: fonts,
        _cos_data: cos_data,
        _btdk_body: btdk_body,
      }),
    );
  }

  // Frame-level writes (box meta, orientation) live in the shared
  // cos_data and change composition for every keyframe's document,
  // so each wrapper knows its siblings to dirty-mark them together.
  for (const document of documents) {
    document._siblings = documents;
  }

  return documents;
}

// ---------------------------------------------------------------------------
// High-level entry point
// ---------------------------------------------------------------------------

/**
 * Parse a btdk COS dict into text documents and fonts.
 *
 * This is the main entry point called by
 * {@link py_aep.parsers.property.parse_text_document | parse_text_document}.
 *
 * @param cos_data - The parsed COS dict from a `btdk` chunk (the return
 *   value of {@link CosParser.parse | CosParser.parse}).
 * @param btdk_body - The btdk chunk body for COS write-back.
 * @returns A tuple `(text_documents, fonts)` where `text_documents` is a
 *   list of {@link TextDocument} (one per keyframe) and `fonts` is
 *   the list of {@link FontObject} referenced by the documents.
 */
export function parse_btdk_cos(
  cos_data: Map<string, any>,
  btdk_body: ListChunk,
): [TextDocument[], FontObject[]] {
  const fonts = parse_fonts(cos_data);
  const documents = parse_text_documents(cos_data, fonts, btdk_body);
  return [documents, fonts];
}
