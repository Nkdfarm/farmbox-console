// ════════════════════════════════════════════════════════════════════════
// The kinds of IPM product (console 0.7.288, migration 0267, owner 29 Oct 2026: the ten kinds; "biopesticide" became
// the filter group Low-residue). The same list as app.product_kinds(), in the same order; the groups as
// app.low_residue_kinds(). Products, a product's drawer and a product of our own all read it from here.
// ════════════════════════════════════════════════════════════════════════
export const KIND = {
  chemical: 'Chemical', mineral: 'Mineral', physical: 'Physical', botanical: 'Botanical', microbial: 'Microbial',
  beneficial: 'Beneficial', elicitor: 'Elicitor', semiochemical: 'Semiochemical', monitoring: 'Monitoring', adjuvant: 'Adjuvant',
};
// a line each, for the kind select's title
export const KIND_HINT = {
  chemical: 'a synthetic active (abamectin, azoxystrobin)', mineral: 'an inorganic active (sulphur, kaolin, potassium bicarbonate)',
  physical: 'a soap or oil that acts by contact', botanical: 'a plant extract (neem)', microbial: 'bacteria, fungi, viruses (Bt, Trichoderma)',
  beneficial: 'living insects, mites, nematodes released', elicitor: 'a plant-defence activator (COS-OGA, Bion)',
  semiochemical: 'a pheromone, kairomone or lure', monitoring: 'a trap or card with no active', adjuvant: 'a wetter, sticker, or a feed for beneficials',
};
export const GROUPS = { low_residue: { label: 'Low-residue (group)', kinds: ['mineral', 'physical', 'botanical', 'microbial', 'elicitor', 'semiochemical'] } };
// the kinds a side effect on beneficials belongs to: what goes on in water (app.spray_kinds)
export const SPRAY = ['chemical', 'mineral', 'physical', 'botanical', 'microbial', 'elicitor', 'adjuvant'];
export const kindOk = (want, kind) => !want || (GROUPS[want] ? GROUPS[want].kinds.includes(kind) : kind === want);
