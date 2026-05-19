const ACTIVE_GENERATION_SELECTORS = [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop"]',
    '[data-testid="stop-button"]',
    '[data-testid="composer-stop-button"]',
    '[data-testid*="stop-generating"]',
    '[data-testid*="stop-streaming"]',
    '[data-testid*="thinking"]',
    '[data-testid*="loading"]',
    '[data-testid*="spinner"]',
    '[aria-busy="true"]',
    '[role="progressbar"]',
    '[data-streaming="true"]',
];

const ACTIVE_STATUS_SELECTORS = [
    '[role="status"]',
    '[aria-live]',
    '[data-testid*="status"]',
    '[data-testid*="thinking"]',
    '[data-testid*="loading"]',
];

const ACTIVE_STATUS_TEXT_PATTERNS = [
    /\bthinking\b/i,
    /\breasoning\b/i,
    /\banalyzing\b/i,
    /\bsearching\b/i,
    /\bworking\b/i,
    /\bgenerating\b/i,
];

const COMPOSER_SELECTOR =
    '#prompt-textarea, textarea, [contenteditable="true"], [role="textbox"]';

export function hasAssistantActiveGenerationState(root = document) {
    if (!(root instanceof Element) && root !== document) {
        return false;
    }

    for (const selector of ACTIVE_GENERATION_SELECTORS) {
        if (root.querySelector?.(selector)) {
            return true;
        }
    }

    const statusElements = Array.from(
        root.querySelectorAll?.(ACTIVE_STATUS_SELECTORS.join(",")) || []
    );

    return statusElements.some((element) => {
        const text = (element.textContent || "").trim();

        if (!text) {
            return false;
        }

        return ACTIVE_STATUS_TEXT_PATTERNS.some((pattern) =>
            pattern.test(text)
        );
    });
}

export function hasResponseActions(section) {
    if (!(section instanceof Element)) {
        return false;
    }

    if (
        section.querySelector('[aria-label="Response actions"]') ||
        section.querySelector('[data-testid="response-actions"]') ||
        section.querySelector('[data-testid="paragen-prefer-response-button"]')
    ) {
        return true;
    }

    const actionLabels = new Set([
        "Good response",
        "Bad response",
        "Read aloud",
    ]);

    const actionButtons = Array.from(section.querySelectorAll("button"));

    return actionButtons.some((button) =>
        actionLabels.has(button.getAttribute("aria-label") || "")
    );
}

export function hasAssistantErrorState(section) {
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    const text = section.textContent || "";

    return (
        text.includes("Something went wrong") ||
        text.includes("There was an error generating a response") ||
        Boolean(section.querySelector('[data-testid*="error"]')) ||
        Boolean(section.querySelector('[role="alert"]'))
    );
}

/**
 * A latest assistant section without response actions is treated as incomplete.
 *
 * This protects actively streaming / rehydrating replies from startup pruning,
 * including reloads where ChatGPT has not yet restored the final action row.
 */
export function isIncompleteAssistantSection(section) {
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    if (section.getAttribute("data-turn") !== "assistant") {
        return false;
    }

    if (hasAssistantActiveGenerationState(section)) {
        return true;
    }

    return !hasResponseActions(section) && !hasAssistantErrorState(section);
}

export function isLikelyComposerInput(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    if (target.id === "prompt-textarea") return true;
    if (target.matches("textarea")) return true;
    if (target.getAttribute("contenteditable") === "true") return true;
    if (target.getAttribute("role") === "textbox") return true;

    const composerRoot = target.closest(COMPOSER_SELECTOR);

    return Boolean(composerRoot);
}

export function getClosestComposerSubmitButton(target) {
    if (!(target instanceof Element)) {
        return null;
    }

    return (
        target.closest("#composer-submit-button") ||
        target.closest('button[type="submit"]') ||
        target.closest('button[aria-label="Send message"]') ||
        target.closest('button[aria-label="Send"]')
    );
}

export function getActiveComposerElement(root = document) {
    const active = document.activeElement;

    if (active instanceof HTMLElement && isLikelyComposerInput(active)) {
        return active.id === "prompt-textarea" || active.matches("textarea")
            ? active
            : active.closest(COMPOSER_SELECTOR) || active;
    }

    const composer = root.querySelector?.(COMPOSER_SELECTOR);

    return composer instanceof HTMLElement ? composer : null;
}

export function getComposerDraftText(root = document) {
    const composer = getActiveComposerElement(root);

    if (!(composer instanceof HTMLElement)) {
        return "";
    }

    if (
        composer instanceof HTMLTextAreaElement ||
        composer instanceof HTMLInputElement
    ) {
        return composer.value || "";
    }

    return composer.textContent || "";
}

export function hasActiveComposerDraft(root = document) {
    return getComposerDraftText(root).trim().length > 0;
}

function getTextPosition(root, targetOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, targetOffset);
    let lastTextNode = null;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        lastTextNode = node;

        const length = node.textContent?.length || 0;

        if (remaining <= length) {
            return {
                node,
                offset: remaining,
            };
        }

        remaining -= length;
    }

    if (lastTextNode) {
        return {
            node: lastTextNode,
            offset: lastTextNode.textContent?.length || 0,
        };
    }

    return {
        node: root,
        offset: root.childNodes.length,
    };
}

