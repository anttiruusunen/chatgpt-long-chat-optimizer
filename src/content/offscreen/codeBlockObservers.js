import { state } from "../core/state.js";
import { getLatestAssistantSection } from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import { hasResponseActions } from "../streaming/assistantSignals.js";

function isPreElement(node) {
    return node instanceof HTMLPreElement;
}

function nodeContainsPre(node) {
    return node instanceof Element && Boolean(node.querySelector("pre"));
}

function nodeIsOrContainsMarkdown(node) {
    if (!(node instanceof Element)) return false;
    return node.classList.contains("markdown") || Boolean(node.querySelector(".markdown"));
}

export function latestAssistantHasResponseActions() {
    const latestAssistant = getLatestAssistantSection();
    if (!latestAssistant) return false;
    return hasResponseActions(latestAssistant);
}

export function isStreamingLatestAssistantSection(section) {
    const latestAssistant = getLatestAssistantSection();
    if (!latestAssistant || section !== latestAssistant) return false;
    return !latestAssistantHasResponseActions();
}

function getLatestAssistantMarkdownRoot() {
    const latestAssistant = getLatestAssistantSection();
    if (!(latestAssistant instanceof HTMLElement)) {
        return null;
    }

    const markdown = latestAssistant.querySelector(".markdown");
    return markdown instanceof HTMLElement ? markdown : null;
}

function findRelevantMarkdownMutation(mutations) {
    for (const mutation of mutations) {
        if (mutation.type !== "childList") {
            continue;
        }

        for (const node of mutation.addedNodes) {
            if (isPreElement(node) || nodeContainsPre(node) || nodeIsOrContainsMarkdown(node)) {
                return true;
            }
        }

        for (const node of mutation.removedNodes) {
            if (isPreElement(node) || nodeContainsPre(node) || nodeIsOrContainsMarkdown(node)) {
                return true;
            }
        }
    }

    return false;
}

export function disconnectCodeBlockStructureObserver() {
    if (state.codeBlockStructureObserver) {
        state.codeBlockStructureObserver.disconnect();
        state.codeBlockStructureObserver = null;
    }

    state.observedCodeBlockStructureRoot = null;
    state.observedCodeBlockStructureSection = null;
    debugLog("Offscreen code blocks: disconnected structure observer");
}

export function ensureLiveCodeBlockStructureObserver({
    onRelevantStructureChange,
} = {}) {
    const latestAssistant = getLatestAssistantSection();

    if (!latestAssistant?.isConnected || !isStreamingLatestAssistantSection(latestAssistant)) {
        disconnectCodeBlockStructureObserver();
        return {
            mode: "disconnected",
            rootType: null,
        };
    }

    const markdownRoot = getLatestAssistantMarkdownRoot();
    const root = markdownRoot ?? latestAssistant;
    const rootType = markdownRoot ? "markdown" : "assistant";

    if (
        state.codeBlockStructureObserver &&
        state.observedCodeBlockStructureRoot === root &&
        state.observedCodeBlockStructureSection === latestAssistant
    ) {
        return {
            mode: "attached",
            rootType,
        };
    }

    disconnectCodeBlockStructureObserver();

    state.codeBlockStructureObserver = new MutationObserver((mutations) => {
        if (!findRelevantMarkdownMutation(mutations)) {
            return;
        }

        onRelevantStructureChange?.();
    });

    state.codeBlockStructureObserver.observe(root, {
        childList: true,
        subtree: true,
    });

    state.observedCodeBlockStructureRoot = root;
    state.observedCodeBlockStructureSection = latestAssistant;

    debugLog("Offscreen code blocks: attached structure observer", {
        rootType,
    });

    return {
        mode: "attached",
        rootType,
    };
}

export const ensureLiveCodeBlockMutationObserver =
    ensureLiveCodeBlockStructureObserver;

export const disconnectCodeBlockMutationObserver =
    disconnectCodeBlockStructureObserver;