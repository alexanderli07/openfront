// Hide ads: CSS injection that hides the game's ad containers. Runs under
// @grant none so we cannot use GM_addStyle; instead we inject a <style> tag
// directly into the page head. Toggled via the existing settings bridge.

  function setHideAdsEnabled(enabled) {
    if (!enabled) {
      document.getElementById(HIDE_ADS_STYLE_ID)?.remove();
      return;
    }
    if (document.getElementById(HIDE_ADS_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = HIDE_ADS_STYLE_ID;
    style.textContent = `
      /* Hide common ad containers in OpenFront. Selectors are intentionally
         broad to survive minor DOM reshuffles; they target the ad wrapper
         slots, not the ads themselves. */
      .ad-container,
      .adsbygoogle,
      [id^="ad-"],
      [class*=" ad-"],
      [class^="ad-"],
      iframe[src*="ads"],
      iframe[src*="doubleclick"],
      iframe[id*="google_ads"],
      div[data-ad],
      div[data-ads],
      ins.adsbygoogle {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
