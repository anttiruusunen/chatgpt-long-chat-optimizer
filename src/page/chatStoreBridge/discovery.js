import { CONFIG } from "./config.js";
import { isObjectLike } from "./common.js";
import {
    hasAnyStoreMethodName,
    looksLikeStore,
    rejectStore,
    scoreStoreCandidate,
    validateStoreCandidate,
} from "./storeValidation.js";

const objectToString = Object.prototype.toString;

export function shouldSkipObjectGraphValue(value) {
    const type = typeof value;
    if (value === null || (type !== "object" && type !== "function")) return true;

    try {
        if (
            value instanceof Node ||
            value instanceof Window ||
            value instanceof Document ||
            value instanceof Event ||
            value instanceof EventTarget ||
            value instanceof Animation ||
            value instanceof FontFace ||
            value instanceof ReadableStream ||
            value instanceof WritableStream ||
            value instanceof TransformStream ||
            value instanceof WritableStreamDefaultWriter ||
            value instanceof ViewTransition
        ) {
            return true;
        }
    } catch {}

    const tag = objectToString.call(value);

    return (
        tag.includes("Window") ||
        tag.includes("Document") ||
        tag.includes("Event") ||
        tag.includes("Stream") ||
        tag.includes("Animation") ||
        tag.includes("Transition") ||
        tag.includes("FontFace") ||
        tag.includes("GPU")
    );
}

export function getFiberRoots() {
    const roots = [];
    const seenRoots = new WeakSet();

    const pushRoot = (value) => {
        if (!isObjectLike(value)) return;
        if (seenRoots.has(value)) return;

        seenRoots.add(value);
        roots.push(value);
    };

    const rootCandidates = [
        document.querySelector("main"),
        document.querySelector('[role="main"]'),
        document.querySelector('[data-testid="conversation"]'),
        document.querySelector('[data-testid^="conversation-turn-"]')?.closest("main"),
        document.querySelector("#__next"),
        document.body,
    ].filter(Boolean);

    const seenElements = new WeakSet();

    for (const rootEl of rootCandidates) {
        const all = [rootEl, ...rootEl.querySelectorAll("*")];

        for (let i = 0; i < all.length; i += 1) {
            const el = all[i];

            if (!el || el.nodeType !== 1) continue;
            if (seenElements.has(el)) continue;
            seenElements.add(el);

            const keys = Object.keys(el);

            for (let j = 0; j < keys.length; j += 1) {
                const key = keys[j];

                if (
                    key.charCodeAt(0) !== 95 ||
                    (
                        !key.startsWith("__reactFiber$") &&
                        !key.startsWith("__reactContainer$") &&
                        !key.startsWith("__reactInternalInstance$")
                    )
                ) {
                    continue;
                }

                pushRoot(el[key]);
            }
        }
    }

    return roots;
}

export function getGraphKeys(value) {
    const keys = Object.keys(value);

    if (
        keys.length > 0 ||
        value == null ||
        typeof value !== "object"
    ) {
        return keys;
    }

    const proto = Object.getPrototypeOf(value);
    if (!proto || proto === Object.prototype || proto === Array.prototype) {
        return keys;
    }

    return keys.concat(Object.getOwnPropertyNames(proto));
}

