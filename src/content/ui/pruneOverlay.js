import {
    startPruneOverlayWatchdog,
    stopPruneOverlayWatchdog,
    resetPruneOverlayWatchdogForTests,
} from "./pruneOverlayWatchdog.js";

const OVERLAY_ID = "long-chat-optimizer-prune-overlay";
const CARD_ID = "long-chat-optimizer-prune-overlay-card";
const STYLE_ID = "long-chat-optimizer-prune-overlay-style";
const HOST_ATTR = "data-long-chat-optimizer-prune-overlay-host";
const HIDE_BUTTON_CLASS = "long-chat-optimizer-prune-hide";

let activeOverlayCount = 0;
let activeOverlayHost = null;

function ensureOverlayStyle() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        [${HOST_ATTR}="true"] {
            position: relative !important;
        }

        #${OVERLAY_ID} {
            position: absolute;
            inset: 0;
            z-index: 2147483646;
            display: block;
            background: rgba(15, 23, 42, 0.28);
            backdrop-filter: blur(2px);
            pointer-events: auto;
            cursor: wait;
        }

        #${OVERLAY_ID}.long-chat-optimizer-prune-overlay-fixed {
            position: fixed;
        }

        #${CARD_ID} {
            position: fixed;
            top: 28vh;
            left: 50%;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 12px;
            width: max-content;
            max-width: min(380px, calc(100vw - 32px));
            padding: 14px 16px;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.98);
            color: #111827;
            box-shadow:
                0 18px 45px rgba(15, 23, 42, 0.28),
                0 0 0 1px rgba(15, 23, 42, 0.08);
            font-family:
                system-ui,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
            transform: translateX(-50%);
            pointer-events: auto;
        }

        #${CARD_ID} .long-chat-optimizer-prune-spinner {
            width: 22px;
            height: 22px;
            flex: 0 0 auto;
            border: 3px solid rgba(37, 99, 235, 0.18);
            border-top-color: #2563eb;
            border-radius: 999px;
            animation: long-chat-optimizer-prune-spin 0.8s linear infinite;
        }

        #${CARD_ID} .long-chat-optimizer-prune-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            line-height: 1.25;
        }

        #${CARD_ID} .long-chat-optimizer-prune-title {
            font-size: 14px;
            font-weight: 650;
        }

        #${CARD_ID} .long-chat-optimizer-prune-subtitle {
            font-size: 12px;
            color: #4b5563;
        }

        #${CARD_ID} .${HIDE_BUTTON_CLASS} {
            flex: 0 0 auto;
            margin-left: 4px;
            padding: 5px 8px;
            border: 1px solid rgba(15, 23, 42, 0.14);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.86);
            color: #374151;
            font: inherit;
            font-size: 12px;
            line-height: 1;
            cursor: pointer;
        }

        #${CARD_ID} .${HIDE_BUTTON_CLASS}:hover {
            background: rgba(243, 244, 246, 0.96);
        }

        #${CARD_ID} .${HIDE_BUTTON_CLASS}:focus-visible {
            outline: 2px solid #2563eb;
            outline-offset: 2px;
        }

        @media (prefers-color-scheme: dark) {
            #${OVERLAY_ID} {
                background: rgba(2, 6, 23, 0.34);
            }

            #${CARD_ID} {
                background: rgba(17, 24, 39, 0.98);
                color: #f9fafb;
                box-shadow:
                    0 18px 45px rgba(0, 0, 0, 0.42),
                    0 0 0 1px rgba(255, 255, 255, 0.08);
            }

            #${CARD_ID} .long-chat-optimizer-prune-subtitle {
                color: #d1d5db;
            }

            #${CARD_ID} .${HIDE_BUTTON_CLASS} {
                border-color: rgba(255, 255, 255, 0.14);
                background: rgba(31, 41, 55, 0.86);
                color: #f3f4f6;
            }

            #${CARD_ID} .${HIDE_BUTTON_CLASS}:hover {
                background: rgba(55, 65, 81, 0.96);
            }
        }

        @keyframes long-chat-optimizer-prune-spin {
            to {
                transform: rotate(360deg);
            }
        }
    `;

    document.head.appendChild(style);
}

function getOverlayHost() {
    const thread = document.querySelector("#thread");

    if (thread instanceof HTMLElement) {
        return {
            element: thread,
            fixed: false,
        };
    }

    const main = document.querySelector("main");

    if (main instanceof HTMLElement) {
        return {
            element: main,
            fixed: false,
        };
    }

    return {
        element: document.documentElement,
        fixed: true,
    };
}

function createOverlay({ fixed = false } = {}) {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    if (fixed) {
        overlay.classList.add("long-chat-optimizer-prune-overlay-fixed");
    }

    return overlay;
}

function createOverlayCard() {
    const card = document.createElement("div");
    card.id = CARD_ID;
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    card.setAttribute("aria-label", "Hiding older messages");

    card.innerHTML = `
        <div class="long-chat-optimizer-prune-spinner" aria-hidden="true"></div>
        <div class="long-chat-optimizer-prune-text">
            <div class="long-chat-optimizer-prune-title">Hiding older messages…</div>
            <div class="long-chat-optimizer-prune-subtitle">Older turns are hidden from this page, not deleted from your saved chat.</div>
        </div>
        <button
            class="${HIDE_BUTTON_CLASS}"
            type="button"
            aria-label="Dismiss hiding older messages notice"
        >Hide</button>
    `;

    card
        .querySelector(`.${HIDE_BUTTON_CLASS}`)
        ?.addEventListener("click", () => {
            hidePruneOverlay({
                force: true,
                reason: "user-hidden",
            });
        });

    return card;
}

function removeHostMarkerIfDetached() {
    if (
        activeOverlayHost instanceof HTMLElement &&
        !activeOverlayHost.isConnected
    ) {
        activeOverlayHost.removeAttribute(HOST_ATTR);
        activeOverlayHost = null;
    }
}

function ensureOverlayMounted() {
    if (activeOverlayCount <= 0) {
        return;
    }

    ensureOverlayStyle();
    removeHostMarkerIfDetached();

    let overlay = document.getElementById(OVERLAY_ID);

    if (!overlay || !overlay.isConnected) {
        overlay?.remove();

        const { element: host, fixed } = getOverlayHost();

        activeOverlayHost = host;
        activeOverlayHost.setAttribute(HOST_ATTR, "true");
        activeOverlayHost.appendChild(createOverlay({ fixed }));
    }

    let card = document.getElementById(CARD_ID);

    if (!card || !card.isConnected) {
        card?.remove();
        document.body.appendChild(createOverlayCard());
    }
}

export function isPruneOverlayActive() {
    return activeOverlayCount > 0;
}

export function showPruneOverlay() {
    activeOverlayCount += 1;

    ensureOverlayMounted();
    startPruneOverlayWatchdog(ensureOverlayMounted);
}

export function hidePruneOverlay(options = {}) {
    if (options.force) {
        activeOverlayCount = 0;
    } else {
        activeOverlayCount = Math.max(0, activeOverlayCount - 1);
    }

    if (activeOverlayCount > 0) {
        ensureOverlayMounted();
        return;
    }

    stopPruneOverlayWatchdog();

    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(CARD_ID)?.remove();

    if (activeOverlayHost instanceof HTMLElement) {
        activeOverlayHost.removeAttribute(HOST_ATTR);
    }

    activeOverlayHost = null;
}

export function showInitialPruneOverlay(options) {
    showPruneOverlay(options);
}

export function hideInitialPruneOverlay(options) {
    hidePruneOverlay(options);
}

export function resetPruneOverlayForTests() {
    activeOverlayCount = 0;
    activeOverlayHost = null;

    stopPruneOverlayWatchdog();
    resetPruneOverlayWatchdogForTests();

    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(CARD_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();

    for (const host of document.querySelectorAll(`[${HOST_ATTR}]`)) {
        host.removeAttribute(HOST_ATTR);
    }
}

export function resetInitialPruneOverlayForTests() {
    resetPruneOverlayForTests();
}