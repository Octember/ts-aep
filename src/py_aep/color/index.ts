/**
 * Color-management helpers: profile-envelope codec, ICC discovery, OCIO config.
 *
 * Pure leaf package (depends only on `enums/`, stdlib, and `yaml`); imported by
 * `models/` for reading and writing AE color-management settings.
 */

// The Python __init__.py has no code and no __all__, so nothing is re-exported.
// This keeps the file a module under isolatedModules.
export {};
