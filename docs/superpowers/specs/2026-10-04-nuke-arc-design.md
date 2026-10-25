# Nuclear arc choices

First delivery increment: centralize chooseNukeArc with nuke-arc decisions.
Preserve lazy up/down simulation and optional upgrade-margin pass before normal
SAM levels. Down is offered only with rotation setting and supported build UI.
The baseline chooses up first and stops on the first clear trajectory. All
intercepted probes retain the original intercepted/up/unsafe result.

Wait/error/stale results explicitly stop callers instead of looking like an
intercepted trajectory: abort sampling, salvo site fallthrough, SAM scans and
helpful-silo scans. Pass explicit decision parents from selected sites/SAMs and
upgrade requests into nested planning. Do not introduce shared async scopes.
Flight/interception simulation stays original. Salvo count/order/delay and full
player-to-delivery ancestry remain later increments. Preserve original successful
return shapes and getter order, with meaningful generated parity and hold tests.
