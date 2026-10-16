/** Command-line interface tools for py_aep. */

// TODO(port): Python's `from py_aep.cli import *` imports the submodules named
// here (compare, inspect, validate, visualize) when they are not attributes yet.
// This module imports none of them, so the names are exported as data only; a
// star import in TS will not load those submodules.
export const __all__ = ["compare", "inspect", "validate", "visualize"] as const;
