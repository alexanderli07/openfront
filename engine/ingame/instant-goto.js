// Instant camera jump (USER): clicking an incoming/outgoing attack (or any
// event-panel entry) is vanilla behaviour that pans the camera to the spot —
// but TransformHandler.goTo() eases with a hard CAMERA_MAX_SPEED = 15 world-px
// cap per 16ms interval step, and every step sets `changed` so the renderer
// does a FULL redraw. Crossing half a big map is 1000+ world units ≈ 70-100
// eased steps ≈ well over a second of sustained full-redraw jank — the "lag".
//
// Fix: wrap the go-to handlers on the live TransformHandler instance so the
// camera lands in ONE redraw, via the transform's own PUBLIC override(x, y, s)
// ("hardset view position" — it also clears any in-flight ease interval).
// Handler and event field names are safe to rely on: the game bundle keeps
// property/method names (this script already calls worldToScreenCoordinates
// and transformHandler on the same objects). If anything looks unfamiliar at
// install or throws at click time, the wrapper falls back to the untouched
// vanilla handler — worst case is vanilla's slow pan, never a dead click.
//
// Centering math (inverse of screenToWorldCoordinatesFloat at the canvas
// centre, src/client/TransformHandler.ts):
//   offsetX = targetX - mapW/2 - (canvasW/2 - mapW/2) / scale
//   offsetY = targetY - mapH/2 - (canvasH/2 - mapH/2) / scale

function ofhComputeCenterOffsets(transform, game, tx, ty, scale) {
  const rect = transform.boundingRect();
  const mapW = game.width();
  const mapH = game.height();
  return {
    ox: tx - mapW / 2 - (rect.width / 2 - mapW / 2) / scale,
    oy: ty - mapH / 2 - (rect.height / 2 - mapH / 2) / scale,
  };
}

// Snap the camera so (tx, ty) sits at the screen centre. targetScale is the
// optional zoom carried by GoToPlayerEvent; otherwise the current zoom stays.
// Returns false (caller falls back to vanilla) rather than ever half-applying.
function ofhSnapCamera(transform, game, tx, ty, targetScale) {
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
  const s =
    typeof targetScale === "number" && targetScale > 0
      ? targetScale
      : Number(transform.scale);
  if (!Number.isFinite(s) || s <= 0) return false;
  const { ox, oy } = ofhComputeCenterOffsets(transform, game, tx, ty, s);
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return false;
  transform.override(ox, oy, s);
  return true;
}

// Wrap one handler method in place. getTarget(event) → {x, y, scale?} or null;
// null and any throw fall through to the vanilla handler.
function ofhWrapGoToHandler(transform, game, name, getTarget) {
  const orig = transform[name];
  if (typeof orig !== "function") return;
  transform[name] = function (event) {
    try {
      const tgt = getTarget(event);
      if (tgt && ofhSnapCamera(transform, game, tgt.x, tgt.y, tgt.scale)) {
        return;
      }
    } catch (_e) {
      /* fall through to vanilla */
    }
    return orig.call(transform, event);
  };
}

function ofhInstallInstantGoTo() {
  let context = null;
  try {
    context = getOpenFrontGameContext();
  } catch (_e) {
    return;
  }
  const transform = context && context.transform;
  const game = context && context.game;
  if (!transform || !game || transform.__ofhInstantGoTo) return;
  // Unfamiliar build (renamed internals)? Leave vanilla completely alone.
  if (
    typeof transform.override !== "function" ||
    typeof transform.boundingRect !== "function" ||
    typeof game.width !== "function" ||
    typeof game.height !== "function"
  ) {
    return;
  }
  // Mark FIRST: even a partial install must never be attempted twice.
  transform.__ofhInstantGoTo = true;

  // AttacksDisplay / EventsDisplay clicks emit GoToPlayerEvent (land attacks)
  // and GoToPositionEvent (boat attacks / positions); unit links emit
  // GoToUnitEvent; the "center on me" key emits CenterCameraEvent.
  ofhWrapGoToHandler(transform, game, "onGoToPosition", (e) => ({
    x: e.x,
    y: e.y,
  }));
  ofhWrapGoToHandler(transform, game, "onGoToPlayer", (e) => {
    const loc = e.player && e.player.nameLocation && e.player.nameLocation();
    return loc ? { x: loc.x, y: loc.y, scale: e.zoom } : null;
  });
  ofhWrapGoToHandler(transform, game, "onGoToUnit", (e) => {
    const unit = e.unit;
    const tile = unit && unit.lastTile && unit.lastTile();
    if (tile === null || tile === undefined) return null;
    return { x: game.x(tile), y: game.y(tile) };
  });
  ofhWrapGoToHandler(transform, game, "centerCamera", () => {
    const me = game.myPlayer && game.myPlayer();
    const loc = me && me.nameLocation && me.nameLocation();
    return loc ? { x: loc.x, y: loc.y } : null;
  });
}

(function initInstantGoTo() {
  // A new game constructs a new TransformHandler, so keep re-checking; the
  // context lookup is cached (getOpenFrontGameContext) and the marker makes
  // repeat calls a no-op, so this poll costs nothing measurable.
  try {
    ofhInstallInstantGoTo();
  } catch (_e) {
    /* never let install break the bundle scope */
  }
  setInterval(() => {
    try {
      ofhInstallInstantGoTo();
    } catch (_e) {
      /* keep polling */
    }
  }, 2000);
})();
