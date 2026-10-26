# Safer team spawning

User requested a larger enemy-distance preference because the bot repeatedly spawns too close on connected maps. Keep the central team candidate policy and legal eligibility checks. Prefer a240tile enemy buffer using a tapered proximity penalty (maximum180), and increase the distance reward from30capped at200 to60capped at400. Open-space, water, ally and edge terms stay unchanged. Preserve companion override and other game-mode behavior.

The preference remains soft so dense maps do not become unspawnable. Only known spawned opponent centers can influence distance. Test safer inland versus near-enemy roomy coast, rewards beyond200 and legal close-site choice when no distant option exists. Live spawn quality remains to be tested.
