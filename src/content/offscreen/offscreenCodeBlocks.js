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
    cleanupDetachedCodeBlocksForSection,
} from "./codeBlockDetachStore.js";
import {
    isStreamingLatestAssistantSection,
    ensureLiveCodeBlockMutationObserver,
    disconnectCodeBlockMutationObserver,
} from "./codeBlockObservers.js";
import { scheduleDomWriteBatch } from "../core/domWriteBatch.js";
import {
    registerUiPipelineTask,
    scheduleUiPipelineTask,
} from "../core/uiPipelineScheduler.js";

const CODE_BLOCKS_PROCESSED_ATTR =
    "data-thread-optimizer-codeblocks-processed";
const LARGE_CODE_LIVE_ATTR = "data-thread-optimizer-large-code-live";
const CODE_BLOCK_REFRESH_TASK = "code-block-refresh";

let codeBlockRevealClickListenerInstalled = false;

function isCodeBlockOptimizationEligible(pre) {
    if (!(pre instanceof HTMLPreElement) || !pre.isConnected) {
        return false;
    }

    const section = pre.closest('section[data-turn="assistant"]');
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    // Do not insert placeholders inside CodeMirror/editor internals.
    if (
        pre.closest(
            [
                ".cm-editor",
                ".cm-scroller",
                ".cm-content",
                ".cm-line",
                ".cm-gutters",
                '[data-thread-optimizer-code-placeholder="true"]',
                '[data-writing-block="true"]',
                ".writing-block-editor",
                '.ProseMirror[contenteditable="true"]',
                '[contenteditable="true"]',
            ].join(",")
        )
    ) {
        return false;
    }

    return Boolean(pre.querySelector("code") || pre.textContent?.trim());
}

function removeInvalidNestedCodePlaceholders(root = document) {
    const placeholders = root.querySelectorAll(
        [
            ".cm-editor [data-thread-optimizer-code-placeholder='true']",
            ".cm-scroller [data-thread-optimizer-code-placeholder='true']",
            ".cm-content [data-thread-optimizer-code-placeholder='true']",
            ".cm-line [data-thread-optimizer-code-placeholder='true']",
        ].join(",")
    );

    for (let i = 0; i < placeholders.length; i += 1) {
        placeholders[i].remove();
    }
}

function markSectionCodeBlocksProcessed(section) {
    if (section instanceof HTMLElement) {
        section.setAttribute(CODE_BLOCKS_PROCESSED_ATTR, "true");
    }
}

function clearSectionCodeBlocksProcessed(section) {
    if (section instanceof HTMLElement) {
        section.removeAttribute(CODE_BLOCKS_PROCESSED_ATTR);
    }
}

function areSectionCodeBlocksProcessed(section) {
    return (
        section instanceof HTMLElement &&
        section.getAttribute(CODE_BLOCKS_PROCESSED_ATTR) === "true"
    );
}

function setLargeCodeLiveMarker(pre, isLive) {
    if (!(pre instanceof HTMLPreElement)) {
        return;
    }

    if (isLive) {
        pre.setAttribute(LARGE_CODE_LIVE_ATTR, "true");
        return;
    }

    pre.removeAttribute(LARGE_CODE_LIVE_ATTR);
}

function clearLiveMarkersForCodeBlocks(codeBlocks) {
    for (let i = 0; i < codeBlocks.length; i += 1) {
        setLargeCodeLiveMarker(codeBlocks[i], false);
    }
}

