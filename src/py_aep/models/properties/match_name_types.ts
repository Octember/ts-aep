// The model class (and value type) each well-known match name resolves to.
//
// `PropertyGroup.__getitem__` / `property()` / `add_property()` return the
// mapped type for a match-name key. A key outside the map (an index, a display
// name, an effect parameter) returns `Property | PropertyGroup` as before.
// Every entry must hold for every layer kind that has the child: a group here is
// always a group, and a property's value always has the listed type.
import type { Gradient } from "./gradient.ts";
import type { MarkerValue } from "./marker.ts";
import type { MaskPropertyGroup } from "./mask_property_group.ts";
import type { Property } from "./property.ts";
import type { PropertyGroup } from "./property_group.ts";
import type { Shape } from "./shape.ts";
import type { TextDocument } from "../text/text_document.ts";

export interface MatchNameTypes {
  // Layer top level
  "ADBE Marker": Property<MarkerValue | null>;
  "ADBE Time Remapping": Property<number>;
  "ADBE Transform Group": PropertyGroup;
  "ADBE Effect Parade": PropertyGroup;
  "ADBE Layer Styles": PropertyGroup;

  // Transform
  "ADBE Anchor Point": Property<number[]>;
  "ADBE Position": Property<number[]>;
  "ADBE Position_0": Property<number>;
  "ADBE Position_1": Property<number>;
  "ADBE Position_2": Property<number>;
  "ADBE Scale": Property<number[]>;
  "ADBE Orientation": Property<number[]>;
  "ADBE Rotate X": Property<number>;
  "ADBE Rotate Y": Property<number>;
  "ADBE Rotate Z": Property<number>;
  "ADBE Opacity": Property<number>;

  // Masks
  "ADBE Mask Parade": PropertyGroup;
  "ADBE Mask Atom": MaskPropertyGroup;
  "ADBE Mask Shape": Property<Shape>;
  "ADBE Mask Feather": Property<number[]>;
  "ADBE Mask Opacity": Property<number>;
  "ADBE Mask Offset": Property<number>;

  // Camera / light / 3D options
  "ADBE Camera Options Group": PropertyGroup;
  "ADBE Camera Zoom": Property<number>;
  "ADBE Camera Focus Distance": Property<number>;
  "ADBE Light Options Group": PropertyGroup;
  "ADBE Plane Options Group": PropertyGroup;
  "ADBE Material Options Group": PropertyGroup;

  // Text
  "ADBE Text Properties": PropertyGroup;
  "ADBE Text Document": Property<TextDocument>;
  "ADBE Text Path Options": PropertyGroup;
  "ADBE Text More Options": PropertyGroup;
  "ADBE Text Animators": PropertyGroup;
  "ADBE Text Animator": PropertyGroup;
  "ADBE Text Animator Properties": PropertyGroup;
  "ADBE Text Selectors": PropertyGroup;

  // Shape layer contents
  "ADBE Root Vectors Group": PropertyGroup;
  "ADBE Vectors Group": PropertyGroup;
  "ADBE Vector Group": PropertyGroup;
  "ADBE Vector Transform Group": PropertyGroup;
  "ADBE Vector Shape - Group": PropertyGroup;
  "ADBE Vector Shape": Property<Shape>;
  "ADBE Vector Graphic - Fill": PropertyGroup;
  "ADBE Vector Graphic - Stroke": PropertyGroup;
  "ADBE Vector Graphic - G-Fill": PropertyGroup;
  "ADBE Vector Graphic - G-Stroke": PropertyGroup;
  "ADBE Vector Grad Colors": Property<Gradient>;
}
