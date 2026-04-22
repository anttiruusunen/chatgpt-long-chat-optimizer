import { state } from "../core/state.js";
import { clearCodeBlockOffscreenOptimization } from "./offscreenShared.js";
import {
    getPlaceholderId,
    getPlaceholderIdForPre,
    setPlaceholderIdForPre,
    clearPlaceholderIdForPre,
    getPlaceholderById,
    setPlaceholderVisibility,
} from "./codeBlockPlaceholders.js";

let scheduleRefreshCallback = null;

export function configureDetachStore({ scheduleRefresh } = {}) {
    if (typeof scheduleRefresh === "function") {
        scheduleRefreshCallback = scheduleRefresh;
    }
}

export function getDetachedEntryForPlaceholder(placeholder) {
    const id = getPlaceholderId(placeholder);
    if (!id) return null;
    return state.detachedCodeBlocks.get(id) ?? null;
}

export function getDetachedEntryForPre(pre) {
    const id = getPlaceholderIdForPre(pre);
    if (!id) return null;
    return state.detachedCodeBlocks.get(id) ?? null;
}

export function storeDetachedCodeBlock(pre, placeholder) {
    const id = getPlaceholderId(placeholder);
    setPlaceholderIdForPre(pre, id);
    setPlaceholderVisibility(placeholder, true);

    state.detachedCodeBlocks.set(id, {
        id,
        pre,
        placeholder,
    });

    return id;
}

function normalizeRevealedCodeBlockLayout(pre) {
    if (!(pre instanceof HTMLPreElement)) return;

    pre.style.display = "block";
    pre.style.position = "relative";
    pre.style.zIndex = "auto";
    pre.style.marginTop = "8px";
    pre.style.marginBottom = "8px";
    pre.style.clear = "both";
    pre.style.maxWidth = "100%";
}

export function restoreDetachedCodeBlockEntry(
    entry,
    { removePlaceholder = true, preserveExpanded = true } = {}
) {
    if (!entry) return null;

    const { pre, placeholder } = entry;
    const placeholderId = entry.id ?? getPlaceholderId(placeholder);

    if (placeholder?.parentElement && pre.parentElement !== placeholder.parentElement) {
        placeholder.parentElement.insertBefore(pre, placeholder.nextSibling);
    }

    if (removePlaceholder) {
        setPlaceholderVisibility(placeholder, false);
    }

    pre.style.display = "";
    pre.removeAttribute("data-thread-optimizer-code-collapsed");
    clearCodeBlockOffscreenOptimization(pre);
    normalizeRevealedCodeBlockLayout(pre);

    if (!preserveExpanded) {
        delete pre.dataset.threadOptimizerCodeExpanded;
    }

    if (placeholderId) {
        state.detachedCodeBlocks.delete(placeholderId);
    }

    return pre;
}

export function restoreAllDetachedCodeBlocks({ preserveExpanded = true } = {}) {
    for (const entry of Array.from(state.detachedCodeBlocks.values())) {
        restoreDetachedCodeBlockEntry(entry, {
            removePlaceholder: true,
            preserveExpanded,
        });
    }
}

export function clearCollapsedCodeBlock(pre, { preserveExpanded = true } = {}) {
    const detachedEntry = getDetachedEntryForPre(pre);

    if (detachedEntry) {
        restoreDetachedCodeBlockEntry(detachedEntry, {
            removePlaceholder: true,
            preserveExpanded,
        });
        return;
    }

    const placeholder = getPlaceholderById(getPlaceholderIdForPre(pre));
    setPlaceholderVisibility(placeholder, false);

    pre.style.display = "";
    pre.removeAttribute("data-thread-optimizer-code-collapsed");
    normalizeRevealedCodeBlockLayout(pre);

    if (!preserveExpanded) {
        delete pre.dataset.threadOptimizerCodeExpanded;
        clearPlaceholderIdForPre(pre);
    }
}

export function revealCollapsedCodeBlockFromPlaceholder(placeholder) {
    const detachedEntry = getDetachedEntryForPlaceholder(placeholder);
    if (detachedEntry) {
        detachedEntry.pre.dataset.threadOptimizerCodeExpanded = "true";
        restoreDetachedCodeBlockEntry(detachedEntry, {
            removePlaceholder: true,
            preserveExpanded: true,
        });
        scheduleRefreshCallback?.();
        return;
    }

    const placeholderId = getPlaceholderId(placeholder);
    if (!placeholderId) return;

    const pre = Array.from(document.querySelectorAll("pre")).find(
        (candidate) => getPlaceholderIdForPre(candidate) === placeholderId
    );

    if (!(pre instanceof HTMLPreElement)) return;

    pre.dataset.threadOptimizerCodeExpanded = "true";
    clearCollapsedCodeBlock(pre, { preserveExpanded: true });
    scheduleRefreshCallback?.();
}