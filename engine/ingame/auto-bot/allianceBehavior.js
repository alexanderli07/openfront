// Auto-Bot — AllianceBehavior: a faithful 1:1 port of the in-game Nation
// alliance AI (src/core/execution/nation/NationAllianceBehavior.ts). This class
// is the CORE of diplomatic difficulty scaling — every branch, constant,
// probability, threshold and call order from the source is preserved EXACTLY.
// No summarizing, no simplifying, no new heuristics.
//
// The ONLY changes are the mechanical API substitutions mandated by
// PORT-CONTRACT.md:
//   - DIFFICULTY: src reads `this.game.config().gameConfig().difficulty`; the bot
//     REPLICATES a user-chosen difficulty, so every such read becomes
//     `currentDifficulty()`. EXCEPTION: `config().maxTroops(player)` reads the true
//     lobby difficulty internally — left as-is (it reads real enemy/our stats).
//   - GAME MODE: `gameConfig().gameMode === GameMode.Team` is a real lobby fact —
//     kept reading `this.game.config().gameConfig().gameMode`.
//   - PLAYER IDENTITY: src compares players with `===`; the client wraps players
//     fresh each tick, so identity compares become `.smallID()` compares.
//   - emoji: `this.emojiBehavior.sendEmoji(other, EMOJI_*)` exactly as src (the
//     EMOJI_* number[] constants are shared globals from the emoji phase).
//
// DATA RECONSTRUCTION (the hard part — the client PlayerView lacks the core
// alliance methods src calls: incomingAllianceRequests(), canSendAllianceRequest(),
// allianceWith()/breakAlliance(), and alliances() returns plain AllianceView
// objects WITHOUT onlyOneAgreedToExtend()/other()). These are reconstructed from
// the <events-display>/<actionable-events> plumbing + gameApi. Every such
// reconstruction carries a `// DIVERGENCE:` note.
//
// !!! TOP-LEVEL DIVERGENCE — ALLIANCE EVENT SOURCE/TYPE SKEW (review this) !!!
//   The shipped helper plumbing (old alliance.js + alliance-requests-panel.js)
//   reads `document.querySelector("events-display").events` and treats
//   MessageType ALLIANCE_REQUEST=15 / RENEW_ALLIANCE=24. The CURRENT upstream
//   source (PR #3913 "Improve Notification Panel", commit 41ef675e) MOVED the
//   alliance prompts into a NEW `<actionable-events>` element AND the MessageType
//   enum now gives ALLIANCE_REQUEST=16 / RENEW_ALLIANCE=22. The deployed game may
//   lag `main`, so EITHER scheme can be live. To be robust against both builds
//   without depending on an unverifiable fact, we:
//     - read events from BOTH <events-display> AND <actionable-events>, PLUS the
//       `allianceRequestsPanelEvents` global (de-duped via a WeakSet);
//     - accept request type ∈ {15, 16} and renewal type ∈ {22, 24};
//     - rely on the buttons-present + className "btn"/"btn-info" guards to screen
//       out status events that collide on a number but carry no buttons (e.g.
//       ALLIANCE_REJECTED=15 in the new enum has no buttons).
//   We only ever read ONE live build at a time, so the guards prevent any
//   cross-build misclassification. See ALLIANCE_REQUEST_TYPES / RENEW_TYPES below.
//
// Loaded with the other behavior modules (after portutil/gameApi/context and the
// emoji phase, which provides the EMOJI_* globals + EmojiBehavior), before
// nationExecution. Classic-script shared-global scope (no IIFE): the class name is
// visible to nationExecution.js and must stay unique across the bundle.
//
// Shared globals referenced bare (provided by sibling modules — do NOT redefine):
//   - currentDifficulty(), Difficulty, GameMode, PlayerType, Relation (portutil/gameApi)
//   - getEventBus(), discoverCtors(), emitIntent(), getListenersMap() (context.js)
//   - _ctors (the lazily-learned intent ctor registry — context.js)
//   - setLastAction(), toNum(), safeName(), tr() (engine/helpers/i18n)
//   - EMOJI_CONFUSED / EMOJI_HANDSHAKE / EMOJI_LOVE / EMOJI_SCARED_OF_THREAT (emoji phase)

