const MESSAGE_SOURCE = "thread-optimizer";

function getStringAttr(node, name) {
    if (!(node instanceof Element)) {
        return null;
    }

    const value = node.getAttribute(name);
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed || null;
}

function readCandidateMessageId(node) {
    if (!(node instanceof Element)) {
        return null;
    }

    return (
        getStringAttr(node, "data-message-id") ||
        getStringAttr(node, "data-thread-optimizer-message-id") ||
        getStringAttr(node, "data-messageid") ||
        node.dataset?.messageId?.trim?.() ||
        node.dataset?.threadOptimizerMessageId?.trim?.() ||
        null
    );
}

export function getSectionMessageId(section) {
    if (!(section instanceof Element)) {
        return null;
    }

    const directId = readCandidateMessageId(section);
    if (directId) {
        return directId;
    }

    const descendant = section.querySelector(
        "[data-message-id], [data-thread-optimizer-message-id], [data-messageid]"
    );

    return readCandidateMessageId(descendant);
}

export function rememberPrunedSectionMessageId(section) {
    const messageId = getSectionMessageId(section);

    if (!messageId) {
        return {
            ok: false,
            recorded: false,
            messageId: null,
            reason: "missing-message-id",
        };
    }

    window.postMessage(
        {
            source: MESSAGE_SOURCE,
            type: "THREAD_OPTIMIZER_PRUNED_MESSAGE_ID",
            messageId,
        },
        "*"
    );

    return {
        ok: true,
        recorded: true,
        messageId,
        reason: null,
    };
}

export function deleteSectionMessageViaBridge(section) {
    const result = rememberPrunedSectionMessageId(section);

    return {
        ...result,
        deleted: false,
        reason: result.ok ? "manual-delete-only" : result.reason,
    };
}