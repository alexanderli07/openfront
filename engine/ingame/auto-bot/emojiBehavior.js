// Auto-Bot — emojiBehavior: a faithful 1:1 port of the in-game Nation AI emoji
// behavior (src/core/execution/nation/NationEmojiBehavior.ts). Every casual
// check, probability (chance odds), branch condition and call order is preserved
// exactly. The ONLY changes are the mechanical API substitutions mandated by
// PORT-CONTRACT.md:
//   - difficulty read → currentDifficulty()
//   - UnitType.X → UNIT.X (none used here)
//   - player identity `===` → `.smallID()` comparisons (teams/null/string kept)
//   - addExecution(new EmojiExecution(...)) → emitIntent(ctors.emoji, recipient, id)
//
// Emoji ids: the engine's EmojiExecution / SendEmojiIntentEvent take a NUMERIC id
// that is the index into `flattenedEmojiTable` (src/core/Util.ts). We copy that
// table VERBATIM and replicate the exact `emojiId = e => flattenedEmojiTable
// .indexOf(e)` lookup + the `EMOJI_*` constant definitions verbatim from
// NationEmojiBehavior.ts, so every number comes out identical to the engine by
// construction. AllPlayers is the string sentinel "AllPlayers" (Game.ts:42); the
// client intent (Transport.ts:514) passes it through verbatim for broadcasts.
//
// Loaded with the other behavior modules, before nationExecution.
// Classic-script shared-global scope (no IIFE): top-level names (the EMOJI_*
// consts, the EmojiBehavior class, respondToEmoji/respondToMIRV) are visible to
// the sibling behavior modules and must stay unique across the bundle.