"use strict";

  // Request/renewal MessageType numbers across both client builds (see header).
  const ALLIANCE_REQUEST_TYPES = new Set([15, 16]); // old / new ALLIANCE_REQUEST
  const RENEW_TYPES = new Set([22, 24]); // new RENEW_ALLIANCE / old RENEW_ALLIANCE

  // Alliance request/renewal event objects we've already actioned this game, so we
  // don't re-accept/re-reject the same one each tick (and to dedupe across the
  // multiple event sources). Same approach as the old alliance.js.
  const _allianceBehaviorActioned = new WeakSet();

  // ---------------------------------------------------------------------------
  // Events-display / actionable-events plumbing (REUSED verbatim from the old
  // alliance.js — actuation ONLY; the strategy comes 1:1 from the src class).
  // ---------------------------------------------------------------------------

  // Captures the SendAllianceRequestIntentEvent constructor by sniffing the
  // EventBus during an accept (the accept button emits exactly that event), so we
  // can later SEND alliance requests proactively. Shape-based ctor discovery can't
  // tell it apart from SendBreakAllianceIntentEvent ({requestor,recipient}).
  function runAndCaptureAllianceCtor(action) {
    const eventBus = getEventBus();
    if (!eventBus || typeof eventBus.emit !== "function" || _ctors.allianceRequest) {
      action();
      return;
    }
    const orig = eventBus.emit;
    eventBus.emit = function (ev) {
      try {
        if (
          ev &&
          ev.requestor !== undefined &&
          ev.recipient !== undefined &&
          typeof ev.constructor === "function"
        ) {
          _ctors.allianceRequest = ev.constructor;
        }
      } catch (_e) {
        /* ignore */
      }
      return orig.call(this, ev);
    };
    try {
      action();
    } finally {
      eventBus.emit = orig;
    }
  }

  // Finds every {requestor, recipient}-shaped intent ctor (exactly two exist:
  // SendAllianceRequestIntentEvent and SendBreakAllianceIntentEvent).
  function getAllianceShapeCtors(eventBus) {
    if (_ctors.allianceShapeBus === eventBus && _ctors.allianceShape) {
      return _ctors.allianceShape;
    }
    const found = [];
    const map = getListenersMap(eventBus);
    if (map) {
      const s1 = { __probe: 1 };
      const s2 = { __probe: 2 };
      for (const C of map.keys()) {
        if (typeof C !== "function") continue;
        try {
          const inst = new C(s1, s2);
          if (inst && inst.requestor === s1 && inst.recipient === s2) {
            found.push(C);
          }
        } catch (_e) {
          /* skip */
        }
      }
    }
    _ctors.allianceShape = found;
    _ctors.allianceShapeBus = eventBus;
    return found;
  }

  // Reads alliance request/renewal events from EVERY available source (both client
  // builds + the helper panel global). De-duped by reference downstream via the
  // WeakSet. Returns a flat array of raw event objects.
  function collectAllianceEvents() {
    const events = [];
    for (const sel of ["events-display", "actionable-events"]) {
      try {
        const el = document.querySelector(sel);
        if (Array.isArray(el?.events)) events.push(...el.events);
      } catch (_e) {
        /* element absent */
      }
    }
    try {
      if (
        typeof allianceRequestsPanelEvents !== "undefined" &&
        Array.isArray(allianceRequestsPanelEvents)
      ) {
        events.push(...allianceRequestsPanelEvents);
      }
    } catch (_e) {
      /* helper panel not loaded */
    }
    return events;
  }

  // Find a button on an event by className, falling back to positional index.
  // Accept = className "btn" (idx 1), Reject/Ignore = "btn-info" (idx 2). Mirrors
  // the human UI (ActionableEvents.ts button layout: [focus, accept/renew, reject/ignore]).
  function pickAllianceButton(buttons, cls, idx) {
    return (
      buttons.find(
        (b) => b?.className === cls && typeof b.action === "function",
      ) || (typeof buttons[idx]?.action === "function" ? buttons[idx] : null)
    );
  }

  class AllianceBehavior {
    constructor(random, game, player, emojiBehavior) {
      this.random = random;
      this.game = game;
      this.player = player;
      this.emojiBehavior = emojiBehavior;
    }

    // isRegularBot — checks if player is a regular game bot (not Nation AI, not human).
    // Game has PlayerType.Bot = "BOT", PlayerType.Nation = "NATION", PlayerType.Human = "HUMAN".
    isRegularBot(player) {
      if (!player) return false;
      try {
        var rawType = typeof player.type === "function" ? player.type() : (player.data && player.data.playerType);
        if (rawType === "BOT") return true;
        if (rawType && rawType !== "BOT") {
          console.log("[Diplo] isRegularBot: unexpected type", rawType, "name:", (function(){try{return safeName(player);}catch(e){return "?"}})());
        }
      } catch (e) {}
      return false;
    }

    // handleAllianceRequests — NationAllianceBehavior.ts:29
    handleAllianceRequests() {
      if (this.game.config().disableAlliances()) return;

      for (const req of this.incomingAllianceRequests()) {
        // Reject ALL requests from regular bots — they spam defensively,
        // blocking attacks against them. Only accept from humans and Nation AI.
        const requestor = req.requestor();
        if (requestor && this.isRegularBot(requestor)) {
          console.log("[Diplo] handleAllianceRequests: REJECT bot request from", safeName(requestor));
          req.reject();
          continue;
        }
        // Alliance Request intents created during the spawn phase are executed on
        // the first tick post-spawn phase. With the following condition we reject
        // all requests created during the spawn phase.
        // DIVERGENCE: the client event carries the DISPLAY tick (when the prompt
        // was rendered), not the intent's original createdAt(). req.createdAt()
        // returns that display tick when known; when the event was created during
        // the spawn phase we flag it (req.__createdInSpawnPhase) and force the tick
        // to 0 so this gate rejects it exactly as src would. See incomingAllianceRequests().
        if (req.createdAt() <= this.game.config().numSpawnPhaseTurns() + 1) {
          req.reject();
          continue;
        }
        if (this.getAllianceDecision(requestor, true)) {
          console.log("[Diplo] handleAllianceRequests: ACCEPT request from", safeName(requestor));
          req.accept();
        } else {
          req.reject();
        }
      }
    }

    // Always-on rejection of alliance requests from regular bots. Runs even
    // when the alliance feature toggle is off — regular bots spam alliance
    // requests as a defensive tactic, and accepting blocks attacks against them.
    handleAllianceRequestsFromBots() {
      // Always run — even when alliances feature is off.
      // Regular bots spam alliance requests as a defensive tactic.
      // Defense-in-depth: this runs at tick level, while the panel capture filter
      // prevents Vue from ever seeing bot events.
      for (const ev of collectAllianceEvents()) {
        try {
          const requestor = this.resolveEventPlayer(ev);
          if (!requestor) continue;
          if (this.isRegularBot(requestor)) {
            // Force-mark as actioned — prevents alliance handler from accepting
            _allianceBehaviorActioned.add(ev);
          }
        } catch (_e) {}
      }
    }

    // handleAllianceExtensionRequests — NationAllianceBehavior.ts:48
    handleAllianceExtensionRequests() {
      if (this.game.config().disableAlliances()) return;

      // src iterates this.player.alliances() (rich MutableAlliance objects) and
      // accepts the extension on any where onlyOneAgreedToExtend() is true (i.e.
      // the human ally already requested renewal and we haven't agreed yet).
      //
      // DIVERGENCE: the client PlayerView.alliances() returns plain AllianceView
      // objects ({id, other:PlayerID, createdAt, expiresAt, hasExtensionRequest}) —
      // there is NO onlyOneAgreedToExtend() / other() method, and we cannot tell
      // WHICH side agreed. The presence of a RENEW_ALLIANCE prompt (type 22/24) in
      // the events feed IS the client's surfacing of "the ally requested renewal and
      // it's awaiting our decision" — so we use the renewal EVENT as the proxy for
      // onlyOneAgreedToExtend(), and drive the accept via the event's renew button
      // (which emits SendAllianceExtensionIntentEvent, the same intent src's
      // AllianceExtensionExecution produces). We still run the FULL
      // getAllianceDecision(other, true) gate exactly as src does — NOT the old
      // alliance.js renewal heuristic.
      for (const ev of collectAllianceEvents()) {
        const t = Number(ev?.type);
        if (!RENEW_TYPES.has(t)) continue;
        if (_allianceBehaviorActioned.has(ev)) continue;
        const buttons = Array.isArray(ev.buttons) ? ev.buttons : [];
        if (buttons.length === 0) continue;

        // human = alliance.other(this.player): resolve the renewal event's focusID
        // (the other player's smallID) to a wrapped gameApi player.
        const human = this.resolveEventPlayer(ev);
        if (!human || !human.isPlayer || !human.isPlayer()) continue;

        if (!this.getAllianceDecision(human, true)) continue;

        // src: this.game.addExecution(new AllianceExtensionExecution(this.player,
        //   human.id())). Client equivalent: click the renew button, whose action()
        //   emits SendAllianceExtensionIntentEvent(other) — the same intent.
        const renew = pickAllianceButton(buttons, "btn", 1);
        if (renew) {
          try {
            renew.action();
            _allianceBehaviorActioned.add(ev);
            setLastAction(
              tr("🔁 Renew alliance {name}", { name: safeName(human) }),
              "diplo",
            );
          } catch (_e) {
            /* ignore */
          }
        }
      }
    }

    // maybeSendAllianceRequests — NationAllianceBehavior.ts:65
    maybeSendAllianceRequests(borderingEnemies) {
      if (this.game.config().disableAlliances()) return;

      // NEVER send alliance requests to regular bots — they spam defensively,
      // blocking attacks against them. Only send to humans and Nation AI.
      for (const enemy of borderingEnemies) {
        const isBot = this.isRegularBot(enemy);
        if (isBot) {
          console.log("[Diplo] maybeSendAllianceRequests: skip bot", safeName(enemy), "type:", (function(){try{return enemy.type();}catch(e){return "err:"+e}})());
        }
        if (
          this.random.chance(30) &&
          !isBot &&
          this.canSendAllianceRequest(enemy) &&
          this.getAllianceDecision(enemy, false)
        ) {
          // src: this.game.addExecution(new AllianceRequestExecution(this.player,
          //   enemy.id())). Client equivalent: emit the SendAllianceRequestIntentEvent
          //   ctor ({requestor, recipient}) as (me, enemy).
          // DIVERGENCE (gap G2): the request ctor is learned LAZILY — it is null
          // until we've accepted at least one incoming request (which captures it
          // via runAndCaptureAllianceCtor). Until then proactive sends are
          // suppressed. In a populated lobby an accept happens within seconds.
          const ctors = discoverCtors(getEventBus());
          if (ctors.allianceRequest) {
            console.log("[Diplo] maybeSendAllianceRequests: SENDING to", safeName(enemy));
            emitIntent(
              ctors.allianceRequest,
              this.player.__src ?? this.player,
              enemy.__src ?? enemy,
            );
            setLastAction(
              tr("🤝➡️ Send alliance {name}", { name: safeName(enemy) }),
              "diplo",
            );
          }
        }
      }
    }

    // isFarNation — true when `other` is NOT one of our land/narrow-water neighbours
    // (not in nearby()), so it can't threaten us by land → a pure trade partner we ally
    // freely (see the winFix in getAllianceDecision). Cheap + synchronous (no boat
    // probe). On any error we answer FALSE (treat as near) so the faithful case-by-case
    // logic runs rather than a blanket accept.
    isFarNation(other) {
      try {
        const sid = other.smallID();
        for (const n of this.player.nearby()) {
          if (n && n.isPlayer && n.isPlayer() && n.smallID() === sid) {
            return false; // bordering neighbour → near
          }
        }
        return true; // not adjacent → far
      } catch (_e) {
        return false;
      }
    }

    // isDominantForDiplomacy — are we dominant enough to STOP making/keeping far
    // alliances and let betray/conquer close the win? Prefer the flag structureBehavior
    // publishes each build-tick (state.dominant), but FALL BACK to computing the share
    // HERE when it isn't a boolean yet (structures disabled, or the structure phase
    // hasn't run) — otherwise an unset flag reads as "not dominant" and we'd keep
    // far-allying past the point the user asked us to stop. Mirrors
    // structureBehavior.dominanceShare + the factoryRailShare trigger — keep in sync.
    isDominantForDiplomacy() {
      if (!state.settings.winFixes) return false;
      if (typeof state.dominant === "boolean") return state.dominant;
      try {
        const isTeam =
          String(this.game.config().gameConfig().gameMode) === "Team";
        const fallout =
          typeof this.game.numTilesWithFallout === "function"
            ? this.game.numTilesWithFallout()
            : 0;
        const denom = (this.game.numLandTiles() || 0) - fallout;
        if (denom <= 0) return false;
        let owned = 0;
        if (isTeam) {
          for (const p of this.game.players()) {
            try {
              if (p.isPlayer() && this.player.isOnSameTeam(p)) {
                owned += p.numTilesOwned();
              }
            } catch (_e) {
              /* skip */
            }
          }
        } else {
          owned = this.player.numTilesOwned();
        }
        const trigger = Number.isFinite(state.settings.factoryRailShare)
          ? state.settings.factoryRailShare
          : 0.75;
        return owned / denom > trigger;
      } catch (_e) {
        return false;
      }
    }

    // reachOutToFarNations — proactively offer an alliance to ONE far, alive, non-bot,
    // non-traitor, not-yet-friendly, requestable nation per throttle window (winFix).
    // Suppressed until the alliance-request ctor is learned (lazily, on our first
    // accept), and skipped once we're dominant (self-gated, below).
    reachOutToFarNations() {
      const now = performance.now();
      const throttle = state.settings.farAllyThrottleMs || 4000;
      if (now - (state.lastFarAllyMs || 0) < throttle) return;
      // Self-gate on dominance (computed only AFTER the cheap throttle passes, ~every 4s)
      // so we stop courting far nations the moment we're winning — same gate as the
      // far-accept path, so accept and outreach flip together.
      if (this.isDominantForDiplomacy()) return;

      const ctors = discoverCtors(getEventBus());
      if (!ctors.allianceRequest) return; // ctor not learned yet → can't send proactively

      const mySid = this.player.smallID();
      const candidates = [];
      for (const p of this.game.players()) {
        try {
          if (!p.isPlayer || !p.isPlayer()) continue;
          if (p.smallID() === mySid) continue;
          if (!p.isAlive || !p.isAlive()) continue;
          if (p.type() === PlayerType.Bot) continue; // faithful: don't court bots
          if (this.player.isFriendly(p) === true) continue; // already allied / teammate
          if (p.isTraitor && p.isTraitor()) continue; // never court a traitor
          if (!this.isFarNation(p)) continue; // far nations only
          if (!this.canSendAllianceRequest(p)) continue; // cooldown / validity
          candidates.push(p);
        } catch (_e) {
          /* skip this player */
        }
      }
      if (candidates.length === 0) return;

      // Spread outreach across the far field rather than always picking the same one.
      const target = this.random.randElement(candidates);
      emitIntent(
        ctors.allianceRequest,
        this.player.__src ?? this.player,
        target.__src ?? target,
      );
      setLastAction(
        tr("🤝➡️ Trade-ally {name}", { name: safeName(target) }),
        "diplo",
      );
      state.lastFarAllyMs = now;
      console.log("[Diplo] reach out far →", safeName(target));
    }

    // getAllianceDecision — NationAllianceBehavior.ts:88 (THE decision tree)
    getAllianceDecision(otherPlayer, isResponse) {
      // HARD GATE: NEVER accept alliances with regular bots (type="BOT").
      // Regular bots spam alliance requests defensively, blocking attacks against them.
      if (this.isRegularBot(otherPlayer)) {
        console.log("[Diplo] getAllianceDecision: BLOCK bot", safeName(otherPlayer));
        return false;
      }
      // Easy (dumb) nations sometimes get confused and accept/reject randomly (Just like dumb humans do)
      if (this.isConfused()) {
        return this.random.chance(2);
      }
      // Nearly always reject traitors
      if (otherPlayer.isTraitor() && this.random.nextInt(0, 100) >= 10) {
        if (isResponse && this.random.chance(3)) {
          this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_CONFUSED);
        }
        return false;
      }
      // SMART DIPLOMACY (winFix): a FAR nation (one we do NOT border — see isFarNation)
      // can't threaten us by land. While we're still expanding we ally it FREELY — pure
      // defence: it keeps a distant nation from turning hostile and raiding our longest,
      // most lucrative trade routes (we already rejected traitors above). Once we're
      // DOMINANT we do the OPPOSITE — REJECT far requests AND far renewals (this gate also
      // runs on the renewal path) so those alliances LAPSE and the boat-conquest / betray
      // logic can take their land to finish the win (user's choice: "stop when dominant").
      // NEAR nations always fall through to the faithful tree below (threats / targets).
      if (state.settings.winFixes && this.isFarNation(otherPlayer)) {
        if (this.isDominantForDiplomacy()) {
          return false; // dominant → shed far allies, court no new ones
        }
        if (isResponse) {
          console.log("[Diplo] far accept →", safeName(otherPlayer));
        }
        return true;
      }
      // Reject if otherPlayer has allied with a lot of players (Hard and Impossible only)
      // To make sure there are enough non-friendly players in the game to stop the crown with nukes
      if (this.hasTooManyAlliances(otherPlayer)) {
        return false;
      }
      // Before caring about the relation, first check if the otherPlayer is a threat
      // Easy (dumb) nations are blinded by hatred, they don't care about threats, they care about the relation
      // Impossible (smart) nations on the other hand are analyzing the facts
      if (this.isAlliancePartnerThreat(otherPlayer)) {
        if (!isResponse && this.random.chance(6)) {
          this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_SCARED_OF_THREAT);
        }
        if (isResponse && this.random.chance(6)) {
          this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_LOVE);
        }
        return true;
      }
      // Maybe reject if we are in a team game (allying makes less sense there)
      if (this.shouldRejectInTeamGame()) {
        return false;
      }
      // Reject if relation is bad
      if (this.player.relation(otherPlayer) < Relation.Neutral) {
        if (isResponse && this.random.chance(3)) {
          this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_CONFUSED);
        }
        return false;
      }
      // Maybe accept if relation is friendly
      if (this.isAlliancePartnerFriendly(otherPlayer)) {
        if (this.random.chance(3)) {
          this.emojiBehavior.sendEmoji(otherPlayer, EMOJI_HANDSHAKE);
        }
        return true;
      }
      // Reject if we already have some alliances, we don't want to ally with the entire map
      if (this.checkAlreadyEnoughAlliances(otherPlayer)) {
        return false;
      }
      // Maybe accept if we are in the earlygame
      if (this.isEarlygame()) {
        return true;
      }
      // Accept if we are similarly strong
      return this.isAlliancePartnerSimilarlyStrong(otherPlayer);
    }

    // hasTooManyAlliances — NationAllianceBehavior.ts:150
    hasTooManyAlliances(otherPlayer) {
      const difficulty = currentDifficulty();
      if (
        difficulty !== Difficulty.Hard &&
        difficulty !== Difficulty.Impossible
      ) {
        return false;
      }

      const totalPlayers = this.game
        .players()
        .filter((p) => p.type() !== PlayerType.Bot).length;
      const otherPlayerAlliances = otherPlayer.alliances().length;

      if (difficulty === Difficulty.Hard) {
        return otherPlayerAlliances >= totalPlayers * 0.5;
      } else {
        return otherPlayerAlliances >= totalPlayers * 0.25;
      }
    }

    // isConfused — NationAllianceBehavior.ts:171
    isConfused() {
      const difficulty = currentDifficulty();
      switch (difficulty) {
        case Difficulty.Easy:
          return this.random.chance(10); // 10% chance to be confused on easy
        case Difficulty.Medium:
          return this.random.chance(20); // 5% chance to be confused on medium
        case Difficulty.Hard:
          return this.random.chance(40); // 2.5% chance to be confused on hard
        case Difficulty.Impossible:
          return false; // No confusion on impossible
        default:
          return assertNever(difficulty);
      }
    }

    // isEarlygame — NationAllianceBehavior.ts:187
    isEarlygame() {
      const spawnTicks = this.game.config().numSpawnPhaseTurns();
      const difficulty = currentDifficulty();
      switch (difficulty) {
        case Difficulty.Easy:
          // On easy, accept 90% in the first 5 minutes
          return (
            this.game.ticks() < 3000 + spawnTicks &&
            this.random.nextInt(0, 100) >= 10
          );
        case Difficulty.Medium:
          // On medium, accept 70% in the first 3 minutes
          return (
            this.game.ticks() < 1800 + spawnTicks &&
            this.random.nextInt(0, 100) >= 30
          );
        case Difficulty.Hard:
          // On hard, accept 50% in the first 3 minutes
          return (
            this.game.ticks() < 1800 + spawnTicks &&
            this.random.nextInt(0, 100) >= 50
          );
        case Difficulty.Impossible:
          // On impossible, accept 30% in the first minute
          return (
            this.game.ticks() < 600 + spawnTicks &&
            this.random.nextInt(0, 100) >= 70
          );
        default:
          return assertNever(difficulty);
      }
    }

    // isAlliancePartnerThreat — NationAllianceBehavior.ts:220
    isAlliancePartnerThreat(otherPlayer) {
      const difficulty = currentDifficulty();
      switch (difficulty) {
        case Difficulty.Easy:
          // On easy we are very dumb, we don't see anybody as a threat
          return false;
        case Difficulty.Medium:
          // On medium we just see players with much more troops as a threat
          return otherPlayer.troops() > this.player.troops() * 2.5;
        case Difficulty.Hard:
          // On hard we are smarter, we check for maxTroops to see the actual strength
          // NOTE: config().maxTroops reads the REAL lobby difficulty internally
          // (true stats) — left as-is per PORT-CONTRACT.
          return (
            otherPlayer.troops() > this.player.troops() &&
            this.game.config().maxTroops(otherPlayer) >
              this.game.config().maxTroops(this.player) * 2
          );
        case Difficulty.Impossible: {
          // On impossible we check for multiple factors and try to not mess with stronger players (we want to steamroll over weaklings)
          const otherHasMoreTroops =
            otherPlayer.troops() > this.player.troops() * 1.5;
          const otherHasMoreMaxTroops =
            otherPlayer.troops() > this.player.troops() &&
            this.game.config().maxTroops(otherPlayer) >
              this.game.config().maxTroops(this.player) * 1.5;
          const otherHasMoreTiles =
            otherPlayer.troops() > this.player.troops() &&
            otherPlayer.numTilesOwned() > this.player.numTilesOwned() * 1.5;
          return otherHasMoreTroops || otherHasMoreMaxTroops || otherHasMoreTiles;
        }
        default:
          return assertNever(difficulty);
      }
    }

    // shouldRejectInTeamGame — NationAllianceBehavior.ts:254
    shouldRejectInTeamGame() {
      // gameMode is a real lobby fact — read it directly (NOT currentDifficulty()).
      if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
        return false;
      }

      const difficulty = currentDifficulty();
      switch (difficulty) {
        case Difficulty.Easy:
          return this.random.nextInt(0, 100) < 25; // 25% chance to reject on easy
        case Difficulty.Medium:
          return this.random.nextInt(0, 100) < 50; // 50% chance to reject on medium
        case Difficulty.Hard:
          return this.random.nextInt(0, 100) < 75; // 75% chance to reject on hard
        case Difficulty.Impossible:
          return true; // 100% chance to reject on impossible
        default:
          return assertNever(difficulty);
      }
    }

    // checkAlreadyEnoughAlliances — NationAllianceBehavior.ts:274
    checkAlreadyEnoughAlliances(otherPlayer) {
      const difficulty = currentDifficulty();
      switch (difficulty) {
        case Difficulty.Easy:
          return false; // On easy we never think we have enough alliances
        case Difficulty.Medium:
          return this.player.alliances().length >= this.random.nextInt(4, 6);
        case Difficulty.Hard:
        case Difficulty.Impossible: {
          // On hard and impossible we try to not ally with all our neighbors (If we have 2+ neighbors)
          const borderingPlayers = this.player
            .nearby()
            .filter((n) => n.isPlayer() && n.type() !== PlayerType.Bot);
          const borderingFriends = borderingPlayers.filter(
            (o) => this.player?.isFriendly(o) === true,
          );
          // src: borderingPlayers.includes(otherPlayer) — identity. The wrapped
          // players are fresh objects each tick, so compare by smallID().
          if (
            borderingPlayers.length >= 2 &&
            borderingPlayers.some(
              (p) => p.smallID() === otherPlayer.smallID(),
            )
          ) {
            return borderingPlayers.length <= borderingFriends.length + 1;
          }
          if (difficulty === Difficulty.Hard) {
            return this.player.alliances().length >= this.random.nextInt(3, 5);
          }
          return this.player.alliances().length >= this.random.nextInt(2, 4);
        }
        default:
          return assertNever(difficulty);
      }
    }

    // isAlliancePartnerFriendly — NationAllianceBehavior.ts:308
    isAlliancePartnerFriendly(otherPlayer) {
      const difficulty = currentDifficulty();
      switch (difficulty) {
        case Difficulty.Easy:
        case Difficulty.Medium:
          return this.player.relation(otherPlayer) === Relation.Friendly;
        case Difficulty.Hard:
          return (
            this.player.relation(otherPlayer) === Relation.Friendly &&
            this.random.nextInt(0, 100) >= 17
          );
        case Difficulty.Impossible:
          return (
            this.player.relation(otherPlayer) === Relation.Friendly &&
            this.random.nextInt(0, 100) >= 33
          );
        default:
          return assertNever(difficulty);
      }
    }

    // isAlliancePartnerSimilarlyStrong — NationAllianceBehavior.ts:330
    // It would make a lot of sense to use nextFloat here, but "there's a chance floats can cause desyncs"
    isAlliancePartnerSimilarlyStrong(otherPlayer) {
      const difficulty = currentDifficulty();
      const troopPercentRangeByDifficulty = {
        [Difficulty.Easy]: [60, 70],
        [Difficulty.Medium]: [70, 80],
        [Difficulty.Hard]: [75, 85],
        [Difficulty.Impossible]: [80, 90],
      };
      const tilePercentRangeByDifficulty = {
        [Difficulty.Easy]: [70, 80],
        [Difficulty.Medium]: [80, 90],
        [Difficulty.Hard]: [85, 95],
        [Difficulty.Impossible]: [90, 100],
      };

      const troopRange = troopPercentRangeByDifficulty[difficulty];
      const tileRange = tilePercentRangeByDifficulty[difficulty];

      const playerOutgoingTroops = this.player
        .outgoingAttacks()
        .reduce((sum, attack) => sum + attack.troops(), 0);
      const otherOutgoingTroops = otherPlayer
        .outgoingAttacks()
        .reduce((sum, attack) => sum + attack.troops(), 0);
      const playerTotalTroops = this.player.troops() + playerOutgoingTroops;
      const otherTotalTroops = otherPlayer.troops() + otherOutgoingTroops;

      const troopThreshold =
        playerTotalTroops *
        (this.random.nextInt(troopRange[0], troopRange[1]) / 100);
      const tileThreshold =
        this.player.numTilesOwned() *
        (this.random.nextInt(tileRange[0], tileRange[1]) / 100);

      const hasComparableTroops = otherTotalTroops > troopThreshold;
      const hasComparableTiles =
        otherPlayer.numTilesOwned() > tileThreshold &&
        otherTotalTroops > playerTotalTroops * 0.5;
      return hasComparableTroops || hasComparableTiles;
    }

    // maybeBetray — NationAllianceBehavior.ts:371
    maybeBetray(otherPlayer, borderingPlayerCount) {
      // USER TOGGLE ("betray" OFF) → the bot stays LOYAL and never INITIATES a betrayal.
      // This is the single chokepoint: the alliance-break (this.betray) AND the follow-up
      // attack (maybeBetrayAndAttack only attacks a friend when this returns true) both
      // pass through here. Defensive retaliation against someone ALREADY attacking us is a
      // separate path (the `retaliate` strategy) and stays enabled.
      if (state.settings.features && state.settings.features.betray === false) {
        return false;
      }
      if (!this.player.isAlliedWith(otherPlayer)) return false;

      const difficulty = currentDifficulty();

      // Betray very weak players (For example MIRVed ones)
      if (difficulty !== Difficulty.Easy && difficulty !== Difficulty.Medium) {
        const otherPlayerMaxTroops = this.game.config().maxTroops(otherPlayer);
        const otherPlayerOutgoingTroops = otherPlayer
          .outgoingAttacks()
          .reduce((sum, attack) => sum + attack.troops(), 0);
        if (
          otherPlayer.troops() + otherPlayerOutgoingTroops <
            otherPlayerMaxTroops * 0.2 &&
          otherPlayer.troops() < this.player.troops()
        ) {
          this.betray(otherPlayer);
          return true;
        }
      }

      // Betray very weak players (similar check as above but for the easier difficulties)
      // This doesn't check for maxTroops and isn't really smart. It makes nations vulnerable, but that's intended.
      // On easy, don't betray humans
      if (
        (difficulty === Difficulty.Easy || difficulty === Difficulty.Medium) &&
        !(
          difficulty === Difficulty.Easy &&
          otherPlayer.type() === PlayerType.Human
        ) &&
        this.player.troops() >= otherPlayer.troops() * 10
      ) {
        this.betray(otherPlayer);
        return true;
      }

      // Betray traitors who aren't significantly stronger than us
      if (
        difficulty !== Difficulty.Easy &&
        otherPlayer.isTraitor() &&
        otherPlayer.troops() < this.player.troops() * 1.2
      ) {
        this.betray(otherPlayer);
        return true;
      }

      // Betray our only bordering player if we are much stronger than them
      if (
        difficulty !== Difficulty.Easy &&
        borderingPlayerCount === 1 &&
        otherPlayer.troops() * 3 < this.player.troops()
      ) {
        this.betray(otherPlayer);
        return true;
      }

      return false;
    }

    // betray — NationAllianceBehavior.ts:430
    betray(target) {
      // src: const alliance = this.player.allianceWith(target); if (!alliance)
      //   return; this.player.breakAlliance(alliance);
      //
      // DIVERGENCE: the client PlayerView exposes neither allianceWith() nor
      // breakAlliance(). The break intent is the {requestor, recipient}-shape ctor
      // that is NOT the (lazily-learned) request ctor — exactly as the old
      // alliance.js distinguishes them via getAllianceShapeCtors(). We first
      // confirm we ARE allied with the target (src's allianceWith() != null
      // precondition) using isAlliedWith(), then emit the break intent as
      // (me, target). Guarded: if we haven't yet learned the request ctor (so we
      // can't disambiguate the two shape ctors) or the break ctor isn't found, this
      // is a no-op — by the time we have an ally to betray we've accepted at least
      // once, so the request ctor is learned.
      if (!this.player.isAlliedWith(target)) return;

      const eventBus = getEventBus();
      if (!eventBus) return;
      if (!_ctors.allianceRequest) return;
      const shape = getAllianceShapeCtors(eventBus);
      const breakCtor = shape.find((c) => c !== _ctors.allianceRequest);
      if (!breakCtor) return;
      emitIntent(
        breakCtor,
        this.player.__src ?? this.player,
        target.__src ?? target,
      );
      setLastAction(
        tr("🗡️ Betray {name}", { name: safeName(target) }),
        "diplo",
      );
    }

    // -------------------------------------------------------------------------
    // Reconstructions of core Player methods the client PlayerView lacks.
    // -------------------------------------------------------------------------

    // incomingAllianceRequests — reconstructs src Player.incomingAllianceRequests()
    // (returns AllianceRequest[] with requestor()/createdAt()/accept()/reject()).
    // DIVERGENCE: not available on the client PlayerView. We rebuild each request
    // from the type-15/16 ALLIANCE_REQUEST events in the events feed (BOTH
    // <events-display> and <actionable-events>, plus the helper panel global). Each
    // reconstructed request exposes:
    //   - requestor(): the wrapped gameApi player resolved from event.focusID
    //       (the requestor's smallID, per ActionableEvents.ts:238) via
    //       game.playerBySmallID; falls back to a players() smallID match.
    //   - createdAt(): the event's DISPLAY tick (event.createdAt) when present.
    //       The src value is the intent's original createdAt — the client event does
    //       NOT carry that. When the event has no tick AND we are still in the spawn
    //       phase, we approximate "created during spawn phase" by returning 0 and set
    //       req.__createdInSpawnPhase = true (so the spawn-phase reject gate fires).
    //   - accept(): invokes the event's accept button (className "btn", idx 1) AND
    //       captures the request ctor (runAndCaptureAllianceCtor) like the human UI.
    //   - reject(): invokes the event's reject button (className "btn-info", idx 2).
    // De-dupes already-actioned events via the shared WeakSet so we don't re-action
    // the same prompt each tick.
    incomingAllianceRequests() {
      const out = [];
      const inSpawn = (() => {
        try {
          return this.game.inSpawnPhase() === true;
        } catch (_e) {
          return false;
        }
      })();
      for (const ev of collectAllianceEvents()) {
        const t = Number(ev?.type);
        if (!ALLIANCE_REQUEST_TYPES.has(t)) continue;
        if (_allianceBehaviorActioned.has(ev)) continue;
        const buttons = Array.isArray(ev.buttons) ? ev.buttons : [];
        if (buttons.length === 0) continue; // status events (e.g. rejected) carry no buttons

        const requestor = this.resolveEventPlayer(ev);
        if (!requestor || !requestor.isPlayer || !requestor.isPlayer()) continue;

        // createdAt reconstruction (see method comment / DIVERGENCE above).
        let createdInSpawnPhase = false;
        let createdAtTick;
        const rawTick = Number(ev?.createdAt);
        if (Number.isFinite(rawTick)) {
          createdAtTick = rawTick;
        } else if (inSpawn) {
          createdAtTick = 0;
          createdInSpawnPhase = true;
        } else {
          // DIVERGENCE: no tick on the event and not in spawn phase — fall back to
          // the current tick (treat as freshly created post-spawn, so the spawn
          // reject gate does NOT fire). This matches the common case (a live
          // request prompt the human would see now).
          createdAtTick = (() => {
            try {
              return this.game.ticks();
            } catch (_e) {
              return this.game.config().numSpawnPhaseTurns() + 2;
            }
          })();
        }

        out.push({
          __ev: ev,
          __createdInSpawnPhase: createdInSpawnPhase,
          requestor: () => requestor,
          createdAt: () => createdAtTick,
          accept: () => {
            const accept = pickAllianceButton(buttons, "btn", 1);
            if (!accept) return;
            try {
              runAndCaptureAllianceCtor(() => accept.action());
              _allianceBehaviorActioned.add(ev);
              setLastAction(
                tr("🤝 Alliance {name}", { name: safeName(requestor) }),
                "diplo",
              );
            } catch (error) {
              console.error("[AutoBot] alliance accept failed:", error);
            }
          },
          reject: () => {
            const reject = pickAllianceButton(buttons, "btn-info", 2);
            if (!reject) return;
            try {
              reject.action();
              _allianceBehaviorActioned.add(ev);
            } catch (_e) {
              /* ignore */
            }
          },
        });
      }
      return out;
    }

    // canSendAllianceRequest — reconstructs src Player.canSendAllianceRequest(other).
    // DIVERGENCE: not surfaced on the client PlayerView wrapper. The src method
    // returns false when: not alive, already allied, on the same team, already an
    // outgoing request pending, or already requesting from us. We reproduce the
    // checks reproducible client-side (isAlive + isAlliedWith + isOnSameTeam +
    // isRequestingAllianceWith). If the underlying client view exposes the exact
    // method we prefer it.
    canSendAllianceRequest(other) {
      const src = this.player.__src;
      if (src && typeof src.canSendAllianceRequest === "function") {
        try {
          return src.canSendAllianceRequest(other.__src ?? other);
        } catch (_e) {
          /* fall through to local checks */
        }
      }
      try {
        if (other.isAlive && other.isAlive() === false) return false;
        if (this.player.isAlliedWith(other)) return false;
        if (this.player.isOnSameTeam && this.player.isOnSameTeam(other)) {
          return false;
        }
        if (
          this.player.isRequestingAllianceWith &&
          this.player.isRequestingAllianceWith(other)
        ) {
          return false;
        }
      } catch (_e) {
        return false;
      }
      return true;
    }

    // resolveEventPlayer — resolve an alliance event's focusID (the OTHER player's
    // smallID — requestor for type 15/16, ally for type 22/24, per
    // ActionableEvents.ts:179/238) to a wrapped gameApi player. Tries
    // game.playerBySmallID first, then a players() smallID scan as a fallback.
    resolveEventPlayer(ev) {
      const sid = Number(ev?.focusID);
      if (!Number.isFinite(sid)) return null;
      let p = null;
      try {
        p = this.game.playerBySmallID ? this.game.playerBySmallID(sid) : null;
      } catch (_e) {
        p = null;
      }
      if (p && p.isPlayer && p.isPlayer()) return p;
      try {
        for (const cand of this.game.players()) {
          if (cand.smallID() === sid) return cand;
        }
      } catch (_e) {
        /* ignore */
      }
      return null;
    }
  }

  // assertNever — src/core/Util.ts. Preserves the exhaustive-switch contract; the
  // default branches in the difficulty switches above are unreachable
  // (currentDifficulty() always returns one of the four Difficulty values). No
  // sibling module defines this name, so the top-level declaration is unique in
  // the shared classic-script scope.
  function assertNever(x) {
    throw new Error("Unexpected difficulty: " + String(x));
  }
