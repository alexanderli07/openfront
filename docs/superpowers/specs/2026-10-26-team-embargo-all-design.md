# Team embargo all

Approved scope: replace adaptive team auto-embargo with the native stop-trading-with-all-enemies action. Preserve the feature switch, central decisions, public-lobby gate, and FFA/legacy behavior. Native semantics exclude self, Bots, teammates and allies.

Discover the native one-argument action event by shape, then submit through the existing runtime command gateway. Scan for live eligible players lacking an embargo; if none, do nothing. Retry unconfirmed submissions on a bounded game-tick cooldown, never marking server state locally. Missing constructors throw an explicit error. Re-evaluate after alliance changes. Do not issue individual stop commands in this mode.

Trade capture remains subject to native rules: safe ships and ships destined for our/friendly ports are excluded. This change does not bypass these restrictions.

Validation: constructor ambiguity/cache refresh, native eligibility, repeat suppression, retry, policy hold, failed emit, feature/dispatch gates, and retained individual FFA behavior.
