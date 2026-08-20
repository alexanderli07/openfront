// Auto-Bot — lifecycle watcher + bootstrap.
// Loaded LAST: the only module that executes at load time. The watcher keeps
// the panel present and the engine cadence in sync; the guarded block starts it
// exactly once (mirrors the old IIFE's window.__openfrontAutoBotLoaded guard).

"use strict";

  // =========================================================================
  // Lifecycle watcher — show panel only inside a game, stop bot when it ends
  // =========================================================================
  function watcher() {
    // Panel is always present on openfront.io so it's easy to find and
    // pre-configure even before a match starts. The engine itself no-ops
    // safely until a game (GameView) exists.
    buildPanel();
    refreshGateBanner();
    // Show a localized idle status while disabled (core initializes it empty
    // because t()/tr() isn't available at module-load time).
    if (!state.settings.enabled && !state.status) {
      setStatus(tr("Disabled"));
    }
    renderStatus();

    // Watchdog: if a tick has been "in flight" too long (a worker call hung
    // despite the per-call timeouts, or an unexpected throw skipped finally),
    // force-clear the flag so the bot never stays frozen.
    if (
      state.tickInFlight &&
      performance.now() - state.tickStartedAt > 8000
    ) {
      console.warn("[AutoBot] tick watchdog: clearing stuck tickInFlight");
      state.tickInFlight = false;
    }

    const game = getGame();
    // Hard safety: never let the engine run in a public lobby.
    if (game && state.settings.enabled && isPublicLobby(game)) {
      setEnabled(false);
      setStatus(tr("⛔ Public lobby — auto-disabled"));
    }
    // Keep the engine cadence matched to the current game speed.
    retuneEngine();
  }

  if (!window.__openfrontAutoBotLoaded) {
    window.__openfrontAutoBotLoaded = true;
    window.setInterval(watcher, 1200);
    // The interval is registered FIRST on purpose, so a failure in this first synchronous
    // pass still self-heals ~1.2s later. But an escaping throw here would abort the rest
    // of the concatenated in-game layer — including quick-panel.js, which owns the theme
    // tokens and the crosshair listener. Contain it: the auto-bot panel is allowed to
    // fail without taking the helper UI down with it.
    try {
      watcher();
    } catch (e) {
      console.error("[ofh] auto-bot first paint failed (retrying in 1.2s):", e);
    }
    // Persisted enabled=true survives F5 — kick the engine so the tick timer
    // actually starts (loadSettings only restores the flag, not the timer).
    if (state.settings.enabled) setEnabled(true);
    console.info("[AutoBot] page bridge loaded (private-lobby training tool).");
  }


// ============================================================================
// Atom-bomb batch macro — bundled here (from atomMacro.js) so a plain page F5
// loads it. A newly-added manifest file would otherwise need a full extension
// reload; lifecycle.js was already in the manifest, so F5 re-injects it.
// A window.__ofhAtomMacroInstalled guard prevents any double-install.
// ============================================================================
// ☢️ Atom-bomb batch-fire macro (manual, hotkey "8").
//
// Flow (per the user's spec): press 8 → ARM targeting → click a tile → a dialog
// appears to choose HOW MANY atom bombs to fire at that tile. The dialog validates
// against current gold (showing the shortfall if short) and against READY missile-silo
// shots (showing the silo shortfall). On confirm it fires as many as possible RIGHT
// NOW = min(quantity, ready silo shots); gold naturally caps the rest (the sim rejects
// launches it can't afford). Self-contained — own DOM + listeners, like boat-macro.js;
// does NOT touch the auto-bot panel, so it works regardless of panel state.

