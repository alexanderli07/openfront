# Local team piracy

User refinement: prefer substantial enemy trade near our team; do not sail across the map into enemy territory. Replace the earlier soft distance penalty / durable-post distance exemption with hard locality for all piracy assignment and replacement paths.

Require team support within160Manhattan tiles, trip from current ship or selected own launch port at most240tiles, and at least3eligible enemy trades in the observed area. Team support uses active owned/same-team ports on matching water or bounded radial measurements of owned/same-team land. Reject enemy coastline within100tiles when team support is not at least24tiles closer. Same-team support is separate from merely allied third parties. Open-water clearance, safety interrupts,30second traffic reviews and reserve checks remain.

Refresh team/enemy support facts by game tick; retained and vacant posts must revalidate locality immediately, even before their traffic-review deadline. Invalid remote vacancies cannot freeze other deployment or keep requesting replacement ships. Reuse only ships actually within the trip limit. A warship outside supported waters may return to safe same-component friendly port water; that withdrawal is distinct from a piracy assignment and may be longer.

Validation: remote high density loses to local traffic, minimum traffic, teammate support, hostile coast, captured support, retained/vacant remote posts, replacement launch distance, idle-ship reuse, return-to-team, safety/command gates, full suite and release checks. Constants are initial conservative heuristics; native routing may still traverse narrow channels.

Implementation detail: enforce a bounded direct-water corridor with team support checks every16steps, including endpoints. This conservatively rejects potential long detours without claiming to dictate the native path. Vacancies are filtered by source route before overriding ordinary candidates. Observer-only small-scale tests explicitly lower the trade count; production-default tests verify the3ship threshold.

## User override: remove the trip cap
User requested removal of the separate240tile limit. Team support within160remains the controlling locality rule. Remove the cap from every assignment/reuse/replacement path, and keep distance ranking positive so it does not become a hidden cap. Bound route computation to512coordinate probes without rejecting longer routes merely for length. A3000tile supported-route regression covers initial assignment, retention and replacement launch.
