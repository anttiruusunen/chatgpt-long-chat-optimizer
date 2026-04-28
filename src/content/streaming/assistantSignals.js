export function hasResponseActions(section) {
    if (!(section instanceof Element)) return false;

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
    const matchedButtons = actionButtons.filter((button) =>
        actionLabels.has(button.getAttribute("aria-label") || "")
    );

    return matchedButtons.length > 0;
}

export function hasAssistantErrorState(section) {
    if (!(section instanceof HTMLElement)) return false;

    const text = section.textContent || "";

    return (
        text.includes("Something went wrong") ||
        text.includes("There was an error generating a response") ||
        Boolean(section.querySelector('[data-testid*="error"]')) ||
        Boolean(section.querySelector('[role="alert"]'))
    );
}

export function isLikelyComposerInput(target) {
    if (!(target instanceof HTMLElement)) return false;

    if (target.id === "prompt-textarea") return true;
    if (target.matches("textarea")) return true;
    if (target.getAttribute("contenteditable") === "true") return true;
    if (target.getAttribute("role") === "textbox") return true;

    const composerRoot = target.closest(
        '#prompt-textarea, textarea, [contenteditable="true"], [role="textbox"]'
    );

    return Boolean(composerRoot);
}

export function getClosestComposerSubmitButton(target) {
    if (!(target instanceof Element)) return null;

    return (
        target.closest("#composer-submit-button") ||
        target.closest('button[type="submit"]') ||
        target.closest('button[aria-label="Send message"]') ||
        target.closest('button[aria-label="Send"]')
    );
}