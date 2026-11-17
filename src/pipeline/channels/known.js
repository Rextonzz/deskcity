// The channel modules channels/index.js has loaded, by file name. A leaf: the helpers the channel modules themselves
// import (schedule.js, captions.js, ...) can ask a channel's module for a setting through this without importing
// index.js, which would load the channel modules inside their own imports. Empty until index.js has loaded (the worker
// and the pipeline routes load it at start).
export const loaded = Object.create(null);
// A value a channel's module exports (e.g. perDayDefault), or undefined. `name` is the module's file name, which is
// the channel's id unless its config names another module.
export const fromModule = (name, key) => (name == null ? undefined : loaded[String(name)]?.[key]);
