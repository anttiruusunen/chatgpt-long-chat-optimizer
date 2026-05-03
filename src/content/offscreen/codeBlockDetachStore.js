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

/**
 * Records a detached <pre> together with enough DOM context to restore it.
 *
 * The placeholder keeps the layout stable while the heavy code block is
 * removed from the live DOM.
 */
export function storeDetachedCodeBlock(pre, placeholder) {
    const id = getPlaceholderId(placeholder);

    setPlaceholderIdForPre(pre, id);
    setPlaceholderVisibility(placeholder, true);

    state.detachedCodeBlocks.set(id, {
        id,
        pre,
        placeholder,
        originalParent: pre.parentElement,
        originalNextSibling: pre.nextSibling,
    });

    return id;
}

function normalizeRevealedCodeBlockLayout(pre) {
    if (!(pre instanceof HTMLPreElement)) {
        return;
    }

    pre.style.display = "block";
    pre.style.position = "relative";
    pre.style.zIndex = "auto";
    pre.style.marginTop = "8px";
    pre.style.marginBottom = "8px";
    pre.style.clear = "both";
    pre.style.maxWidth = "100%";
}

/**
 * Restores a detached code block next to its placeholder.
 *
 * `preserveExpanded` keeps user intent across refreshes so an explicitly
 * revealed code block is not collapsed again immediately.
 */
export function restoreDetachedCodeBlockEntry(
    entry,
    {
        removePlaceholder = true,
        preserveExpanded = true,
    } = {}
) {
    if (!entry) return null;

    const { pre, placeholder } = entry;
    const placeholderId = entry.id ?? getPlaceholderId(placeholder);

    if (
        placeholder?.parentElement &&
        pre.parentElement !== placeholder.parentElement
    ) {
        placeholder.parentElement.insertBefore(pre, placeholder.nextSibling);
    }

    if (removePlaceholder) {
        setPlaceholderVisibility(placeholder, false);

        if (placeholder?.isConnected) {
            placeholder.remove();
        }

        clearPlaceholderIdForPre(pre);
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

export function restoreAllDetachedCodeBlocks({
    preserveExpanded = true,
} = {}) {
    for (const entry of Array.from(state.detachedCodeBlocks.values())) {
        restoreDetachedCodeBlockEntry(entry, {
            removePlaceholder: true,
            preserveExpanded,
        });
    }
}

export function clearCollapsedCodeBlock(
    pre,
    {
        preserveExpanded = true,
    } = {}
) {
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

    if (placeholder?.isConnected) {
        placeholder.remove();
    }

    pre.style.display = "";
    pre.removeAttribute("data-thread-optimizer-code-collapsed");
    normalizeRevealedCodeBlockLayout(pre);

    if (!preserveExpanded) {
        delete pre.dataset.threadOptimizerCodeExpanded;
        clearPlaceholderIdForPre(pre);
    }
}

/**
 * Reveals a collapsed code block from its placeholder.
 *
 * Handles both optimized cases:
 * - the <pre> was fully detached and tracked in state.detachedCodeBlocks
 * - the <pre> is still present but hidden/collapsed in the DOM
 */
export function revealCollapsedCodeBlockFromPlaceholder(placeholder) {
    if (!(placeholder instanceof HTMLElement)) {
        return;
    }

    const placeholderId = getPlaceholderId(placeholder);

    if (!placeholderId) {
        setPlaceholderVisibility(placeholder, false);

        if (placeholder.isConnected) {
            placeholder.remove();
        }

        scheduleRefreshCallback?.();
        return;
    }

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

    const matchingPre = Array.from(document.querySelectorAll("pre")).find(
        (candidate) =>
            candidate instanceof HTMLPreElement &&
            getPlaceholderIdForPre(candidate) === placeholderId
    );

    if (matchingPre instanceof HTMLPreElement) {
        matchingPre.dataset.threadOptimizerCodeExpanded = "true";

        clearCollapsedCodeBlock(matchingPre, {
            preserveExpanded: true,
        });

        scheduleRefreshCallback?.();
        return;
    }

    setPlaceholderVisibility(placeholder, false);

    if (placeholder.isConnected) {
        placeholder.remove();
    }

    state.detachedCodeBlocks.delete(placeholderId);
    scheduleRefreshCallback?.();
}

/**
 * Repairs stale detached-code-block state.
 *
 * This can happen if ChatGPT mutates the surrounding DOM while a block is
 * detached. We either restore the <pre> to its original parent or discard the
 * stale entry if that parent no longer exists.
 */
export function selfHealDetachedCodeBlockEntry(entry) {
    if (!entry) return null;

    const { pre } = entry;

    if (!(pre instanceof HTMLPreElement)) {
        state.detachedCodeBlocks.delete(entry.id);
        return null;
    }

    const parent =
        entry.originalParent instanceof HTMLElement &&
        entry.originalParent.isConnected
            ? entry.originalParent
            : null;

    if (!(parent instanceof HTMLElement)) {
        state.detachedCodeBlocks.delete(entry.id);
        clearPlaceholderIdForPre(pre);
        return null;
    }

    const before =
        entry.originalNextSibling instanceof Node &&
        entry.originalNextSibling.isConnected &&
        entry.originalNextSibling.parentElement === parent
            ? entry.originalNextSibling
            : null;

    parent.insertBefore(pre, before);

    pre.style.display = "";
    pre.removeAttribute("data-thread-optimizer-code-collapsed");
    clearCodeBlockOffscreenOptimization(pre);
    normalizeRevealedCodeBlockLayout(pre);
    clearPlaceholderIdForPre(pre);
    delete pre.dataset.threadOptimizerCodeExpanded;

    state.detachedCodeBlocks.delete(entry.id);

    return pre;
}