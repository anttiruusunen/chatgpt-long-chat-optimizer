import { state } from "../core/state.js";
import { getConversationScrollContainer } from "../core/dom.js";
import { debugLog } from "../core/logger.js";

const EDGE_EPSILON = 2;
const WHEEL_TRIGGER_DISTANCE = 140;
const KEY_TRIGGER_STEPS = 2;

function isPageScrollContainer(container) {
    return (
        container === document.scrollingElement ||
        container === document.documentElement ||
        container === document.body
    );
}

function getScrollEventTarget(container) {
    return isPageScrollContainer(container) ? window : container;
}

function getScrollTopForContainer(container) {
    if (!container) {
        return 0;
    }

    if (isPageScrollContainer(container)) {
        return (
            window.scrollY ||
            document.scrollingElement?.scrollTop ||
            document.documentElement?.scrollTop ||
            0
        );
    }

    return Number(container.scrollTop) || 0;
}

function getScrollMetrics(container) {
    if (!container) {
        return { top: 0, clientHeight: 0, scrollHeight: 0 };
    }

    if (isPageScrollContainer(container)) {
        const root =
            document.scrollingElement ||
            document.documentElement ||
            document.body;

        return {
            top: getScrollTopForContainer(container),
            clientHeight: window.innerHeight || root.clientHeight || 0,
            scrollHeight: root.scrollHeight || 0,
        };
    }

    return {
        top: Number(container.scrollTop) || 0,
        clientHeight: Number(container.clientHeight) || 0,
        scrollHeight: Number(container.scrollHeight) || 0,
    };
}

function isAtTopEdge(container) {
    return getScrollMetrics(container).top <= EDGE_EPSILON;
}

function isAtBottomEdge(container) {
    const { top, clientHeight, scrollHeight } = getScrollMetrics(container);

    return top + clientHeight >= scrollHeight - EDGE_EPSILON;
}

function ensureIntentState() {
    if (typeof state.topRestoreUserArmed !== "boolean") {
        state.topRestoreUserArmed = false;
    }

    if (typeof state.bottomPruneUserArmed !== "boolean") {
        state.bottomPruneUserArmed = false;
    }

    if (typeof state.topEdgeWheelAccum !== "number") {
        state.topEdgeWheelAccum = 0;
    }

    if (typeof state.bottomEdgeWheelAccum !== "number") {
        state.bottomEdgeWheelAccum = 0;
    }

    if (typeof state.topEdgeKeyAccum !== "number") {
        state.topEdgeKeyAccum = 0;
    }

    if (typeof state.bottomEdgeKeyAccum !== "number") {
        state.bottomEdgeKeyAccum = 0;
    }
}

function resetTopEdgeAccum() {
    state.topEdgeWheelAccum = 0;
    state.topEdgeKeyAccum = 0;
}

function resetBottomEdgeAccum() {
    state.bottomEdgeWheelAccum = 0;
    state.bottomEdgeKeyAccum = 0;
}

function clearScrollIntent() {
    ensureIntentState();

    state.topRestoreUserArmed = false;
    state.bottomPruneUserArmed = false;

    resetTopEdgeAccum();
    resetBottomEdgeAccum();
}

export function consumeTopRestoreIntent() {
    ensureIntentState();

    if (!state.topRestoreUserArmed) {
        return false;
    }

    state.topRestoreUserArmed = false;
    state.bottomPruneUserArmed = false;

    resetTopEdgeAccum();
    resetBottomEdgeAccum();

    return true;
}

export function consumeBottomPruneIntent() {
    ensureIntentState();

    if (!state.bottomPruneUserArmed) {
        return false;
    }

    state.bottomPruneUserArmed = false;
    state.topRestoreUserArmed = false;

    resetTopEdgeAccum();
    resetBottomEdgeAccum();

    return true;
}

/**
 * Scroll intent is deliberately separate from sentinel visibility.
 *
 * A sentinel entering the viewport only performs work after the user has also
 * expressed edge intent by pushing past the top/bottom with wheel or keyboard.
 */
function armTopRestoreIntent(reason) {
    state.topRestoreUserArmed = true;
    state.bottomPruneUserArmed = false;

    resetBottomEdgeAccum();

    debugLog("Scroll intent: armed top restore", {
        reason,
        wheelAccum: state.topEdgeWheelAccum,
        keyAccum: state.topEdgeKeyAccum,
    });

    window.dispatchEvent(new CustomEvent("thread-optimizer-top-edge-intent"));
}

