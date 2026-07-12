// Enemy nuke prediction: landing markers and blast radius overlay.

  const NUKE_UNIT_TYPES = ["Atom Bomb", "Hydrogen Bomb", "MIRV Warhead"];

  function ensureNukeLandingStyles() {
    if (document.getElementById(NUKE_LANDING_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = NUKE_LANDING_STYLE_ID;
    style.textContent = `
      #${NUKE_LANDING_CONTAINER_ID} {
        position: fixed;
        inset: 0;
        z-index: 8000;
        pointer-events: none;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone {
        position: fixed;
        left: var(--nuke-x);
        top: var(--nuke-y);
        width: var(--nuke-diameter);
        height: var(--nuke-diameter);
        border: 2px dashed var(--nuke-color, rgba(248, 113, 113, 0.92));
        border-radius: 50%;
        background: var(--nuke-bg, rgba(127, 29, 29, 0.18));
        box-shadow:
          0 0 18px var(--nuke-glow, rgba(248, 113, 113, 0.36)),
          inset 0 0 24px var(--nuke-inner-glow, rgba(248, 113, 113, 0.18));
        transform: translate(-50%, -50%);
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::before,
      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        background: var(--nuke-cross-color, rgba(254, 202, 202, 0.94));
        box-shadow: 0 0 10px var(--nuke-cross-glow, rgba(248, 113, 113, 0.6));
        transform: translate(-50%, -50%);
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::before {
        width: 28px;
        height: 2px;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-zone::after {
        width: 2px;
        height: 28px;
      }

      #${NUKE_LANDING_CONTAINER_ID} .openfront-helper-nuke-label {
        position: fixed;
        left: var(--nuke-x);
        top: calc(var(--nuke-y) - var(--nuke-radius) - 10px);
        padding: 4px 8px;
        border: 1px solid var(--nuke-label-border, rgba(248, 113, 113, 0.52));
        border-radius: 8px;
        background: rgba(7, 12, 18, 0.86);
        color: var(--nuke-label-color, #fecaca);
        font: 900 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.92);
        transform: translate(-50%, -100%);
        white-space: nowrap;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureNukeLandingContainer() {
    ensureNukeLandingStyles();

    let container = document.getElementById(NUKE_LANDING_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = NUKE_LANDING_CONTAINER_ID;
      container.setAttribute("aria-hidden", "true");
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  }

  function getNukePredictionRelation(game, unit) {
    const owner = unit?.owner?.();
    const relation = getPlayerRelationToMyPlayer(game, owner);
    return relation === "enemy" || relation === "ally" ? relation : null;
  }

  function getNukePredictionColors(relation) {
    if (relation === "ally") {
      return {
        color: "rgba(74, 222, 128, 0.92)",
        bg: "rgba(20, 83, 45, 0.18)",
        glow: "rgba(74, 222, 128, 0.36)",
        innerGlow: "rgba(74, 222, 128, 0.18)",
        crossColor: "rgba(187, 247, 208, 0.94)",
        crossGlow: "rgba(74, 222, 128, 0.6)",
        labelBorder: "rgba(74, 222, 128, 0.52)",
        labelColor: "#bbf7d0",
      };
    }

    return {
      color: "rgba(248, 113, 113, 0.92)",
      bg: "rgba(127, 29, 29, 0.18)",
      glow: "rgba(248, 113, 113, 0.36)",
      innerGlow: "rgba(248, 113, 113, 0.18)",
      crossColor: "rgba(254, 202, 202, 0.94)",
      crossGlow: "rgba(248, 113, 113, 0.6)",
      labelBorder: "rgba(248, 113, 113, 0.52)",
      labelColor: "#fecaca",
    };
  }

  function getNukeLandingRadius(game, unit) {
    try {
      const magnitude = game?.config?.().nukeMagnitudes?.(unit.type());
      const radius = Number(magnitude?.outer ?? magnitude?.inner);
      if (Number.isFinite(radius) && radius > 0) {
        return radius;
      }
    } catch (_error) {
      // Fall back to the same radii used by OpenFront's nuke FX layer.
    }

    return unit?.type?.() === "Hydrogen Bomb" ? 160 : 70;
  }

  function getNukeLandingScreenRadius(transform, screenPos, worldRadius) {
    const scale = Number(transform?.scale);
    if (Number.isFinite(scale) && scale > 0) {
      return worldRadius * scale;
    }

    try {
      const reference = transform.worldToScreenCoordinates({
        x: screenPos.worldX + worldRadius,
        y: screenPos.worldY,
      });
      const dx = reference.x - screenPos.x;
      const dy = reference.y - screenPos.y;
      return Math.hypot(dx, dy);
    } catch (_error) {
      return worldRadius;
    }
  }

  function syncNukePrediction() {
    if (!nukePredictionEnabled) {
      document.getElementById(NUKE_LANDING_CONTAINER_ID)?.remove();
      nukeLandingAnimationFrame = null;
      return;
    }

    const container = ensureNukeLandingContainer();
    const context = getOpenFrontGameContext();
    if (!context?.game || !context?.transform) {
      container.replaceChildren();
      nukeLandingAnimationFrame = requestAnimationFrame(syncNukePrediction);
      return;
    }

    const landings = new Map();
    for (const unit of context.game.units(...NUKE_UNIT_TYPES)) {
      if (!unit?.isActive?.()) {
        continue;
      }

      const relation = getNukePredictionRelation(context.game, unit);
      if (!relation) {
        continue;
      }

      const targetTile = unit.targetTile?.();
      if (targetTile === undefined) {
        continue;
      }

      const worldX = context.game.x(targetTile);
      const worldY = context.game.y(targetTile);
      let screenPos = null;
      try {
        screenPos = context.transform.worldToScreenCoordinates({ x: worldX, y: worldY });
      } catch (_error) {
        screenPos = null;
      }

      if (
        !Number.isFinite(screenPos?.x) ||
        !Number.isFinite(screenPos?.y) ||
        screenPos.x < -300 ||
        screenPos.y < -300 ||
        screenPos.x > window.innerWidth + 300 ||
        screenPos.y > window.innerHeight + 300
      ) {
        continue;
      }

      const radius = Math.max(
        12,
        getNukeLandingScreenRadius(
          context.transform,
          { ...screenPos, worldX, worldY },
          getNukeLandingRadius(context.game, unit),
        ),
      );
      const landingId = `tile-${targetTile}`;
      const landing = landings.get(landingId);
      if (landing) {
        landing.count += 1;
        landing.radius = Math.max(landing.radius, radius);
        if (landing.relation !== "enemy") {
          landing.relation = relation;
        }
      } else {
        landings.set(landingId, {
          count: 1,
          radius,
          relation,
          screenPos,
        });
      }
    }

    const activeIds = new Set();
    for (const [landingId, landing] of landings) {
      activeIds.add(landingId);
      let zone = container.querySelector(
        `.openfront-helper-nuke-zone[data-nuke-id="${escapeCssIdentifier(landingId)}"]`,
      );
      if (!zone) {
        zone = document.createElement("div");
        zone.className = "openfront-helper-nuke-zone";
        zone.dataset.nukeId = landingId;
        container.appendChild(zone);
      }

      let label = container.querySelector(
        `.openfront-helper-nuke-label[data-nuke-id="${escapeCssIdentifier(landingId)}"]`,
      );
      if (!label) {
        label = document.createElement("div");
        label.className = "openfront-helper-nuke-label";
        label.dataset.nukeId = landingId;
        container.appendChild(label);
      }

      const colors = getNukePredictionColors(landing.relation);
      zone.style.setProperty("--nuke-x", `${landing.screenPos.x}px`);
      zone.style.setProperty("--nuke-y", `${landing.screenPos.y}px`);
      zone.style.setProperty("--nuke-radius", `${landing.radius}px`);
      zone.style.setProperty("--nuke-diameter", `${landing.radius * 2}px`);
      zone.style.setProperty("--nuke-color", colors.color);
      zone.style.setProperty("--nuke-bg", colors.bg);
      zone.style.setProperty("--nuke-glow", colors.glow);
      zone.style.setProperty("--nuke-inner-glow", colors.innerGlow);
      zone.style.setProperty("--nuke-cross-color", colors.crossColor);
      zone.style.setProperty("--nuke-cross-glow", colors.crossGlow);
      label.style.setProperty("--nuke-x", `${landing.screenPos.x}px`);
      label.style.setProperty("--nuke-y", `${landing.screenPos.y}px`);
      label.style.setProperty("--nuke-radius", `${landing.radius}px`);
      label.style.setProperty("--nuke-label-border", colors.labelBorder);
      label.style.setProperty("--nuke-label-color", colors.labelColor);
      const labelPrefix = landing.relation === "ally" ? "Ally nuke" : "Enemy nuke";
      label.textContent = landing.count > 1 ? `${labelPrefix} ${landing.count}x` : labelPrefix;
    }

    for (const marker of container.querySelectorAll("[data-nuke-id]")) {
      if (!activeIds.has(marker.dataset.nukeId || "")) {
        marker.remove();
      }
    }

    nukeLandingAnimationFrame = requestAnimationFrame(syncNukePrediction);
  }

  function setNukePredictionEnabled(enabled) {
    nukePredictionEnabled = Boolean(enabled);
    if (!nukePredictionEnabled) {
      if (nukeLandingAnimationFrame !== null) {
        cancelAnimationFrame(nukeLandingAnimationFrame);
      }
      nukeLandingAnimationFrame = null;
      document.getElementById(NUKE_LANDING_CONTAINER_ID)?.remove();
      return;
    }

    if (nukeLandingAnimationFrame === null) {
      syncNukePrediction();
    }
  }
