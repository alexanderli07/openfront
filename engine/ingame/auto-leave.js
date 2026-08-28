// Auto-leave: when the game's win-modal appears, leave the match (navigate to home).
// Pairs with "keep searching" auto-join for continuous play. The win-modal exposes
// `isVisible` + `isWin` directly (it renders into light DOM, createRenderRoot returns
// this), and `isWin` is set true ONLY when the local player's team/self is the winner.
//
// Both outcomes are watched off ONE timer, gated by their own setting.
//
// What counts as a LOSS (from WinModal.tick() upstream, which is every path that shows
// this modal): being ELIMINATED - it shows the "died" modal the moment myPlayer() is no
// longer alive, while the game carries on without us, and that is the case this option
// mainly exists for - plus another team winning, another player winning, a nation
// winning, and a cancelled match. Every one of those sets or leaves `isWin` false, so
// "visible and not a win" is the whole set, and a cancelled match leaving too is right:
// the game is over either way.

  let autoLeaveOnTeamWin = false;
  let autoLeaveOnLoss = false;
  let autoLeaveTimer = null;
  let autoLeaveFired = false; // navigated already this page-load

  function checkAutoLeave() {
    if (autoLeaveFired || (!autoLeaveOnTeamWin && !autoLeaveOnLoss)) {
      return;
    }
    let modal = null;
    try {
      modal = document.querySelector("win-modal");
    } catch (_error) {
      return;
    }
    if (!modal || modal.isVisible !== true) {
      return;
    }
    // isVisible === true means the custom element has upgraded, so isWin is a real
    // boolean by now rather than undefined.
    const won = modal.isWin === true;
    if (won ? !autoLeaveOnTeamWin : !autoLeaveOnLoss) {
      return;
    }
    autoLeaveFired = true;
    try {
      // Exit to home; with "keep searching" auto-join on, the lobby page that
      // loads will resume searching for the next match.
      window.location.href = "/";
    } catch (_error) {
      // navigation is best-effort
    }
  }

  function syncAutoLeaveTimer() {
    if (autoLeaveOnTeamWin || autoLeaveOnLoss) {
      if (autoLeaveTimer === null) {
        autoLeaveTimer = window.setInterval(checkAutoLeave, 1000);
      }
    } else if (autoLeaveTimer !== null) {
      clearInterval(autoLeaveTimer);
      autoLeaveTimer = null;
    }
  }

  function setAutoLeaveOnTeamWinEnabled(enabled) {
    autoLeaveOnTeamWin = Boolean(enabled);
    syncAutoLeaveTimer();
  }

  function setAutoLeaveOnLossEnabled(enabled) {
    autoLeaveOnLoss = Boolean(enabled);
    syncAutoLeaveTimer();
  }
