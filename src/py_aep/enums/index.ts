/**
 * After Effects enumerations.
 *
 * These enums match the values used in After Effects ExtendScript.
 *
 * Submodules:
 * - [general][py_aep.enums.general]: Core layer, footage, project, viewer
 *   and mask enums.
 * - [property][py_aep.enums.property]: Property system enums
 *   (control type, value type, keyframe interpolation).
 * - [renderer_options][py_aep.enums.renderer_options]: 3D renderer option enums
 *   (shadow map resolution, environment light shadow resolution).
 * - [render_settings][py_aep.enums.render_settings]: Render settings enums
 *   (quality, field render, motion blur, effects, etc.).
 * - [render_queue][py_aep.enums.render_queue]: Render queue item enums
 *   (status, log type, settings format).
 * - [output_module][py_aep.enums.output_module]: Output module enums
 *   (channels, depth, color mode, format, audio settings, post-render action).
 * - [format_options][py_aep.enums.format_options]: Format-specific option
 *   enums (Cineon, JPEG, PNG, OpenEXR, audio/video codecs).
 * - [text_document][py_aep.enums.text_document]: Text document enums
 *   (justification, baseline, kerning, font caps, etc.).
 * - [font_object][py_aep.enums.font_object]: Font object enums
 *   (technology, type, script).
 */

// font_object
export { CTFontTechnology, CTFontType, CTScript } from "./font_object.ts";

// format_options
export {
  AudioCodec,
  AudioInterleave,
  CineonFileFormat,
  DnxResolution,
  Hdr10ColorPrimaries,
  JpegFormatType,
  MPEGAudioFormat,
  MPEGAudioLayer,
  MPEGMultiplexer,
  MPEGMuxStreamCompatibility,
  MPEGProfile,
  OpenExrCompression,
  PngCompression,
  VideoCodec,
} from "./format_options.ts";

// general
export {
  AlphaMode,
  AutoOrientType,
  BitsPerChannel,
  BlendingMode,
  ChannelType,
  CloseOptions,
  ColorManagementSystem,
  FastPreviewType,
  FeetFramesFilmType,
  FieldSeparationType,
  FillLightingCorrectionType,
  FillMethodType,
  FillOutputDepthType,
  FillRangeType,
  FootageTimecodeDisplayStartType,
  FrameBlendingType,
  FramesCountType,
  GpuAccelType,
  GuideOrientationType,
  ImportAsType,
  ItemType,
  Label,
  Language,
  LayerQuality,
  LayerSamplingQuality,
  LayerType,
  LightType,
  LinearLightMode,
  LoopMode,
  LutInterpolationMethod,
  MaskFeatherFalloff,
  MaskMode,
  MaskMotionBlur,
  ParametricMeshType,
  PlayMode,
  PREFType,
  ProjectThread,
  PropertyType,
  PulldownMethod,
  PulldownPhase,
  PurgeTarget,
  ResolveType,
  TimeDisplayType,
  ToolType,
  TrackMatteType,
  ViewerType,
} from "./general.ts";

// output_module
export {
  AudioBitDepth,
  AudioChannels,
  AudioSampleRate,
  ConvertToLinearLight,
  FormatKind,
  OutputAudio,
  OutputChannels,
  OutputColorDepth,
  OutputColorMode,
  OutputFormat,
  PostRenderAction,
  ResizeQuality,
} from "./output_module.ts";

// property
export { KeyframeInterpolationType, PropertyControlType, PropertyValueType } from "./property.ts";

// render_queue
export { GetSettingsFormat, LogType, RQItemStatus } from "./render_queue.ts";

// render_settings
export {
  ColorDepthSetting,
  DiskCacheSetting,
  EffectsSetting,
  FieldRender,
  FrameBlendingSetting,
  FrameRateSetting,
  GuideLayers,
  MotionBlurSetting,
  PostRenderActionSetting,
  ProxyUseSetting,
  PulldownSetting,
  RenderQuality,
  SoloSwitchesSetting,
  TimeSpanSource,
} from "./render_settings.ts";

// renderer_options
export { EnvironmentLightShadowResolution, ShadowMapResolution } from "./renderer_options.ts";

// text_document
export {
  AutoKernType,
  BaselineDirection,
  BoxAutoFitPolicy,
  BoxFirstBaselineAlignment,
  BoxVerticalAlignment,
  ComposerEngine,
  DigitSet,
  FontBaselineOption,
  FontCapsOption,
  LeadingType,
  LineJoinType,
  LineOrientation,
  ParagraphDirection,
  ParagraphJustification,
  VariableFontSpacing,
} from "./text_document.ts";