function armBottomPruneIntent(reason) {
    state.bottomPruneUserArmed = true;
    state.topRestoreUserArmed = false;

    resetTopEdgeAccum();

    debugLog("Scroll intent: armed bottom reprune", {
        reason,
        wheelAccum: state.bottomEdgeWheelAccum,
        keyAccum: state.bottomEdgeKeyAccum,
    });

    window.dispatchEvent(new CustomEvent("thread-optimizer-bottom-edge-intent"));
}

function handleScroll() {
    const container = state.scrollIntentContainer;

    if (!container || state.isApplyingDomChanges) {
        return;
    }

    ensureIntentState();

    state.scrollIntentLastTop = getScrollTopForContainer(container);

    if (!isAtTopEdge(container)) {
        resetTopEdgeAccum();
    }

    if (!isAtBottomEdge(container)) {
        resetBottomEdgeAccum();
    }
}

function handleWheel(event) {
    const container = state.scrollIntentContainer;

    if (!container || state.isApplyingDomChanges) {
        return;
    }

    ensureIntentState();

    if (event.deltaY < 0) {
        if (!isAtTopEdge(container)) {
            resetTopEdgeAccum();
            return;
        }

        state.topEdgeWheelAccum += Math.abs(event.deltaY);

        if (state.topEdgeWheelAccum >= WHEEL_TRIGGER_DISTANCE) {
            armTopRestoreIntent("wheel-up-at-top-edge-threshold");
        }

        return;
    }

    if (event.deltaY > 0) {
        if (!isAtBottomEdge(container)) {
            resetBottomEdgeAccum();
            return;
        }

        state.bottomEdgeWheelAccum += Math.abs(event.deltaY);

        if (state.bottomEdgeWheelAccum >= WHEEL_TRIGGER_DISTANCE) {
            armBottomPruneIntent("wheel-down-at-bottom-edge-threshold");
        }
    }
}

function isTopIntentKey(key) {
    return key === "ArrowUp" || key === "PageUp" || key === "Home";
}

function isBottomIntentKey(key) {
    return (
        key === "ArrowDown" ||
        key === "PageDown" ||
        key === "End" ||
        key === " "
    );
}

function handleKeyDown(event) {
    const container = state.scrollIntentContainer;

    if (!container || state.isApplyingDomChanges) {
        return;
    }

    ensureIntentState();

    if (isTopIntentKey(event.key)) {
        if (!isAtTopEdge(container)) {
            resetTopEdgeAccum();
            return;
        }

        state.topEdgeKeyAccum += 1;

        if (state.topEdgeKeyAccum >= KEY_TRIGGER_STEPS) {
            armTopRestoreIntent(`key-${event.key}-at-top-edge-threshold`);
        }

        return;
    }

    if (isBottomIntentKey(event.key)) {
        if (!isAtBottomEdge(container)) {
            resetBottomEdgeAccum();
            return;
        }

        state.bottomEdgeKeyAccum += 1;

        if (state.bottomEdgeKeyAccum >= KEY_TRIGGER_STEPS) {
            armBottomPruneIntent(`key-${event.key}-at-bottom-edge-threshold`);
        }
    }
}

function removeExistingListeners() {
    if (state.scrollIntentEventTarget) {
        state.scrollIntentEventTarget.removeEventListener("scroll", handleScroll);
        state.scrollIntentEventTarget.removeEventListener("wheel", handleWheel);
    }

    window.removeEventListener("keydown", handleKeyDown);
}

/**
 * Attaches scroll intent listeners to the active conversation scroll root.
 *
 * Re-attaches automatically when ChatGPT swaps scroll containers during
 * navigation.
 */
export function ensureScrollIntentListener() {
    const container = getConversationScrollContainer();
    if (!container) {
        return false;
    }

    ensureIntentState();

    const nextEventTarget = getScrollEventTarget(container);

    if (
        state.scrollIntentContainer === container &&
        state.scrollIntentEventTarget === nextEventTarget
    ) {
        return true;
    }

    removeExistingListeners();

    state.scrollIntentContainer = container;
    state.scrollIntentEventTarget = nextEventTarget;
    state.scrollIntentLastTop = getScrollTopForContainer(container);

    clearScrollIntent();

    nextEventTarget.addEventListener("scroll", handleScroll, {
        passive: true,
    });

    nextEventTarget.addEventListener("wheel", handleWheel, {
        passive: true,
    });

    window.addEventListener("keydown", handleKeyDown, {
        passive: true,
    });

    debugLog("Scroll intent: attached listener", {
        usesWindowTarget: nextEventTarget === window,
        scrollTop: state.scrollIntentLastTop,
        wheelTriggerDistance: WHEEL_TRIGGER_DISTANCE,
        keyTriggerSteps: KEY_TRIGGER_STEPS,
    });

    return true;
}