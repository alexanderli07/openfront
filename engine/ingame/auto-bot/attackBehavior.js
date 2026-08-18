// Auto-Bot — AttackBehavior: a faithful 1:1 port of the in-game Nation attack AI
// (src/core/execution/utils/AiAttackBehavior.ts). This is the HEART of the AI:
// it expands into TerraNullius, launches random boats, and runs the
// DIFFICULTY-ORDERED strategy pipeline (the four arrays in getAttackStrategies)
// to pick a target every attack tick. Every branch, constant, probability,
// strategy ORDER and call order is preserved EXACTLY. The ONLY changes are the
// mechanical API substitutions mandated by PORT-CONTRACT.md:
//
//   - DIFFICULTY: src reads `this.game.config().gameConfig().difficulty`; the bot
//     REPLICATES a user-chosen difficulty, so every such read → `currentDifficulty()`.
//     EXCEPTION: `config().maxTroops(player|enemy)` keeps the real lobby difficulty
//     (it reads true stats) — left as-is, exactly like the sibling behaviors.
//   - UnitType.X → UNIT.X.
//   - PLAYER/OWNER IDENTITY: src compares players with `===`; the client wraps
//     players fresh each tick, so `a === b` → `a.smallID() === b.smallID()`, and
//     `owner === player` → smallID compare; TerraNullius via `!x.isPlayer()`. Where
//     src already used `.id()` (string id), that compare is kept verbatim.
//   - relation: `player.relation(o)` / `player.allRelationsSorted()` (reconstructed
//     sync overlay) and `player.updateRelation(o, delta)` (overlay write, no intent)
//     are used exactly where src does.
//   - ACTUATION: the client has no synchronous `game.addExecution`. Replace:
//       * land attack  `new AttackExecution(troops, attacker, targetID)`
//           → `emitIntent(ctors.attack, target.id()|null, troops)`
//         (targetID = `target.id()` for a player, `null` for TerraNullius).
//       * boat        `new TransportShipExecution(player, dstTile, troops)`
//           → `emitIntent(ctors.boat, dstTile, troops)`.
//       * donate      `new DonateTroopsExecution(player, recipient.id(), troops)`
//           → `emitIntent(ctors.donateTroops, recipient.__src ?? recipient, troops)`.
//   - ASYNC BOUNDARIES (the ONLY control-flow change): the src calls
//     `canBuildTransportShip(g, player, tile)` SYNCHRONOUSLY inside RNG/scan loops.
//     On the client this is the ASYNC `await player.bestTransportShipSpawn(tile)`
//     (→ spawn TileRef, or `false` == cannot boat). We apply the PORT-CONTRACT
//     RANK/COLLECT-THEN-PROBE pattern: run the cheap SYNC src criteria to COLLECT up
//     to K (≈4) candidate target tiles IN THE SRC SELECTION ORDER, then `await
//     bestTransportShipSpawn(candidate)` DOWN the list and take the FIRST that
//     returns `!== false`. Each await is wrapped in withTimeout(p, …, false). The
//     boat probe is a GATE only — the dst passed to the boat intent is still the
//     src target tile (closest.y / randTile / tile), never the spawn source.
//     Methods that touch these probes BECOME `async` (nationExecution awaits
//     maybeAttack and forceSendAttack). See the per-method DIVERGENCE notes.
//
// Loaded with the other behavior modules (after portutil/gameApi and the emoji
// phase, which provides EMOJI_ASSIST_* + sendEmoji), before nationExecution.

