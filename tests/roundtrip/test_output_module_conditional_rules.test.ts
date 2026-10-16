/**
 * Codec/context-conditional validation of output-module settings.
 *
 * Fixtures are the AE-saved per-codec samples: each test parses the sample
 * whose stored codec/bitrate provides the rule context, then asserts the
 * narrowed sets accept/reject as AE's dialog does.
 */

import { expect, test } from "bun:test";

import { int, Path, ValueError } from "../../src/pyrt/index.ts";
import { make_tmp_path, raises } from "../../src/pyrt/pytest.ts";
import { parse_project_fresh } from "../helpers.ts";
import "../../src/py_aep/binary/_register.ts";
import {
  AudioBitDepth,
  AudioChannels,
  OutputChannels,
  OutputColorDepth,
} from "../../src/py_aep/enums/index.ts";

// `Path(__file__).parent.parent.parent`: `import.meta.dir` is this test's
// directory (tests/roundtrip), so two `.parent` hops reach the package root.
const FORMAT_DIR = new Path(import.meta.dir).parent.parent.div("samples", "models", "format_options");
const AVI_NONE_SAMPLE = FORMAT_DIR.div("avi", "video_codec_none.aep");

function _om(project: any): any {
  return project.render_queue.items[0].output_modules[0];
}

const REJECTS: [string, string, unknown][] = [
  // WAV: per-codec narrowing of the format-level union.
  ["wav/audio_codec_gsm_6.10", "Audio Sample Rate", 48000],
  ["wav/audio_codec_gsm_6.10", "Audio Channels", AudioChannels.STEREO],
  ["wav/audio_codec_gsm_6.10", "Audio Bit Depth", AudioBitDepth.THIRTY_TWO_BIT],
  ["wav/audio_codec_ima_adpcm", "Audio Sample Rate", 16000],
  ["wav/audio_codec_ccitt_a-law", "Audio Sample Rate", 32000],
  ["wav/audio_codec_ccitt_u-law", "Audio Bit Depth", AudioBitDepth.EIGHT_BIT],
  // AVI: per-video-codec channels/depth.
  ["avi/video_codec_dv_ntsc", "Channels", OutputChannels.RGBA],
  ["avi/video_codec_dv_ntsc", "Depth", OutputColorDepth.TRILLIONS_OF_COLORS],
  ["avi/video_codec_v210_10-bit_yuv", "Depth", OutputColorDepth.MILLIONS_OF_COLORS],
  ["avi/video_codec_v210_10-bit_yuv", "Channels", OutputChannels.RGBA],
  // H264: audio-format-conditional sample rates.
  ["h.264/audio_format_pcm", "Audio Sample Rate", 16000],
  ["h.264/audio_format_mpeg", "Audio Sample Rate", 22050],
  ["h.264/base", "Audio Sample Rate", 96000], // AAC has no 96 kHz
  // MP3: (bitrate, stereo) resolves a single rate.
  ["mp3/base", "Audio Sample Rate", 22050], // stored bitrate is 128
];

// pytest ids: `f"{s}-{k}-{v}"`.
test.each(REJECTS.map(([s, k, v]) => [`${s}-${k}-${v}`, s, k, v]))(
  "test_disallowed_under_codec_context[%s]",
  (_id: string, sample: string, key: string, value: unknown) => {
    const project = parse_project_fresh(FORMAT_DIR.div(`${sample}.aep`));
    // TODO(port): `om.settings[key] = value` translated as __setitem__ (rulebook gap:
    // no rule for item assignment; same convention as test_format_options.test.ts).
    raises(ValueError, () => {
      _om(project).settings.__setitem__(key, value);
    });
  },
);

const ACCEPTS: [string, string, unknown][] = [
  ["wav/audio_codec_gsm_6.10", "Audio Sample Rate", 22050],
  ["wav/base", "Audio Sample Rate", 96000], // Uncompressed keeps the union
  ["wav/base", "Audio Bit Depth", AudioBitDepth.EIGHT_BIT],
  ["avi/video_codec_v210_10-bit_yuv", "Depth", OutputColorDepth.TRILLIONS_OF_COLORS],
  ["h.264/audio_format_pcm", "Audio Sample Rate", 96000],
  ["h.264/audio_format_mpeg", "Audio Sample Rate", 32000],
  ["mp3/base", "Audio Sample Rate", 44100],
];

