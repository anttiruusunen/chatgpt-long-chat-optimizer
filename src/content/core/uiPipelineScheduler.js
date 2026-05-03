import { scheduleDomWriteBatch } from "./domWriteBatch.js";
import { debugLog } from "./logger.js";

const registeredTasks = new Map();
const pendingTaskNames = new Set();
const pendingReasons = new Set();

let isUiPipelineScheduled = false;

export function registerUiPipelineTask(name, task) {
    if (!name || typeof task !== "function") {
        return;
    }

    registeredTasks.set(name, task);
}

/**
 * Schedules a named UI task to run in the next DOM write batch.
 *
 * Multiple requests for the same task are coalesced, while reasons are retained
 * for debug logs so we can understand what triggered the batch.
 */
export function scheduleUiPipelineTask(name, reason = "unknown") {
    if (!registeredTasks.has(name)) {
        debugLog("UI pipeline: skipped unknown task", {
            name,
            reason,
        });
        return;
    }

    pendingTaskNames.add(name);
    pendingReasons.add(reason);

    if (isUiPipelineScheduled) {
        debugLog("UI pipeline: coalesced task", {
            name,
            reason,
        });
        return;
    }

    isUiPipelineScheduled = true;

    scheduleDomWriteBatch(flushUiPipelineTasks);

    debugLog("UI pipeline: scheduled flush", {
        name,
        reason,
    });
}

/**
 * Flushes all pending UI pipeline tasks.
 *
 * This is intentionally task-level coalescing rather than callback-level
 * queuing: each subsystem gets one chance to reconcile its current state.
 */
export function flushUiPipelineTasks() {
    if (pendingTaskNames.size === 0) {
        isUiPipelineScheduled = false;
        return 0;
    }

    const taskNames = Array.from(pendingTaskNames);
    const reasons = Array.from(pendingReasons);

    pendingTaskNames.clear();
    pendingReasons.clear();
    isUiPipelineScheduled = false;

    let flushedCount = 0;

    for (let i = 0; i < taskNames.length; i += 1) {
        const name = taskNames[i];
        const task = registeredTasks.get(name);

        if (typeof task !== "function") {
            continue;
        }

        task({ reasons });
        flushedCount += 1;
    }

    debugLog("UI pipeline: flushed tasks", {
        taskNames,
        reasons,
        flushedCount,
    });

    return flushedCount;
}

export function resetUiPipelineSchedulerForTests() {
    pendingTaskNames.clear();
    pendingReasons.clear();
    isUiPipelineScheduled = false;
}