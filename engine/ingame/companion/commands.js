// Companion Bot — commands: the emoji → action table, and turning the boss's
// outgoing emoji feed into a list of commands to run.
//
// Reading is all this file does; it never sends anything. Classic-script shared
// scope, no load-time side effects (see companion/core.js header).

"use strict";

  const COMPANION_ACTION_IDS = [
    "donateAllGold",
    "donateAllTroops",
    "breakAlliance",
    "requestAlliance",
    "attackBossTarget",
    "buildFactory",
    "pause",
    "resume",
  ];

  // Defaults must be pairwise distinct — the lookup is emoji → action, so two
  // actions sharing an emoji would make one of them unreachable.
  const COMPANION_DEFAULT_BINDINGS = {
    donateAllGold: "🆘",
    donateAllTroops: "💰",
    breakAlliance: "💔",
    requestAlliance: "🤝",
    attackBossTarget: "🎯",
    buildFactory: "🏭",
    pause: "🥱",
    resume: "💪",
  };

  // Bound so a long match cannot grow the dedupe list without limit.
  const COMPANION_SEEN_LIMIT = 256;

  function companionBindings() {
    const saved = companionSettings().emojiBindings;
    if (!saved || typeof saved !== "object") {
      return Object.assign({}, COMPANION_DEFAULT_BINDINGS);
    }
    const out = Object.assign({}, COMPANION_DEFAULT_BINDINGS);
    for (const id of COMPANION_ACTION_IDS) {
      if (typeof saved[id] === "string" && saved[id] !== "") out[id] = saved[id];
    }
    return out;
  }

  // Identity of one emoji message. createdAt is the game tick the message was
  // produced on, so the same emoji sent twice yields two distinct keys while the
  // SAME message lingering in the array across ticks yields one.
  //
  // The multitab original had no dedupe at all: it re-ran the command on every
  // 2s tick for as long as the emoji stayed in the feed, and only avoided a
  // donate storm because an unrelated cooldown happened to swallow the repeats.
  function companionEmojiKey(msg) {
    return `${msg.senderID}:${msg.recipientID}:${msg.message}:${msg.createdAt}`;
  }

  // Commands the boss has issued to THIS bot since the last call.
  // Mutates `seen` (the caller owns it, normally companionState.seenEmoji).
  function companionCollectCommands(boss, mySmallID, bindings, seen) {
    const out = [];
    if (!boss || !boss.state) return out;
    const feed = boss.state.outgoingEmojis;
    if (!Array.isArray(feed) || feed.length === 0) return out;

    // emoji → actionId, so an unbound emoji costs one lookup instead of a scan.
    const byEmoji = {};
    for (const id of COMPANION_ACTION_IDS) {
      const e = bindings && bindings[id];
      if (typeof e === "string" && e !== "") byEmoji[e] = id;
    }

    for (const msg of feed) {
      if (!msg || typeof msg !== "object") continue;
      if (typeof msg.message !== "string") continue;
      // Addressed to me, or broadcast to every bot at once.
      const mine =
        msg.recipientID === "AllPlayers" || Number(msg.recipientID) === Number(mySmallID);
      if (!mine) continue;
      const actionId = byEmoji[msg.message];
      if (!actionId) continue;
      const key = companionEmojiKey(msg);
      if (seen.indexOf(key) !== -1) continue;
      seen.push(key);
      if (seen.length > COMPANION_SEEN_LIMIT) {
        seen.splice(0, seen.length - COMPANION_SEEN_LIMIT);
      }
      out.push(actionId);
    }
    return out;
  }