function getContentEditableSelectionOffset(root) {
    const selection = window.getSelection?.();

    if (!selection || selection.rangeCount === 0) {
        return null;
    }

    const range = selection.getRangeAt(0);

    if (
        !root.contains(range.startContainer) ||
        !root.contains(range.endContainer)
    ) {
        return null;
    }

    const beforeStart = document.createRange();
    beforeStart.selectNodeContents(root);
    beforeStart.setEnd(range.startContainer, range.startOffset);

    const beforeEnd = document.createRange();
    beforeEnd.selectNodeContents(root);
    beforeEnd.setEnd(range.endContainer, range.endOffset);

    return {
        start: beforeStart.toString().length,
        end: beforeEnd.toString().length,
    };
}

function getComposerSelectionOffset(composer) {
    if (
        composer instanceof HTMLTextAreaElement ||
        composer instanceof HTMLInputElement
    ) {
        return {
            start: composer.selectionStart ?? 0,
            end: composer.selectionEnd ?? composer.selectionStart ?? 0,
        };
    }

    return getContentEditableSelectionOffset(composer);
}

function moveContentEditableCaretToEnd(element) {
    const selection = window.getSelection?.();

    if (!selection) {
        return false;
    }

    const end = (element.textContent || "").length;
    const position = getTextPosition(element, end);
    const range = document.createRange();

    range.setStart(position.node, position.offset);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);

    return true;
}

export function moveActiveComposerCaretToEnd() {
    const composer = getActiveComposerElement();

    if (!(composer instanceof HTMLElement)) {
        return false;
    }

    const active = document.activeElement;
    const draftText = getComposerDraftText();
    const shouldTouchComposer =
        active === document.body ||
        active === document.documentElement ||
        (active instanceof HTMLElement && isLikelyComposerInput(active)) ||
        draftText.trim().length > 0;

    if (!shouldTouchComposer) {
        return false;
    }

    composer.focus?.({
        preventScroll: true,
    });

    if (
        composer instanceof HTMLTextAreaElement ||
        composer instanceof HTMLInputElement
    ) {
        const end = composer.value.length;
        composer.setSelectionRange?.(end, end);
        return true;
    }

    return moveContentEditableCaretToEnd(composer);
}

function shouldRepairComposerCaretAtStart() {
    const composer = getActiveComposerElement();

    if (!(composer instanceof HTMLElement)) {
        return false;
    }

    const draftText = getComposerDraftText();

    if (draftText.trim().length === 0) {
        return false;
    }

    const active = document.activeElement;

    if (!(active instanceof HTMLElement) || !isLikelyComposerInput(active)) {
        return false;
    }

    const offset = getComposerSelectionOffset(composer);

    if (!offset) {
        return false;
    }

    return offset.start === 0 && offset.end === 0;
}

function repairComposerCaretAtStart() {
    if (!shouldRepairComposerCaretAtStart()) {
        return false;
    }

    return moveActiveComposerCaretToEnd();
}

/**
 * Temporarily protects the ProseMirror composer during prune/store refresh.
 *
 * Selection changes are not cancellable, so this does not try to prevent
 * ChatGPT/ProseMirror from moving the caret. Instead, during the short prune
 * window, it repairs the specific bad state we see in production: draft text
 * exists and the focused composer selection jumps to offset 0.
 *
 * The beforeinput handler is the important part: it runs before the next typed
 * character is inserted, so it prevents "tGPT!Hi Chat" style corruption.
 */
export function installComposerCaretStartGuard() {
    let disposed = false;
    let repairFrame = null;

    function runRepair() {
        if (disposed) {
            return;
        }

        repairComposerCaretAtStart();
    }

    function scheduleRepair() {
        if (disposed || repairFrame !== null) {
            return;
        }

        repairFrame = requestAnimationFrame(() => {
            repairFrame = null;
            runRepair();
        });
    }

    function handleSelectionChange() {
        scheduleRepair();
    }

    function handleBeforeInput(event) {
        const target = event.target;

        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (!isLikelyComposerInput(target)) {
            return;
        }

        runRepair();
    }

    document.addEventListener("selectionchange", handleSelectionChange, true);
    document.addEventListener("beforeinput", handleBeforeInput, true);

    return () => {
        if (disposed) {
            return;
        }

        disposed = true;

        if (repairFrame !== null) {
            cancelAnimationFrame(repairFrame);
            repairFrame = null;
        }

        document.removeEventListener(
            "selectionchange",
            handleSelectionChange,
            true
        );
        document.removeEventListener("beforeinput", handleBeforeInput, true);
    };
}

export function releaseComposerCaretStartGuardAfterDomSettles(cleanup) {
    if (typeof cleanup !== "function") {
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            cleanup();
        });
    });
}

export function hasAssistantFeedbackState(section) {
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    const text = section.textContent || "";

    return (
        Boolean(section.querySelector('[data-testid="paragen-feedback-title"]')) ||
        Boolean(section.querySelector('[data-paragen-root="true"]')) ||
        text.includes("You're giving feedback on a new version of ChatGPT") ||
        text.includes("Which response do you prefer?")
    );
}