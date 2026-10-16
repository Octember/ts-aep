/**
 * Integrity checks for the output-module rules tables.
 *
 * These tests make the clamp/sync bypass writes safe: values written
 * outside the descriptors (depth pairing, singleton clamps) are proven to
 * stay inside the tables, so re-validation on the bypass path is never
 * needed.
 */

import { expect, test } from "bun:test";
import { _CONDITIONAL_RULES, _FORMAT_RULES, _KIND_RULES, allowed_values } from "../../src/py_aep/data/output_module_rules.ts";
import { AudioChannels, AudioCodec, FormatKind, OutputAudio, OutputChannels, OutputColorMode, OutputFormat } from "../../src/py_aep/enums/index.ts";
import { _DEPTH_MINUS, _DEPTH_PLUS, OM_SETTINGS } from "../../src/py_aep/models/renderqueue/output_module.ts";
import {
  dict_get,
  getitem,
  int,
  py_assert,
  py_bool,
  py_eq,
  py_or,
  repr,
  sorted,
} from "../../src/pyrt/index.ts";

// Context keys the OutputModule._rules_context builder can provide.
const _CONDITION_KEYS = new Set([
  "Channels",
  "Audio Channels",
  "Audio Sample Rate",
  "Audio Codec",
  "Video Codec",
  "Audio Format",
  "Audio Layer",
  "Multiplexer",
  "BitRate",
]);

// Keys a rule may constrain: OM settings plus format-option fields.
const _FO_CONSTRAINT_KEYS = new Set([
  "Audio Bitrate",
  "Audio Codec",
  "Audio Format",
  "BitRate",
  "Multiplexer",
  "Video Codec",
]);

const _ALL_CHANNELS = new Set(OutputChannels.members());

function* _iter_all_constraint_dicts(): Generator<Map<string, any>> {
  for (const rules of _KIND_RULES.values()) {
    yield rules;
  }
  for (const rules of _FORMAT_RULES.values()) {
    yield rules;
  }
  for (const entries of _CONDITIONAL_RULES.values()) {
    for (const [_, constraints] of entries) {
      yield constraints;
    }
  }
}

test("test_every_format_has_a_kind", () => {
  // A new OutputFormat member must be classified before it ships.
  for (const fmt of OutputFormat.members()) {
    expect(FormatKind.has(OutputFormat.kind(fmt))).toBe(true);
  }
});

test("test_constraint_keys_are_known_settings", () => {
  const valid = new Set([...OM_SETTINGS.keys(), ..._FO_CONSTRAINT_KEYS]);
  for (const constraints of _iter_all_constraint_dicts()) {
    for (const key of constraints.keys()) {
      py_assert(valid.has(key), `unknown constraint key ${repr(key)}`);
    }
  }
});

test("test_condition_keys_are_buildable_context", () => {
  for (const entries of _CONDITIONAL_RULES.values()) {
    for (const [conditions, _] of entries) {
      for (const key of conditions.keys()) {
        py_assert(_CONDITION_KEYS.has(key), `unknown condition key ${repr(key)}`);
      }
    }
  }
});

test("test_no_empty_allowed_sets", () => {
  // An empty set would make a setting unwritable for the format.
  for (const constraints of _iter_all_constraint_dicts()) {
    for (const [key, values] of constraints) {
      py_assert(py_bool(values), `empty allowed set for ${repr(key)}`);
    }
  }
});

/** Check the channels<->depth pairing closure for one rule branch. */
function _depth_closure_ok(channels: ReadonlySet<any>, depths: ReadonlySet<any>): [boolean, string] {
  // TODO(port): failure-message text prints pyrt repr of depth numbers; Python prints the OutputColorDepth IntEnum repr.
  if (channels.has(OutputChannels.RGBA)) {
    for (const depth of depths) {
      const base = int(depth);
      if (_DEPTH_PLUS.has(base) && !depths.has(getitem(_DEPTH_PLUS, base))) {
        return [false, `${base} has no +alpha pair in ${repr(sorted(depths))}`];
      }
    }
  }
  if ([OutputChannels.RGB, OutputChannels.ALPHA].some((c) => channels.has(c))) {
    for (const depth of depths) {
      const plus = int(depth);
      if (_DEPTH_MINUS.has(plus) && !depths.has(getitem(_DEPTH_MINUS, plus))) {
        return [false, `${plus} has no base pair in ${repr(sorted(depths))}`];
      }
    }
  }
  return [true, ""];
}