// Wrapped in an IIFE (unlike the other auto-bot files) so its top-level names can
// NEVER collide with the shared global lexical scope — a redeclaration there aborts
// the whole script BEFORE any log, which is exactly the "no [AtomMacro] log at all"
// symptom we hit. The IIFE still sees shared globals (tr, lastOpenFrontGameContext).
(function () {
  "use strict";
  console.log("[AtomMacro] script start — file is injected & executing");
  // Page-level idempotency guard: the same code also lives at the end of
  // lifecycle.js (so a plain F5 loads it without an extension reload). Whichever
  // copy runs first installs; the other no-ops.
  if (window.__ofhAtomMacroInstalled) {
    console.log("[AtomMacro] already installed in this page → skip duplicate");
    return;
  }

  const ATOM_MACRO_DIALOG_ID = "openfront-helper-atom-macro-dialog";
  const ATOM_MACRO_BANNER_ID = "openfront-helper-atom-macro-banner";
  const ATOM_MACRO_STYLE_ID = "openfront-helper-atom-macro-styles";
  const ATOM_RANGE_CONTAINER_ID = "openfront-helper-atom-range";
  const ATOM_RANGE_STYLE_ID = "openfront-helper-atom-range-styles";
  const ATOM_UNIT = "Atom Bomb";
  const HYDROGEN_UNIT = "Hydrogen Bomb";
  const SILO_UNIT = "Missile Silo";
  const SAM_UNIT = "SAM Launcher";
  // Fallback blast radii (world units) if the live config is unreachable — the real
  // values come from game.config().nukeMagnitudes(type).outer (Atom 30 / Hydrogen 100).
  const ATOM_FALLBACK_RADIUS = 30;
  const HYDROGEN_FALLBACK_RADIUS = 100;
  // Manhattan px a left-press may move before it counts as a DRAG (map pan) instead of a
  // click. Matches the game's own InputHandler.DRAG_THRESHOLD_PX so our click/drag split
  // lines up with when the game would treat the gesture as a pan.
  const ATOM_DRAG_THRESHOLD = 10;

  let atomMacroInstalled = false;
  let atomAiming = false; // ring-aiming mode: blast rings shown, waiting for a click
  let atomAimCtx = null; // game context cached for per-mousemove ring sizing
  let atomAimRadii = null; // { a, h } world radii captured when aiming starts
  let atomSwallowUntil = 0; // swallow the click that trails a committing pointerup
  let atomPressing = false; // a left-press is in progress while aiming (click-vs-drag)
  let atomPressX = 0;
  let atomPressY = 0;
  let atomLastMouseX = 0;
  let atomLastMouseY = 0;

  // ── game-context access (mirrors boat-macro.js) ────────────────────────────
  function atomRadialElement() {
    return document.querySelector("main-radial-menu");
  }
  function atomGameContext() {
    const radial = atomRadialElement();
    const game =
      radial?.game ||
      (typeof lastOpenFrontGameContext !== "undefined"
        ? lastOpenFrontGameContext?.game
        : null);
    const transform =
      radial?.transformHandler ||
      radial?.transform ||
      (typeof lastOpenFrontGameContext !== "undefined"
        ? lastOpenFrontGameContext?.transform
        : null);
    const buildMenu = radial?.buildMenu || document.querySelector("build-menu");
    const myPlayer = game?.myPlayer?.();
    return { game, transform, buildMenu, myPlayer };
  }

  function atomTileFromScreen(ctx, clientX, clientY) {
    const { game, transform } = ctx;
    if (!game || !transform?.screenToWorldCoordinates) return null;
    try {
      const w = transform.screenToWorldCoordinates(clientX, clientY);
      if (!game.isValidCoord?.(w.x, w.y)) return null;
      const tile = game.ref(w.x, w.y);
      return tile == null ? null : tile;
    } catch (_e) {
      return null;
    }
  }

  // ── silo readiness: total atom shots we can fire THIS instant ──────────────
  // A level-N silo holds N missiles; missileTimerQueue holds the ones on cooldown,
  // so ready shots = level − queue.length, summed over built, active silos.
  function atomReadyShots(player) {
    let shots = 0;
    let silos = [];
    try {
      silos = player.units(SILO_UNIT) || [];
    } catch (_e) {
      return 0;
    }
    for (const s of silos) {
      try {
        if (s.isUnderConstruction && s.isUnderConstruction()) continue;
        if (s.isActive && s.isActive() === false) continue;
        const level = (s.level && Number(s.level())) || 1;
        const queue = (s.missileTimerQueue && s.missileTimerQueue()) || [];
        const qlen = Array.isArray(queue) ? queue.length : 0;
        shots += Math.max(0, level - qlen);
      } catch (_e) {
        shots += 1; // defensive: assume the silo can fire once
      }
    }
    return shots;
  }

  // ── Smart-quantity: how many nukes to overwhelm the SAMs that will intercept a
  // strike on `tile`, + 1 to land. Mirrors NationNukeBehavior: an enemy SAM of
  // level N intercepts N nukes before its cooldown, so to land ONE we need
  // (Σ intercepting-SAM levels) + 1. We count SAMs along the nuke's WHOLE flight
  // path (atomCoveringSamsAlongPath), not just over the impact tile, because the
  // game can intercept on any "targetable" trajectory tile within a SAM's range —
  // a SAM by the approach corridor still stops the missile mid-flight. Defensive
  // about every accessor so a missing method just yields "no coverage".

  // Shared per-SAM test. `s` is a nearbyUnits(refTile,…) entry ({unit,distSquared})
  // or a raw unit; refTile is the tile the distance is measured from. Returns
  // {unit, level} when the SAM is a built, hostile (non-own; non-ally unless our
  // team has already won) launcher whose level-scaled range covers refTile, else
  // null. samRange(level) grows with level, so higher-level SAMs reach further.
  function atomSamCovering(game, cfg, myPlayer, mySid, won, s, refTile) {
    const unit = s.unit || s;
    const owner = unit.owner && unit.owner();
    if (!owner) return null;
    if (owner.smallID && owner.smallID() === mySid) return null; // never our own SAMs
    // ally SAMs are ignored UNTIL the team win (then they intercept us too)
    if (!won && myPlayer.isFriendly && myPlayer.isFriendly(owner)) return null;
    if (unit.isUnderConstruction && unit.isUnderConstruction()) return null;
    const level = (unit.level && Number(unit.level())) || 1;
    const range = cfg && cfg.samRange ? Number(cfg.samRange(level)) : 0;
    let distSq = s.distSquared;
    if (distSq == null && game.euclideanDistSquared && unit.tile) {
      distSq = game.euclideanDistSquared(refTile, unit.tile());
    }
    if (range > 0 && distSq != null && distSq <= range * range) {
      return { unit, level };
    }
    return null;
  }

  // Impact-tile coverage only — SAMs whose range covers `tile` itself. The safe
  // fallback used whenever we can't build a flight path.
  function atomCoveringSams(game, myPlayer, tile) {
    const out = [];
    try {
      // After our TEAM has won, allies can nuke each other and ALLIED SAMs will
      // intercept our missiles too — so once won we STOP excluding friendly SAMs.
      const won = atomTeamHasWon(game, myPlayer);
      const cfg = game.config && game.config();
      const maxRange =
        cfg && cfg.maxSamRange ? Number(cfg.maxSamRange()) : 200;
      const nearby = game.nearbyUnits
        ? game.nearbyUnits(tile, maxRange, SAM_UNIT)
        : [];
      const mySid = myPlayer.smallID ? myPlayer.smallID() : -1;
      for (const s of nearby) {
        const hit = atomSamCovering(game, cfg, myPlayer, mySid, won, s, tile);
        if (hit) out.push(hit);
      }
    } catch (_e) {
      /* ignore → treat as no coverage */
    }
    return out;
  }

  // Our nearest launch silo — mirrors PlayerImpl.nukeSpawn (closest active, built
  // MissileSilo by Manhattan distance to the target). Cooldown is ignored: it is
  // transient and never changes a silo's flight geometry. Returns a tile or null.
  function atomLaunchSiloTile(game, myPlayer, tile) {
    try {
      const silos = (myPlayer.units && myPlayer.units(SILO_UNIT)) || [];
      let best = null;
      let bestDist = Infinity;
      for (const s of silos) {
        if (s.isUnderConstruction && s.isUnderConstruction()) continue;
        if (s.isActive && s.isActive() === false) continue;
        const st = s.tile && s.tile();
        if (st == null) continue;
        const d = game.manhattanDist ? game.manhattanDist(st, tile) : 0;
        if (d < bestDist) {
          bestDist = d;
          best = st;
        }
      }
      return best;
    } catch (_e) {
      return null;
    }
  }

  // Trajectory-aware coverage: every SAM that can intercept the nuke ANYWHERE
  // along its parabolic flight path, not only over the impact tile. The game lets
  // a SAM fire at any trajectory tile that is "targetable" (within
  // defaultNukeTargetableRange of the launch site OR the target) and inside the
  // SAM's range — see SAMLauncherExecution.computeInterceptionTile and
  // NukeExecution.getTrajectory. So a SAM straddling the approach corridor
  // intercepts even when its range never reaches the impact tile itself. Same
  // parabola + targetable filter as NukeBehavior.isTrajectoryInterceptableBySam.
  // DIVERGENCE: models the nearest silo only (nukeSpawn order — where the first /
  // most bombs launch). Later salvo bombs from farther silos fly other corridors
  // and may meet different SAMs. Falls back to impact-tile coverage on any
  // failure so the dialog never breaks.
  function atomCoveringSamsAlongPath(game, myPlayer, tile, rocketDirectionUp) {
    try {
      if (
        typeof UniversalPathFinding === "undefined" ||
        !UniversalPathFinding.Parabola ||
        !game.euclideanDistSquared
      ) {
        return atomCoveringSams(game, myPlayer, tile);
      }
      const src = atomLaunchSiloTile(game, myPlayer, tile);
      if (src == null) return atomCoveringSams(game, myPlayer, tile);

      const cfg = game.config && game.config();
      const speed =
        cfg && cfg.defaultNukeSpeed ? Number(cfg.defaultNukeSpeed()) : 8;
      const pathFinder = UniversalPathFinding.Parabola(game, {
        increment: speed,
        distanceBasedHeight: true, // Atom/Hydrogen bombs use distance-based height
        // Honour the player's "Flip rocket trajectory" toggle. The macro fires via
        // BuildMenu.sendBuildOrUpgrade, which tags each atom/hydro intent with the
        // shared uiState.rocketDirectionUp, so the real bomb bows the way the toggle
        // is set — flipping the arc sweeps a DIFFERENT approach corridor and thus a
        // different set of SAMs. directionUp maps 1:1 to it (default true = arc up).
        directionUp: rocketDirectionUp !== false,
      });
      const trajectory = pathFinder.findPath(src, tile) || [];
      if (trajectory.length === 0) return atomCoveringSams(game, myPlayer, tile);

      const won = atomTeamHasWon(game, myPlayer);
      const mySid = myPlayer.smallID ? myPlayer.smallID() : -1;
      const maxRange = cfg && cfg.maxSamRange ? Number(cfg.maxSamRange()) : 200;
      const tRange =
        cfg && cfg.defaultNukeTargetableRange
          ? Number(cfg.defaultNukeTargetableRange())
          : 150;
      const tRangeSq = tRange * tRange;

      // Dedup: a SAM in range of several trajectory tiles still intercepts only
      // ONE nuke per its level — count each SAM exactly once, by unit id.
      const byId = new Map();
      for (const tt of trajectory) {
        // Only "targetable" tiles can be intercepted (within range of the launch
        // site OR the target). Skip the untargetable mid-flight arc — SAMs there
        // physically can't fire, so counting them would over-recommend.
        const dToTarget = game.euclideanDistSquared(tt, tile);
        const dToSrc = game.euclideanDistSquared(tt, src);
        if (!(dToTarget < tRangeSq || dToSrc < tRangeSq)) continue;
        const nearby = game.nearbyUnits
          ? game.nearbyUnits(tt, maxRange, SAM_UNIT)
          : [];
        for (const s of nearby) {
          const hit = atomSamCovering(game, cfg, myPlayer, mySid, won, s, tt);
          if (!hit) continue;
          const id = hit.unit.id ? hit.unit.id() : hit.unit;
          if (!byId.has(id)) byId.set(id, hit);
        }
      }
      return Array.from(byId.values());
    } catch (_e) {
      return atomCoveringSams(game, myPlayer, tile);
    }
  }

  // Fastest server-safe fire cadence (ms between atom intents). The server drops build
  // intents above ~10/sec (ClientMsgRateLimiter), so the macro never fires below this;
  // the per-spam/delay knobs only slow it further. Shared by fireAtoms AND the
  // reload-aware recommendation so the dialog's number matches the real delivery rate.
  const ATOM_SAFE_GAP_MS = 140; // ~7/sec — 30% under the 10/sec cap
  function atomFireGapMs(batchSize, delayMs) {
    const perShot = batchSize >= 1 ? (delayMs || 0) / batchSize : delayMs || 0;
    return Math.max(ATOM_SAFE_GAP_MS, Math.floor(perShot) || 0);
  }

  // Reload-aware overwhelm check. The Σ covering-SAM levels (`B`) intercept B nukes per
  // SAM cooldown (90 ticks = 9s). To land the (B+1)th, it must reach the SAMs BEFORE the
  // first interceptor slot reloads — i.e. the arrival spread of the B blocking bombs
  // (≈ B × gap) must stay under one cooldown. The maths is a CLIFF, not a smooth scale:
  //   • B × gap < cooldown  → a tight Σ+1 salvo overwhelms them (classic case).
  //   • B × gap ≥ cooldown  → a slot reloads before the (B+1)th lands, and adding bombs
  //     only lengthens delivery, so it reloads again — NO finite salvo wins. Firing too
  //     slowly (or facing too many SAM levels) flips this; atom spam then can't do it
  //     (need MIRV / kill the SAMs another way). There is no stable "×N windows" middle.
  function atomReloadAwareSalvo(baseIntercept, gapMs, cooldownTicks) {
    const B = Math.max(0, Math.floor(baseIntercept));
    if (B <= 0) return { recommended: 1, achievable: true };
    // ms -> ticks. At 10 ticks/sec that is gapMs/100, but the tick rate follows the game
    // speed, so a fixed divisor under-counts the delivery spread by exactly the speed
    // factor and moves the SAM-overwhelm cliff. Unlike the overlays, this code only runs
    // inside the bot's own loop, so state.speed.factor is live here.
    let _spd = 1;
    try {
      const f = Number(state.speed && state.speed.factor);
      if (Number.isFinite(f) && f > 0) _spd = f;
    } catch (_e) {
      _spd = 1;
    }
    const gapTicks = Math.max(1, (gapMs / 100) * _spd);
    const cd = cooldownTicks > 0 ? cooldownTicks : 90;
    const deliveryTicks = B * gapTicks; // arrival spread of the B blocking bombs
    return {
      recommended: B + 1, // classic Σ + 1 — inflating it past the cliff just wastes gold
      achievable: deliveryTicks < cd,
    };
  }

  function atomRecommendedQty(game, myPlayer, tile, rocketDirectionUp, gapMs) {
    // Count SAMs along the WHOLE flight path (not just the impact tile), since the game
    // can intercept anywhere the nuke is targetable. The path bows by the player's
    // flip-trajectory toggle. Each level-N SAM stops N nukes per cooldown, so a tight
    // batch needs Σ levels + 1 — UNLESS we deliver slower than a cooldown, in which case
    // the SAMs reload and no salvo gets through (achievable=false; see atomReloadAware-
    // Salvo). The recommendation reflects the live per-spam/delay cadence via gapMs.
    const sams = atomCoveringSamsAlongPath(game, myPlayer, tile, rocketDirectionUp);
    const intercept = sams.reduce((sum, s) => sum + s.level, 0);
    let cooldownTicks = 90;
    try {
      const c =
        game.config && game.config().SAMCooldown
          ? Number(game.config().SAMCooldown())
          : 90;
      if (Number.isFinite(c) && c > 0) cooldownTicks = c;
    } catch (_e) {
      /* keep 90 */
    }
    const gap = Number.isFinite(gapMs) && gapMs > 0 ? gapMs : ATOM_SAFE_GAP_MS;
    const plan = atomReloadAwareSalvo(intercept, gap, cooldownTicks);
    // Also test the FASTEST safe cadence: if even that can't overwhelm them, no rate
    // tweak helps (too many SAM levels → MIRV); if only the current (slower) rate fails,
    // firing faster fixes it. Lets the dialog give the RIGHT advice.
    const planFast = atomReloadAwareSalvo(intercept, ATOM_SAFE_GAP_MS, cooldownTicks);
    return {
      sams: sams.length,
      intercept,
      recommended: plan.recommended,
      achievable: plan.achievable,
      achievableAtMaxRate: planFast.achievable,
    };
  }

  function atomToBig(n) {
    try {
      return typeof n === "bigint" ? n : BigInt(Math.floor(Number(n) || 0));
    } catch (_e) {
      return 0n;
    }
  }
  function atomFmt(n) {
    const v = atomToBig(n);
    const neg = v < 0n;
    const abs = neg ? -v : v;
    let s;
    if (abs >= 1000000n) s = (Number(abs) / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
    else if (abs >= 1000n) s = (Number(abs) / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    else s = abs.toString();
    return (neg ? "-" : "") + s;
  }

  function atomT(s) {
    // Use the auto-bot translator if present, else passthrough.
    try {
      if (typeof tr === "function") return tr(s);
    } catch (_e) {
      /* ignore */
    }
    return s;
  }

  function ensureAtomStyles() {
    if (document.getElementById(ATOM_MACRO_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ATOM_MACRO_STYLE_ID;
    style.textContent = `
      #${ATOM_MACRO_BANNER_ID} {
        position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
        z-index: 9000; padding: 7px 14px; border-radius: 8px;
        background: rgba(127,29,29,0.95); border: 1px solid rgba(248,113,113,0.6);
        color: var(--oh-panel-text, #e2e8f0); font: 800 13px/1.2 system-ui, sans-serif; white-space: nowrap;
        box-shadow: 0 8px 22px rgba(0,0,0,0.45); pointer-events: none;
      }
      #${ATOM_MACRO_BANNER_ID}[hidden] { display: none; }
      #${ATOM_MACRO_DIALOG_ID} {
        position: fixed; z-index: 9000; width: 250px; padding: 0; overflow: hidden;
        display: flex; flex-direction: column; max-height: calc(100vh - 16px);
        border: 1px solid rgba(248,113,113,0.34); border-radius: 12px;
        background:
          linear-gradient(180deg, rgba(127,29,29,0.24), transparent 40%),
          rgba(9,14,18,0.98);
        color: #f1f5f9;
        font: 500 12px/1.35 "Aptos","Segoe UI",system-ui,-apple-system,sans-serif;
        box-shadow: 0 18px 46px rgba(0,0,0,0.55), inset 0 1px 0 rgba(254,202,202,0.08);
      }
      #${ATOM_MACRO_DIALOG_ID}[hidden] { display: none; }
      #${ATOM_MACRO_DIALOG_ID} .atom-hd {
        flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px;
        border-bottom: 1px solid rgba(248,113,113,0.16); background: rgba(127,29,29,0.16);
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-ico { font-size: 14px; filter: drop-shadow(0 0 6px rgba(248,113,113,0.6)); }
      #${ATOM_MACRO_DIALOG_ID} .atom-ttl { flex: 1; font-size: 11px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: var(--oh-panel-text, #e2e8f0); }
      #${ATOM_MACRO_DIALOG_ID} .atom-key {
        font: 800 11px/1 "Consolas","Aptos",monospace; color: var(--oh-panel-text, #e2e8f0); padding: 3px 7px;
        border: 1px solid rgba(248,113,113,0.4); border-bottom-width: 2px; border-radius: 5px; background: rgba(0,0,0,0.3);
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-x {
        flex: none; width: 22px; height: 22px; padding: 0; border-radius: 6px; display: grid; place-items: center;
        font-size: 13px; line-height: 1; cursor: pointer; transition: 0.14s;
        color: var(--oh-panel-text, #e2e8f0); background: rgba(127,29,29,0.35); border: 1px solid rgba(248,113,113,0.34);
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-x:hover { background: rgba(190,30,30,0.62); color: #fff; }
      #${ATOM_MACRO_DIALOG_ID} .atom-bd { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 11px 12px 12px; }
      #${ATOM_MACRO_DIALOG_ID} .atom-bd::-webkit-scrollbar { width: 8px; }
      #${ATOM_MACRO_DIALOG_ID} .atom-bd::-webkit-scrollbar-thumb { background: rgba(248,113,113,0.28); border-radius: 999px; }
      #${ATOM_MACRO_DIALOG_ID} .atom-qty { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
      #${ATOM_MACRO_DIALOG_ID} .atom-qty label { flex: none; font-size: 11px; font-weight: 700; letter-spacing: 0.3px; color: #cbd5e1; }
      #${ATOM_MACRO_DIALOG_ID} .atom-qty input {
        flex: 1; width: 100%; min-width: 0; padding: 7px 9px; border-radius: 8px; text-align: center;
        border: 1px solid rgba(148,163,184,0.32); background: rgba(255,255,255,0.05);
        color: #f8fafc; font: 800 15px/1 inherit;
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-qty input:focus { outline: none; border-color: rgba(248,113,113,0.6); }
      #${ATOM_MACRO_DIALOG_ID} .atom-cad {
        flex: none; font-size: 10px; font-weight: 800; color: var(--oh-accent, #60a5fa); white-space: nowrap;
        padding: 4px 7px; border-radius: 6px; border: 1px solid rgba(52,211,153,0.26); background: rgba(52,211,153,0.10);
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-hydro {
        display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; transition: 0.14s;
        padding: 7px 9px; border-radius: 8px; margin-bottom: 10px; color: var(--oh-panel-text, #e2e8f0); font-size: 11px;
        border: 1px solid rgba(148,163,184,0.16); background: rgba(255,255,255,0.03);
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-hydro:hover { border-color: rgba(251,191,36,0.45); }
      #${ATOM_MACRO_DIALOG_ID} .atom-hydro input { flex: none; width: 15px; height: 15px; accent-color: var(--oh-accent, #60a5fa); cursor: pointer; }
      #${ATOM_MACRO_DIALOG_ID} .atom-hydro .atom-hico { font-size: 13px; }
      #${ATOM_MACRO_DIALOG_ID} .atom-hydro[data-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
      #${ATOM_MACRO_DIALOG_ID} .atom-stats {
        display: flex; flex-direction: column; border-radius: 9px; overflow: hidden; margin-bottom: 10px;
        border: 1px solid rgba(148,163,184,0.12); background: rgba(0,0,0,0.22);
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-line { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 10px; }
      #${ATOM_MACRO_DIALOG_ID} .atom-line + .atom-line { border-top: 1px solid rgba(148,163,184,0.08); }
      #${ATOM_MACRO_DIALOG_ID} .atom-line .atom-k { color: #94a3b8; font-weight: 600; }
      #${ATOM_MACRO_DIALOG_ID} .atom-line .atom-v { font-weight: 800; color: var(--oh-panel-text, #e2e8f0); font-variant-numeric: tabular-nums; }
      #${ATOM_MACRO_DIALOG_ID} .atom-hl { background: rgba(34,197,94,0.07); }
      #${ATOM_MACRO_DIALOG_ID} .atom-ok { color: var(--oh-accent, #60a5fa); }
      #${ATOM_MACRO_DIALOG_ID} .atom-bad { color: #f87171; }
      #${ATOM_MACRO_DIALOG_ID} .atom-warn {
        margin-bottom: 10px; padding: 7px 10px; border-radius: 8px; font-size: 10px; line-height: 1.45; color: var(--oh-panel-text, #e2e8f0);
        border: 1px solid rgba(248,113,113,0.28); background: rgba(127,29,29,0.26);
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-note { margin: 0 0 11px; font-size: 9.5px; line-height: 1.5; color: #64748b; }
      #${ATOM_MACRO_DIALOG_ID} .atom-btns { display: flex; gap: 8px; }
      #${ATOM_MACRO_DIALOG_ID} button {
        padding: 9px 12px; border: none; border-radius: 8px; cursor: pointer;
        font: 800 12px/1 "Aptos","Segoe UI",sans-serif; letter-spacing: 0.3px; transition: 0.14s;
      }
      #${ATOM_MACRO_DIALOG_ID} .atom-fire { flex: 1; color: #fff; background: linear-gradient(135deg,#ef4444,#dc2626); box-shadow: 0 4px 14px rgba(220,38,38,0.35); }
      #${ATOM_MACRO_DIALOG_ID} .atom-fire:hover { background: linear-gradient(135deg,#f87171,#ef4444); }
      #${ATOM_MACRO_DIALOG_ID} .atom-fire:disabled { background: rgba(100,116,139,0.35); color: rgba(226,232,240,0.45); box-shadow: none; cursor: not-allowed; }
      #${ATOM_MACRO_DIALOG_ID} .atom-fire:disabled:hover { background: rgba(100,116,139,0.35); }
      #${ATOM_MACRO_DIALOG_ID} .atom-fire[hidden] { display: none; }
      #${ATOM_MACRO_DIALOG_ID} .atom-force { flex: 1; color: #fff; background: linear-gradient(135deg,var(--oh-accent, #60a5fa),var(--oh-accent, #60a5fa)); box-shadow: 0 4px 14px rgba(217,119,6,0.35); }
      #${ATOM_MACRO_DIALOG_ID} .atom-force:hover { background: linear-gradient(135deg,var(--oh-accent, #60a5fa),var(--oh-accent, #60a5fa)); }
      #${ATOM_MACRO_DIALOG_ID} .atom-force:disabled { background: rgba(100,116,139,0.35); color: rgba(226,232,240,0.45); box-shadow: none; cursor: not-allowed; }
      #${ATOM_MACRO_DIALOG_ID} .atom-force[hidden] { display: none; }
      #${ATOM_MACRO_DIALOG_ID} .atom-cancel { flex: none; color: #e5e7eb; background: rgba(255,255,255,0.08); }
      #${ATOM_MACRO_DIALOG_ID} .atom-cancel:hover { background: rgba(255,255,255,0.16); }
    `;
    document.head.appendChild(style);
  }

  function atomBanner(text, kind) {
    ensureAtomStyles();
    let b = document.getElementById(ATOM_MACRO_BANNER_ID);
    if (!b) {
      b = document.createElement("div");
      b.id = ATOM_MACRO_BANNER_ID;
      document.body.appendChild(b);
    }
    b.textContent = text;
    b.style.background =
      kind === "ok" ? "rgba(22,101,52,0.95)" : "rgba(127,29,29,0.95)";
    b.hidden = false;
    return b;
  }
  function hideAtomBanner() {
    const b = document.getElementById(ATOM_MACRO_BANNER_ID);
    if (b) b.hidden = true;
  }

  function hideAtomDialog() {
    const d = document.getElementById(ATOM_MACRO_DIALOG_ID);
    if (d) d.remove();
  }

  // Smart placement around an anchor (the cursor/click point). Measures the FULLY
  // rendered dialog, then prefers below-right of the anchor but flips above / to the
  // left when that side would overflow — so near the bottom or right edge the whole
  // dialog (incl. Fire/Cancel) stays on-screen. Final clamp is the last-resort guard.
  function positionAtomDialog(dlg, ax, ay) {
    const GAP = 14;
    const M = 6; // viewport margin
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = dlg.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    // horizontal: right of the anchor, flip to the left if it would spill off-screen
    let left = ax + GAP;
    if (left + w > vw - M) left = ax - GAP - w;
    left = Math.min(Math.max(M, left), Math.max(M, vw - w - M));
    // vertical: below the anchor, flip above the cursor if it would spill off-screen
    let top = ay + GAP;
    if (top + h > vh - M) top = ay - GAP - h;
    top = Math.min(Math.max(M, top), Math.max(M, vh - h - M));
    dlg.style.left = `${left}px`;
    dlg.style.top = `${top}px`;
    dlg.style.visibility = "";
  }

  // ── aiming preview rings (atom + hydrogen blast radius) ────────────────────
  // Live blast radius (world units) for a nuke type, from the game config (falls
  // back to the known defaults). nukeMagnitudes(type) → { inner, outer }; the OUTER
  // ring is the destruction radius, which is what we preview.
  function atomWorldRadius(game, type, fallback) {
    try {
      const m = game?.config?.().nukeMagnitudes?.(type);
      const r = Number(m?.outer ?? m?.inner);
      if (Number.isFinite(r) && r > 0) return r;
    } catch (_e) {
      /* use fallback */
    }
    return fallback;
  }

  // World radius → on-screen pixels. transform.scale is px-per-world-unit (mirrors
  // the game's own nuke-FX sizing); if it's missing, project a radius-offset point.
  function atomRingScreenRadius(ctx, worldRadius, cx, cy) {
    const t = ctx && ctx.transform;
    const scale = Number(t && t.scale);
    if (Number.isFinite(scale) && scale > 0) return worldRadius * scale;
    try {
      const w = t.screenToWorldCoordinates(cx, cy);
      const a = t.worldToScreenCoordinates({ x: w.x, y: w.y });
      const b = t.worldToScreenCoordinates({ x: w.x + worldRadius, y: w.y });
      return Math.hypot(b.x - a.x, b.y - a.y);
    } catch (_e) {
      return worldRadius;
    }
  }

  function ensureAtomRangeStyles() {
    if (document.getElementById(ATOM_RANGE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ATOM_RANGE_STYLE_ID;
    style.textContent = `
      #${ATOM_RANGE_CONTAINER_ID} {
        position: fixed; inset: 0; z-index: 500; pointer-events: none;
      }
      #${ATOM_RANGE_CONTAINER_ID}[hidden] { display: none; }
      #${ATOM_RANGE_CONTAINER_ID} .atom-rng {
        position: fixed; left: 0; top: 0; border-radius: 50%; box-sizing: border-box;
        transform: translate(-50%, -50%); will-change: left, top, width, height;
      }
      #${ATOM_RANGE_CONTAINER_ID} .atom-rng-h {
        border: 2px dashed rgba(248,113,113,0.9);
        box-shadow: 0 0 20px rgba(248,113,113,0.35), inset 0 0 26px rgba(248,113,113,0.12);
      }
      #${ATOM_RANGE_CONTAINER_ID} .atom-rng-a {
        border: 2px solid rgba(251,191,36,0.95);
        box-shadow: 0 0 16px rgba(251,191,36,0.4), inset 0 0 18px rgba(251,191,36,0.16);
      }
      #${ATOM_RANGE_CONTAINER_ID} .atom-rng-dot {
        position: fixed; left: 0; top: 0; width: 8px; height: 8px; border-radius: 50%;
        transform: translate(-50%, -50%); background: var(--oh-panel-text, #e2e8f0);
        box-shadow: 0 0 8px rgba(251,191,36,0.9), 0 0 2px #000;
      }
      #${ATOM_RANGE_CONTAINER_ID} .atom-rng-tag {
        position: fixed; left: 0; top: 0; transform: translate(14px, 14px); white-space: nowrap;
        font: 800 11px/1 "Aptos","Segoe UI",system-ui,sans-serif; color: var(--oh-panel-text, #e2e8f0);
        padding: 5px 9px; border-radius: 8px; border: 1px solid rgba(248,113,113,0.45);
        background: rgba(7,12,18,0.86); box-shadow: 0 6px 18px rgba(0,0,0,0.5);
      }
      #${ATOM_RANGE_CONTAINER_ID} .atom-rng-tag b { color: var(--oh-accent, #60a5fa); }
      #${ATOM_RANGE_CONTAINER_ID} .atom-rng-tag i { color: var(--oh-panel-text, #e2e8f0); font-style: normal; }
    `;
    document.head.appendChild(style);
  }

  function atomRangeContainer() {
    ensureAtomRangeStyles();
    let c = document.getElementById(ATOM_RANGE_CONTAINER_ID);
    if (!c) {
      c = document.createElement("div");
      c.id = ATOM_RANGE_CONTAINER_ID;
      c.setAttribute("aria-hidden", "true");
      c.innerHTML = `
        <div class="atom-rng atom-rng-h" data-role="rng-h"></div>
        <div class="atom-rng atom-rng-a" data-role="rng-a"></div>
        <div class="atom-rng-dot" data-role="rng-dot"></div>
        <div class="atom-rng-tag" data-role="rng-tag">☢️ <b>${atomT("Atom")}</b> · <i>${atomT("Hydrogen")}</i> — ${atomT("click to aim")}</div>`;
      document.body.appendChild(c);
    }
    return c;
  }

  function updateAtomRings(cx, cy) {
    const c = document.getElementById(ATOM_RANGE_CONTAINER_ID);
    if (!c || !atomAimCtx || !atomAimRadii) return;
    const hPx = atomRingScreenRadius(atomAimCtx, atomAimRadii.h, cx, cy);
    const setRing = (sel, px) => {
      const el = c.querySelector(sel);
      if (!el) return;
      const d = Math.max(2, px * 2);
      el.style.width = `${d}px`;
      el.style.height = `${d}px`;
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
    };
    setRing('[data-role="rng-h"]', hPx);
    // Atom ring + dot + "click to aim" tag are ours only in FALLBACK mode. In
    // native mode (atomAimRadii.a == null) the game already draws the Atom blast
    // circle and a crosshair, so we render ONLY the larger Hydrogen ring on top
    // (both bomb ranges visible at once) and hide the rest to avoid doubling.
    const native = atomAimRadii.a == null;
    const aEl = c.querySelector('[data-role="rng-a"]');
    if (aEl) {
      aEl.style.display = native ? "none" : "";
      if (!native) {
        const aPx = atomRingScreenRadius(atomAimCtx, atomAimRadii.a, cx, cy);
        const d = Math.max(2, aPx * 2);
        aEl.style.width = `${d}px`;
        aEl.style.height = `${d}px`;
        aEl.style.left = `${cx}px`;
        aEl.style.top = `${cy}px`;
      }
    }
    const dot = c.querySelector('[data-role="rng-dot"]');
    if (dot) {
      dot.style.display = native ? "none" : "";
      dot.style.left = `${cx}px`;
      dot.style.top = `${cy}px`;
    }
    const tag = c.querySelector('[data-role="rng-tag"]');
    if (tag) {
      // the "click to aim" hint only makes sense while actively aiming in fallback
      // mode; hide it in native mode and once the rings are frozen under a dialog.
      tag.style.display = atomAiming && !native ? "" : "none";
      tag.style.left = `${cx}px`;
      tag.style.top = `${cy}px`;
    }
  }

  function showAtomRings() {
    const c = atomRangeContainer();
    c.hidden = false;
  }
  function hideAtomRings() {
    const c = document.getElementById(ATOM_RANGE_CONTAINER_ID);
    if (c) c.hidden = true;
  }

  // ── native game overlay (SAM ranges + nuke trajectory) ─────────────────────
  // Set the game's shared uiState.ghostStructure = "Atom Bomb" while aiming and
  // the game's own BuildPreviewController renders the SAM-range circles + the
  // trajectory arc (white→red on intercept) that pressing 8/9 shows — pixel-
  // perfect, zero render code here. The macro's capture-phase pointerup swallow
  // already stops the game's native build-on-click, so setting the ghost only
  // draws the preview. Falls back to the macro's own blast rings when uiState
  // isn't reachable. Cleared (→ null) the instant we commit / cancel / close.
  let atomUsingNativeOverlay = false;
  function atomNativeOverlayAvailable(ctx) {
    try {
      const ui = ctx && ctx.buildMenu && ctx.buildMenu.uiState;
      return !!ui && "ghostStructure" in ui;
    } catch (_e) {
      return false;
    }
  }
  function atomSetGhost(ctx, type) {
    try {
      const ui = ctx && ctx.buildMenu && ctx.buildMenu.uiState;
      if (ui) ui.ghostStructure = type;
    } catch (_e) {
      /* best-effort */
    }
  }
  function atomClearGhost(ctx) {
    atomSetGhost(ctx || atomGameContext(), null);
  }

  function startAtomAiming(ctx) {
    hideAtomDialog(); // pressing the hotkey re-aims: drop any open dialog so we retarget
    atomAiming = true;
    atomAimCtx = ctx;
    atomUsingNativeOverlay = atomNativeOverlayAvailable(ctx);
    if (atomUsingNativeOverlay) {
      // Game vẽ SAM + đường đạn + vòng nổ Atom (giống bấm 8/9). Macro chỉ THÊM vòng
      // Hydrogen lớn để thấy phạm vi cả hai loại bom cùng lúc; KHÔNG vẽ lại vòng Atom
      // (a = null) để tránh trùng với vòng Atom của game.
      atomAimRadii = {
        a: null,
        h: atomWorldRadius(ctx.game, HYDROGEN_UNIT, HYDROGEN_FALLBACK_RADIUS),
      };
      atomSetGhost(ctx, ATOM_UNIT);
      showAtomRings();
      updateAtomRings(atomLastMouseX, atomLastMouseY);
    } else {
      // Fallback: vòng blast tự vẽ của macro.
      atomAimRadii = {
        a: atomWorldRadius(ctx.game, ATOM_UNIT, ATOM_FALLBACK_RADIUS),
        h: atomWorldRadius(ctx.game, HYDROGEN_UNIT, HYDROGEN_FALLBACK_RADIUS),
      };
      showAtomRings();
      updateAtomRings(atomLastMouseX, atomLastMouseY);
    }
    atomBanner("☢️ " + atomT("Left-click a target to set up the strike · Esc to cancel"), "arm");
  }
  function stopAtomAiming() {
    if (atomUsingNativeOverlay) atomClearGhost(atomAimCtx);
    atomUsingNativeOverlay = false;
    atomAiming = false;
    atomAimCtx = null;
    atomAimRadii = null;
    atomPressing = false;
    atomSwallowUntil = 0; // never let the swallow window leak onto later real clicks
    hideAtomRings();
    hideAtomBanner();
  }

  // ── the quantity / validation dialog ───────────────────────────────────────
  // ── batch-fire config (persisted to localStorage) ─────────────────────────
  const ATOM_CFG_KEY = "openfront-helper-atom-batch-v1";
  function atomLoadCfg() {
    const cfg = { batchSize: 10, delayMs: 150, lastHydrogen: false };
    try {
      const raw = window.localStorage.getItem(ATOM_CFG_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Number.isFinite(p.batchSize) && p.batchSize >= 1) cfg.batchSize = Math.floor(p.batchSize);
        if (Number.isFinite(p.delayMs) && p.delayMs >= 0) cfg.delayMs = Math.floor(p.delayMs);
        cfg.lastHydrogen = p.lastHydrogen === true;
      }
    } catch (_e) {
      /* defaults */
    }
    return cfg;
  }
  function atomSaveCfg(batchSize, delayMs, lastHydrogen) {
    try {
      window.localStorage.setItem(
        ATOM_CFG_KEY,
        JSON.stringify({ batchSize, delayMs, lastHydrogen: lastHydrogen === true }),
      );
    } catch (_e) {
      /* ignore */
    }
  }
  function atomSleep(ms) {
    return new Promise((r) => setTimeout(r, Math.max(0, ms | 0)));
  }
  let atomFireCancel = false; // Esc during a batch run aborts it

  // teamHasWonForAtom — true in a TEAM game once our team owns ≥ 70% of the live map.
  // After the team win the game lets allies nuke each other AND allied SAMs intercept
  // our missiles, so the recommended-count must then include FRIENDLY SAMs too.
  function atomTeamHasWon(game, myPlayer) {
    try {
      if (String(game.config().gameConfig().gameMode) !== "Team") return false;
      const fallout =
        typeof game.numTilesWithFallout === "function" ? game.numTilesWithFallout() : 0;
      const denom = (game.numLandTiles() || 0) - fallout;
      if (denom <= 0) return false;
      let teamTiles = 0;
      for (const p of game.players()) {
        if (p.isPlayer() && myPlayer.isOnSameTeam(p)) teamTiles += p.numTilesOwned();
      }
      // GAME's real team-win threshold (Config.percentageTilesOwnedToWin → 95% Team).
      let winFrac = 0.95;
      try {
        const p = Number(game.config().percentageTilesOwnedToWin());
        if (Number.isFinite(p)) winFrac = p / 100;
      } catch (_e) {
        /* keep 0.95 */
      }
      return teamTiles / denom > winFrac;
    } catch (_e) {
      return false;
    }
  }

  async function showAtomDialog(ctx, tile, x, y) {
    ensureAtomStyles();
    hideAtomDialog();
    // Safety: clear native overlay immediately so the map doesn't stay dark.
    atomClearGhost(ctx);
    // NOTE: we intentionally do NOT stop the rings here — the committing click freezes them
    // in place so the blast radius stays visible while the dialog is open (hidden on close).

    const { myPlayer, buildMenu } = ctx;
    if (!myPlayer || !buildMenu) return;

    // Probe the live atom + hydrogen cost / buildable descriptors for this tile.
    let bu = null;
    let hu = null;
    try {
      const buildables = await myPlayer.buildables(tile, [ATOM_UNIT, HYDROGEN_UNIT]);
      bu = Array.isArray(buildables)
        ? buildables.find((b) => b.type === ATOM_UNIT)
        : null;
      hu = Array.isArray(buildables)
        ? buildables.find((b) => b.type === HYDROGEN_UNIT)
        : null;
    } catch (_e) {
      bu = null;
      hu = null;
    }
    const cost = bu ? atomToBig(bu.cost) : 0n;
    const hydroCost = hu ? atomToBig(hu.cost) : 0n;
    // Hydrogen is SELECTABLE whenever it's a valid build type here. We deliberately do NOT
    // gate on hu.canBuild: when the atom is buildable, the only thing that flips hydrogen's
    // canBuild to false is affordability (a hydrogen is much pricier than an atom) — same
    // silo, same alive/nukes-enabled prereqs. The macro fires the hydrogen LAST (after the
    // atoms' spend / income), and the cost line + Fire button now surface affordability —
    // so greying the checkbox out (the old behaviour) just hid a usable option.
    const hydroAvailable = !!hu && hydroCost > 0n;
    const disabledOrNoSilo = !bu || cost <= 0n;
    // Smart default = enough to overwhelm the SAMs along the flight path + 1 to
    // land. The path bows by the live "Flip rocket trajectory" toggle on the shared
    // UI state — the same object BuildMenu stamps onto each atom intent — so the
    // prediction matches the arc the bombs will actually fly. renderValidation
    // re-reads it each render (below) so flipping the arc updates the count.
    // Missing → game default (arc up).
    // Per-spam/Delay now live in the userscript popup's Atom tab; the dialog reads
    // the pacing from there (cfg) and only shows the resulting cadence as a chip.
    const cfg = atomLoadCfg();
    const gapMs = atomFireGapMs(cfg.batchSize, cfg.delayMs);
    let rec = atomRecommendedQty(
      ctx.game,
      myPlayer,
      tile,
      ctx.buildMenu?.uiState?.rocketDirectionUp,
      gapMs,
    );

    const dlg = document.createElement("div");
    dlg.id = ATOM_MACRO_DIALOG_ID;
    const defaultQty = Math.max(1, rec.recommended);
    dlg.innerHTML = `
      <div class="atom-hd">
        <span class="atom-ico">☢️</span>
        <span class="atom-ttl">${atomT("Atom batch-fire")}</span>
        <span class="atom-key">\\</span>
        <button class="atom-x" data-role="atom-x" title="${atomT("Close")}" aria-label="${atomT("Close")}">✕</button>
      </div>
      <div class="atom-bd">
        <div class="atom-qty">
          <label>${atomT("Qty")}</label>
          <input type="number" min="1" step="1" value="${defaultQty}" data-role="atom-qty">
          <span class="atom-cad" data-role="atom-cad" title="${atomT("Delivery rate — set the throttle in the Atom settings tab")}">≈ ${(1000 / gapMs).toFixed(1)}/s</span>
        </div>
        <label class="atom-hydro"${hydroAvailable ? "" : ' data-disabled="true"'}>
          <input type="checkbox" data-role="atom-last-hydro"${cfg.lastHydrogen && hydroAvailable ? " checked" : ""}${hydroAvailable ? "" : " disabled"}>
          <span class="atom-hico">⚛️</span>
          <span>${atomT("Final shot → Hydrogen")}${hydroAvailable ? "" : ` · ${atomT("unavailable")}`}</span>
        </label>
        <div data-role="atom-validate"></div>
        <div class="atom-note">${atomT("Paced under the server's rate limit so no shots drop, then tops up any the server missed. Pacing is set in the Atom settings tab. Esc aborts.")}</div>
        <div class="atom-btns">
          <button class="atom-fire" data-role="atom-fire">🚀 ${atomT("Fire")}</button>
          <button class="atom-force" data-role="atom-force" hidden>🚀 ${atomT("Force fire")}</button>
          <button class="atom-cancel" data-role="atom-cancel">${atomT("Cancel")}</button>
        </div>
      </div>`;
    // Hide until placed: the real position is computed AFTER the validation rows
    // render (below) — measuring an empty dialog under-counts its height and let the
    // bottom (Cancel/Fire) spill off-screen near the lower edge.
    dlg.style.left = "0px";
    dlg.style.top = "0px";
    dlg.style.visibility = "hidden";
    document.body.appendChild(dlg);

    const qtyInput = dlg.querySelector('[data-role="atom-qty"]');
    const validateBox = dlg.querySelector('[data-role="atom-validate"]');
    const fireBtn = dlg.querySelector('[data-role="atom-fire"]');
    const forceBtn = dlg.querySelector('[data-role="atom-force"]');

    const cadChip = dlg.querySelector('[data-role="atom-cad"]');
    let liveTimer = null;
    const renderValidation = () => {
      // Dialog đã bị gỡ (đóng/ESC/Fire) nhưng interval còn treo → tự dọn & thoát.
      if (!dlg.isConnected) {
        if (liveTimer) {
          clearInterval(liveTimer);
          liveTimer = null;
        }
        return;
      }
      // Re-read the live flip toggle AND the current pacing each render: flipping the arc
      // changes which SAMs are hit, and a slower cadence stretches delivery past the SAM
      // cooldown so SAMs reload — both must be reflected in the recommendation. Per-spam/
      // delay now live in the popup's Atom tab, so reload the cfg (cheap) to stay live if
      // the user re-tunes the throttle between opens.
      const cfgNow = atomLoadCfg();
      const curGapMs = atomFireGapMs(cfgNow.batchSize, cfgNow.delayMs);
      if (cadChip) cadChip.textContent = `≈ ${(1000 / curGapMs).toFixed(1)}/s`;
      // Đọc TƯƠI mỗi render: tiền tăng theo income, silo hồi cooldown → live.
      const gold = atomToBig(myPlayer.gold?.() ?? 0);
      const readyShots = atomReadyShots(myPlayer);
      rec = atomRecommendedQty(
        ctx.game,
        myPlayer,
        tile,
        ctx.buildMenu?.uiState?.rocketDirectionUp,
        curGapMs,
      );
      let qty = parseInt(qtyInput.value, 10);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;
      // When "last bomb = Hydrogen" is ticked, the final shot swaps to a (pricier)
      // hydrogen — so the cost is (qty-1) atoms + 1 hydrogen.
      const lastHydro =
        hydroAvailable &&
        dlg.querySelector('[data-role="atom-last-hydro"]')?.checked === true;
      const atomShots = lastHydro ? Math.max(0, qty - 1) : qty;
      const total = cost * BigInt(atomShots) + (lastHydro ? hydroCost : 0n);
      const goldShort = total > gold ? total - gold : 0n;
      const siloShort = qty > readyShots ? qty - readyShots : 0;
      const willFire = Math.max(0, Math.min(qty, readyShots));
      const recMatch = qty >= rec.recommended;
      // Can't fire the requested salvo right now (not enough gold for it, or not enough silo
      // shots ready) → block the button. The red Gold / Silos deltas below say which one.
      // Fire ⇄ Force are mutually exclusive so the row stays compact — always just
      // [primary][Cancel]. Normal Fire when the requested salvo is affordable; when
      // blocked (not enough gold/silo) Fire steps aside for Force fire, which fires the
      // max possible NOW = min(silo ready, floor(gold / cost)). cost === 0n is infinite-
      // gold → gold isn't the limit, silos decide. When blocked AND not even one shot is
      // possible (maxNow < 1) we keep a disabled Fire (the red Gold/Silos deltas explain).
      const blocked = goldShort > 0n || siloShort > 0;
      const affordAtoms = cost > 0n ? Number(gold / cost) : Number.MAX_SAFE_INTEGER;
      const maxNow = Math.max(0, Math.min(readyShots, affordAtoms));
      const canForce = blocked && maxNow >= 1;
      if (fireBtn) {
        fireBtn.disabled = qty < 1 || blocked;
        fireBtn.hidden = canForce;
      }
      if (forceBtn) {
        forceBtn.hidden = !canForce;
        if (canForce) {
          forceBtn.disabled = false;
          forceBtn.textContent = `🚀 ${atomT("Force fire")} (${maxNow})`;
        }
      }
      const warn = rec.achievable
        ? ""
        : rec.achievableAtMaxRate
          ? `<div class="atom-warn">⚠ ${atomT("Too slow — SAMs reload before impact. Lower the Delay in the Atom settings tab.")}</div>`
          : `<div class="atom-warn">⚠ ${atomT("Too many SAM levels here — atoms can't overwhelm them even at full speed. Use MIRV.")}</div>`;
      validateBox.innerHTML = `
        <div class="atom-stats">
          <div class="atom-line"><span class="atom-k">🛡 ${atomT("SAMs covering")}</span><span class="atom-v">${rec.sams} · ${atomT("int")} ${rec.intercept}</span></div>
          <div class="atom-line"><span class="atom-k">${atomT("Recommended")}</span><span class="atom-v ${rec.achievableAtMaxRate && recMatch ? "atom-ok" : "atom-bad"}">${rec.achievableAtMaxRate ? rec.recommended : "—"}</span></div>
          <div class="atom-line"><span class="atom-k">${atomT("Cost")} ≈</span><span class="atom-v ${goldShort > 0n ? "atom-bad" : "atom-ok"}">${atomFmt(total)} 💰</span></div>
          <div class="atom-line"><span class="atom-k">${atomT("Gold")}</span><span class="atom-v">${atomFmt(gold)}${goldShort > 0n ? ` <span class="atom-bad">(−${atomFmt(goldShort)})</span>` : ""}</span></div>
          <div class="atom-line"><span class="atom-k">${atomT("Silos ready")}</span><span class="atom-v ${siloShort > 0 ? "atom-bad" : "atom-ok"}">${readyShots}${siloShort > 0 ? ` <span class="atom-bad">(−${siloShort})</span>` : ""}</span></div>
          <div class="atom-line atom-hl"><span class="atom-k">${atomT("Will fire now")}</span><span class="atom-v atom-ok">${willFire}</span></div>
        </div>${warn}`;
      // Once visible, a freshly shown short/warn line can grow the dialog past an edge;
      // nudge it back so Fire/Cancel stay reachable (the header X is always on-screen too).
      if (dlg.style.visibility !== "hidden") {
        const r = dlg.getBoundingClientRect();
        const M = 6;
        if (
          r.right > window.innerWidth - M ||
          r.bottom > window.innerHeight - M ||
          r.left < M ||
          r.top < M
        ) {
          positionAtomDialog(dlg, x, y);
        }
      }
    };

    if (disabledOrNoSilo) {
      validateBox.innerHTML = `<div class="atom-warn">${atomT("Cannot build atom here (no silo / disabled / unreachable).")}</div>`;
      if (fireBtn) fireBtn.disabled = true;
    } else {
      renderValidation();
      qtyInput.addEventListener("input", renderValidation);
      // toggling last-hydrogen changes the cost (atom → pricier hydrogen)
      const hydroBox = dlg.querySelector('[data-role="atom-last-hydro"]');
      if (hydroBox) hydroBox.addEventListener("change", renderValidation);
      // Làm tươi Gold / Silos ready / Will fire / Cost / Recommended khi dialog mở.
      liveTimer = setInterval(renderValidation, 350);
    }
    // Place + reveal now that the full content (incl. validation rows) has rendered, so
    // the height is final and the flip-up/flip-left logic keeps the whole dialog on-screen.
    positionAtomDialog(dlg, x, y);
    // keep keystrokes (incl. the hotkey) inside any input from reaching the game
    dlg.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("keydown", (e) => e.stopPropagation()),
    );

    // closing the dialog also clears the frozen blast rings it left on the map
    const close = () => {
      hideAtomDialog();
      hideAtomRings();
      atomClearGhost(ctx); // safety: clear native overlay (already cleared on commit)
      if (liveTimer) {
        clearInterval(liveTimer);
        liveTimer = null;
      }
    };
    dlg.querySelector('[data-role="atom-cancel"]').addEventListener("click", close);
    dlg.querySelector('[data-role="atom-x"]').addEventListener("click", close);
    fireBtn.addEventListener("click", async () => {
      if (fireBtn.disabled) return; // not enough gold / silo (also blocked natively)
      let qty = parseInt(qtyInput.value, 10);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;
      // Per-spam/delay are set in the popup's Atom tab; read them back here (don't
      // overwrite them) and only persist the per-target hydrogen choice.
      const cfgNow = atomLoadCfg();
      const batchSize = cfgNow.batchSize;
      const delayMs = cfgNow.delayMs;
      const lastHydrogen =
        dlg.querySelector('[data-role="atom-last-hydro"]')?.checked === true;
      atomSaveCfg(batchSize, delayMs, lastHydrogen); // keep pacing, persist hydrogen choice
      close();
      atomBanner("☢️ " + atomT("Firing… (Esc to stop)"), "arm");
      // fireAtoms returns the number CONFIRMED in flight (server-accepted), not the
      // intents emitted — so the banner can't claim shots the rate limiter silently ate.
      const launched = await fireAtoms(
        ctx,
        tile,
        qty,
        batchSize,
        delayMs,
        lastHydrogen,
      );
      atomBanner(
        `☢️ ${atomT("Fired")} ${launched}/${qty} ${atomT("atom bomb(s)")}`,
        launched >= qty ? "ok" : "arm",
      );
      setTimeout(hideAtomBanner, 2600);
    });
    forceBtn.addEventListener("click", async () => {
      if (forceBtn.disabled || forceBtn.hidden) return;
      // Snapshot-now: bắn tối đa những gì mua/bắn được NGAY rồi dừng.
      const goldNow = atomToBig(myPlayer.gold?.() ?? 0);
      const readyNow = atomReadyShots(myPlayer);
      const affordAtoms =
        cost > 0n ? Number(goldNow / cost) : Number.MAX_SAFE_INTEGER;
      const maxNow = Math.max(0, Math.min(readyNow, affordAtoms));
      if (maxNow < 1) return;
      // Hydro-cuối: chỉ khi đã tick VÀ còn đủ cho (maxNow-1) atom + 1 hydro.
      const wantHydro =
        hydroAvailable &&
        dlg.querySelector('[data-role="atom-last-hydro"]')?.checked === true &&
        goldNow >= cost * BigInt(Math.max(0, maxNow - 1)) + hydroCost;
      const cfgNow = atomLoadCfg();
      atomSaveCfg(cfgNow.batchSize, cfgNow.delayMs, wantHydro);
      close();
      atomBanner("☢️ " + atomT("Firing… (Esc to stop)"), "arm");
      const launched = await fireAtoms(
        ctx,
        tile,
        maxNow,
        cfgNow.batchSize,
        cfgNow.delayMs,
        wantHydro,
      );
      atomBanner(
        `☢️ ${atomT("Fired")} ${launched}/${maxNow} ${atomT("atom bomb(s)")}`,
        launched >= maxNow ? "ok" : "arm",
      );
      setTimeout(hideAtomBanner, 2600);
    });
    setTimeout(() => qtyInput?.focus?.(), 0);
  }

  // ── BATCH-fire (rate-safe): the SERVER silently drops build intents above ~10/sec
  //    and 150/min (ClientMsgRateLimiter: tryRemoveTokens → "limit" → dropped, no client
  //    feedback). Firing AT 10/sec (e.g. per-spam 1 / delay 100ms) sat right on the cap,
  //    so timer jitter pushed a few shots over and they VANISHED — "fired 52 but only 50
  //    launched". We now PACE one intent per `gapMs`, kept safely UNDER both caps no
  //    matter what the knobs say, then (Phase 2) settle and top up any shots the server
  //    still dropped. Returns the count we CONFIRMED in flight (not intents emitted —
  //    that was the number that lied). Mirrors nuke-prediction's "count nukes heading to
  //    a tile" to verify launches, and auto-nuke's pace-don't-spam firing.
  async function fireAtoms(ctx, tile, qty, batchSize, delayMs, lastHydrogen) {
    const { myPlayer, buildMenu } = ctx;
    if (!myPlayer || !buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") {
      return 0;
    }
    // A stray Esc press ANYWHERE in-game (closing a menu, exiting a mode — not just
    // during atom aiming) sets this. Every fresh fire must start un-cancelled, or a
    // single unrelated Esc permanently silences callers that never route through the
    // dialog's Fire/Force buttons (SAM tracker one-click-fire, auto-fire-building).
    atomFireCancel = false;

    const PER_MIN_CAP = 140; // stay under the 150/min server cap (margin)
    const ROLL_MS = 60000;
    const STALL_MS = state.settings.atomStallMs || 30000; // zero-progress give-up
    // Per-spam/delay are a rate HINT: the per-shot interval the user implied, but never
    // FASTER than the server-safe cadence. Bursting is gone — a burst drained the token
    // bucket instantly and got the overflow dropped. Same gap the reload-aware
    // recommendation assumes, so the dialog's number matches the real delivery rate.
    const gapMs = atomFireGapMs(batchSize, delayMs);
    // "Last bomb = Hydrogen": the final shot is a bigger-blast hydrogen that lands AFTER
    // the atoms have baited every SAM interceptor dry. SAMs PRIORITISE hydrogen over
    // atoms, so a hydrogen mixed into the salvo would be picked off first — it must go
    // LAST and arrive once the interceptors are spent. So fire qty-1 atoms, then 1 hydro.
    const wantHydro = lastHydrogen === true && qty >= 1;
    const atomQty = wantHydro ? Math.max(0, qty - 1) : qty;
    // Hard ceiling on TOTAL emits across every phase. If a confirmed-count scan ever
    // misreads low (a view hiccup, a future refactor), the top-up must NOT blow a
    // 52-salvo into a 150-bomb run — makes "a tiny over-fire is acceptable" true in code.
    const MAX_EMIT = qty + Math.max(3, Math.ceil(qty * 0.15));

    const mySid = myPlayer.smallID ? myPlayer.smallID() : -1;
    // Confirmed-launch counter for a nuke type: unique ids of OUR units of that type in
    // flight toward this exact tile since we started, ACCUMULATED (never shrinks) so a
    // bomb that detonates mid-run still counts. Immune to intents the server dropped.
    const makeCounter = (unitType) => {
      const inFlight = () => {
        const out = [];
        try {
          const us = myPlayer.units ? myPlayer.units(unitType) : [];
          for (const u of us) {
            try {
              const o = u.owner && u.owner();
              if (o && o.smallID && o.smallID() !== mySid) continue;
              if ((u.targetTile && u.targetTile()) === tile) out.push(u);
            } catch (_e) {
              /* skip this unit */
            }
          }
        } catch (_e) {
          /* ignore */
        }
        return out;
      };
      const baseline = new Set(); // exclude a prior salvo already heading here
      for (const u of inFlight()) {
        try {
          baseline.add(u.id ? u.id() : u);
        } catch (_e) {
          /* ignore */
        }
      }
      const seen = new Set();
      return () => {
        for (const u of inFlight()) {
          try {
            const id = u.id ? u.id() : u;
            if (!baseline.has(id)) seen.add(id);
          } catch (_e) {
            /* ignore */
          }
        }
        return seen.size;
      };
    };
    const scanAtoms = makeCounter(ATOM_UNIT);
    const scanHydro = wantHydro ? makeCounter(HYDROGEN_UNIT) : null;

    // Rolling-minute window of emit timestamps for the 150/min cap.
    const fireTimes = [];
    const perMinuteOk = () => {
      const now = performance.now();
      while (fireTimes.length && now - fireTimes[0] > ROLL_MS) fireTimes.shift();
      return fireTimes.length < PER_MIN_CAP;
    };
    // Live descriptor for a nuke type (cost rises per bomb; silos cool) → or null.
    const probe = async (unitType) => {
      try {
        const b = await myPlayer.buildables(tile, [unitType]);
        return Array.isArray(b) ? b.find((x) => x.type === unitType) : null;
      } catch (_e) {
        return null;
      }
    };
    const fireOne = (descriptor) => {
      try {
        buildMenu.sendBuildOrUpgrade(descriptor, tile);
        fireTimes.push(performance.now());
        return true;
      } catch (_e) {
        return false;
      }
    };

    let emitted = 0;
    let stopReason = "reached-qty";

    // ── Phase 1: emit the atom salvo (qty, or qty-1 if a hydrogen tail), paced safely ─
    let lastProgressMs = performance.now();
    while (emitted < atomQty && !atomFireCancel) {
      const descriptor = await probe(ATOM_UNIT);
      const canAfford = !!descriptor && descriptor.canBuild !== false;
      const ready = descriptor ? atomReadyShots(myPlayer) : 0;
      if (!canAfford || ready <= 0) {
        // Broke or every silo cooling — wait briefly; give up only after STALL_MS.
        if (performance.now() - lastProgressMs > STALL_MS) {
          stopReason = "stalled";
          break;
        }
        await atomSleep(Math.min(gapMs, 250));
        continue;
      }
      if (!perMinuteOk()) {
        // Hit the 150/min cap (big salvos only) — pace down; NOT a stall.
        lastProgressMs = performance.now();
        await atomSleep(1000);
        continue;
      }
      if (fireOne(descriptor)) {
        emitted++;
        lastProgressMs = performance.now();
      }
      scanAtoms(); // catch bombs while in flight (some detonate before Phase 2)
      if (emitted >= atomQty || atomFireCancel) break;
      await atomSleep(gapMs);
    }

    // ── Phase 2: a LIGHT confirm/top-up so the bait is complete before the hydrogen trails
    // it. A brief settle lets just-fired atoms register; if the server dropped any (≈never
    // with rate-safe pacing) we top up. CRITICALLY this does NOT wait to observe
    // interception — only that the stream launched — so the hydrogen's flight is not
    // serialised after the atoms'. Bounded by MAX_EMIT.
    if (!atomFireCancel && stopReason !== "stalled" && atomQty > 0) {
      await atomSleep(700); // brief round-trip settle so launched atoms register
      const shortfall = Math.min(atomQty - scanAtoms(), MAX_EMIT - emitted);
      for (let k = 0; k < shortfall && !atomFireCancel && emitted < MAX_EMIT; k++) {
        const descriptor = await probe(ATOM_UNIT);
        if (
          !descriptor ||
          descriptor.canBuild === false ||
          atomReadyShots(myPlayer) <= 0
        ) {
          break;
        }
        if (!perMinuteOk()) await atomSleep(1000);
        if (fireOne(descriptor)) emitted++;
        scanAtoms();
        await atomSleep(gapMs);
      }
    }

    // ── Phase 3: the hydrogen tail, fired to TRAIL the last atom by a small fixed margin ─
    // Atom and hydrogen fly IDENTICALLY; SAMs prioritise hydrogen ONLY among nukes due the
    // same integer shoot-tick. So the hydrogen must arrive a hair AFTER the last atom: at
    // the last atom's tick the SAM spends its final slot on the bait → cooldown → the
    // hydrogen reaches the zone a couple ticks later to no free interceptor → it survives.
    // Trail = 2 atom-gaps: enough to clear shoot-tick rounding/jitter, trivially small vs
    // the ~9 s reload. NOT an observed gate — that waited out a full atom flight, then flew
    // the hydrogen the SAME distance again (~2×T_flight), long enough for a slot to reload
    // and pick the hydrogen off (the "fires too late" symptom). The trail keeps the
    // hydrogen in flight right behind the stream, concurrent with the interception window.
    const trailMs = Math.max(2 * gapMs, 250);
    if (wantHydro && !atomFireCancel && stopReason !== "stalled" && scanHydro() < 1) {
      await atomSleep(trailMs); // fall just behind the genuinely-last atom fired
      for (let round = 0; round < 3 && !atomFireCancel && emitted < MAX_EMIT; round++) {
        if (scanHydro() >= 1) break; // confirmed in flight → done
        const descriptor = await probe(HYDROGEN_UNIT);
        if (
          descriptor &&
          descriptor.canBuild !== false &&
          atomReadyShots(myPlayer) > 0
        ) {
          if (!perMinuteOk()) await atomSleep(1000);
          if (fireOne(descriptor)) emitted++;
        }
        await atomSleep(Math.max(gapMs, 700)); // settle before re-judging (avoid double-fire)
      }
    }

    const confirmed = scanAtoms() + (scanHydro ? scanHydro() : 0);
    if (atomFireCancel) stopReason = "cancelled";
    console.log("[Atom] fireAtoms done", {
      emitted,
      confirmed,
      qty,
      atomQty,
      hydro: scanHydro ? scanHydro() : 0,
      trailMs: wantHydro ? trailMs : 0,
      stopReason,
      gapMs,
    });
    return confirmed;
  }

  // ── input handling ─────────────────────────────────────────────────────────
  function atomInOwnDialog(el) {
    return !!(el && el.closest && el.closest("#" + ATOM_MACRO_DIALOG_ID));
  }
  function atomIsTyping(event) {
    // Focus inside OUR dialog (e.g. the Qty field) must NOT block the "\" hotkey — "\"
    // is not a number char, and we want it to re-aim/retarget even with Qty focused.
    // Only a real text field elsewhere (e.g. the game's chat box) counts as typing.
    const t = event.target;
    if (atomInOwnDialog(t) || atomInOwnDialog(document.activeElement)) return false;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement ||
      (t && t.isContentEditable)
    ) {
      return true;
    }
    const a = document.activeElement;
    return !!(
      a instanceof HTMLInputElement ||
      a instanceof HTMLTextAreaElement ||
      (a && a.isContentEditable)
    );
  }

  // Hotkey = "\" (Backslash). Chosen to AVOID the game's "8" atom hotkey.
  function atomIsHotkey(event) {
    // Read hotkey from settings (stored in _quickPanelSettingsCache or localStorage)
    var code = "Backslash"; // default
    try {
      if (typeof _quickPanelSettingsCache === "object" && _quickPanelSettingsCache && _quickPanelSettingsCache.atomBatchHotkey) {
        code = _quickPanelSettingsCache.atomBatchHotkey;
      } else {
        var raw = localStorage.getItem("openfront-helper-settings");
        if (raw) { var s = JSON.parse(raw); if (s.atomBatchHotkey) code = s.atomBatchHotkey; }
      }
    } catch (e) {}
    // Parse hotkey string like "Shift+KeyK" or "Backslash"
    var parts = code.split("+");
    var needShift = false, needCtrl = false, needAlt = false, needMeta = false, targetCode = code;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "Shift") needShift = true;
      else if (parts[i] === "Ctrl") needCtrl = true;
      else if (parts[i] === "Alt") needAlt = true;
      else if (parts[i] === "Meta") needMeta = true;
      else targetCode = parts[i];
    }
    return (
      event.code === targetCode &&
      !!event.shiftKey === needShift &&
      !!event.altKey === needAlt &&
      !!event.ctrlKey === needCtrl &&
      !!event.metaKey === needMeta &&
      !atomIsTyping(event)
    );
  }

  function handleAtomMouseMove(event) {
    atomLastMouseX = event.clientX;
    atomLastMouseY = event.clientY;
    // while aiming, the blast rings track the cursor
    if (atomAiming) updateAtomRings(event.clientX, event.clientY);
  }

  function handleAtomKeyDown(event) {
    if (event.key === "Escape") {
      // Esc cancels aiming, closes an open dialog, AND aborts an in-progress batch fire.
      atomFireCancel = true;
      let handled = false;
      if (document.getElementById(ATOM_MACRO_DIALOG_ID)) {
        hideAtomDialog();
        hideAtomRings(); // clear the frozen blast rings the dialog left on the map
        atomClearGhost(); // safety: clear any leftover native overlay
        handled = true;
      }
      if (atomAiming) {
        stopAtomAiming();
        handled = true;
      }
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!atomIsHotkey(event)) return;
    console.log("[AtomMacro] key '\\' detected");
    // Swallow the key (chosen to NOT collide with the game's "8" atom hotkey).
    event.preventDefault();
    event.stopImmediatePropagation();
    const ctx = atomGameContext();
    if (!ctx.game || !ctx.myPlayer?.isPlayer?.()) {
      console.log("[AtomMacro] no game/player context", {
        radial: !!atomRadialElement(),
        game: !!ctx.game,
        transform: !!ctx.transform,
        buildMenu: !!ctx.buildMenu,
        myPlayer: !!ctx.myPlayer,
      });
      atomBanner("☢️ " + atomT("Start a game first to use atom batch-fire"), "arm");
      setTimeout(hideAtomBanner, 1400);
      return;
    }
    // Enter (or re-enter) ring-aiming: the atom + hydrogen blast radius preview at the
    // cursor; a LEFT-CLICK then commits the target tile and opens the dialog. Pressing \
    // again re-aims (closing any open dialog), so a fresh aim + click retargets the strike.
    console.log("[AtomMacro] entering aim mode");
    startAtomAiming(ctx);
  }

  function handleAtomKeyUp(event) {
    if (atomIsHotkey(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  // After we swallow a committing click's pointerup, the game's InputHandler still has
  // pointerDown=true (it saw the pointerdown we let through for drag-panning, but never the
  // up) — so its onPointerMove would emit a DragEvent on every mousemove and the map would
  // chase the cursor. Hand the game a synthetic pointercancel at far-off coords: it binds
  // pointercancel → onPointerUp, which clears pointerDown BEFORE its menu check, and the far
  // distance keeps that check from opening the radial menu. (Verified vs InputHandler source.)
  function atomReleaseGamePointer() {
    try {
      window.dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          clientX: -10000,
          clientY: -10000,
        }),
      );
    } catch (_e) {
      /* best-effort: PointerEvent construction is the only thing that can throw */
    }
  }

  // Capture-phase pointerdown: while aiming, just REMEMBER where the left-press started.
  // We do NOT swallow it and do NOT commit yet — so a left-drag still reaches the game and
  // pans the map (the user may be dragging to find a firing spot). The click-vs-drag verdict
  // is made on pointerup; only a clean click commits.
  function handleAtomPointerDown(event) {
    if (!atomAiming) return;
    if (event.button !== 0) return; // leave right/middle for the game's pan & context menu
    const dlg = document.getElementById(ATOM_MACRO_DIALOG_ID);
    if (dlg && dlg.contains(event.target)) return; // ignore presses on our own UI
    atomPressing = true;
    atomPressX = event.clientX;
    atomPressY = event.clientY;
  }

  // Capture-phase pointerup: a clean CLICK (moved < threshold) commits the target and is
  // swallowed so the game's radial/build menu never opens under our dialog. A DRAG (moved ≥
  // threshold) was a map pan — leave it entirely to the game and stay in aiming mode.
  function handleAtomPointerUp(event) {
    if (event.button !== 0) return;
    if (!atomAiming || !atomPressing) return;
    atomPressing = false;
    const dist = Math.abs(event.clientX - atomPressX) + Math.abs(event.clientY - atomPressY);
    if (dist >= ATOM_DRAG_THRESHOLD) {
      // left-drag = map pan; do NOT swallow or commit — keep aiming so a later click can fire
      return;
    }
    const dlg = document.getElementById(ATOM_MACRO_DIALOG_ID);
    if (dlg && dlg.contains(event.target)) return; // a click that lands on our UI is not a target
    // it was a click → block the game's menu (its pointerup opens it)
    event.preventDefault();
    event.stopImmediatePropagation();
    // …but the swallowed up would otherwise strand the game's pointerDown=true (→ runaway pan
    // on the next mousemove); release it cleanly. Done for BOTH the valid and invalid branches.
    atomReleaseGamePointer();
    const ctx = atomGameContext(); // fresh context for the actual fire (not the cached aim ctx)
    const tile = atomTileFromScreen(ctx, event.clientX, event.clientY);
    if (tile == null) {
      atomSwallowUntil = performance.now() + 400; // swallow the trailing click; stay aiming
      atomBanner("☢️ " + atomT("Aim at a valid target on the map, then click"), "arm");
      return;
    }
    const cx = event.clientX;
    const cy = event.clientY;
    console.log("[AtomMacro] aim click → tile", tile);
    atomAiming = false;
    if (atomUsingNativeOverlay) {
      // Đường đạn native bám con trỏ → khi mở dialog sẽ chạy lệch mục tiêu, nên tắt.
      atomClearGhost(ctx);
      atomUsingNativeOverlay = false;
      hideAtomRings(); // also drop our Hydrogen ring — the overlay is aim-only
    } else {
      // Fallback: đóng băng vòng blast tự vẽ dưới dialog (ẩn khi đóng).
      updateAtomRings(cx, cy); // snap to the committed point + hide the "click to aim" tag
    }
    hideAtomBanner();
    atomAimCtx = null;
    atomAimRadii = null;
    // swallow ONLY this committing press's trailing click (it fires within a few ms); kept
    // short so normal map clicks right after firing are never eaten.
    atomSwallowUntil = performance.now() + 400;
    showAtomDialog(ctx, tile, cx, cy);
  }

  // The synthetic `click` that trails a committing pointerup must also be kept from the
  // game. The timestamp window auto-expires, so a stuck flag can never swallow a later,
  // unrelated click.
  function handleAtomClick(event) {
    if (event.button !== 0) return;
    if (performance.now() > atomSwallowUntil) return;
    const dlg = document.getElementById(ATOM_MACRO_DIALOG_ID);
    if (dlg && dlg.contains(event.target)) return; // allow interaction with our own dialog
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function installAtomMacro() {
    if (atomMacroInstalled) return;
    atomMacroInstalled = true;
    window.addEventListener("keydown", handleAtomKeyDown, true);
    window.addEventListener("keyup", handleAtomKeyUp, true);
    document.addEventListener("mousemove", handleAtomMouseMove, { passive: true });
    // capture phase (before the game's own window listeners) so a committing click is
    // intercepted and the radial/build menu never opens beneath the dialog — while a drag
    // still falls through to the game and pans the map.
    window.addEventListener("pointerdown", handleAtomPointerDown, true);
    window.addEventListener("pointerup", handleAtomPointerUp, true);
    window.addEventListener("click", handleAtomClick, true);
  }

  // Settings bridge — lets the userscript popup's "Atom" tab read/write the batch-
  // fire pacing (per-spam / delay), persisted to the same localStorage blob the
  // dialog reads on each fire. Pure config (no game access), so it is always usable
  // — even in the lobby. Mirrors window.__OFH_autobot. Read-merge-write on set() so
  // a partial patch never wipes the sibling fields (e.g. the hydrogen choice).
  try {
    window.__OFH_atomBatch = {
      SAFE_GAP_MS: ATOM_SAFE_GAP_MS,
      get() {
        const c = atomLoadCfg();
        return { batchSize: c.batchSize, delayMs: c.delayMs, lastHydrogen: c.lastHydrogen };
      },
      set(patch) {
        if (!patch || typeof patch !== "object") return;
        const c = atomLoadCfg();
        let { batchSize, delayMs, lastHydrogen } = c;
        if (Number.isFinite(patch.batchSize) && patch.batchSize >= 1) {
          batchSize = Math.floor(patch.batchSize);
        }
        if (Number.isFinite(patch.delayMs) && patch.delayMs >= 0) {
          delayMs = Math.floor(patch.delayMs);
        }
        if ("lastHydrogen" in patch) lastHydrogen = patch.lastHydrogen === true;
        atomSaveCfg(batchSize, delayMs, lastHydrogen);
      },
      effectiveGapMs(batchSize, delayMs) {
        return atomFireGapMs(batchSize, delayMs);
      },
      // Open the atom batch-fire dialog for a specific tile (used by SAM tracker).
      // tile: game tile ref; screenX/screenY: optional screen position for dialog.
      async openDialog(tile, screenX, screenY) {
        const ctx = atomGameContext();
        if (!ctx.game || !ctx.myPlayer?.isPlayer?.()) return;
        // Clear any leftover ghost overlay
        atomClearGhost(ctx);
        hideAtomRings();
        hideAtomBanner();
        const x = Number.isFinite(screenX) ? screenX : window.innerWidth / 2;
        const y = Number.isFinite(screenY) ? screenY : window.innerHeight / 2;
        await showAtomDialog(ctx, tile, x, y);
      },

      // Compute (do NOT fire) the recommended atom quantity for `tile`, and whether
      // firing it right now is actually possible (silo/gold). Used by SAM tracker's
      // one-click fire and auto-fire-building — both need "can I fire this NOW" without
      // opening the dialog.
      async recommendQty(tile) {
        const ctx = atomGameContext();
        if (!ctx.game || !ctx.myPlayer?.isPlayer?.()) return { ok: false, reason: "no-game" };
        const { myPlayer } = ctx;
        let bu = null;
        try {
          const buildables = await myPlayer.buildables(tile, [ATOM_UNIT, HYDROGEN_UNIT]);
          bu = Array.isArray(buildables) ? buildables.find((b) => b.type === ATOM_UNIT) : null;
        } catch (_e) {
          bu = null;
        }
        const cost = bu ? atomToBig(bu.cost) : 0n;
        if (!bu || cost <= 0n) return { ok: false, reason: "no-silo" };
        const cfg = atomLoadCfg();
        const gapMs = atomFireGapMs(cfg.batchSize, cfg.delayMs);
        const rec = atomRecommendedQty(
          ctx.game,
          myPlayer,
          tile,
          ctx.buildMenu?.uiState?.rocketDirectionUp,
          gapMs,
        );
        if (!rec.achievable) {
          return {
            ok: false,
            reason: rec.achievableAtMaxRate ? "too-slow" : "too-strong",
            recommended: rec.recommended,
          };
        }
        const qty = Math.max(1, rec.recommended);
        const gold = atomToBig(myPlayer.gold?.() ?? 0);
        const readyShots = atomReadyShots(myPlayer);
        const total = cost * BigInt(qty);
        if (total > gold) return { ok: false, reason: "gold", short: total - gold, recommended: qty };
        if (qty > readyShots)
          return { ok: false, reason: "silo", short: qty - readyShots, recommended: qty };
        return { ok: true, achievable: true, achievableAtMaxRate: rec.achievableAtMaxRate, recommended: qty };
      },

      // Fire exactly `qty` atom bombs (no hydrogen finisher) at `tile` right now.
      // Caller is responsible for having validated affordability (e.g. via recommendQty).
      async fireNow(tile, qty) {
        const ctx = atomGameContext();
        if (!ctx.game || !ctx.myPlayer?.isPlayer?.()) return { fired: 0, qty };
        const cfg = atomLoadCfg();
        const fired = await fireAtoms(ctx, tile, qty, cfg.batchSize, cfg.delayMs, false);
        return { fired, qty };
      },

      // One-click fire: recommendQty then fireNow if (and only if) conditions are met.
      async fireRecommended(tile) {
        const rec = await window.__OFH_atomBatch.recommendQty(tile);
        if (!rec.ok) return rec;
        const res = await window.__OFH_atomBatch.fireNow(tile, rec.recommended);
        return { ok: true, fired: res.fired, qty: res.qty };
      },

      // Flight-time (game ticks) from our nearest ready silo to `tile`. Returns null if
      // it can't be determined (no silo, pathfinding unavailable, etc).
      estimateFlightTicks(tile) {
        const ctx = atomGameContext();
        if (!ctx.game || !ctx.myPlayer) return null;
        const src = atomLaunchSiloTile(ctx.game, ctx.myPlayer, tile);
        if (src == null || typeof computeNukeRemainingTicks !== "function") return null;
        return computeNukeRemainingTicks(ctx.game, src, tile);
      },
    };
  } catch (_e) {
    /* bridge is best-effort */
  }

  // Always-on manual macro (inert until "\" is pressed in a game).
  try {
    installAtomMacro();
    window.__ofhAtomMacroInstalled = true;
    console.log("[AtomMacro] installed (point mouse + press '\\' → dialog)");
  } catch (e) {
    console.warn("[AtomMacro] install failed:", e);
  }
})();

// =============================================================================
// Popup bridge — exposes the auto-bot config so the userscript settings popup's
// "Auto Bot" tab can read/write it. Runs in the page-bridge shared scope, so it
// can reach state / setEnabled / saveSettings / retuneEngine / buildPanel.
// =============================================================================
window.__OFH_autobot = {
  FEATURE_KEYS: ["spawn", "expand", "build", "boat", "nuke", "warship", "alliance", "embargo", "donate", "betray"],
  DIFFICULTIES: ["Easy", "Medium", "Hard", "Impossible"],
  get() {
    const s = state.settings;
    return {
      enabled: Boolean(s.enabled),
      difficulty: s.difficulty,
      winFixes: Boolean(s.winFixes),
      smartSpawn: Boolean(s.smartSpawn),
      tickMs: s.tickMs,
      hidden: Boolean(s.hidden),
      features: { ...s.features },
      buildStructures: { ...s.buildStructures },
    };
  },
  set(patch) {
    if (!patch || typeof patch !== "object") return;
    const s = state.settings;
    if ("difficulty" in patch) s.difficulty = patch.difficulty;
    if ("winFixes" in patch) s.winFixes = Boolean(patch.winFixes);
    if ("hidden" in patch) s.hidden = Boolean(patch.hidden);
    if ("tickMs" in patch) {
      const ms = Number(patch.tickMs);
      if (Number.isFinite(ms) && ms > 0) s.tickMs = ms;
    }
    if ("smartSpawn" in patch) s.smartSpawn = Boolean(patch.smartSpawn);
    if (patch.features && typeof patch.features === "object") {
      Object.assign(s.features, patch.features);
    }
    if (patch.buildStructures && typeof patch.buildStructures === "object") {
      if (!s.buildStructures) s.buildStructures = {};
      Object.assign(s.buildStructures, patch.buildStructures);
    }
    if ("enabled" in patch) setEnabled(Boolean(patch.enabled));
    saveSettings();
    if (typeof retuneEngine === "function") retuneEngine();
    if (typeof buildPanel === "function") buildPanel();
  },
};
