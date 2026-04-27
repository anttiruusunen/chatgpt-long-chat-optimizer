import { debugLog } from "../core/logger";

const RECORD_SOURCE = "thread-optimizer";
const RECORD_TYPE = "thread-optimizer:record-pruned-message-id";

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

export function recordPrunedSectionMessageForManualBridgeDelete(section) {
    const messageId = extractMessageIdFromSection(section);

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
            reason: "no message id found on section",
        };
    }

    window.postMessage(
        {
            source: RECORD_SOURCE,
            type: RECORD_TYPE,
            messageId,
        },
        window.location.origin
    );

    return {
        recorded: true,
        messageId,
    };
}