function getCodeBlockRoot(section) {
    if (!(section instanceof HTMLElement)) {
        return null;
    }

    const markdown = section.querySelector(".markdown");

    return markdown instanceof HTMLElement ? markdown : section;
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

export function cleanupCodeBlockDomReferencesForSection(section) {
    if (!(section instanceof Element)) {
        return {
            ok: false,
            cleanedDetachedCodeBlocks: 0,
            clearedStreamingTracking: false,
            clearedObservedStructureSection: false,
            clearedObservedStructureRoot: false,
            disconnectedStructureObserver: false,
        };
    }

    let cleanedDetachedCodeBlocks = 0;
    let clearedStreamingTracking = false;
    let clearedObservedStructureSection = false;
    let clearedObservedStructureRoot = false;
    let disconnectedStructureObserver = false;

    if (typeof cleanupDetachedCodeBlocksForSection === "function") {
        cleanedDetachedCodeBlocks =
            cleanupDetachedCodeBlocksForSection(section);
    }

    const sectionContains = (node) =>
        node instanceof Node && section.contains(node);

    const streamingTouchesSection =
        state.streamingCodeBlockLastSection === section ||
        sectionContains(state.streamingCodeBlockLastSection) ||
        sectionContains(state.streamingCodeBlockLastPre) ||
        (
            Array.isArray(state.streamingCodeBlocks) &&
            state.streamingCodeBlocks.some((pre) => sectionContains(pre))
        );

    if (streamingTouchesSection) {
        state.streamingCodeBlockLastSection = null;
        state.streamingCodeBlockLastPre = null;
        state.streamingCodeBlockLastCount = 0;
        state.streamingCodeBlocks = [];
        clearedStreamingTracking = true;
    }

    if (
        state.observedCodeBlockStructureSection === section ||
        sectionContains(state.observedCodeBlockStructureSection)
    ) {
        state.observedCodeBlockStructureSection = null;
        clearedObservedStructureSection = true;
    }

    if (
        state.observedCodeBlockStructureRoot === section ||
        sectionContains(state.observedCodeBlockStructureRoot)
    ) {
        state.observedCodeBlockStructureRoot = null;
        clearedObservedStructureRoot = true;
    }

    if (
        clearedObservedStructureSection ||
        clearedObservedStructureRoot ||
        streamingTouchesSection
    ) {
        state.codeBlockStructureObserver?.disconnect?.();
        state.codeBlockStructureObserver = null;
        disconnectedStructureObserver = true;
    }

    return {
        ok: true,
        cleanedDetachedCodeBlocks,
        clearedStreamingTracking,
        clearedObservedStructureSection,
        clearedObservedStructureRoot,
        disconnectedStructureObserver,
    };
}

function resetStreamingObserverTracking() {
    state.streamingCodeBlockLastSection = null;
    state.streamingCodeBlockLastPre = null;
    state.streamingCodeBlockLastCount = 0;
    state.streamingCodeBlocks = [];
}

function getTrackedStreamingCodeBlocks(section) {
    if (
        state.streamingCodeBlockLastSection !== section ||
        !Array.isArray(state.streamingCodeBlocks)
    ) {
        state.streamingCodeBlocks = getCodeBlocksForSection(section);
        state.streamingCodeBlockLastSection = section;
    }

    state.streamingCodeBlocks = state.streamingCodeBlocks.filter((pre) =>
        isCodeBlockOptimizationEligible(pre)
    );

    return state.streamingCodeBlocks;
}

function syncStreamingCodeBlocksFromFullScan(section) {
    const codeBlocks = getCodeBlocksForSection(section);

    state.streamingCodeBlocks = codeBlocks;

    return codeBlocks;
}

function collectPreNodesFromNode(node, out) {
    if (node instanceof HTMLPreElement) {
        out.push(node);
        return;
    }

    if (node instanceof Element) {
        const nested = node.querySelectorAll("pre");

        for (let i = 0; i < nested.length; i += 1) {
            out.push(nested[i]);
        }
    }
}

function collectPreNodesFromMutations(mutations) {
    const added = [];
    const removed = [];

    if (!mutations || typeof mutations[Symbol.iterator] !== "function") {
        return { added, removed };
    }

    for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
            collectPreNodesFromNode(node, added);
        }

        for (const node of mutation.removedNodes || []) {
            collectPreNodesFromNode(node, removed);
        }
    }

    return { added, removed };
}

