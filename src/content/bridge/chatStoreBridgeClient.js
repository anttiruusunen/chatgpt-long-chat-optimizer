import { debugLog } from "../core/logger";
import { getChatStorePageBridgeToken } from "./bridgeBootstrap.js";

const RECORD_SOURCE = "thread-optimizer";
const RECORD_TYPE = "thread-optimizer:record-pruned-message-id";
const VISIBLE_MESSAGES_READY_TYPE = "thread-optimizer:visible-messages-ready";

const MAX_MESSAGE_ID_LENGTH = 300;

/**
 * Extract a stable ChatGPT message id from a DOM node.
 *
 * The DOM shape is inconsistent:
 * - sometimes the id is on the section itself
 * - sometimes on a nested child
 * - sometimes on a parent wrapper
 *
 * We search in that order to maximize compatibility.
 */
export function extractMessageId(section) {
    if (!(section instanceof HTMLElement)) {
        return null;
    }

    // 1. direct
    const direct =
        section.getAttribute("data-message-id") ||
        section.dataset.messageId;

    if (direct) return direct;

    // 2. nested
    const child = section.querySelector("[data-message-id]");
    if (child instanceof HTMLElement) {
        const id = child.getAttribute("data-message-id");
        if (id) return id;
    }

    // 3. ancestor (critical for some ChatGPT layouts)
    let parent = section.parentElement;
    while (parent instanceof HTMLElement) {
        const id =
            parent.getAttribute("data-message-id") ||
            parent.dataset.messageId;

        if (id) return id;

        parent = parent.parentElement;
    }

    return null;
}

function normalizeMessageId(messageId) {
    if (typeof messageId !== "string") return null;

    const normalized = messageId.trim();

    if (!normalized || normalized.length > MAX_MESSAGE_ID_LENGTH) {
        return null;
    }

    return normalized;
}

/**
 * Send a message to the page-context bridge.
 *
 * Uses a per-page token to avoid collisions with other scripts.
 */
export function postThreadOptimizerBridgeMessage(message) {
    const token = getChatStorePageBridgeToken();

    if (!token) {
        debugLog("[Thread Optimizer] page bridge token unavailable");
        return false;
    }

    if (!message || typeof message !== "object") {
        return false;
    }

    // file:// fixtures have origin "null", which breaks strict targetOrigin
    const targetOrigin =
        window.location.origin && window.location.origin !== "null"
            ? window.location.origin
            : "*";

    window.postMessage(
        {
            ...message,
            source: RECORD_SOURCE,
            token,
        },
        targetOrigin
    );

    return true;
}

/**
 * Notify the page bridge that a pruned message should be deleted
 * from the internal ChatGPT store.
 */
export function recordPrunedSectionMessageForManualBridgeDelete(section) {
    const messageId = normalizeMessageId(extractMessageId(section));

    if (!messageId) {
        debugLog("[Thread Optimizer] no message id found on pruned section", {
            section,
            testId: section instanceof HTMLElement
                ? section.getAttribute("data-testid")
                : null,
            dataset: section instanceof HTMLElement
                ? { ...section.dataset }
                : null,
        });

        return {
            recorded: false,
            reason: "no valid message id found on section",
        };
    }

    const posted = postThreadOptimizerBridgeMessage({
        type: RECORD_TYPE,
        messageId,
    });

    return {
        recorded: posted,
        messageId,
        reason: posted ? null : "failed to post bridge message",
    };
}

export function notifyVisibleMessagesReadyForStoreBridge() {
    return postThreadOptimizerBridgeMessage({
        type: VISIBLE_MESSAGES_READY_TYPE,
    });
}