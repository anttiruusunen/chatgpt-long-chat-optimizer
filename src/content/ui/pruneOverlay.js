const OVERLAY_ID = "long-chat-optimizer-prune-overlay";
const STYLE_ID = "long-chat-optimizer-prune-overlay-style";

let activeOverlayCount = 0;

function ensureOverlayStyle() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        #${OVERLAY_ID} {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(15, 23, 42, 0.42);
            backdrop-filter: blur(2px);
            pointer-events: auto;
        }

        #${OVERLAY_ID} .long-chat-optimizer-prune-card {
            display: flex;
            align-items: center;
            gap: 12px;
            max-width: 280px;
            padding: 14px 16px;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.96);
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
        }

        #${OVERLAY_ID} .long-chat-optimizer-prune-spinner {
            width: 22px;
            height: 22px;
            flex: 0 0 auto;
            border: 3px solid rgba(37, 99, 235, 0.18);
            border-top-color: #2563eb;
            border-radius: 999px;
            animation: long-chat-optimizer-prune-spin 0.8s linear infinite;
        }

        #${OVERLAY_ID} .long-chat-optimizer-prune-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
            line-height: 1.25;
        }

        #${OVERLAY_ID} .long-chat-optimizer-prune-title {
            font-size: 14px;
            font-weight: 650;
        }

        #${OVERLAY_ID} .long-chat-optimizer-prune-subtitle {
            font-size: 12px;
            color: #4b5563;
        }

        @media (prefers-color-scheme: dark) {
            #${OVERLAY_ID} {
                background: rgba(2, 6, 23, 0.52);
            }

            #${OVERLAY_ID} .long-chat-optimizer-prune-card {
                background: rgba(17, 24, 39, 0.96);
                color: #f9fafb;
                box-shadow:
                    0 18px 45px rgba(0, 0, 0, 0.42),
                    0 0 0 1px rgba(255, 255, 255, 0.08);
            }

            #${OVERLAY_ID} .long-chat-optimizer-prune-subtitle {
                color: #d1d5db;
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

function createOverlay() {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-label", "Pruning messages");

    overlay.innerHTML = `
        <div class="long-chat-optimizer-prune-card">
            <div class="long-chat-optimizer-prune-spinner" aria-hidden="true"></div>
            <div class="long-chat-optimizer-prune-text">
                <div class="long-chat-optimizer-prune-title">Pruning messages…</div>
                <div class="long-chat-optimizer-prune-subtitle">Long chats can take a moment.</div>
            </div>
        </div>
    `;

    return overlay;
}

export function showInitialPruneOverlay() {
    activeOverlayCount += 1;

    ensureOverlayStyle();

    if (document.getElementById(OVERLAY_ID)) {
        return;
    }

    document.documentElement.appendChild(createOverlay());
}

export function hideInitialPruneOverlay() {
    activeOverlayCount = Math.max(0, activeOverlayCount - 1);

    if (activeOverlayCount > 0) {
        return;
    }

    document.getElementById(OVERLAY_ID)?.remove();
}

export function resetInitialPruneOverlayForTests() {
    activeOverlayCount = 0;
    document.getElementById(OVERLAY_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
}