function updateStreamingCodeBlocksFromMutations(section, mutations) {
    const { added, removed } = collectPreNodesFromMutations(mutations);

    if (state.streamingCodeBlockLastSection !== section) {
        state.streamingCodeBlocks = getCodeBlocksForSection(section);
        state.streamingCodeBlockLastSection = section;
    }

    let codeBlocks = Array.isArray(state.streamingCodeBlocks)
        ? state.streamingCodeBlocks
        : [];

    if (removed.length > 0) {
        const removedSet = new Set(removed);
        codeBlocks = codeBlocks.filter(
            (pre) => !removedSet.has(pre) && isCodeBlockOptimizationEligible(pre)
        );
    } else {
        codeBlocks = codeBlocks.filter((pre) =>
            isCodeBlockOptimizationEligible(pre)
        );
    }

    for (let i = 0; i < added.length; i += 1) {
        const pre = added[i];

        if (isCodeBlockOptimizationEligible(pre) && !codeBlocks.includes(pre)) {
            codeBlocks.push(pre);
        }
    }

    state.streamingCodeBlocks = codeBlocks;

    return {
        codeBlocks,
        added,
        removed,
        touchedPre: added.length > 0 || removed.length > 0,
    };
}

/**
 * Collapses a code block either by hiding it in place or fully detaching it.
 *
 * Settled messages can safely detach large blocks. Streaming messages only
 * collapse in place because React may still be reconciling the <pre>.
 */