// ids=lambda f: f.name
test.each(OutputFormat.members().map((fmt) => [OutputFormat.name_of(fmt), fmt] as [string, number]))(
  "test_depth_pairing_closed_under_channel_sync[%s]",
  (_id: string, fmt: number) => {
    /**
     * `_sync_after_channels` can never write an out-of-table depth.
     *
     * For every rule branch (format level and each conditional entry), any
     * depth reachable through the RGBA pairing maps (`_DEPTH_PLUS/_MINUS`)
     * from an allowed depth under allowed channels must itself be allowed.
     */
    const fmt_rules = dict_get(_FORMAT_RULES, fmt, new Map());
    const branches: [Map<string, any>, Map<string, any> | null][] = [[fmt_rules, null]];
    for (const [conditions, constraints] of dict_get(_CONDITIONAL_RULES, fmt, [])) {
      const merged = new Map([...fmt_rules, ...constraints]);
      branches.push([merged, conditions]);
    }
    for (const [branch, conditions] of branches) {
      const depths = dict_get(branch, "Depth");
      if (depths == null) continue;
      let channels = dict_get(branch, "Channels", _ALL_CHANNELS);
      // A branch conditioned on specific channels only ever applies
      // there (e.g. the generated parity rows): narrow accordingly.
      let cond_channels = dict_get(py_or(conditions, new Map()), "Channels");
      if (cond_channels != null) {
        if (!Array.isArray(cond_channels)) {
          cond_channels = [cond_channels];
        }
        channels = new Set([...channels].filter((c) => new Set(cond_channels).has(c)));
      }
      const [ok, why] = _depth_closure_ok(channels, depths);
      py_assert(ok, `${OutputFormat.name_of(fmt)}: ${why}`);
    }
  },
);

test("test_forced_color_values_are_color_modes", () => {
  // Singleton "Color" sets drive the clamp; their value must be a real
  // OutputColorMode so the raw byte write is well-formed.
  for (const entries of _CONDITIONAL_RULES.values()) {
    for (const [_, constraints] of entries) {
      for (const value of dict_get(constraints, "Color", [])) {
        expect(OutputColorMode.has(value)).toBe(true);
      }
    }
  }
});

test("test_allowed_values_kind_and_format_merge", () => {
  expect(py_eq(allowed_values(OutputFormat.MP3, "Video Output"), new Set([false]))).toBe(true);
  expect(py_eq(allowed_values(OutputFormat.MP3, "Output Audio"), new Set([OutputAudio.ON]))).toBe(true);
  expect(
    py_eq(allowed_values(OutputFormat.TIFF_SEQUENCE, "Output Audio"), new Set([OutputAudio.OFF])),
  ).toBe(true);
  // Movies leave both toggles free.
  expect(allowed_values(OutputFormat.AVI, "Video Output") == null).toBe(true);
  expect(allowed_values(OutputFormat.AVI, "Output Audio") == null).toBe(true);
  // Unconstrained key -> None (NOT an empty set).
  expect(allowed_values(OutputFormat.TIFF_SEQUENCE, "Channels") == null).toBe(true);
});

test("test_allowed_values_conditional_replaces_format_row", () => {
  // Without context the WAV union applies; with the GSM codec the
  // conditional row replaces it.
  const union = allowed_values(OutputFormat.WAV, "Audio Sample Rate");
  expect(union != null && union.has(96000)).toBe(true);
  const gsm = allowed_values(
    OutputFormat.WAV,
    "Audio Sample Rate",
    new Map([["Audio Codec", AudioCodec.GSM_6_10]]),
  );
  expect(py_eq(gsm, new Set([8000, 11025, 22050, 44100]))).toBe(true);
  const channels = allowed_values(
    OutputFormat.WAV,
    "Audio Channels",
    new Map([["Audio Codec", AudioCodec.GSM_6_10]]),
  );
  expect(py_eq(channels, new Set([AudioChannels.MONO]))).toBe(true);
});

test("test_allowed_values_missing_context_is_permissive", () => {
  // No codec in context -> the conditional rows do not narrow.
  expect(allowed_values(OutputFormat.WAV, "Audio Channels") == null).toBe(true);
  expect(allowed_values(OutputFormat.WAV, "Audio Channels", new Map()) == null).toBe(true);
});