// pytest ids: `f"{s}-{k}-{v}"`.
test.each(ACCEPTS.map(([s, k, v]) => [`${s}-${k}-${v}`, s, k, v]))(
  "test_allowed_under_codec_context[%s]",
  (_id: string, sample: string, key: string, value: unknown) => {
    const project = parse_project_fresh(FORMAT_DIR.div(`${sample}.aep`));
    const tmp_path = make_tmp_path();
    const om = _om(project);
    om.settings.__setitem__(key, value);
    project.save(tmp_path.div("out.aep"));
    expect(_om(parse_project_fresh(tmp_path.div("out.aep"))).settings.__getitem__(key)).toBe(value as any);
  },
);

test("test_avi_none_codec_allows_rgba", () => {
  const tmp_path = make_tmp_path();
  const project = parse_project_fresh(AVI_NONE_SAMPLE);
  const om = _om(project);
  om.settings.__setitem__("Channels", OutputChannels.RGBA);
  expect(om.settings.__getitem__("Depth")).toBe(OutputColorDepth.MILLIONS_OF_COLORS_PLUS);
  project.save(tmp_path.div("out.aep"));
  const om2 = _om(parse_project_fresh(tmp_path.div("out.aep")));
  expect(om2.settings.__getitem__("Channels")).toBe(OutputChannels.RGBA);
  expect(om2.settings.__getitem__("Depth")).toBe(OutputColorDepth.MILLIONS_OF_COLORS_PLUS);
});

/** Changing the FO bitrate narrows the rate to the new singleton. */
test("test_mp3_bitrate_change_revalidates_rate", () => {
  const project = parse_project_fresh(FORMAT_DIR.div("mp3", "base.aep"));
  const om = _om(project);
  om.format_options.bitrate = 320;
  raises(ValueError, () => {
    om.settings.__setitem__("Audio Sample Rate", 44100);
  });
  om.settings.__setitem__("Audio Sample Rate", 48000);
  expect(int(om.settings.__getitem__("Audio Sample Rate"))).toBe(48000);
});

/**
 * Mono resolves different single rates than stereo - incl. 12000 Hz,
 * which only MP3 mono at 18/20 kbps can store (AE-saved evidence).
 */
test("test_mp3_mono_rows_from_binary_evidence", () => {
  let project = parse_project_fresh(FORMAT_DIR.div("mp3", "mp3_mono_18.aep"));
  let om = _om(project);
  expect(int(om.settings.__getitem__("Audio Sample Rate"))).toBe(12000); // RATE_12000 decode
  raises(ValueError, () => {
    om.settings.__setitem__("Audio Sample Rate", 44100);
  });
  om.settings.__setitem__("Audio Sample Rate", 12000);

  project = parse_project_fresh(FORMAT_DIR.div("mp3", "mp3_mono_320.aep"));
  om = _om(project);
  raises(ValueError, () => {
    om.settings.__setitem__("Audio Sample Rate", 48000); // stereo@320, not mono@320
  });
  om.settings.__setitem__("Audio Sample Rate", 44100);
});

/**
 * AE 2026 writes noise in the depth field's upper bytes; the low
 * byte carries the real value (0xF8529Axx across the whole sweep).
 */
test("test_modern_ae_depth_low_byte_decodes", () => {
  // Python re-imports OutputColorDepth here; the module-level import above covers it.
  const cases: [string, string, number][] = [
    ["png", "png_rgba", OutputColorDepth.MILLIONS_OF_COLORS_PLUS],
    ["cineon", "dpx_rgba", OutputColorDepth.TRILLIONS_OF_COLORS_PLUS],
    ["openexr", "exr_rgba", OutputColorDepth.FLOATING_POINT_PLUS],
    ["cineon", "dpx_fido", OutputColorDepth.TRILLIONS_OF_COLORS],
  ];
  for (const [subdir, name, expected] of cases) {
    const project = parse_project_fresh(FORMAT_DIR.div(subdir, `${name}.aep`));
    const om = _om(project);
    expect([name, om.settings.__getitem__("Depth")]).toEqual([name, expected]);
    expect([name, om.validate_state()]).toEqual([name, []]);
  }
});

test("test_dnx_alpha_type_decodes", () => {
  const qt = FORMAT_DIR.div("quicktime");
  const compressed = parse_project_fresh(qt.div("Quicktime_720p-DNxHD-HQ-10-bit_Compressed.aep"));
  expect(_om(compressed).format_options.dnx_alpha_type).toBe(1);
  const none = parse_project_fresh(qt.div("Quicktime_720p-DNxHD-HQ-10-bit_None.aep"));
  expect(_om(none).format_options.dnx_alpha_type == null).toBe(true);
});
