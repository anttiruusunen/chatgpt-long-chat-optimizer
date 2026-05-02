import { debugLog } from "../core/logger";
import { getChatStorePageBridgeToken } from "./bridgeBootstrap.js";

const RECORD_SOURCE = "thread-optimizer";
const RECORD_TYPE = "thread-optimizer:record-pruned-message-id";

const MAX_MESSAGE_ID_LENGTH = 300;

function extractMessageIdFromSection(section) {
    if (!(section instanceof HTMLElement)) {
        return null;
    }

    const directMessageId =
        section.getAttribute("data-message-id") ||
        section.dataset.messageId;

    if (directMessageId) {
        return directMessageId;
    }

    const messageIdElement = section.querySelector("[data-message-id]");
    if (messageIdElement instanceof HTMLElement) {
        return messageIdElement.getAttribute("data-message-id");
    }

    return null;
}

function normalizeMessageId(messageId) {
    if (typeof messageId !== "string") {
        return null;
    }

    const normalized = messageId.trim();

    if (!normalized) {
        return null;
    }

    if (normalized.length > MAX_MESSAGE_ID_LENGTH) {
        return null;
    }

    return normalized;
}

export function postThreadOptimizerBridgeMessage(message) {
    const token = getChatStorePageBridgeToken();

    if (!token) {
        debugLog("[Thread Optimizer] page bridge token unavailable");
        return false;
    }

    if (!message || typeof message !== "object") {
        return false;
    }

    window.postMessage(
        {
            ...message,
            source: RECORD_SOURCE,
            token,
        },
        window.location.origin
    );

    return true;
}

export function recordPrunedSectionMessageForManualBridgeDelete(section) {
    const messageId = normalizeMessageId(extractMessageIdFromSection(section));

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