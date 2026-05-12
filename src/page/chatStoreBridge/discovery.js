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

const DECISIVE_VISIBLE_STORE_SCORE = 1_000_000;

const HOT_FIBER_FIELDS = [
    "stateNode",
    "memoizedState",
    "memoizedProps",
    "pendingProps",
    "updateQueue",
    "dependencies",
];

const PRIORITY_GRAPH_KEYS = [
    "store",
    "chatStore",
    "conversationStore",
    "threadStore",
    "tree",
    "nodes",
    "nodeMap",
    "__nodeMap",
    "rootId",
    "currentLeafId",
    "getNodeIfExists",
    "messageIdToExistingNodeId",
    "getNodeByIdOrMessageId",
    "deleteNode",
    "getBranch",
    "props",
    "children",
    "value",
    "current",
    "memoizedState",
    "memoizedProps",
    "pendingProps",
    "state",
];

const SKIPPED_GRAPH_KEYS = new Set([
    "window",
    "self",
    "globalThis",
    "ownerDocument",
    "document",
    "parentNode",
    "parentElement",
    "nextSibling",
    "previousSibling",
    "committed",
    "loaded",
    "userChoice",
    "finished",
    "ready",
    "lost",
    "return",
]);

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

function getPrioritizedGraphKeys(value) {
    const keys = getGraphKeys(value);

    if (keys.length <= 1) {
        return keys;
    }

    const seen = new Set();
    const prioritized = [];

    for (const key of PRIORITY_GRAPH_KEYS) {
        if (keys.includes(key) && !seen.has(key)) {
            seen.add(key);
            prioritized.push(key);
        }
    }

    for (const key of keys) {
        if (!seen.has(key)) {
            seen.add(key);
            prioritized.push(key);
        }
    }

    return prioritized;
}

function evaluateStoreCandidate(candidate) {
    if (!hasAnyStoreMethodName(candidate) || !looksLikeStore(candidate)) {
        return null;
    }

    const validation = validateStoreCandidate(candidate);

    if (!validation.ok) {
        rejectStore(candidate, validation.reason);
        return null;
    }

    const scored = scoreStoreCandidate(candidate);

    return {
        store: candidate,
        score: scored.score,
        scored,
        decisive: scored.score >= DECISIVE_VISIBLE_STORE_SCORE,
    };
}

function maybeRecordBest(currentBest, candidateResult) {
    if (!candidateResult) {
        return currentBest;
    }

    if (!currentBest || candidateResult.score > currentBest.score) {
        return candidateResult;
    }

    return currentBest;
}

function shouldReadAccessorKey(key) {
    return key === "nodes" || key === "rootId" || key === "currentLeafId";
}

function readGraphChild(current, proto, key) {
    if (SKIPPED_GRAPH_KEYS.has(key)) {
        return undefined;
    }

    try {
        const descriptor =
            Object.getOwnPropertyDescriptor(current, key) ||
            (proto ? Object.getOwnPropertyDescriptor(proto, key) : null);

        if (descriptor?.get && !shouldReadAccessorKey(key)) {
            return undefined;
        }

        return current[key];
    } catch {
        return undefined;
    }
}

export function scanObjectGraphForStore(root, limits, budget = null) {
    const seen = new WeakSet();
    const queue = [root];
    const objectBudget = budget ?? { visitedObjects: 0 };

    let visitedObjects = 0;
    let best = null;

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
        const current = queue[queueIndex];

        if (shouldSkipObjectGraphValue(current)) continue;
        if (seen.has(current)) continue;

        seen.add(current);
        visitedObjects += 1;
        objectBudget.visitedObjects += 1;

        if (objectBudget.visitedObjects > limits.maxObjects) break;

        const candidateResult = evaluateStoreCandidate(current);
        best = maybeRecordBest(best, candidateResult);

        if (candidateResult?.decisive) {
            return {
                store: candidateResult.store,
                score: candidateResult.score,
                decisive: true,
                visitedObjects,
            };
        }

        let keys;
        try {
            keys = getPrioritizedGraphKeys(current);
        } catch {
            continue;
        }

        const proto = Object.getPrototypeOf(current);

        for (let i = 0; i < keys.length; i += 1) {
            const child = readGraphChild(current, proto, keys[i]);

            if (isObjectLike(child)) {
                queue.push(child);
            }
        }
    }

    return {
        store: best?.store ?? null,
        score: best?.score ?? -1,
        decisive: false,
        visitedObjects,
    };
}

export function discoverStoreFromFiberRoot(root, limits) {
    const seenFibers = new WeakSet();
    const fiberQueue = [root];
    const objectBudget = { visitedObjects: 0 };

    let visitedFibers = 0;
    let best = null;

    for (let queueIndex = 0; queueIndex < fiberQueue.length; queueIndex += 1) {
        const fiber = fiberQueue[queueIndex];

        if (!isObjectLike(fiber)) continue;
        if (seenFibers.has(fiber)) continue;

        seenFibers.add(fiber);
        visitedFibers += 1;

        if (visitedFibers > limits.maxFibers) break;

        const directCandidates = [
            fiber,
            fiber.stateNode,
            fiber.memoizedState,
            fiber.memoizedProps,
            fiber.pendingProps,
            fiber.updateQueue,
            fiber.dependencies,
        ];

        for (let i = 0; i < directCandidates.length; i += 1) {
            const candidate = directCandidates[i];
            if (!isObjectLike(candidate)) continue;

            const candidateResult = evaluateStoreCandidate(candidate);
            best = maybeRecordBest(best, candidateResult);

            if (candidateResult?.decisive) {
                return {
                    store: candidateResult.store,
                    visitedFibers,
                    visitedObjects: objectBudget.visitedObjects,
                };
            }
        }

        for (let i = 0; i < HOT_FIBER_FIELDS.length; i += 1) {
            const candidate = fiber[HOT_FIBER_FIELDS[i]];
            if (!isObjectLike(candidate)) continue;

            const scanned = scanObjectGraphForStore(
                candidate,
                limits,
                objectBudget
            );

            if (scanned.store) {
                best = maybeRecordBest(best, {
                    store: scanned.store,
                    score: scanned.score,
                    decisive: scanned.decisive,
                });
            }

            if (scanned.decisive) {
                return {
                    store: scanned.store,
                    visitedFibers,
                    visitedObjects: objectBudget.visitedObjects,
                };
            }

            if (objectBudget.visitedObjects > limits.maxObjects) {
                return {
                    store: best?.store ?? null,
                    visitedFibers,
                    visitedObjects: objectBudget.visitedObjects,
                };
            }
        }

        if (fiber.child) fiberQueue.push(fiber.child);
        if (fiber.sibling) fiberQueue.push(fiber.sibling);
        if (fiber.return) fiberQueue.push(fiber.return);
    }

    return {
        store: best?.store ?? null,
        visitedFibers,
        visitedObjects: objectBudget.visitedObjects,
    };
}

export function createDiscoveryLimits() {
    return {
        maxFibers: CONFIG.discovery.maxFibers,
        maxObjects: CONFIG.discovery.maxObjects,
        maxRoots: 200,
    };
}