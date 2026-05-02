import {
    state,
    CODE_BLOCK_PLACEHOLDER_ATTR,
} from "../core/state.js";

const PLACEHOLDER_ID_ATTR = "data-thread-optimizer-code-placeholder-id";
const PRE_PLACEHOLDER_ID_DATASET_KEY = "threadOptimizerCodePlaceholderId";
const PLACEHOLDER_HIDDEN_ATTR = "data-thread-optimizer-code-placeholder-hidden";
const REVEAL_BUTTON_ATTR = "data-thread-optimizer-code-reveal";

function isCodeBlockPlaceholderElement(element) {
    return (
        element instanceof HTMLElement &&
        element.getAttribute(CODE_BLOCK_PLACEHOLDER_ATTR) === "true"
    );
}

function getNormalizedCodeBlockText(pre) {
    if (!(pre instanceof HTMLPreElement)) {
        return "";
    }

    return (pre.textContent ?? "")
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
        .trim();
}

export function getCodeBlockTextLength(pre) {
    if (!(pre instanceof HTMLPreElement)) {
        return 0;
    }

    return (pre.textContent ?? "").length;
}

export function isLargeCodeBlock(pre) {
    if (!state.featureFlags.largeCodeBlockOptimization) {
        return false;
    }

    const normalizedText = getNormalizedCodeBlockText(pre);
    return normalizedText.length > 0;
}

export function getPlaceholderId(placeholder) {
    if (!(placeholder instanceof HTMLElement)) {
        return null;
    }

    return placeholder.getAttribute(PLACEHOLDER_ID_ATTR);
}

export function ensurePlaceholderId(placeholder) {
    const existingId = getPlaceholderId(placeholder);
    if (existingId) {
        return existingId;
    }

    const id = String(state.nextDetachedCodeBlockId ?? 1);
    state.nextDetachedCodeBlockId = Number(id) + 1;
    placeholder.setAttribute(PLACEHOLDER_ID_ATTR, id);
    return id;
}

export function getPlaceholderIdForPre(pre) {
    if (!(pre instanceof HTMLPreElement)) {
        return null;
    }

    return pre.dataset[PRE_PLACEHOLDER_ID_DATASET_KEY] ?? null;
}

export function setPlaceholderIdForPre(pre, id) {
    if (!(pre instanceof HTMLPreElement)) {
        return;
    }

    if (!id) {
        delete pre.dataset[PRE_PLACEHOLDER_ID_DATASET_KEY];
        return;
    }

    pre.dataset[PRE_PLACEHOLDER_ID_DATASET_KEY] = String(id);
}

export function clearPlaceholderIdForPre(pre) {
    if (!(pre instanceof HTMLPreElement)) {
        return;
    }

    delete pre.dataset[PRE_PLACEHOLDER_ID_DATASET_KEY];
}

export function getPlaceholderById(id) {
    if (!id) return null;

    const placeholders = document.querySelectorAll(`[${PLACEHOLDER_ID_ATTR}]`);
    for (let i = 0; i < placeholders.length; i += 1) {
        const placeholder = placeholders[i];
        if (
            placeholder instanceof HTMLElement &&
            placeholder.getAttribute(PLACEHOLDER_ID_ATTR) === String(id)
        ) {
            return placeholder;
        }
    }

    return null;
}

export function isRevealButtonElement(target) {
    return (
        target instanceof Element &&
        target.matches(`button[${REVEAL_BUTTON_ATTR}="true"]`)
    );
}

export function getRevealButtonForPlaceholder(placeholder) {
    if (!(placeholder instanceof HTMLElement)) {
        return null;
    }

    return placeholder.querySelector(`button[${REVEAL_BUTTON_ATTR}="true"]`);
}

export function createCodeBlockPlaceholder() {
    const placeholder = document.createElement("div");
    placeholder.setAttribute(CODE_BLOCK_PLACEHOLDER_ATTR, "true");
    placeholder.setAttribute(PLACEHOLDER_HIDDEN_ATTR, "false");

    const label = document.createElement("span");
    label.textContent = "Code block hidden";

    const spacer = document.createTextNode(" ");

    const revealButton = document.createElement("button");
    revealButton.type = "button";
    revealButton.setAttribute(REVEAL_BUTTON_ATTR, "true");
    revealButton.textContent = "Show code block";

    placeholder.appendChild(label);
    placeholder.appendChild(spacer);
    placeholder.appendChild(revealButton);

    ensurePlaceholderId(placeholder);
    return placeholder;
}

export function updatePlaceholderLabel(placeholder) {
    if (!(placeholder instanceof HTMLElement)) {
        return;
    }

    const label =
        placeholder.firstElementChild instanceof HTMLElement
            ? placeholder.firstElementChild
            : null;

    if (label && label.textContent !== "Code block hidden") {
        label.textContent = "Code block hidden";
    }

    const button = getRevealButtonForPlaceholder(placeholder);
    if (button && button.textContent !== "Show code block") {
        button.textContent = "Show code block";
    }
}

export function setPlaceholderVisibility(placeholder, visible) {
    if (!(placeholder instanceof HTMLElement)) {
        return;
    }

    const isVisible = Boolean(visible);
    placeholder.hidden = !isVisible;
    placeholder.setAttribute(
        PLACEHOLDER_HIDDEN_ATTR,
        isVisible ? "false" : "true"
    );
}

export function isPlaceholderHidden(placeholder) {
    if (!(placeholder instanceof HTMLElement)) {
        return true;
    }

    return (
        placeholder.hidden ||
        placeholder.getAttribute(PLACEHOLDER_HIDDEN_ATTR) === "true"
    );
}

export function ensurePlaceholderForPre(pre) {
    if (!(pre instanceof HTMLPreElement)) {
        return null;
    }

    const existingId = getPlaceholderIdForPre(pre);
    const existingPlaceholder = getPlaceholderById(existingId);

    if (existingPlaceholder instanceof HTMLElement && existingPlaceholder.isConnected) {
        setPlaceholderVisibility(existingPlaceholder, true);
        return existingPlaceholder;
    }

    const siblingCandidates = [
        pre.previousElementSibling,
        pre.nextElementSibling,
    ];

    for (const candidate of siblingCandidates) {
        if (!isCodeBlockPlaceholderElement(candidate)) {
            continue;
        }

        const candidateId = getPlaceholderId(candidate);

        if (candidateId && candidateId === existingId) {
            setPlaceholderVisibility(candidate, true);
            return candidate;
        }
    }

    const placeholder = createCodeBlockPlaceholder();
    const id = ensurePlaceholderId(placeholder);

    setPlaceholderIdForPre(pre, id);

    if (pre.parentElement) {
        pre.parentElement.insertBefore(placeholder, pre);
    }

    setPlaceholderVisibility(placeholder, true);

    return placeholder;
}