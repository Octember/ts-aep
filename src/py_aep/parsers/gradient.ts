/** Parser and serializer for After Effects gradient XML in GCky Utf8 chunks. */

import { Element, ParseError, fromstring } from "../../pyrt/etree.ts";
import {
  ValueError,
  dict_get,
  float,
  py_bool,
  py_or,
  range,
  warn,
} from "../../pyrt/index.ts";
import { Gradient, GradientAlphaStop, GradientColorStop } from "../models/properties/gradient.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";

export const logger = {
  debug() {},
  info() {},
  warning: (m: string) => warn(m),
};

export { Element, ParseError, fromstring };

/**
 * Parse AE gradient XML into a `Gradient` instance.
 *
 * The XML uses a `prop.map` / `prop.list` / `prop.pair` structure with
 * nested arrays of floats for color and alpha stops.
 *
 * @param utf8 The Utf8 chunk containing the gradient XML.
 * @returns Parsed gradient data, or null if parsing fails.
 */
export function parse_gradient_xml(utf8: Utf8Chunk): Gradient | null {
  // String(): the value may be a `_NulTailStr` (String object), whose truthiness py_bool cannot see.
  const xml_text = String(utf8.value);
  if (!py_bool(xml_text)) return null;
  let root: Element;
  try {
    root = fromstring(xml_text);
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    logger.warning("Invalid gradient XML");
    return null;
  }

  // Navigate: prop.map > prop.list
  const prop_list = root.find("prop.list");
  if (prop_list == null) return null;

  const pairs = _get_pairs(prop_list);
  const gradient_data = dict_get(pairs, "Gradient Color Data");
  const version_str = _get_string_value(dict_get(pairs, "Gradient Colors"));

  if (gradient_data == null) return null;

  const data_pairs = _get_pairs(gradient_data);
  const color_stops = _parse_color_stops(dict_get(data_pairs, "Color Stops"));
  const alpha_stops = _parse_alpha_stops(dict_get(data_pairs, "Alpha Stops"));

  return Gradient._from_binary({
    color_stops,
    alpha_stops,
    version: py_or(version_str, "1.0"),
    _utf8: utf8,
  });
}

/**
 * Extract key-value pairs from a prop.list element.
 *
 * Returns a dict mapping key text to the value element (the second
 * child of each prop.pair).
 */
export function _get_pairs(prop_list_elem: Element): Map<string, Element> {
  const pairs = new Map<string, Element>();
  for (const pair of prop_list_elem.findall("prop.pair")) {
    const key_elem = pair.find("key");
    if (key_elem == null || key_elem.text == null) continue;
    // Value is the second child (after key)
    const children = [...pair];
    if (children.length >= 2) {
      pairs.set(key_elem.text, children[1]);
    }
  }
  return pairs;
}

/** Get text content from a <string> element. */
export function _get_string_value(elem: Element | null): string | null {
  if (elem == null) return null;
  if (elem.tag === "string") return elem.text;
  return null;
}

/** Parse the 'Color Stops' prop.list into GradientColorStop objects. */
export function _parse_color_stops(color_stops_elem: Element | null): GradientColorStop[] {
  if (color_stops_elem == null) return [];

  const pairs = _get_pairs(color_stops_elem);
  const stops_list_elem = dict_get(pairs, "Stops List");
  if (stops_list_elem == null) return [];

  const stops: GradientColorStop[] = [];
  // Each stop is a prop.pair with key "Stop-N"
  const stop_pairs = _get_pairs(stops_list_elem);
  for (const i of range(stop_pairs.size)) {
    const key = `Stop-${i}`;
    const stop_elem = dict_get(stop_pairs, key);
    if (stop_elem == null) break;
    const stop_inner = _get_pairs(stop_elem);
    const array_elem = dict_get(stop_inner, "Stops Color");
    if (array_elem == null) continue;
    const floats = _parse_float_array(array_elem);
    if (floats.length >= 5) {
      stops.push(
        new GradientColorStop(floats[0], floats[1], [floats[2], floats[3], floats[4]]),
      );
    }
  }
  return stops;
}

/** Parse the 'Alpha Stops' prop.list into GradientAlphaStop objects. */
export function _parse_alpha_stops(alpha_stops_elem: Element | null): GradientAlphaStop[] {
  if (alpha_stops_elem == null) return [];

  const pairs = _get_pairs(alpha_stops_elem);
  const stops_list_elem = dict_get(pairs, "Stops List");
  if (stops_list_elem == null) return [];

  const stops: GradientAlphaStop[] = [];
  const stop_pairs = _get_pairs(stops_list_elem);
  for (const i of range(stop_pairs.size)) {
    const key = `Stop-${i}`;
    const stop_elem = dict_get(stop_pairs, key);
    if (stop_elem == null) break;
    const stop_inner = _get_pairs(stop_elem);
    const array_elem = dict_get(stop_inner, "Stops Alpha");
    if (array_elem == null) continue;
    const floats = _parse_float_array(array_elem);
    if (floats.length >= 3) {
      stops.push(new GradientAlphaStop(floats[0], floats[1], floats[2]));
    }
  }
  return stops;
}

/** Parse an <array> element containing <float> children. */
export function _parse_float_array(array_elem: Element): number[] {
  const floats: number[] = [];
  for (const child of array_elem) {
    if (child.tag === "float" && child.text != null) {
      try {
        floats.push(float(child.text));
      } catch (e) {
        if (!(e instanceof ValueError)) throw e;
        continue;
      }
    }
  }
  return floats;
}
