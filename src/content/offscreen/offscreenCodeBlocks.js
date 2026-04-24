import {
    state,
    CODE_BLOCK_COLLAPSED_ATTR,
    CODE_BLOCK_PLACEHOLDER_ATTR,
} from "../core/state.js";
import {
    getConversationSections,
    getLatestAssistantSection,
} from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";
import {
    getActiveStreamingSection,
    syncStreamingSectionState,
} from "../streaming/streamingSection.js";
import {
    invalidateCodeBlockHeight,
    clearCodeBlockOffscreenOptimization,
} from "./offscreenShared.js";
import {
    isLargeCodeBlock,
    ensurePlaceholderForPre,
    isRevealButtonElement,
} from "./codeBlockPlaceholders.js";
import {
    configureDetachStore,
    getDetachedEntryForPlaceholder,
    storeDetachedCodeBlock,
    restoreDetachedCodeBlockEntry,
    restoreAllDetachedCodeBlocks,
    clearCollapsedCodeBlock,
    revealCollapsedCodeBlockFromPlaceholder,
    selfHealDetachedCodeBlockEntry,
} from "./codeBlockDetachStore.js";
import {
    isStreamingLatestAssistantSection,
    ensureLiveCodeBlockMutationObserver,
    disconnectCodeBlockMutationObserver,
} from "./codeBlockObservers.js";
import { scheduleDomWriteBatch } from "../core/domWriteBatch.js";

const CODE_BLOCKS_PROCESSED_ATTR = "data-thread-optimizer-codeblocks-processed";
const LARGE_CODE_LIVE_ATTR = "data-thread-optimizer-large-code-live";

let codeBlockRevealClickListenerInstalled = false;

function markSectionCodeBlocksProcessed(section) {
    if (!(section instanceof HTMLElement)) return;
    section.setAttribute(CODE_BLOCKS_PROCESSED_ATTR, "true");
}

function clearSectionCodeBlocksProcessed(section) {
    if (!(section instanceof HTMLElement)) return;
    section.removeAttribute(CODE_BLOCKS_PROCESSED_ATTR);
}

function areSectionCodeBlocksProcessed(section) {
    return (
        section instanceof HTMLElement &&
        section.getAttribute(CODE_BLOCKS_PROCESSED_ATTR) === "true"
    );
}

function setLargeCodeLiveMarker(pre, isLive) {
    if (!(pre instanceof HTMLPreElement)) return;

    if (isLive) {
        pre.setAttribute(LARGE_CODE_LIVE_ATTR, "true");
        return;
    }

    pre.removeAttribute(LARGE_CODE_LIVE_ATTR);
}

function clearLiveMarkersForSection(section) {
    if (!(section instanceof HTMLElement)) return;

    const codeBlocks = section.getElementsByTagName("pre");
    for (let i = 0; i < codeBlocks.length; i += 1) {
        setLargeCodeLiveMarker(codeBlocks[i], false);
    }
}

function getCodeBlockRoot(section) {
    if (!(section instanceof HTMLElement)) return null;

    const markdown = section.querySelector(".markdown");
    if (markdown instanceof HTMLElement) {
        return markdown;
    }

    return section;
}

function getCodeBlocksForSection(section) {
    const root = getCodeBlockRoot(section);
    if (!(root instanceof HTMLElement)) {
        return [];
    }

    const codeBlocks = root.getElementsByTagName("pre");
    const result = [];

    for (let i = 0; i < codeBlocks.length; i += 1) {
        if (isCodeBlockOptimizationEligible(codeBlocks[i])) {
            result.push(codeBlocks[i]);
        }
    }

    return result;
}

function hasAnyCodeBlocks(section) {
    return getCodeBlocksForSection(section).length > 0;
}

function resetStreamingObserverTracking() {
    state.streamingCodeBlockLastSection = null;
    state.streamingCodeBlockLastPre = null;
    state.streamingCodeBlockLastCount = 0;
}