function applyCollapsedCodeBlock(pre, { detach = false } = {}) {
    if (!isCodeBlockOptimizationEligible(pre)) {
        return false;
    }

    if (
        pre.hasAttribute(LARGE_CODE_LIVE_ATTR) ||
        pre.dataset.threadOptimizerCodeExpanded === "true"
    ) {
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
    if (codeBlockRevealClickListenerInstalled) {
        return;
    }

    document.addEventListener(
        "click",
        (event) => {
            const target = event.target;
            if (!(target instanceof Element)) {
                return;
            }

            const placeholder = target.closest(
                `[${CODE_BLOCK_PLACEHOLDER_ATTR}="true"]`
            );
            if (!(placeholder instanceof HTMLElement)) {
                return;
            }

            if (
                placeholder.closest(
                    ".cm-editor, .cm-scroller, .cm-content, .cm-line, .cm-gutters"
                )
            ) {
                placeholder.remove();
                return;
            }

            const revealButton = target.closest("button");
            if (!revealButton || !isRevealButtonElement(revealButton)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            // Revealing while streaming can fight React and lose the real <pre>.
            if (isReplyStreaming()) {
                return;
            }

            const hostSection = placeholder.closest("section");

            clearSectionCodeBlocksProcessed(hostSection);

            try {
                revealCollapsedCodeBlockFromPlaceholder(placeholder);
            } finally {
                clearSectionCodeBlocksProcessed(hostSection);
            }
        },
        true
    );

    codeBlockRevealClickListenerInstalled = true;
}

function scheduleCodeBlockRefresh(reason = "unknown") {
    if (state.isCodeBlockRefreshScheduled) {
        return;
    }

    state.isCodeBlockRefreshScheduled = true;
    state.codeBlockRefreshTimer = null;

    scheduleUiPipelineTask(CODE_BLOCK_REFRESH_TASK, reason);
}

function reconcileDetachedCodeBlocks() {
    for (const entry of Array.from(state.detachedCodeBlocks.values())) {
        const { pre, placeholder } = entry;

        if (
            !(pre instanceof HTMLPreElement) ||
            !(placeholder instanceof HTMLElement)
        ) {
            state.detachedCodeBlocks.delete(entry.id);
            continue;
        }

        if (!placeholder.isConnected) {
            selfHealDetachedCodeBlockEntry(entry);
            continue;
        }

        if (
            !state.featureFlags.largeCodeBlockOptimization ||
            !state.featureFlags.codeBlockCollapse ||
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

function createClearCodeBlockAction(pre, { preserveExpanded = false, live = false } = {}) {
    return {
        type: "clear",
        pre,
        preserveExpanded,
        live,
    };
}

function createCollapseCodeBlockAction(pre, { detach }) {
    return {
        type: "collapse",
        pre,
        detach,
    };
}

function getSettledCodeBlockActions(section, providedCodeBlocks) {
    const codeBlocks = providedCodeBlocks ?? getCodeBlocksForSection(section);
    const actions = [];

    for (let i = 0; i < codeBlocks.length; i += 1) {
        const pre = codeBlocks[i];

        if (!isLargeCodeBlock(pre)) {
            actions.push(createClearCodeBlockAction(pre));
            continue;
        }

        if (pre.dataset.threadOptimizerCodeExpanded === "true") {
            actions.push(createClearCodeBlockAction(pre, {
                preserveExpanded: true,
                live: true,
            }));
            continue;
        }

        if (!state.featureFlags.codeBlockCollapse) {
            actions.push(createClearCodeBlockAction(pre, {
                preserveExpanded: true,
                live: true,
            }));
            continue;
        }

        actions.push(createCollapseCodeBlockAction(pre, { detach: true }));
    }

    return actions;
}

function getStreamingCodeBlockActions(section, providedCodeBlocks) {
    const codeBlocks = providedCodeBlocks ?? getCodeBlocksForSection(section);
    const actions = [];

    for (let i = 0; i < codeBlocks.length; i += 1) {
        const pre = codeBlocks[i];

        if (!isLargeCodeBlock(pre)) {
            actions.push(createClearCodeBlockAction(pre));
            continue;
        }

        if (pre.dataset.threadOptimizerCodeExpanded === "true") {
            actions.push(createClearCodeBlockAction(pre, {
                preserveExpanded: true,
                live: true,
            }));
            continue;
        }

        if (!state.featureFlags.codeBlockCollapse) {
            actions.push(createClearCodeBlockAction(pre, {
                preserveExpanded: true,
                live: true,
            }));
            continue;
        }

        actions.push(createCollapseCodeBlockAction(pre, { detach: false }));
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

function getSettledCodeBlockPlan(section, providedCodeBlocks) {
    const codeBlocks = providedCodeBlocks ?? getCodeBlocksForSection(section);

    return {
        section,
        codeBlocks,
        actions: getSettledCodeBlockActions(section, codeBlocks),
        codeBlockCount: codeBlocks.length,
        lastPre: codeBlocks[codeBlocks.length - 1] ?? null,
    };
}

export function getStreamingCodeBlockPlan(section, providedCodeBlocks) {
    const codeBlocks = providedCodeBlocks ?? getCodeBlocksForSection(section);

    return {
        section,
        codeBlocks,
        actions: getStreamingCodeBlockActions(section, codeBlocks),
        codeBlockCount: codeBlocks.length,
        lastPre: codeBlocks[codeBlocks.length - 1] ?? null,
    };
}

function applySettledCodeBlockPlan(plan) {
    const { section, codeBlocks, actions } = plan;

    if (codeBlocks.length === 0) {
        markSectionCodeBlocksProcessed(section);
        return;
    }

    clearLiveMarkersForCodeBlocks(codeBlocks);
    applyCodeBlockActions(actions);

    markSectionCodeBlocksProcessed(section);
}

function applyStreamingCodeBlockPlan(plan) {
    clearLiveMarkersForCodeBlocks(plan.codeBlocks);
    applyCodeBlockActions(plan.actions);
    clearSectionCodeBlocksProcessed(plan.section);
}

function processStreamingSection(section, codeBlocks) {
    const plan = getStreamingCodeBlockPlan(section, codeBlocks);

    applyStreamingCodeBlockPlan(plan);

    return plan;
}

function getStreamingSectionToProcess() {
    const latestAssistant = getLatestAssistantSection();

    if (
        latestAssistant?.isConnected &&
        isStreamingLatestAssistantSection(latestAssistant)
    ) {
        return latestAssistant;
    }

    return null;
}

function updateStreamingTrackingFromPlan(section, plan) {
    state.streamingCodeBlocks = plan.codeBlocks;
    state.streamingCodeBlockLastSection = section;
    state.streamingCodeBlockLastPre = plan.lastPre;
    state.streamingCodeBlockLastCount = plan.codeBlockCount;
}

function ensureStreamingObserverOnly(section) {
    state.streamingCodeBlockLastSection = section;
    state.streamingCodeBlockLastPre = null;
    state.streamingCodeBlockLastCount = 0;
    state.streamingCodeBlocks = [];

    syncStreamingStructureObserver();
}

/**
 * Keeps streaming code block tracking incremental.
 *
 * A full scan is expensive during token streaming, so mutations update the
 * tracked <pre> list when possible and only fall back to scans on section change.
 */
function syncStreamingStructureObserver() {
    const streamingSection = getStreamingSectionToProcess();

    if (!streamingSection || !isReplyStreaming()) {
        disconnectCodeBlockMutationObserver();
        resetStreamingObserverTracking();
        return;
    }

    ensureLiveCodeBlockMutationObserver({
        onRelevantStructureChange: (mutations) => {
            scheduleCodeBlockRefresh("streaming-codeblock-structure");

            const { codeBlocks, touchedPre } =
                updateStreamingCodeBlocksFromMutations(
                    streamingSection,
                    mutations
                );

            if (!touchedPre) {
                return;
            }

            if (codeBlocks.length === 0) {
                ensureStreamingObserverOnly(streamingSection);
                return;
            }

            const plan = processStreamingSection(streamingSection, codeBlocks);
            updateStreamingTrackingFromPlan(streamingSection, plan);
        },
    });
}

export function reconcileLatestStreamingAssistantCodeBlocksNow() {
    if (!state.featureFlags.largeCodeBlockOptimization || !isReplyStreaming()) {
        return;
    }

    const section = getStreamingSectionToProcess();
    if (!section) {
        return;
    }

    const codeBlocks = syncStreamingCodeBlocksFromFullScan(section);

    if (codeBlocks.length === 0) {
        ensureStreamingObserverOnly(section);
        return;
    }

    const lastPre = codeBlocks[codeBlocks.length - 1];

    const shouldProcess =
        section !== state.streamingCodeBlockLastSection ||
        lastPre !== state.streamingCodeBlockLastPre ||
        codeBlocks.length !== state.streamingCodeBlockLastCount;

    if (!shouldProcess) {
        syncStreamingStructureObserver();
        return;
    }

    const plan = processStreamingSection(section, codeBlocks);

    updateStreamingTrackingFromPlan(section, plan);
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

function collectSettledCodeBlockPlans(sections) {
    const plans = [];

    for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i];

        if (
            section instanceof HTMLElement &&
            !areSectionCodeBlocksProcessed(section)
        ) {
            plans.push(getSettledCodeBlockPlan(section));
        }
    }

    return plans;
}

function applySettledCodeBlockPlans(plans) {
    for (let i = 0; i < plans.length; i += 1) {
        applySettledCodeBlockPlan(plans[i]);
    }
}

function processSettledSections(sections) {
    const plans = collectSettledCodeBlockPlans(sections);

    applySettledCodeBlockPlans(plans);

    return plans.length;
}

export function refreshObservedCodeBlocks() {
    ensureCodeBlockRevealClickListener();
    removeInvalidNestedCodePlaceholders();
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
        const codeBlocks = getTrackedStreamingCodeBlocks(streamingSection);
        const plan = processStreamingSection(streamingSection, codeBlocks);

        updateStreamingTrackingFromPlan(streamingSection, plan);

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

registerUiPipelineTask(CODE_BLOCK_REFRESH_TASK, () => {
    try {
        refreshObservedCodeBlocks();
    } finally {
        state.isCodeBlockRefreshScheduled = false;
        state.codeBlockRefreshTimer = null;
    }
});

configureCodeBlockOptimization({
    scheduleRefresh: scheduleCodeBlockRefresh,
});