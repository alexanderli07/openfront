// Auto-Bot — MirvBehavior: a faithful 1:1 port of the in-game Nation MIRV AI
// (src/core/execution/nation/NationMIRVBehavior.ts). Decides when to launch a
// MIRV — counter an inbound MIRV, deny a runaway victory, or stop a steamroll —
// and aims it at the centre of the target's territory.
//
// Faithful adaptations vs the core class (the ONLY allowed changes — see
// PORT-CONTRACT.md):
//  - DIFFICULTY: src reads the lobby Nation difficulty; the bot REPLICATES a
//    user-chosen difficulty, so every `this.game.config().gameConfig().difficulty`
//    read becomes `currentDifficulty()`.
//  - PLAYER IDENTITY: src compares players with `===`; the client wraps players
//    fresh each tick, so identity compares become `.smallID()` compares.
//  - ASYNC: the MIRV must be fired through the build menu, and the target's
//    border tiles are an async worker read, so considerMIRV()/maybeSendMIRV()
//    BECOME async (nationExecution awaits considerMIRV — NationExecution.ts).
//  - COST: src reads `unitInfo(MIRV).cost(game, player)`, but that cost fn calls
//    `game.stats().numMirvsLaunched()` which the client GameView does NOT expose.
//    We read the live MIRV price from a buildables probe instead (same value,
//    different source — DIVERGENCE noted on cost()).
//
// Loaded after portutil/gameApi (and the emoji phase, which provides the globals
// AllPlayers, EMOJI_NUKE and respondToMIRV, plus EmojiBehavior), before
// nationExecution.
//
// DIVERGENCE (forward-reference): the following are provided by the EmojiBehavior
// phase and referenced bare here exactly as src does — do NOT define them locally
// (that would collide when the emoji phase adds them as shared globals):
//   - global `AllPlayers` (the all-players emoji recipient sentinel)
//   - global `EMOJI_NUKE` (number[] of emoji ids)
//   - global function `respondToMIRV(game, random, mirvTarget)`
//   - emojiBehavior.maybeSendAttackEmoji(player) / emojiBehavior.sendEmoji(recipient, emojiList)