function applyCollapsedCodeBlock(pre, { detach = false } = {}) {
    if (!isCodeBlockOptimizationEligible(pre)) {
        return false;
    }

    if (pre.dataset.threadOptimizerCodeExpanded === "true") {
        clearCollapsedCodeBlock(pre, { preserveExpanded: true });
        setLargeCodeLiveMarker(pre, true);
        return false;
    }

    const placeholder = ensurePlaceholderForPre(pre);
    if (!(placeholder instanceof HTMLElement)) {
        return false;
    }

    if (detach) {
        setLargeCodeLiveMarker(pre, false);

        const existingEntry = getDetachedEntryForPlaceholder(placeholder);
        if (!existingEntry) {
            storeDetachedCodeBlock(pre, placeholder);
        }

        if (pre.isConnected) {
            pre.remove();
        }

        return true;
    }

    setLargeCodeLiveMarker(pre, true);
    pre.setAttribute(CODE_BLOCK_COLLAPSED_ATTR, "true");
    pre.style.display = "";
    clearCodeBlockOffscreenOptimization(pre);

    return true;
}

function ensureCodeBlockRevealClickListener() {
    if (codeBlockRevealClickListenerInstalled) return;

    document.addEventListener(
        "click",
        (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const placeholder = target.closest(
                `[${CODE_BLOCK_PLACEHOLDER_ATTR}="true"]`
            );
            if (!(placeholder instanceof HTMLElement)) return;

            if (isRevealButtonElement(target)) {
                event.preventDefault();
                event.stopPropagation();
                revealCollapsedCodeBlockFromPlaceholder(placeholder);

                const hostSection = placeholder.closest("section");
                clearSectionCodeBlocksProcessed(hostSection);
            }
        },
        true
    );

    codeBlockRevealClickListenerInstalled = true;
}

function scheduleCodeBlockRefresh() {
    if (state.isCodeBlockRefreshScheduled) {
        return;
    }

    state.isCodeBlockRefreshScheduled = true;
    state.codeBlockRefreshTimer = null;

    scheduleDomWriteBatch(() => {
        try {
            refreshObservedCodeBlocks();
        } finally {
            state.isCodeBlockRefreshScheduled = false;
            state.codeBlockRefreshTimer = null;
        }
    });
}

function reconcileDetachedCodeBlocks() {
    for (const entry of Array.from(state.detachedCodeBlocks.values())) {
        const { pre, placeholder } = entry;

        if (!(pre instanceof HTMLPreElement) || !(placeholder instanceof HTMLElement)) {
            state.detachedCodeBlocks.delete(entry.id);
            continue;
        }

        if (!placeholder.isConnected) {
            selfHealDetachedCodeBlockEntry(entry);
            continue;
        }

        if (
            !state.featureFlags.largeCodeBlockOptimization ||
            !isLargeCodeBlock(pre)
        ) {
            restoreDetachedCodeBlockEntry(entry, {
                removePlaceholder: true,
                preserveExpanded: false,
            });
            continue;
        }

        if (pre.dataset.threadOptimizerCodeExpanded === "true") {
            restoreDetachedCodeBlockEntry(entry, {
                removePlaceholder: true,
                preserveExpanded: true,
            });
        }
    }
}

function getSettledCodeBlockActions(section) {
    const codeBlocks = getCodeBlocksForSection(section);
    const actions = [];

    for (let i = 0; i < codeBlocks.length; i += 1) {
        const pre = codeBlocks[i];

        if (!isLargeCodeBlock(pre)) {
            actions.push({
                type: "clear",
                pre,
                preserveExpanded: false,
                live: false,
            });
            continue;
        }

        if (pre.dataset.threadOptimizerCodeExpanded === "true") {
            actions.push({
                type: "clear",
                pre,
                preserveExpanded: true,
                live: true,
            });
            continue;
        }

        actions.push({
            type: "collapse",
            pre,
            detach: true,
        });
    }

    return actions;
}

function applyCodeBlockAction(action) {
    const { pre } = action;

    if (!(pre instanceof HTMLPreElement)) {
        return;
    }

    if (action.type === "clear") {
        clearCollapsedCodeBlock(pre, {
            preserveExpanded: Boolean(action.preserveExpanded),
        });
        clearCodeBlockOffscreenOptimization(pre);
        setLargeCodeLiveMarker(pre, Boolean(action.live));
        return;
    }

    if (action.type === "collapse") {
        applyCollapsedCodeBlock(pre, {
            detach: Boolean(action.detach),
        });
    }
}

function applyCodeBlockActions(actions) {
    for (let i = 0; i < actions.length; i += 1) {
        applyCodeBlockAction(actions[i]);
    }
}

