// Alliance whitelist/blacklist policy: per-player preferences stored in
// localStorage. "Favourite" players always get auto-accepted alliance requests;
// "blacklisted" players always get rejected. The policy is consulted by the
// alliance-requests-panel's auto-accept logic and by the auto-bot's alliance
// behavior (when enabled).
//
// The policy map is: { [playerSmallId]: "favourite" | "blacklist" }
// Stored under ALLIANCE_POLICY_KEY in localStorage (same storage layer as panel
// positions — no chrome.storage needed).

  const ALLIANCE_POLICY_KEY = "openfront-helper-alliance-policy";

  function loadAlliancePolicy() {
    try {
      const raw = localStorage.getItem(ALLIANCE_POLICY_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_error) {
      return {};
    }
  }

  function saveAlliancePolicy(policy) {
    try {
      localStorage.setItem(ALLIANCE_POLICY_KEY, JSON.stringify(policy));
    } catch (_error) {
      // Silent — policy is advisory.
    }
  }

  function getAlliancePolicyFor(playerSmallId) {
    if (playerSmallId == null) return null;
    const policy = loadAlliancePolicy();
    return policy[playerSmallId] || null;
  }

  function setAlliancePolicyFor(playerSmallId, value) {
    if (playerSmallId == null) return;
    const policy = loadAlliancePolicy();
    if (value === "favourite" || value === "blacklist") {
      policy[playerSmallId] = value;
    } else {
      delete policy[playerSmallId];
    }
    saveAlliancePolicy(policy);
  }

  function clearAlliancePolicyFor(playerSmallId) {
    setAlliancePolicyFor(playerSmallId, null);
  }