"use strict";

  // ── Structures group — src/core/game/Game.ts:374 (Structures = unitTypeGroup([
  //    City, DefensePost, SAMLauncher, MissileSilo, Port, Factory])). The src uses
  //    `Structures.has(type)` (== Array.includes); we back it with a Set of the
  //    UNIT string values and call `.has()`. NOT defined elsewhere in the bundle.
  const AttackStructures = new Set([
    UNIT.City,
    UNIT.DefensePost,
    UNIT.SAMLauncher,
    UNIT.MissileSilo,
    UNIT.Port,
    UNIT.Factory,
  ]);

  // HumansVsNations — src/core/game/Game.ts:81 (`"Humans Vs Nations"`).
  const HumansVsNations = "Humans Vs Nations";

  // Bound on how many target tiles we COLLECT before awaiting the async boat
  // spawn probe (PORT-CONTRACT §Async #2). The src loops are unbounded
  // (findRandomBoatTarget 500 iters, etc.); we cap the worker calls.
  const BOAT_PROBE_CANDIDATES = 4;

  class AttackBehavior {
    constructor(
      random,
      game,
      player,
      triggerRatio,
      reserveRatio,
      expandRatio,
      allianceBehavior,
      emojiBehavior,
    ) {
      this.random = random;
      this.game = game;
      this.player = player;
      this.triggerRatio = triggerRatio;
      this.reserveRatio = reserveRatio;
      this.expandRatio = expandRatio;
      this.allianceBehavior = allianceBehavior;
      this.emojiBehavior = emojiBehavior;

      this.botAttackTroopsSent = 0;
    }

    // maybeAttack — AiAttackBehavior.maybeAttack (now async: it awaits sendAttack,
    // attackWithRandomBoat and attackBestTarget, which reach the async boat probes).
    async maybeAttack() {
      if (this.player === null || this.allianceBehavior === undefined) {
        throw new Error("not initialized");
      }

      const border = Array.from(this.player.borderTiles())
        .flatMap((t) => this.game.neighbors(t))
        .filter(
          (t) =>
            this.game.isLand(t) &&
            this.game.ownerID(t) !== this.player?.smallID(),
        );
      const playerNeighbors = this.player.nearby();
      // DIVERGENCE: src builds the set from playerBySmallID(ownerID(t)) and filters
      // `o.isPlayer()`. On the client playerBySmallID can return null (core never
      // does), so guard `o != null` before `o.isPlayer()`.
      const borderingPlayerSet = new Set(
        border
          .map((t) => this.game.playerBySmallID(this.game.ownerID(t)))
          .filter((o) => o != null && o.isPlayer()),
      );
      for (const n of playerNeighbors) {
        if (n.isPlayer()) borderingPlayerSet.add(n);
      }
      const borderingPlayers = [...borderingPlayerSet].sort(
        (a, b) => a.troops() - b.troops(),
      );
      const borderingFriends = borderingPlayers.filter(
        (o) => this.player?.isFriendly(o) === true,
      );
      const borderingEnemies = borderingPlayers.filter(
        (o) => this.player?.isFriendly(o) === false,
      );

      // Attack TerraNullius but not nuked territory (direct border or across a river)
      const hasNonNukedTerraNullius =
        border.some((t) => !this.game.hasOwner(t) && !this.game.hasFallout(t)) ||
        playerNeighbors.some((n) => !n.isPlayer());

      // Panel feature toggles. maybeAttack runs under feat("expand")||feat("boat"),
      // so each ACTION inside must enforce its own toggle — otherwise turning one
      // off while its sibling is on would not actually stop it. LAND conquest
      // (attackBots / TN grab / attackBestTarget) → "expand"; the alliance OFFER →
      // "alliance"; boat calls self-gate on "boat" inside their methods. The
      // `toggle && this.random.chance(...)` short-circuits ONLY skip the RNG roll
      // when the toggle is OFF (a non-faithful config), so the default (all on)
      // keeps the exact faithful RNG stream.
      const f = state.settings.features || {};
      const expandOn = !!f.expand;
      const boatOn = !!f.boat;
      const allianceOn = !!f.alliance;

      // WIN-FIX (NOT in src): TAKE OVER a DISCONNECTED neighbour's land. A player who
      // left/timed-out shows the "zzz" icon (isDisconnected()), and the game already
      // treats them as NOT friendly even if they are a teammate/ally (PlayerImpl.isFriendly
      // returns false when disconnected) — so we are allowed to attack their undefended
      // territory. Grab it FIRST (before TN/bots/enemies) so an enemy doesn't snatch the
      // free land. Prioritise the weakest disconnected neighbour.
      if (expandOn && state.settings.winFixes) {
        const sleeping = borderingPlayers.filter((p) => {
          try {
            return p.isPlayer() && p.isDisconnected && p.isDisconnected();
          } catch (_e) {
            return false;
          }
        });
        if (sleeping.length > 0) {
          sleeping.sort((a, b) => a.troops() - b.troops());
          console.log(
            "[Takeover] disconnected neighbour → grabbing land:",
            sleeping[0].name?.() ?? sleeping[0].smallID?.(),
          );
          if (await this.sendAttack(sleeping[0])) return;
        }
      }

      // WIN-FIX (NOT in src): aggressively eat bordering BOTS (the weak Tribe AI
      // that crowds a bot-heavy map) BEFORE grabbing TerraNullius and BEFORE the
      // reserve/trigger gates — so the bot ACTIVELY conquers the bots around it
      // instead of passively expanding into empty land / waiting for fill. The
      // pure faithful AI grabs TN first and only fights bots via the gated pipeline.
      if (
        expandOn &&
        state.settings.winFixes &&
        borderingEnemies.some((e) => e.isPlayer() && e.type() === PlayerType.Bot)
      ) {
        if (await this.attackBots()) return;
      }

      // WIN-FIX (NOT in src): opportunistic amphibious landings — cheap probe boats
      // into weak / freshly-MIRV'd overseas nations, then surge once a beachhead
      // lands. Throttled internally; does NOT return, so land expansion still runs.
      if (state.settings.winFixes) {
        await this.maybeOpportunisticBoat();
      }

      // WIN-FIX (NOT in src): proactively top up a WEAKER same-team ally. The faithful
      // donate is the LAST attack strategy, so on a busy front it never fires; the
      // client also often can't see allies' combat. Throttled; donateTroops keeps our
      // reserve and (in winFix mode) only donates DOWN to a poorer ally.
      if (state.settings.winFixes && state.settings.features.donate) {
        const dNow = performance.now();
        if (dNow - (state.lastDonateMs || 0) > (state.settings.donateThrottleMs || 3000)) {
          if (this.donateTroops()) state.lastDonateMs = dNow;
        }
      }

      // WIN-FIX (NOT in src): SMART DIPLOMACY — proactively court FAR nations (ones we
      // don't border) for DEFENSIVE trade-ally alliances, run unconditionally here so it
      // fires even when we have no bordering enemy (the faithful maybeSendAllianceRequests
      // only runs when borderingEnemies > 0). reachOutToFarNations self-throttles AND
      // self-gates on dominance (stops once we're winning so betray/conquer can close out).
      if (allianceOn && state.settings.winFixes) {
        this.allianceBehavior.reachOutToFarNations();
      }

      if (expandOn && hasNonNukedTerraNullius) {
        if (await this.sendAttack(this.game.terraNullius())) return;
      }

      if (borderingEnemies.length === 0) {
        if (boatOn && this.random.chance(5)) {
          await this.attackWithRandomBoat();
        }
      } else {
        if (boatOn && this.random.chance(10)) {
          await this.attackWithRandomBoat(borderingEnemies);
          return;
        }

        if (allianceOn) {
          this.allianceBehavior.maybeSendAllianceRequests(borderingEnemies);
        }
      }

      if (expandOn) {
        await this.attackBestTarget(borderingFriends, borderingEnemies);
      }
    }

    // attackWithRandomBoat — AiAttackBehavior (private, now async via findRandomBoatTarget).
    async attackWithRandomBoat(borderingEnemies = []) {
      if (this.player === null) throw new Error("not initialized");

      // Honour the panel's "boat" feature toggle (the only boat gate — maybeAttack
      // itself runs under expand||boat, so the toggle must be enforced here).
      if (!(state.settings.features && state.settings.features.boat)) {
        return;
      }

      if (this.game.config().isUnitDisabled(UNIT.TransportShip)) {
        return;
      }

      // WIN-FIX (NOT in src; winFixes-gated): once we DOMINATE the map by land,
      // a "random boat" almost always targets land we're about to conquer anyway.
      // At max game speed the boat intent reaches the worker many ticks after the
      // bestTransportShipSpawn probe, by which time we already own the dst tile —
      // so the game rejects it ("cannot find start tile" / sends to ourselves) and
      // floods the console with harmless-but-noisy failures. A dominating bot
      // expands by LAND, not sea, so skip random boats past a high land share.
      // (Early game = small share = boats still fire, preserving island expansion.)
      if (state.settings.winFixes) {
        const totalLand = this.game.numLandTiles() || 1;
        if (this.player.numTilesOwned() / totalLand > 0.25) {
          return;
        }
      }

      // Check if we've already sent out the maximum number of transport ships
      if (
        this.player.unitCount(UNIT.TransportShip) >=
        this.game.config().boatMaxNumber()
      ) {
        return;
      }

      // Check if we have any shore tiles to launch from
      const shore = Array.from(this.player.borderTiles()).filter((t) =>
        this.game.isShore(t),
      );
      if (shore.length === 0) {
        return;
      }

      const src = this.random.randElement(shore);

      // First look for high-interest targets (unowned or bot-owned). Mainly relevant for earlygame
      let dst = await this.findRandomBoatTarget(src, borderingEnemies, true);
      if (dst === null) {
        // None found? Then look for players
        dst = await this.findRandomBoatTarget(src, borderingEnemies, false);
        if (dst === null) {
          return;
        }
      }

      // src: game.addExecution(new TransportShipExecution(player, dst, troops)).
      const ctors = discoverCtors(getEventBus());
      // USER (winFixes): EVERY boat we send is a CHEAP 1% probe, never a big invasion
      // force. The faithful random boat sends troops/5 (20%) — which the user kept
      // seeing as "boats with lots of troops". Cap it at boatProbeFrac (1%) with the
      // same floor as the opportunistic landings. (winFixes off → faithful troops/5.)
      const troops = state.settings.winFixes
        ? Math.max(
            this.player.troops() * (state.settings.boatProbeFrac || 0.01),
            state.settings.boatProbeMinTroops || 8000,
          )
        : this.player.troops() / 5;
      if (ctors.boat && emitIntent(ctors.boat, dst, troops)) {
        state.stats.attacks++;
        setLastAction(tr("⛵ Random boat"), "naval");
      }
      return;
    }

    // ── WIN-FIX: opportunistic amphibious landings (NOT in src) ────────────────
    // The user's strategy: send a CHEAP probe boat (boatProbeFrac of troops) at a
    // weak / freshly-MIRV'd overseas nation. If a warship sinks it mid-sea we only
    // lose ~1% of troops; if it LANDS (we own a tile near the drop) we immediately
    // pour a bigger surge force into the beachhead. Throttled so it never spams the
    // worker, and EXEMPT from the dominance guard (it targets specific weak/crater
    // tiles across water, not random soon-conquered land), so a dominating bot keeps
    // expanding overseas instead of stalling. Returns true if a boat was emitted.
    async maybeOpportunisticBoat() {
      if (this.player === null) return false;
      // Honour the panel's "boat" feature toggle (maybeAttack runs under
      // expand||boat, so without this the toggle would not actually stop boats).
      if (!(state.settings.features && state.settings.features.boat)) return false;
      if (this.game.config().isUnitDisabled(UNIT.TransportShip)) return false;
      // Keep up to maxConcurrentBoats in flight at all times (capped by the game's own
      // boat limit). Only relaunch when below the cap → continuous pressure, never idle.
      const boatCap = Math.min(
        this.game.config().boatMaxNumber(),
        state.settings.maxConcurrentBoats || 3,
      );
      const ships = this.player.unitCount(UNIT.TransportShip);
      const nowMs = performance.now();
      const throttle = state.settings.oppBoatThrottleMs || 1200;
      const sinceLast = nowMs - (state.lastOppBoatMs || 0);
      const capped = ships >= boatCap;
      const throttled = sinceLast < throttle;

      // Land-army fill. SURGES and CONTESTED landings spend OVERFLOW only (fill ≥
      // boatSurplusFill) so they never bleed the defensive army; grabbing the nearest
      // FREE island or a CLEARLY-WEAKER nation's coast is low-risk, so that path fires
      // at a much lower fill (boatIslandFill) to keep expansion going while we grow.
      const maxT = this.game.config().maxTroops(this.player);
      const fill = maxT > 0 ? this.player.troops() / maxT : 1;
      const surplusFill = state.settings.boatSurplusFill || 0.75;

      const shore = Array.from(this.player.borderTiles()).filter((t) =>
        this.game.isShore(t),
      );
      // DIAG (throttled ~5s): logs the EXACT reason a landing does/doesn't fire,
      // computed BEFORE any early-return so the cap/throttle stalls are visible too.
      // Read `reason` first when the user reports "boat stopped":
      //   capped    → boatCap boats already in flight (long far-voyages tie up the cap)
      //   throttled → just launched, waiting out the per-boat cooldown
      //   no-shore  → we hold no coastal tile to launch from
      //   ok        → no gate blocks; a target search runs this tick (watch for the
      //               follow-up "no reachable target" / "fill too low" / "REFUSED").
      try {
        if (nowMs - (state._boatDiagAt || 0) > 5000) {
          state._boatDiagAt = nowMs;
          console.log("[Boat] diag:", {
            reason: capped
              ? "capped"
              : throttled
                ? "throttled"
                : shore.length === 0
                  ? "no-shore"
                  : "ok",
            ships,
            boatCap,
            shoreTiles: shore.length,
            fill: Number(fill.toFixed(2)),
            islandFill: state.settings.boatIslandFill || 0.35,
            maxShips: this.game.config().boatMaxNumber(),
          });
        }
      } catch (_e) {
        /* ignore */
      }

      if (capped) return false;
      if (throttled) return false;
      if (shore.length === 0) return false;

      // ── SURGE: an active beachhead that has LANDED → pour a bigger force in ──
      const bh = state.beachhead;
      const windowTicks = state.settings.mirvBoatWindowTicks || 150;
      if (
        bh &&
        bh.tile != null &&
        fill >= surplusFill &&
        this.game.ticks() - (bh.at || 0) < windowTicks
      ) {
        if (this.landingSucceeded(bh.tile)) {
          const spawn = await withTimeout(
            this.player.bestTransportShipSpawn(bh.tile),
            WORKER_TIMEOUT_MS,
            false,
          );
          if (spawn !== false) {
            // The INITIAL probe crossed the sea at a SAFE 1% (a warship can only sink 1%).
            // Now it has LANDED and we hold the beachhead → the route is PROVEN, so pour a
            // BIG surge in (boatSurgeFrac = 25% of troops) to CONQUER outward from it. This
            // is the user's "gửi 1% an toàn khi di chuyển, tăng nhiều quân khi đã cập bến".
            // Still gated by fill ≥ surplusFill below, so it never drains home defence.
            const frac = state.settings.boatSurgeFrac || 0.25;
            const troops = this.player.troops() * frac;
            if (this.emitBoat(bh.tile, troops, "⚓ Surge landing")) {
              state.lastOppBoatMs = nowMs;
              bh.at = this.game.ticks(); // refresh the surge window
              bh.surged = true;
              return true;
            }
          }
        }
        // still in transit (not landed yet) → let the window expire naturally.
      }

      // ── PROBE target priority ──
      //  (1) NEAREST unowned island OR clearly-weaker nation's coast (closest first)
      //  (2) freshly-MIRV'd crater   (3) faithful random high-interest scan
      // `lowFillOk` = the target came from the strength-filtered nearest sweep, so it
      // is free / weaker → grabbable at the low island fill; the other two paths are
      // not strength-filtered, so they require the conservative surplus fill.
      // SPREAD (user): never pile multiple 1% probes onto ONE spot — with only ~3 boats
      // out at a time, each should hunt a DIFFERENT opportunity. Collect the tiles our
      // in-flight transport ships are already heading to; every probe finder below skips
      // a target within boatSpreadRadius of one of these, so the 3 boats fan out. (The
      // SURGE above is exempt — it deliberately concentrates on the landed beachhead.)
      this._inflightBoatTargets = [];
      for (const u of this.player.units(UNIT.TransportShip)) {
        try {
          const tt = u.targetTile ? u.targetTile() : null;
          if (tt != null) {
            this._inflightBoatTargets.push({
              x: this.game.x(tt),
              y: this.game.y(tt),
            });
          }
        } catch (_e) {
          /* skip */
        }
      }

      let dst = null;
      let lowFillOk = false;
      let dstOwned = false;
      let dstFallout = false;

      // PRIORITY #1 (user): boat over to a DISCONNECTED player's land — including FAR
      // disconnected ALLIES (their "zzz" land is undefended and free to take over). They
      // are non-friendly while disconnected, so the game lets us land on them.
      if (dst === null) {
        const disco = await this.findDisconnectedBoatTarget();
        if (disco !== null && !this.boatTargetTaken(disco)) {
          dst = disco;
          dstOwned = true;
          lowFillOk = true; // cheap 1% grab of free land → low fill gate
          console.log("[Boat] heading to a DISCONNECTED neighbour's land");
        }
      }

      const targets = dst === null ? this.scanNearbyTargets(shore) : [];
      const probeMax = state.settings.islandProbeMax || 4;
      for (let i = 0; i < targets.length && i < probeMax; i++) {
        if (this.boatTargetTaken(targets[i].tile)) continue; // a boat already heads here
        const sp = await withTimeout(
          this.player.bestTransportShipSpawn(targets[i].tile),
          WORKER_TIMEOUT_MS,
          false,
        );
        if (sp !== false) {
          dst = targets[i].tile;
          dstOwned = targets[i].owned;
          dstFallout = targets[i].fallout;
          lowFillOk = true;
          break;
        }
      }

      if (dst === null) {
        const crater = this.pickMirvCraterTarget();
        if (crater !== null && !this.boatTargetTaken(crater)) {
          const sp = await withTimeout(
            this.player.bestTransportShipSpawn(crater),
            WORKER_TIMEOUT_MS,
            false,
          );
          if (sp !== false) {
            dst = crater;
            dstOwned = true;
          }
        }
      }
      if (dst === null) {
        const src = this.random.randElement(shore);
        const r = await this.findRandomBoatTarget(src, [], true);
        if (r !== null && !this.boatTargetTaken(r)) {
          dst = r;
          dstOwned = this.game.hasOwner(r);
        }
      }
      // Broaden the net so the bot always has SOMETHING to send (keeps 3 boats out):
      // any NON-FRIENDLY player's land reachable across water (harass weak enemies even
      // if they aren't unowned/bot land). findRandomBoatTarget(false) already skips
      // friendlies and (in FFA) stronger players, and probes reachability.
      if (dst === null) {
        const src2 = this.random.randElement(shore);
        const r2 = await this.findRandomBoatTarget(src2, [], false);
        if (r2 !== null && !this.boatTargetTaken(r2)) {
          dst = r2;
          dstOwned = this.game.hasOwner(r2);
        }
      }
      // FINAL FALLBACK (user: "boat must try every way to send 1% — even if surrounded
      // by teammates and the enemy is very far"): probe EVERY non-friendly enemy's
      // territory (nearest first) and boat to the first one reachable across water, even
      // a long voyage. A distant overseas enemy also resists the max-speed boat-to-self
      // staleness (we can't conquer it by land before the boat arrives).
      if (dst === null) {
        const far = await this.findDistantBoatTarget();
        if (far !== null) {
          dst = far;
          dstOwned = true;
          lowFillOk = true; // a cheap 1% probe → fire at the low fill gate
        }
      }
      if (dst === null) {
        // scanCandidates > 0 but none reachable ⇒ targets exist but are LAND-reachable
        // (no water between us and them) → the bot attacks them by foot, not by boat.
        // scanCandidates == 0 ⇒ no non-self land found near any sampled shore tile.
        console.log("[Boat] no reachable target", {
          scanCandidates: targets.length,
          shoreSamples: Math.min(
            state.settings.islandScanSamples || 6,
            shore.length,
          ),
          // From findDistantBoatTarget's last run: enemies seen, how many we probed
          // (probeCap caps it), how many probes timed out. enemies>probed ⇒ cap hit.
          distant: state._distantDiag || null,
        });
        return false;
      }

      const minFill = lowFillOk
        ? state.settings.boatIslandFill || 0.35
        : surplusFill;
      if (fill < minFill) {
        console.log("[Boat] fill too low to launch", {
          fill: Number(fill.toFixed(2)),
          need: minFill,
          contested: !lowFillOk,
        });
        return false;
      }

      const frac = state.settings.boatProbeFrac || 0.01;
      const floor = state.settings.boatProbeMinTroops || 8000;
      const troops = Math.max(this.player.troops() * frac, floor);
      const label = dstFallout
        ? "☢️ Nuked-coast grab"
        : lowFillOk
          ? dstOwned
            ? "🏝️ Weak-coast grab"
            : "🏝️ Island grab"
          : "🛟 Probe landing";
      if (this.emitBoat(dst, troops, label)) {
        console.log("[Boat] LAUNCHED", label, Math.round(troops), "troops");
        state.lastOppBoatMs = nowMs;
        state.beachhead = { tile: dst, at: this.game.ticks(), surged: false };
        return true;
      }
      // Target FOUND but the boat intent was REFUSED (stale / already-conquered /
      // resolves-to-self target — common at MAX game speed when the probe result
      // goes stale before we emit). Silent until now; this is the invisible stall
      // that looks like "bot stopped sending boats even though enemies exist".
      console.log("[Boat] emitBoat REFUSED", label, {
        dstX: this.game.x(dst),
        dstY: this.game.y(dst),
        owner: this.game.hasOwner(dst) ? this.game.ownerID(dst) : "TN",
      });
      return false;
    }

    // boatTargetTaken — true if one of our in-flight transport ships is ALREADY heading
    // to within boatSpreadRadius of `tile`. Lets the probe finders skip a spot another
    // boat already covers, so our (max ~3) boats fan out to DIFFERENT opportunities
    // instead of piling onto one. _inflightBoatTargets is rebuilt each maybeOpportunisticBoat
    // pass; if it's missing (helper called out of context) we answer false (don't block).
    boatTargetTaken(tile) {
      if (tile == null || !Array.isArray(this._inflightBoatTargets)) return false;
      if (this._inflightBoatTargets.length === 0) return false;
      const r = state.settings.boatSpreadRadius || 30;
      let tx;
      let ty;
      try {
        tx = this.game.x(tile);
        ty = this.game.y(tile);
      } catch (_e) {
        return false;
      }
      for (const p of this._inflightBoatTargets) {
        if (Math.abs(p.x - tx) + Math.abs(p.y - ty) <= r) return true;
      }
      return false;
    }

    // scanNearbyTargets — sweep for the NEAREST boat-grabbable tiles, closest first:
    // unowned (TerraNullius) islands, NUKED/FALLOUT coastal land (empty after a blast),
    // AND coastal land owned by a CLEARLY-WEAKER nation (troops < ours × boatWeakTroopFrac).
    // Samples a few shore launch points and scans a bounded box around each; skips our
    // own land, friendlies, stronger nations, and CLEAN unowned TN that already borders
    // us (grabbed overland, not by boat — nuked TN is kept since overland troops die in it).
    // Returns [{tile, owned, fallout}] sorted by squared distance to the launch point.
    scanNearbyTargets(shore) {
      const R = state.settings.islandScanRadius || 40;
      const STEP = state.settings.islandScanStep || 2;
      const SAMPLES = state.settings.islandScanSamples || 6;
      const weakFrac = state.settings.boatWeakTroopFrac ?? 0.6;
      const mySid = this.player.smallID();
      const myTroops = this.player.troops();
      const weakCache = new Map(); // smallID -> grabbable (weaker, non-friendly)
      const seen = new Set();
      const out = [];
      const n = Math.min(SAMPLES, shore.length);
      for (let s = 0; s < n; s++) {
        const st = this.random.randElement(shore);
        const sx = this.game.x(st);
        const sy = this.game.y(st);
        for (let dx = -R; dx <= R; dx += STEP) {
          for (let dy = -R; dy <= R; dy += STEP) {
            const nx = sx + dx;
            const ny = sy + dy;
            if (!this.game.isValidCoord(nx, ny)) continue;
            const t = this.game.ref(nx, ny);
            if (seen.has(t)) continue;
            if (!this.game.isLand(t)) continue;
            // USER WIN-FIX: do NOT skip fallout. A freshly-MIRV'd / nuked coastal zone
            // is prime grab turf — the blast wipes the owner, leaving empty land that a
            // probe boat can claim as the radiation clears (exactly like the MIRV-crater
            // path). We TAG fallout tiles so the launcher can label/prioritise them.
            const fallout = this.game.hasFallout(t);
            const oid = this.game.ownerID(t);
            if (oid === mySid) continue; // already ours
            const owned = this.game.hasOwner(t);
            if (owned) {
              // Owned coast — grab only a clearly-weaker, non-friendly nation.
              let grab = weakCache.get(oid);
              if (grab === undefined) {
                const o = this.game.playerBySmallID(oid);
                grab = !!(
                  o &&
                  o.isPlayer() &&
                  this.player.isFriendly(o) === false &&
                  o.troops() < myTroops * weakFrac
                );
                weakCache.set(oid, grab);
              }
              if (!grab) continue;
            } else if (!fallout) {
              // Clean unowned TN bordering our own land is grabbed overland — skip here.
              // A NUKED unowned tile is KEPT even when it borders us: overland troops
              // would just bleed out in the fallout, so a boat is the right tool for it.
              if (
                this.game
                  .neighbors(t)
                  .some((nb) => this.game.ownerID(nb) === mySid)
              ) {
                continue;
              }
            }
            seen.add(t);
            out.push({ tile: t, dist: dx * dx + dy * dy, owned, fallout });
          }
        }
      }
      out.sort((a, b) => a.dist - b.dist);
      return out;
    }

    // findDisconnectedBoatTarget — like findDistantBoatTarget but ONLY disconnected
    // players (allies or enemies showing the "zzz" icon), nearest first. Their land is
    // undefended, so this lets the bot boat over — even far across water — to take over
    // a disconnected teammate's territory.
    async findDisconnectedBoatTarget() {
      if (this.player === null) return null;
      const mySid = this.player.smallID();
      const myCenter = this.getPlayerCenter(this.player);
      const cands = [];
      for (const e of this.game.players()) {
        try {
          if (!e.isPlayer || !e.isPlayer()) continue;
          if (!e.isAlive()) continue;
          if (e.smallID() === mySid) continue;
          if (!(e.isDisconnected && e.isDisconnected())) continue; // ONLY "zzz" players
          const loc = e.nameLocation ? e.nameLocation() : null;
          if (!loc || loc.x == null) continue;
          if (!this.game.isValidCoord(loc.x, loc.y)) continue;
          const tile = this.game.ref(loc.x, loc.y);
          if (tile == null) continue;
          let dist = 0;
          if (myCenter && myCenter.x != null) {
            const dx = loc.x - myCenter.x;
            const dy = loc.y - myCenter.y;
            dist = dx * dx + dy * dy;
          }
          cands.push({ tile, dist });
        } catch (_e) {
          /* skip this player */
        }
      }
      cands.sort((a, b) => a.dist - b.dist); // nearest disconnected first
      const cap = state.settings.distantBoatProbeMax || 12;
      for (let i = 0; i < cands.length && i < cap; i++) {
        if (this.boatTargetTaken(cands[i].tile)) continue; // a boat already heads here
        const sp = await withTimeout(
          this.player.bestTransportShipSpawn(cands[i].tile),
          WORKER_TIMEOUT_MS,
          false,
        );
        if (sp !== false) return cands[i].tile;
      }
      return null;
    }

    // findDistantBoatTarget — probe EVERY alive non-friendly enemy's territory (a tile
    // at their name location ≈ centroid), nearest first, and return the first one
    // reachable across water. Lets the bot lead a 1% boat on a long voyage to a far
    // enemy even when it's hemmed in by teammates with no nearby coastal target.
    async findDistantBoatTarget() {
      if (this.player === null) return null;
      const mySid = this.player.smallID();
      const myCenter = this.getPlayerCenter(this.player);
      const cands = [];
      for (const e of this.game.players()) {
        try {
          if (!e.isPlayer || !e.isPlayer()) continue;
          if (!e.isAlive()) continue;
          if (e.smallID() === mySid) continue;
          if (this.player.isFriendly(e) === true) continue;
          const loc = e.nameLocation ? e.nameLocation() : null;
          if (!loc || loc.x == null) continue;
          if (!this.game.isValidCoord(loc.x, loc.y)) continue;
          const tile = this.game.ref(loc.x, loc.y);
          if (tile == null) continue;
          let dist = 0;
          if (myCenter && myCenter.x != null) {
            const dx = loc.x - myCenter.x;
            const dy = loc.y - myCenter.y;
            dist = dx * dx + dy * dy;
          }
          cands.push({ tile, dist });
        } catch (_e) {
          /* skip this player */
        }
      }
      cands.sort((a, b) => a.dist - b.dist); // nearest enemy first = shortest voyage
      const cap = state.settings.distantBoatProbeMax || 12;
      // Sentinel default lets us tell a TIMED-OUT probe (worker saturated at MAX
      // game speed) apart from a genuine `false` (enemy not reachable across water,
      // i.e. land-connected). Without this, both look identical and we can't tell
      // "stopped because of max-speed timeouts" from "stopped because all nearby
      // enemies are land-connected and the far sea-separated ones are past the cap".
      const TIMEOUT = "__probe_timeout__";
      let probed = 0;
      let timedOut = 0;
      for (let i = 0; i < cands.length && i < cap; i++) {
        if (this.boatTargetTaken(cands[i].tile)) continue; // a boat already heads here
        probed++;
        const sp = await withTimeout(
          this.player.bestTransportShipSpawn(cands[i].tile),
          WORKER_TIMEOUT_MS,
          TIMEOUT,
        );
        if (sp === TIMEOUT) {
          timedOut++;
          continue;
        }
        if (sp !== false) {
          state._distantDiag = {
            enemies: cands.length,
            probed,
            probeCap: cap,
            timedOut,
            found: true,
          };
          return cands[i].tile;
        }
      }
      // Exhausted the cap (or all enemies) with no water-reachable target. Stash the
      // counts so the "no reachable target" log can say WHY: enemies>probeCap with
      // found=false ⇒ raise distantBoatProbeMax (far sea enemies past the cap);
      // timedOut>0 ⇒ max-speed worker saturation, not a routing problem.
      state._distantDiag = {
        enemies: cands.length,
        probed,
        probeCap: cap,
        timedOut,
        found: false,
      };
      return null;
    }

    // emitBoat — fire a TransportShipExecution at dst carrying `troops`.
    emitBoat(dst, troops, label) {
      // Final chokepoint for the "boat" feature toggle: never fire when off.
      if (!(state.settings.features && state.settings.features.boat)) {
        return false;
      }
      const ctors = discoverCtors(getEventBus());
      if (ctors.boat && emitIntent(ctors.boat, dst, troops)) {
        state.stats.attacks++;
        setLastAction(tr(label), "naval");
        return true;
      }
      return false;
    }

    // landingSucceeded — did a probe boat establish a foothold? True if we own any
    // land tile within a small box around the drop point (cheap sync scan, no worker).
    landingSucceeded(tile) {
      const cx = this.game.x(tile);
      const cy = this.game.y(tile);
      const mySid = this.player.smallID();
      const R = 6;
      for (let dx = -R; dx <= R; dx += 2) {
        for (let dy = -R; dy <= R; dy += 2) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.game.isValidCoord(nx, ny)) continue;
          const t = this.game.ref(nx, ny);
          if (this.game.isLand(t) && this.game.ownerID(t) === mySid) return true;
        }
      }
      return false;
    }

    // pickMirvCraterTarget — the freshest MIRV crater we don't already own. Prunes
    // craters older than the boat window. Returns a TileRef or null.
    pickMirvCraterTarget() {
      const hits = Array.isArray(state.recentMirvHits) ? state.recentMirvHits : [];
      const windowTicks = state.settings.mirvBoatWindowTicks || 150;
      const now = this.game.ticks();
      state.recentMirvHits = hits.filter((h) => now - (h.at || 0) < windowTicks);
      const mySid = this.player.smallID();
      for (let i = state.recentMirvHits.length - 1; i >= 0; i--) {
        const h = state.recentMirvHits[i];
        if (h.tile == null) continue;
        // Skip craters we already conquered (no point boating our own land).
        if (this.game.ownerID(h.tile) === mySid) continue;
        return h.tile;
      }
      return null;
    }

    // findRandomBoatTarget — AiAttackBehavior (private, now async).
    //
    // DIVERGENCE (boat rank/collect-then-probe, PORT-CONTRACT §Async #2): src runs
    // up to 500 RNG iterations, and at each candidate that passes the cheap sync
    // criteria it calls the SYNC `canBuildTransportShip(...)` and returns the FIRST
    // that succeeds. The client probe (`bestTransportShipSpawn`) is an async worker
    // call, so we cannot afford 500 of them. We keep the SAME 500-iter RNG scan with
    // the SAME cheap sync criteria (incl. the unreachablePlayers memo) to COLLECT up
    // to BOAT_PROBE_CANDIDATES tiles in the src's selection order, THEN `await
    // bestTransportShipSpawn` down that short list and return the FIRST reachable —
    // the same target src would have chosen, with bounded worker calls. The probe is
    // a GATE only; the returned value is the original `randTile`.
    async findRandomBoatTarget(tile, borderingEnemies, highInterestOnly = false) {
      if (this.player === null) throw new Error("not initialized");
      const x = this.game.x(tile);
      const y = this.game.y(tile);
      const unreachablePlayers = new Set();
      const candidates = [];
      for (let i = 0; i < 500; i++) {
        const randX = this.random.nextInt(x - 150, x + 150);
        const randY = this.random.nextInt(y - 150, y + 150);
        if (!this.game.isValidCoord(randX, randY)) {
          continue;
        }
        const randTile = this.game.ref(randX, randY);
        if (!this.game.isLand(randTile)) {
          continue;
        }
        const owner = this.game.owner(randTile);
        // src: `owner === this.player` (identity) → smallID compare; TN has no smallID-match.
        if (owner.isPlayer() && owner.smallID() === this.player.smallID()) {
          continue;
        }
        // Skip players we already know are unreachable (Performance optimization)
        if (owner.isPlayer() && unreachablePlayers.has(owner.id())) {
          continue;
        }
        // Don't send boats to players with which we share a border, that usually looks stupid
        if (
          owner.isPlayer() &&
          borderingEnemies.some((e) => e.smallID() === owner.smallID())
        ) {
          continue;
        }
        // Don't spam boats into players which are stronger than us (FFA only)
        if (
          this.isFFA() &&
          owner.isPlayer() &&
          owner.troops() > this.player.troops()
        ) {
          continue;
        }

        let matchesCriteria;
        if (highInterestOnly) {
          // High-interest targeting: prioritize unowned tiles or tiles owned by bots
          matchesCriteria = !owner.isPlayer() || owner.type() === PlayerType.Bot;
        } else {
          // Normal targeting: return unowned tiles or tiles owned by non-friendly players
          matchesCriteria = !owner.isPlayer() || !owner.isFriendly(this.player);
        }
        if (!matchesCriteria) {
          continue;
        }

        // DIVERGENCE: src would here call canBuildTransportShip synchronously and
        // return on success (or memo the player unreachable on failure). We instead
        // COLLECT this passing tile (in src order) and defer the async reachability
        // probe to after the scan, so the worker calls are bounded. We cannot do the
        // per-player unreachable memo inside the loop (it depends on the probe), so
        // memoization of unreachable players is best-effort over the probe phase.
        candidates.push({ tile: randTile, owner });
        if (candidates.length >= BOAT_PROBE_CANDIDATES) {
          break;
        }
      }

      // Probe the collected candidates in src selection order; first reachable wins.
      for (const cand of candidates) {
        if (cand.owner.isPlayer() && unreachablePlayers.has(cand.owner.id())) {
          continue;
        }
        const spawn = await withTimeout(
          this.player.bestTransportShipSpawn(cand.tile),
          WORKER_TIMEOUT_MS,
          false,
        );
        if (spawn === false) {
          if (cand.owner.isPlayer()) {
            unreachablePlayers.add(cand.owner.id());
          }
          continue;
        }
        return cand.tile;
      }
      return null;
    }

    // attackBestTarget is called with borderingFriends and borderingEnemies sorted
    // by troops (ascending). AiAttackBehavior (private, now async).
    async attackBestTarget(borderingFriends, borderingEnemies) {
      // In games with high starting gold, nations will quickly build a lot of cities
      // This causes them to expand slowly (cities increase max troops), and bots will steal their structures
      // In this case: Attack bots before ratio checks
      if (this.hasNeighboringBotWithStructures()) {
        if (await this.attackBots()) return;
      }

      // Save up troops until we reach the reserve ratio
      if (!this.hasReserveRatioTroops()) return;

      // Maybe save up troops until we reach the trigger ratio
      if (!this.hasTriggerRatioTroops() && !this.random.chance(10)) return;

      // Get attack strategies in priority order based on difficulty
      const strategies = this.getAttackStrategies(
        borderingFriends,
        borderingEnemies,
      );

      for (const strategy of strategies) {
        if (await strategy()) return;
      }
    }

    // getAttackStrategies — AiAttackBehavior (private). The strategy predicates
    // become async (they reach sendAttack → the async boat probes). The four
    // difficulty-ordered arrays are VERBATIM from src.
    getAttackStrategies(borderingFriends, borderingEnemies) {
      // src: `const { difficulty } = this.game.config().gameConfig();` → REPLICATED.
      const difficulty = currentDifficulty();

      // Define all strategies as functions that return true if they attacked
      const retaliate = async () => {
        const attacker = this.findIncomingAttackPlayer();
        if (attacker) {
          return await this.sendAttack(attacker, true);
        }
        return false;
      };

      const bots = async () => await this.attackBots();

      const assist = async () => await this.assistAllies();

      const traitor = async () => {
        const traitor = this.findTraitor(borderingEnemies);
        if (traitor) {
          return await this.sendAttack(traitor);
        }
        return false;
      };

      const afk = async () => {
        // borderingEnemies is already sorted by troops (ascending), so first match is weakest afk enemy
        const afk = borderingEnemies.find(
          (enemy) =>
            enemy.isDisconnected() &&
            (!this.isFFA() || enemy.troops() < this.player.troops() * 3),
        );
        if (afk) {
          return await this.sendAttack(afk);
        }
        return false;
      };

      const betray = async () =>
        await this.maybeBetrayAndAttack(borderingFriends, borderingEnemies);

      const nuked = async () => {
        if (this.isBorderingNukedTerritory()) {
          return await this.sendAttack(this.game.terraNullius());
        }
        return false;
      };

      const victim = async () => {
        const victim = this.findVictim(borderingEnemies);
        if (victim) {
          return await this.sendAttack(victim);
        }
        return false;
      };

      const hated = async () => {
        for (const relation of this.player.allRelationsSorted()) {
          if (relation.relation !== Relation.Hostile) continue;
          const other = relation.player;
          if (this.player.isFriendly(other)) continue;
          if (this.isFFA() && other.troops() > this.player.troops() * 3) continue;
          return await this.sendAttack(other);
        }
        return false;
      };

      const veryWeak = async () => {
        const veryWeak = this.findVeryWeakEnemy(borderingEnemies);
        if (veryWeak) {
          return await this.sendAttack(veryWeak);
        }
        return false;
      };

      const weakest = async () => {
        if (borderingEnemies.length > 0) {
          // borderingEnemies is already sorted by troops (ascending), so first match is weakest
          const weakest = borderingEnemies[0];
          // In FFA, don't attack if they have more troops than us
          if (!this.isFFA() || weakest.troops() < this.player.troops()) {
            return await this.sendAttack(weakest);
          }
        }
        return false;
      };

      const island = async () => {
        if (borderingEnemies.length === 0) {
          const enemy = await this.findNearestIslandEnemy();
          if (enemy) {
            return await this.sendAttack(enemy);
          }
        }
        return false;
      };

      const donate = async () => await this.donateTroops();

      // Return strategies in order based on difficulty
      // Easy nations get the dumbest order, impossible nations get the smartest order
      let order;
      switch (difficulty) {
        case Difficulty.Easy:
          // prettier-ignore
          order = [nuked, bots, retaliate, assist, betray, hated, weakest];
          break;
        case Difficulty.Medium:
          // prettier-ignore
          order = [bots, nuked, retaliate, assist, betray, hated, afk, traitor, weakest, island, donate];
          break;
        case Difficulty.Hard:
          // prettier-ignore
          order = [bots, retaliate, assist, betray, nuked, traitor, afk, hated, veryWeak, victim, weakest, island, donate];
          break;
        case Difficulty.Impossible:
          // prettier-ignore
          order = [retaliate, bots, veryWeak, assist, traitor, afk, betray, victim, nuked, hated, weakest, island, donate];
          break;
        default:
          // src: assertNever(difficulty). currentDifficulty() defaults to Impossible
          // so this is unreachable; keep an explicit throw for parity.
          throw new Error("unreachable difficulty: " + difficulty);
      }

      // USER WIN-FIX (NOT in src): DEPRIORITISE grabbing radioactive (nuked) TerraNullius.
      // The faithful order runs `nuked` (grab fallout TN bordering us) BEFORE attacking
      // adjacent ENEMIES (hated/weakest). The user wants bordering enemies dealt with
      // FIRST, then mop up the radioactive craters — so move `nuked` to just AFTER
      // `weakest` (the last bordering-enemy strategy). winFixes off → exact faithful order.
      if (state.settings.winFixes) {
        const ni = order.indexOf(nuked);
        if (ni !== -1) {
          order.splice(ni, 1);
          const wi = order.indexOf(weakest);
          if (wi !== -1) order.splice(wi + 1, 0, nuked);
          else order.push(nuked);
        }
      }
      return order;
    }

    // hasNeighboringBotWithStructures — AiAttackBehavior (private).
    hasNeighboringBotWithStructures() {
      return this.player
        .nearby()
        .some(
          (n) =>
            n.isPlayer() &&
            n.type() === PlayerType.Bot &&
            !this.player.isFriendly(n) &&
            n.units().some((u) => AttackStructures.has(u.type())),
        );
    }

    // hasReserveRatioTroops — AiAttackBehavior (private).
    hasReserveRatioTroops() {
      const maxTroops = this.game.config().maxTroops(this.player);
      const ratio = this.player.troops() / maxTroops;
      return ratio >= this.effectiveReserveRatio();
    }

    // WIN-FIX (sizeReserve) — NOT in src. A size-aware reserve FLOOR: as the
    // empire grows, hold back more troops to keep the long borders defensible.
    // This breaks the over-expand → thin-border → get-pushed-back oscillation
    // that caps the pure faithful bot at ~16% (keeps fill high so conquests
    // stick). Gated by settings.winFixes (off → exactly this.reserveRatio = src).
    effectiveReserveRatio() {
      let r = this.reserveRatio;
      try {
        if (state.settings.winFixes) {
          const total = this.game.numLandTiles() || 1;
          const share = this.player.numTilesOwned() / total;
          const scale = state.settings.sizeReserveScale ?? 0;
          const cap = state.settings.sizeReserveCap ?? 0.6;
          r = Math.max(r, Math.min(cap, share * scale));
        }
      } catch (_e) {
        /* default to src reserveRatio */
      }
      // DIVERGENCE (reserveByNeighbors): src picks one reserveRatio per game and never
      // revisits it, so a nation boxed in by four enemies commits exactly as much of
      // its army as one with a single quiet neighbour. Scale the floor with the number
      // of distinct hostile players actually touching our border.
      try {
        if (state.settings.reserveByNeighbors) {
          const enemies = this.hostileNeighborCount();
          if (enemies > 1) {
            r = Math.max(
              r,
              Math.min(
                RESERVE_NEIGHBOR_CAP,
                r + (enemies - 1) * RESERVE_PER_EXTRA_NEIGHBOR,
              ),
            );
          }
        }
      } catch (_e) {
        /* keep r as-is */
      }
      return Math.min(r, MAX_DEFENSE_RESERVE);
    }

    /**
     * DIVERGENCE (reserveByNeighbors): count DISTINCT hostile players whose land
     * touches ours. Memoised per game tick — the border walk is O(border) and
     * effectiveReserveRatio() is consulted several times per decision cycle.
     * Resolves hostiles from players() up front rather than per-tile, because
     * playerBySmallID is not guaranteed to exist on every build.
     */
    hostileNeighborCount() {
      let tick = -1;
      try {
        tick = Number(this.game.ticks());
      } catch (_e) {
        return 0;
      }
      if (this._hostileNbTick === tick) return this._hostileNbCount;
      let count = 0;
      try {
        const hostile = new Set();
        for (const other of this.game.players()) {
          if (!other.isPlayer() || !other.isAlive()) continue;
          if (other.smallID() === this.player.smallID()) continue;
          if (this.player.isFriendly(other)) continue;
          hostile.add(other.smallID());
        }
        if (hostile.size > 0) {
          const touching = new Set();
          for (const borderTile of this.player.borderTiles()) {
            for (const neighbor of this.game.neighbors(borderTile)) {
              if (!this.game.hasOwner(neighbor) || !this.game.isLand(neighbor)) continue;
              const sid = this.game.ownerID(neighbor);
              if (hostile.has(sid)) touching.add(sid);
            }
          }
          count = touching.size;
        }
      } catch (_e) {
        count = 0;
      }
      this._hostileNbTick = tick;
      this._hostileNbCount = count;
      return count;
    }

    // hasTriggerRatioTroops — AiAttackBehavior (private).
    hasTriggerRatioTroops() {
      const maxTroops = this.game.config().maxTroops(this.player);
      const ratio = this.player.troops() / maxTroops;
      return ratio >= this.triggerRatio;
    }

    // findIncomingAttackPlayer — AiAttackBehavior.
    findIncomingAttackPlayer() {
      let incomingAttacks = this.player
        .incomingAttacks()
        .filter((attack) => !this.player.isFriendly(attack.attacker()));
      // Ignore bot attacks if we are not a bot.
      if (this.player.type() !== PlayerType.Bot) {
        incomingAttacks = incomingAttacks.filter(
          (attack) => attack.attacker().type() !== PlayerType.Bot,
        );
      }
      let largestAttack = 0;
      let largestAttacker;
      for (const attack of incomingAttacks) {
        if (attack.troops() <= largestAttack) continue;
        largestAttack = attack.troops();
        largestAttacker = attack.attacker();
      }
      if (largestAttacker !== undefined) {
        return largestAttacker;
      }
      return null;
    }

    // Sort neighboring bots by density (troops / tiles) and attempt to attack many of them (Parallel attacks)
    // sendAttack will do nothing if we don't have enough reserve troops left
    // Bots that own structures are prioritized as targets (they might have stolen our structures and they will delete them!)
    // attackBots — AiAttackBehavior (private, now async: awaits sendAttack
    // sequentially so botAttackTroopsSent accumulates before the `> 0` return).
    async attackBots() {
      const bots = this.player
        .nearby()
        .filter(
          (n) =>
            n.isPlayer() &&
            this.player.isFriendly(n) === false &&
            n.type() === PlayerType.Bot,
        );

      if (bots.length === 0) {
        return false;
      }

      this.botAttackTroopsSent = 0;

      const density = (p) => p.troops() / p.numTilesOwned();
      const ownsStructures = (p) =>
        p.units().some((u) => AttackStructures.has(u.type()));
      const sortedBots = bots.slice().sort((a, b) => {
        const aHasStructures = ownsStructures(a);
        const bHasStructures = ownsStructures(b);
        if (aHasStructures !== bHasStructures) {
          return aHasStructures ? -1 : 1;
        }
        return density(a) - density(b);
      });
      const reducedBots = sortedBots.slice(0, this.getBotAttackMaxParallelism());

      for (const bot of reducedBots) {
        await this.sendAttack(bot);
      }

      // Only short-circuit the rest of the targeting pipeline if we actually
      // allocated some troops to bot attacks.
      return this.botAttackTroopsSent > 0;
    }

    // getBotAttackMaxParallelism — AiAttackBehavior (private).
    getBotAttackMaxParallelism() {
      // src: `const { difficulty } = this.game.config().gameConfig();` → REPLICATED.
      const difficulty = currentDifficulty();
      switch (difficulty) {
        case Difficulty.Easy:
          return 1;
        case Difficulty.Medium:
          return this.random.chance(2) ? 1 : 2;
        case Difficulty.Hard:
          return 3;
        // On impossible difficulty, attack as much bots as possible in parallel
        case Difficulty.Impossible: {
          return 100;
        }
        default:
          throw new Error("unreachable difficulty: " + difficulty);
      }
    }

    // assistAllies — AiAttackBehavior (private, now async via sendAttack).
    async assistAllies() {
      if (this.emojiBehavior === undefined) throw new Error("not initialized");

      if (this.game.config().disableAlliances()) return false;

      for (const ally of this.player.allies()) {
        if (ally.targets().length === 0) continue;
        if (this.player.relation(ally) < Relation.Friendly) {
          this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_RELATION_TOO_LOW);
          continue;
        }
        for (const target of ally.targets()) {
          // src: `target === this.player` (identity) → smallID compare.
          if (
            target.isPlayer() &&
            target.smallID() === this.player.smallID()
          ) {
            this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_TARGET_ME);
            continue;
          }
          if (this.player.isFriendly(target)) {
            this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_TARGET_ALLY);
            continue;
          }
          if (!(await this.sendAttack(target))) continue;
          this.player.updateRelation(ally, -20);
          this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_ACCEPT);
          return true;
        }
      }
      return false;
    }

    // Find a traitor who isn't significantly stronger than us
    // findTraitor — AiAttackBehavior (private).
    findTraitor(borderingEnemies) {
      if (this.game.config().disableAlliances()) return null;

      // borderingEnemies is already sorted by troops (ascending), so first match is weakest traitor
      return (
        borderingEnemies.find(
          (enemy) =>
            enemy.isTraitor() &&
            (!this.isFFA() || enemy.troops() < this.player.troops() * 1.2),
        ) ?? null
      );
    }

    // maybeBetrayAndAttack — AiAttackBehavior (private, now async via sendAttack).
    async maybeBetrayAndAttack(borderingFriends, borderingEnemies) {
      if (this.allianceBehavior === undefined) throw new Error("not initialized");

      if (this.game.config().disableAlliances()) return false;

      if (borderingFriends.length > 0) {
        for (const friend of borderingFriends) {
          if (
            this.allianceBehavior.maybeBetray(
              friend,
              borderingFriends.length + borderingEnemies.length,
            )
          ) {
            return await this.sendAttack(friend, true);
          }
        }
      }
      return false;
    }

    // isBorderingNukedTerritory — AiAttackBehavior (private).
    isBorderingNukedTerritory() {
      if (this.game.config().isUnitDisabled(UNIT.MissileSilo)) {
        return false;
      }

      for (const tile of this.player.borderTiles()) {
        for (const neighbor of this.game.neighbors(tile)) {
          if (
            this.game.isLand(neighbor) &&
            !this.game.hasOwner(neighbor) &&
            this.game.hasFallout(neighbor)
          ) {
            return true;
          }
        }
      }
      return false;
    }

    // Find someone who isn't significantly stronger than us and is under big attack from others (50%+ of their troops incoming)
    // findVictim — AiAttackBehavior (private).
    findVictim(borderingEnemies) {
      // borderingEnemies is already sorted by troops (ascending), so first match is weakest victim
      return (
        borderingEnemies.find((enemy) => {
          if (this.isFFA() && enemy.troops() > this.player.troops() * 1.2) {
            return false;
          }

          const totalIncomingTroops = enemy
            .incomingAttacks()
            .reduce((sum, attack) => sum + attack.troops(), 0);

          return totalIncomingTroops > enemy.troops() * 0.5;
        }) ?? null
      );
    }

    // Find very weak (less than 15% of their maxTroops) enemies
    // which also don't have significantly more troops than us (to target MIRVed players)
    // findVeryWeakEnemy — AiAttackBehavior (private).
    findVeryWeakEnemy(borderingEnemies) {
      const veryWeakEnemies = borderingEnemies.filter((enemy) => {
        const enemyMaxTroops = this.game.config().maxTroops(enemy);
        return (
          enemy.troops() < enemyMaxTroops * 0.15 &&
          (!this.isFFA() || enemy.troops() < this.player.troops() * 1.2)
        );
      });

      // borderingEnemies is already sorted by troops (ascending), so first match is weakest very weak enemy
      return veryWeakEnemies.length > 0 ? veryWeakEnemies[0] : null;
    }

    // findNearestIslandEnemy — AiAttackBehavior (private, now async).
    //
    // DIVERGENCE (center proxy + bounded border fetches): src sorts ALL filtered
    // players by manhattan distance between TERRITORY CENTERS computed from
    // borderTiles / largestClusterBoundingBox. On the client, (a)
    // largestClusterBoundingBox does not exist on the PlayerView, and (b) fetching
    // every filtered player's borderTiles for the distance sort would be unbounded
    // async worker calls. So we use `nameLocation()` (sync, available for all
    // players) as the cheap center proxy FOR THE SORT only — a faithful stand-in
    // for the bounding-box center (the player's label sits at its centroid). We
    // keep the SAME ascending-distance order and the SAME reachability loop, but
    // `await game.ensureBorderTiles(candidate)` ONLY for the candidates we actually
    // measure with closestTwoTiles, and we respect the src ≤2-reachable early-exit
    // so the number of border fetches is bounded. The boat reachability probe uses
    // bestTransportShipSpawn (the async equivalent of canBuildTransportShip).
    async findNearestIslandEnemy() {
      if (this.game.config().isUnitDisabled(UNIT.TransportShip)) {
        return null;
      }

      // Check if we've already sent out the maximum number of transport ships
      if (
        this.player.unitCount(UNIT.TransportShip) >=
        this.game.config().boatMaxNumber()
      ) {
        return null;
      }

      // Check if we have any shore tiles to launch from
      const hasShore = Array.from(this.player.borderTiles()).some((t) =>
        this.game.isShore(t),
      );
      if (!hasShore) return null;

      const filteredPlayers = this.game.players().filter((p) => {
        // src: `p === this.player` (identity) → smallID compare.
        if (p.smallID() === this.player.smallID()) return false;
        if (this.player.isFriendly(p)) return false;
        // In FFA, don't spam boats into players with more troops
        return !this.isFFA() || p.troops() < this.player.troops();
      });

      if (filteredPlayers.length === 0) return null;

      const playerCenter = this.getPlayerCenter(this.player);

      const sortedPlayers = filteredPlayers
        .map((filteredPlayer) => {
          const filteredPlayerCenter = this.getPlayerCenter(filteredPlayer);

          // getPlayerCenter falls back to nameLocation(), which can be undefined for
          // a player whose name position isn't populated yet (esp. other players on the
          // client). Guard both centers so the distance-sort never throws — such a
          // player just sorts last (Infinity) and is probed later by reachability.
          if (
            !playerCenter ||
            playerCenter.x == null ||
            !filteredPlayerCenter ||
            filteredPlayerCenter.x == null
          ) {
            return { player: filteredPlayer, distance: Infinity };
          }

          const playerCenterTile = this.game.ref(playerCenter.x, playerCenter.y);
          const filteredPlayerCenterTile = this.game.ref(
            filteredPlayerCenter.x,
            filteredPlayerCenter.y,
          );

          const distance = this.game.manhattanDist(
            playerCenterTile,
            filteredPlayerCenterTile,
          );
          return { player: filteredPlayer, distance };
        })
        .sort((a, b) => a.distance - b.distance); // Sort by distance (ascending)

      // Our shore tiles are stable across the loop — compute once.
      const myShores = Array.from(this.player.borderTiles()).filter((t) =>
        this.game.isShore(t),
      );

      // Try players in order of distance until we find reachable candidates
      const reachablePlayers = [];
      for (const entry of sortedPlayers) {
        // Fetch THIS candidate's border tiles (bounded: we early-exit at ≤2 reachable).
        await this.game.ensureBorderTiles(entry.player);
        const closest = closestTwoTiles(
          this.game,
          myShores,
          Array.from(entry.player.borderTiles()).filter((t) =>
            this.game.isShore(t),
          ),
        );
        if (closest === null) continue;

        const spawn = await withTimeout(
          this.player.bestTransportShipSpawn(closest.y),
          WORKER_TIMEOUT_MS,
          false,
        );
        if (spawn !== false) {
          reachablePlayers.push(entry.player);
          // We only need up to 2 reachable candidates
          if (reachablePlayers.length >= 2) break;
        }
      }

      if (reachablePlayers.length === 0) return null;

      // DIVERGENCE (bestAI): src takes the second-nearest 33% of the time.
      return reachablePlayers[0];
    }

    // In team games, nations should be willing to attack/boat into stronger
    // enemies - they can rely on teammates to donate. In FFA, going after
    // someone significantly stronger is usually a losing proposition.
    // isFFA — AiAttackBehavior (private).
    isFFA() {
      // src: `this.game.config().gameConfig().gameMode === GameMode.FFA`. gameMode
      // is a real lobby fact — kept reading the real gameConfig (like sibling behaviors).
      return this.game.config().gameConfig().gameMode === GameMode.FFA;
    }

    // getPlayerCenter — AiAttackBehavior (private).
    // DIVERGENCE: src prefers `player.largestClusterBoundingBox` (core-only — not on
    // the client PlayerView; the gameApi wrapper does not expose it). We always fall
    // back to calculateBoundingBoxCenter over the border snapshot (the src fallback
    // branch). For OTHER players this requires their borderTiles to have been
    // ensured first; findNearestIslandEnemy ensures them per-candidate before the
    // closestTwoTiles measurement, but the distance-SORT center uses nameLocation()
    // (see findNearestIslandEnemy header) so an empty fallback here for the sort is
    // avoided. If borderTiles is empty (not yet fetched), this returns a center of
    // {x:-Infinity-ish}; callers in this file only invoke getPlayerCenter for `me`
    // (whose border is always snapshotted) via nameLocation proxy for others.
    getPlayerCenter(player) {
      // src: `if (player.largestClusterBoundingBox) return boundingBoxCenter(...)`.
      // Unavailable client-side → use nameLocation() as the centroid proxy when the
      // border snapshot for this player is not populated, else the bbox center.
      if (player.largestClusterBoundingBox) {
        return boundingBoxCenter(player.largestClusterBoundingBox);
      }
      const border = player.borderTiles();
      if (border && border.size > 0) {
        return calculateBoundingBoxCenter(this.game, border);
      }
      // Border not snapshotted (other player, sort phase) → nameLocation proxy.
      return player.nameLocation();
    }

    // attackRandomTarget — AiAttackBehavior (now async via sendAttack). Not invoked
    // by maybeAttack, but ported for true 1:1 (some callers/tests use it).
    async attackRandomTarget() {
      // Save up troops until we reach the trigger ratio
      if (!this.hasTriggerRatioTroops()) return;

      // Retaliate against incoming attacks
      const incomingAttackPlayer = this.findIncomingAttackPlayer();
      if (incomingAttackPlayer) {
        if (await this.sendAttack(incomingAttackPlayer, true)) return;
      }

      // Select a traitor as an enemy
      // DIVERGENCE (bestAI): src only takes this free target 1 time in 3.
      const toAttack = this.getNeighborTraitorToAttack();
      if (toAttack !== null) {
        if (await this.sendAttack(toAttack)) return;
      }

      // Choose a new enemy randomly
      const neighbors = this.player.nearby();
      for (const neighbor of this.random.shuffleArray(neighbors)) {
        if (!neighbor.isPlayer()) continue;
        if (this.player.isFriendly(neighbor)) continue;
        // DIVERGENCE (bestAI): src skips a perfectly valid nation/human neighbour
        // 50% of the time. Never skip one.
        if (await this.sendAttack(neighbor)) return;
      }
    }

    // getNeighborTraitorToAttack — AiAttackBehavior.
    getNeighborTraitorToAttack() {
      if (this.game.config().disableAlliances()) return null;

      const traitors = this.player
        .nearby()
        .filter(
          (n) =>
            n.isPlayer() && this.player.isFriendly(n) === false && n.isTraitor(),
        );
      return traitors.length > 0 ? this.random.randElement(traitors) : null;
    }

    // forceSendAttack — AiAttackBehavior (now async only by signature; nationExecution
    // awaits it. No worker calls — a land/TN attack at half troops).
    async forceSendAttack(target) {
      // src: game.addExecution(new AttackExecution(troops/2, player,
      //   target.isPlayer() ? target.id() : terraNullius().id())).
      // Client: emitIntent(ctors.attack, target.id()|null, troops).
      const ctors = discoverCtors(getEventBus());
      const troops = this.player.troops() / 2;
      const targetId = target.isPlayer() ? target.id() : null;
      if (ctors.attack && emitIntent(ctors.attack, targetId, troops)) {
        state.stats.attacks++;
        setLastAction(tr("⚔️ Attack"), "combat");
      }
    }

    // sendAttack — AiAttackBehavior (now async via sendBoatAttack/
    // sendBoatAttackToNearbyTerraNullius; sendLandAttack stays sync).
    async sendAttack(target, force = false) {
      if (!force && !this.shouldAttack(target)) return false;

      if (target.isPlayer()) {
        if (this.player.sharesBorderWith(target)) {
          return this.sendLandAttack(target);
        } else {
          return await this.sendBoatAttack(target);
        }
      } else {
        // sharesBorderWith(TerraNullius) counts water tiles as TN (ownerID 0 = TN smallID),
        // so use a land-only adjacency check to decide land vs boat attack.
        if (this.hasLandBorderWithTerraNullius()) {
          return this.sendLandAttack(target);
        } else {
          return await this.sendBoatAttackToNearbyTerraNullius();
        }
      }
    }

    // hasLandBorderWithTerraNullius — AiAttackBehavior (private).
    hasLandBorderWithTerraNullius() {
      for (const border of this.player.borderTiles()) {
        for (const neighbor of this.game.neighbors(border)) {
          if (this.game.isLand(neighbor) && !this.game.hasOwner(neighbor)) {
            return true;
          }
        }
      }
      return false;
    }

    // Scans shore border tiles (every 10th) for unowned land within 5 water tiles
    // in each cardinal direction, then sends a transport ship to the first match.
    // sendBoatAttackToNearbyTerraNullius — AiAttackBehavior (private, now async).
    //
    // DIVERGENCE (boat collect-then-probe): src calls canBuildTransportShip()
    // SYNCHRONOUSLY inside the shore scan and sends on the first match. We keep the
    // SAME shore scan (every 10th shore tile, 4 cardinal dirs, 5-step jump, same owner
    // filter; the fallout skip is now winFix-gated so we ALSO grab nuked coastal TN)
    // to COLLECT up to BOAT_PROBE_CANDIDATES target tiles IN SCAN ORDER, then `await
    // bestTransportShipSpawn` down that list and send to the FIRST reachable — same
    // target src would have picked, with bounded worker calls.
    async sendBoatAttackToNearbyTerraNullius() {
      // Honour the panel's "boat" feature toggle.
      if (!(state.settings.features && state.settings.features.boat)) return false;
      if (this.game.config().isUnitDisabled(UNIT.TransportShip)) return false;
      if (
        this.player.unitCount(UNIT.TransportShip) >=
        this.game.config().boatMaxNumber()
      )
        return false;

      const directions = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ];
      const shores = Array.from(this.player.borderTiles()).filter((t) =>
        this.game.isShore(t),
      );

      const candidates = [];
      outer: for (let i = 0; i < shores.length; i += 10) {
        const border = shores[i];

        const bx = this.game.x(border);
        const by = this.game.y(border);

        for (const [dx, dy] of directions) {
          const x1 = bx + dx;
          const y1 = by + dy;
          if (!this.game.isValidCoord(x1, y1)) continue;
          if (!this.game.isWater(this.game.ref(x1, y1))) continue;

          const nx = bx + dx * 5;
          const ny = by + dy * 5;
          if (!this.game.isValidCoord(nx, ny)) continue;
          const tile = this.game.ref(nx, ny);
          if (!this.game.isLand(tile)) continue;
          if (this.game.hasOwner(tile)) continue;
          // USER WIN-FIX: keep nuked (fallout) coastal TN as a boat target — it's empty
          // land ripe for a probe landing. Faithful mode (winFixes off) keeps the src skip.
          if (!state.settings.winFixes && this.game.hasFallout(tile)) continue;
          // DIVERGENCE: src calls canBuildTransportShip(tile) here synchronously and
          // sends on the first pass. We collect the tile (in scan order) and defer
          // the async reachability probe to keep worker calls bounded.
          candidates.push(tile);
          if (candidates.length >= BOAT_PROBE_CANDIDATES) break outer;
        }
      }

      for (const tile of candidates) {
        const spawn = await withTimeout(
          this.player.bestTransportShipSpawn(tile),
          WORKER_TIMEOUT_MS,
          false,
        );
        if (spawn === false) continue;

        // USER (winFixes): EVERY boat is a cheap 1% probe — never a 20% dump (troops/5).
        // Even grabbing empty coastal TN goes by a 1% landing. (winFixes off → faithful.)
        const troops = state.settings.winFixes
          ? Math.max(
              this.player.troops() * (state.settings.boatProbeFrac || 0.01),
              state.settings.boatProbeMinTroops || 8000,
            )
          : this.player.troops() / 5;
        if (troops < 1) return false;

        // src: game.addExecution(new TransportShipExecution(player, tile, troops)).
        const ctors = discoverCtors(getEventBus());
        if (ctors.boat && emitIntent(ctors.boat, tile, troops)) {
          state.stats.attacks++;
          setLastAction(tr("⛵ Boat (land grab)"), "naval");
        }
        return true;
      }
      return false;
    }

    // shouldAttack — AiAttackBehavior.
    shouldAttack(other) {
      if (
        // Always attack Terra Nullius, non-humans and traitors
        other.isPlayer() === false ||
        other.type() !== PlayerType.Human ||
        other.isTraitor() ||
        // Always attack if we are a bot or in an HvN game
        this.player.type() === PlayerType.Bot ||
        this.game.config().gameConfig().playerTeams === HumansVsNations
      ) {
        return true;
      }

      // Prevent attacking of humans on lower difficulties
      // src: `const { difficulty } = this.game.config().gameConfig();` → REPLICATED.
      const difficulty = currentDifficulty();
      if (difficulty === Difficulty.Easy && this.random.nextInt(0, 4) !== 0) {
        return false;
      }
      if (difficulty === Difficulty.Medium && this.random.chance(4)) {
        return false;
      }
      return true;
    }

    // sendLandAttack — AiAttackBehavior (private). SYNC: no worker calls.
    sendLandAttack(target) {
      const maxTroops = this.game.config().maxTroops(this.player);
      const botWithStructures =
        target.isPlayer() &&
        target.type() === PlayerType.Bot &&
        target.units().some((u) => AttackStructures.has(u.type()));
      // Use the expand ratio when attacking a bot that owns structures — we need to
      // recapture those structures ASAP, even before reaching the normal reserve.
      const useReserve = target.isPlayer() && !botWithStructures;
      // WIN-FIX (sizeReserve): the player/TN reserve uses the size-aware floor;
      // bot-with-structures recapture still uses the aggressive expandRatio.
      const reserveRatio = useReserve
        ? this.effectiveReserveRatio()
        : this.expandRatio;
      const targetTroops = maxTroops * reserveRatio;

      let troops;
      if (
        target.isPlayer() &&
        target.type() === PlayerType.Bot &&
        this.player.type() !== PlayerType.Bot
      ) {
        troops = this.calculateBotAttackTroops(
          target,
          this.player.troops() - targetTroops - this.botAttackTroopsSent,
        );
      } else {
        troops = this.player.troops() - targetTroops;
      }

      if (troops < 1) {
        return false;
      }

      // DIVERGENCE (inert branch — kept VERBATIM): this gates the attack emoji on
      // `this.player.type() === PlayerType.Nation`. The bot is myPlayer() with
      // type() === Human, so this never fires (same class as warshipBehavior's
      // isRichPlayer divergence). Condition kept exactly; do not rewrite to fire.
      if (target.isPlayer() && this.player.type() === PlayerType.Nation) {
        if (this.emojiBehavior === undefined) throw new Error("not initialized");
        this.emojiBehavior.maybeSendAttackEmoji(target);
      }

      // src: game.addExecution(new AttackExecution(troops, player,
      //   target.isPlayer() ? target.id() : terraNullius().id())).
      const ctors = discoverCtors(getEventBus());
      const targetId = target.isPlayer() ? target.id() : null;
      if (ctors.attack && emitIntent(ctors.attack, targetId, troops)) {
        state.stats.attacks++;
        setLastAction(tr("⚔️ Attack"), "combat");
      }
      return true;
    }

    // sendBoatAttack — AiAttackBehavior (private, now async).
    //
    // DIVERGENCE (boat probe): src computes closestTwoTiles between OUR shore tiles
    // and the TARGET's shore tiles, then `canBuildTransportShip(closest.y)` as a
    // gate and sends to `closest.y`. The client needs the target's borderTiles (an
    // async fetch) before reading them synchronously, and the canBuild check is the
    // async bestTransportShipSpawn probe. We `await game.ensureBorderTiles(target)`
    // first (cached per tick), then probe; the dst sent is still `closest.y`.
    async sendBoatAttack(target) {
      // Honour the panel's "boat" feature toggle (faithful boat attacks must obey
      // it too, not just the win-fix landings).
      if (!(state.settings.features && state.settings.features.boat)) {
        return false;
      }
      if (this.game.config().isUnitDisabled(UNIT.TransportShip)) {
        return false;
      }

      // Ensure the target's border snapshot before reading it synchronously.
      await this.game.ensureBorderTiles(target);

      const closest = closestTwoTiles(
        this.game,
        Array.from(this.player.borderTiles()).filter((t) => this.game.isShore(t)),
        Array.from(target.borderTiles()).filter((t) => this.game.isShore(t)),
      );
      if (closest === null) {
        return false;
      }

      const spawn = await withTimeout(
        this.player.bestTransportShipSpawn(closest.y),
        WORKER_TIMEOUT_MS,
        false,
      );
      if (spawn === false) {
        return false;
      }

      // USER (winFixes): EVERY boat is a cheap 1% probe — never a 20% dump (troops/5),
      // and not the bot-scaled calculateBotAttackTroops either. This means the bot now
      // HARASSES across water instead of conquering it by boat; land expansion and the
      // opportunistic 1% landings are unaffected. (winFixes off → exact faithful troops.)
      let troops;
      if (state.settings.winFixes) {
        troops = Math.max(
          this.player.troops() * (state.settings.boatProbeFrac || 0.01),
          state.settings.boatProbeMinTroops || 8000,
        );
      } else if (target.type() === PlayerType.Bot) {
        troops = this.calculateBotAttackTroops(target, this.player.troops() / 5);
      } else {
        troops = this.player.troops() / 5;
      }

      if (troops < 1) {
        return false;
      }

      // DIVERGENCE (inert branch — kept VERBATIM): emoji gated on player type Nation;
      // the bot is Human so this never fires. Condition kept exactly.
      if (target.isPlayer() && this.player.type() === PlayerType.Nation) {
        if (this.emojiBehavior === undefined) throw new Error("not initialized");
        this.emojiBehavior.maybeSendAttackEmoji(target);
      }

      // src: game.addExecution(new TransportShipExecution(player, closest.y, troops)).
      const ctors = discoverCtors(getEventBus());
      if (ctors.boat && emitIntent(ctors.boat, closest.y, troops)) {
        state.stats.attacks++;
        setLastAction(tr("⛵ Boat attack"), "naval");
      }
      return true;
    }

    // calculateBotAttackTroops — AiAttackBehavior (private).
    calculateBotAttackTroops(target, maxTroops) {
      // src: `const { difficulty } = this.game.config().gameConfig();` → REPLICATED.
      const difficulty = currentDifficulty();
      if (difficulty === Difficulty.Easy) {
        this.botAttackTroopsSent += maxTroops;
        return maxTroops;
      }
      let troops = target.troops() * 4;

      // Don't send more troops than maxTroops (Keep reserve)
      if (troops > maxTroops) {
        // If we haven't enough troops left to do a big enough bot attack, skip it
        if (maxTroops < target.troops() * 2) {
          troops = 0;
        } else {
          troops = maxTroops;
        }
      }
      this.botAttackTroopsSent += troops;
      return troops;
    }

    // donateTroops — AiAttackBehavior (private). No worker calls in src; the only
    // async-shaped read (canDonateTroops) is core-only — see DIVERGENCE below.
    // Kept sync (returns a plain boolean) — the strategy wrapper `donate` awaits it.
    donateTroops() {
      // DIAG (throttled ~5s): surface the live gate state so we can see WHY donate
      // does/doesn't fire — the usual blockers are non-Team mode or the lobby having
      // "donate troops" turned OFF (config.donateTroops() === false → game forbids it).
      try {
        const nowD = performance.now();
        if (nowD - (state._donDiagAt || 0) > 5000) {
          state._donDiagAt = nowD;
          const cfg = this.game.config();
          const mates = this.game
            .players()
            .filter(
              (p) =>
                this.player.isOnSameTeam(p) &&
                p.smallID() !== this.player.smallID() &&
                p.isAlive(),
            );
          console.log(
            "[Donate] diag: " +
              JSON.stringify({
                featureOn: !!state.settings.features.donate,
                winFixes: !!state.settings.winFixes,
                replicatedDifficulty: String(currentDifficulty()),
                gameType: String(cfg.gameConfig().gameType),
                gameMode: String(cfg.gameConfig().gameMode),
                donateAllowedByLobby: cfg.donateTroops(),
                aliveTeammates: mates.length,
                myTroops: Math.round(this.player.troops()),
              }),
          );
        }
      } catch (_e) {
        /* ignore */
      }

      // Thin UX gate (PORT-CONTRACT donate strategy note — not a strategy change).
      if (!state.settings.features.donate) return false;

      // Only donate in team games
      if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
        return false;
      }

      // PUBLIC-LOBBY UNLOCK (user request): the src AiAttackBehavior blocks donation
      // in public games "to balance HvN" — but that guard exists to stop the in-game
      // AI *Nations* from buffing the human side. Our bot plays AS the human player,
      // and public TEAM lobbies allow troop donation server-side (MapPlaylist sets
      // donateTroops = (mode === Team)). So we DROP the public block and rely on the
      // real game rule below (config().donateTroops()) plus the Team-mode gate above.
      //   Original src guard (kept for reference):
      //   if (this.game.config().gameConfig().gameType === GameType.Public) return false;

      // Check if donating troops is allowed (the REAL server-side rule — true in
      // public Team lobbies, false where the lobby disabled troop donations).
      if (this.game.config().donateTroops() === false) {
        return false;
      }

      // Don't donate if the game has a winner
      // DIVERGENCE: the client getWinner() returns null (gameApi passthrough), so
      // this guard is effectively inert client-side. Most leader logic in src is
      // tile-based, but donate's winner-guard specifically is a server-decided fact
      // we can't reconstruct faithfully; treated as "no winner yet" (null) so the
      // guard does not block donation. Kept the call for parity.
      // BUG FIX: the client getWinner() returns `undefined` (not null) when there is no
      // winner, and `undefined !== null` is TRUE — which silently blocked EVERY donation
      // (all other gates passed: Impossible/Team/allowed). Only block on a REAL winner.
      if (this.game.getWinner()) {
        console.log("[Donate] skip: game already has a winner");
        return false;
      }

      // Skip donating based on difficulty
      // src: `const { difficulty } = this.game.config().gameConfig();` → REPLICATED.
      // WIN-FIX: the proactive team-donation must fire regardless of the replicated
      // difficulty — in src "Easy nations don't donate" and Medium/Hard only donate
      // 25%/50% of the time, which silently blocked the user's donate (the bot was
      // replicating Easy). When winFixes is on we SKIP this throttle (always try, like
      // Impossible); faithful mode keeps the exact src difficulty gate.
      const difficulty = currentDifficulty();
      if (!state.settings.winFixes) {
        switch (difficulty) {
          case Difficulty.Easy:
            // Easy nations don't donate
            return false;
          case Difficulty.Medium:
            // Medium nations donate 25% of the time
            if (!this.random.chance(4)) {
              return false;
            }
            break;
          case Difficulty.Hard:
            // Hard nations donate 50% of the time
            if (!this.random.chance(2)) {
              return false;
            }
            break;
          case Difficulty.Impossible:
            // Impossible nations always try to donate
            break;
          default:
            throw new Error("unreachable difficulty: " + difficulty);
        }
      }

      // Find teammates who are currently in combat. WIN-FIX: the client often can't
      // see OTHER players' incoming/outgoing attacks (gameApi exposes them reliably
      // only for our own player), so the faithful "in combat" filter yields an empty
      // list and donate never fires. In winFix mode we drop the combat requirement and
      // donate to the weakest same-team ally (the weaker-than-us guard is applied after
      // selection), which is what the user wants for frontline team support.
      const teammates = this.game
        .players()
        .filter((p) => this.player.isOnSameTeam(p))
        .filter((p) =>
          state.settings.winFixes
            ? true
            : p.incomingAttacks().length > 0 || p.outgoingAttacks().length > 0,
        );

      if (teammates.length === 0) {
        console.log("[Donate] skip: no same-team players found");
        return false;
      }

      // Find teammate with lowest troop percentage (troops / maxTroops)
      const teammatesWithTroopPercentage = teammates
        .map((teammate) => {
          const maxTroops = this.game.config().maxTroops(teammate);
          const troopPercentage = teammate.troops() / Math.max(maxTroops, 1);
          return { teammate, troopPercentage };
        })
        .sort((a, b) => a.troopPercentage - b.troopPercentage);

      // Try to donate to teammates in order of lowest troop percentage
      // DIVERGENCE: src calls `this.player.canDonateTroops(teammate)` — a core-only
      // PlayerImpl method (not on the client PlayerView; the gameApi wrapper does not
      // expose it). canDonateTroops checks the recipient is alive, same-team and not
      // self; teammates here are already isOnSameTeam-filtered and are players from
      // game.players(), so we approximate the gate with isAlive() && not-self (the
      // remaining canDonateTroops conditions). This may let a donate through that the
      // engine would reject (the engine then no-ops the intent), but never the
      // reverse — so the strategy ORDER and target choice stay faithful.
      // USER RULE: donate to any teammate who actually NEEDS troops — i.e. is below
      // donateNeedThreshold (80%) of their max. Pick the NEEDIEST (lowest %) alive
      // non-self ally under that line. The keep-line below protects our own economy,
      // so we no longer need the old "only donate down" guard (that was blocking us
      // whenever the bot was poorer than its allies).
      const needThreshold = state.settings.winFixes
        ? (state.settings.donateNeedThreshold ?? 0.8)
        : 1.0; // faithful mode: any in-combat teammate (no threshold)
      // Pool of NEEDY allies (< needThreshold), then PRIORITISE the FRONT LINE — allies
      // in combat (being attacked OR attacking an enemy) need reinforcements most. Among
      // equal priority, the neediest (lowest troop%) first.
      const needy = teammatesWithTroopPercentage
        .filter(
          (e) =>
            e.teammate.isAlive() &&
            e.teammate.smallID() !== this.player.smallID() &&
            e.troopPercentage < needThreshold,
        )
        .map((e) => {
          let frontline = false;
          try {
            frontline =
              e.teammate.incomingAttacks().length > 0 ||
              e.teammate.outgoingAttacks().length > 0;
          } catch (_e) {
            /* client may not expose other players' attacks → treat as rear */
          }
          return { entry: e, frontline };
        });
      needy.sort((a, b) => {
        if (a.frontline !== b.frontline) return a.frontline ? -1 : 1; // frontline first
        return a.entry.troopPercentage - b.entry.troopPercentage; // then neediest
      });
      let selectedTeammate = null;
      if (needy.length > 0) {
        selectedTeammate = needy[0].entry.teammate;
        console.log(
          "[Donate] picked ally at " +
            Math.round(needy[0].entry.troopPercentage * 100) +
            "% " +
            (needy[0].frontline ? "(FRONTLINE — in combat)" : "(rear)"),
        );
      }

      if (selectedTeammate === null) {
        console.log("[Donate] skip: no teammate below the need threshold (all allies healthy)");
        return false;
      }

      // Donate only the EXCESS above a ~peak-regrowth keep line so giving troops to a
      // teammate barely dents our own generation rate. The game's growth peaks near
      // 0.42·maxTroops, so winFix mode keeps ~donateKeepFrac (45%) and donates the rest;
      // faithful mode keeps the plain reserveRatio.
      const maxTroops = this.game.config().maxTroops(this.player);
      const keepFrac = state.settings.winFixes
        ? Math.max(this.reserveRatio, state.settings.donateKeepFrac || 0.45)
        : this.reserveRatio;
      const troopsToKeep = maxTroops * keepFrac;
      const availableTroops = this.player.troops() - troopsToKeep;
      const minExcess = state.settings.winFixes
        ? maxTroops * (state.settings.donateMinExcessFrac || 0.05)
        : 1;

      if (availableTroops < minExcess) {
        console.log("[Donate] skip: not enough above the keep line", {
          troops: Math.round(this.player.troops()),
          keep: Math.round(troopsToKeep),
          needExcess: Math.round(minExcess),
        });
        return false;
      }

      // Minimum donation chunk: only donate when the amount is ≥ donateMinDonatePct ×
      // currentTroops. This batches smaller donations into bigger ones — dồn lực.
      const minDonatePct = state.settings.donateMinDonatePct || 0.2;
      const minDonateAmount = this.player.troops() * minDonatePct;
      if (availableTroops < minDonateAmount) {
        console.log("[Donate] skip: donation too small (minDonatePct)", {
          available: Math.round(availableTroops),
          minChunk: Math.round(minDonateAmount),
          pct: Math.round(minDonatePct * 100) + "%",
        });
        return false;
      }

      // src: game.addExecution(new DonateTroopsExecution(player,
      //   selectedTeammate.id(), availableTroops)).
      // Client: emitIntent(ctors.donateTroops, recipient.__src ?? recipient, troops).
      const ctors = discoverCtors(getEventBus());
      if (
        ctors.donateTroops &&
        emitIntent(
          ctors.donateTroops,
          selectedTeammate.__src ?? selectedTeammate,
          availableTroops,
        )
      ) {
        console.log(
          "[Donate] SENT",
          Math.round(availableTroops),
          "→",
          selectedTeammate.name?.() ?? selectedTeammate.smallID?.(),
        );
        setLastAction(tr("🎁 Donate troops"), "combat");
      } else {
        console.log("[Donate] emit failed", { ctor: !!ctors.donateTroops });
      }

      return true;
    }
  }
