# Nuclear delivery ancestry

Preserve public player, weapon, arc and salvo return shapes. Capture player and
weapon decision IDs in per-invocation output objects in the generated ordinary
nuke method; pass IDs explicitly across every await. Scoped synchronous target
lookups capture nested ranking/attacker IDs and reset afterward.

Keep provenance for arc/salvo result objects in a runtime WeakMap keyed by the
actual result, not player, actor or tile. Arc site candidates carry their source
ID. The selected player parents weapon, then sampled arc and site decisions.
Sites and sampled arcs are siblings under weapon because site policy can choose
any candidate; a strike-link record identifies the selected site's arc source.
Site -> approved schedule -> action -> launch command forms the delivery chain.
SAM salvos launch under the final
schedule chunk; helpful upgrades retain their request/silo parents. Failed plans
and empty searches cannot leak earlier provenance. MIRV purpose -> ranked player
-> launch gains the same explicit child ID. No async active-parent scope added.

Test end-to-end direct/salvo/SAM and MIRV ancestry, replay, same actor overlapping
calls sharing player/tile, scope reset, unchanged return shapes and baseline
parity. This increment changes trace ownership, not launch ordering or weights.
