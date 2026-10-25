# Attack planning implementation plan

1. Test and implement pure candidate generation and selection in src/brain/attack-planner.js for incoming, traitor, victim, weak, disconnected, hostile and weakest modes.
2. Test and implement lazy purpose execution with preflight and normal ordering, preserving reserve/random/counter gates and send flags.
3. Add runtime planAttacks/selectAttackTarget adapters with scoped parent restoration and new legacy strategy domains. Link nested decisions through snapshots and command proposals.
4. Patch only pinned attackBestTarget/getAttackStrategies and three target helpers plus incoming lookup. Keep counterReady and sendAttack intact. Build 1.84.4.
5. Extend actual class parity across target rules and difficulty/counter paths. Review, fix findings, document exact completed scope and verify full suite/build.

User authorized both next migrations. No new dependency, economic weight or additional approval checkpoint is needed.
