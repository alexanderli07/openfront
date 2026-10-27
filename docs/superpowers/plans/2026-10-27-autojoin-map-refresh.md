# Auto-Join map compatibility

Verified against OpenFront release v0.35.5: the bundled95-map picker is missing40 maps. Canonical lobby identity remains gameConfig.gameMap. Rotation weights are now controlled by a server API and cannot be inferred reliably from the old static weights.

Refresh a checked-in catalog from the official generated registry and English labels, preserving all old folder IDs and existing settings. Include aliases for wire and enum names. Guard catalog replacement in the builder; never mutate the immutable vendor bundle. Prefer authoritative wire identity over arbitrary map metadata. With map filters active, hold lobbies without a usable map identity.

Forecasts remain advisory: remove obsolete zero-weight/exclusion assumptions and use equal-map priors plus the existing observed-match history. Expose the assumption in the forecast tooltip. Use registry preferred team counts. Tests execute shipped catalog/settings/matching to cover135 maps, saved selections, precedence, missing identity, new wire names and estimates. Rebuild, run full tests, version and publish.