"use strict";

  // 30 seconds at 10 ticks/second
  const MIRV_COOLDOWN_TICKS = 300;

  class MirvBehavior {
    constructor(random, game, player, emojiBehavior) {
      this.random = random;
      this.game = game;
      this.player = player;
      this.emojiBehavior = emojiBehavior;

      // Tracks the last tick a MIRV was sent at each player, so multiple nations
      // don't pile-on the same target (especially with high starting-gold).
      // DIVERGENCE: src keeps this as a STATIC map shared across all
      // NationMIRVBehavior instances; per the port contract we keep it as
      // per-instance in-memory state — harmless here since there is a single bot.
      this.recentMirvTargets = new Map(); // PlayerID -> Tick
    }

    // ── difficulty getters (use the REPLICATED difficulty) ───────────────────
    get hesitationOdds() {
      switch (currentDifficulty()) {
        case Difficulty.Easy:
          return 2; // More likely to hesitate
        case Difficulty.Medium:
          return 4;
        case Difficulty.Hard:
          return 8;
        case Difficulty.Impossible:
          return 16; // Rarely hesitates
        default:
          return 16;
      }
    }

    get victoryDenialTeamThreshold() {
      switch (currentDifficulty()) {
        case Difficulty.Easy:
          return 0.9; // Only react right before the game ends (95%)
        case Difficulty.Medium:
          return 0.8;
        case Difficulty.Hard:
          return 0.7;
        case Difficulty.Impossible:
          return 0.6; // Reacts early
        default:
          return 0.6;
      }
    }

    get victoryDenialIndividualThreshold() {
      switch (currentDifficulty()) {
        case Difficulty.Easy:
          return 0.75; // Only react right before the game ends (80%)
        case Difficulty.Medium:
          return 0.65;
        case Difficulty.Hard:
          return 0.55;
        case Difficulty.Impossible:
          return 0.4; // Reacts early
        default:
          return 0.4;
      }
    }

    get steamrollCityGapMultiplier() {
      switch (currentDifficulty()) {
        case Difficulty.Easy:
          return 2; // Needs larger gap to trigger
        case Difficulty.Medium:
          return 1.5;
        case Difficulty.Hard:
          return 1.25;
        case Difficulty.Impossible:
          return 1.15; // Reacts to smaller gaps
        default:
          return 1.15;
      }
    }

    get steamrollMinLeaderCities() {
      switch (currentDifficulty()) {
        case Difficulty.Easy:
          return 20; // Needs more cities to trigger
        case Difficulty.Medium:
        case Difficulty.Hard:
          return 10;
        case Difficulty.Impossible:
          return 8; // Reacts early
        default:
          return 8;
      }
    }

    // ── main entry — NationMIRVBehavior.considerMIRV (now async) ──────────────
    async considerMIRV() {
      if (this.player === null) throw new Error("not initialized");
      // Both of these abandon MIRV planning, so the war chest must not outlive them:
      // mirvReserveHold() would otherwise keep withholding gold for a MIRV that cannot be
      // built (losing every silo mid-game, or starting a game before the first silo exists).
      if (this.game.config().isUnitDisabled(UNIT.MIRV)) {
        if (state.nukeReserveGold) state.nukeReserveGold = 0n;
        return false;
      }
      if (this.player.units(UNIT.MissileSilo).length === 0) {
        if (state.nukeReserveGold) state.nukeReserveGold = 0n;
        return false;
      }
      // gold is BigInt; cost() is the live MIRV price (BigInt).
      const mirvCost = await this.cost(UNIT.MIRV);

      // ── WIN-FIX (leader / pre-empt MIRV + save-up) — NOT in src ──────────────
      // The pure faithful targeting (counter-MIRV / victory-denial ≥55% /
      // steamroll) only fires when the bot is already huge; the faithful bot caps
      // ~16% and never gets there, so it never closes out. This branch lets the
      // bot, once it becomes the map leader (≥ mirvLeaderShare), proactively MIRV
      // the strongest rival (and pre-empt a rival about to afford its own MIRV),
      // funding the war-chest via state.nukeReserveGold so structureBehavior stops
      // over-building and saves. Gated by settings.winFixes.
      if (state.settings.winFixes) {
        // USER RULE: once our TEAM has effectively WON (owns ≥ teamWonShare of the map),
        // stop hoarding gold for a MIRV — release the war chest so structureBehavior
        // pours gold into ECONOMY / SAMs / defence instead of saving for an offence we
        // no longer need.
        if (this.teamHasWon()) {
          if (state.nukeReserveGold) state.nukeReserveGold = 0n;
          return false;
        }
        const wfTarget = this.selectWinFixMirvTarget(mirvCost);
        if (wfTarget && !this.wasRecentlyMirved(wfTarget)) {
          if (this.player.gold() >= mirvCost) {
            state.nukeReserveGold = 0n;
            await this.maybeSendMIRV(wfTarget);
            return true;
          }
          // Not affordable yet. USER RULE: in the EARLY game (before mirvEarlyGameTicks
          // ≈ 10 min) do NOT hoard gold for a MIRV — leave the war chest empty so the
          // bot keeps firing cheap atom/hydrogen nukes. Only past 10 min do we save up.
          const earlyTicks = state.settings.mirvEarlyGameTicks ?? 6000;
          if (this.game.ticks() >= earlyTicks) {
            state.nukeReserveGold = mirvCost;
          } else if (state.nukeReserveGold) {
            state.nukeReserveGold = 0n;
          }
          return false;
        }
        // No win-fix target → release any war chest we were holding.
        if (state.nukeReserveGold) state.nukeReserveGold = 0n;
      }

      if (this.player.gold() < mirvCost) {
        return false;
      }

      // DIVERGENCE (bestAI): src rolls a 1-in-16 chance to hesitate even on
      // Impossible, with a funded MIRV and a valid target. Never hesitate.

      const inboundMIRVSender = this.selectCounterMirvTarget();
      if (inboundMIRVSender && !this.wasRecentlyMirved(inboundMIRVSender)) {
        await this.maybeSendMIRV(inboundMIRVSender);
        return true;
      }

      const victoryDenialTarget = this.selectVictoryDenialTarget();
      if (victoryDenialTarget && !this.wasRecentlyMirved(victoryDenialTarget)) {
        await this.maybeSendMIRV(victoryDenialTarget);
        return true;
      }

      const steamrollStopTarget = this.selectSteamrollStopTarget();
      if (steamrollStopTarget && !this.wasRecentlyMirved(steamrollStopTarget)) {
        await this.maybeSendMIRV(steamrollStopTarget);
        return true;
      }

      return false;
    }

    // ── MIRV Strategy Methods ────────────────────────────────────────────────
    selectCounterMirvTarget() {
      if (this.player === null) throw new Error("not initialized");
      const attackers = this.getValidMirvTargetPlayers().filter((p) =>
        this.isInboundMIRVFrom(p),
      );
      if (attackers.length === 0) return null;
      attackers.sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
      return attackers[0];
    }

    selectVictoryDenialTarget() {
      if (this.player === null) throw new Error("not initialized");
      const totalLand = this.game.numLandTiles();
      if (totalLand === 0) return null;
      let best = null;
      for (const p of this.getValidMirvTargetPlayers()) {
        let severity = 0;
        const team = p.team();
        if (team !== null) {
          // NOTE: team is a team id, not a player — keep the `===` compare.
          const teamMembers = this.game
            .players()
            .filter((x) => x.team() === team && x.isPlayer());
          const teamTerritory = teamMembers
            .map((x) => x.numTilesOwned())
            .reduce((a, b) => a + b, 0);
          const teamShare = teamTerritory / totalLand;
          if (teamShare >= this.victoryDenialTeamThreshold) {
            // Only consider the largest team member as the target when team exceeds threshold
            let largestMember = null;
            let largestTiles = -1;
            for (const member of teamMembers) {
              const tiles = member.numTilesOwned();
              if (tiles > largestTiles) {
                largestTiles = tiles;
                largestMember = member;
              }
            }
            if (largestMember !== null && largestMember.smallID() === p.smallID()) {
              severity = teamShare;
            } else {
              severity = 0; // Skip non-largest members
            }
          }
        } else {
          const share = p.numTilesOwned() / totalLand;
          if (share >= this.victoryDenialIndividualThreshold) severity = share;
        }
        if (severity > 0) {
          if (best === null || severity > best.severity) best = { p, severity };
        }
      }
      return best ? best.p : null;
    }

    selectSteamrollStopTarget() {
      if (this.player === null) throw new Error("not initialized");
      const validTargets = this.getValidMirvTargetPlayers();

      if (validTargets.length === 0) return null;

      const allPlayers = this.game
        .players()
        .filter((p) => p.isPlayer())
        .map((p) => ({ p, cityCount: this.countCities(p) }))
        .sort((a, b) => b.cityCount - a.cityCount);

      if (allPlayers.length < 2) return null;

      const topPlayer = allPlayers[0];

      if (topPlayer.cityCount <= this.steamrollMinLeaderCities) return null;

      const secondHighest = allPlayers[1].cityCount;

      const threshold = secondHighest * this.steamrollCityGapMultiplier;

      if (topPlayer.cityCount >= threshold) {
        return validTargets.some((p) => p.smallID() === topPlayer.p.smallID())
          ? topPlayer.p
          : null;
      }

      return null;
    }

    // ── WIN-FIX target selection (NOT in src) ────────────────────────────────
    // (a) PRE-EMPT: a rival with a silo whose gold is nearing the MIRV price
    //     (≥ mirvPreemptFrac × price) and who is at least half our size — gut them
    //     before they can MIRV us, and each launch raises the global MIRV price.
    // (b) LEADER: once we own ≥ mirvLeaderShare of the map, MIRV the strongest
    //     remaining rival to break the late-game deadlock and snowball to victory.
    // teamHasWon — true in a TEAM game once our whole team owns ≥ teamWonShare of the
    // live map (numLandTiles − fallout). Used to flip the economy from "save for MIRV"
    // to "build economy / SAMs" once the win is effectively secured.
    teamHasWon() {
      if (this.player === null) return false;
      try {
        if (String(this.game.config().gameConfig().gameMode) !== "Team") {
          return false;
        }
      } catch (_e) {
        return false;
      }
      const fallout =
        typeof this.game.numTilesWithFallout === "function"
          ? this.game.numTilesWithFallout()
          : 0;
      const denom = (this.game.numLandTiles() || 0) - fallout;
      if (denom <= 0) return false;
      let teamTiles = 0;
      for (const p of this.game.players()) {
        try {
          if (p.isPlayer() && this.player.isOnSameTeam(p)) {
            teamTiles += p.numTilesOwned();
          }
        } catch (_e) {
          /* skip */
        }
      }
      // Use the GAME's REAL team-win threshold (Config.percentageTilesOwnedToWin → 95%
      // for Team, 80% FFA), exactly like WinCheckExecution.checkWinnerTeam. teamWonShare
      // overrides it ONLY if explicitly set to a number (e.g. to react a bit earlier).
      let winFrac = 0.95;
      try {
        const p = Number(this.game.config().percentageTilesOwnedToWin());
        if (Number.isFinite(p)) winFrac = p / 100;
      } catch (_e) {
        /* keep 0.95 */
      }
      if (Number.isFinite(state.settings.teamWonShare)) {
        winFrac = state.settings.teamWonShare;
      }
      return teamTiles / denom > winFrac;
    }

    selectWinFixMirvTarget(_mirvCost) {
      if (this.player === null) return null;
      const valid = this.getValidMirvTargetPlayers().filter((p) => p.isAlive());
      if (valid.length === 0) return null;

      // USER RULE: only MIRV a genuine DOMINANT leader — a nation that BOTH
      //   (1) owns > mirvTargetMinShare (35%) of the map, AND
      //   (2) ranks in the top mirvTargetTopN (1–3) by owned tiles.
      // (Pre-empt / leader-share branches removed: MIRV is reserved for crushing a
      // runaway leader, not for general nuking — small atom/hydro handle the rest.)
      const total = this.game.numLandTiles() || 1;
      const minShare = state.settings.mirvTargetMinShare ?? 0.35;
      const topN = state.settings.mirvTargetTopN ?? 3;

      // Rank ALL alive players (including us) by owned tiles → the top-N id set.
      const topSet = new Set(
        this.game
          .players()
          .filter((p) => p.isAlive())
          .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())
          .slice(0, topN)
          .map((p) => p.smallID()),
      );

      const qualifying = valid
        .filter(
          (p) =>
            topSet.has(p.smallID()) && p.numTilesOwned() / total > minShare,
        )
        .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());

      return qualifying.length > 0 ? qualifying[0] : null;
    }

    // ── MIRV Cooldown Methods ────────────────────────────────────────────────
    wasRecentlyMirved(target) {
      const lastTick = this.recentMirvTargets.get(target.id());
      if (lastTick === undefined) return false;
      return this.game.ticks() - lastTick < MIRV_COOLDOWN_TICKS;
    }

    recordMirvHit(target) {
      this.recentMirvTargets.set(target.id(), this.game.ticks());
    }

    // ── MIRV Helper Methods ──────────────────────────────────────────────────
    getValidMirvTargetPlayers() {
      if (this.player === null) throw new Error("not initialized");

      return this.game.players().filter((p) => {
        return (
          p.smallID() !== this.player.smallID() &&
          p.isPlayer() &&
          p.type() !== PlayerType.Bot &&
          !this.player.isOnSameTeam(p)
        );
      });
    }

    isInboundMIRVFrom(attacker) {
      if (this.player === null) throw new Error("not initialized");
      const enemyMirvs = attacker.units(UNIT.MIRV);
      for (const mirv of enemyMirvs) {
        const dst = mirv.targetTile();
        if (!dst) continue;
        if (!this.game.hasOwner(dst)) continue;
        const owner = this.game.owner(dst);
        if (owner && owner.isPlayer && owner.isPlayer() && owner.smallID() === this.player.smallID()) {
          return true;
        }
      }
      return false;
    }

    // ── MIRV Execution Methods (now async) ───────────────────────────────────
    async maybeSendMIRV(enemy) {
      if (this.player === null) throw new Error("not initialized");

      this.emojiBehavior.maybeSendAttackEmoji(enemy);

      const centerTile = await this.calculateTerritoryCenter(enemy);
      // src gates `if (centerTile && canBuild)` — a TRUTHY check, so TileRef 0 is
      // skipped too. Mirror that (not `=== null`) for strict 1:1 faithfulness.
      if (!centerTile) return;

      // Affordability/actuation via the buildables probe + build menu (the client
      // has no synchronous canBuild / addExecution). Find the MIRV BuildableUnit,
      // check it's buildable AND affordable (gold is BigInt — keep bigint math),
      // then fire through the build menu aimed at the territory centre.
      let buildables;
      try {
        buildables = await withTimeout(
          this.player.buildables(centerTile, [UNIT.MIRV]),
          WORKER_TIMEOUT_MS,
          null,
        );
      } catch (_e) {
        return;
      }
      const bu = Array.isArray(buildables)
        ? buildables.find((b) => b.type === UNIT.MIRV)
        : null;
      if (bu === null || bu === undefined) return;

      if (bu.canBuild !== false && this.player.gold() >= bu.cost) {
        const buildMenu = getBuildMenu();
        if (!buildMenu || typeof buildMenu.sendBuildOrUpgrade !== "function") return;
        buildMenu.sendBuildOrUpgrade(bu, centerTile);
        this.recordMirvHit(enemy);
        // WIN-FIX (NOT in src): remember this crater centre so the attack behaviour
        // pours amphibious landings into the freshly-MIRV'd (weakened) nation. We
        // reuse the centerTile the MIRV already computed — no extra worker read.
        if (state.settings.winFixes) {
          if (!Array.isArray(state.recentMirvHits)) state.recentMirvHits = [];
          state.recentMirvHits.push({
            sid: enemy.smallID(),
            tile: centerTile,
            at: this.game.ticks(),
          });
        }
        state.stats.nukes++;
        setLastAction(tr("☢️ MIRV"), "nuke");
        this.emojiBehavior.sendEmoji(AllPlayers, EMOJI_NUKE);
        respondToMIRV(this.game, this.random, enemy);
      }
    }

    countCities(p) {
      return p.unitCount(UNIT.City);
    }

    // calculateTerritoryCenter — src/core/execution/Util.ts:233, made async.
    // The src wraps portutil.calculateTerritoryCenter, which reads
    // target.borderTiles() SYNCHRONOUSLY. On the client a non-"me" player's sync
    // border snapshot is EMPTY (only `me` is cached each tick, and a behavior has
    // no way to populate the per-target cache — gameApi's ensureBorderTiles is on
    // the wrapper, not on `game`). So we fetch the target's borders via the async
    // worker accessor (`borderTilesAsync()`) and compute the bounding-box centre
    // DIRECTLY from that returned set — identical math to calculateTerritoryCenter,
    // just sourcing the tiles from the async read. (Mirrors nuke.js mirvCenter.)
    async calculateTerritoryCenter(target) {
      let tiles;
      try {
        const res = await withTimeout(
          target.borderTilesAsync(),
          WORKER_TIMEOUT_MS,
          null,
        );
        // borderTilesAsync may resolve to a Set, an array, or a {borderTiles}
        // envelope depending on the worker shape — unwrap defensively.
        tiles = res && res.borderTiles ? res.borderTiles : res;
      } catch (_e) {
        return null;
      }
      if (!tiles) return null;
      const arr = Array.from(tiles);
      if (arr.length === 0) return null;

      // Calculate bounding box center in a single pass through border tiles.
      let minX = Infinity,
        maxX = -Infinity;
      let minY = Infinity,
        maxY = -Infinity;
      for (const tile of arr) {
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const centerX = Math.floor((minX + maxX) / 2);
      const centerY = Math.floor((minY + maxY) / 2);
      const centerTile = this.game.ref(centerX, centerY);

      // Verify ownership of the center tile (src compares identity; smallID here).
      if (
        this.game.hasOwner(centerTile) &&
        this.game.ownerID(centerTile) === target.smallID()
      ) {
        return centerTile;
      }

      // Fall back to nearest border tile if center is not owned.
      let closestTile = null;
      let closestDistanceSquared = Infinity;
      for (const tile of arr) {
        const dx = this.game.x(tile) - centerX;
        const dy = this.game.y(tile) - centerY;
        const distSquared = dx * dx + dy * dy;
        if (distSquared < closestDistanceSquared) {
          closestDistanceSquared = distSquared;
          closestTile = tile;
        }
      }
      return closestTile;
    }

    // cost — src reads unitInfo(type).cost(game, player). The MIRV cost fn calls
    // game.stats().numMirvsLaunched(), which the client GameView does NOT expose.
    // DIVERGENCE: we read the live MIRV price from a buildables probe (the same
    // 25M + 15M × launched value the engine computes, just sourced client-side).
    // We probe an owned tile (the cost is global, so any owned tile returns it).
    async cost(type) {
      if (this.player === null) throw new Error("not initialized");
      const border = this.player.borderTiles();
      const tile = border && border.size > 0 ? border.values().next().value : null;
      if (tile === null || tile === undefined) return 0n;
      let buildables;
      try {
        buildables = await withTimeout(
          this.player.buildables(tile, [type]),
          WORKER_TIMEOUT_MS,
          null,
        );
      } catch (_e) {
        return 0n;
      }
      const bu = Array.isArray(buildables)
        ? buildables.find((b) => b.type === type)
        : null;
      return bu && bu.cost !== undefined && bu.cost !== null ? bu.cost : 0n;
    }
  }
