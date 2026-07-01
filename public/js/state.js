// state.js — shared mutable state container.
// ES modules export live bindings but importers cannot reassign them, so the ~20
// primitives that used to be flat script globals live as properties on one object
// instead. Each owning module below initializes its own slice at load time.
export const S = {};

export const $ = id => document.getElementById(id);
