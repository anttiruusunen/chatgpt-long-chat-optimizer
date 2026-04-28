import { state } from "../core/state.js";
import { getLatestAssistantSection } from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import {
    hasResponseActions,
    hasAssistantErrorState,
    isLikelyComposerInput,
    getClosestComposerSubmitButton,
} from "./assistantSignals.js";

let onReplyStartedCallback = null;
let onReplySettledCallback = null;

function latestAssistantHasSettledSignal() {
    const latestAssistant = getLatestAssistantSection();
    if (!latestAssistant) return false;

    return (
        hasResponseActions(latestAssistant) ||
        hasAssistantErrorState(latestAssistant)
    );
}

export function isReplyStreaming() {
    return Boolean(state.replyTiming?.pending);
}

function stopReplyCompletionPoll() {
    if (state.replyTimingCompletePollTimer) {
        clearInterval(state.replyTimingCompletePollTimer);
        state.replyTimingCompletePollTimer = null;
    }
}

function startReplyTimer(trigger) {
    if (isReplyStreaming()) return;

    state.replyTiming.pending = true;
    state.replyTiming.startedAt = performance.now();
    state.replyTiming.completedAt = 0;
    state.replyTiming.lastDurationMs = 0;
    state.replyTiming.trigger = trigger;

    debugLog("Reply timing: started", { trigger });

    onReplyStartedCallback?.();
    ensureReplyCompletionPoll();
}

function finishReplyTimerIfPending(source) {
    if (!isReplyStreaming() || !state.replyTiming.startedAt) return;

    state.replyTiming.completedAt = performance.now();
    state.replyTiming.lastDurationMs =
        state.replyTiming.completedAt - state.replyTiming.startedAt;
    state.replyTiming.pending = false;

    debugLog("Reply timing: completed", {
        trigger: state.replyTiming.trigger,
        source,
        durationMs: Math.round(state.replyTiming.lastDurationMs),
        durationSeconds: (state.replyTiming.lastDurationMs / 1000).toFixed(2),
    });

    onReplySettledCallback?.();
}

export function ensureReplyCompletionPoll() {
    if (state.replyTimingCompletePollTimer) return;

    state.replyTimingCompletePollTimer = setInterval(() => {
        if (!isReplyStreaming()) {
            stopReplyCompletionPoll();
            return;
        }

        if (!latestAssistantHasSettledSignal()) {
            return;
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                finishReplyTimerIfPending("ui-settled");
                stopReplyCompletionPoll();
            });
        });
    }, 200);
}

function handleComposerKeydown(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!isLikelyComposerInput(target)) return;
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (event.isComposing) return;

    startReplyTimer("textarea-enter");
}

function handleComposerClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = getClosestComposerSubmitButton(target);
    if (!button) return;

    startReplyTimer("submit-button");
}

export function installReplyTimingListeners({
    onReplyStarted,
    onReplySettled,
} = {}) {
    onReplyStartedCallback =
        typeof onReplyStarted === "function" ? onReplyStarted : null;
    onReplySettledCallback =
        typeof onReplySettled === "function" ? onReplySettled : null;

    if (state.replyTimingListenersInstalled) return;

    document.addEventListener("keydown", handleComposerKeydown, true);
    document.addEventListener("click", handleComposerClick, true);
    state.replyTimingListenersInstalled = true;
}