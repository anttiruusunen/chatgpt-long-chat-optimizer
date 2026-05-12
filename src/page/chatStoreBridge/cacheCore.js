import {
    CACHE_MISS,
    alreadyInstalled,
    unavailable,
} from "./common.js";
import { getNodeDirect } from "./common.js";
import { ENABLE_CACHE_PROFILING } from "./config.js";

export function createNodeObjectCache({ store, stats }) {
    const cache = new Map();

    function get(id) {
        if (!id) return undefined;

        const cached = cache.get(id);

        if (cached !== undefined) {
            if (ENABLE_CACHE_PROFILING && stats) stats.hits += 1;
            return cached === CACHE_MISS ? null : cached;
        }

        if (ENABLE_CACHE_PROFILING && stats) stats.misses += 1;
        return undefined;
    }

    function set(id, node) {
        if (!id) return;

        cache.set(id, node === null ? CACHE_MISS : node);

        if (stats && "cached" in stats) {
            stats.cached = cache.size;
        }

        if (ENABLE_CACHE_PROFILING && stats) {
            stats.writes += 1;

            if (node === null) {
                stats.nullWrites += 1;
            }
        }
    }

    function resolve(id) {
        const cached = get(id);

        if (cached !== undefined) {
            return cached;
        }

        const node = getNodeDirect(store, id) ?? null;

        set(id, node);

        return node;
    }

    function clear(reason) {
        cache.clear();

        if (stats && "cached" in stats) {
            stats.cached = 0;
        }

        if (stats && "lastClearReason" in stats) {
            stats.lastClearReason = reason;
        }
    }

    return {
        cache,
        get,
        set,
        resolve,
        clear,
    };
}

/**
 * Persistent alias/value cache.
 *
 * This cache intentionally does not increment hit/miss counters in get().
 * Installer wrappers own cache-hit/cache-miss accounting because each wrapper
 * has domain-specific bypasses and labels such as active hits, live bypasses,
 * normal cached reads, null hits, etc.
 */
export function createPersistentCache({ stats }) {
    const cache = new Map();

    function get(key) {
        const value = cache.get(key);

        if (value !== undefined) {
            return value === CACHE_MISS ? null : value;
        }

        return undefined;
    }

    function set(key, value) {
        cache.set(key, value === null ? CACHE_MISS : value);

        if (stats && "cached" in stats) {
            stats.cached = cache.size;
        }
    }

    function clear(reason) {
        if (cache.size === 0) return;

        cache.clear();

        if (stats && "cached" in stats) {
            stats.cached = 0;
        }

        if (stats && "lastClearReason" in stats) {
            stats.lastClearReason = reason;
        }
    }

    return {
        get,
        set,
        clear,
        cache,
    };
}

export function createCacheStats(profileStats, productionStats = {}) {
    return ENABLE_CACHE_PROFILING
        ? { ...profileStats }
        : { ...productionStats };
}

export function requireStore(bridge) {
    return bridge.__store || null;
}

export function getStoreMethod(store, methodName) {
    const method = store?.[methodName];
    return typeof method === "function" ? method : null;
}

export function validateStoreMethodBinding(store, methodName, original) {
    if (!store || typeof original !== "function") return false;

    try {
        if (methodName === "getNodeIfExists") {
            return typeof store.messageIdToExistingNodeId === "function";
        }

        if (methodName === "getNodeByIdOrMessageId") {
            return typeof store.getNodeIfExists === "function";
        }

        return true;
    } catch {
        return false;
    }
}

export function installStoreMethodWrapper({
    bridge,
    methodName,
    originalSlot,
    installedFlag,
    unavailableReason = `${methodName} unavailable`,
    createWrapper,
}) {
    const store = requireStore(bridge);
    if (!store) return unavailable("store not registered");

    if (bridge[installedFlag]) {
        return alreadyInstalled();
    }

    const original = getStoreMethod(store, methodName);
    if (!original) return unavailable(unavailableReason);

    if (!validateStoreMethodBinding(store, methodName, original)) {
        return unavailable(`${methodName} failed install-time validation`);
    }

    bridge[originalSlot] = {
        ...(bridge[originalSlot] || {}),
        [methodName]: original,
    };

    store[methodName] = createWrapper({
        store,
        original,
        bridge,
    });

    bridge[installedFlag] = true;

    return {
        ok: true,
        installed: true,
        methods: [methodName],
    };
}

export function uninstallMethodFrameCache({
    bridge,
    originalSlot,
    installedFlag,
}) {
    if (!bridge[installedFlag]) {
        return {
            ok: true,
            alreadyUninstalled: true,
        };
    }

    const originals = bridge[originalSlot];

    if (bridge.__store && originals) {
        for (const [name, fn] of Object.entries(originals)) {
            bridge.__store[name] = fn;
        }
    }

    bridge[installedFlag] = false;
    bridge[originalSlot] = null;

    return {
        ok: true,
        uninstalled: true,
    };
}

export function resetFrameCacheStats(stats, cache) {
    if (!stats) return;

    if ("hits" in stats) stats.hits = 0;
    if ("misses" in stats) stats.misses = 0;
    if ("cached" in stats) stats.cached = cache?.size ?? 0;
}

export function getCacheSnapshot(bridge, installedFlag, cacheSlot, statsSlot) {
    return {
        installed: Boolean(bridge[installedFlag]),
        size: bridge[cacheSlot]?.size ?? 0,
        stats: bridge[statsSlot] ?? null,
    };
}