"use strict";

  // ===========================================================================
  // Emoji table — src/core/Util.ts:366-381 (copied VERBATIM; the entries carry
  // variation selectors U+FE0F and a ZWJ sequence — do not alter them).
  // ===========================================================================
  const emojiTable = [
    ["😀", "😊", "🥰", "😇", "😎"],
    ["😞", "🥺", "😭", "😱", "😡"],
    ["😈", "🤡", "🥱", "🫡", "🖕"],
    ["👋", "👏", "✋", "🙏", "💪"],
    ["👍", "👎", "🫴", "🤌", "🤦‍♂️"],
    ["🤝", "🆘", "🕊️", "🏳️", "⏳"],
    ["🔥", "💥", "💀", "☢️", "⚠️"],
    ["↖️", "⬆️", "↗️", "👑", "🥇"],
    ["⬅️", "🎯", "➡️", "🥈", "🥉"],
    ["↙️", "⬇️", "↘️", "❤️", "💔"],
    ["💰", "⚓", "⛵", "🏡", "🛡️"],
    ["🏭", "🚂", "❓", "🐔", "🐀"],
  ];
  // 2d to 1d array — src/core/Util.ts:381
  const flattenedEmojiTable = emojiTable.flat();

  // emojiId — src/core/execution/nation/NationEmojiBehavior.ts:15
  const emojiId = (e) => flattenedEmojiTable.indexOf(e);

  // EMOJI_* constants — NationEmojiBehavior.ts:17-45 (verbatim; `export const`
  // dropped, TS `as const`/type annotations dropped — the values are unchanged).
  const EMOJI_ASSIST_ACCEPT = ["👍", "🤝", "🎯"].map(emojiId);
  const EMOJI_ASSIST_RELATION_TOO_LOW = ["🥱", "🤦‍♂️"].map(emojiId);
  const EMOJI_ASSIST_TARGET_ME = ["🥺", "💀"].map(emojiId);
  const EMOJI_ASSIST_TARGET_ALLY = ["🕊️", "👎"].map(emojiId);
  const EMOJI_AGGRESSIVE_ATTACK = ["😈"].map(emojiId);
  const EMOJI_ATTACK = ["😡"].map(emojiId);
  const EMOJI_WARSHIP_RETALIATION = ["⛵"].map(emojiId);
  const EMOJI_NUKE = ["☢️", "💥"].map(emojiId);
  const EMOJI_GOT_INSULTED = ["🖕", "😡", "🤡", "😞", "😭"].map(emojiId);
  const EMOJI_LOVE = ["❤️", "😊", "🥰"].map(emojiId);
  const EMOJI_CONFUSED = ["❓", "🤡"].map(emojiId);
  const EMOJI_BRAG = ["👑", "🥇", "💪"].map(emojiId);
  const EMOJI_CHARM_ALLIES = ["🤝", "😇", "💪"].map(emojiId);
  const EMOJI_CLOWN = ["🤡", "🤦‍♂️"].map(emojiId);
  const EMOJI_RAT = ["🐀"].map(emojiId);
  const EMOJI_OVERWHELMED = ["💀", "🆘", "😱", "🥺", "😭", "😞", "🫡", "👋"].map(
    emojiId,
  );
  const EMOJI_CONGRATULATE = ["👏"].map(emojiId);
  const EMOJI_SCARED_OF_THREAT = ["🙏", "🥺"].map(emojiId);
  const EMOJI_BORED = ["🥱"].map(emojiId);
  const EMOJI_HANDSHAKE = ["🤝"].map(emojiId);
  const EMOJI_DONATION_OK = ["👍"].map(emojiId);
  const EMOJI_DONATION_TOO_SMALL = ["❓", "🥱"].map(emojiId);
  const EMOJI_GREET = ["👋"].map(emojiId);

  // AllPlayers — src/core/game/Game.ts:42 (`export const AllPlayers = "AllPlayers"`).
  // The recipient sentinel for broadcast emojis; the client emoji intent
  // (Transport.ts:514) forwards it verbatim when recipient === AllPlayers.
  const AllPlayers = "AllPlayers";

  class EmojiBehavior {
    constructor(random, game, player) {
      this.random = random;
      this.game = game;
      this.player = player;
      // src: `new Map<Player, Tick>()` keyed by player identity. We key by
      // smallID() (PORT-CONTRACT — owner/player identity is by smallID).
      this.lastEmojiSent = new Map();
      this.gameOver = false;
    }

    maybeSendCasualEmoji() {
      if (this.gameOver) return;

      this.checkOverwhelmedByAttacks();
      this.checkVerySmallAttack();
      this.congratulateWinner();
      this.brag();
      this.charmAllies();
      this.annoyTraitors();
      this.findRat();
      this.greetNearbyPlayers();
    }

    checkOverwhelmedByAttacks() {
      if (!this.random.chance(16)) return;

      const incomingAttacks = this.player.incomingAttacks();
      if (incomingAttacks.length === 0) return;

      const incomingTroops = incomingAttacks.reduce(
        (sum, attack) => sum + attack.troops(),
        0,
      );
      const ourTroops = this.player.troops();

      // If incoming troops are at least 3x our troops, we're overwhelmed
      if (incomingTroops >= ourTroops * 3) {
        this.sendEmoji(AllPlayers, EMOJI_OVERWHELMED);
      }
    }

    checkVerySmallAttack() {
      if (!this.random.chance(8)) return;

      const incomingAttacks = this.player.incomingAttacks();
      if (incomingAttacks.length === 0) return;

      const ourTroops = this.player.troops();
      if (ourTroops <= 0) return;

      // Find attacks from humans that are very small (less than 10% of our troops)
      for (const attack of incomingAttacks) {
        const attacker = attack.attacker();
        if (attacker.type() !== PlayerType.Human) continue;

        if (attack.troops() < ourTroops * 0.1) {
          this.maybeSendEmoji(
            attacker,
            this.random.chance(2) ? EMOJI_CONFUSED : EMOJI_BORED,
          );
        }
      }
    }

    // Check if game is over - send congratulations
    // DIVERGENCE: the client GameView exposes no getWinner() (only GameImpl does),
    // so gameApi.getWinner() returns null on the client and this method is
    // effectively dead — the bot never observes a winner client-side. The logic is
    // ported faithfully so it behaves identically IF a winner is ever surfaced.
    congratulateWinner() {
      const winner = this.game.getWinner();
      if (winner === null) return;

      this.gameOver = true;

      const isTeamGame =
        this.game.config().gameConfig().gameMode === GameMode.Team;

      if (isTeamGame) {
        // Team game: all nations congratulate if another team won
        // Don't congratulate if it's our own team
        // (winner is a Team string here; player.team() is also a string — keep ===)
        if (winner === this.player.team()) return;

        this.sendEmoji(AllPlayers, EMOJI_CONGRATULATE);
      } else {
        // FFA game: The largest nation congratulates if a human player won
        if (typeof winner === "string") return; // It's a team, not a player

        // Only the largest nation sends the congratulation
        const largestNation = this.game
          .players()
          .filter((p) => p.type() === PlayerType.Nation)
          .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];
        // src: `largestNation !== this.player` (player identity). We compare by
        // smallID() and null-guard (filter→[0] may be undefined; src's !== tolerated
        // undefined, .smallID() would throw).
        if (
          !largestNation ||
          largestNation.smallID() !== this.player.smallID()
        )
          return;

        this.sendEmoji(winner, EMOJI_CONGRATULATE);
      }
    }

    // Brag with our crown
    brag() {
      if (!this.random.chance(300)) return;

      const sorted = this.game
        .players()
        .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());

      // src: `sorted[0] !== this.player` (player identity) → smallID compare.
      if (
        sorted.length === 0 ||
        sorted[0].smallID() !== this.player.smallID()
      )
        return;

      this.sendEmoji(AllPlayers, EMOJI_BRAG);
    }

    charmAllies() {
      if (!this.random.chance(250)) return;

      const humanAllies = this.player
        .allies()
        .filter((p) => p.type() === PlayerType.Human);
      if (humanAllies.length === 0) return;

      const ally = this.random.randElement(humanAllies);
      const emojiList = this.random.chance(3) ? EMOJI_LOVE : EMOJI_CHARM_ALLIES;
      this.sendEmoji(ally, emojiList);
    }

    annoyTraitors() {
      if (!this.random.chance(40)) return;

      const traitors = this.game
        .players()
        .filter(
          (p) =>
            p.type() === PlayerType.Human &&
            !p.isFriendly(this.player) &&
            p.isTraitor(),
        );

      if (traitors.length === 0) return;

      const traitor = this.random.randElement(traitors);
      this.sendEmoji(traitor, EMOJI_CLOWN);
    }

    findRat() {
      if (this.game.ticks() < 6000) return; // Ignore first 10 minutes (everybody is small in the early game)
      if (!this.random.chance(10000)) return;

      const totalLand = this.game.numLandTiles();
      const threshold = totalLand * 0.01; // 1% of land

      const smallPlayers = this.game
        .players()
        .filter(
          (p) =>
            p.type() === PlayerType.Human &&
            p.numTilesOwned() < threshold &&
            p.numTilesOwned() > 0,
        );

      if (smallPlayers.length === 0) return;

      const smallPlayer = this.random.randElement(smallPlayers);
      this.sendEmoji(smallPlayer, EMOJI_RAT);
    }

    greetNearbyPlayers() {
      if (this.game.ticks() > 600) return; // Only in the first minute
      if (!this.random.chance(250)) return;

      const nearbyHumans = this.player
        .nearby()
        .filter((p) => p.isPlayer() && p.type() === PlayerType.Human);

      if (nearbyHumans.length === 0) return;

      const neighbor = this.random.randElement(nearbyHumans);
      this.sendEmoji(neighbor, EMOJI_GREET);
    }

    maybeSendEmoji(otherPlayer, emojisList) {
      if (!this.shouldSendEmoji(otherPlayer)) return;

      return this.sendEmoji(otherPlayer, emojisList);
    }

    maybeSendAttackEmoji(otherPlayer) {
      if (!this.shouldSendEmoji(otherPlayer)) return;

      // If we have a good relation to the other player, we are probably attacking first (aggressive)
      if (this.player.relation(otherPlayer) >= Relation.Neutral) {
        if (!this.random.chance(2)) return;
        this.sendEmoji(otherPlayer, EMOJI_AGGRESSIVE_ATTACK);
        return;
      }

      // We are probably retaliating
      if (!this.random.chance(4)) return;
      this.sendEmoji(otherPlayer, EMOJI_ATTACK);
    }

    sendEmoji(otherPlayer, emojisList) {
      if (!this.shouldSendEmoji(otherPlayer, false)) return;
      if (!this.canSendEmoji(otherPlayer)) return;

      // src: this.game.addExecution(new EmojiExecution(this.player,
      //   otherPlayer === AllPlayers ? AllPlayers : otherPlayer.id(),
      //   this.random.randElement(emojisList)))
      // The client emoji intent (SendEmojiIntentEvent) has NO sender — it always
      // emits as the local player (the bot). Recipient is the AllPlayers sentinel
      // for broadcasts, else the recipient PlayerView (other.__src ?? other).
      const ctors = discoverCtors(getEventBus());
      if (!ctors.emoji) return;
      const recipient =
        otherPlayer === AllPlayers
          ? AllPlayers
          : otherPlayer.__src ?? otherPlayer;
      const emojiNumber = this.random.randElement(emojisList);

      // DIVERGENCE (botEmojis, USER: "can we just disable that entirely"). The single
      // choke point for every automatic emoji in the port - the traitor clown, the rat,
      // the greet, the brag, the congratulate, the attack pair, the ally-assist replies
      // and the nuke/warship broadcasts all arrive here.
      //
      // The gate is placed AFTER randElement deliberately: this setting must not skip a
      // draw. Every behaviour shares ONE PseudoRandom (nationExecution hands the same
      // instance to all of them), so a skipped draw would shift unrelated decisions -
      // which nuke gets picked, which boat target, whether an alliance roll passes. With
      // the gate here only the outbound intent disappears. (The pre-existing
      // `if (!ctors.emoji) return;` above CAN skip the draw, but only when the intent
      // constructor was never discovered, in which case nothing was going to send anyway.) Emojis carry no game effect (they change no relation, alliance
      // or troop count), so nothing strategic is lost either.
      //
      // The SOS is NOT affected: it is a separate emitter in quick-panel.js.
      if (!state.settings.botEmojis) return;

      emitIntent(ctors.emoji, recipient, emojiNumber);
      setLastAction(tr("💬 Emoji"), "diplo");
    }

    // canSendEmoji — src Player.canSendEmoji(recipient). Not surfaced on the gameApi
    // wrapper; try the underlying client view's method if present, else allow
    // (the client also enforces this server-side when the intent is processed).
    // DIVERGENCE: if __src.canSendEmoji is absent we cannot reproduce the exact
    // pre-check, so we proceed (the engine still validates on receipt).
    canSendEmoji(otherPlayer) {
      const src = this.player.__src;
      if (src && typeof src.canSendEmoji === "function") {
        const recipient =
          otherPlayer === AllPlayers
            ? AllPlayers
            : otherPlayer.__src ?? otherPlayer;
        try {
          return src.canSendEmoji(recipient);
        } catch (_e) {
          return true;
        }
      }
      return true;
    }

    shouldSendEmoji(otherPlayer, limitEmojisByTime = true) {
      if (otherPlayer === AllPlayers) return true;
      if (this.player.type() === PlayerType.Bot) return false;
      if (otherPlayer.type() !== PlayerType.Human) return false;

      if (limitEmojisByTime) {
        // src keys lastEmojiSent by Player identity; we key by smallID().
        const key = otherPlayer.smallID();
        const lastSent = this.lastEmojiSent.get(key) ?? -300;
        if (this.game.ticks() - lastSent <= 300) return false;
        this.lastEmojiSent.set(key, this.game.ticks());
      }

      return true;
    }
  }

  // ===========================================================================
  // Standalone emoji-response functions — NationEmojiBehavior.ts:279-344.
  // These make a DIFFERENT player (the emoji recipient / MIRV victim) emote in
  // response. The client emoji intent has no sender and always emits as the
  // local player (the bot), so the bot cannot emote AS another player. Ported
  // faithfully for call-order/RNG parity, but the emit itself is a no-op.
  // ===========================================================================

  // respondToEmoji — NationEmojiBehavior.ts:279
  // DIVERGENCE: requires the recipient (a Nation) to emote back at the sender. The
  // client cannot emit as a player other than the bot, and the orchestrator has no
  // incoming-emoji sensor to drive this. The relation overlay update (subjective,
  // no intent) IS reproducible and is applied; the responding emit is a no-op.
  function respondToEmoji(game, random, sender, recipient, emojiString) {
    if (recipient === AllPlayers || recipient.type() !== PlayerType.Nation) {
      return;
    }
    if (!recipientCanSendEmoji(recipient, sender)) return;

    if (emojiString === "🖕") {
      recipient.updateRelation(sender, -100);
      // DIVERGENCE: emit as `recipient` — not reproducible client-side (no sender field).
      random.randElement(EMOJI_GOT_INSULTED);
    }

    if (emojiString === "🤡") {
      recipient.updateRelation(sender, -10);
      // DIVERGENCE: emit as `recipient` — not reproducible client-side.
      random.randElement(EMOJI_CONFUSED);
    }

    if (["🕊️", "🏳️", "❤️", "🥰", "👏"].includes(emojiString)) {
      // src: game.config().gameConfig().difficulty === Difficulty.Easy → currentDifficulty()
      if (currentDifficulty() === Difficulty.Easy) {
        recipient.updateRelation(sender, 15);
      }
      // DIVERGENCE: emit as `recipient` — not reproducible client-side. RNG draw
      // preserved for parity.
      sender.relation(recipient) >= Relation.Neutral
        ? random.randElement(EMOJI_LOVE)
        : random.randElement(EMOJI_CONFUSED);
    }
  }

  // respondToMIRV — NationEmojiBehavior.ts:329
  // DIVERGENCE: makes the MIRV VICTIM (`mirvTarget`) broadcast OVERWHELMED. Called
  // from the launcher path (the bot is the launcher), and the client cannot emit
  // as a different player — emitting as the bot would broadcast OVERWHELMED while
  // the bot is the attacker (backwards). The chance(8) draw + canSendEmoji guard
  // are preserved for call-order/RNG parity; the emit is a no-op.
  function respondToMIRV(game, random, mirvTarget) {
    if (!random.chance(8)) return;
    if (!recipientCanSendEmoji(mirvTarget, AllPlayers)) return;

    // DIVERGENCE: cannot emit as `mirvTarget` (no sender field on the client intent).
    random.randElement(EMOJI_OVERWHELMED);
  }

  // Helper for the standalone fns: src calls player.canSendEmoji(other) on an
  // arbitrary player. Mirror canSendEmoji() above without an EmojiBehavior instance.
  function recipientCanSendEmoji(player, otherPlayer) {
    const src = player && player.__src;
    if (src && typeof src.canSendEmoji === "function") {
      const recipient =
        otherPlayer === AllPlayers
          ? AllPlayers
          : (otherPlayer && otherPlayer.__src) || otherPlayer;
      try {
        return src.canSendEmoji(recipient);
      } catch (_e) {
        return true;
      }
    }
    return true;
  }
