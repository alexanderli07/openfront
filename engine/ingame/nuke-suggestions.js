// Hover-target nuke strike suggestions for atom and hydrogen bombs.

  const NUKE_SUGGESTION_TYPES = [
    {
      id: "atom",
      type: "Atom Bomb",
      label: "Atom",
      color: "rgba(250, 204, 21, 0.95)",
      fill: "rgba(250, 204, 21, 0.16)",
      glow: "rgba(250, 204, 21, 0.36)",
      maxRawSeeds: 72,
      maxRefineSeeds: 10,
    },
    {
      id: "hydrogen",
      type: "Hydrogen Bomb",
      label: "Hydrogen",
      color: "rgba(34, 211, 238, 0.95)",
      fill: "rgba(34, 211, 238, 0.13)",
      glow: "rgba(34, 211, 238, 0.36)",
      maxRawSeeds: 58,
      maxRefineSeeds: 8,
    },
  ];
  const NUKE_ECONOMIC_SUGGESTION = {
    id: "economic",
    label: "Economy",
    color: "rgba(74, 222, 128, 0.95)",
    fill: "rgba(74, 222, 128, 0.14)",
    glow: "rgba(74, 222, 128, 0.36)",
    maxRawSeeds: 64,
    maxRefineSeeds: 8,
  };
  const NUKE_ECONOMIC_HYDROGEN_MIN_GAIN = 500000;
  const NUKE_ECONOMIC_HYDROGEN_GAIN_RATIO = 1.2;
  const NUKE_SUGGESTION_FALLBACK_COSTS = {
    "Atom Bomb": 750000,
    "Hydrogen Bomb": 5000000,
  };
  const AUTO_NUKE_ACTION_COOLDOWN_MS = 600;
  const AUTO_NUKE_PATCH_RETRY_MS = 700;
  const AUTO_NUKE_MENU_ITEM_PREFIX = "openfront-helper-auto-nuke";
  const AUTO_NUKE_CONTEXT_MENU_ID = "openfront-helper-auto-nuke-menu";
  const AUTO_NUKE_CONTEXT_MENU_STYLE_ID = "openfront-helper-auto-nuke-menu-styles";
  const AUTO_NUKE_PROCESS_PANEL_ID = "openfront-helper-auto-nuke-process";
  const AUTO_NUKE_PROCESS_PANEL_STYLE_ID = "openfront-helper-auto-nuke-process-styles";
  const AUTO_NUKE_SEQUENCE_DELAY_MS = 60;
  const AUTO_NUKE_FALLBACK_LANDING_MS = 60000;
  const AUTO_NUKE_PROCESS_COMPLETE_HIDE_MS = 3500;
  const AUTO_NUKE_GAME_TICK_MS = 100;
  const AUTO_NUKE_MAX_SAM_BURN_SHOTS_PER_STACK = 160;
  const AUTO_NUKE_SAM_STACK_SAFETY_BURN_PER_EXTRA_LEVEL = 1;
  // Fraction of the stack's total level sum added as safety burns. Scales with stack
  // weight so single-unit high-level stacks (e.g. one level-5 SAM) still get enough
  // overshoot, and heavy multi-stacks (level sum 15+) get proportionally more.
  const AUTO_NUKE_SAM_STACK_SAFETY_BURN_LEVEL_FRACTION = 0.35;
  const AUTO_NUKE_SAM_STACK_SAFETY_BURN_CAP = 10;
  const AUTO_NUKE_SECOND_PASS_POLL_MS = 1000;
  const AUTO_NUKE_SECOND_PASS_MAX_WAIT_MS = 8 * 60 * 1000;
  const AUTO_NUKE_SECOND_PASS_READY_SLOT_FRACTION = 0.6;
  const AUTO_NUKE_SECOND_PASS_SPREAD_MULTIPLIER = 1.65;
  const AUTO_NUKE_THIRD_PASS_READY_SLOT_FRACTION = 0.7;
  const AUTO_NUKE_THIRD_PASS_SPREAD_MULTIPLIER = 2.25;
  const AUTO_NUKE_SECOND_PASS_LAUNCH_SLOT_FRACTION = 0.58;
  const AUTO_NUKE_MAX_SAM_CLEAR_WAVES = 10;
  const AUTO_NUKE_MAX_FOLLOWUP_WAVES = 4;
  const AUTO_NUKE_MAX_DESTRUCTION_WAVES = 60;
  const AUTO_NUKE_FOLLOWUP_SPREAD_MULTIPLIER = 1.5;
  const AUTO_NUKE_BLOCKING_STACK_BASE_CAPACITY = 10;
  const AUTO_NUKE_BLOCKING_STACK_SCORE_FRACTION = 0.55;
  const AUTO_NUKE_MAX_PREEMPTIVE_SAM_WAVES = 4;
  const AUTO_NUKE_MAX_CANDIDATES_PER_SPEC = 28;
  const AUTO_NUKE_MIN_MARGINAL_SCORE = 1;
  const AUTO_NUKE_DESTRUCTION_BUILDING_BONUS = 2500000;
  const AUTO_NUKE_DESTRUCTION_CONFIRMATION_SHOTS = 2;
  const AUTO_NUKE_DESTRUCTION_SAM_BONUS = 3500000;
  // Base number of insurance overshoot shots added AFTER the main SAM-clear shot.
  // Helps ensure the stack is destroyed even if a SAM is upgraded or rebuilt mid-flight.
  const AUTO_NUKE_DESTRUCTION_SAM_OVERSHOOT_SHOTS = 2;
  // Hard cap on overshoot shots per stack (after scaling by stack depth).
  const AUTO_NUKE_MAX_SAM_OVERSHOOT_SHOTS = 5;
  // SAM launcher construction takes ~30 seconds (300 ticks). Upgrades (stacking onto
  // an existing stack) are instant — they just bump the unit's level. We anticipate
  // both cases so planned waves don't get shot down by SAMs that come online mid-attack.
  const AUTO_NUKE_SAM_CONSTRUCTION_TICKS = 300;
  // Safety buffer: assume each already-built enemy stack could gain +1 slot via an
  // instant upgrade during our nuke flight. Used only when estimating blocking stacks.
  const AUTO_NUKE_SAM_UPGRADE_BUFFER = 1;
  const AUTO_NUKE_INTENSITY_TIERS = [
    {
      id: "low",
      label: "Low",
      minShots: 1,
      shotFraction: 0.25,
    },
    {
      id: "medium",
      label: "Medium",
      minShots: 2,
      shotFraction: 0.55,
    },
    {
      id: "high",
      label: "High",
      minShots: 3,
      shotFraction: 1,
    },
  ];
  const AUTO_NUKE_TIER_ORDER = new Map(
    AUTO_NUKE_INTENSITY_TIERS.map((tier, index) => [tier.id, index]),
  );

  const NUKE_SUGGESTION_STRUCTURE_TYPES = [
    "City",
    "Defense Post",
    "SAM Launcher",
    "Missile Silo",
    "Port",
    "Factory",
  ];
  const NUKE_SUGGESTION_BUCKET_SIZE = 16;
  const NUKE_SUGGESTION_SAMPLE_LIMIT = 80;
  const NUKE_SUGGESTION_MAX_FINAL_CANDIDATES = 40;
  const NUKE_SUGGESTION_TILE_INFO_CACHE_MS = 2500;
  const NUKE_SUGGESTION_SIGNATURE_CHECK_MS = 250;
  let nukeSuggestionTileInfoCache = null;
  let nukeSuggestionDomCache = new Map();
  let lastAutoNukeActionAt = 0;
  let autoNukeIncludeAllies = false;
  let autoNukeContextMenuInstalled = false;
  let autoNukeContextMenuParams = null;
  let autoNukeContextMenuComputeId = 0;
  let autoNukeProcessHideTimeout = null;
  let autoNukeWaveLog = [];
  let nextNukeSuggestionUnitObjectId = 1;
  const nukeSuggestionUnitObjectIds = new WeakMap();
  // Tracks when each enemy SAM Launcher was first observed under construction, so we
  // can bound the worst-case completion tick monotonically across polls.
  const nukeSuggestionPendingSamFirstSeen = new Map();

  function ensureNukeSuggestionStyles() {
    if (document.getElementById(NUKE_SUGGESTION_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = NUKE_SUGGESTION_STYLE_ID;
    style.textContent = `
      #${NUKE_SUGGESTION_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        z-index: 8000;
        pointer-events: none;
      }

      #${NUKE_SUGGESTION_CONTAINER_ID} .openfront-helper-nuke-suggestion-zone {
        position: fixed;
        left: var(--suggestion-x);
        top: var(--suggestion-y);
        width: var(--suggestion-diameter);
        height: var(--suggestion-diameter);
        border: 2px dashed var(--suggestion-color);
        border-radius: 50%;
        background: var(--suggestion-fill);
        box-shadow:
          0 0 18px var(--suggestion-glow),
          inset 0 0 24px var(--suggestion-fill);
        transform: translate(-50%, -50%);
      }

      #${NUKE_SUGGESTION_CONTAINER_ID} .openfront-helper-nuke-suggestion-zone[data-suggestion-status="blocked"] {
        opacity: 0.62;
        border-style: dotted;
      }

      #${NUKE_SUGGESTION_CONTAINER_ID} .openfront-helper-nuke-suggestion-zone::before,
      #${NUKE_SUGGESTION_CONTAINER_ID} .openfront-helper-nuke-suggestion-zone::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        background: var(--suggestion-color);
        box-shadow: 0 0 10px var(--suggestion-glow);
        transform: translate(-50%, -50%);
      }

      #${NUKE_SUGGESTION_CONTAINER_ID} .openfront-helper-nuke-suggestion-zone::before {
        width: 28px;
        height: 2px;
      }

      #${NUKE_SUGGESTION_CONTAINER_ID} .openfront-helper-nuke-suggestion-zone::after {
        width: 2px;
        height: 28px;
      }

      #${NUKE_SUGGESTION_CONTAINER_ID} .openfront-helper-nuke-suggestion-label {
        position: fixed;
        left: var(--suggestion-x);
        top: calc(var(--suggestion-y) - var(--suggestion-radius) - var(--suggestion-label-gap));
        padding: 4px 8px;
        border: 1px solid var(--suggestion-color);
        border-radius: 8px;
        background: rgba(7, 12, 18, 0.86);
        color: var(--suggestion-color);
        font: 900 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.92);
        transform: translate(-50%, -100%);
        white-space: nowrap;
      }

      #${NUKE_SUGGESTION_CONTAINER_ID} .openfront-helper-nuke-suggestion-label[data-suggestion-status="blocked"] {
        opacity: 0.72;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureNukeSuggestionContainer() {
    ensureNukeSuggestionStyles();

    let container = document.getElementById(NUKE_SUGGESTION_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = NUKE_SUGGESTION_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function getNukeSuggestionMagnitude(game, unitType) {
    try {
      const magnitude = game?.config?.().nukeMagnitudes?.(unitType);
      const inner = Number(magnitude?.inner);
      const outer = Number(magnitude?.outer);
      if (Number.isFinite(inner) && Number.isFinite(outer) && outer > 0) {
        return {
          inner: Math.max(0, inner),
          outer,
        };
      }
    } catch (_error) {
      // Fall back to OpenFront defaults.
    }

    return unitType === "Hydrogen Bomb"
      ? { inner: 80, outer: 100 }
      : { inner: 12, outer: 30 };
  }

  function isNukeSuggestionTypeEnabled(game, unitType) {
    try {
      return !game?.config?.().isUnitDisabled?.(unitType);
    } catch (_error) {
      return true;
    }
  }

  function getNukeSuggestionUnitCost(game, player, unitType) {
    try {
      const cost = game?.unitInfo?.(unitType)?.cost?.(game, player);
      const numericCost = typeof cost === "bigint" ? Number(cost) : Number(cost);
      if (Number.isFinite(numericCost) && numericCost >= 0) {
        return numericCost;
      }
    } catch (_error) {
      // PlayerView does not expose every server-side cost helper dependency.
    }

    try {
      const cost = game?.config?.().unitInfo?.(unitType)?.cost?.(game, player);
      const numericCost = typeof cost === "bigint" ? Number(cost) : Number(cost);
      if (Number.isFinite(numericCost) && numericCost >= 0) {
        return numericCost;
      }
    } catch (_error) {
      // Fall back to OpenFront defaults.
    }

    return NUKE_SUGGESTION_FALLBACK_COSTS[unitType] ?? Infinity;
  }

  function isHydrogenCheaperThanFiveAtomNukes(game, player) {
    const atomCost = getNukeSuggestionUnitCost(game, player, "Atom Bomb");
    const hydrogenCost = getNukeSuggestionUnitCost(game, player, "Hydrogen Bomb");
    return hydrogenCost < atomCost * 5;
  }

  function shouldComputeNukeSuggestionSpec(game, player, spec) {
    if (!spec || !isNukeSuggestionTypeEnabled(game, spec.type)) {
      return false;
    }
    if (spec.type !== "Hydrogen Bomb") {
      return true;
    }
    return isHydrogenCheaperThanFiveAtomNukes(game, player);
  }

  function getNukeSuggestionScreenRadius(transform, screenPos, worldRadius) {
    const scale = Number(transform?.scale);
    if (Number.isFinite(scale) && scale > 0) {
      return worldRadius * scale;
    }

    try {
      const reference = transform.worldToScreenCoordinates({
        x: screenPos.worldX + worldRadius,
        y: screenPos.worldY,
      });
      return Math.hypot(reference.x - screenPos.x, reference.y - screenPos.y);
    } catch (_error) {
      return worldRadius;
    }
  }

  function getUnitTile(unit) {
    try {
      const tile = Number(unit?.tile?.());
      return Number.isFinite(tile) ? tile : null;
    } catch (_error) {
      return null;
    }
  }

  function getUnitType(unit) {
    try {
      return String(unit?.type?.() ?? unit?.data?.unitType ?? "");
    } catch (_error) {
      return "";
    }
  }

  function getUnitKey(unit) {
    try {
      const id = unit?.id?.();
      if (id !== undefined && id !== null) {
        return String(id);
      }
    } catch (_error) {
      // Fall back to the tile below.
    }

    if (unit && (typeof unit === "object" || typeof unit === "function")) {
      let objectId = nukeSuggestionUnitObjectIds.get(unit);
      if (!objectId) {
        objectId = nextNukeSuggestionUnitObjectId++;
        nukeSuggestionUnitObjectIds.set(unit, objectId);
      }
      return `object:${objectId}`;
    }

    const tile = getUnitTile(unit);
    return tile === null ? "" : `tile:${tile}`;
  }

  function getMissileTimerQueue(unit) {
    try {
      const queue = unit?.missileTimerQueue?.();
      if (Array.isArray(queue)) {
        return queue;
      }
    } catch (_error) {
      // Fall back to the UnitView data shape.
    }

    return Array.isArray(unit?.data?.missileTimerQueue)
      ? unit.data.missileTimerQueue
      : [];
  }

  function isActiveFinishedUnit(unit) {
    try {
      return Boolean(unit?.isActive?.()) && !unit?.isUnderConstruction?.();
    } catch (_error) {
      return false;
    }
  }

  function isActiveUnderConstructionUnit(unit) {
    try {
      return Boolean(unit?.isActive?.()) && Boolean(unit?.isUnderConstruction?.());
    } catch (_error) {
      return false;
    }
  }

  // Estimate the worst-case tick at which a currently-under-construction SAM will
  // come online. We don't have access to the exact remaining construction ticks,
  // so we record the earliest tick we spotted it and assume it could take up to
  // AUTO_NUKE_SAM_CONSTRUCTION_TICKS from that first sighting to finish.
  function getPendingSamExpectedReadyTick(game, sam, currentTick) {
    const key = getUnitKey(sam);
    const now = Number.isFinite(currentTick) ? currentTick : getCurrentGameTick(game);
    if (!key) {
      return now + AUTO_NUKE_SAM_CONSTRUCTION_TICKS;
    }
    let firstSeen = nukeSuggestionPendingSamFirstSeen.get(key);
    if (!Number.isFinite(firstSeen)) {
      firstSeen = now;
      nukeSuggestionPendingSamFirstSeen.set(key, firstSeen);
    }
    return firstSeen + AUTO_NUKE_SAM_CONSTRUCTION_TICKS;
  }

  function pruneFinishedPendingSamTracker(activeUnitKeys) {
    if (nukeSuggestionPendingSamFirstSeen.size === 0) return;
    for (const key of Array.from(nukeSuggestionPendingSamFirstSeen.keys())) {
      if (!activeUnitKeys.has(key)) {
        nukeSuggestionPendingSamFirstSeen.delete(key);
      }
    }
  }

  function isMissileUnitReady(unit) {
    if (!isActiveFinishedUnit(unit)) {
      return false;
    }

    const level = getUnitLevel(unit);
    return getMissileTimerQueue(unit).length < level;
  }

  function getPlayerUnits(player, ...types) {
    try {
      return Array.from(player?.units?.(...types) || []);
    } catch (_error) {
      return [];
    }
  }

  function collectReadyNukeSilos(player) {
    return getPlayerUnits(player, "Missile Silo").filter(isMissileUnitReady);
  }

  function collectActiveNukeSilos(player) {
    return getPlayerUnits(player, "Missile Silo").filter(isActiveFinishedUnit);
  }

  function collectTargetSams(player) {
    return getPlayerUnits(player, "SAM Launcher").filter(isActiveFinishedUnit);
  }

  function isNukeSuggestionSamOwnerHostileToLauncher(myPlayer, player) {
    if (!myPlayer?.isPlayer?.() || !player?.isPlayer?.()) {
      return false;
    }
    if (getPlayerSmallId(myPlayer) === getPlayerSmallId(player)) {
      return false;
    }

    try {
      return !myPlayer.isFriendly?.(player) && !player.isFriendly?.(myPlayer);
    } catch (_error) {
      return true;
    }
  }

  function getPlayerBySmallIdSafe(game, smallId) {
    const numericId = Number(smallId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      return null;
    }

    try {
      const player = game?.playerBySmallID?.(numericId);
      return player?.isPlayer?.() ? player : null;
    } catch (_error) {
      return null;
    }
  }

  function collectAdjacentHostileSams(game, myPlayer, targetPlayer, tileInfo) {
    // Return cached result if already computed for this tileInfo object.
    if (tileInfo.adjacentHostileSamsCache !== null) {
      return tileInfo.adjacentHostileSamsCache;
    }

    const targetId = getPlayerSmallId(targetPlayer);
    const adjacentPlayerIds = new Set();

    for (const point of tileInfo.tiles) {
      let neighbors = [];
      try {
        neighbors = game.neighbors?.(point.tile) || [];
      } catch (_error) {
        neighbors = [];
      }

      for (const neighborTile of neighbors) {
        let ownerId = 0;
        try {
          ownerId = game.ownerID(neighborTile);
        } catch (_error) {
          continue;
        }
        if (ownerId > 0 && ownerId !== targetId) {
          adjacentPlayerIds.add(ownerId);
        }
      }
    }

    const sams = [];
    const seenSamIds = new Set();
    for (const playerId of adjacentPlayerIds) {
      const player = getPlayerBySmallIdSafe(game, playerId);
      if (!isNukeSuggestionSamOwnerHostileToLauncher(myPlayer, player)) {
        continue;
      }

      for (const sam of collectTargetSams(player)) {
        const samId = getUnitKey(sam);
        if (seenSamIds.has(samId)) {
          continue;
        }
        seenSamIds.add(samId);
        sams.push(sam);
      }
    }

    tileInfo.adjacentHostileSamsCache = sams;
    return sams;
  }

  function collectRelevantSams(game, myPlayer, targetPlayer, tileInfo) {
    const sams = [];
    const seenSamIds = new Set();

    for (const sam of [
      ...collectTargetSams(targetPlayer),
      ...collectAdjacentHostileSams(game, myPlayer, targetPlayer, tileInfo),
    ]) {
      const samId = getUnitKey(sam);
      if (seenSamIds.has(samId)) {
        continue;
      }
      seenSamIds.add(samId);
      sams.push(sam);
    }

    return sams;
  }

  function collectAllHostileSams(game, myPlayer) {
    const sams = [];
    const seenSamIds = new Set();

    function addSam(sam) {
      if (!isActiveFinishedUnit(sam)) {
        return;
      }

      let owner = null;
      try {
        owner = sam?.owner?.();
      } catch (_error) {
        owner = null;
      }
      if (!isNukeSuggestionSamOwnerHostileToLauncher(myPlayer, owner)) {
        return;
      }

      const samId = getUnitKey(sam);
      if (!samId || seenSamIds.has(samId)) {
        return;
      }
      seenSamIds.add(samId);
      sams.push(sam);
    }

    // Prefer global units() listing — includes third-party hostiles.
    try {
      for (const sam of game?.units?.("SAM Launcher") || []) {
        addSam(sam);
      }
    } catch (_error) {
      // Fall back below.
    }

    // Always also iterate player views so we pick up SAMs from third-party
    // nations that aren't returned by game.units() in the current view.
    try {
      for (const player of game?.playerViews?.() || []) {
        if (!isNukeSuggestionSamOwnerHostileToLauncher(myPlayer, player)) {
          continue;
        }
        for (const sam of collectTargetSams(player)) {
          addSam(sam);
        }
      }
    } catch (_error) {
      // No usable global player list.
    }

    return sams;
  }

  function collectPendingHostileSams(game, myPlayer) {
    const sams = [];
    const seenSamIds = new Set();

    function addSam(sam) {
      if (!isActiveUnderConstructionUnit(sam)) {
        return;
      }

      let owner = null;
      try {
        owner = sam?.owner?.();
      } catch (_error) {
        owner = null;
      }
      if (!isNukeSuggestionSamOwnerHostileToLauncher(myPlayer, owner)) {
        return;
      }

      const samId = getUnitKey(sam);
      if (!samId || seenSamIds.has(samId)) {
        return;
      }
      seenSamIds.add(samId);
      sams.push(sam);
    }

    try {
      for (const sam of game?.units?.("SAM Launcher") || []) {
        addSam(sam);
      }
    } catch (_error) {
      // Fall back below.
    }

    try {
      for (const player of game?.playerViews?.() || []) {
        if (!isNukeSuggestionSamOwnerHostileToLauncher(myPlayer, player)) {
          continue;
        }
        for (const sam of getPlayerUnits(player, "SAM Launcher")) {
          addSam(sam);
        }
      }
    } catch (_error) {
      // No usable global player list.
    }

    return sams;
  }

  function getUnitOwner(unit) {
    try {
      return unit?.owner?.() || null;
    } catch (_error) {
      return null;
    }
  }

  function isSamOwnedByNukeTarget(baseContext, sam) {
    const owner = getUnitOwner(sam);
    return (
      owner?.isPlayer?.() &&
      getPlayerSmallId(owner) === getPlayerSmallId(baseContext.targetPlayer)
    );
  }

  function getSamStackKey(sam) {
    const tile = getUnitTile(sam);
    if (tile === null) {
      return "";
    }

    const owner = getUnitOwner(sam);
    const ownerId = getPlayerSmallId(owner);
    return `${Number.isFinite(ownerId) ? ownerId : "unknown"}:${tile}`;
  }

  function getStackedSamLevel(sams, sam) {
    const stackKey = getSamStackKey(sam);
    if (!stackKey) {
      return getUnitLevel(sam);
    }

    let stackedLevel = 0;
    for (const otherSam of sams || []) {
      if (getSamStackKey(otherSam) === stackKey) {
        stackedLevel += getUnitLevel(otherSam);
      }
    }

    return Math.max(getUnitLevel(sam), stackedLevel);
  }

  function getSamStackUnitKeys(sams, stackKey) {
    return (sams || [])
      .filter((sam) => getSamStackKey(sam) === stackKey)
      .map(getUnitKey)
      .filter(Boolean);
  }

  function collectTargetStructures(player) {
    return getPlayerUnits(player, ...NUKE_SUGGESTION_STRUCTURE_TYPES)
      .filter((unit) => {
        try {
          return Boolean(unit?.isActive?.());
        } catch (_error) {
          return false;
        }
      })
      .map((unit) => ({
        unit,
        tile: getUnitTile(unit),
        type: getUnitType(unit),
      }))
      .filter((entry) => entry.tile !== null);
  }

  function isTeamGame(game) {
    try {
      return game?.config?.().gameConfig?.().gameMode === "Team";
    } catch (_error) {
      return false;
    }
  }

  function collectTeamStructures(game, myPlayer) {
    if (!isTeamGame(game)) {
      return [];
    }

    try {
      return Array.from(game.units?.(...NUKE_SUGGESTION_STRUCTURE_TYPES) || [])
        .filter((unit) => {
          if (!isActiveFinishedUnit(unit)) {
            return false;
          }
          const owner = unit.owner?.();
          return owner?.isPlayer?.() && myPlayer?.isOnSameTeam?.(owner);
        })
        .map((unit) => ({
          tile: getUnitTile(unit),
        }))
        .filter((entry) => entry.tile !== null);
    } catch (_error) {
      return [];
    }
  }

  function collectAlliedPlayerSmallIds(game, myPlayer) {
    const allyIds = new Set();

    try {
      for (const ally of myPlayer?.allies?.() || []) {
        const allyId = getPlayerSmallId(ally);
        if (Number.isFinite(allyId)) {
          allyIds.add(allyId);
        }
      }
    } catch (_error) {
      // Fall back to scanning player views below.
    }

    try {
      for (const player of game?.playerViews?.() || []) {
        if (
          player?.isPlayer?.() &&
          getPlayerSmallId(player) !== getPlayerSmallId(myPlayer) &&
          (
            myPlayer?.isAlliedWith?.(player) ||
            player?.isAlliedWith?.(myPlayer)
          )
        ) {
          const allyId = getPlayerSmallId(player);
          if (Number.isFinite(allyId)) {
            allyIds.add(allyId);
          }
        }
      }
    } catch (_error) {
      // The direct allies list is enough when available.
    }

    return allyIds;
  }

  function collectAlliedStructures(game, allySmallIds) {
    if (!allySmallIds?.size) {
      return [];
    }

    try {
      return Array.from(game.units?.(...NUKE_SUGGESTION_STRUCTURE_TYPES) || [])
        .filter((unit) => {
          if (!isActiveFinishedUnit(unit)) {
            return false;
          }
          const owner = unit.owner?.();
          return owner?.isPlayer?.() && allySmallIds.has(getPlayerSmallId(owner));
        })
        .map((unit) => ({
          tile: getUnitTile(unit),
        }))
        .filter((entry) => entry.tile !== null);
    } catch (_error) {
      return [];
    }
  }

  function getNukeAllianceBreakThreshold(game) {
    try {
      const threshold = Number(game?.config?.().nukeAllianceBreakThreshold?.());
      return Number.isFinite(threshold) && threshold >= 0 ? threshold : 100;
    } catch (_error) {
      return 100;
    }
  }

  function isEnemyNukeSuggestionTarget(game, targetPlayer) {
    const myPlayer = game?.myPlayer?.();
    if (!myPlayer?.isPlayer?.() || !targetPlayer?.isPlayer?.()) {
      return false;
    }
    if (!targetPlayer?.isAlive?.()) {
      return false;
    }
    if (getPlayerSmallId(myPlayer) === getPlayerSmallId(targetPlayer)) {
      return false;
    }

    try {
      return !myPlayer.isFriendly?.(targetPlayer) && !targetPlayer.isFriendly?.(myPlayer);
    } catch (_error) {
      return true;
    }
  }

  function makeNukeSuggestionBucketKey(x, y, bucketSize = NUKE_SUGGESTION_BUCKET_SIZE) {
    return `${Math.floor(x / bucketSize)}:${Math.floor(y / bucketSize)}`;
  }

  function addNukeSuggestionPointToBucket(buckets, point) {
    const key = makeNukeSuggestionBucketKey(point.x, point.y);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(point);
  }

  function getNukeSuggestionPlayerTileCount(player) {
    return Math.max(0, toFiniteNumber(player?.numTilesOwned?.(), 0));
  }

  function getNukeSuggestionTileInfoCacheKey(game, targetPlayer, myPlayer, allySmallIds) {
    const allyKey = Array.from(allySmallIds || [])
      .sort((a, b) => a - b)
      .map((allyId) => {
        const ally = getPlayerBySmallIdSafe(game, allyId);
        return `${allyId}:${getNukeSuggestionPlayerTileCount(ally)}`;
      })
      .join("|");

    return [
      Number(game?.width?.()) || 0,
      Number(game?.height?.()) || 0,
      getPlayerSmallId(targetPlayer),
      getNukeSuggestionPlayerTileCount(targetPlayer),
      getPlayerSmallId(myPlayer),
      getNukeSuggestionPlayerTileCount(myPlayer),
      allyKey,
    ].join(":");
  }

  function runTileScan(game, targetId, myPlayerId, allySmallIds, width, height) {
    const tiles = [];
    const buckets = new Map();
    const selfBuckets = new Map();
    const allyBuckets = new Map();
    const otherPlayerBuckets = new Map();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let sumX = 0;
    let sumY = 0;

    const totalTiles = width * height;
    for (let tile = 0; tile < totalTiles; tile++) {
      let ownerId = null;
      try {
        ownerId = game.ownerID(tile);
      } catch (_error) {
        continue;
      }
      const x = game.x(tile);
      const y = game.y(tile);
      const point = { tile, x, y, ownerId };

      if (ownerId === myPlayerId) {
        addNukeSuggestionPointToBucket(selfBuckets, point);
        continue;
      }
      if (allySmallIds?.has(ownerId)) {
        addNukeSuggestionPointToBucket(allyBuckets, point);
        continue;
      }
      if (ownerId !== targetId) {
        if (ownerId > 0) {
          addNukeSuggestionPointToBucket(otherPlayerBuckets, point);
        }
        continue;
      }

      tiles.push(point);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;

      addNukeSuggestionPointToBucket(buckets, point);
    }

    if (tiles.length === 0) {
      return null;
    }

    return {
      tiles,
      buckets,
      selfBuckets,
      allyBuckets,
      otherPlayerBuckets,
      adjacentHostileSamsCache: null,
      bbox: { minX, minY, maxX, maxY },
      centroid: {
        x: sumX / tiles.length,
        y: sumY / tiles.length,
      },
    };
  }

  function collectTargetTileInfo(game, targetPlayer, myPlayer, allySmallIds) {
    const targetId = getPlayerSmallId(targetPlayer);
    const myPlayerId = getPlayerSmallId(myPlayer);
    const width = Number(game?.width?.());
    const height = Number(game?.height?.());
    if (
      !Number.isFinite(targetId) ||
      !Number.isFinite(myPlayerId) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }

    const cacheKey = getNukeSuggestionTileInfoCacheKey(
      game,
      targetPlayer,
      myPlayer,
      allySmallIds,
    );
    const now = performance.now();
    if (
      nukeSuggestionTileInfoCache?.key === cacheKey &&
      now - nukeSuggestionTileInfoCache.updatedAt <=
        NUKE_SUGGESTION_TILE_INFO_CACHE_MS
    ) {
      return nukeSuggestionTileInfoCache.value;
    }

    // Defer the expensive tile scan to a setTimeout so it doesn't block
    // the current animation frame. Return stale data (or null) in the meantime.
    if (nukeSuggestionTileComputeKey !== cacheKey) {
      nukeSuggestionTileComputeKey = cacheKey;
      setTimeout(() => {
        if (nukeSuggestionTileComputeKey !== cacheKey) {
          return;
        }
        const tileInfo = runTileScan(game, targetId, myPlayerId, allySmallIds, width, height);
        if (nukeSuggestionTileComputeKey !== cacheKey) {
          return;
        }
        nukeSuggestionTileComputeKey = null;
        nukeSuggestionTileInfoCache = {
          key: cacheKey,
          updatedAt: performance.now(),
          value: tileInfo,
        };
        // Force signature recheck so results update on the next poll cycle.
        lastNukeSuggestionSignatureCheckAt = 0;
        lastNukeSuggestionSignature = "";
      }, 0);
    }

    // Return stale data while recomputing, or null for the very first hover.
    return nukeSuggestionTileInfoCache?.value ?? null;
  }

  function getTileFromXY(game, x, y) {
    const tileX = Math.round(x);
    const tileY = Math.round(y);
    try {
      if (!game?.isValidCoord?.(tileX, tileY)) {
        return null;
      }
      return game.ref(tileX, tileY);
    } catch (_error) {
      return null;
    }
  }

  function addNukeSuggestionSeed(seeds, game, tile) {
    if (tile == null) {
      return;
    }

    try {
      if (!game?.isValidRef?.(tile)) {
        return;
      }
    } catch (_error) {
      return;
    }

    seeds.set(String(tile), tile);
  }

  function addNukeSuggestionSeedXY(seeds, game, x, y) {
    addNukeSuggestionSeed(seeds, game, getTileFromXY(game, x, y));
  }

  function addDensitySeeds(seeds, game, tileInfo, radius, maxSeeds) {
    const densityBucketSize = Math.max(8, Math.round(radius / 2));
    const densityBuckets = new Map();
    for (const point of tileInfo.tiles) {
      const key = makeNukeSuggestionBucketKey(point.x, point.y, densityBucketSize);
      let bucket = densityBuckets.get(key);
      if (!bucket) {
        bucket = {
          count: 0,
          sumX: 0,
          sumY: 0,
        };
        densityBuckets.set(key, bucket);
      }
      bucket.count++;
      bucket.sumX += point.x;
      bucket.sumY += point.y;
    }

    const sortedBuckets = Array.from(densityBuckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, maxSeeds);

    for (const bucket of sortedBuckets) {
      addNukeSuggestionSeedXY(
        seeds,
        game,
        bucket.sumX / bucket.count,
        bucket.sumY / bucket.count,
      );
    }
  }

  function buildNukeSuggestionSeeds(game, targetPlayer, tileInfo, structures, magnitude, spec) {
    const seeds = new Map();
    const nameLocation = targetPlayer?.nameLocation?.();
    if (nameLocation) {
      addNukeSuggestionSeedXY(seeds, game, nameLocation.x, nameLocation.y);
    }
    addNukeSuggestionSeedXY(seeds, game, tileInfo.centroid.x, tileInfo.centroid.y);
    addNukeSuggestionSeedXY(
      seeds,
      game,
      (tileInfo.bbox.minX + tileInfo.bbox.maxX) / 2,
      (tileInfo.bbox.minY + tileInfo.bbox.maxY) / 2,
    );

    const seedStructures = spec.scoreMode === "destruction"
      ? structures.filter(isPopulationOrEconomicNukeObjective)
      : structures;

    for (const structure of seedStructures) {
      addNukeSuggestionSeed(seeds, game, structure.tile);
    }

    addDensitySeeds(
      seeds,
      game,
      tileInfo,
      magnitude.outer,
      Math.max(24, Math.floor(spec.maxRawSeeds / 3)),
    );

    const sampleLimit = Math.min(NUKE_SUGGESTION_SAMPLE_LIMIT, spec.maxRawSeeds);
    const stride = Math.max(1, Math.floor(tileInfo.tiles.length / sampleLimit));
    for (let index = 0; index < tileInfo.tiles.length; index += stride) {
      addNukeSuggestionSeed(seeds, game, tileInfo.tiles[index].tile);
      if (seeds.size >= spec.maxRawSeeds + seedStructures.length + 8) {
        break;
      }
    }

    return Array.from(seeds.values());
  }

  function getCityTroopIncrease(game) {
    try {
      const increase = Number(game?.config?.().cityTroopIncrease?.());
      return Number.isFinite(increase) && increase > 0 ? increase : 250000;
    } catch (_error) {
      return 250000;
    }
  }

  function getPlayerTroopsNumber(player) {
    try {
      const troops = Number(player?.troops?.());
      return Number.isFinite(troops) && troops > 0 ? troops : 0;
    } catch (_error) {
      return 0;
    }
  }

  function getPlayerMaxTroopsNumber(game, player) {
    try {
      const maxTroops = Number(game?.config?.().maxTroops?.(player));
      if (Number.isFinite(maxTroops) && maxTroops > 0) {
        return maxTroops;
      }
    } catch (_error) {
      // Fall back to the default max-troops shape.
    }

    const tilesOwned = Math.max(0, toFiniteNumber(player?.numTilesOwned?.(), 0));
    const cityLevels = getPlayerUnits(player, "City")
      .filter((unit) => !unit?.isUnderConstruction?.())
      .map(getUnitLevel)
      .reduce((sum, level) => sum + level, 0);
    return 2 * (Math.pow(tilesOwned, 0.6) * 1000 + 50000) +
      cityLevels * getCityTroopIncrease(game);
  }

  function estimateNukePopulationLoss(game, nukeType, player, expectedTiles) {
    const troops = getPlayerTroopsNumber(player);
    if (troops <= 0 || expectedTiles <= 0) {
      return 0;
    }

    const tilesBeforeNuke = Math.max(1, toFiniteNumber(player?.numTilesOwned?.(), 1));
    if (nukeType === "MIRV Warhead") {
      try {
        return Number(
          game?.config?.().nukeDeathFactor?.(
            nukeType,
            troops,
            tilesBeforeNuke,
            getPlayerMaxTroopsNumber(game, player),
          ),
        ) || 0;
      } catch (_error) {
        return 0;
      }
    }

    const cappedTiles = Math.min(expectedTiles, tilesBeforeNuke);
    const wholeTiles = Math.floor(cappedTiles);
    const partialTile = cappedTiles - wholeTiles;
    let remainingRatio = 1;
    if (wholeTiles > 0) {
      if (tilesBeforeNuke <= 5 || tilesBeforeNuke - wholeTiles <= 4) {
        remainingRatio = 0;
      } else {
        const end = tilesBeforeNuke - wholeTiles;
        for (let offset = 0; offset < 5; offset++) {
          remainingRatio *= (end - offset) / (tilesBeforeNuke - offset);
        }
      }
    }

    if (partialTile > 0) {
      const numTilesLeft = Math.max(1, tilesBeforeNuke - wholeTiles);
      const lossRatio = Math.min(1, (5 / numTilesLeft) * partialTile);
      remainingRatio *= Math.max(0, 1 - lossRatio);
    }

    return troops * (1 - remainingRatio);
  }

  function estimateCityPopulationHit(game, context, cx, cy, outerSquared) {
    const troopRatio = Math.max(
      0,
      Math.min(
        1,
        getPlayerTroopsNumber(context.targetPlayer) /
          Math.max(1, getPlayerMaxTroopsNumber(game, context.targetPlayer)),
      ),
    );
    const cityTroopIncrease = getCityTroopIncrease(game);
    let cityPopulationHit = 0;
    let citiesHit = 0;
    const hitCityPopulationWeights = new Map();

    for (const structure of context.structures) {
      if (structure.type !== "City") {
        continue;
      }

      try {
        const sx = game.x(structure.tile);
        const sy = game.y(structure.tile);
        const dx = sx - cx;
        const dy = sy - cy;
        if (dx * dx + dy * dy < outerSquared) {
          const cityHit = getUnitLevel(structure.unit) * cityTroopIncrease * troopRatio;
          cityPopulationHit += cityHit;
          citiesHit++;
          hitCityPopulationWeights.set(getStructureImpactKey(structure), cityHit);
        }
      } catch (_error) {
        // Ignore stale unit refs.
      }
    }

    return {
      cityPopulationHit,
      citiesHit,
      hitCityPopulationWeights,
    };
  }

  function hasNukeSuggestionTrainStation(unit) {
    try {
      return Boolean(unit?.hasTrainStation?.());
    } catch (_error) {
      return false;
    }
  }

  function getEconomicStructureWeight(structure) {
    const level = getUnitLevel(structure.unit);
    const trainStationMultiplier = hasNukeSuggestionTrainStation(structure.unit) ? 1.25 : 1;

    switch (structure.type) {
      case "Factory":
        return 1400000 * level * trainStationMultiplier;
      case "Port":
        return 900000 * level * trainStationMultiplier;
      case "City":
        return 650000 * level * trainStationMultiplier;
      default:
        return 0;
    }
  }

  function getStructureImpactKey(structure) {
    const unitKey = getUnitKey(structure.unit);
    return unitKey || `${structure.type}:${structure.tile}`;
  }

  function isPopulationOrEconomicNukeObjective(structure) {
    return structure?.type === "City" || getEconomicStructureWeight(structure) > 0;
  }

  function estimateNukeEconomicImpact(context, cx, cy, outerSquared) {
    let economicImpact = 0;
    let economicStructuresHit = 0;
    const hitEconomicStructureWeights = new Map();

    for (const structure of context.structures) {
      const structureWeight = getEconomicStructureWeight(structure);
      if (structureWeight <= 0) {
        continue;
      }

      try {
        const sx = context.game.x(structure.tile);
        const sy = context.game.y(structure.tile);
        const dx = sx - cx;
        const dy = sy - cy;
        if (dx * dx + dy * dy < outerSquared) {
          economicImpact += structureWeight;
          economicStructuresHit++;
          hitEconomicStructureWeights.set(
            getStructureImpactKey(structure),
            structureWeight,
          );
        }
      } catch (_error) {
        // Ignore stale unit refs.
      }
    }

    return {
      economicImpact,
      economicStructuresHit,
      hitEconomicStructureWeights,
    };
  }

  function combineDestructionStructureWeights(
    hitEconomicStructureWeights,
    hitCityPopulationWeights,
  ) {
    const weights = new Map();
    const structureKeys = new Set([
      ...Array.from(hitEconomicStructureWeights?.keys?.() || []),
      ...Array.from(hitCityPopulationWeights?.keys?.() || []),
    ]);

    for (const structureKey of structureKeys) {
      const economicWeight = hitEconomicStructureWeights?.get?.(structureKey) || 0;
      const cityWeight = hitCityPopulationWeights?.get?.(structureKey) || 0;
      weights.set(
        structureKey,
        economicWeight + cityWeight + AUTO_NUKE_DESTRUCTION_BUILDING_BONUS,
      );
    }

    return weights;
  }

  function anyTeamStructureInBlast(game, structures, cx, cy, outerSquared) {
    for (const structure of structures) {
      try {
        const sx = game.x(structure.tile);
        const sy = game.y(structure.tile);
        const dx = sx - cx;
        const dy = sy - cy;
        if (dx * dx + dy * dy < outerSquared) {
          return true;
        }
      } catch (_error) {
        // Ignore stale unit refs.
      }
    }
    return false;
  }

  function wouldNukeSuggestionBreakAlliance(game, context, cx, cy, outerSquared) {
    if (!context.allySmallIds?.size) {
      return false;
    }

    for (const structure of context.alliedStructures) {
      try {
        const sx = game.x(structure.tile);
        const sy = game.y(structure.tile);
        const dx = sx - cx;
        const dy = sy - cy;
        if (dx * dx + dy * dy <= outerSquared) {
          return true;
        }
      } catch (_error) {
        // Ignore stale unit refs.
      }
    }

    const minBucketX = Math.floor((cx - context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const maxBucketX = Math.floor((cx + context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const minBucketY = Math.floor((cy - context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const maxBucketY = Math.floor((cy + context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const innerSquared = context.magnitude.inner * context.magnitude.inner;
    const counts = new Map();

    for (let by = minBucketY; by <= maxBucketY; by++) {
      for (let bx = minBucketX; bx <= maxBucketX; bx++) {
        const bucket = context.tileInfo.allyBuckets.get(`${bx}:${by}`);
        if (!bucket) {
          continue;
        }

        for (const point of bucket) {
          const dx = point.x - cx;
          const dy = point.y - cy;
          const distSquared = dx * dx + dy * dy;
          if (distSquared > outerSquared) {
            continue;
          }

          const weight = distSquared <= innerSquared ? 1 : 0.5;
          const nextCount = (counts.get(point.ownerId) || 0) + weight;
          if (nextCount > context.allianceBreakThreshold) {
            return true;
          }
          counts.set(point.ownerId, nextCount);
        }
      }
    }

    return false;
  }

  function wouldNukeSuggestionAffectLauncher(game, context, cx, cy, outerSquared) {
    const myPlayerId = getPlayerSmallId(context.myPlayer);
    if (!Number.isFinite(myPlayerId)) {
      return true;
    }

    const minBucketX = Math.floor((cx - context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const maxBucketX = Math.floor((cx + context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const minBucketY = Math.floor((cy - context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const maxBucketY = Math.floor((cy + context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);

    for (let by = minBucketY; by <= maxBucketY; by++) {
      for (let bx = minBucketX; bx <= maxBucketX; bx++) {
        const bucket = context.tileInfo.selfBuckets.get(`${bx}:${by}`);
        if (!bucket) {
          continue;
        }

        for (const point of bucket) {
          const dx = point.x - cx;
          const dy = point.y - cy;
          if (dx * dx + dy * dy <= outerSquared) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function wouldHydrogenNukeAffectOtherPlayers(context, cx, cy, outerSquared) {
    if (context.spec?.type !== "Hydrogen Bomb") {
      return false;
    }

    const minBucketX = Math.floor((cx - context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const maxBucketX = Math.floor((cx + context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const minBucketY = Math.floor((cy - context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const maxBucketY = Math.floor((cy + context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);

    for (let by = minBucketY; by <= maxBucketY; by++) {
      for (let bx = minBucketX; bx <= maxBucketX; bx++) {
        const bucketKey = `${bx}:${by}`;
        const buckets = [
          context.tileInfo.otherPlayerBuckets?.get(bucketKey),
          context.tileInfo.allyBuckets?.get(bucketKey),
          context.tileInfo.selfBuckets?.get(bucketKey),
        ].filter(Boolean);

        for (const bucket of buckets) {
          for (const point of bucket) {
            const dx = point.x - cx;
            const dy = point.y - cy;
            if (dx * dx + dy * dy <= outerSquared) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  function getOwnerAtTile(game, tile) {
    try {
      return game.owner?.(tile) ?? null;
    } catch (_error) {
      return null;
    }
  }

  function isNukeSuggestionTileAllowed(game, myPlayer, tile, magnitude, teamStructures) {
    if (game?.isSpawnImmunityActive?.()) {
      return false;
    }

    const owner = getOwnerAtTile(game, tile);
    if (owner?.isPlayer?.() && isTeamGame(game) && myPlayer?.isOnSameTeam?.(owner)) {
      return false;
    }

    if (teamStructures.length === 0) {
      return true;
    }

    const cx = game.x(tile);
    const cy = game.y(tile);
    return !anyTeamStructureInBlast(
      game,
      teamStructures,
      cx,
      cy,
      magnitude.outer * magnitude.outer,
    );
  }

  function scoreNukeSuggestionTile(game, context, tile) {
    if (
      tile == null ||
      !isNukeSuggestionTileAllowed(
        game,
        context.myPlayer,
        tile,
        context.magnitude,
        context.teamStructures,
      )
    ) {
      return null;
    }

    let cx;
    let cy;
    try {
      cx = game.x(tile);
      cy = game.y(tile);
    } catch (_error) {
      return null;
    }

    const innerSquared = context.magnitude.inner * context.magnitude.inner;
    const outerSquared = context.magnitude.outer * context.magnitude.outer;
    if (wouldNukeSuggestionAffectLauncher(game, context, cx, cy, outerSquared)) {
      return null;
    }
    if (wouldNukeSuggestionBreakAlliance(game, context, cx, cy, outerSquared)) {
      return null;
    }
    if (wouldHydrogenNukeAffectOtherPlayers(context, cx, cy, outerSquared)) {
      return null;
    }

    let expectedTilesHit = 0;
    let innerTiles = 0;
    let outerTiles = 0;

    const minBucketX = Math.floor((cx - context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const maxBucketX = Math.floor((cx + context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const minBucketY = Math.floor((cy - context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);
    const maxBucketY = Math.floor((cy + context.magnitude.outer) / NUKE_SUGGESTION_BUCKET_SIZE);

    for (let by = minBucketY; by <= maxBucketY; by++) {
      for (let bx = minBucketX; bx <= maxBucketX; bx++) {
        const bucket = context.tileInfo.buckets.get(`${bx}:${by}`);
        if (!bucket) {
          continue;
        }

        for (const point of bucket) {
          const dx = point.x - cx;
          const dy = point.y - cy;
          const distSquared = dx * dx + dy * dy;
          if (distSquared <= innerSquared) {
            expectedTilesHit += 1;
            innerTiles++;
          } else if (distSquared <= outerSquared) {
            expectedTilesHit += 0.5;
            outerTiles++;
          }
        }
      }
    }

    let populationLoss = 0;
    let cityPopulationHit = 0;
    let citiesHit = 0;
    let economicImpact = 0;
    let economicStructuresHit = 0;
    let hitEconomicStructureWeights = new Map();
    let hitCityPopulationWeights = new Map();
    let hitDestructionStructureWeights = new Map();
    let destructionImpact = 0;

    if (context.scoreMode === "economic" || context.scoreMode === "destruction") {
      const economicResult = estimateNukeEconomicImpact(context, cx, cy, outerSquared);
      economicImpact = economicResult.economicImpact;
      economicStructuresHit = economicResult.economicStructuresHit;
      hitEconomicStructureWeights =
        economicResult.hitEconomicStructureWeights || new Map();
    }

    if (context.scoreMode !== "economic") {
      populationLoss = estimateNukePopulationLoss(
        game,
        context.spec.type,
        context.targetPlayer,
        expectedTilesHit,
      );
      const cityResult = estimateCityPopulationHit(
        game,
        context,
        cx,
        cy,
        outerSquared,
      );
      cityPopulationHit = cityResult.cityPopulationHit;
      citiesHit = cityResult.citiesHit;
      hitCityPopulationWeights = cityResult.hitCityPopulationWeights || new Map();
    }
    if (context.scoreMode === "destruction") {
      hitDestructionStructureWeights = combineDestructionStructureWeights(
        hitEconomicStructureWeights,
        hitCityPopulationWeights,
      );
      for (const weight of hitDestructionStructureWeights.values()) {
        destructionImpact += weight;
      }
      destructionImpact += populationLoss * 0.15;
    }
    let samsHit = 0;
    const hitSamKeys = [];
    for (const sam of context.targetSams || []) {
      try {
        const samTile = getUnitTile(sam);
        if (samTile === null) {
          continue;
        }
        const sx = game.x(samTile);
        const sy = game.y(samTile);
        const dx = sx - cx;
        const dy = sy - cy;
        if (dx * dx + dy * dy < outerSquared) {
          samsHit++;
          const samKey = getUnitKey(sam);
          if (samKey) {
            hitSamKeys.push(samKey);
          }
        }
      } catch (_error) {
        // Ignore stale unit refs.
      }
    }

    const totalScore =
      context.scoreMode === "economic"
        ? economicImpact
        : context.scoreMode === "destruction"
          ? destructionImpact
          : populationLoss + cityPopulationHit + economicImpact;
    if (totalScore <= 0) {
      return null;
    }

    return {
      id: context.spec.id,
      spec: context.spec,
      type: context.spec.type,
      tile,
      x: cx,
      y: cy,
      magnitude: context.magnitude,
      populationLoss,
      cityPopulationHit,
      economicImpact,
      expectedTilesHit,
      innerTiles,
      outerTiles,
      citiesHit,
      economicStructuresHit,
      hitEconomicStructureWeights: hitEconomicStructureWeights || new Map(),
      hitCityPopulationWeights: hitCityPopulationWeights || new Map(),
      hitDestructionStructureWeights: hitDestructionStructureWeights || new Map(),
      hitSamKeys,
      samsHit,
      totalScore,
    };
  }

  function refineNukeSuggestionCandidate(game, context, candidate) {
    let best = candidate;
    const steps =
      context.spec.type === "Hydrogen Bomb"
        ? [40, 20, 10, 5, 2, 1]
        : [16, 8, 4, 2, 1];
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    for (const step of steps) {
      for (const [dx, dy] of directions) {
        const tile = getTileFromXY(game, best.x + dx * step, best.y + dy * step);
        const next = scoreNukeSuggestionTile(game, context, tile);
        if (next && next.totalScore > best.totalScore + 0.25) {
          best = next;
        }
      }
    }

    return best;
  }

  function findClosestReadySilo(game, targetTile, silos) {
    let bestSilo = null;
    let bestDistance = Infinity;

    for (const silo of silos) {
      const siloTile = getUnitTile(silo);
      if (siloTile === null) {
        continue;
      }

      let distance = Infinity;
      try {
        distance = game.manhattanDist(siloTile, targetTile);
      } catch (_error) {
        continue;
      }

      if (distance < bestDistance) {
        bestDistance = distance;
        bestSilo = silo;
      }
    }

    return bestSilo;
  }

  function getDefaultNukeSpeed(game) {
    try {
      const speed = Number(game?.config?.().defaultNukeSpeed?.());
      return Number.isFinite(speed) && speed > 0 ? speed : 6;
    } catch (_error) {
      return 6;
    }
  }

  function getDefaultNukeTargetableRange(game) {
    try {
      const range = Number(game?.config?.().defaultNukeTargetableRange?.());
      return Number.isFinite(range) && range > 0 ? range : 150;
    } catch (_error) {
      return 150;
    }
  }

  function getDefaultSamMissileSpeed(game) {
    try {
      const speed = Number(game?.config?.().defaultSamMissileSpeed?.());
      return Number.isFinite(speed) && speed > 0 ? speed : 12;
    } catch (_error) {
      return 12;
    }
  }

  function getSamCooldown(game) {
    try {
      const cooldown = Number(game?.config?.().SAMCooldown?.());
      return Number.isFinite(cooldown) && cooldown > 0 ? cooldown : 120;
    } catch (_error) {
      return 120;
    }
  }

  function getMissileAvailabilityTick(game, unit, cooldown) {
    const level = getUnitLevel(unit);
    const queue = getMissileTimerQueue(unit);
    if (queue.length < level) {
      return 0;
    }

    const frontTime = Number(queue[0]);
    if (!Number.isFinite(frontTime)) {
      return Infinity;
    }

    const currentTick = toFiniteNumber(game?.ticks?.(), 0);
    const ticksLeft = cooldown - (currentTick - frontTime);
    return Math.max(1, Math.ceil(ticksLeft) + 1);
  }

  function getCurrentGameTick(game) {
    return Math.floor(toFiniteNumber(game?.ticks?.(), 0));
  }

  function getAutoNukeShotLaunchOffsetTicks(shotIndex) {
    return Math.max(
      0,
      Math.ceil(
        Math.max(0, Number(shotIndex) || 0) *
          AUTO_NUKE_SEQUENCE_DELAY_MS /
          AUTO_NUKE_GAME_TICK_MS,
      ),
    );
  }

  function getSamMissileSlotAvailableTicks(game, sam, cooldown) {
    const level = Math.max(1, getUnitLevel(sam));
    const queue = getMissileTimerQueue(sam)
      .map((tick) => Number(tick))
      .filter(Number.isFinite)
      .slice(0, level);
    const currentTick = getCurrentGameTick(game);
    const slots = [];

    for (let index = queue.length; index < level; index++) {
      slots.push(0);
    }

    for (const firedAtTick of queue) {
      const ticksLeft = cooldown - (currentTick - firedAtTick);
      slots.push(Math.max(1, Math.ceil(ticksLeft) + 1));
    }

    return slots.sort((a, b) => a - b);
  }

  function getSamStackMissileSlotAvailableTicks(game, sams) {
    const cooldown = getSamCooldown(game);
    const slots = [];
    for (const sam of sams || []) {
      slots.push(...getSamMissileSlotAvailableTicks(game, sam, cooldown));
    }
    return slots.sort((a, b) => a - b);
  }

  function getSamRange(game, sam, sams = null) {
    try {
      const rangeLevel = sams ? getStackedSamLevel(sams, sam) : getUnitLevel(sam);
      const range = Number(game?.config?.().samRange?.(rangeLevel));
      return Number.isFinite(range) && range > 0 ? range : 70;
    } catch (_error) {
      return 70;
    }
  }

  function getMaxSamRange(game) {
    try {
      const range = Number(game?.config?.().maxSamRange?.());
      return Number.isFinite(range) && range > 0 ? range : 150;
    } catch (_error) {
      return 150;
    }
  }

  function clampNukeSuggestionValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getCubicBezierPoint(p0, p1, p2, p3, t) {
    const inverse = 1 - t;
    const inverseSquared = inverse * inverse;
    const inverseCubed = inverseSquared * inverse;
    const squared = t * t;
    const cubed = squared * t;
    return {
      x:
        inverseCubed * p0.x +
        3 * inverseSquared * t * p1.x +
        3 * inverse * squared * p2.x +
        cubed * p3.x,
      y:
        inverseCubed * p0.y +
        3 * inverseSquared * t * p1.y +
        3 * inverse * squared * p2.y +
        cubed * p3.y,
    };
  }

  function createNukeSuggestionTrajectory(
    game,
    sourceTile,
    targetTile,
    rocketDirectionUp = true,
  ) {
    const speed = getDefaultNukeSpeed(game);
    const p0 = { x: game.x(sourceTile), y: game.y(sourceTile) };
    const p3 = { x: game.x(targetTile), y: game.y(targetTile) };
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const distance = Math.hypot(dx, dy);
    const maxHeight = Math.max(distance / 3, 50);
    const mapHeight = Number(game?.height?.()) || 1;
    const heightSign = rocketDirectionUp === false ? 1 : -1;
    const p1 = {
      x: p0.x + dx / 4,
      y: clampNukeSuggestionValue(
        p0.y + dy / 4 + heightSign * maxHeight,
        0,
        mapHeight - 1,
      ),
    };
    const p2 = {
      x: p0.x + (dx * 3) / 4,
      y: clampNukeSuggestionValue(
        p0.y + (dy * 3) / 4 + heightSign * maxHeight,
        0,
        mapHeight - 1,
      ),
    };

    const points = [p0];
    let t = 0;
    let previousPoint = p0;
    let cumulativeDistance = 0;
    while (t < 1) {
      t = Math.min(t + 0.002, 1);
      const currentPoint = getCubicBezierPoint(p0, p1, p2, p3, t);
      cumulativeDistance += Math.hypot(
        currentPoint.x - previousPoint.x,
        currentPoint.y - previousPoint.y,
      );
      if (cumulativeDistance >= speed) {
        points.push(currentPoint);
        cumulativeDistance = 0;
      }
      previousPoint = currentPoint;
    }

    const finalPoint = getCubicBezierPoint(p0, p1, p2, p3, 1);
    const lastPoint = points[points.length - 1];
    if (lastPoint.x !== finalPoint.x || lastPoint.y !== finalPoint.y) {
      points.push(finalPoint);
    }

    const trajectory = [];
    for (const point of points) {
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      try {
        if (game.isValidCoord?.(x, y)) {
          trajectory.push(game.ref(x, y));
        }
      } catch (_error) {
        // Ignore any point that falls outside a stale map.
      }
    }

    return trajectory.length > 0 ? trajectory : [sourceTile, targetTile];
  }

  function isNukeSuggestionTrajectoryTargetable(game, sourceTile, targetTile, tile, rangeSquared) {
    try {
      return (
        game.euclideanDistSquared(tile, targetTile) < rangeSquared ||
        game.euclideanDistSquared(sourceTile, tile) < rangeSquared
      );
    } catch (_error) {
      return false;
    }
  }

  function canSamInterceptFromTrajectoryIndex(
    game,
    sourceTile,
    targetTile,
    trajectory,
    currentIndex,
    samTile,
    samRangeSquared,
    samMissileSpeed,
    targetableRangeSquared,
  ) {
    const explosionTick = trajectory.length - currentIndex;
    for (let index = currentIndex; index < trajectory.length; index++) {
      const tile = trajectory[index];
      if (
        !isNukeSuggestionTrajectoryTargetable(
          game,
          sourceTile,
          targetTile,
          tile,
          targetableRangeSquared,
        )
      ) {
        continue;
      }

      let distSquared = Infinity;
      let samTickToReach = Infinity;
      try {
        distSquared = game.euclideanDistSquared(samTile, tile);
        samTickToReach = Math.ceil(game.manhattanDist(samTile, tile) / samMissileSpeed);
      } catch (_error) {
        continue;
      }

      const nukeTickToReach = index - currentIndex;
      const tickBeforeShooting = nukeTickToReach - samTickToReach;
      if (
        distSquared <= samRangeSquared &&
        samTickToReach < explosionTick &&
        tickBeforeShooting >= 0
      ) {
        return true;
      }
    }

    return false;
  }

  function findSamInterceptionOpportunity(
    game,
    sourceTile,
    targetTile,
    trajectory,
    sam,
    sams,
    rocketDirectionUp = true,
    nukeLaunchOffsetTicks = 0,
    samAvailableAtTick = 0,
  ) {
    const samTile = getUnitTile(sam);
    if (samTile === null || !Array.isArray(trajectory) || trajectory.length === 0) {
      return null;
    }

    const targetableRange = getDefaultNukeTargetableRange(game);
    const targetableRangeSquared = targetableRange * targetableRange;
    const samMissileSpeed = getDefaultSamMissileSpeed(game);
    const samRange = getSamRange(game, sam, sams);
    const samRangeSquared = samRange * samRange;
    const detectionRange = getMaxSamRange(game) * 2;
    const detectionRangeSquared = detectionRange * detectionRange;
    const launchTick = Math.max(0, Math.floor(Number(nukeLaunchOffsetTicks) || 0));
    const availableTick = Math.max(0, Math.floor(Number(samAvailableAtTick) || 0));
    const earliestShootTick = Math.max(launchTick, availableTick);
    let best = null;

    for (let index = 0; index < trajectory.length; index++) {
      const tile = trajectory[index];
      if (
        !isNukeSuggestionTrajectoryTargetable(
          game,
          sourceTile,
          targetTile,
          tile,
          targetableRangeSquared,
        )
      ) {
        continue;
      }

      let samTickToReach = Infinity;
      let distSquared = Infinity;
      try {
        distSquared = game.euclideanDistSquared(samTile, tile);
        samTickToReach = Math.ceil(game.manhattanDist(samTile, tile) / samMissileSpeed);
      } catch (_error) {
        continue;
      }
      if (distSquared > samRangeSquared) {
        continue;
      }

      const shootTick = launchTick + index - samTickToReach;
      if (shootTick < earliestShootTick) {
        continue;
      }
      if (shootTick + samTickToReach >= launchTick + trajectory.length) {
        continue;
      }

      const nukeIndexAtShot = Math.max(
        0,
        Math.min(trajectory.length - 1, shootTick - launchTick),
      );
      try {
        if (
          game.euclideanDistSquared(samTile, trajectory[nukeIndexAtShot]) >
            detectionRangeSquared
        ) {
          continue;
        }
      } catch (_error) {
        continue;
      }

      if (!best || shootTick < best.shootTick) {
        best = {
          sam,
          samTile,
          rocketDirectionUp,
          shootTick,
          interceptTile: tile,
          trajectoryIndex: index,
        };
      }
    }

    return best;
  }

  function findInterceptingSam(
    game,
    sourceTile,
    targetTile,
    sams,
    rocketDirectionUp = true,
  ) {
    return findInterceptingSams(
      game,
      sourceTile,
      targetTile,
      sams,
      rocketDirectionUp,
    )[0] || null;
  }

  function findInterceptingSams(
    game,
    sourceTile,
    targetTile,
    sams,
    rocketDirectionUp = true,
  ) {
    if (sams.length === 0) {
      return [];
    }

    const trajectory = createNukeSuggestionTrajectory(
      game,
      sourceTile,
      targetTile,
      rocketDirectionUp,
    );
    const samCooldown = getSamCooldown(game);
    const interceptingSams = [];

    for (const sam of sams) {
      const samTile = getUnitTile(sam);
      if (samTile === null) {
        continue;
      }

      const availableAt = getMissileAvailabilityTick(game, sam, samCooldown);
      if (!Number.isFinite(availableAt)) {
        continue;
      }

      const opportunity = findSamInterceptionOpportunity(
        game,
        sourceTile,
        targetTile,
        trajectory,
        sam,
        sams,
        rocketDirectionUp,
        0,
        availableAt,
      );
      if (opportunity) {
        interceptingSams.push(sam);
      }
    }

    return interceptingSams;
  }

  function getInterceptingSamsWeight(sams) {
    const stackWeights = new Map();

    for (const sam of sams || []) {
      const stackKey = getSamStackKey(sam) || getUnitKey(sam);
      if (!stackKey) {
        continue;
      }
      stackWeights.set(stackKey, (stackWeights.get(stackKey) || 0) + getUnitLevel(sam));
    }

    return Array.from(stackWeights.values())
      .reduce((sum, stackWeight) => sum + stackWeight, 0);
  }

  function chooseBestNukeRocketDirection(game, sourceTile, targetTile, sams) {
    const upSams = findInterceptingSams(game, sourceTile, targetTile, sams, true);
    const downSams = findInterceptingSams(game, sourceTile, targetTile, sams, false);
    const upWeight = getInterceptingSamsWeight(upSams);
    const downWeight = getInterceptingSamsWeight(downSams);

    if (downWeight < upWeight) {
      return {
        rocketDirectionUp: false,
        interceptingSams: downSams,
        interceptingSamWeight: downWeight,
      };
    }

    return {
      rocketDirectionUp: true,
      interceptingSams: upSams,
      interceptingSamWeight: upWeight,
    };
  }

  function dedupeNukeSuggestionCandidates(candidates) {
    const byTile = new Map();
    for (const candidate of candidates) {
      const existing = byTile.get(candidate.tile);
      if (!existing || candidate.totalScore > existing.totalScore) {
        byTile.set(candidate.tile, candidate);
      }
    }
    return Array.from(byTile.values()).sort((a, b) => b.totalScore - a.totalScore);
  }

  function computeNukeCandidatesForType(game, baseContext, spec, limit) {
    const magnitude = getNukeSuggestionMagnitude(game, spec.type);
    const context = {
      ...baseContext,
      game,
      magnitude,
      spec,
      scoreMode: spec.scoreMode || "population",
    };
    const seeds = buildNukeSuggestionSeeds(
      game,
      context.targetPlayer,
      context.tileInfo,
      context.structures,
      magnitude,
      spec,
    );

    const rawCandidates = [];
    for (const seed of seeds) {
      const candidate = scoreNukeSuggestionTile(game, context, seed);
      if (candidate) {
        rawCandidates.push(candidate);
      }
    }

    rawCandidates.sort((a, b) => b.totalScore - a.totalScore);
    const refinedCandidates = rawCandidates.slice(0, spec.maxRefineSeeds);
    for (const candidate of refinedCandidates) {
      rawCandidates.push(refineNukeSuggestionCandidate(game, context, candidate));
    }

    const candidates = dedupeNukeSuggestionCandidates(rawCandidates).slice(
      0,
      limit || NUKE_SUGGESTION_MAX_FINAL_CANDIDATES,
    );
    const candidatesWithSource = [];

    for (const candidate of candidates) {
      const sourceSilo = findClosestReadySilo(game, candidate.tile, context.readySilos);
      if (!sourceSilo) {
        continue;
      }

      const sourceTile = getUnitTile(sourceSilo);
      if (sourceTile === null) {
        continue;
      }

      const directionPlan = chooseBestNukeRocketDirection(
        game,
        sourceTile,
        candidate.tile,
        context.targetSams,
      );
      const interceptingSam = directionPlan.interceptingSams[0] || null;
      const candidateWithSource = {
        ...candidate,
        sourceTile,
        rocketDirectionUp: directionPlan.rocketDirectionUp,
        interceptingSamTile: getUnitTile(interceptingSam),
        intercepted: Boolean(interceptingSam),
      };
      candidatesWithSource.push(candidateWithSource);
    }

    return candidatesWithSource;
  }

  function computeNukeSuggestionForType(game, baseContext, spec) {
    const candidates = computeNukeCandidatesForType(
      game,
      baseContext,
      spec,
      NUKE_SUGGESTION_MAX_FINAL_CANDIDATES,
    );
    return (
      candidates.find((candidate) => !candidate.intercepted) ||
      candidates[0] ||
      null
    );
  }

  function computeEconomicNukeSuggestion(game, baseContext) {
    const atomSpec = NUKE_SUGGESTION_TYPES.find((spec) => spec.id === "atom");
    const hydrogenSpec = NUKE_SUGGESTION_TYPES.find((spec) => spec.id === "hydrogen");

    function computeForSpec(spec) {
      if (!shouldComputeNukeSuggestionSpec(game, baseContext.myPlayer, spec)) {
        return null;
      }

      return computeNukeSuggestionForType(game, baseContext, {
        ...NUKE_ECONOMIC_SUGGESTION,
        id: `economic-${spec.id}`,
        label: spec.id === "hydrogen" ? "Eco hydrogen" : "Eco atom",
        type: spec.type,
        sourceLabel: spec.label,
        maxRawSeeds: Math.min(
          NUKE_ECONOMIC_SUGGESTION.maxRawSeeds,
          spec.maxRawSeeds,
        ),
        maxRefineSeeds: Math.min(
          NUKE_ECONOMIC_SUGGESTION.maxRefineSeeds,
          spec.maxRefineSeeds,
        ),
        scoreMode: "economic",
      });
    }

    const atomCandidate = computeForSpec(atomSpec);
    const hydrogenCandidate = computeForSpec(hydrogenSpec);
    const suggestions = [];
    if (atomCandidate) {
      suggestions.push(atomCandidate);
    }

    if (!hydrogenCandidate) {
      return suggestions;
    }
    if (!atomCandidate) {
      return [hydrogenCandidate];
    }

    const hydrogenAvoidsInterception =
      atomCandidate.intercepted && !hydrogenCandidate.intercepted;
    const hydrogenExtraScore = hydrogenCandidate.totalScore - atomCandidate.totalScore;
    const hydrogenIsMeaningfullyBetter =
      hydrogenExtraScore >= NUKE_ECONOMIC_HYDROGEN_MIN_GAIN &&
      hydrogenCandidate.totalScore >=
        atomCandidate.totalScore * NUKE_ECONOMIC_HYDROGEN_GAIN_RATIO;

    if (hydrogenAvoidsInterception || hydrogenIsMeaningfullyBetter) {
      suggestions.push(hydrogenCandidate);
    }

    return suggestions;
  }

  function buildNukeSuggestionBaseContext(game, targetPlayer) {
    const myPlayer = game?.myPlayer?.();
    if (!myPlayer?.isPlayer?.() || !isEnemyNukeSuggestionTarget(game, targetPlayer)) {
      return null;
    }

    const readySilos = collectReadyNukeSilos(myPlayer);
    if (readySilos.length === 0) {
      return null;
    }

    const allySmallIds = collectAlliedPlayerSmallIds(game, myPlayer);
    const tileInfo = collectTargetTileInfo(game, targetPlayer, myPlayer, allySmallIds);
    if (!tileInfo) {
      return null;
    }

    return {
      myPlayer,
      targetPlayer,
      tileInfo,
      readySilos,
      targetSams: collectRelevantSams(game, myPlayer, targetPlayer, tileInfo),
      structures: collectTargetStructures(targetPlayer),
      teamStructures: collectTeamStructures(game, myPlayer),
      allySmallIds,
      alliedStructures: collectAlliedStructures(game, allySmallIds),
      allianceBreakThreshold: getNukeAllianceBreakThreshold(game),
    };
  }

  function computeNukeSuggestions(game, targetPlayer, options = null) {
    const myPlayer = game?.myPlayer?.();
    const baseContext = buildNukeSuggestionBaseContext(game, targetPlayer);
    if (!baseContext) {
      return [];
    }

    const requestedMode = options?.mode || "all";
    const includePopulation =
      requestedMode === "all" || requestedMode === "population";
    const includeEconomic =
      requestedMode === "all" || requestedMode === "economic";
    const populationSuggestions = includePopulation
      ? NUKE_SUGGESTION_TYPES
        .filter((spec) => shouldComputeNukeSuggestionSpec(game, myPlayer, spec))
        .map((spec) => computeNukeSuggestionForType(game, baseContext, spec))
        .filter(Boolean)
      : [];
    const economicSuggestions = includeEconomic
      ? computeEconomicNukeSuggestion(game, baseContext)
      : [];

    return [...populationSuggestions, ...economicSuggestions];
  }

  function formatNukeSuggestionPopulation(value) {
    const rounded = Math.round(value);
    if (rounded >= 1_000_000) {
      return `${(rounded / 1_000_000).toFixed(1)}M`;
    }
    if (rounded >= 1000) {
      return `${(rounded / 1000).toFixed(1)}k`;
    }
    return String(rounded);
  }

  function formatNukeSuggestionLabel(result) {
    if (result.intercepted) {
      return `${result.spec.label}: SAM covered`;
    }

    if (result.spec.scoreMode === "economic") {
      const parts = [
        `${result.spec.label}: ${formatNukeSuggestionPopulation(result.totalScore)} econ`,
      ];
      if (result.economicStructuresHit > 0) {
        parts.push(`${result.economicStructuresHit} structures`);
      }
      return parts.join(", ");
    }

    const parts = [
      `${result.spec.label}: ${formatNukeSuggestionPopulation(result.totalScore)} pop`,
    ];
    if (result.citiesHit > 0) {
      parts.push(`${result.citiesHit} cities`);
    }
    return parts.join(", ");
  }

  function getNukeSuggestionSignature(game, targetPlayer) {
    const myPlayer = game?.myPlayer?.();
    const targetId = getPlayerSmallId(targetPlayer);
    const myId = getPlayerSmallId(myPlayer);
    const tickBucket = Math.floor(toFiniteNumber(game?.ticks?.(), 0) / 10);
    const siloState = collectReadyNukeSilos(myPlayer)
      .map((unit) => `${unit.id?.()}:${getUnitTile(unit)}:${getUnitLevel(unit)}:${getMissileTimerQueue(unit).join(",")}`)
      .join("|");
    const samState = collectTargetSams(targetPlayer)
      .map((unit) => `${unit.id?.()}:${getUnitTile(unit)}:${getUnitLevel(unit)}:${getMissileTimerQueue(unit).join(",")}`)
      .join("|");
    const tilesOwned = toFiniteNumber(targetPlayer?.numTilesOwned?.(), 0);

    return `${myId}:${targetId}:${tickBucket}:${tilesOwned}:${siloState}:${samState}`;
  }

  function renderNukeSuggestions(container, game, transform, results) {
    const activeIds = new Set();

    for (const result of results) {
      let screenPos = null;
      try {
        screenPos = transform.worldToScreenCoordinates({ x: result.x, y: result.y });
      } catch (_error) {
        screenPos = null;
      }

      if (!Number.isFinite(screenPos?.x) || !Number.isFinite(screenPos?.y)) {
        continue;
      }

      const radius = Math.max(
        12,
        getNukeSuggestionScreenRadius(
          transform,
          { ...screenPos, worldX: result.x, worldY: result.y },
          result.magnitude.outer,
        ),
      );
      if (
        screenPos.x < -radius - 220 ||
        screenPos.y < -radius - 220 ||
        screenPos.x > window.innerWidth + radius + 220 ||
        screenPos.y > window.innerHeight + radius + 220
      ) {
        continue;
      }

      const markerId = result.id;
      activeIds.add(markerId);

      let cached = nukeSuggestionDomCache.get(markerId);
      if (!cached) {
        const zone = document.createElement("div");
        zone.className = "openfront-helper-nuke-suggestion-zone";
        zone.dataset.suggestionId = markerId;
        container.appendChild(zone);

        const label = document.createElement("div");
        label.className = "openfront-helper-nuke-suggestion-label";
        label.dataset.suggestionId = markerId;
        container.appendChild(label);

        // Static CSS properties set once on element creation — never change.
        const labelGap = markerId.startsWith("economic")
          ? "22px"
          : markerId === "hydrogen" ? "16px" : "10px";
        for (const element of [zone, label]) {
          element.style.setProperty("--suggestion-color", result.spec.color);
          element.style.setProperty("--suggestion-fill", result.spec.fill);
          element.style.setProperty("--suggestion-glow", result.spec.glow);
          element.style.setProperty("--suggestion-label-gap", labelGap);
        }

        cached = {
          zone,
          label,
          lastX: Infinity,
          lastY: Infinity,
          lastRadius: Infinity,
          lastStatus: null,
        };
        nukeSuggestionDomCache.set(markerId, cached);
      }

      const { zone, label } = cached;
      const status = result.intercepted ? "blocked" : "active";

      if (cached.lastStatus !== status) {
        cached.lastStatus = status;
        zone.dataset.suggestionStatus = status;
        label.dataset.suggestionStatus = status;
      }

      // Only update position/size CSS when values have meaningfully changed.
      if (
        Math.abs(screenPos.x - cached.lastX) > 0.5 ||
        Math.abs(screenPos.y - cached.lastY) > 0.5 ||
        Math.abs(radius - cached.lastRadius) > 0.5
      ) {
        cached.lastX = screenPos.x;
        cached.lastY = screenPos.y;
        cached.lastRadius = radius;
        for (const element of [zone, label]) {
          element.style.setProperty("--suggestion-x", `${screenPos.x}px`);
          element.style.setProperty("--suggestion-y", `${screenPos.y}px`);
          element.style.setProperty("--suggestion-radius", `${radius}px`);
          element.style.setProperty("--suggestion-diameter", `${radius * 2}px`);
        }
      }

      const newText = formatNukeSuggestionLabel(result);
      if (label.textContent !== newText) {
        label.textContent = newText;
      }
    }

    for (const [id, { zone, label }] of nukeSuggestionDomCache) {
      if (!activeIds.has(id)) {
        zone.remove();
        label.remove();
        nukeSuggestionDomCache.delete(id);
      }
    }
  }

  function clearNukeSuggestionState(container = null) {
    currentNukeSuggestionResults = [];
    lastNukeSuggestionSignature = "";
    lastNukeSuggestionComputedAt = 0;
    lastNukeSuggestionSignatureCheckAt = 0;
    nukeSuggestionTileInfoCache = null;
    nukeSuggestionTileComputeKey = null;
    nukeSuggestionDomCache.clear();
    container?.replaceChildren();
  }

  function isAutoNukeRadialTarget(params) {
    if (!autoNukeEnabled || !params?.game || !params?.myPlayer?.isPlayer?.()) {
      return false;
    }
    if (!params.selected?.isPlayer?.() || !params.selected?.isAlive?.()) {
      return false;
    }
    if (getPlayerSmallId(params.myPlayer) === getPlayerSmallId(params.selected)) {
      return false;
    }
    if (isEnemyNukeSuggestionTarget(params.game, params.selected)) {
      return true;
    }
    return autoNukeIncludeAllies;
  }

  function hasAutoNukeBuildTypeAvailable(game, player) {
    return NUKE_SUGGESTION_TYPES.some((spec) =>
      shouldComputeNukeSuggestionSpec(game, player, spec),
    );
  }

  function isAutoNukeRadialItemDisabled(params) {
    if (!isAutoNukeRadialTarget(params)) {
      return true;
    }

    if (!hasAutoNukeBuildTypeAvailable(params.game, params.myPlayer)) {
      return true;
    }

    return collectReadyNukeSilos(params.myPlayer).length === 0;
  }

  function selectAutoNukeCandidate(game, targetPlayer, mode) {
    const candidates = computeNukeSuggestions(game, targetPlayer, { mode }).filter(
      (candidate) => !candidate.intercepted,
    );
    const matchingCandidates = candidates.filter((candidate) => {
      const isEconomic = candidate.spec?.scoreMode === "economic";
      return mode === "economic" ? isEconomic : !isEconomic;
    });

    matchingCandidates.sort((a, b) => b.totalScore - a.totalScore);
    return matchingCandidates[0] || null;
  }

  function getReadyNukeSiloSlotCount(player) {
    return collectActiveNukeSilos(player)
      .reduce((sum, silo) => {
        const availableSlots = getUnitLevel(silo) - getMissileTimerQueue(silo).length;
        return sum + Math.max(0, availableSlots);
      }, 0);
  }

  function getTotalNukeSiloSlotCount(player) {
    return collectActiveNukeSilos(player)
      .reduce((sum, silo) => sum + Math.max(0, getUnitLevel(silo)), 0);
  }

  function getAutoNukeMinimumAvailableCost(game, player) {
    const costs = NUKE_SUGGESTION_TYPES
      .filter(
        (spec) =>
          spec.type !== "Hydrogen Bomb" &&
          isNukeSuggestionTypeEnabled(game, spec.type),
      )
      .map((spec) => getNukeSuggestionUnitCost(game, player, spec.type))
      .filter((cost) => Number.isFinite(cost) && cost > 0);
    return costs.length > 0 ? Math.min(...costs) : Infinity;
  }

  function getAutoNukeCandidateSpecs(game, player, mode) {
    const baseSpecs = NUKE_SUGGESTION_TYPES.filter(
      (spec) =>
        spec.type !== "Hydrogen Bomb" &&
        isNukeSuggestionTypeEnabled(game, spec.type),
    );

    if (mode === "population") {
      return baseSpecs;
    }

    if (mode === "destruction" || mode === "sams") {
      return baseSpecs.map((spec) => ({
        ...spec,
        id: `${mode}-${spec.id}`,
        label: mode === "sams" ? `SAM ${spec.label}` : `Destroy ${spec.label}`,
        scoreMode: "destruction",
      }));
    }

    return baseSpecs.map((spec) => ({
      ...NUKE_ECONOMIC_SUGGESTION,
      id: `economic-${spec.id}`,
      label: spec.id === "hydrogen" ? "Eco hydrogen" : "Eco atom",
      type: spec.type,
      sourceLabel: spec.label,
      maxRawSeeds: Math.min(
        NUKE_ECONOMIC_SUGGESTION.maxRawSeeds,
        spec.maxRawSeeds,
      ),
      maxRefineSeeds: Math.min(
        NUKE_ECONOMIC_SUGGESTION.maxRefineSeeds,
        spec.maxRefineSeeds,
      ),
      scoreMode: "economic",
    }));
  }

  function scoreAutoNukeSamClearCandidate(game, baseContext, spec, sam, unlockScore) {
    const samTile = getUnitTile(sam);
    if (samTile === null) {
      return null;
    }

    const magnitude = getNukeSuggestionMagnitude(game, spec.type);
    if (
      !isNukeSuggestionTileAllowed(
        game,
        baseContext.myPlayer,
        samTile,
        magnitude,
        baseContext.teamStructures,
      )
    ) {
      return null;
    }

    let cx;
    let cy;
    try {
      cx = game.x(samTile);
      cy = game.y(samTile);
    } catch (_error) {
      return null;
    }

    const outerSquared = magnitude.outer * magnitude.outer;
    const context = {
      ...baseContext,
      game,
      magnitude,
      spec,
      scoreMode: "sam-clear",
    };
    if (wouldNukeSuggestionAffectLauncher(game, context, cx, cy, outerSquared)) {
      return null;
    }
    if (wouldNukeSuggestionBreakAlliance(game, context, cx, cy, outerSquared)) {
      return null;
    }
    if (wouldHydrogenNukeAffectOtherPlayers(context, cx, cy, outerSquared)) {
      return null;
    }

    const hitSamKeys = [];
    const combinedSams = [
      ...(baseContext.targetSams || []),
      ...(baseContext.pendingTargetSams || []),
    ];
    const seenHitSam = new Set();
    for (const targetSam of combinedSams) {
      const targetSamTile = getUnitTile(targetSam);
      if (targetSamTile === null) {
        continue;
      }

      try {
        const dx = game.x(targetSamTile) - cx;
        const dy = game.y(targetSamTile) - cy;
        if (dx * dx + dy * dy <= outerSquared) {
          const samKey = getUnitKey(targetSam);
          if (samKey && !seenHitSam.has(samKey)) {
            seenHitSam.add(samKey);
            hitSamKeys.push(samKey);
          }
        }
      } catch (_error) {
        // Ignore stale SAM refs.
      }
    }

    const samKey = getUnitKey(sam);
    if (!samKey || !hitSamKeys.includes(samKey)) {
      return null;
    }
    const samStackKey = getSamStackKey(sam) || samKey;
    const samClearStackSamKeys = Array.from(new Set([
      ...getSamStackUnitKeys(baseContext.targetSams, samStackKey),
      ...getSamStackUnitKeys(baseContext.pendingTargetSams, samStackKey),
    ]));
    // Compute total level of units in this SAM stack (live + pending). Used to
    // scale insurance overshoot so single weak SAMs don't waste nukes while
    // thick high-level stacks get proper coverage.
    let samClearStackLevelSum = 0;
    const liveSamsInStack = (baseContext.targetSams || []).filter(
      (s) => samClearStackSamKeys.includes(getUnitKey(s)),
    );
    for (const s of liveSamsInStack) {
      samClearStackLevelSum += Math.max(1, getUnitLevel(s));
    }
    if (samClearStackLevelSum === 0) {
      samClearStackLevelSum = samClearStackSamKeys.length || 1;
    }

    const sourceSilo = findClosestReadySilo(game, samTile, baseContext.readySilos);
    const sourceTile = getUnitTile(sourceSilo);
    if (sourceTile === null) {
      return null;
    }

    const directionPlan = chooseBestNukeRocketDirection(
      game,
      sourceTile,
      samTile,
      baseContext.targetSams,
    );
    const samClearSpec = {
      ...spec,
      id: `sam-clear-${spec.id}`,
      label: "Clear SAM",
      scoreMode: "sam-clear",
    };
    const interceptingSam = directionPlan.interceptingSams[0] || null;

    const samClearCityInfo = estimateCityPopulationHit(game, context, cx, cy, outerSquared);
    const samClearEconomicInfo = estimateNukeEconomicImpact(context, cx, cy, outerSquared);
    const samClearDestructionWeights = combineDestructionStructureWeights(
      samClearEconomicInfo.hitEconomicStructureWeights,
      samClearCityInfo.hitCityPopulationWeights,
    );

    return {
      id: `sam-clear-${samKey}-${spec.id}`,
      spec: samClearSpec,
      type: spec.type,
      tile: samTile,
      x: cx,
      y: cy,
      magnitude,
      populationLoss: 0,
      cityPopulationHit: 0,
      economicImpact: 0,
      expectedTilesHit: 0,
      innerTiles: 0,
      outerTiles: 0,
      citiesHit: samClearCityInfo.citiesHit,
      economicStructuresHit: samClearEconomicInfo.economicStructuresHit,
      hitEconomicStructureWeights: samClearEconomicInfo.hitEconomicStructureWeights,
      hitCityPopulationWeights: samClearCityInfo.hitCityPopulationWeights,
      hitDestructionStructureWeights: samClearDestructionWeights,
      hitSamKeys,
      samsHit: hitSamKeys.length,
      totalScore: Math.max(1, unlockScore * 0.28),
      sourceTile,
      rocketDirectionUp: directionPlan.rocketDirectionUp,
      interceptingSamTile: getUnitTile(interceptingSam),
      intercepted: Boolean(interceptingSam),
      isSamClear: true,
      samClearStackKey: samStackKey,
      samClearStackSamKeys:
        samClearStackSamKeys.length > 0 ? samClearStackSamKeys : [samKey],
      samClearStackLevelSum,
      samClearOwnedByTarget: isSamOwnedByNukeTarget(baseContext, sam),
    };
  }

  function isAutoNukeBurnStructureForMode(structure, mode) {
    if (structure?.tile == null) {
      return false;
    }
    if (mode === "destruction" || mode === "sams") {
      return structure.type === "City" || getEconomicStructureWeight(structure) > 0;
    }
    if (mode === "economic") {
      return getEconomicStructureWeight(structure) > 0;
    }
    return structure.type === "City";
  }

  function getAutoNukeBurnStructureFallbackScore(structure, mode) {
    if (mode === "destruction" || mode === "sams") {
      return (structure.type === "City" ? getUnitLevel(structure.unit) * 650000 : 0) +
        getEconomicStructureWeight(structure);
    }
    if (mode === "economic") {
      return getEconomicStructureWeight(structure);
    }
    return structure.type === "City" ? getUnitLevel(structure.unit) : 0;
  }

  function scoreAutoNukeTargetBuildingBurnCandidate(
    game,
    baseContext,
    spec,
    sam,
    unlockScore,
    mode,
  ) {
    const samTile = getUnitTile(sam);
    const samKey = getUnitKey(sam);
    if (samTile === null || !samKey) {
      return null;
    }

    const relevantStructures = baseContext.structures
      .filter((structure) => isAutoNukeBurnStructureForMode(structure, mode))
      .sort((a, b) => {
        let distanceA = Infinity;
        let distanceB = Infinity;
        try {
          distanceA = game.manhattanDist(samTile, a.tile);
          distanceB = game.manhattanDist(samTile, b.tile);
        } catch (_error) {
          // Keep invalid stale refs at the end.
        }
        return distanceA - distanceB ||
          getAutoNukeBurnStructureFallbackScore(b, mode) -
            getAutoNukeBurnStructureFallbackScore(a, mode);
      });

    for (const structure of relevantStructures) {
      const targetTile = structure.tile;
      const magnitude = getNukeSuggestionMagnitude(game, spec.type);
      if (
        !isNukeSuggestionTileAllowed(
          game,
          baseContext.myPlayer,
          targetTile,
          magnitude,
          baseContext.teamStructures,
        )
      ) {
        continue;
      }

      let cx;
      let cy;
      try {
        cx = game.x(targetTile);
        cy = game.y(targetTile);
      } catch (_error) {
        continue;
      }

      const outerSquared = magnitude.outer * magnitude.outer;
      const context = {
        ...baseContext,
        game,
        magnitude,
        spec,
        scoreMode: "sam-burn-building",
      };
      if (wouldNukeSuggestionAffectLauncher(game, context, cx, cy, outerSquared)) {
        continue;
      }
      if (wouldNukeSuggestionBreakAlliance(game, context, cx, cy, outerSquared)) {
        continue;
      }
      if (wouldHydrogenNukeAffectOtherPlayers(context, cx, cy, outerSquared)) {
        continue;
      }

      const sourceSilo = findClosestReadySilo(
        game,
        targetTile,
        baseContext.readySilos,
      );
      const sourceTile = getUnitTile(sourceSilo);
      if (sourceTile === null) {
        continue;
      }

      const directionPlan = chooseBestNukeRocketDirection(
        game,
        sourceTile,
        targetTile,
        baseContext.targetSams,
      );
      const interceptsBurn = directionPlan.interceptingSams
        .some((interceptingSam) => getUnitKey(interceptingSam) === samKey);
      if (!interceptsBurn) {
        continue;
      }

      const burnSpec = {
        ...spec,
        id: `sam-burn-${spec.id}`,
        label: "Burn SAM",
        scoreMode: "sam-burn-building",
      };

      return {
        id: `sam-burn-${samKey}-${mode}-${targetTile}-${spec.id}`,
        spec: burnSpec,
        type: spec.type,
        tile: targetTile,
        x: cx,
        y: cy,
        magnitude,
        populationLoss: 0,
        cityPopulationHit: 0,
        economicImpact: 0,
        expectedTilesHit: 0,
        innerTiles: 0,
        outerTiles: 0,
        citiesHit: 0,
        economicStructuresHit: 0,
        hitEconomicStructureWeights: new Map(),
        hitCityPopulationWeights: new Map(),
        hitDestructionStructureWeights: new Map(),
        hitSamKeys: [],
        samsHit: 0,
        totalScore: Math.max(1, unlockScore * 0.08),
        sourceTile,
        rocketDirectionUp: directionPlan.rocketDirectionUp,
        interceptingSamTile: samTile,
        intercepted: true,
        isSamBurnBuilding: true,
        samClearOwnedByTarget: false,
      };
    }

    return null;
  }

  function getAutoNukeSamBurnSpec(game, player) {
    const atomSpec = NUKE_SUGGESTION_TYPES.find((spec) => spec.id === "atom");
    if (atomSpec && isNukeSuggestionTypeEnabled(game, atomSpec.type)) {
      return atomSpec;
    }

    return NUKE_SUGGESTION_TYPES.find(
      (spec) =>
        spec.type !== "Hydrogen Bomb" &&
        isNukeSuggestionTypeEnabled(game, spec.type),
    ) || null;
  }

  function addAutoNukeSamClearCandidates(game, baseContext, specs, candidates, mode) {
    if (!specs.length) {
      return;
    }

    const samUnlockScores = new Map();
    const samsByKey = new Map();
    if (candidates.length > 0) {
      for (const candidate of candidates) {
        if (candidate.sourceTile == null) {
          continue;
        }

        for (const sam of findInterceptingSams(
          game,
          candidate.sourceTile,
          candidate.tile,
          baseContext.targetSams,
          candidate.rocketDirectionUp,
        )) {
          const samKey = getUnitKey(sam);
          if (!samKey) {
            continue;
          }
          samsByKey.set(samKey, sam);
          samUnlockScores.set(
            samKey,
            (samUnlockScores.get(samKey) || 0) + candidate.totalScore,
          );
        }
      }
    }

    const burnSpec = getAutoNukeSamBurnSpec(game, baseContext.myPlayer);
    if (!burnSpec) {
      return;
    }

    if (mode === "destruction" || mode === "sams") {
      const seenTargetSamStacks = new Set();
      for (const sam of baseContext.targetSams || []) {
        if (!isSamOwnedByNukeTarget(baseContext, sam)) {
          continue;
        }
        const stackKey = getSamStackKey(sam) || getUnitKey(sam);
        if (!stackKey || seenTargetSamStacks.has(stackKey)) {
          continue;
        }
        seenTargetSamStacks.add(stackKey);
        const stackSams = (baseContext.targetSams || []).filter(
          (stackSam) => getSamStackKey(stackSam) === stackKey,
        );
        const stackLevel = getSamStackInterceptionCapacity(
          game,
          stackSams.length > 0 ? stackSams : [sam],
        );
        const samKey = getUnitKey(sam);
        if (samKey) {
          samsByKey.set(samKey, sam);
          samUnlockScores.set(
            samKey,
            Math.max(
              samUnlockScores.get(samKey) || 0,
              AUTO_NUKE_DESTRUCTION_SAM_BONUS * Math.max(1, stackLevel),
            ),
          );
        }
      }

      // Also target pending (under-construction) SAMs owned by the target — these
      // will become active mid-attack if we don't destroy them in time.
      for (const sam of baseContext.pendingTargetSams || []) {
        if (!isSamOwnedByNukeTarget(baseContext, sam)) {
          continue;
        }
        const stackKey = getSamStackKey(sam) || getUnitKey(sam);
        if (!stackKey || seenTargetSamStacks.has(stackKey)) {
          continue;
        }
        seenTargetSamStacks.add(stackKey);
        const samKey = getUnitKey(sam);
        if (samKey) {
          samsByKey.set(samKey, sam);
          samUnlockScores.set(
            samKey,
            Math.max(
              samUnlockScores.get(samKey) || 0,
              AUTO_NUKE_DESTRUCTION_SAM_BONUS,
            ),
          );
        }
      }
    }

    // For all modes: detect blocking stacks (flight-time-aware) and boost their clear score.
    // A stack is "blocking" when its effective capacity (accounting for SAM cooldown recharge
    // during nuke flight) is so high that regular waves cannot get through without first
    // concentrating fire to destroy it.
    //
    // Also considers SAMs currently under construction (pending) at each stack: if they are
    // expected to come online before our nukes arrive, they contribute to effective capacity.
    // Already-built stacks get an additional +1 upgrade-buffer slot to hedge against the
    // enemy instantly stacking (level++) mid-flight.
    const blockingSamKeys = new Set();
    {
      const regularCandidates = candidates.filter((c) => !c.isSamClear);
      const sampleSize = Math.min(5, regularCandidates.length);
      const typicalFlightTicks = sampleSize > 0
        ? Math.round(
          regularCandidates.slice(0, sampleSize).reduce(
            (s, c) => s + getAutoNukeCandidateFlightTicks(game, c),
            0,
          ) / sampleSize,
        )
        : 180;

      const seenBlockingStacks = new Set();
      const capacityOptions = {
        pendingSamReadyTicks: baseContext.pendingSamReadyTicks,
        currentTick: baseContext.currentTick,
      };

      // Include ALL hostile SAMs (both target-owned and third-party) in blocking stack detection.
      // Third-party hostile SAMs can also block flight paths and need to be clearable.
      for (const sam of baseContext.targetSams || []) {
        const stackKey = getSamStackKey(sam) || getUnitKey(sam);
        if (!stackKey || seenBlockingStacks.has(stackKey)) {
          continue;
        }
        seenBlockingStacks.add(stackKey);

        const stackSams = (baseContext.targetSams || []).filter(
          (s) => getSamStackKey(s) === stackKey,
        );
        const pendingStackSams = getAutoNukePendingStackSams(baseContext, stackKey);
        const effectiveCapacity = estimateSamStackEffectiveCapacity(
          game,
          stackSams.length > 0 ? stackSams : [sam],
          typicalFlightTicks,
          {
            ...capacityOptions,
            pendingSams: pendingStackSams,
            includeUpgradeBuffer: true,
          },
        );

        if (effectiveCapacity >= AUTO_NUKE_BLOCKING_STACK_BASE_CAPACITY) {
          const samKey = getUnitKey(sam);
          if (samKey) {
            samsByKey.set(samKey, sam);
            const blockingBonus = AUTO_NUKE_DESTRUCTION_SAM_BONUS *
              Math.max(1, effectiveCapacity) *
              AUTO_NUKE_BLOCKING_STACK_SCORE_FRACTION;
            if ((samUnlockScores.get(samKey) || 0) < blockingBonus) {
              samUnlockScores.set(samKey, blockingBonus);
            }
            blockingSamKeys.add(samKey);
          }
        }
      }

      // Also consider stacks that have ONLY pending (under-construction) SAMs — a brand
      // new SAM being built where no active SAM exists yet. If it will come online before
      // our nukes arrive, treat it as a blocking stack so subsequent waves can target it.
      for (const sam of baseContext.pendingTargetSams || []) {
        const stackKey = getSamStackKey(sam) || getUnitKey(sam);
        if (!stackKey || seenBlockingStacks.has(stackKey)) {
          continue;
        }
        seenBlockingStacks.add(stackKey);

        const pendingStackSams = getAutoNukePendingStackSams(baseContext, stackKey);
        const effectiveCapacity = estimateSamStackEffectiveCapacity(
          game,
          [],
          typicalFlightTicks,
          {
            ...capacityOptions,
            pendingSams: pendingStackSams,
            includeUpgradeBuffer: false,
          },
        );

        if (effectiveCapacity >= AUTO_NUKE_BLOCKING_STACK_BASE_CAPACITY) {
          const samKey = getUnitKey(sam);
          if (samKey) {
            samsByKey.set(samKey, sam);
            const blockingBonus = AUTO_NUKE_DESTRUCTION_SAM_BONUS *
              Math.max(1, effectiveCapacity) *
              AUTO_NUKE_BLOCKING_STACK_SCORE_FRACTION;
            if ((samUnlockScores.get(samKey) || 0) < blockingBonus) {
              samUnlockScores.set(samKey, blockingBonus);
            }
            blockingSamKeys.add(samKey);
          }
        }
      }
    }

    for (const [samKey, unlockScore] of samUnlockScores) {
      const sam = samsByKey.get(samKey);
      // Only generate explicit SAM-clear candidates for the target player's SAMs.
      // Third-party hostile SAMs are handled in the burn simulation by redirecting
      // extra nukes toward the target player (those nukes get intercepted by the
      // third-party SAM, draining its slots without us targeting another nation).
      if (!isSamOwnedByNukeTarget(baseContext, sam)) {
        continue;
      }
      const clearCandidate = scoreAutoNukeSamClearCandidate(
        game,
        baseContext,
        burnSpec,
        sam,
        unlockScore,
      );
      if (clearCandidate) {
        clearCandidate.isBlockingStack = blockingSamKeys.has(samKey);
        candidates.push(clearCandidate);
      }
    }
  }

  function computeAutoNukeCandidatePool(game, targetPlayer, mode, options = null) {
    const baseContext = buildNukeSuggestionBaseContext(game, targetPlayer);
    if (!baseContext) {
      return {
        baseContext: null,
        candidates: [],
      };
    }

    const autoSams = collectAllHostileSams(game, baseContext.myPlayer);
    const pendingSams = collectPendingHostileSams(game, baseContext.myPlayer);
    const currentTick = getCurrentGameTick(game);
    const pendingSamReadyTicks = new Map();
    const activePendingKeys = new Set();
    for (const sam of pendingSams) {
      const key = getUnitKey(sam);
      if (!key) continue;
      activePendingKeys.add(key);
      pendingSamReadyTicks.set(
        key,
        getPendingSamExpectedReadyTick(game, sam, currentTick),
      );
    }
    // Drop tracker entries for SAMs no longer under construction (finished or destroyed).
    pruneFinishedPendingSamTracker(activePendingKeys);

    const autoContext = {
      ...baseContext,
      targetSams: autoSams.length > 0 ? autoSams : baseContext.targetSams,
      pendingTargetSams: pendingSams,
      pendingSamReadyTicks,
      currentTick,
      readySilos: options?.includeCoolingSilos
        ? collectActiveNukeSilos(baseContext.myPlayer)
        : baseContext.readySilos,
    };
    const candidates = [];
    const specs = getAutoNukeCandidateSpecs(game, autoContext.myPlayer, mode);
    for (const spec of specs) {
      candidates.push(
        ...computeNukeCandidatesForType(
          game,
          autoContext,
          spec,
          AUTO_NUKE_MAX_CANDIDATES_PER_SPEC,
        ),
      );
    }
    addAutoNukeSamClearCandidates(game, autoContext, specs, candidates, mode);

    candidates.sort((a, b) => b.totalScore - a.totalScore);
    return {
      baseContext: autoContext,
      candidates,
    };
  }

  function getSamInterceptionCapacity(game, sam) {
    const readySlots = Math.max(0, getUnitLevel(sam) - getMissileTimerQueue(sam).length);
    if (readySlots > 0) {
      return readySlots;
    }

    const availableAt = getMissileAvailabilityTick(game, sam, getSamCooldown(game));
    return Number.isFinite(availableAt) ? 1 : 0;
  }

  function getSamStackInterceptionCapacity(_game, sams) {
    return (sams || []).reduce((sum, sam) => sum + getUnitLevel(sam), 0);
  }

  // Returns the total interception capacity of a SAM stack accounting for cooldown recharge
  // during the nuke flight: a SAM slot that fires early can reload and fire again before landing.
  //
  // Options:
  //   pendingSams                 — array of under-construction SAMs at this stack.
  //   pendingSamReadyTicks        — Map<samKey, expectedReadyTick>.
  //   currentTick                 — current game tick (for pending readiness comparison).
  //   includeUpgradeBuffer        — add AUTO_NUKE_SAM_UPGRADE_BUFFER to account for a
  //                                 possible instant-upgrade (stacking) during flight.
  function estimateSamStackEffectiveCapacity(
    game,
    sams,
    candidateFlightTicks,
    options = null,
  ) {
    let base = getSamStackInterceptionCapacity(game, sams);

    // Include pending SAMs whose construction will complete before our nukes land.
    const pendingSams = options?.pendingSams || null;
    if (pendingSams && pendingSams.length > 0) {
      const readyTicks = options?.pendingSamReadyTicks;
      const currentTick = Number.isFinite(options?.currentTick)
        ? options.currentTick
        : getCurrentGameTick(game);
      const arrivalTick = currentTick + Math.max(0, Number(candidateFlightTicks) || 0);
      for (const sam of pendingSams) {
        const key = getUnitKey(sam);
        const readyAt = readyTicks?.get?.(key);
        if (Number.isFinite(readyAt) && readyAt <= arrivalTick) {
          base += getUnitLevel(sam);
        }
      }
    }

    // Instant-upgrade safety buffer: only meaningful if the stack already has a
    // live SAM the enemy can upgrade.
    if (options?.includeUpgradeBuffer && (sams || []).length > 0) {
      base += AUTO_NUKE_SAM_UPGRADE_BUFFER;
    }

    if (!base || !candidateFlightTicks) return base || 0;
    const cooldown = getSamCooldown(game);
    if (!cooldown) return base;
    return base * Math.max(1, Math.ceil(candidateFlightTicks / cooldown));
  }

  // Returns pending SAMs at a given stack key (from baseContext.pendingTargetSams).
  function getAutoNukePendingStackSams(baseContext, stackKey) {
    if (!stackKey) return [];
    return (baseContext?.pendingTargetSams || []).filter(
      (sam) => getSamStackKey(sam) === stackKey,
    );
  }

  function getAutoNukeSamStackSams(baseContext, stackKey, fallbackSams = null) {
    const stackSams = (baseContext.targetSams || []).filter(
      (sam) => getSamStackKey(sam) === stackKey,
    );
    return stackSams.length > 0 ? stackSams : fallbackSams || [];
  }

  function getAutoNukeSamStackSlots(game, baseContext, state, stackKey, fallbackSams = null) {
    const existing = state.samSlotAvailableTicks?.get?.(stackKey);
    if (Array.isArray(existing)) {
      return [...existing].sort((a, b) => a - b);
    }

    return getSamStackMissileSlotAvailableTicks(
      game,
      getAutoNukeSamStackSams(baseContext, stackKey, fallbackSams),
    );
  }

  function findAutoNukeSamStackInterceptionSlot(
    game,
    stack,
    slotAvailableTicks,
    candidate,
    shotIndexOffset,
    state = null,
  ) {
    if (!stack?.sams?.length || candidate?.sourceTile == null || candidate?.tile == null) {
      return null;
    }

    const trajectory = createNukeSuggestionTrajectory(
      game,
      candidate.sourceTile,
      candidate.tile,
      candidate.rocketDirectionUp,
    );
    const launchOffsetTicks = getAutoNukeShotLaunchOffsetTicks(shotIndexOffset);
    let best = null;

    for (let slotIndex = 0; slotIndex < slotAvailableTicks.length; slotIndex++) {
      const slotAvailableAt = Math.max(
        0,
        Math.floor(Number(slotAvailableTicks[slotIndex]) || 0),
      );
      for (const sam of stack.sams) {
        const samKey = getUnitKey(sam);
        const opportunity = findSamInterceptionOpportunity(
          game,
          candidate.sourceTile,
          candidate.tile,
          trajectory,
          sam,
          stack.sams,
          candidate.rocketDirectionUp,
          launchOffsetTicks,
          slotAvailableAt,
        );
        if (
          opportunity &&
          isAutoNukeSamDestroyedBeforeTick(state, samKey, opportunity.shootTick)
        ) {
          continue;
        }
        if (
          opportunity &&
          (!best || opportunity.shootTick < best.shootTick)
        ) {
          best = {
            ...opportunity,
            slotIndex,
          };
        }
      }
    }

    return best;
  }

  function cloneAutoNukeSamSlotUpdates(updates) {
    const cloned = new Map();
    for (const [stackKey, slots] of updates || []) {
      cloned.set(stackKey, [...slots]);
    }
    return cloned;
  }

  function cloneAutoNukeTickMap(map) {
    const cloned = new Map();
    for (const [key, tick] of map || []) {
      const numericTick = Number(tick);
      if (key && Number.isFinite(numericTick)) {
        cloned.set(key, numericTick);
      }
    }
    return cloned;
  }

  function getAutoNukeCandidateFlightTicks(game, candidate) {
    if (candidate?.sourceTile == null || candidate?.tile == null) {
      return 0;
    }

    try {
      return createNukeSuggestionTrajectory(
        game,
        candidate.sourceTile,
        candidate.tile,
        candidate.rocketDirectionUp,
      ).length;
    } catch (_error) {
      return 0;
    }
  }

  function getAutoNukeCandidateLandingTick(game, candidate, shotIndex) {
    return getAutoNukeShotLaunchOffsetTicks(shotIndex) +
      getAutoNukeCandidateFlightTicks(game, candidate);
  }

  function isAutoNukeSamDestroyedBeforeTick(state, samKey, tick) {
    if (!samKey) {
      return false;
    }

    const destroyedAt = Number(state?.samDestroyedAtTicks?.get?.(samKey));
    return Number.isFinite(destroyedAt) && destroyedAt <= tick;
  }

  function applyAutoNukeInterceptionPlan(state, plan) {
    for (const shotSam of plan.shotSamKeys || []) {
      state.usedSamShots.set(
        shotSam.key,
        (state.usedSamShots.get(shotSam.key) || 0) + 1,
      );
    }

    if (!state.samSlotAvailableTicks) {
      state.samSlotAvailableTicks = new Map();
    }
    for (const [stackKey, slots] of plan.samSlotUpdates || []) {
      state.samSlotAvailableTicks.set(stackKey, [...slots].sort((a, b) => a - b));
    }
  }

  function groupInterceptingSamsByStack(interceptingSams, baseContext) {
    const stacks = new Map();

    for (const sam of interceptingSams) {
      const stackKey = getSamStackKey(sam) || getUnitKey(sam);
      if (!stackKey) {
        continue;
      }

      let stack = stacks.get(stackKey);
      if (!stack) {
        stack = {
          key: stackKey,
          sams: [],
          ownedByTarget: isSamOwnedByNukeTarget(baseContext, sam),
        };
        stacks.set(stackKey, stack);
      }
      stack.sams.push(sam);
    }

    return Array.from(stacks.values()).sort((a, b) => {
      if (a.ownedByTarget === b.ownedByTarget) {
        return 0;
      }
      return a.ownedByTarget ? 1 : -1;
    });
  }

  function getAutoNukeInterceptionPlan(
    game,
    baseContext,
    candidate,
    state,
    mode,
    shotIndexOffset = 0,
  ) {
    if (candidate.sourceTile == null) {
      return {
        shotsNeededBeforeLanding: Infinity,
        shotSamKeys: [],
        samSlotUpdates: new Map(),
      };
    }

    const shotSamKeys = [];
    const samSlotUpdates = new Map();
    const routeInterceptorStacks = groupInterceptingSamsByStack(
      baseContext.targetSams || [],
      baseContext,
    );
    const launchTick = getAutoNukeShotLaunchOffsetTicks(shotIndexOffset);

    // Pre-build simStack for every route interceptor stack.
    // This lets us do cross-stack burn interception checks: when a burn nuke aimed at
    // stack A flies over stack B first, B fires (not A). We need B's simStack available
    // inside A's burn loop to find which stack fires earliest.
    const simStacksByKey = new Map();
    for (const stack of routeInterceptorStacks) {
      if (!stack.key) continue;
      const stackSams = getAutoNukeSamStackSams(baseContext, stack.key, stack.sams);
      simStacksByKey.set(stack.key, {
        ...stack,
        sams: stackSams.length > 0 ? stackSams : stack.sams,
      });
    }

    // Helper: given a burn candidate being fired, find which stack (among all route
    // interceptors) shoots at it first (lowest shootTick). Returns the key and slot info
    // of the actual interceptor, consuming from samSlotUpdates correctly.
    const findActualBurnInterceptor = (burnCandidate, currentStackKey, currentSimStack, currentSlots) => {
      // Check the current stack first as baseline
      const currentInterception = findAutoNukeSamStackInterceptionSlot(
        game,
        currentSimStack,
        currentSlots,
        burnCandidate,
        shotIndexOffset + shotSamKeys.length,
        state,
      );
      if (!currentInterception) {
        // Current stack doesn't intercept — return null to signal can't burn
        return null;
      }

      let bestKey = currentStackKey;
      let bestShootTick = currentInterception.shootTick;
      let bestSlotIndex = currentInterception.slotIndex;
      let bestOwnedByTarget = currentSimStack.ownedByTarget;

      // Check all other stacks — the one with the earliest shootTick fires (targetedBySAM mechanic)
      for (const [otherKey, otherSimStack] of simStacksByKey) {
        if (otherKey === currentStackKey) continue;

        const otherUnitKeys = getSamStackUnitKeys(baseContext.targetSams, otherKey);
        if (
          otherUnitKeys.length > 0 &&
          otherUnitKeys.every((k) => isAutoNukeSamDestroyedBeforeTick(state, k, launchTick))
        ) {
          continue;
        }

        const otherCurrentSlots = samSlotUpdates.has(otherKey)
          ? [...samSlotUpdates.get(otherKey)]
          : getAutoNukeSamStackSlots(game, baseContext, state, otherKey, otherSimStack.sams);

        const otherInterception = findAutoNukeSamStackInterceptionSlot(
          game,
          otherSimStack,
          otherCurrentSlots,
          burnCandidate,
          shotIndexOffset + shotSamKeys.length,
          state,
        );

        if (otherInterception && otherInterception.shootTick < bestShootTick) {
          bestKey = otherKey;
          bestShootTick = otherInterception.shootTick;
          bestSlotIndex = otherInterception.slotIndex;
          bestOwnedByTarget = otherSimStack.ownedByTarget;
        }
      }

      return {
        key: bestKey,
        shootTick: bestShootTick,
        slotIndex: bestSlotIndex,
        ownedByTarget: bestOwnedByTarget,
      };
    };

    // Helper: apply a burn interception result to samSlotUpdates and update the local
    // stackSlots reference if the actual firer is the current stack.
    const applyBurnInterception = (result, currentStackKey, currentSlots) => {
      const { key: actualKey, shootTick, slotIndex } = result;
      let actualSlots;
      if (actualKey === currentStackKey) {
        actualSlots = currentSlots;
      } else {
        const otherSimStack = simStacksByKey.get(actualKey);
        actualSlots = samSlotUpdates.has(actualKey)
          ? [...samSlotUpdates.get(actualKey)]
          : getAutoNukeSamStackSlots(game, baseContext, state, actualKey, otherSimStack?.sams);
      }
      actualSlots[slotIndex] = shootTick + getSamCooldown(game) + 1;
      actualSlots = actualSlots.sort((a, b) => a - b);
      samSlotUpdates.set(actualKey, [...actualSlots]);
      // Return updated currentSlots if it was modified (alias check)
      return actualKey === currentStackKey ? [...actualSlots] : currentSlots;
    };

    for (const stack of routeInterceptorStacks) {
      if (!stack.key) {
        continue;
      }

      const stackUnitKeys = getSamStackUnitKeys(baseContext.targetSams, stack.key);
      if (
        stackUnitKeys.length > 0 &&
        stackUnitKeys.every((samKey) =>
          isAutoNukeSamDestroyedBeforeTick(state, samKey, launchTick),
        )
      ) {
        continue;
      }

      const simStack = simStacksByKey.get(stack.key);
      if (!simStack) continue;

      let stackSlots = samSlotUpdates.has(stack.key)
        ? [...samSlotUpdates.get(stack.key)]
        : getAutoNukeSamStackSlots(game, baseContext, state, stack.key, simStack.sams);
      const firstMainInterception = findAutoNukeSamStackInterceptionSlot(
        game,
        simStack,
        stackSlots,
        candidate,
        shotIndexOffset + shotSamKeys.length,
        state,
      );
      if (!firstMainInterception) {
        continue;
      }

      const sam = stack.sams[0];
      const ownedByTarget = stack.ownedByTarget;
      // For target-player SAMs: use a dedicated SAM-clear burn candidate.
      // For third-party hostile SAMs: redirect burn shots to the main target candidate.
      // Those nukes fly over the third-party SAM en-route; the third-party SAM intercepts
      // them and drains its own slots — without us ever firing at another nation.
      let burnCandidate;
      if (ownedByTarget) {
        const samBurnSpec = getAutoNukeSamBurnSpec(game, baseContext.myPlayer);
        if (!samBurnSpec) {
          return {
            shotsNeededBeforeLanding: Infinity,
            shotSamKeys: [],
            samSlotUpdates: new Map(),
            burnCost: Infinity,
          };
        }
        burnCandidate = scoreAutoNukeSamClearCandidate(
          game,
          baseContext,
          samBurnSpec,
          sam,
          candidate.totalScore,
        );
      } else {
        burnCandidate = candidate;
      }
      if (!burnCandidate) {
        return {
          shotsNeededBeforeLanding: Infinity,
          shotSamKeys: [],
          samSlotUpdates: new Map(),
          burnCost: Infinity,
        };
      }

      let guard = 0;
      while (guard < AUTO_NUKE_MAX_SAM_BURN_SHOTS_PER_STACK) {
        guard++;
        // Re-read stackSlots: a previous burn iteration may have updated samSlotUpdates
        // for this stack (e.g., via cross-stack consumption).
        if (samSlotUpdates.has(stack.key)) {
          stackSlots = [...samSlotUpdates.get(stack.key)];
        }
        const mainInterception = findAutoNukeSamStackInterceptionSlot(
          game,
          simStack,
          stackSlots,
          candidate,
          shotIndexOffset + shotSamKeys.length,
          state,
        );
        if (!mainInterception) {
          break;
        }

        // Cross-stack burn interception: the burn nuke may fly over another hostile stack
        // before reaching this stack. The first SAM to preshot wins (targetedBySAM mechanic).
        // We find which stack fires earliest and consume THAT stack's slot.
        const burnResult = findActualBurnInterceptor(burnCandidate, stack.key, simStack, stackSlots);
        if (!burnResult) {
          return {
            shotsNeededBeforeLanding: Infinity,
            shotSamKeys: [],
            samSlotUpdates: new Map(),
            burnCost: Infinity,
          };
        }

        stackSlots = applyBurnInterception(burnResult, stack.key, stackSlots);
        shotSamKeys.push({
          key: burnResult.key,
          ownedByTarget: burnResult.ownedByTarget,
          candidate: burnCandidate,
          interceptedAtTick: burnResult.shootTick,
        });
      }

      // Check that this stack is cleared after the burn loop
      if (samSlotUpdates.has(stack.key)) {
        stackSlots = [...samSlotUpdates.get(stack.key)];
      }
      const stillIntercepts = findAutoNukeSamStackInterceptionSlot(
        game,
        simStack,
        stackSlots,
        candidate,
        shotIndexOffset + shotSamKeys.length,
        state,
      );
      if (stillIntercepts) {
        return {
          shotsNeededBeforeLanding: Infinity,
          shotSamKeys: [],
          samSlotUpdates: new Map(),
          burnCost: Infinity,
        };
      }

      // Safety overshoot for heavily stacked SAMs.
      // Key sources of uncertainty our tick-level simulation can't perfectly capture:
      //   - Enemy can INSTANT-upgrade a SAM (level++) during our nuke flight.
      //   - A pending (under-construction) SAM at this stack may finish before landing.
      //   - The real-game missile queue/capacity may diverge from what we observe.
      // Scale safety burns with TOTAL STACK LEVEL (not just unit count) so single high-
      // level SAMs and heavy multi-unit stacks both get proportional overshoot. Also
      // add one burn per pending SAM level that will come online before landing plus a
      // +upgrade buffer per existing stack for instant-upgrade hedging.
      const stackSamCount = simStack.sams?.length || 0;
      const stackLevelSum = (simStack.sams || []).reduce(
        (sum, s) => sum + Math.max(1, getUnitLevel(s)),
        0,
      );
      const pendingStackSams = getAutoNukePendingStackSams(baseContext, stack.key);
      const candidateArrivalTick =
        getCurrentGameTick(game) +
        getAutoNukeCandidateFlightTicks(game, candidate);
      let pendingReadyLevels = 0;
      for (const pSam of pendingStackSams) {
        const readyAt = baseContext.pendingSamReadyTicks?.get?.(getUnitKey(pSam));
        if (Number.isFinite(readyAt) && readyAt <= candidateArrivalTick) {
          pendingReadyLevels += Math.max(1, getUnitLevel(pSam));
        }
      }
      const upgradeBuffer =
        stackSamCount > 0 ? AUTO_NUKE_SAM_UPGRADE_BUFFER : 0;
      const unitBasedSafety =
        Math.max(0, stackSamCount - 1) *
        AUTO_NUKE_SAM_STACK_SAFETY_BURN_PER_EXTRA_LEVEL;
      const levelBasedSafety = Math.ceil(
        stackLevelSum * AUTO_NUKE_SAM_STACK_SAFETY_BURN_LEVEL_FRACTION,
      );
      const safetyBurns = Math.min(
        AUTO_NUKE_SAM_STACK_SAFETY_BURN_CAP,
        Math.max(unitBasedSafety, levelBasedSafety) +
          pendingReadyLevels +
          upgradeBuffer,
      );
      for (let safetyIndex = 0; safetyIndex < safetyBurns; safetyIndex++) {
        if (samSlotUpdates.has(stack.key)) {
          stackSlots = [...samSlotUpdates.get(stack.key)];
        }
        // Apply cross-stack check for safety burns too
        const safetyResult = findActualBurnInterceptor(burnCandidate, stack.key, simStack, stackSlots);
        if (!safetyResult) {
          break;
        }
        stackSlots = applyBurnInterception(safetyResult, stack.key, stackSlots);
        shotSamKeys.push({
          key: safetyResult.key,
          ownedByTarget: safetyResult.ownedByTarget,
          candidate: burnCandidate,
          interceptedAtTick: safetyResult.shootTick,
          safety: true,
        });
      }
    }

    const burnCost = shotSamKeys.reduce((sum, shotSam) => {
      const cost = getNukeSuggestionUnitCost(
        game,
        baseContext.myPlayer,
        shotSam.candidate.spec.type,
      );
      return sum + (Number.isFinite(cost) && cost > 0 ? cost : Infinity);
    }, 0);

    return {
      shotsNeededBeforeLanding: shotSamKeys.length,
      shotSamKeys,
      samSlotUpdates,
      burnCost,
    };
  }

  function getAutoNukeCircleOverlapFactor(
    candidate,
    selectedCandidates,
    spreadMultiplier = 1,
  ) {
    let factor = 1;
    const spread = Math.max(1, Number(spreadMultiplier) || 1);

    for (const selected of selectedCandidates) {
      if (selected.isSamClear) {
        continue;
      }

      const distance = Math.hypot(candidate.x - selected.x, candidate.y - selected.y);
      const smallerRadius = Math.min(
        candidate.magnitude.outer,
        selected.magnitude.outer,
      );
      const largerRadius = Math.max(
        candidate.magnitude.outer,
        selected.magnitude.outer,
      );

      // Heavy overlap: candidate center sits inside most of the already-selected blast zone.
      if (distance < smallerRadius * 0.82 * spread) {
        return 0;
      }
      if (distance < smallerRadius * 1.1 * spread) {
        factor = Math.min(factor, spread > 1 ? 0.08 : 0.15);
      } else if (distance < largerRadius * 1.5 * spread) {
        factor = Math.min(factor, spread > 1 ? 0.28 : 0.45);
      }
    }

    return factor;
  }

  function getAutoNukeRemoteObjectiveFactor(candidate, state) {
    if ((state?.destructionPhase || "") !== "remote") {
      return 1;
    }

    const origin = state.remoteOrigin;
    if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
      return 1.2;
    }

    const distance = Math.hypot(candidate.x - origin.x, candidate.y - origin.y);
    return 1.1 + Math.min(1.75, distance / 150);
  }

  function isAutoNukeSamClearPhase(mode, state) {
    return mode === "sams" ||
      (mode === "destruction" && state?.destructionPhase === "sams") ||
      Boolean(state?.hasPrioritySamClear);
  }

  function isAutoNukeSamClearStackCleared(state, stackKey) {
    if (!stackKey) {
      return true;
    }

    const stackKeys = state?.samClearStackUnitKeys?.get?.(stackKey) || [];
    if (stackKeys.length === 0) {
      return false;
    }

    return stackKeys.every((samKey) => state.destroyedSamKeys.has(samKey));
  }

  function chooseAutoNukeFocusedSamStackKey(candidates, state) {
    if (
      state.focusedSamStackKey &&
      !isAutoNukeSamClearStackCleared(state, state.focusedSamStackKey)
    ) {
      return state.focusedSamStackKey;
    }

    let best = null;
    for (const candidate of candidates || []) {
      const stackKey = candidate.samClearStackKey;
      if (!candidate.isSamClear || !stackKey) {
        continue;
      }

      const stackKeys = candidate.samClearStackSamKeys || [];
      if (stackKeys.length > 0) {
        state.samClearStackUnitKeys.set(stackKey, stackKeys);
      }
      const remainingSamCount = stackKeys.reduce(
        (sum, samKey) => sum + (state.destroyedSamKeys.has(samKey) ? 0 : 1),
        0,
      );
      if (remainingSamCount <= 0) {
        continue;
      }

      const score = remainingSamCount * AUTO_NUKE_DESTRUCTION_SAM_BONUS +
        (candidate.totalScore || 0);
      if (!best || score > best.score) {
        best = {
          stackKey,
          score,
        };
      }
    }

    state.focusedSamStackKey = best?.stackKey || null;
    if (!state.focusedSamStackKey) {
      state.hasPrioritySamClear = false;
    }
    return state.focusedSamStackKey;
  }

  function getAutoNukeMarginalScore(candidate, mode, state) {
    if (candidate.isSamClear || candidate.spec?.scoreMode === "sam-clear") {
      if (mode === "destruction" || mode === "sams") {
        if (mode === "destruction" && state.destructionPhase !== "sams") {
          return 0;
        }
        const samScore = (candidate.hitSamKeys || []).reduce(
          (sum, samKey) => sum + (state.destroyedSamKeys.has(samKey) ? 0 : 1),
          0,
        );
        return samScore > 0 ? candidate.totalScore * 4 : 0;
      }
      return (candidate.hitSamKeys || []).some(
        (samKey) => !state.destroyedSamKeys.has(samKey),
      )
        ? candidate.totalScore
        : 0;
    }

    if (mode === "economic" && candidate.hitEconomicStructureWeights?.size) {
      let marginalEconomicImpact = 0;
      for (const [structureKey, weight] of candidate.hitEconomicStructureWeights) {
        if (!state.hitEconomicStructureKeys.has(structureKey)) {
          marginalEconomicImpact += weight;
        }
      }
      return marginalEconomicImpact;
    }

    if (mode === "destruction") {
      const phase = state.destructionPhase || "buildings";
      if (phase === "sams") {
        // During SAM-clearing, allow unguarded buildings to be struck immediately.
        // Intercepted candidates must wait — their flight path is covered by SAMs.
        if (candidate.intercepted) {
          return 0;
        }
        // Fall through to building impact scoring below.
      }
      let marginalBuildingImpact = 0;
      for (const [structureKey, weight] of candidate.hitDestructionStructureWeights || []) {
        if (!state.hitDestructionStructureKeys.has(structureKey)) {
          marginalBuildingImpact += weight;
        }
      }
      // Only count residual population impact when there are new buildings to destroy.
      // Without this guard, nukes re-fire at already-covered areas for population alone.
      const residualPopulationImpact = marginalBuildingImpact > 0
        ? (candidate.populationLoss || 0) * 0.15
        : 0;
      return (marginalBuildingImpact + residualPopulationImpact) *
        getAutoNukeRemoteObjectiveFactor(candidate, state) *
        getAutoNukeCircleOverlapFactor(
          candidate,
          state.selectedCandidates,
          state.spreadMultiplier,
        );
    }

    if (mode === "sams") {
      return 0;
    }

    // Population mode: marginal score — subtract contributions from already-hit
    // cities/structures so overlapping nukes don't over-value the same buildings.
    // Only add raw troop/territory population loss when there are untracked city or
    // economic targets to justify the shot — prevents re-firing at areas where all
    // named objectives are already covered.
    let marginalCityPop = 0;
    let hasUntrackedObjectives = false;
    for (const [cityKey, weight] of candidate.hitCityPopulationWeights || []) {
      if (!state.hitCityPopulationKeys.has(cityKey)) {
        marginalCityPop += Math.max(0, Number(weight) || 0);
        hasUntrackedObjectives = true;
      }
    }
    for (const [structureKey, weight] of candidate.hitEconomicStructureWeights || []) {
      if (!state.hitEconomicStructureKeys.has(structureKey)) {
        marginalCityPop += Math.max(0, Number(weight) || 0);
        hasUntrackedObjectives = true;
      }
    }
    const marginalPopulation = hasUntrackedObjectives
      ? marginalCityPop + Math.max(0, Number(candidate.populationLoss) || 0)
      : marginalCityPop;
    return marginalPopulation *
      getAutoNukeCircleOverlapFactor(
        candidate,
        state.selectedCandidates,
        state.spreadMultiplier,
      );
  }

  function isAutoNukeHydrogenCandidateEfficient(
    game,
    baseContext,
    candidate,
    candidates,
    mode,
    state,
    marginalScore,
    totalCost,
    remainingGold,
    remainingSiloSlots,
  ) {
    if (candidate.spec?.type !== "Hydrogen Bomb") {
      return true;
    }
    if (isHydrogenCheaperThanFiveAtomNukes(game, baseContext.myPlayer)) {
      return true;
    }

    const atomCost = getNukeSuggestionUnitCost(
      game,
      baseContext.myPlayer,
      "Atom Bomb",
    );
    if (!Number.isFinite(atomCost) || atomCost <= 0) {
      return marginalScore > 0;
    }

    const atomAlternatives = [];
    for (const atomCandidate of candidates) {
      if (
        atomCandidate === candidate ||
        atomCandidate.isSamClear ||
        atomCandidate.spec?.type !== "Atom Bomb"
      ) {
        continue;
      }

      const atomKey = `${atomCandidate.spec.type}:${atomCandidate.tile}`;
      if (state.selectedCandidateKeys.has(atomKey)) {
        continue;
      }

      const atomPlan = getAutoNukeInterceptionPlan(
        game,
        baseContext,
        atomCandidate,
        state,
        mode,
      );
      const atomShotsNeeded = atomPlan.shotsNeededBeforeLanding + 1;
      const atomTotalCost = atomCost + atomPlan.burnCost;
      if (
        !Number.isFinite(atomTotalCost) ||
        atomShotsNeeded > 5 ||
        atomShotsNeeded > remainingSiloSlots ||
        atomTotalCost > remainingGold
      ) {
        continue;
      }

      const atomMarginalScore = getAutoNukeMarginalScore(
        atomCandidate,
        mode,
        state,
      );
      if (atomMarginalScore < AUTO_NUKE_MIN_MARGINAL_SCORE) {
        continue;
      }

      atomAlternatives.push({
        score: atomMarginalScore,
        cost: atomTotalCost,
        shots: atomShotsNeeded,
        density: atomMarginalScore / atomTotalCost,
      });
    }

    atomAlternatives.sort((a, b) =>
      b.density - a.density || b.score - a.score,
    );

    let atomScore = 0;
    let atomTotalCost = 0;
    let atomShots = 0;
    for (const alternative of atomAlternatives) {
      if (atomShots + alternative.shots > 5) {
        continue;
      }
      atomScore += alternative.score;
      atomTotalCost += alternative.cost;
      atomShots += alternative.shots;
      if (atomShots >= 5) {
        break;
      }
    }

    if (atomScore <= 0 || atomTotalCost <= 0) {
      return marginalScore > 0;
    }

    const hydrogenDensity = marginalScore / totalCost;
    const atomDensity = atomScore / atomTotalCost;
    return marginalScore >= atomScore || hydrogenDensity >= atomDensity * 1.05;
  }

  function markAutoNukeCandidateLanded(candidate, state, landingTick = 0) {
    if (!candidate.isSamClear) {
      state.selectedCandidates.push(candidate);
    }

    for (const samKey of candidate.hitSamKeys || []) {
      state.destroyedSamKeys.add(samKey);
      if (!state.samDestroyedAtTicks) {
        state.samDestroyedAtTicks = new Map();
      }
      const currentDestroyedAt = Number(state.samDestroyedAtTicks.get(samKey));
      const destroyedAt = Math.max(0, Math.floor(Number(landingTick) || 0));
      if (!Number.isFinite(currentDestroyedAt) || destroyedAt < currentDestroyedAt) {
        state.samDestroyedAtTicks.set(samKey, destroyedAt);
      }
    }

    for (const structureKey of candidate.hitEconomicStructureWeights?.keys?.() || []) {
      state.hitEconomicStructureKeys.add(structureKey);
    }

    for (const cityKey of candidate.hitCityPopulationWeights?.keys?.() || []) {
      state.hitCityPopulationKeys.add(cityKey);
    }

    for (const structureKey of candidate.hitDestructionStructureWeights?.keys?.() || []) {
      state.hitDestructionStructureKeys.add(structureKey);
    }
  }

  function cloneAutoNukePlanState(state = null) {
    return {
      selectedCandidates: [...(state?.selectedCandidates || [])],
      selectedCandidateKeys: new Set(state?.selectedCandidateKeys || []),
      hitEconomicStructureKeys: new Set(state?.hitEconomicStructureKeys || []),
      hitCityPopulationKeys: new Set(state?.hitCityPopulationKeys || []),
      hitDestructionStructureKeys: new Set(state?.hitDestructionStructureKeys || []),
      destroyedSamKeys: new Set(state?.destroyedSamKeys || []),
      samClearStackUnitKeys: new Map(state?.samClearStackUnitKeys || []),
      focusedSamStackKey: state?.focusedSamStackKey || null,
      samDestroyedAtTicks: cloneAutoNukeTickMap(state?.samDestroyedAtTicks),
      usedSamShots: new Map(state?.usedSamShots || []),
      samSlotAvailableTicks: cloneAutoNukeSamSlotUpdates(
        state?.samSlotAvailableTicks,
      ),
      plannedAtTick: Number.isFinite(Number(state?.plannedAtTick))
        ? Number(state.plannedAtTick)
        : null,
      spreadMultiplier: Math.max(1, Number(state?.spreadMultiplier) || 1),
      destructionPhase: state?.destructionPhase || "buildings",
      hasPrioritySamClear: Boolean(state?.hasPrioritySamClear),
      remoteOrigin: state?.remoteOrigin || null,
    };
  }

  function normalizeAutoNukePlanStateTiming(game, state) {
    const currentTick = getCurrentGameTick(game);
    if (Number.isFinite(Number(state.plannedAtTick))) {
      const elapsedTicks = Math.max(0, currentTick - Number(state.plannedAtTick));
      if (elapsedTicks > 0) {
        for (const [stackKey, slots] of state.samSlotAvailableTicks || []) {
          state.samSlotAvailableTicks.set(
            stackKey,
            slots.map((tick) => Math.max(0, Number(tick) - elapsedTicks)),
          );
        }
        for (const [samKey, destroyedAtTick] of state.samDestroyedAtTicks || []) {
          state.samDestroyedAtTicks.set(
            samKey,
            Math.max(0, Number(destroyedAtTick) - elapsedTicks),
          );
        }
      }
    }
    state.plannedAtTick = currentTick;
  }

  function orderAutoNukeShots(shots) {
    const thirdPartySamShots = [];
    const remainingShots = [];

    for (const shot of shots) {
      const isThirdPartyInterceptSam =
        shot.reason === "sam-intercept" &&
        shot.interceptingSamOwnedByTarget === false;
      const isThirdPartyClearSam =
        shot.reason === "sam-clear" &&
        shot.targetSamOwnedByTarget === false;

      if (isThirdPartyInterceptSam || isThirdPartyClearSam) {
        thirdPartySamShots.push(shot);
      } else {
        remainingShots.push(shot);
      }
    }

    return [...thirdPartySamShots, ...remainingShots];
  }

  function getAutoNukeDestructionObjectiveScore(candidate) {
    const buildingCount = candidate.hitDestructionStructureWeights?.size || 0;
    return buildingCount * AUTO_NUKE_DESTRUCTION_BUILDING_BONUS +
      (candidate.totalScore || 0);
  }

  function createAutoNukePlanMetrics() {
    return {
      populationDamage: 0,
      economicDamage: 0,
      samsDestroyed: 0,
      hitPopulationCandidateKeys: new Set(),
      hitCityPopulationKeys: new Set(),
      hitEconomicStructureKeys: new Set(),
      hitSamKeys: new Set(),
    };
  }

  function addAutoNukeCandidateMetrics(metrics, candidate) {
    if (!metrics || !candidate) {
      return;
    }

    for (const [cityKey, weight] of candidate.hitCityPopulationWeights || []) {
      if (!metrics.hitCityPopulationKeys.has(cityKey)) {
        metrics.hitCityPopulationKeys.add(cityKey);
        metrics.populationDamage += Math.max(0, Number(weight) || 0);
      }
    }

    const populationLoss = Math.max(0, Number(candidate.populationLoss) || 0);
    if (populationLoss > 0) {
      const populationCandidateKey = `${candidate.spec?.type || ""}:${candidate.tile}`;
      if (!metrics.hitPopulationCandidateKeys.has(populationCandidateKey)) {
        metrics.hitPopulationCandidateKeys.add(populationCandidateKey);
        metrics.populationDamage += populationLoss;
      }
    }

    for (const [structureKey, weight] of candidate.hitEconomicStructureWeights || []) {
      if (!metrics.hitEconomicStructureKeys.has(structureKey)) {
        metrics.hitEconomicStructureKeys.add(structureKey);
        metrics.economicDamage += Math.max(0, Number(weight) || 0);
      }
    }

    for (const samKey of candidate.hitSamKeys || []) {
      if (!metrics.hitSamKeys.has(samKey)) {
        metrics.hitSamKeys.add(samKey);
        metrics.samsDestroyed++;
      }
    }
  }

  function finalizeAutoNukePlanMetrics(metrics, shotCount, cost) {
    return {
      shotCount: Math.max(0, Math.floor(Number(shotCount) || 0)),
      cost: Math.max(0, Number(cost) || 0),
      populationDamage: Math.max(0, Number(metrics?.populationDamage) || 0),
      economicDamage: Math.max(0, Number(metrics?.economicDamage) || 0),
      samsDestroyed: Math.max(0, Math.floor(Number(metrics?.samsDestroyed) || 0)),
    };
  }

  function appendAutoNukeDestructionConfirmationShots(
    game,
    baseContext,
    mode,
    state,
    shots,
    remainingGold,
    remainingSiloSlots,
    totalCost,
    confirmationShotLimit = AUTO_NUKE_DESTRUCTION_CONFIRMATION_SHOTS,
    metrics = null,
  ) {
    if (
      (mode !== "destruction" && mode !== "sams") ||
      confirmationShotLimit <= 0 ||
      remainingGold <= 0 ||
      remainingSiloSlots <= 0
    ) {
      return {
        remainingGold,
        remainingSiloSlots,
        totalCost,
      };
    }

    const mainObjectives = state.selectedCandidates
      .filter((candidate) => !candidate.isSamClear && candidate.tile != null)
      .sort((a, b) =>
        getAutoNukeDestructionObjectiveScore(b) -
          getAutoNukeDestructionObjectiveScore(a),
      );
    if (mainObjectives.length === 0) {
      return {
        remainingGold,
        remainingSiloSlots,
        totalCost,
      };
    }

    let confirmationShots = 0;
    let objectiveIndex = 0;
    while (
      confirmationShots < confirmationShotLimit &&
      remainingGold > 0 &&
      remainingSiloSlots > 0 &&
      objectiveIndex < mainObjectives.length * confirmationShotLimit
    ) {
      const candidate = mainObjectives[objectiveIndex % mainObjectives.length];
      objectiveIndex++;

      const nukeCost = getNukeSuggestionUnitCost(
        game,
        baseContext.myPlayer,
        candidate.spec.type,
      );
      if (!Number.isFinite(nukeCost) || nukeCost <= 0) {
        continue;
      }

      const interceptionPlan = getAutoNukeInterceptionPlan(
        game,
        baseContext,
        candidate,
        state,
        mode,
        shots.length,
      );
      const shotsNeeded = interceptionPlan.shotsNeededBeforeLanding + 1;
      const burnCost = interceptionPlan.burnCost || 0;
      const shotCost = nukeCost + burnCost;
      if (
        !Number.isFinite(shotCost) ||
        !Number.isFinite(shotsNeeded) ||
        shotsNeeded > remainingSiloSlots ||
        shotCost > remainingGold
      ) {
        continue;
      }

      for (const shotSam of interceptionPlan.shotSamKeys) {
        shots.push({
          tile: shotSam.candidate.tile,
          sourceTile: shotSam.candidate.sourceTile,
          rocketDirectionUp: shotSam.candidate.rocketDirectionUp,
          spec: shotSam.candidate.spec,
          reason: "sam-intercept",
          interceptingSamKey: shotSam.key,
          interceptingSamOwnedByTarget: shotSam.ownedByTarget,
        });
      }
      applyAutoNukeInterceptionPlan(state, interceptionPlan);

      shots.push({
        tile: candidate.tile,
        sourceTile: candidate.sourceTile,
        rocketDirectionUp: candidate.rocketDirectionUp,
        spec: candidate.spec,
        reason: "confirmation",
      });
      addAutoNukeCandidateMetrics(metrics, candidate);
      markAutoNukeCandidateLanded(
        candidate,
        state,
        getAutoNukeCandidateLandingTick(game, candidate, shots.length - 1),
      );
      remainingGold -= shotCost;
      remainingSiloSlots -= shotsNeeded;
      totalCost += shotCost;
      confirmationShots++;
    }

    return {
      remainingGold,
      remainingSiloSlots,
      totalCost,
    };
  }

  function buildAutoNukePlan(
    game,
    targetPlayer,
    mode,
    options = null,
    candidatePool = null,
  ) {
    const { baseContext, candidates } = candidatePool ||
      computeAutoNukeCandidatePool(
        game,
        targetPlayer,
        mode,
      );
    if (!baseContext || candidates.length === 0) {
      return {
        shots: [],
        score: 0,
        cost: 0,
        budgetGold: 0,
        budgetSiloSlots: 0,
        availableGold: 0,
        availableSiloSlots: 0,
        minimumRequiredGold: Infinity,
        minimumRequiredSiloSlots: Infinity,
        metrics: finalizeAutoNukePlanMetrics(null, 0, 0),
        followupState: cloneAutoNukePlanState(),
        destructionPhase: options?.destructionPhase || "buildings",
      };
    }

    const gold = getPlayerGoldNumber(baseContext.myPlayer);
    const availableGold = Number.isFinite(gold) ? Math.max(0, gold) : 0;
    const overrideSiloSlots = Number(options?.availableSiloSlotsOverride);
    const availableSiloSlots =
      Number.isFinite(overrideSiloSlots) && overrideSiloSlots >= 0
        ? Math.floor(overrideSiloSlots)
        : getReadyNukeSiloSlotCount(baseContext.myPlayer);
    const budgetGold = Math.min(
      availableGold,
      Math.max(0, Number(options?.maxGold ?? availableGold)),
    );
    const budgetSiloSlots = Math.min(
      availableSiloSlots,
      Math.max(0, Math.floor(Number(options?.maxSiloSlots ?? availableSiloSlots))),
    );
    let remainingGold = budgetGold;
    let remainingSiloSlots = budgetSiloSlots;
    const state = cloneAutoNukePlanState(options?.initialState);
    normalizeAutoNukePlanStateTiming(game, state);
    state.spreadMultiplier = Math.max(
      state.spreadMultiplier || 1,
      Number(options?.spreadMultiplier) || 1,
    );
    state.destructionPhase =
      options?.destructionPhase || state.destructionPhase || "buildings";
    if (!state.remoteOrigin && baseContext.tileInfo?.centroid) {
      state.remoteOrigin = {
        x: baseContext.tileInfo.centroid.x,
        y: baseContext.tileInfo.centroid.y,
      };
    }
    const shots = [];
    const metrics = createAutoNukePlanMetrics();
    let totalScore = 0;
    let totalCost = 0;
    let minimumRequiredGold = Infinity;
    let minimumRequiredSiloSlots = Infinity;
    const confirmationShotLimit = mode === "destruction"
      ? Math.max(
        0,
        Math.floor(
          Number(
            options?.confirmationShots ??
              AUTO_NUKE_DESTRUCTION_CONFIRMATION_SHOTS,
          ),
        ),
      )
      : 0;
    const confirmationShotReserve = mode === "destruction"
      ? Math.min(
        confirmationShotLimit,
        Math.max(0, budgetSiloSlots - 2),
      )
      : 0;

    // Detect blocking SAM stacks in pop/eco modes: if any candidate represents a
    // flight-time-aware high-capacity stack, enable the priority SAM-clear phase.
    if (!isAutoNukeSamClearPhase(mode, state)) {
      if (candidates.some((c) => c.isSamClear && c.isBlockingStack)) {
        state.hasPrioritySamClear = true;
      }
    }

    while (remainingSiloSlots > confirmationShotReserve && remainingGold > 0) {
      let best = null;
      const focusedSamStackKey = isAutoNukeSamClearPhase(mode, state)
        ? chooseAutoNukeFocusedSamStackKey(candidates, state)
        : null;

      for (const candidate of candidates) {
        if (
          focusedSamStackKey &&
          candidate.isSamClear &&
          candidate.samClearStackKey !== focusedSamStackKey
        ) {
          continue;
        }

        const candidateKey = `${candidate.spec.type}:${candidate.tile}`;
        if (state.selectedCandidateKeys.has(candidateKey)) {
          continue;
        }

        const nukeCost = getNukeSuggestionUnitCost(
          game,
          baseContext.myPlayer,
          candidate.spec.type,
        );
        if (!Number.isFinite(nukeCost) || nukeCost <= 0) {
          continue;
        }

        const interceptionPlan = getAutoNukeInterceptionPlan(
          game,
          baseContext,
          candidate,
          state,
          mode,
          shots.length,
        );
        const shotsNeeded = interceptionPlan.shotsNeededBeforeLanding + 1;
        const totalCost = nukeCost + interceptionPlan.burnCost;
        if (!Number.isFinite(totalCost) || !Number.isFinite(shotsNeeded)) {
          continue;
        }

        const marginalScore = getAutoNukeMarginalScore(candidate, mode, state);
        if (marginalScore < AUTO_NUKE_MIN_MARGINAL_SCORE) {
          continue;
        }

        // In SAM-clear phase (priority blocking stacks / destruction sams), the entire
        // wave's purpose is to clear SAMs; the real attack follows in a later wave.
        // Don't reserve a followup slot — doing so prevents clearing the last blocking
        // stack when the budget is exactly enough (e.g. 8 slots, 2 stacks × 4 shots each:
        // stack A uses 4, then 4 remain but 4+1=5 > 4 would block stack B).
        // Only apply the reserve in non-priority SAM-clear scenarios (pop/eco modes where
        // SAM clearing is incidental and we still want 1 slot left for actual target nukes).
        const inSamClearPhase = isAutoNukeSamClearPhase(mode, state);
        const reserveFollowupShot =
          candidate.isSamClear && mode !== "sams" && !inSamClearPhase ? 1 : 0;
        const reserveFollowupCost = candidate.isSamClear && mode !== "sams" && !inSamClearPhase
          ? getAutoNukeMinimumAvailableCost(game, baseContext.myPlayer)
          : 0;
        if (
          (
            shotsNeeded + reserveFollowupShot + confirmationShotReserve >
              remainingSiloSlots ||
            totalCost + reserveFollowupCost > remainingGold
          )
        ) {
          minimumRequiredSiloSlots = Math.min(
            minimumRequiredSiloSlots,
            budgetSiloSlots - remainingSiloSlots + shotsNeeded +
              reserveFollowupShot + confirmationShotReserve,
          );
          minimumRequiredGold = Math.min(
            minimumRequiredGold,
            budgetGold - remainingGold + totalCost + reserveFollowupCost,
          );
          continue;
        }
        if (
          !isAutoNukeHydrogenCandidateEfficient(
            game,
            baseContext,
            candidate,
            candidates,
            mode,
            state,
            marginalScore,
            totalCost,
            remainingGold,
            remainingSiloSlots,
          )
        ) {
          continue;
        }

        const valueDensity = marginalScore / totalCost;
        if (
          !best ||
          valueDensity > best.valueDensity ||
          (
            valueDensity === best.valueDensity &&
            marginalScore > best.marginalScore
          )
        ) {
          best = {
            candidate,
            candidateKey,
            interceptionPlan,
            marginalScore,
            nukeCost,
            shotsNeeded,
            totalCost,
            valueDensity,
          };
        }
      }

      if (!best) {
        break;
      }

      for (const shotSam of best.interceptionPlan.shotSamKeys) {
        shots.push({
          tile: shotSam.candidate.tile,
          sourceTile: shotSam.candidate.sourceTile,
          rocketDirectionUp: shotSam.candidate.rocketDirectionUp,
          spec: shotSam.candidate.spec,
          reason: "sam-intercept",
          interceptingSamKey: shotSam.key,
          interceptingSamOwnedByTarget: shotSam.ownedByTarget,
        });
      }
      applyAutoNukeInterceptionPlan(state, best.interceptionPlan);

      const mainShotIndex = shots.length;
      shots.push({
        tile: best.candidate.tile,
        sourceTile: best.candidate.sourceTile,
        rocketDirectionUp: best.candidate.rocketDirectionUp,
        spec: best.candidate.spec,
        reason: best.candidate.isSamClear ? "sam-clear" : "impact",
        targetSamOwnedByTarget: best.candidate.samClearOwnedByTarget,
      });
      addAutoNukeCandidateMetrics(metrics, best.candidate);
      let samOvershootShots = 0;
      if (
        best.candidate.isSamClear &&
        (
          (mode === "destruction" && state.destructionPhase === "sams") ||
          mode === "sams" ||
          (state.hasPrioritySamClear && best.candidate.isBlockingStack && best.candidate.samsHit >= 3)
        )
      ) {
        const remainingSlotsAfterClear = remainingSiloSlots - best.shotsNeeded;
        const remainingGoldAfterClear = remainingGold - best.totalCost;

        // Overshoot is PURE INSURANCE on top of the math-derived shotsNeeded.
        // We tune it based on how risky the stack is:
        //   - single level-1 SAM → 0 (the normal shots already handle it)
        //   - single level-2+ SAM → 1 (hedge against an instant upgrade)
        //   - 2-SAM stack → 1
        //   - 3-SAM stack → 2
        //   - 4+ SAM stack → 3
        //   - high total level (≥10) → +1 extra hedge against instant-upgrades
        //   - blocking stack (inbound nukes depend on this) → +1 hedge
        const samsHit = Math.max(1, best.candidate.samsHit || 1);
        const stackKeys = best.candidate.samClearStackSamKeys || [];
        const liveKeys = stackKeys.filter(
          (k) => !state.destroyedSamKeys.has(k),
        );
        const stackSize = Math.max(samsHit, liveKeys.length);
        const levelSum = Math.max(
          stackSize,
          Number(best.candidate.samClearStackLevelSum) || stackSize,
        );

        let baseOvershoot;
        if (stackSize <= 1) {
          baseOvershoot = levelSum >= 2 ? 1 : 0;
        } else if (stackSize === 2) {
          baseOvershoot = 1;
        } else if (stackSize === 3) {
          baseOvershoot = 2;
        } else {
          baseOvershoot = 3;
        }

        const heavyLevelBonus = levelSum >= 10 ? 1 : 0;
        const blockingBonus =
          best.candidate.isBlockingStack && stackSize >= 3 ? 1 : 0;

        const scaledOvershoot = Math.min(
          AUTO_NUKE_MAX_SAM_OVERSHOOT_SHOTS,
          baseOvershoot + heavyLevelBonus + blockingBonus,
        );
        samOvershootShots = Math.min(
          scaledOvershoot,
          Math.max(0, remainingSlotsAfterClear),
          Math.max(0, Math.floor(remainingGoldAfterClear / best.nukeCost)),
        );
        for (let index = 0; index < samOvershootShots; index++) {
          shots.push({
            tile: best.candidate.tile,
            sourceTile: best.candidate.sourceTile,
            rocketDirectionUp: best.candidate.rocketDirectionUp,
            spec: best.candidate.spec,
            reason: "sam-clear-overshoot",
            targetSamOwnedByTarget: best.candidate.samClearOwnedByTarget,
          });
        }
      }
      state.selectedCandidateKeys.add(best.candidateKey);
      markAutoNukeCandidateLanded(
        best.candidate,
        state,
        getAutoNukeCandidateLandingTick(game, best.candidate, mainShotIndex),
      );
      if (
        isAutoNukeSamClearPhase(mode, state) &&
        isAutoNukeSamClearStackCleared(state, state.focusedSamStackKey)
      ) {
        state.focusedSamStackKey = null;
      }
      remainingGold -= best.totalCost + samOvershootShots * best.nukeCost;
      remainingSiloSlots -= best.shotsNeeded + samOvershootShots;
      totalCost += best.totalCost + samOvershootShots * best.nukeCost;
      if (!best.candidate.isSamClear || mode === "destruction" || mode === "sams" || state.hasPrioritySamClear) {
        totalScore += best.marginalScore;
      }
    }

    const confirmationResult = appendAutoNukeDestructionConfirmationShots(
      game,
      baseContext,
      mode,
      state,
      shots,
      remainingGold,
      remainingSiloSlots,
      totalCost,
      confirmationShotLimit,
      metrics,
    );
    remainingGold = confirmationResult.remainingGold;
    remainingSiloSlots = confirmationResult.remainingSiloSlots;
    totalCost = confirmationResult.totalCost;

    return {
      shots,
      score: totalScore,
      cost: totalCost,
      budgetGold,
      budgetSiloSlots,
      availableGold,
      availableSiloSlots,
      minimumRequiredGold,
      minimumRequiredSiloSlots,
      metrics: finalizeAutoNukePlanMetrics(metrics, shots.length, totalCost),
      followupState: cloneAutoNukePlanState(state),
      destructionPhase: state.destructionPhase,
    };
  }

  function buildAutoNukePlanForMode(
    game,
    targetPlayer,
    mode,
    options = null,
    candidatePool = null,
  ) {
    const plan = buildAutoNukePlan(game, targetPlayer, mode, options, candidatePool);
    if (
      mode !== "destruction" ||
      options?.destructionPhase !== "sams" ||
      !options?.allowDestructionPhaseFallback ||
      plan.shots.length > 0 ||
      plan.score > 0 ||
      Number.isFinite(plan.minimumRequiredGold) ||
      Number.isFinite(plan.minimumRequiredSiloSlots)
    ) {
      return plan;
    }

    return buildAutoNukePlan(
      game,
      targetPlayer,
      mode,
      {
        ...options,
        destructionPhase: "buildings",
        confirmationShots: AUTO_NUKE_DESTRUCTION_CONFIRMATION_SHOTS,
        allowDestructionPhaseFallback: false,
      },
      candidatePool,
    );
  }

  function waitForAutoNukeDelay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function getAutoNukeBuildableUnit(params, candidate) {
    const unitType = candidate?.spec?.type;
    if (!unitType || candidate?.tile == null) {
      return null;
    }

    if (typeof params?.myPlayer?.buildables === "function") {
      try {
        const buildables = await params.myPlayer.buildables(candidate.tile, [unitType]);
        const buildable = Array.from(buildables || []).find(
          (item) => item?.type === unitType,
        );
        if (buildable?.canBuild) {
          return buildable;
        }
      } catch (_error) {
        // Fall back to the broader action lookup.
      }
    }

    if (typeof params?.myPlayer?.actions === "function") {
      try {
        const actions = await params.myPlayer.actions(candidate.tile, [unitType]);
        const buildable = Array.from(actions?.buildableUnits || []).find(
          (item) => item?.type === unitType,
        );
        if (buildable?.canBuild) {
          return buildable;
        }
      } catch (_error) {
        return null;
      }
    }

    return null;
  }

  async function launchAutoNukeCandidate(params, candidate) {
    if (!candidate || candidate.intercepted || candidate.tile == null) {
      return false;
    }

    const buildableUnit = await getAutoNukeBuildableUnit(params, candidate);
    if (!buildableUnit?.canBuild) {
      return false;
    }

    if (
      candidate.spec?.type === "Atom Bomb" ||
      candidate.spec?.type === "Hydrogen Bomb"
    ) {
      const rocketDirectionUp = candidate.rocketDirectionUp !== false;
      if (params?.buildMenu?.uiState) {
        params.buildMenu.uiState.rocketDirectionUp = rocketDirectionUp;
      }
    }

    params?.buildMenu?.sendBuildOrUpgrade?.(buildableUnit, candidate.tile);
    return true;
  }

  function estimateAutoNukeShotLandingDelayMs(game, shot, shotIndex) {
    const sourceTile = Number(shot?.sourceTile);
    const targetTile = Number(shot?.tile);
    if (
      !Number.isFinite(sourceTile) ||
      !Number.isFinite(targetTile) ||
      sourceTile < 0 ||
      targetTile < 0
    ) {
      return AUTO_NUKE_FALLBACK_LANDING_MS +
        shotIndex * AUTO_NUKE_SEQUENCE_DELAY_MS;
    }

    try {
      const trajectoryTicks = createNukeSuggestionTrajectory(
        game,
        sourceTile,
        targetTile,
        shot.rocketDirectionUp,
      ).length;
      return trajectoryTicks * AUTO_NUKE_GAME_TICK_MS +
        shotIndex * AUTO_NUKE_SEQUENCE_DELAY_MS;
    } catch (_error) {
      return AUTO_NUKE_FALLBACK_LANDING_MS +
        shotIndex * AUTO_NUKE_SEQUENCE_DELAY_MS;
    }
  }

  function estimateAutoNukePlanLandingDelayMs(params, plan) {
    const shots = Array.isArray(plan?.shots) ? plan.shots : [];
    if (shots.length === 0) {
      return 0;
    }

    return shots.reduce(
      (maxDelay, shot, index) =>
        Math.max(maxDelay, estimateAutoNukeShotLandingDelayMs(params.game, shot, index)),
      0,
    );
  }

  async function launchAutoNukePlan(params, plan, progress = null) {
    let launchedCount = 0;
    plan.estimatedLandingDelayMs = estimateAutoNukePlanLandingDelayMs(params, plan);
    plan.estimatedImpactAtMs = performance.now() + plan.estimatedLandingDelayMs;

    const panel = ensureAutoNukeProcessPanel();
    const stepsList = panel.querySelector(".openfront-helper-auto-nuke-process-steps");

    // Build one step per shot describing WHY the nuke is fired (not what type it is).
    if (stepsList) {
      const objectiveCtx = progress?.objective || "";
      stepsList.innerHTML = plan.shots.map((shot, i) => {
        const reason = shot?.reason;
        let label;
        if (reason === "sam-intercept") {
          label = shot.interceptingSamOwnedByTarget
            ? "Burn SAM slot (decoy)"
            : "Bait allied SAM fire";
        } else if (reason === "sam-clear") {
          label = shot.targetSamOwnedByTarget === false
            ? "Route thru allied SAM"
            : "Destroy SAM stack";
        } else if (reason === "sam-clear-overshoot") {
          label = "SAM overshoot (insurance)";
        } else if (reason === "confirmation") {
          label = "Confirm destruction";
        } else {
          // "impact" — use the wave objective for context
          label = objectiveCtx === "Destroy SAM stacks" ? "Strike SAM position"
            : objectiveCtx === "Destroy SAMs + unguarded targets" ? "Strike unguarded target"
            : objectiveCtx === "Destroy main buildings" ? "Strike key building"
            : objectiveCtx === "Destroy remote buildings" ? "Remote building strike"
            : objectiveCtx === "Maximize economic damage" ? "Strike economic target"
            : objectiveCtx === "Maximize population damage" ? "Strike population center"
            : "Strike target";
        }
        return `<li data-shot-index="${i}">${label}</li>`;
      }).join("");
    }

    if (progress) {
      updateAutoNukeProcessPanel({
        ...progress,
        detail: `Ready — firing 0/${plan.shots.length}`,
        progress: 0,
      });
    }

    for (const shot of plan.shots) {
      if (launchedCount > 0) {
        await waitForAutoNukeDelay(AUTO_NUKE_SEQUENCE_DELAY_MS);
      }

      const launched = await launchAutoNukeCandidate(params, shot);
      if (!launched) {
        break;
      }

      // Tick off the step for this shot.
      if (stepsList) {
        const item = stepsList.querySelector(`[data-shot-index="${launchedCount}"]`);
        if (item) {
          item.setAttribute("data-done", "");
          item.scrollIntoView?.({ block: "nearest" });
        }
      }

      launchedCount++;
      if (progress) {
        // Show a contextual verb for the NEXT shot being queued, so the message varies.
        const nextShot = plan.shots[launchedCount];
        const nextReason = nextShot?.reason;
        let actionVerb;
        if (!nextShot) {
          actionVerb = "All nukes away";
        } else if (nextReason === "sam-intercept") {
          actionVerb = "Burning SAM slot";
        } else if (nextReason === "sam-clear" || nextReason === "sam-clear-overshoot") {
          actionVerb = "Striking SAM stack";
        } else if (nextReason === "confirmation") {
          actionVerb = "Confirming hit";
        } else {
          actionVerb = "Striking target";
        }
        updateAutoNukeProcessPanel({
          ...progress,
          detail: `${actionVerb} — ${launchedCount}/${plan.shots.length}`,
          progress: plan.shots.length > 0 ? launchedCount / plan.shots.length : 1,
        });
      }
    }

    return launchedCount;
  }

  function hideAutoNukeProcessPanel(delayMs = 0) {
    if (autoNukeProcessHideTimeout !== null) {
      window.clearTimeout(autoNukeProcessHideTimeout);
      autoNukeProcessHideTimeout = null;
    }

    const hide = () => {
      const panel = document.getElementById(AUTO_NUKE_PROCESS_PANEL_ID);
      if (panel) {
        panel.hidden = true;
      }
    };

    const delay = Math.max(0, Number(delayMs) || 0);
    if (delay > 0) {
      autoNukeProcessHideTimeout = window.setTimeout(() => {
        autoNukeProcessHideTimeout = null;
        hide();
      }, delay);
      return;
    }

    hide();
  }

  function getAutoNukePhaseShortLabel(mode, phase) {
    if (phase === "sams") return "SAM clear";
    if (phase === "buildings") return "Building strike";
    if (phase === "remote") return "Cleanup";
    if (phase === "sam-clear") return "SAM burn";
    if (mode === "economic") return "Economy strike";
    if (mode === "population") return "Population strike";
    if (mode === "sams") return "SAM clear";
    return "Strike";
  }

  function renderAutoNukeWaveLog() {
    const panel = document.getElementById(AUTO_NUKE_PROCESS_PANEL_ID);
    if (!panel) return;
    const container = panel.querySelector(".openfront-helper-auto-nuke-process-waves");
    if (!container) return;
    if (autoNukeWaveLog.length === 0) {
      container.innerHTML = "";
      return;
    }
    const doneCount = autoNukeWaveLog.filter((e) => e.status === "done").length;
    const total = autoNukeWaveLog.length;
    const activeIdx = autoNukeWaveLog.findIndex((e) => e.status === "active");
    const currentNum = activeIdx >= 0 ? activeIdx + 1 : doneCount;

    const dots = autoNukeWaveLog.map((entry, i) => {
      let cls = "wave-dot";
      if (entry.status === "done") cls += " wave-dot--done";
      else if (entry.status === "active") cls += " wave-dot--active";
      return `<span class="${cls}" title="${entry.label}">${entry.status === "done" ? "✓" : (i + 1)}</span>`;
    }).join(`<span class="wave-connector"></span>`);

    const activeEntry = activeIdx >= 0 ? autoNukeWaveLog[activeIdx] : null;
    const activeLabel = activeEntry
      ? activeEntry.label.replace(/^Wave \d+ — /, "")
      : (doneCount === total ? "Done" : "");

    container.innerHTML = `
      <div class="wave-summary">
        <span class="wave-summary-label">${activeLabel}</span>
        <span class="wave-summary-count">${currentNum} / ${total}</span>
      </div>
      <div class="wave-track">${dots}</div>
    `;
  }

  function resetAutoNukeWaveLog() {
    autoNukeWaveLog = [];
    renderAutoNukeWaveLog();
  }

  function pushAutoNukeWaveEntry(label, status = "pending") {
    const idx = autoNukeWaveLog.length;
    autoNukeWaveLog.push({ label, status });
    renderAutoNukeWaveLog();
    return idx;
  }

  function setAutoNukeWaveEntryStatus(idx, status) {
    if (idx >= 0 && autoNukeWaveLog[idx]) {
      autoNukeWaveLog[idx].status = status;
      renderAutoNukeWaveLog();
    }
  }

  function activateAutoNukeWaveEntry(idx) {
    setAutoNukeWaveEntryStatus(idx, "active");
  }

  function completeAutoNukeWaveEntry(idx) {
    setAutoNukeWaveEntryStatus(idx, "done");
  }

  // Hide the process panel only after all launched nukes have had time to land,
  // then wait an additional AUTO_NUKE_PROCESS_COMPLETE_HIDE_MS for the user to read it.
  function hideAutoNukeProcessPanelAfterLanding(latestImpactAtMs) {
    const remainingFlightMs = Math.max(0, (latestImpactAtMs || 0) - performance.now());
    hideAutoNukeProcessPanel(remainingFlightMs + AUTO_NUKE_PROCESS_COMPLETE_HIDE_MS);
  }

  function ensureAutoNukeProcessPanelStyles() {
    if (document.getElementById(AUTO_NUKE_PROCESS_PANEL_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = AUTO_NUKE_PROCESS_PANEL_STYLE_ID;
    style.textContent = `
      #${AUTO_NUKE_PROCESS_PANEL_ID} {
        position: fixed;
        right: 14px;
        top: calc(50% + 118px);
        z-index: 9000;
        width: min(320px, calc(100vw - 28px));
        padding: 10px;
        border: 1px solid rgba(56, 189, 248, 0.46);
        border-radius: 8px;
        background: rgba(13, 18, 24, 0.97);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.44);
        color: #f8fafc;
        font: 800 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        transform: translateY(-50%);
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID}[hidden] {
        display: none;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-top {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 5px;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-wave {
        color: #bae6fd;
        font-size: 12px;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-target {
        color: #94a3b8;
        font-size: 11px;
        max-width: 128px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-objective {
        color: #e2e8f0;
        font-size: 11px;
        margin-bottom: 7px;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-track {
        height: 7px;
        overflow: hidden;
        border-radius: 6px;
        background: rgba(51, 65, 85, 0.92);
        margin-bottom: 7px;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-fill {
        width: 0%;
        height: 100%;
        border-radius: 6px;
        background: linear-gradient(90deg, #38bdf8, #facc15);
        transition: width 140ms linear;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID}.openfront-helper-auto-nuke-process-waiting .openfront-helper-auto-nuke-process-fill {
        width: 38%;
        animation: openfront-helper-auto-nuke-process-wait 1.2s ease-in-out infinite alternate;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-detail {
        color: #cbd5e1;
        font-size: 11px;
        font-weight: 750;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-steps {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
        max-height: 120px;
        overflow-y: auto;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-waves {
        margin: 0 0 8px;
        padding: 0;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-waves:empty {
        display: none;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .wave-summary {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 6px;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .wave-summary-label {
        font-size: 11px;
        font-weight: 600;
        color: #e2e8f0;
        letter-spacing: 0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 72%;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .wave-summary-count {
        font-size: 10px;
        font-weight: 500;
        color: #64748b;
        white-space: nowrap;
        flex-shrink: 0;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .wave-track {
        display: flex;
        align-items: center;
        gap: 0;
        flex-wrap: wrap;
        row-gap: 4px;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .wave-connector {
        flex: 1;
        min-width: 6px;
        max-width: 18px;
        height: 1px;
        background: #334155;
        border-radius: 1px;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .wave-dot {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        font-size: 8px;
        font-weight: 700;
        background: #1e293b;
        color: #475569;
        border: 1.5px solid #334155;
        flex-shrink: 0;
        transition: background 200ms, border-color 200ms, color 200ms, box-shadow 200ms;
        cursor: default;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .wave-dot--done {
        background: #14532d;
        border-color: #22c55e;
        color: #4ade80;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .wave-dot--active {
        background: #0c4a6e;
        border-color: #38bdf8;
        color: #7dd3fc;
        box-shadow: 0 0 6px 1px rgba(56, 189, 248, 0.35);
        animation: wave-dot-pulse 1.4s ease-in-out infinite;
      }

      @keyframes wave-dot-pulse {
        0%, 100% { box-shadow: 0 0 6px 1px rgba(56, 189, 248, 0.35); }
        50% { box-shadow: 0 0 10px 3px rgba(56, 189, 248, 0.55); }
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-steps:empty {
        display: none;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-steps li {
        font-size: 10px;
        color: #64748b;
        padding: 1px 0;
        transition: color 100ms;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-steps li::before {
        content: "○ ";
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-steps li[data-done] {
        color: #4ade80;
      }

      #${AUTO_NUKE_PROCESS_PANEL_ID} .openfront-helper-auto-nuke-process-steps li[data-done]::before {
        content: "✓ ";
      }

      @keyframes openfront-helper-auto-nuke-process-wait {
        from { transform: translateX(-16%); }
        to { transform: translateX(180%); }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureAutoNukeProcessPanel() {
    ensureAutoNukeProcessPanelStyles();

    let panel = document.getElementById(AUTO_NUKE_PROCESS_PANEL_ID);
    if (panel) {
      return panel;
    }

    panel = document.createElement("div");
    panel.id = AUTO_NUKE_PROCESS_PANEL_ID;
    panel.hidden = true;
    panel.innerHTML = `
      <div class="openfront-helper-auto-nuke-process-top">
        <div class="openfront-helper-auto-nuke-process-wave"></div>
        <div class="openfront-helper-auto-nuke-process-target"></div>
      </div>
      <div class="openfront-helper-auto-nuke-process-objective"></div>
      <div class="openfront-helper-auto-nuke-process-waves"></div>
      <div class="openfront-helper-auto-nuke-process-track">
        <div class="openfront-helper-auto-nuke-process-fill"></div>
      </div>
      <div class="openfront-helper-auto-nuke-process-detail"></div>
      <ul class="openfront-helper-auto-nuke-process-steps"></ul>
    `;
    (document.body || document.documentElement).appendChild(panel);
    return panel;
  }

  function updateAutoNukeProcessPanel(status = {}) {
    if (autoNukeProcessHideTimeout !== null) {
      window.clearTimeout(autoNukeProcessHideTimeout);
      autoNukeProcessHideTimeout = null;
    }

    const panel = ensureAutoNukeProcessPanel();
    const wave = panel.querySelector(".openfront-helper-auto-nuke-process-wave");
    const target = panel.querySelector(".openfront-helper-auto-nuke-process-target");
    const objective = panel.querySelector(".openfront-helper-auto-nuke-process-objective");
    const fill = panel.querySelector(".openfront-helper-auto-nuke-process-fill");
    const detail = panel.querySelector(".openfront-helper-auto-nuke-process-detail");
    const progress = Math.max(0, Math.min(1, Number(status.progress) || 0));

    panel.classList.toggle(
      "openfront-helper-auto-nuke-process-waiting",
      Boolean(status.waiting),
    );
    if (wave) {
      wave.textContent = status.waveLabel || "Auto nuke";
    }
    if (target) {
      target.textContent = status.targetName || "";
      target.title = status.targetName || "";
    }
    if (objective) {
      objective.textContent = status.objective || "Preparing strike";
    }
    if (fill && !status.waiting) {
      fill.style.width = `${Math.round(progress * 100)}%`;
    }
    if (detail) {
      detail.textContent = status.detail || "";
    }
    renderAutoNukeWaveLog();
    panel.hidden = false;
  }

  function getAutoNukeProcessObjective(mode, phase = null, plan = null) {
    if (mode === "economic") {
      return "Maximize economic damage";
    }
    if (mode === "population") {
      return "Maximize population damage";
    }
    if (phase === "sams") {
      // If the plan also includes unguarded building shots, reflect that.
      const hasBuildings = plan?.shots?.some(
        (s) => s.reason === "impact" || s.reason === "confirmation",
      );
      return hasBuildings ? "Destroy SAMs + unguarded targets" : "Destroy SAM stacks";
    }
    if (phase === "remote") {
      return "Destroy remote buildings";
    }
    if (phase === "buildings") {
      return "Destroy main buildings";
    }
    if (mode === "destruction") {
      return "Total destruction";
    }
    return "Launch nukes";
  }

  function getAutoNukeProcessWaveStatus(params, mode, waveNumber, phase, detail, extra = {}, plan = null) {
    return {
      targetName: getPlayerDisplayName(params.selected),
      waveLabel: `Wave ${waveNumber}`,
      objective: getAutoNukeProcessObjective(mode, phase, plan),
      detail,
      ...extra,
    };
  }

  function canContinueAutoNukeSecondPass(params) {
    return Boolean(
      params?.myPlayer?.isPlayer?.() &&
      params?.selected?.isPlayer?.() &&
      (isEnemyNukeSuggestionTarget(params.game, params.selected) ||
        (autoNukeIncludeAllies && params.selected?.isAlive?.() &&
          getPlayerSmallId(params.myPlayer) !== getPlayerSmallId(params.selected))),
    );
  }

  function buildAutoNukeWavePotentialPlan(params, mode, initialState, waveOptions) {
    const totalSiloSlots = getTotalNukeSiloSlotCount(params.myPlayer);
    const gold = getPlayerGoldNumber(params.myPlayer);
    const availableGold = Number.isFinite(gold) ? Math.max(0, gold) : 0;
    if (totalSiloSlots <= 0 || availableGold <= 0) {
      return null;
    }

    const candidatePool = computeAutoNukeCandidatePool(
      params.game,
      params.selected,
      mode,
      { includeCoolingSilos: true },
    );
    const potentialPlan = buildAutoNukePlan(
      params.game,
      params.selected,
      mode,
      {
        maxGold: availableGold,
        maxSiloSlots: totalSiloSlots,
        availableSiloSlotsOverride: totalSiloSlots,
        initialState,
        spreadMultiplier: waveOptions.spreadMultiplier,
        destructionPhase: waveOptions.destructionPhase,
        confirmationShots: waveOptions.confirmationShots,
      },
      candidatePool,
    );

    return potentialPlan.shots.length > 0 && potentialPlan.score > 0
      ? potentialPlan
      : null;
  }

  async function waitForAutoNukeWavePlan(
    params,
    mode,
    initialState,
    waveOptions,
    processStatus = null,
  ) {
    const potentialPlan = buildAutoNukeWavePotentialPlan(
      params,
      mode,
      initialState,
      waveOptions,
    );
    if (!potentialPlan) {
      return null;
    }

    const totalSiloSlots = getTotalNukeSiloSlotCount(params.myPlayer);
    const readySlotFraction = Number(waveOptions.readySlotFraction) || 0.6;
    const desiredReadySiloSlots = Math.min(
      totalSiloSlots,
      Math.max(
        1,
        Math.min(
          potentialPlan.budgetSiloSlots || totalSiloSlots,
          Math.max(
            2,
            Math.ceil(totalSiloSlots * readySlotFraction),
          ),
        ),
      ),
    );
    const startedAt = performance.now();
    let cachedCandidatePool = null;
    let cachedCandidatePoolAt = -Infinity;
    const CANDIDATE_POOL_TTL_MS = 3500;
    if (processStatus) {
      updateAutoNukeProcessPanel({
        ...processStatus,
        detail: `Waiting for silos ${getReadyNukeSiloSlotCount(params.myPlayer)}/${desiredReadySiloSlots}`,
        waiting: true,
      });
    }
    while (performance.now() - startedAt < AUTO_NUKE_SECOND_PASS_MAX_WAIT_MS) {
      if (!canContinueAutoNukeSecondPass(params)) {
        return null;
      }

      const readySiloSlots = getReadyNukeSiloSlotCount(params.myPlayer);
      const gold = getPlayerGoldNumber(params.myPlayer);
      const availableGold = Number.isFinite(gold) ? Math.max(0, gold) : 0;
      if (readySiloSlots <= 0 || availableGold <= 0) {
        if (processStatus) {
          updateAutoNukeProcessPanel({
            ...processStatus,
            detail: readySiloSlots <= 0
              ? `Waiting for silos 0/${desiredReadySiloSlots}`
              : "Waiting for gold",
            waiting: true,
          });
        }
        await waitForAutoNukeDelay(AUTO_NUKE_SECOND_PASS_POLL_MS);
        continue;
      }
      if (readySiloSlots < desiredReadySiloSlots) {
        if (processStatus) {
          updateAutoNukeProcessPanel({
            ...processStatus,
            detail: `Waiting for silos ${readySiloSlots}/${desiredReadySiloSlots}`,
            waiting: true,
          });
        }
        await waitForAutoNukeDelay(AUTO_NUKE_SECOND_PASS_POLL_MS);
        continue;
      }
      const launchSlotFraction = Number(waveOptions.launchSlotFraction);
      const maxSiloSlots = Number.isFinite(launchSlotFraction) &&
        launchSlotFraction > 0 &&
        launchSlotFraction < 1
        ? Math.max(1, Math.ceil(readySiloSlots * launchSlotFraction))
        : readySiloSlots;

      const nowMs = performance.now();
      if (
        !cachedCandidatePool ||
        nowMs - cachedCandidatePoolAt > CANDIDATE_POOL_TTL_MS
      ) {
        cachedCandidatePool = computeAutoNukeCandidatePool(
          params.game,
          params.selected,
          mode,
          { includeCoolingSilos: true },
        );
        cachedCandidatePoolAt = nowMs;
      }

      const followupPlan = buildAutoNukePlan(
        params.game,
        params.selected,
        mode,
        {
          maxGold: availableGold,
          maxSiloSlots,
          initialState,
          spreadMultiplier: waveOptions.spreadMultiplier,
          destructionPhase: waveOptions.destructionPhase,
          confirmationShots: waveOptions.confirmationShots,
        },
        cachedCandidatePool,
      );
      if (followupPlan.shots.length > 0 && followupPlan.score > 0) {
        return followupPlan;
      }
      // Force refresh next iteration in case stale pool caused empty plan.
      cachedCandidatePool = null;
      if (processStatus) {
        updateAutoNukeProcessPanel({
          ...processStatus,
          detail: "Scanning targets...",
          waiting: true,
        });
      }
      await waitForAutoNukeDelay(AUTO_NUKE_SECOND_PASS_POLL_MS);
    }

    return null;
  }

  async function launchAutoNukeWithOptionalSecondPass(params, mode, tierId, plan) {
    resetAutoNukeWaveLog();
    const isSamOnlyMode = mode === "sams";
    const isDestructionFlow = mode === "destruction" || isSamOnlyMode;
    let waveNumber = 1;

    // Pre-populate wave 1 entry so user sees what's happening immediately.
    const phase1 = isDestructionFlow ? plan.destructionPhase : mode;
    const phase1Label = getAutoNukePhaseShortLabel(mode, phase1);
    const wave1LogIdx = pushAutoNukeWaveEntry(`Wave 1 — ${phase1Label}`, "active");

    const launchedCount = await launchAutoNukePlan(
      params,
      plan,
      getAutoNukeProcessWaveStatus(
        params,
        mode,
        waveNumber,
        phase1,
        `Firing ${plan.shots.length} nukes`,
        {},
        plan,
      ),
    );
    let latestImpactAtMs = plan.estimatedImpactAtMs || 0;
    completeAutoNukeWaveEntry(wave1LogIdx);

    if (launchedCount === 0) {
      console.info(`OpenFront Helper: auto ${mode} nukes could not be launched.`);
      updateAutoNukeProcessPanel(
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          waveNumber,
          isDestructionFlow ? plan.destructionPhase : mode,
          "Launch failed",
          { progress: 1 },
        ),
      );
      hideAutoNukeProcessPanel(AUTO_NUKE_PROCESS_COMPLETE_HIDE_MS);
      return;
    }

    if (!isDestructionFlow) {
      let followupWaveState = plan.followupState;

      // SAM-clear pre-phase: if the first wave contained SAM-clear shots targeting a
      // blocking stack, keep launching concentrated SAM-clear waves until the stacks are
      // gone. These fire before the regular follow-up waves so SAMs are destroyed while
      // the initial nukes are still in flight.
      if (
        followupWaveState?.hasPrioritySamClear &&
        plan.shots.some((s) => s.reason === "sam-clear")
      ) {
        for (let samClearWave = 0; samClearWave < AUTO_NUKE_MAX_PREEMPTIVE_SAM_WAVES; samClearWave++) {
          if (!canContinueAutoNukeSecondPass(params)) {
            break;
          }
          waveNumber++;
          const samClearLogIdx = pushAutoNukeWaveEntry(`Wave ${waveNumber} — SAM burn`, "active");
          const samClearPlan = await waitForAutoNukeWavePlan(
            params,
            mode,
            followupWaveState,
            {
              spreadMultiplier: 1,
              readySlotFraction: AUTO_NUKE_SECOND_PASS_READY_SLOT_FRACTION,
              launchSlotFraction: 1,
              confirmationShots: 0,
            },
            getAutoNukeProcessWaveStatus(
              params,
              mode,
              waveNumber,
              "sam-clear",
              `Burning SAM stacks — wave ${samClearWave + 1}`,
            ),
          );
          if (!samClearPlan || !samClearPlan.shots.some((s) => s.reason === "sam-clear")) {
            waveNumber--;
            completeAutoNukeWaveEntry(samClearLogIdx);
            break;
          }
          const samClearLaunched = await launchAutoNukePlan(
            params,
            samClearPlan,
            getAutoNukeProcessWaveStatus(
              params,
              mode,
              waveNumber,
              "sam-clear",
              `Firing ${samClearPlan.shots.length} SAM-clear nukes`,
            ),
          );
          completeAutoNukeWaveEntry(samClearLogIdx);
          if (samClearLaunched === 0) {
            waveNumber--;
            break;
          }
          latestImpactAtMs = Math.max(latestImpactAtMs, samClearPlan.estimatedImpactAtMs || 0);
          followupWaveState = samClearPlan.followupState;
        }
      }

      let followupWaveNumber = waveNumber + 1;
      let followupWavesLaunched = 0;
      while (followupWavesLaunched < AUTO_NUKE_MAX_FOLLOWUP_WAVES) {
        if (!canContinueAutoNukeSecondPass(params)) {
          break;
        }
        const followupPhaseLabel = getAutoNukePhaseShortLabel(mode, mode);
        const followupLogIdx = pushAutoNukeWaveEntry(
          `Wave ${followupWaveNumber} — ${followupPhaseLabel}`,
          "active",
        );
        const followupWavePlan = await waitForAutoNukeWavePlan(
          params,
          mode,
          followupWaveState,
          {
            spreadMultiplier: AUTO_NUKE_FOLLOWUP_SPREAD_MULTIPLIER,
            readySlotFraction: AUTO_NUKE_SECOND_PASS_READY_SLOT_FRACTION,
            launchSlotFraction: AUTO_NUKE_SECOND_PASS_LAUNCH_SLOT_FRACTION,
            confirmationShots: 0,
          },
          getAutoNukeProcessWaveStatus(
            params,
            mode,
            followupWaveNumber,
            mode,
            `Targeting follow-up — wave ${followupWaveNumber}`,
          ),
        );
        if (!followupWavePlan) {
          completeAutoNukeWaveEntry(followupLogIdx);
          break;
        }
        const followupWaveLaunched = await launchAutoNukePlan(
          params,
          followupWavePlan,
          getAutoNukeProcessWaveStatus(
            params,
            mode,
            followupWaveNumber,
            mode,
            `Firing ${followupWavePlan.shots.length} nukes`,
          ),
        );
        completeAutoNukeWaveEntry(followupLogIdx);
        if (followupWaveLaunched === 0) {
          break;
        }
        latestImpactAtMs = Math.max(
          latestImpactAtMs,
          followupWavePlan.estimatedImpactAtMs || 0,
        );
        followupWaveState = followupWavePlan.followupState;
        followupWavesLaunched++;
        followupWaveNumber++;
      }
      const finalWaveNumber = followupWavesLaunched > 0
        ? followupWaveNumber - 1
        : waveNumber;
      updateAutoNukeProcessPanel(
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          finalWaveNumber,
          mode,
          followupWavesLaunched > 0
            ? `Complete — ${1 + followupWavesLaunched} waves`
            : `Complete — ${launchedCount} nukes`,
          { progress: 1 },
        ),
      );
      hideAutoNukeProcessPanelAfterLanding(latestImpactAtMs);
      return;
    }
    waveNumber++;

    let currentState = plan.followupState;
    let samClearWaveCount = plan.destructionPhase === "sams" ? 1 : 0;
    while (samClearWaveCount > 0 && samClearWaveCount < AUTO_NUKE_MAX_SAM_CLEAR_WAVES) {
      const samWaveLogIdx = pushAutoNukeWaveEntry(`Wave ${waveNumber} — SAM clear`, "active");
      const samWavePlan = await waitForAutoNukeWavePlan(
        params,
        mode,
        currentState,
        {
          destructionPhase: "sams",
          spreadMultiplier: 1,
          readySlotFraction: AUTO_NUKE_SECOND_PASS_READY_SLOT_FRACTION,
          launchSlotFraction: 1,
          confirmationShots: 0,
        },
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          waveNumber,
          "sams",
          "Clearing SAM stacks…",
        ),
      );
      if (!samWavePlan) {
        completeAutoNukeWaveEntry(samWaveLogIdx);
        break;
      }

      const samWaveLaunchedCount = await launchAutoNukePlan(
        params,
        samWavePlan,
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          waveNumber,
          "sams",
          `Firing ${samWavePlan.shots.length} SAM-clear nukes`,
        ),
      );
      completeAutoNukeWaveEntry(samWaveLogIdx);
      if (samWaveLaunchedCount === 0) {
        console.info("OpenFront Helper: total destruction SAM pass could not be launched.");
        updateAutoNukeProcessPanel(
          getAutoNukeProcessWaveStatus(
            params,
            mode,
            waveNumber,
            "sams",
            "SAM clear failed",
            { progress: 1 },
          ),
        );
        hideAutoNukeProcessPanelAfterLanding(latestImpactAtMs);
        return;
      }
      latestImpactAtMs = Math.max(
        latestImpactAtMs,
        samWavePlan.estimatedImpactAtMs || 0,
      );
      currentState = samWavePlan.followupState;
      samClearWaveCount++;
      waveNumber++;
    }

    if (isSamOnlyMode) {
      updateAutoNukeProcessPanel(
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          Math.max(1, waveNumber - 1),
          "sams",
          "All SAMs neutralized",
          { progress: 1 },
        ),
      );
      hideAutoNukeProcessPanelAfterLanding(latestImpactAtMs);
      return;
    }

    // Mark "Building strike" pre-populated entry active (or add if missing).
    const bldgLogIdx = pushAutoNukeWaveEntry(`Wave ${waveNumber} — Building strike`, "active");
    const secondWavePlan = await waitForAutoNukeWavePlan(
      params,
      mode,
      currentState,
      {
        destructionPhase: "buildings",
        spreadMultiplier: AUTO_NUKE_SECOND_PASS_SPREAD_MULTIPLIER,
        readySlotFraction: AUTO_NUKE_SECOND_PASS_READY_SLOT_FRACTION,
        launchSlotFraction: AUTO_NUKE_SECOND_PASS_LAUNCH_SLOT_FRACTION,
        confirmationShots: AUTO_NUKE_DESTRUCTION_CONFIRMATION_SHOTS,
      },
      getAutoNukeProcessWaveStatus(
        params,
        mode,
        waveNumber,
        "buildings",
        "Identifying key buildings…",
      ),
    );
    if (!secondWavePlan) {
      completeAutoNukeWaveEntry(bldgLogIdx);
      updateAutoNukeProcessPanel(
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          Math.max(1, waveNumber - 1),
          "sams",
          "No buildings found",
          { progress: 1 },
        ),
      );
      hideAutoNukeProcessPanelAfterLanding(latestImpactAtMs);
      return;
    }

    const secondWaveLaunchedCount = await launchAutoNukePlan(
      params,
      secondWavePlan,
      getAutoNukeProcessWaveStatus(
        params,
        mode,
        waveNumber,
        "buildings",
        `Firing ${secondWavePlan.shots.length} nukes`,
      ),
    );
    completeAutoNukeWaveEntry(bldgLogIdx);
    if (secondWaveLaunchedCount === 0) {
      console.info("OpenFront Helper: total destruction second pass could not be launched.");
      updateAutoNukeProcessPanel(
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          waveNumber,
          "buildings",
          "Building strike failed",
          { progress: 1 },
        ),
      );
      hideAutoNukeProcessPanelAfterLanding(latestImpactAtMs);
      return;
    }
    latestImpactAtMs = Math.max(
      latestImpactAtMs,
      secondWavePlan.estimatedImpactAtMs || 0,
    );
    waveNumber++;

    // Continue firing "remote" cleanup waves until no targets remain or wave cap hit.
    let remoteState = secondWavePlan.followupState;
    let remoteWaveCount = 0;
    const maxRemoteWaves = AUTO_NUKE_MAX_DESTRUCTION_WAVES - waveNumber + 1;
    while (remoteWaveCount < maxRemoteWaves) {
      if (!canContinueAutoNukeSecondPass(params)) {
        break;
      }
      const remoteWaveLabel = remoteWaveCount === 0
        ? `Wave ${waveNumber} — Cleanup`
        : `Wave ${waveNumber} — Cleanup ${remoteWaveCount + 1}`;
      const remoteLogIdx = pushAutoNukeWaveEntry(remoteWaveLabel, "active");
      const remoteSpread = AUTO_NUKE_THIRD_PASS_SPREAD_MULTIPLIER +
        remoteWaveCount * 0.4;
      const remoteWavePlan = await waitForAutoNukeWavePlan(
        params,
        mode,
        remoteState,
        {
          destructionPhase: "remote",
          spreadMultiplier: remoteSpread,
          readySlotFraction: 0.45,
          launchSlotFraction: 1,
          confirmationShots: 0,
        },
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          waveNumber,
          "remote",
          remoteWaveCount === 0
            ? "Mopping up remaining targets…"
            : `Cleanup wave ${remoteWaveCount + 1}`,
        ),
      );
      if (!remoteWavePlan) {
        completeAutoNukeWaveEntry(remoteLogIdx);
        break;
      }

      const remoteWaveLaunched = await launchAutoNukePlan(
        params,
        remoteWavePlan,
        getAutoNukeProcessWaveStatus(
          params,
          mode,
          waveNumber,
          "remote",
          `Firing ${remoteWavePlan.shots.length} nukes`,
        ),
      );
      completeAutoNukeWaveEntry(remoteLogIdx);
      if (remoteWaveLaunched === 0) {
        break;
      }
      latestImpactAtMs = Math.max(
        latestImpactAtMs,
        remoteWavePlan.estimatedImpactAtMs || 0,
      );
      remoteState = remoteWavePlan.followupState;
      remoteWaveCount++;
      waveNumber++;
    }

    updateAutoNukeProcessPanel(
      getAutoNukeProcessWaveStatus(
        params,
        mode,
        Math.max(1, waveNumber - 1),
        "remote",
        `Mission complete — ${waveNumber - 1} waves`,
        { progress: 1 },
      ),
    );
    hideAutoNukeProcessPanelAfterLanding(latestImpactAtMs);
  }

  function getAutoNukePlanKey(mode, tierId = "default") {
    return `${mode}:${tierId || "default"}`;
  }

  function getAutoNukeBuildPlanOptions(mode, tierOptions, extraOptions = null) {
    const options = {
      ...(tierOptions?.options || {}),
      ...(extraOptions || {}),
    };

    if (mode === "sams") {
      options.destructionPhase = "sams";
      options.confirmationShots = 0;
      options.allowDestructionPhaseFallback = false;
    } else if (mode === "destruction" && !options.destructionPhase) {
      options.destructionPhase = "sams";
      options.confirmationShots = 0;
      options.allowDestructionPhaseFallback = true;
    }

    return options;
  }

  function executeAutoNuke(params, mode, tierId = null) {
    const now = performance.now();
    if (now - lastAutoNukeActionAt < AUTO_NUKE_ACTION_COOLDOWN_MS) {
      return;
    }
    lastAutoNukeActionAt = now;

    if (isAutoNukeRadialItemDisabled(params)) {
      return;
    }

    const tierOptions = getAutoNukeTierPlanOptions(params, tierId);
    if (tierOptions?.reason) {
      return;
    }
    const planKey = getAutoNukePlanKey(mode, tierId);
    const plan = params.autoNukePlans?.[planKey] ||
      buildAutoNukePlanForMode(
        params.game,
        params.selected,
        mode,
        getAutoNukeBuildPlanOptions(mode, tierOptions),
      );
    if (!plan.shots.length || plan.score <= 0) {
      if (tierId || mode === "destruction" || mode === "sams") {
        return;
      }
      const fallbackCandidate = selectAutoNukeCandidate(
        params.game,
        params.selected,
        mode,
      );
      if (!fallbackCandidate) {
        console.info(`OpenFront Helper: no valid auto ${mode} nuke target found.`);
        return;
      }
      launchAutoNukeCandidate(params, fallbackCandidate).then((launched) => {
        if (!launched) {
          console.info(`OpenFront Helper: auto ${mode} nuke could not be launched.`);
        }
      });
      return;
    }

    launchAutoNukeWithOptionalSecondPass(params, mode, tierId, plan);
  }

  function ensureAutoNukeContextMenuStyles() {
    if (document.getElementById(AUTO_NUKE_CONTEXT_MENU_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = AUTO_NUKE_CONTEXT_MENU_STYLE_ID;
    style.textContent = `
      #${AUTO_NUKE_CONTEXT_MENU_ID} {
        position: fixed;
        z-index: 9000;
        min-width: 220px;
        padding: 6px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 8px;
        background: rgba(13, 18, 24, 0.96);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
        color: #f8fafc;
        font: 800 12px/1.15 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID}[hidden] {
        display: none;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-title {
        padding: 5px 7px 7px;
        color: #cbd5e1;
        font-size: 11px;
        font-weight: 800;
        border-bottom: 1px solid rgba(148, 163, 184, 0.22);
        margin-bottom: 5px;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-loading {
        margin: 5px 4px 7px;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-loading[hidden] {
        display: none;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-loading-track {
        height: 6px;
        overflow: hidden;
        border-radius: 6px;
        background: rgba(51, 65, 85, 0.92);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-loading-fill {
        width: 0%;
        height: 100%;
        border-radius: 6px;
        background: linear-gradient(90deg, #38bdf8, #facc15);
        transition: width 120ms linear;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-loading-text {
        margin-top: 4px;
        color: #cbd5e1;
        font-size: 10px;
        font-weight: 750;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-steps {
        list-style: none;
        margin: 5px 0 0;
        padding: 0;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-steps li {
        font-size: 10px;
        color: #64748b;
        padding: 1px 0;
        transition: color 100ms;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-steps li::before {
        content: "○ ";
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-steps li[data-done] {
        color: #4ade80;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-steps li[data-done]::before {
        content: "✓ ";
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button {
        display: block;
        width: 100%;
        margin: 0;
        padding: 8px 9px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #f8fafc;
        font: inherit;
        letter-spacing: 0;
        text-align: left;
        cursor: pointer;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button:focus-visible:not(:disabled) {
        outline: none;
        background: rgba(239, 68, 68, 0.24);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="economic"]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="economic"]:focus-visible:not(:disabled) {
        background: rgba(34, 197, 94, 0.22);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="destruction"]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="destruction"]:focus-visible:not(:disabled) {
        background: rgba(250, 204, 21, 0.2);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="sams"]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="sams"]:focus-visible:not(:disabled) {
        background: rgba(56, 189, 248, 0.2);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button:disabled {
        cursor: not-allowed;
        color: rgba(203, 213, 225, 0.48);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-section {
        margin: 7px 4px 3px;
        padding-top: 6px;
        border-top: 1px solid rgba(148, 163, 184, 0.2);
        color: #94a3b8;
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-section[hidden] {
        display: none;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-section[data-auto-nuke-section-label="economic"] {
        color: #86efac;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-section[data-auto-nuke-section-label="population"] {
        color: #fca5a5;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-section[data-auto-nuke-section-label="sams"] {
        color: #bae6fd;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-section[data-auto-nuke-section-label="destruction"] {
        color: #fde68a;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="economic"] {
        border-left: 2px solid rgba(34, 197, 94, 0.42);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="population"] {
        border-left: 2px solid rgba(239, 68, 68, 0.42);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="sams"] {
        border-left: 2px solid rgba(56, 189, 248, 0.5);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-mode="destruction"] {
        border-left: 2px solid rgba(250, 204, 21, 0.5);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-label,
      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-meta {
        display: block;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-label {
        color: inherit;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-meta {
        margin-top: 3px;
        color: #cbd5e1;
        font-size: 10px;
        font-weight: 750;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button:disabled .openfront-helper-auto-nuke-meta {
        color: rgba(203, 213, 225, 0.48);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-back][hidden] {
        display: none;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-back] {
        color: #94a3b8;
        font-size: 11px;
        font-weight: 750;
        margin-bottom: 3px;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-back]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-back]:focus-visible:not(:disabled) {
        background: rgba(148, 163, 184, 0.12);
        color: #f8fafc;
        outline: none;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-row {
        display: flex;
        gap: 4px;
        align-items: stretch;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} .openfront-helper-auto-nuke-row > button[data-auto-nuke-expand] {
        flex: 1;
        min-width: 0;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-build-silo] {
        flex-shrink: 0;
        width: auto;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 850;
        border: 1px solid rgba(16, 185, 129, 0.5);
        border-radius: 6px;
        background: rgba(16, 185, 129, 0.12);
        color: #6ee7b7;
        white-space: nowrap;
        cursor: pointer;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-build-silo]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-build-silo]:focus-visible:not(:disabled) {
        background: rgba(16, 185, 129, 0.28);
        outline: none;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-build-silo]:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-build-silo][hidden] {
        display: none;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch][hidden] {
        display: none;
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="economic"] {
        border-left: 2px solid rgba(34, 197, 94, 0.42);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="population"] {
        border-left: 2px solid rgba(239, 68, 68, 0.42);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="sams"] {
        border-left: 2px solid rgba(56, 189, 248, 0.5);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="destruction"] {
        border-left: 2px solid rgba(250, 204, 21, 0.5);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="economic"]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="economic"]:focus-visible:not(:disabled) {
        background: rgba(34, 197, 94, 0.22);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="population"]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="population"]:focus-visible:not(:disabled) {
        background: rgba(239, 68, 68, 0.24);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="sams"]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="sams"]:focus-visible:not(:disabled) {
        background: rgba(56, 189, 248, 0.2);
      }

      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="destruction"]:hover:not(:disabled),
      #${AUTO_NUKE_CONTEXT_MENU_ID} button[data-auto-nuke-branch="destruction"]:focus-visible:not(:disabled) {
        background: rgba(250, 204, 21, 0.2);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureAutoNukeContextMenu() {
    ensureAutoNukeContextMenuStyles();

    let menu = document.getElementById(AUTO_NUKE_CONTEXT_MENU_ID);
    if (menu) {
      return menu;
    }

    menu = document.createElement("div");
    menu.id = AUTO_NUKE_CONTEXT_MENU_ID;
    menu.hidden = true;
    menu.innerHTML = `
      <div class="openfront-helper-auto-nuke-title">Auto nuke</div>
      <div class="openfront-helper-auto-nuke-row">
        <button type="button" data-auto-nuke-expand></button>
        <button type="button" data-auto-nuke-build-silo hidden></button>
      </div>
      <button type="button" data-auto-nuke-back hidden></button>
      <button type="button" data-auto-nuke-branch="economic" hidden></button>
      <button type="button" data-auto-nuke-branch="population" hidden></button>
      <button type="button" data-auto-nuke-branch="sams" hidden></button>
      <button type="button" data-auto-nuke-branch="destruction" hidden></button>
      <div class="openfront-helper-auto-nuke-loading" data-auto-nuke-loading hidden>
        <div class="openfront-helper-auto-nuke-loading-track">
          <div class="openfront-helper-auto-nuke-loading-fill" data-auto-nuke-loading-fill></div>
        </div>
        <div class="openfront-helper-auto-nuke-loading-text" data-auto-nuke-loading-text></div>
        <ul class="openfront-helper-auto-nuke-steps" data-auto-nuke-steps></ul>
      </div>
      <div class="openfront-helper-auto-nuke-section" data-auto-nuke-section-label="economic">Economy</div>
      <button type="button" data-auto-nuke-mode="economic" data-auto-nuke-tier="low"></button>
      <button type="button" data-auto-nuke-mode="economic" data-auto-nuke-tier="medium"></button>
      <button type="button" data-auto-nuke-mode="economic" data-auto-nuke-tier="high"></button>
      <div class="openfront-helper-auto-nuke-section" data-auto-nuke-section-label="population">Population</div>
      <button type="button" data-auto-nuke-mode="population" data-auto-nuke-tier="low"></button>
      <button type="button" data-auto-nuke-mode="population" data-auto-nuke-tier="medium"></button>
      <button type="button" data-auto-nuke-mode="population" data-auto-nuke-tier="high"></button>
      <div class="openfront-helper-auto-nuke-section" data-auto-nuke-section-label="sams">SAMs</div>
      <button type="button" data-auto-nuke-mode="sams"></button>
      <div class="openfront-helper-auto-nuke-section" data-auto-nuke-section-label="destruction">Total destruction</div>
      <button type="button" data-auto-nuke-mode="destruction" data-auto-nuke-tier="high"></button>
    `;
    menu.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const expandButton = target.closest("[data-auto-nuke-expand]");
      if (expandButton instanceof HTMLButtonElement) {
        if (!expandButton.disabled) {
          expandAutoNukeContextMenu(menu);
        }
        return;
      }

      const buildSiloButton = target.closest("[data-auto-nuke-build-silo]");
      if (buildSiloButton instanceof HTMLButtonElement && !buildSiloButton.disabled) {
        const params = autoNukeContextMenuParams;
        handleAutoNukeBuildSiloClick(menu, params, buildSiloButton).catch((error) => {
          console.error("OpenFront Helper: failed to build missile silo.", error);
        });
        return;
      }

      const backButton = target.closest("[data-auto-nuke-back]");
      if (backButton instanceof HTMLButtonElement && !backButton.disabled) {
        goBackToAutoNukeBranchMenu(menu);
        return;
      }

      const branchButton = target.closest("[data-auto-nuke-branch]");
      if (branchButton instanceof HTMLButtonElement && !branchButton.disabled) {
        expandAutoNukeModeDetails(menu, branchButton.dataset.autoNukeBranch).catch((error) => {
          console.error("OpenFront Helper: failed to calculate auto nuke plan.", error);
        });
        return;
      }

      const button = target.closest("[data-auto-nuke-mode]");
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return;
      }
      const mode = button.dataset.autoNukeMode;
      const tierId = button.dataset.autoNukeTier;
      const params = autoNukeContextMenuParams;
      hideAutoNukeContextMenu();
      if (
        params &&
        (
          mode === "economic" ||
          mode === "population" ||
          mode === "destruction" ||
          mode === "sams"
        )
      ) {
        executeAutoNuke(params, mode, tierId);
      }
    });
    (document.body || document.documentElement).appendChild(menu);
    return menu;
  }

  function hideAutoNukeContextMenu() {
    autoNukeContextMenuComputeId++;
    const menu = document.getElementById(AUTO_NUKE_CONTEXT_MENU_ID);
    if (menu) {
      menu.hidden = true;
    }
    autoNukeContextMenuParams = null;
  }

  function getAutoNukeContextMenuDisableReason(params) {
    if (!params?.selected?.isPlayer?.()) {
      return "No player or nation selected.";
    }
    const isEnemy = isEnemyNukeSuggestionTarget(params.game, params.selected);
    if (!isEnemy && !autoNukeIncludeAllies) {
      return "Target is not hostile.";
    }
    if (!hasAutoNukeBuildTypeAvailable(params.game, params.myPlayer)) {
      return "No nuke type is available.";
    }
    const readySlots = getReadyNukeSiloSlotCount(params.myPlayer);
    if (readySlots === 0) {
      const totalSlots = getTotalNukeSiloSlotCount(params.myPlayer);
      if (totalSlots === 0) {
        return "No missile silos built yet.";
      }
      return `0 / ${totalSlots} silo slot${totalSlots !== 1 ? "s" : ""} ready.`;
    }
    const gold = getPlayerGoldNumber(params.myPlayer);
    const minimumCost = getAutoNukeMinimumAvailableCost(params.game, params.myPlayer);
    if (!Number.isFinite(gold) || gold < minimumCost) {
      const missingGold = Number.isFinite(gold) ? minimumCost - gold : minimumCost;
      return `Need ${formatAutoNukeGold(missingGold)} more gold.`;
    }
    return "";
  }

  function getAutoNukeModeLabel(mode) {
    if (mode === "economic") {
      return "Auto econ nukes";
    }
    if (mode === "destruction") {
      return "Total destruction";
    }
    if (mode === "sams") {
      return "Destroy all SAMs";
    }
    return "Auto population nukes";
  }

  function getAutoNukeTierById(tierId) {
    return AUTO_NUKE_INTENSITY_TIERS.find((tier) => tier.id === tierId) ||
      AUTO_NUKE_INTENSITY_TIERS[AUTO_NUKE_INTENSITY_TIERS.length - 1];
  }

  function getAutoNukeTierRank(tierId) {
    return AUTO_NUKE_TIER_ORDER.has(tierId)
      ? AUTO_NUKE_TIER_ORDER.get(tierId)
      : AUTO_NUKE_INTENSITY_TIERS.length;
  }

  function getAutoNukeTierPlanOptions(params, tierId) {
    if (!tierId) {
      return {
        tier: null,
        options: null,
        reason: "",
      };
    }

    const tier = getAutoNukeTierById(tierId);
    const availableSiloSlots = getReadyNukeSiloSlotCount(params.myPlayer);
    const playerGold = getPlayerGoldNumber(params.myPlayer);
    const availableGold = Number.isFinite(playerGold) ? Math.max(0, playerGold) : 0;
    const minimumCost = getAutoNukeMinimumAvailableCost(params.game, params.myPlayer);

    if (availableSiloSlots < tier.minShots) {
      const missingSlots = tier.minShots - availableSiloSlots;
      return {
        tier,
        options: null,
        reason: `Need ${missingSlots} more missile silo ${missingSlots === 1 ? "slot" : "slots"}.`,
      };
    }

    const maxSiloSlots = Math.min(
      availableSiloSlots,
      Math.max(
        tier.minShots,
        Math.ceil(availableSiloSlots * tier.shotFraction),
      ),
    );
    const requiredGold = minimumCost * maxSiloSlots;

    if (!Number.isFinite(availableGold) || availableGold < requiredGold) {
      return {
        tier,
        options: null,
        reason: `Need ${formatAutoNukeGold(requiredGold - availableGold)} more gold.`,
      };
    }

    return {
      tier,
      options: {
        maxGold: availableGold,
        maxSiloSlots,
      },
      reason: "",
    };
  }

  function formatAutoNukeGold(value) {
    return formatNukeSuggestionPopulation(value);
  }

  function formatAutoNukeMetric(value) {
    return formatNukeSuggestionPopulation(Math.max(0, Number(value) || 0));
  }

  function getAutoNukePlanFailureReason(params, plan) {
    if (plan?.budgetSiloSlots === 0 || plan?.availableSiloSlots === 0) {
      const totalSlots = getTotalNukeSiloSlotCount(params.myPlayer);
      if (totalSlots === 0) {
        return "No missile silos built yet.";
      }
      const readySlots = getReadyNukeSiloSlotCount(params.myPlayer);
      return `0 / ${totalSlots} silo slot${totalSlots !== 1 ? "s" : ""} ready.`;
    }

    const minimumCost = getAutoNukeMinimumAvailableCost(params.game, params.myPlayer);
    if (
      Number.isFinite(minimumCost) &&
      (
        plan?.budgetGold < minimumCost ||
        plan?.availableGold < minimumCost
      )
    ) {
      return `Need ${formatAutoNukeGold(minimumCost - (plan?.availableGold || 0))} more gold.`;
    }

    const missingSiloSlots = Number.isFinite(plan?.minimumRequiredSiloSlots)
      ? Math.max(0, Math.ceil(plan.minimumRequiredSiloSlots - plan.budgetSiloSlots))
      : 0;
    const missingGold = Number.isFinite(plan?.minimumRequiredGold)
      ? Math.max(0, plan.minimumRequiredGold - plan.budgetGold)
      : 0;
    if (missingSiloSlots > 0 && missingGold > 0) {
      return `Need ${formatAutoNukeGold(missingGold)} more gold and ${missingSiloSlots} more missile silo ${missingSiloSlots === 1 ? "slot" : "slots"} for this tier.`;
    }
    if (missingSiloSlots > 0) {
      return `Need ${missingSiloSlots} more missile silo ${missingSiloSlots === 1 ? "slot" : "slots"} for this tier.`;
    }
    if (missingGold > 0) {
      return `Need ${formatAutoNukeGold(missingGold)} more gold for this tier.`;
    }

    return "No safe plan.";
  }

  function getAutoNukePlanMetrics(plan) {
    return plan?.metrics || finalizeAutoNukePlanMetrics(null, plan?.shots?.length || 0, plan?.cost || 0);
  }

  function formatAutoNukePlanMeta(mode, plan) {
    const metrics = getAutoNukePlanMetrics(plan);
    const shotCount = metrics.shotCount || plan?.shots?.length || 0;
    const nukeLabel = shotCount === 1 ? "nuke" : "nukes";
    const parts = [
      `${shotCount} ${nukeLabel}`,
      `${formatAutoNukeGold(metrics.cost || plan?.cost || 0)} gold`,
    ];

    if (mode === "population" || mode === "destruction") {
      parts.push(`${formatAutoNukeMetric(metrics.populationDamage)} pop`);
    }
    if (mode === "economic" || mode === "destruction") {
      parts.push(`${formatAutoNukeMetric(metrics.economicDamage)} econ`);
    }
    if (mode === "sams" || mode === "destruction" || metrics.samsDestroyed > 0) {
      parts.push(`${metrics.samsDestroyed || 0} SAMs`);
    }
    if (mode === "destruction") {
      parts.push("multi-wave");
    } else if (mode === "sams") {
      parts.push("SAM waves");
    }

    return parts.join(" | ");
  }

  function enforceAutoNukeTierPlanOrder(entries) {
    const sortedEntries = entries
      .filter((entry) => entry.tierId)
      .sort((a, b) => getAutoNukeTierRank(a.tierId) - getAutoNukeTierRank(b.tierId));
    let strongestLowerPlan = null;

    for (const entry of sortedEntries) {
      const plan = entry.plan;
      const planShotCount = plan?.metrics?.shotCount || plan?.shots?.length || 0;
      const lowerShotCount =
        strongestLowerPlan?.metrics?.shotCount || strongestLowerPlan?.shots?.length || 0;

      if (!entry.reason && plan?.shots?.length && strongestLowerPlan && planShotCount < lowerShotCount) {
        entry.plan = strongestLowerPlan;
      }

      if (!entry.reason && entry.plan?.shots?.length) {
        const entryShotCount =
          entry.plan?.metrics?.shotCount || entry.plan?.shots?.length || 0;
        const currentBestShotCount =
          strongestLowerPlan?.metrics?.shotCount || strongestLowerPlan?.shots?.length || 0;
        if (!strongestLowerPlan || entryShotCount >= currentBestShotCount) {
          strongestLowerPlan = entry.plan;
        }
      }
    }
  }

  function renderAutoNukeButton(button, mode, tierId, plan, reason = "") {
    const tier = getAutoNukeTierById(tierId);
    const label = document.createElement("span");
    label.className = "openfront-helper-auto-nuke-label";
    label.textContent = mode === "sams"
      ? getAutoNukeModeLabel(mode)
      : `${getAutoNukeModeLabel(mode)} - ${tier.label}`;

    const meta = document.createElement("span");
    meta.className = "openfront-helper-auto-nuke-meta";

    if (reason) {
      button.disabled = true;
      button.title = reason;
      meta.textContent = reason;
    } else if (!plan?.shots?.length || plan.score <= 0) {
      const emptyReason = "No valid plan.";
      button.disabled = true;
      button.title = emptyReason;
      meta.textContent = emptyReason;
    } else {
      const metaText = formatAutoNukePlanMeta(mode, plan);
      button.disabled = false;
      button.title = metaText;
      meta.textContent = metaText;
    }

    button.replaceChildren(label, meta);
  }

  function renderAutoNukeLoadingButton(button, mode, tierId) {
    const tier = tierId ? getAutoNukeTierById(tierId) : null;
    const label = document.createElement("span");
    label.className = "openfront-helper-auto-nuke-label";
    label.textContent = mode === "sams"
      ? getAutoNukeModeLabel(mode)
      : `${getAutoNukeModeLabel(mode)} - ${tier?.label || "High"}`;

    const meta = document.createElement("span");
    meta.className = "openfront-helper-auto-nuke-meta";
    meta.textContent = "Calculating...";

    button.disabled = true;
    button.title = "Calculating auto nuke plan";
    button.replaceChildren(label, meta);
  }

  function renderAutoNukeExpandButton(button, reason = "") {
    const label = document.createElement("span");
    label.className = "openfront-helper-auto-nuke-label";
    label.textContent = "Auto nuke";

    const meta = document.createElement("span");
    meta.className = "openfront-helper-auto-nuke-meta";
    meta.textContent = reason || "Show auto nuke options";

    button.disabled = Boolean(reason);
    button.title = reason || "Calculate auto nuke plans";
    button.replaceChildren(label, meta);
  }

  function renderAutoNukeBranchButton(button, mode, disabledReason = "") {
    const modeLabels = {
      economic: "Economy",
      population: "Population",
      sams: "SAMs",
      destruction: "Total destruction",
    };
    const label = document.createElement("span");
    label.className = "openfront-helper-auto-nuke-label";
    label.textContent = modeLabels[mode] || getAutoNukeModeLabel(mode);

    const meta = document.createElement("span");
    meta.className = "openfront-helper-auto-nuke-meta";
    meta.textContent = disabledReason || "Show options →";

    button.disabled = Boolean(disabledReason);
    button.title = disabledReason || modeLabels[mode] || mode;
    button.replaceChildren(label, meta);
  }

  function waitForAutoNukeMenuFrame() {
    return new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    );
  }

  function isAutoNukeMenuComputeActive(menu, params, computeId) {
    return (
      autoNukeContextMenuComputeId === computeId &&
      autoNukeContextMenuParams === params &&
      !menu.hidden
    );
  }

  function setAutoNukeMenuLoading(menu, visible, progress = 0, text = "") {
    const loading = menu.querySelector("[data-auto-nuke-loading]");
    const fill = menu.querySelector("[data-auto-nuke-loading-fill]");
    const textElement = menu.querySelector("[data-auto-nuke-loading-text]");
    if (loading instanceof HTMLElement) {
      loading.hidden = !visible;
    }
    if (fill instanceof HTMLElement) {
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    }
    if (textElement instanceof HTMLElement) {
      textElement.textContent = text;
    }
  }

  function initAutoNukeMenuLoadingSteps(menu, stepLabels) {
    const list = menu.querySelector("[data-auto-nuke-steps]");
    if (!(list instanceof HTMLElement)) return;
    list.innerHTML = stepLabels
      .map((label) => `<li>${label}</li>`)
      .join("");
  }

  function markAutoNukeMenuLoadingStepDone(menu, index) {
    const list = menu.querySelector("[data-auto-nuke-steps]");
    if (!(list instanceof HTMLElement)) return;
    const item = list.children[index];
    if (item instanceof HTMLElement) {
      item.setAttribute("data-done", "");
    }
  }

  function setAutoNukeModeButtonsHidden(menu, hidden) {
    for (const button of menu.querySelectorAll("[data-auto-nuke-mode]")) {
      if (button instanceof HTMLButtonElement) {
        button.hidden = hidden;
      }
    }
  }

  function setAutoNukeSectionLabelsHidden(menu, hidden) {
    for (const section of menu.querySelectorAll("[data-auto-nuke-section-label]")) {
      if (section instanceof HTMLElement) {
        section.hidden = hidden;
      }
    }
  }

  function setAutoNukeBranchButtonsHidden(menu, hidden) {
    for (const button of menu.querySelectorAll("[data-auto-nuke-branch]")) {
      if (button instanceof HTMLButtonElement) {
        button.hidden = hidden;
      }
    }
  }

  function goBackToAutoNukeBranchMenu(menu) {
    autoNukeContextMenuComputeId++;
    const params = autoNukeContextMenuParams;
    if (!params) {
      return;
    }

    const backButton = menu.querySelector("[data-auto-nuke-back]");
    if (backButton instanceof HTMLButtonElement) {
      backButton.hidden = true;
    }
    setAutoNukeMenuLoading(menu, false);
    setAutoNukeSectionLabelsHidden(menu, true);
    setAutoNukeModeButtonsHidden(menu, true);

    const buildSiloButton = menu.querySelector("[data-auto-nuke-build-silo]");
    if (buildSiloButton instanceof HTMLButtonElement) {
      buildSiloButton.hidden = true;
    }

    const reason = getAutoNukeContextMenuDisableReason(params);
    for (const button of menu.querySelectorAll("[data-auto-nuke-branch]")) {
      if (button instanceof HTMLButtonElement) {
        button.hidden = false;
        renderAutoNukeBranchButton(button, button.dataset.autoNukeBranch, reason);
      }
    }

    positionAutoNukeContextMenu(
      menu,
      Number.parseFloat(menu.style.left) || 6,
      Number.parseFloat(menu.style.top) || 6,
    );
  }

  function expandAutoNukeContextMenu(menu) {
    const params = autoNukeContextMenuParams;
    if (!params) {
      return;
    }

    const expandButton = menu.querySelector("[data-auto-nuke-expand]");
    if (expandButton instanceof HTMLButtonElement) {
      expandButton.hidden = true;
    }
    const buildSiloButton = menu.querySelector("[data-auto-nuke-build-silo]");
    if (buildSiloButton instanceof HTMLButtonElement) {
      buildSiloButton.hidden = true;
    }

    const reason = getAutoNukeContextMenuDisableReason(params);
    params.autoNukePlans = {};

    for (const button of menu.querySelectorAll("[data-auto-nuke-branch]")) {
      if (button instanceof HTMLButtonElement) {
        button.hidden = false;
        renderAutoNukeBranchButton(button, button.dataset.autoNukeBranch, reason);
      }
    }

    positionAutoNukeContextMenu(
      menu,
      Number.parseFloat(menu.style.left) || 6,
      Number.parseFloat(menu.style.top) || 6,
    );
  }

  async function expandAutoNukeModeDetails(menu, mode) {
    const params = autoNukeContextMenuParams;
    if (!params) {
      return;
    }
    const computeId = ++autoNukeContextMenuComputeId;

    setAutoNukeBranchButtonsHidden(menu, true);
    setAutoNukeSectionLabelsHidden(menu, true);
    setAutoNukeModeButtonsHidden(menu, true);

    const backButton = menu.querySelector("[data-auto-nuke-back]");
    if (backButton instanceof HTMLButtonElement) {
      backButton.hidden = false;
      backButton.textContent = "← Back";
    }

    const sectionLabel = menu.querySelector(`[data-auto-nuke-section-label="${mode}"]`);
    if (sectionLabel instanceof HTMLElement) {
      sectionLabel.hidden = false;
    }

    const modeButtons = Array.from(
      menu.querySelectorAll(`[data-auto-nuke-mode="${mode}"]`),
    ).filter((b) => b instanceof HTMLButtonElement);

    const totalSteps = 1 + modeButtons.length;
    let completedSteps = 0;

    for (const button of modeButtons) {
      button.hidden = false;
      renderAutoNukeLoadingButton(button, mode, button.dataset.autoNukeTier);
    }

    setAutoNukeMenuLoading(menu, true, 0.02, `Calculating ${getAutoNukeModeLabel(mode)}...`);
    initAutoNukeMenuLoadingSteps(menu, [
      "Computing targets",
      ...modeButtons.map((b) => {
        const tier = getAutoNukeTierById(b.dataset.autoNukeTier);
        return tier ? `${tier.label} intensity` : "Calculating plan";
      }),
    ]);
    positionAutoNukeContextMenu(
      menu,
      Number.parseFloat(menu.style.left) || 6,
      Number.parseFloat(menu.style.top) || 6,
    );

    await waitForAutoNukeMenuFrame();
    if (!isAutoNukeMenuComputeActive(menu, params, computeId)) {
      return;
    }

    const reason = getAutoNukeContextMenuDisableReason(params);

    if (reason) {
      for (const button of modeButtons) {
        renderAutoNukeButton(button, mode, button.dataset.autoNukeTier, null, reason);
      }
      const buildSiloButton = menu.querySelector("[data-auto-nuke-build-silo]");
      if (buildSiloButton instanceof HTMLButtonElement) {
        const canOfferBuild = isAutoNukeSiloShortageReason(reason) &&
          Boolean(params?.buildMenu?.sendBuildOrUpgrade);
        if (canOfferBuild) {
          buildSiloButton.hidden = false;
          renderAutoNukeBuildSiloButton(buildSiloButton, params);
        }
      }
      setAutoNukeMenuLoading(menu, false);
      positionAutoNukeContextMenu(
        menu,
        Number.parseFloat(menu.style.left) || 6,
        Number.parseFloat(menu.style.top) || 6,
      );
      return;
    }

    const candidatePool = computeAutoNukeCandidatePool(params.game, params.selected, mode);
    completedSteps++;
    markAutoNukeMenuLoadingStepDone(menu, 0);
    setAutoNukeMenuLoading(
      menu,
      true,
      completedSteps / Math.max(1, totalSteps),
      `Calculating ${getAutoNukeModeLabel(mode)}...`,
    );

    await waitForAutoNukeMenuFrame();
    if (!isAutoNukeMenuComputeActive(menu, params, computeId)) {
      return;
    }

    const modeEntries = [];
    let tierStepIndex = 1;

    for (const button of modeButtons) {
      const tierId = button.dataset.autoNukeTier;
      const tierOptions = getAutoNukeTierPlanOptions(params, tierId);
      const plan = tierOptions.reason
        ? null
        : buildAutoNukePlanForMode(
          params.game,
          params.selected,
          mode,
          getAutoNukeBuildPlanOptions(mode, tierOptions),
          candidatePool,
        );
      modeEntries.push({ button, mode, tierId, plan, reason: tierOptions.reason });
      markAutoNukeMenuLoadingStepDone(menu, tierStepIndex++);
      await waitForAutoNukeMenuFrame();
      if (!isAutoNukeMenuComputeActive(menu, params, computeId)) {
        return;
      }
    }

    enforceAutoNukeTierPlanOrder(modeEntries);

    for (const entry of modeEntries) {
      if (!isAutoNukeMenuComputeActive(menu, params, computeId)) {
        return;
      }
      const planKey = getAutoNukePlanKey(entry.mode, entry.tierId);
      if (entry.plan) {
        params.autoNukePlans[planKey] = entry.plan;
      }
      const buttonReason = entry.reason ||
        (!entry.plan?.shots?.length || entry.plan.score <= 0
          ? getAutoNukePlanFailureReason(params, entry.plan)
          : "");
      // Store the final displayed reason so the silo-shortage check below can use it.
      entry.displayReason = buttonReason;
      renderAutoNukeButton(entry.button, entry.mode, entry.tierId, entry.plan, buttonReason);
      completedSteps++;
      setAutoNukeMenuLoading(
        menu,
        true,
        completedSteps / Math.max(1, totalSteps),
        `Calculated ${getAutoNukeModeLabel(mode)}`,
      );
    }

    if (!isAutoNukeMenuComputeActive(menu, params, computeId)) {
      return;
    }

    const buildSiloButton = menu.querySelector("[data-auto-nuke-build-silo]");
    if (buildSiloButton instanceof HTMLButtonElement) {
      // Use displayReason (includes plan-level failures) so button shows even when
      // the tier pre-check passes but the plan itself ran out of silo slots.
      const allSiloBlocked = modeEntries.length > 0 &&
        modeEntries.every((e) => isAutoNukeSiloShortageReason(e.displayReason || e.reason));
      const canOfferBuild = allSiloBlocked &&
        Boolean(params?.buildMenu?.sendBuildOrUpgrade);
      if (canOfferBuild) {
        buildSiloButton.hidden = false;
        renderAutoNukeBuildSiloButton(buildSiloButton, params);
      } else {
        buildSiloButton.hidden = true;
      }
    }

    setAutoNukeMenuLoading(menu, false);
    positionAutoNukeContextMenu(
      menu,
      Number.parseFloat(menu.style.left) || 6,
      Number.parseFloat(menu.style.top) || 6,
    );
  }

  function positionAutoNukeContextMenu(menu, x, y) {
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";

    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(6, x), window.innerWidth - rect.width - 6);
    const top = Math.min(Math.max(6, y), window.innerHeight - rect.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function showAutoNukeContextMenu(x, y, params) {
    const menu = ensureAutoNukeContextMenu();
    autoNukeContextMenuParams = params;

    const reason = getAutoNukeContextMenuDisableReason(params);
    params.autoNukePlans = {};
    const expandButton = menu.querySelector("[data-auto-nuke-expand]");
    if (expandButton instanceof HTMLButtonElement) {
      expandButton.hidden = false;
      renderAutoNukeExpandButton(expandButton, reason);
    }
    const buildSiloButton = menu.querySelector("[data-auto-nuke-build-silo]");
    if (buildSiloButton instanceof HTMLButtonElement) {
      const canOfferBuild = isAutoNukeSiloShortageReason(reason) &&
        Boolean(params?.buildMenu?.sendBuildOrUpgrade);
      if (canOfferBuild) {
        buildSiloButton.hidden = false;
        renderAutoNukeBuildSiloButton(buildSiloButton, params);
      } else {
        buildSiloButton.hidden = true;
      }
    }
    setAutoNukeModeButtonsHidden(menu, true);
    setAutoNukeSectionLabelsHidden(menu, true);
    setAutoNukeBranchButtonsHidden(menu, true);
    const backBtn = menu.querySelector("[data-auto-nuke-back]");
    if (backBtn instanceof HTMLButtonElement) {
      backBtn.hidden = true;
    }

    positionAutoNukeContextMenu(menu, x, y);
  }

  function isAutoNukeSiloShortageReason(reason) {
    if (!reason) {
      return false;
    }
    return reason === "No missile silos built yet." ||
      /silo slot/i.test(reason) ||
      /missile silo/i.test(reason);
  }

  function renderAutoNukeBuildSiloButton(button, params, statusText = "") {
    button.disabled = false;
    button.title = "Stack missile silos on an existing one";
    button.textContent = statusText || "🏗 Build silos for me";
  }

  async function handleAutoNukeBuildSiloClick(menu, params, button) {
    if (!params?.myPlayer || !params?.buildMenu?.sendBuildOrUpgrade) {
      return;
    }
    button.disabled = true;
    button.textContent = "⏳ Building...";

    const builtCount = await autoBuildMissileSilo(params);

    if (builtCount > 0) {
      button.textContent = `✓ ${builtCount} silo${builtCount !== 1 ? "s" : ""} placed!`;
      setTimeout(() => {
        button.disabled = false;
        // Hide the button if there's no longer a silo shortage.
        const stillNeeded = isAutoNukeSiloShortageReason(
          getAutoNukeContextMenuDisableReason(params),
        );
        if (stillNeeded) {
          renderAutoNukeBuildSiloButton(button, params);
        } else {
          button.hidden = true;
        }
      }, 1500);
      return;
    }

    button.textContent = "✗ No valid tile";
    setTimeout(() => {
      if (autoNukeContextMenuParams === params) {
        button.disabled = false;
        renderAutoNukeBuildSiloButton(button, params);
      }
    }, 1800);
  }

  // Generous target for the "Build silos for me" one-click action: always try to
  // reach at least this many READY silo slots so the user has headroom for a
  // full auto-nuke assault without clicking repeatedly.
  const AUTO_NUKE_BUILD_SILO_TARGET = 12;
  // Absolute upper cap on silos queued in a single click.
  const AUTO_NUKE_BUILD_SILO_MAX_PER_CLICK = 20;

  // Returns how many silos were successfully queued (0 on failure).
  async function autoBuildMissileSilo(params) {
    const myPlayer = params.myPlayer;
    if (!myPlayer) {
      return 0;
    }

    // Determine how many silo slots are actually needed by checking:
    // 1. Plans that were computed but ran out of silo slots.
    // 2. Tier pre-checks that failed due to insufficient slots.
    // 3. A generous floor to give the user a comfortable nuke arsenal in one click.
    let neededCount = 1;
    for (const plan of Object.values(params.autoNukePlans || {})) {
      if (
        Number.isFinite(plan?.minimumRequiredSiloSlots) &&
        Number.isFinite(plan?.budgetSiloSlots)
      ) {
        const missing = Math.ceil(plan.minimumRequiredSiloSlots - plan.budgetSiloSlots);
        if (missing > 0) neededCount = Math.max(neededCount, missing);
      }
    }
    // Also check tier minimums for all known tiers.
    const availableSlots = getReadyNukeSiloSlotCount(myPlayer);
    for (const tier of AUTO_NUKE_INTENSITY_TIERS) {
      if (availableSlots < tier.minShots) {
        neededCount = Math.max(neededCount, tier.minShots - availableSlots);
      }
    }
    // Generous floor: always try to bring the user up to the target total
    // unless they already have plenty of slots.
    if (availableSlots < AUTO_NUKE_BUILD_SILO_TARGET) {
      neededCount = Math.max(
        neededCount,
        AUTO_NUKE_BUILD_SILO_TARGET - availableSlots,
      );
    }
    neededCount = Math.min(neededCount, AUTO_NUKE_BUILD_SILO_MAX_PER_CLICK);

    // Prefer stacking on existing missile silos (upgrade = +1 slot each).
    // Each silo can only receive one upgrade at a time, so iterate all of them.
    const siloUnits = getPlayerUnits(myPlayer, "Missile Silo");
    const siloTiles = siloUnits
      .map((unit) => getUnitTile(unit))
      .filter((tile) => tile !== null && tile !== undefined);

    // Also include any owned structure tile so the feature can place FRESH silos
    // on empty land / other structures instead of only stacking existing ones.
    // This is essential when stacking is exhausted (max level) or when there are
    // too few silos to satisfy the request by stacking alone.
    const fallbackTiles = getPlayerUnits(myPlayer, ...NUKE_SUGGESTION_STRUCTURE_TYPES)
      .map((unit) => getUnitTile(unit))
      .filter((tile) => tile !== null && tile !== undefined);

    // Deduplicate tiles (multiple units can share a tile). Silo tiles first so
    // stacking is tried before fresh builds.
    const seen = new Set();
    const uniqueTiles = [...siloTiles, ...fallbackTiles].filter((tile) => {
      if (seen.has(tile)) return false;
      seen.add(tile);
      return true;
    });

    if (uniqueTiles.length === 0) return 0;

    // If we need more stacks than available tiles, cycle through tiles again —
    // each upgrade on the SAME silo tile bumps the silo's level by 1 (one extra
    // missile slot each), so repeating the same tile is intentional and useful.
    const candidateTiles = [];
    const maxCycles = Math.max(
      AUTO_NUKE_BUILD_SILO_MAX_PER_CLICK,
      uniqueTiles.length * 10,
    );
    for (let i = 0; candidateTiles.length < neededCount; i++) {
      candidateTiles.push(uniqueTiles[i % uniqueTiles.length]);
      if (i >= maxCycles) break;
    }

    let builtCount = 0;
    for (const tile of candidateTiles) {
      if (builtCount >= neededCount) break;
      const buildable = await getBuildableMissileSilo(myPlayer, tile);
      // Accept both fresh builds (canBuild) and upgrades/stacks (canUpgrade).
      const canPlace =
        (buildable?.canBuild !== false && buildable?.canBuild !== undefined) ||
        (buildable?.canUpgrade !== false && buildable?.canUpgrade !== undefined);
      if (buildable && canPlace) {
        try {
          params.buildMenu.sendBuildOrUpgrade(buildable, tile);
          builtCount++;
        } catch (_error) {
          // try next tile
        }
      }
    }

    return builtCount;
  }

  async function getBuildableMissileSilo(player, tile) {
    if (typeof player?.buildables === "function") {
      try {
        const buildables = await player.buildables(tile, ["Missile Silo"]);
        const buildable = Array.from(buildables || []).find(
          (item) => item?.type === "Missile Silo",
        );
        if (buildable) return buildable;
      } catch (_error) {
        // fall back to actions API
      }
    }
    if (typeof player?.actions === "function") {
      try {
        const actions = await player.actions(tile, ["Missile Silo"]);
        return Array.from(actions?.buildableUnits || []).find(
          (item) => item?.type === "Missile Silo",
        ) || null;
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  function getAutoNukeRadialElement() {
    return document.querySelector("main-radial-menu");
  }

  function getAutoNukeBuildMenu(radialMenuElement) {
    return radialMenuElement?.buildMenu || document.querySelector("build-menu");
  }

  function getAutoNukeContextParamsFromEvent(event) {
    const radialMenuElement = getAutoNukeRadialElement();
    const game = radialMenuElement?.game || lastOpenFrontGameContext?.game;
    const transform =
      radialMenuElement?.transformHandler ||
      radialMenuElement?.transform ||
      lastOpenFrontGameContext?.transform;
    const myPlayer = game?.myPlayer?.();
    const buildMenu = getAutoNukeBuildMenu(radialMenuElement);
    if (
      !game ||
      !transform?.screenToWorldCoordinates ||
      !myPlayer?.isPlayer?.() ||
      !buildMenu?.sendBuildOrUpgrade
    ) {
      return null;
    }

    let worldCoords = null;
    try {
      worldCoords = transform.screenToWorldCoordinates(event.clientX, event.clientY);
      if (!game.isValidCoord?.(worldCoords.x, worldCoords.y)) {
        return null;
      }
    } catch (_error) {
      return null;
    }

    let tile = null;
    let selected = null;
    try {
      tile = game.ref(worldCoords.x, worldCoords.y);
      const owner = game.owner(tile);
      selected = owner?.isPlayer?.() ? owner : null;
    } catch (_error) {
      return null;
    }

    if (!selected?.isPlayer?.()) {
      return null;
    }

    return {
      myPlayer,
      selected,
      tile,
      playerActions: { buildableUnits: [] },
      game,
      buildMenu,
      closeMenu: hideAutoNukeContextMenu,
    };
  }

  function handleAutoNukeContextMenu(event) {
    if (!autoNukeEnabled) {
      return;
    }

    const params = getAutoNukeContextParamsFromEvent(event);
    if (!params) {
      hideAutoNukeContextMenu();
      return;
    }

    // Offset BELOW the cursor so this does not overlap the Send-1%-Boat macro menu,
    // which renders ABOVE the cursor at the same x (both used clientY - 58 → collision).
    showAutoNukeContextMenu(event.clientX + 108, event.clientY + 16, params);
  }

  function handleAutoNukeDocumentPointerDown(event) {
    const menu = document.getElementById(AUTO_NUKE_CONTEXT_MENU_ID);
    if (!menu || menu.hidden || menu.contains(event.target)) {
      return;
    }
    hideAutoNukeContextMenu();
  }

  function handleAutoNukeDocumentKeyDown(event) {
    if (event.key === "Escape") {
      hideAutoNukeContextMenu();
    }
  }

  function installAutoNukeContextMenu() {
    if (autoNukeContextMenuInstalled) {
      return;
    }

    autoNukeContextMenuInstalled = true;
    document.addEventListener("contextmenu", handleAutoNukeContextMenu, true);
    document.addEventListener("pointerdown", handleAutoNukeDocumentPointerDown, true);
    document.addEventListener("keydown", handleAutoNukeDocumentKeyDown, true);
    window.addEventListener("blur", hideAutoNukeContextMenu);
    window.addEventListener("wheel", hideAutoNukeContextMenu, true);
  }

  function uninstallAutoNukeContextMenu() {
    if (!autoNukeContextMenuInstalled) {
      return;
    }

    autoNukeContextMenuInstalled = false;
    document.removeEventListener("contextmenu", handleAutoNukeContextMenu, true);
    document.removeEventListener("pointerdown", handleAutoNukeDocumentPointerDown, true);
    document.removeEventListener("keydown", handleAutoNukeDocumentKeyDown, true);
    window.removeEventListener("blur", hideAutoNukeContextMenu);
    window.removeEventListener("wheel", hideAutoNukeContextMenu, true);
    hideAutoNukeContextMenu();
  }

  function createAutoNukeMenuItem(mode, placement) {
    const isEconomic = mode === "economic";
    const isDestruction = mode === "destruction";
    const isSamClear = mode === "sams";
    return {
      id: `${AUTO_NUKE_MENU_ITEM_PREFIX}-${placement}-${mode}`,
      name: isEconomic
        ? "auto econ nuke"
        : isDestruction
          ? "total destruction nuke"
          : isSamClear ? "destroy all sams" : "auto population nuke",
      text: isEconomic
        ? "Auto Econ"
        : isDestruction ? "Destroy" : isSamClear ? "SAMs" : "Auto Pop",
      fontSize: "10px",
      color: isEconomic
        ? "#16a34a"
        : isDestruction ? "#ca8a04" : isSamClear ? "#0284c7" : "#dc2626",
      tooltipItems: [
        {
          text: isEconomic
            ? "Auto econ nuke"
            : isDestruction
              ? "Total destruction nuke"
              : isSamClear ? "Destroy all SAMs" : "Auto population nuke",
          className: "title",
        },
        {
          text: isEconomic
            ? "Fires at the best valid economy suggestion."
            : isDestruction
              ? "Fires at combined population and economy damage, then retries once after silo cooldown."
              : isSamClear
                ? "Fires SAM-clear waves and stops before population or economy targets."
              : "Fires at the best valid population suggestion.",
          className: "description",
        },
      ],
      disabled: isAutoNukeRadialItemDisabled,
      action: (params) =>
        executeAutoNuke(params, mode, isDestruction ? "high" : null),
    };
  }

  function createAutoNukeMenuItems(params, placement) {
    if (!isAutoNukeRadialTarget(params)) {
      return [];
    }

    return [
      createAutoNukeMenuItem("economic", placement),
      createAutoNukeMenuItem("population", placement),
      createAutoNukeMenuItem("sams", placement),
      createAutoNukeMenuItem("destruction", placement),
    ];
  }

  function menuItemsContainManualNukeActions(menuItems) {
    return menuItems.some((item) => {
      const itemText = String(item?.text || item?.name || item?.id || "");
      return /atom|hydrogen|mirv|nuke/i.test(itemText);
    });
  }

  function patchAutoNukeAttackMenuItem(menuItem) {
    if (
      !menuItem ||
      typeof menuItem.subMenu !== "function" ||
      autoNukeOriginalAttackSubMenus.has(menuItem)
    ) {
      return;
    }

    const originalSubMenu = menuItem.subMenu;
    menuItem.subMenu = function openFrontHelperAutoNukeAttackSubMenu(params) {
      const menuItems = Array.from(originalSubMenu.call(this, params) || []);
      if (!autoNukeEnabled || !menuItemsContainManualNukeActions(menuItems)) {
        return menuItems;
      }

      const existingIds = new Set(menuItems.map((item) => String(item?.id || "")));
      const autoNukeItems = createAutoNukeMenuItems(params, "attack").filter(
        (item) => !existingIds.has(item.id),
      );
      return autoNukeItems.length > 0
        ? [...menuItems, ...autoNukeItems]
        : menuItems;
    };

    autoNukeOriginalAttackSubMenus.set(menuItem, originalSubMenu);
  }

  function patchAutoNukeAttackSubMenus(menuItems) {
    for (const menuItem of menuItems) {
      if (typeof menuItem?.subMenu !== "function") {
        continue;
      }

      const menuText = String(menuItem?.id || menuItem?.name || menuItem?.text || "");
      if (/attack/i.test(menuText)) {
        patchAutoNukeAttackMenuItem(menuItem);
      }
    }
  }

  function getAutoNukeRadialRootMenu() {
    const radialMenuElement = document.querySelector("main-radial-menu");
    return radialMenuElement?.radialMenu?.rootMenu || null;
  }

  function patchAutoNukeRootMenu(rootMenu) {
    if (
      !rootMenu ||
      typeof rootMenu.subMenu !== "function" ||
      autoNukeOriginalRootSubMenus.has(rootMenu)
    ) {
      return false;
    }

    const originalSubMenu = rootMenu.subMenu;
    rootMenu.subMenu = function openFrontHelperAutoNukeRootSubMenu(params) {
      const menuItems = Array.from(originalSubMenu.call(this, params) || []);
      patchAutoNukeAttackSubMenus(menuItems);
      if (!autoNukeEnabled) {
        return menuItems;
      }

      const existingIds = new Set(menuItems.map((item) => String(item?.id || "")));
      const autoNukeItems = createAutoNukeMenuItems(params, "root").filter(
        (item) => !existingIds.has(item.id),
      );
      return autoNukeItems.length > 0
        ? [...menuItems, ...autoNukeItems]
        : menuItems;
    };

    autoNukeOriginalRootSubMenus.set(rootMenu, originalSubMenu);
    return true;
  }

  function restoreAutoNukeRootMenus() {
    for (const [menuItem, originalSubMenu] of autoNukeOriginalAttackSubMenus) {
      if (menuItem?.subMenu) {
        menuItem.subMenu = originalSubMenu;
      }
    }
    autoNukeOriginalAttackSubMenus.clear();

    for (const [rootMenu, originalSubMenu] of autoNukeOriginalRootSubMenus) {
      if (rootMenu?.subMenu) {
        rootMenu.subMenu = originalSubMenu;
      }
    }
    autoNukeOriginalRootSubMenus.clear();
  }

  function scheduleAutoNukePatchRetry() {
    if (!autoNukeEnabled || autoNukePatchTimeout !== null) {
      return;
    }

    autoNukePatchTimeout = window.setTimeout(() => {
      autoNukePatchTimeout = null;
      syncAutoNukeRadialMenuPatch();
    }, AUTO_NUKE_PATCH_RETRY_MS);
  }

  function syncAutoNukeRadialMenuPatch() {
    if (!autoNukeEnabled) {
      restoreAutoNukeRootMenus();
      return;
    }

    const rootMenu = getAutoNukeRadialRootMenu();
    if (!rootMenu) {
      scheduleAutoNukePatchRetry();
      return;
    }

    patchAutoNukeRootMenu(rootMenu);
    scheduleAutoNukePatchRetry();
  }

  function setAutoNukeEnabled(enabled, includeAllies = false) {
    autoNukeEnabled = Boolean(enabled);
    autoNukeIncludeAllies = Boolean(includeAllies);
    if (autoNukePatchTimeout !== null) {
      window.clearTimeout(autoNukePatchTimeout);
      autoNukePatchTimeout = null;
    }

    restoreAutoNukeRootMenus();
    if (!autoNukeEnabled) {
      uninstallAutoNukeContextMenu();
      return;
    }

    installAutoNukeContextMenu();
  }

  function syncNukeSuggestions() {
    if (!nukeSuggestionsEnabled) {
      document.getElementById(NUKE_SUGGESTION_CONTAINER_ID)?.remove();
      nukeSuggestionAnimationFrame = null;
      clearNukeSuggestionState();
      return;
    }

    const container = ensureNukeSuggestionContainer();
    const overlay = getHoveredPlayerInfoOverlay();
    const game = overlay?.game;
    const transform = overlay?.transform;
    const targetPlayer = overlay?.player;

    if (
      !game ||
      !transform ||
      !targetPlayer?.isPlayer?.() ||
      !isEnemyNukeSuggestionTarget(game, targetPlayer)
    ) {
      clearNukeSuggestionState(container);
      nukeSuggestionAnimationFrame = requestAnimationFrame(syncNukeSuggestions);
      return;
    }

    const now = performance.now();
    if (now - lastNukeSuggestionSignatureCheckAt >= NUKE_SUGGESTION_SIGNATURE_CHECK_MS) {
      lastNukeSuggestionSignatureCheckAt = now;
      const signature = getNukeSuggestionSignature(game, targetPlayer);
      if (
        signature !== lastNukeSuggestionSignature ||
        now - lastNukeSuggestionComputedAt >= NUKE_SUGGESTION_REFRESH_MS
      ) {
        currentNukeSuggestionResults = computeNukeSuggestions(game, targetPlayer);
        lastNukeSuggestionSignature = signature;
        lastNukeSuggestionComputedAt = now;
      }
    }

    renderNukeSuggestions(container, game, transform, currentNukeSuggestionResults);
    nukeSuggestionAnimationFrame = requestAnimationFrame(syncNukeSuggestions);
  }

  function setNukeSuggestionsEnabled(enabled) {
    nukeSuggestionsEnabled = Boolean(enabled);
    if (!nukeSuggestionsEnabled) {
      if (nukeSuggestionAnimationFrame !== null) {
        cancelAnimationFrame(nukeSuggestionAnimationFrame);
      }
      nukeSuggestionAnimationFrame = null;
      document.getElementById(NUKE_SUGGESTION_CONTAINER_ID)?.remove();
      clearNukeSuggestionState();
      return;
    }

    if (nukeSuggestionAnimationFrame === null) {
      syncNukeSuggestions();
    }
  }
