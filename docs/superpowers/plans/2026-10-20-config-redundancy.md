# Remove redundant Config controls

User explicitly requested removing the extra warship switch and every redundant
control rather than moving them to Advanced. Keep one action permission per
feature and the building allow-list. Remove all 26 internal strategy on/off
controls; run their existing recommended defaults automatically. Ignore legacy
saved overrides for those removed flags while retaining action permissions,
building choices, numeric tuning and panel preferences. Rename the warship
master to Warship automation. Advanced contains numeric tuning only.

Use build-time template transformation and loader whitelist migration. Do not
edit the immutable vendor. Tests cover absent duplicate bindings, conserved
numeric controls, saved-setting migration and master-off warship gates. Build,
full suite, strategy comparison, syntax and final freshness check.
