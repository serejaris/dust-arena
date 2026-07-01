// state.js — shared mutable state container.
// ES modules export live bindings but importers cannot reassign them, so the ~20
// primitives that used to be flat script globals live as properties on one object
// instead. Each owning module below initializes its own slice at load time.
export const S = {};
S.myArmor = 0;    // armor pickup HUD/absorb state — server-authoritative, synced via armorpk/hp/states
S.boostUntil = 0; // Date.now()+serverOffset domain — client-applied speed buff window from boostpk

export const $ = id => document.getElementById(id);
