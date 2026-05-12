import { GLOBAL_KEY } from "./config.js";

export function getVisibleConversationTurnCount() {
    try {
        return document.querySelectorAll(
            'section[data-testid^="conversation-turn-"], section[data-turn]'
        ).length;
    } catch {
        return 0;
    }
}

export function getEstimatedConversationTurnCount() {
    const visibleTurns = getVisibleConversationTurnCount();
    const bridge = window[GLOBAL_KEY];

    const pruningEnabled = bridge?.__knownPruningEnabled === true;

    const prunedTurns =
        pruningEnabled && Number.isFinite(bridge?.__knownPrunedTurnCount)
            ? bridge.__knownPrunedTurnCount
            : 0;

    return visibleTurns + prunedTurns;
}

export function getExpectedMinimumStoreNodeCount() {
    const estimatedTurns = getEstimatedConversationTurnCount();

    if (estimatedTurns <= 2) return 1;

    return Math.max(3, Math.floor(estimatedTurns * 0.25));
}

export function getNewestVisibleMessageIdFromDom() {
    const selectors = [
        "[data-message-id]",
        "[data-message-author-role][data-message-id]",
        'article[data-testid^="conversation-turn-"] [data-message-id]',
        'section[data-testid^="conversation-turn-"] [data-message-id]',
    ];

    for (const selector of selectors) {
        const nodes = document.querySelectorAll(selector);

        for (let i = nodes.length - 1; i >= 0; i -= 1) {
            const value = nodes[i]?.getAttribute?.("data-message-id");

            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }
    }

    return null;
}