function processSettledSection(section) {
    const codeBlocks = getCodeBlocksForSection(section);

    if (codeBlocks.length === 0) {
        markSectionCodeBlocksProcessed(section);
        return;
    }

    const actions = getSettledCodeBlockActions(section);

    clearLiveMarkersForSection(section);
    applyCodeBlockActions(actions);

    markSectionCodeBlocksProcessed(section);
}

function getStreamingCodeBlockActions(section) {
    const codeBlocks = getCodeBlocksForSection(section);
    const qualifyingCodeBlocks = [];
    const actions = [];

    for (let i = 0; i < codeBlocks.length; i += 1) {
        if (isLargeCodeBlock(codeBlocks[i])) {
            qualifyingCodeBlocks.push(codeBlocks[i]);
        }
    }

    const lastQualifyingStreamingBlock =
        qualifyingCodeBlocks[qualifyingCodeBlocks.length - 1] ?? null;

    for (let i = 0; i < codeBlocks.length; i += 1) {
        const pre = codeBlocks[i];

        if (!isLargeCodeBlock(pre)) {
            actions.push({
                type: "clear",
                pre,
                preserveExpanded: false,
                live: false,
            });
            continue;
        }

        actions.push({
            type: "collapse",
            pre,
            detach: pre !== lastQualifyingStreamingBlock,
        });
    }

    return actions;
}

function processStreamingSection(section) {
    const actions = getStreamingCodeBlockActions(section);

    clearLiveMarkersForSection(section);
    applyCodeBlockActions(actions);
    clearSectionCodeBlocksProcessed(section);
}

function getStreamingSectionToProcess() {
    const stickyActiveStreaming = getActiveStreamingSection();
    if (stickyActiveStreaming?.isConnected) {
        return stickyActiveStreaming;
    }

    const latestAssistant = getLatestAssistantSection();
    if (
        latestAssistant?.isConnected &&
        isStreamingLatestAssistantSection(latestAssistant)
    ) {
        return latestAssistant;
    }

    return null;
}

function syncStreamingStructureObserver() {
    const streamingSection = getStreamingSectionToProcess();

    if (!streamingSection || !isReplyStreaming()) {
        disconnectCodeBlockMutationObserver();
        resetStreamingObserverTracking();
        return;
    }

    ensureLiveCodeBlockMutationObserver({
        onRelevantStructureChange: () => {
            scheduleCodeBlockRefresh();
            reconcileLatestStreamingAssistantCodeBlocksNow();
        },
    });

    syncStreamingSectionState();
}

function ensureStreamingObserverOnly(section) {
    state.streamingCodeBlockLastSection = section;
    state.streamingCodeBlockLastPre = null;
    state.streamingCodeBlockLastCount = 0;
    syncStreamingStructureObserver();
}

export function reconcileLatestStreamingAssistantCodeBlocksNow() {
    if (!state.featureFlags.largeCodeBlockOptimization) return;
    if (!isReplyStreaming()) return;

    syncStreamingSectionState();

    const section = getStreamingSectionToProcess();
    if (!section) return;

    if (!hasAnyCodeBlocks(section)) {
        ensureStreamingObserverOnly(section);
        debugLog("Offscreen code blocks: streaming in text-only phase");
        return;
    }

    const codeBlocks = getCodeBlocksForSection(section);
    const lastPre = codeBlocks[codeBlocks.length - 1] ?? null;
    const codeBlockCount = codeBlocks.length;

    const shouldProcess =
        section !== state.streamingCodeBlockLastSection ||
        lastPre !== state.streamingCodeBlockLastPre ||
        codeBlockCount !== state.streamingCodeBlockLastCount;

    if (!shouldProcess) {
        syncStreamingStructureObserver();
        return;
    }

    processStreamingSection(section);
    state.streamingCodeBlockLastSection = section;
    state.streamingCodeBlockLastPre = lastPre;
    state.streamingCodeBlockLastCount = codeBlockCount;

    syncStreamingStructureObserver();
}

export function configureCodeBlockOptimization({ scheduleRefresh } = {}) {
    configureDetachStore({ scheduleRefresh });
    ensureCodeBlockRevealClickListener();
}

