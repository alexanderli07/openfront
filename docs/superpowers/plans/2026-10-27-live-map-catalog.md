# Live map catalog

Keep the135 bundled maps as seeds. Extend a stable catalog and stable shared ID array from native ASSET_MANIFEST/BOOTSTRAP_CONFIG assets and authoritative live lobby gameMap values. Poll assets every5seconds outside live games, cache validated maps locally, preserve old IDs/selections, and leave newly discovered maps unselected.

For new asset IDs, resolve public manifest names on the native asset origin, omitting credentials and redirects. Bound concurrent reads to2, timeout to5seconds, metadata to2MB, attempts to2 per map per page and the catalog to512 entries. Failing storage/network reads leave discovery from available data functional. Existing maps/aliases remain for saved filters even when absent from a later rotation. Native metadata can refresh discovered labels and preferred team counts.

Settings, matching, forecast and picker share arrays. Refresh an open picker and invalidate model estimates when discoveries change the catalog. Test late bootstrap, lobby-only discovery, shared IDs, saved settings, reload cache, duplicate events, malformed data, metadata origin and bounded retries. Build/version/publish with offline regression checks; live discovery remains a separate browser validation.
