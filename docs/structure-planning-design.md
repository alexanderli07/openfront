# Central structure planning

The authorized next step is comparative planning behind the central decider. Migrate normal structure selection first; attacks, naval actions and nuclear strikes still use sequential command proposals. Avoid changing economic weights during this architectural migration.

Prefer a batch of explicit structure plans over buffering existing dispatches: legacy methods change state and return early, so buffering their commands would not discover alternatives safely. A simultaneous rewrite of every behavior is larger than necessary. Each plan describes a structure type to attempt, not an already validated build quote or guaranteed investment.

Keep the original preparation (water connectivity, dominance, city equivalent), outer cooldown/defense handling, and placement/upgrade executors. Generate ordered plans for the original first-placement SAM exception, high-density economic exception, normal port/factory/SAM/silo candidates, and city fallback. Preserve duplicate type attempts when separate original branches attempted the same type. Include disabled/ineligible candidates with concrete exclusion reasons. Priorities describe original ordering, not estimated economic value.

The pure legacy strategy chooses the eligible plan with the lowest ordinal priority; waiting is explicit. The runtime invokes only that plan's existing maybeSpawnStructure method. A false result removes that plan, refreshes remaining eligibility and reruns selection. Excluded earlier stages already passed are not revisited; the normal structure order is fixed once entered, matching the original walk. A deliberate wait stops the plan loop. Actual outbound commands still pass through the central command boundary. Record plan results separately from dispatch results and link the selected plan decision to its command proposal.

Validate current ownership/enabled state before choices and stop retries after an asynchronous attempt if ownership changes. The existing public predicate remains as provided; the pasted baseline implements isPublicLobby as constant false, so it does not enforce lobby restrictions. Do not claim otherwise.

Trace inputs include the structure context and all candidate eligibility/reasons. Existing rules and state snapshots remain bounded. Future policies can rank these candidates without editing placement code. This does not yet jointly allocate gold between structures and strikes, estimate returns, or compare individual placement sites.

Validation: pure eligibility/ranking fixtures, alternative-policy and wait tests, retry/exception/stale-owner tests, original-vs-new behavior comparison across coastline, disabled types, SAM priority, first-placement/high-density exceptions and fallback; full regression, deterministic build and syntax checks. No live-game strength claim.