export function resetCodeBlockOptimization({ clearMeasurements = false } = {}) {
    const currentSections = getConversationSections();
    const currentCodeBlocks = currentSections.flatMap((section) =>
        getCodeBlocksForSection(section)
    );

    disconnectCodeBlockMutationObserver();
    resetStreamingObserverTracking();
    restoreAllDetachedCodeBlocks({ preserveExpanded: true });

    scheduleDomWriteBatch(() => {
        for (let i = 0; i < currentCodeBlocks.length; i += 1) {
            const pre = currentCodeBlocks[i];
            clearCodeBlockOffscreenOptimization(pre);
            clearCollapsedCodeBlock(pre, { preserveExpanded: true });
            setLargeCodeLiveMarker(pre, false);

            if (clearMeasurements) {
                invalidateCodeBlockHeight(pre);
            }
        }

        for (let i = 0; i < currentSections.length; i += 1) {
            clearSectionCodeBlocksProcessed(currentSections[i]);
        }
    });

    if (state.codeBlockRefreshTimer) {
        clearTimeout(state.codeBlockRefreshTimer);
        state.codeBlockRefreshTimer = null;
    }

    state.isCodeBlockRefreshScheduled = false;

    debugLog("Offscreen code blocks: reset optimization state", {
        clearMeasurements,
        currentCodeBlocks: currentCodeBlocks.length,
        detachedCodeBlocks: state.detachedCodeBlocks.size,
    });
}

function clearAllObservedCodeBlocks(sections) {
    for (let i = 0; i < sections.length; i += 1) {
        const codeBlocks = getCodeBlocksForSection(sections[i]);

        for (let j = 0; j < codeBlocks.length; j += 1) {
            clearCodeBlockOffscreenOptimization(codeBlocks[j]);
            clearCollapsedCodeBlock(codeBlocks[j], {
                preserveExpanded: false,
            });
            setLargeCodeLiveMarker(codeBlocks[j], false);
        }

        clearSectionCodeBlocksProcessed(sections[i]);
    }
}

function processSettledSections(sections) {
    const sectionsToProcess = [];

    for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i];
        if (!(section instanceof HTMLElement)) continue;

        if (areSectionCodeBlocksProcessed(section)) {
            continue;
        }

        sectionsToProcess.push(section);
    }

    for (let i = 0; i < sectionsToProcess.length; i += 1) {
        processSettledSection(sectionsToProcess[i]);
    }

    return sectionsToProcess.length;
}

export function refreshObservedCodeBlocks() {
    ensureCodeBlockRevealClickListener();
    reconcileDetachedCodeBlocks();

    const sections = getConversationSections();

    if (!state.featureFlags.largeCodeBlockOptimization) {
        disconnectCodeBlockMutationObserver();
        restoreAllDetachedCodeBlocks({ preserveExpanded: false });
        clearAllObservedCodeBlocks(sections);
        return;
    }

    const streamingSection = getStreamingSectionToProcess();
    const replyIsStreaming = isReplyStreaming();

    syncStreamingStructureObserver();

    if (replyIsStreaming && streamingSection) {
        processStreamingSection(streamingSection);
        state.streamingCodeBlockLastSection = streamingSection;

        const codeBlocks = getCodeBlocksForSection(streamingSection);
        state.streamingCodeBlockLastPre =
            codeBlocks[codeBlocks.length - 1] ?? null;
        state.streamingCodeBlockLastCount = codeBlocks.length;

        debugLog("Offscreen code blocks: refreshed code block state", {
            mode: "streaming",
            sectionsProcessed: 1,
            detachedCodeBlocks: state.detachedCodeBlocks.size,
        });
        return;
    }

    const sectionsProcessed = processSettledSections(sections);

    resetStreamingObserverTracking();

    debugLog("Offscreen code blocks: refreshed code block state", {
        mode: "settled",
        sectionsProcessed,
        detachedCodeBlocks: state.detachedCodeBlocks.size,
    });
}

function isCodeBlockOptimizationEligible(pre) {
    if (!(pre instanceof HTMLPreElement)) {
        return false;
    }

    if (!pre.isConnected) {
        return false;
    }

    const section = pre.closest('section[data-turn="assistant"]');
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    if (
        pre.closest(
            [
                '[data-writing-block="true"]',
                ".writing-block-editor",
                '.ProseMirror[contenteditable="true"]',
                '[contenteditable="true"]',
            ].join(",")
        )
    ) {
        return false;
    }

    if (!pre.querySelector("code") && !pre.textContent?.trim()) {
        return false;
    }

    return true;
}