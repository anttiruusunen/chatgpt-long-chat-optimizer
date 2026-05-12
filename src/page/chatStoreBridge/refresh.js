import { getStoreCurrentLeafId } from "./common.js";

export function nudgeComposerReactState({
    reason = "store-prune-refresh",
    removeDelayMs = 80,
} = {}) {
    const result = {
        ok: false,
        reason,
        attempted: [],
    };

    const selectors = [
        "#prompt-textarea",
        '[data-testid="composer"] textarea',
        '[data-testid="composer"] [contenteditable="true"]',
        "textarea",
        '[contenteditable="true"]',
    ];

    let composer = null;

    for (const selector of selectors) {
        const candidate = document.querySelector(selector);

        if (
            candidate instanceof HTMLTextAreaElement ||
            candidate instanceof HTMLInputElement ||
            candidate?.isContentEditable
        ) {
            composer = candidate;
            break;
        }
    }

    if (!composer) {
        result.attempted.push({
            method: "find-composer",
            ok: false,
            reason: "composer not found",
        });

        return result;
    }

    const space = " ";

    function fireKeyboard(target, type, key = " ") {
        target.dispatchEvent(
            new KeyboardEvent(type, {
                bubbles: true,
                cancelable: true,
                key,
                code: key === "Backspace" ? "Backspace" : "Space",
                keyCode: key === "Backspace" ? 8 : 32,
                which: key === "Backspace" ? 8 : 32,
            })
        );
    }

    function fireBeforeInput(target, inputType, data) {
        target.dispatchEvent(
            new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType,
                data,
            })
        );
    }

    function fireInput(target, inputType, data) {
        target.dispatchEvent(
            new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                inputType,
                data,
            })
        );
    }

    function fireChange(target) {
        target.dispatchEvent(
            new Event("change", {
                bubbles: true,
                cancelable: true,
            })
        );
    }

    try {
        composer.focus?.({ preventScroll: true });
    } catch {}

    if (
        composer instanceof HTMLTextAreaElement ||
        composer instanceof HTMLInputElement
    ) {
        try {
            const originalValue = composer.value;
            const originalSelectionStart = composer.selectionStart;
            const originalSelectionEnd = composer.selectionEnd;
            const originalScrollTop = composer.scrollTop;

            const valueSetter = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(composer),
                "value"
            )?.set;

            if (typeof valueSetter !== "function") {
                throw new Error("native value setter unavailable");
            }

            fireKeyboard(composer, "keydown", " ");
            fireBeforeInput(composer, "insertText", space);

            valueSetter.call(composer, originalValue + space);

            fireInput(composer, "insertText", space);
            fireKeyboard(composer, "keyup", " ");

            window.setTimeout(() => {
                try {
                    fireKeyboard(composer, "keydown", "Backspace");
                    fireBeforeInput(composer, "deleteContentBackward", null);

                    valueSetter.call(composer, originalValue);

                    fireInput(composer, "deleteContentBackward", null);
                    fireKeyboard(composer, "keyup", "Backspace");
                    fireChange(composer);

                    try {
                        if (
                            Number.isFinite(originalSelectionStart) &&
                            Number.isFinite(originalSelectionEnd)
                        ) {
                            composer.setSelectionRange(
                                originalSelectionStart,
                                originalSelectionEnd
                            );
                        }

                        composer.scrollTop = originalScrollTop;
                    } catch {}
                } catch (error) {
                    console.debug("[thread-optimizer bridge] composer space removal failed", {
                        reason,
                        error: String(error?.message || error),
                    });
                }
            }, removeDelayMs);

            result.ok = true;
            result.attempted.push({
                method: "textarea-real-space-roundtrip",
                ok: true,
                removeDelayMs,
            });

            return result;
        } catch (error) {
            result.attempted.push({
                method: "textarea-real-space-roundtrip",
                ok: false,
                message: String(error?.message || error),
            });
        }
    }

    if (composer?.isContentEditable) {
        try {
            const originalHtml = composer.innerHTML;
            const originalText = composer.textContent || "";

            fireKeyboard(composer, "keydown", " ");
            fireBeforeInput(composer, "insertText", space);

            composer.textContent = originalText + space;

            fireInput(composer, "insertText", space);
            fireKeyboard(composer, "keyup", " ");

            window.setTimeout(() => {
                try {
                    fireKeyboard(composer, "keydown", "Backspace");
                    fireBeforeInput(composer, "deleteContentBackward", null);

                    composer.innerHTML = originalHtml;

                    fireInput(composer, "deleteContentBackward", null);
                    fireKeyboard(composer, "keyup", "Backspace");
                    fireChange(composer);
                } catch (error) {
                    console.debug("[thread-optimizer bridge] contenteditable space removal failed", {
                        reason,
                        error: String(error?.message || error),
                    });
                }
            }, removeDelayMs);

            result.ok = true;
            result.attempted.push({
                method: "contenteditable-real-space-roundtrip",
                ok: true,
                removeDelayMs,
            });

            return result;
        } catch (error) {
            result.attempted.push({
                method: "contenteditable-real-space-roundtrip",
                ok: false,
                message: String(error?.message || error),
            });
        }
    }

    return result;
}

export function requestStoreBackedConversationRefresh(
    store,
    {
        reason = "store-prune-refresh",
        currentLeafId = null,
    } = {}
) {
    const result = {
        ok: false,
        reason,
        attempted: [],
    };

    if (!store) {
        result.reason = "store unavailable";
        return result;
    }

    const leafId =
        currentLeafId ||
        getStoreCurrentLeafId(store);

    if (leafId && typeof store.setCurrentLeafId === "function") {
        try {
            store.setCurrentLeafId(leafId);

            result.ok = true;
            result.attempted.push({
                method: "setCurrentLeafId",
                ok: true,
                leafId,
            });
        } catch (error) {
            result.attempted.push({
                method: "setCurrentLeafId",
                ok: false,
                message: String(error?.message || error),
            });
        }
    }

    if (typeof store.getBranch === "function") {
        try {
            store.getBranch(leafId);

            result.attempted.push({
                method: "getBranch",
                ok: true,
                leafId,
            });
        } catch (error) {
            result.attempted.push({
                method: "getBranch",
                ok: false,
                message: String(error?.message || error),
            });
        }
    }

    try {
        window.dispatchEvent(
            new CustomEvent("thread-optimizer:store-pruned", {
                detail: {
                    reason,
                    currentLeafId: leafId,
                },
            })
        );

        result.attempted.push({
            method: "window.dispatchEvent",
            ok: true,
        });
    } catch (error) {
        result.attempted.push({
            method: "window.dispatchEvent",
            ok: false,
            message: String(error?.message || error),
        });
    }

    const composerNudgeResult = nudgeComposerReactState({
        reason,
    });

    result.attempted.push({
        method: "nudgeComposerReactState",
        ok: composerNudgeResult.ok,
        result: composerNudgeResult,
    });

    if (composerNudgeResult.ok) {
        result.ok = true;
    }

    return result;
}