# Home ports and nuke evasion

Continue the authorized migration without changing gameplay weights. Expose
warship-home and warship-home-tile choices with original own/same-team active
port filters, distance from the first active ship, first ties, first water neighbor
and dry-port fallback. A policy hold ends the combat pass; no eligible ports still
allows the original combat pass with null home.

Expose warship-nuke-dodge per endangered ship, warship-nuke-threat (nearest zone)
and warship-nuke-escape (configured angular/ring samples). Preserve radius/ETA
measurement, sampling order, max ETA then minimum travel distance ranking and first
ties. Keep existing no-threat, improved ETA and already-safer patrol gates, ctor,
emit, cooldown and label behavior. Final command holds/errors skip cooldown/label;
actual failed emits keep baseline bookkeeping. Holds stop only that ship's action.
No new connected-water gate or alternative escape algorithm is added.

Bound candidate lists to 79 plus wait and always retain the original winner.
Trace home -> water tile -> combat -> destination -> command, and dodge -> threat
-> escape -> command. Scopes are synchronous, restored on errors; telemetry-only
getters must not change original actions. Keep original threat tracking and nuke
timing helpers. Validate actual original/generated parity and custom holds, errors,
alternative selections, trace ancestry/replay and full build/test checks.