export function scanObjectGraphForStore(root, limits, budget = null) {
    const seen = new WeakSet();
    const queue = [root];
    let visitedObjects = 0;
    const objectBudget = budget ?? { visitedObjects: 0 };
    let bestStore = null;
    let bestNodeCount = -1;

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const current = queue[queueIndex];

        if (shouldSkipObjectGraphValue(current)) continue;
        if (seen.has(current)) continue;

        seen.add(current);
        visitedObjects += 1;
        objectBudget.visitedObjects += 1;

        if (objectBudget.visitedObjects > limits.maxObjects) break;

        if (hasAnyStoreMethodName(current) && looksLikeStore(current)) {
            const validation = validateStoreCandidate(current);

            if (validation.ok) {
                const scored = scoreStoreCandidate(current);

                if (scored.score > bestNodeCount) {
                    bestStore = current;
                    bestNodeCount = scored.score;
                }

                continue;
            }

            rejectStore(current, validation.reason);
        }

        let keys;
        try {
            keys = getGraphKeys(current);
        } catch {
            continue;
        }

        const proto = Object.getPrototypeOf(current);

        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];

            if (key === "return") continue;

            switch (key) {
                case "window":
                case "self":
                case "globalThis":
                case "ownerDocument":
                case "document":
                case "parentNode":
                case "parentElement":
                case "nextSibling":
                case "previousSibling":
                case "committed":
                case "loaded":
                case "userChoice":
                case "finished":
                case "ready":
                case "lost":
                    continue;
            }

            let child;
            try {
                const descriptor =
                    Object.getOwnPropertyDescriptor(current, key) ||
                    (proto ? Object.getOwnPropertyDescriptor(proto, key) : null);

                if (
                    descriptor?.get &&
                    key !== "nodes" &&
                    key !== "rootId" &&
                    key !== "currentLeafId"
                ) {
                    continue;
                }

                child = current[key];
            } catch {
                continue;
            }

            if (isObjectLike(child)) {
                queue.push(child);
            }
        }
    }

    return {
        store: bestStore,
        visitedObjects,
    };
}

export function discoverStoreFromFiberRoot(root, limits) {
    const seenFibers = new WeakSet();
    const fiberQueue = [root];
    const objectBudget = { visitedObjects: 0 };

    let visitedFibers = 0;
    let visitedObjects = 0;
    let bestStore = null;
    let bestNodeCount = -1;

    for (let queueIndex = 0; queueIndex < fiberQueue.length; queueIndex += 1) {
        const fiber = fiberQueue[queueIndex];

        if (!isObjectLike(fiber)) continue;
        if (seenFibers.has(fiber)) continue;

        seenFibers.add(fiber);
        visitedFibers += 1;

        if (visitedFibers > limits.maxFibers) break;

        const candidates = [
            fiber,
            fiber.stateNode,
            fiber.memoizedState,
            fiber.memoizedProps,
            fiber.pendingProps,
            fiber.updateQueue,
            fiber.dependencies,
            fiber.child,
            fiber.sibling,
        ];

        for (let i = 0; i < candidates.length; i += 1) {
            const candidate = candidates[i];
            if (!isObjectLike(candidate)) continue;

            if (hasAnyStoreMethodName(candidate) && looksLikeStore(candidate)) {
                const validation = validateStoreCandidate(candidate);

                if (validation.ok) {
                    const scored = scoreStoreCandidate(candidate);

                    if (scored.score > bestNodeCount) {
                        bestStore = candidate;
                        bestNodeCount = scored.score;
                    }

                    continue;
                }
            }

            const shouldDeepScan =
                candidate === fiber.stateNode ||
                candidate === fiber.memoizedState ||
                candidate === fiber.memoizedProps ||
                candidate === fiber.pendingProps ||
                candidate === fiber.updateQueue ||
                candidate === fiber.dependencies;

            if (shouldDeepScan) {
                const scanned = scanObjectGraphForStore(candidate, limits, objectBudget);
                visitedObjects += scanned.visitedObjects;

                if (scanned.store) {
                    const scored = scoreStoreCandidate(scanned.store);

                    if (scored.score > bestNodeCount) {
                        bestStore = scanned.store;
                        bestNodeCount = scored.score;
                    }
                }

                if (objectBudget.visitedObjects > limits.maxObjects) {
                    return {
                        store: bestStore,
                        visitedFibers,
                        visitedObjects: objectBudget.visitedObjects,
                    };
                }
            }
        }

        if (fiber.child) fiberQueue.push(fiber.child);
        if (fiber.sibling) fiberQueue.push(fiber.sibling);
        if (fiber.return) fiberQueue.push(fiber.return);
    }

    return {
        store: bestStore,
        visitedFibers,
        visitedObjects,
    };
}

export function createDiscoveryLimits() {
    return {
        maxFibers: CONFIG.discovery.maxFibers,
        maxObjects: CONFIG.discovery.maxObjects,
        maxRoots: 200,
    };
}