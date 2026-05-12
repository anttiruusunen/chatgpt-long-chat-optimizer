import { clearBridgeSlots } from "./common.js";

export const STORE_ENHANCEMENTS = [
    {
        key: "messageIdIndex",
        install: "installMessageIdIndex",
        uninstall: "uninstallMessageIdIndex",
        installedFlag: "__messageIdIndexInstalled",
        slots: [
            "__messageIdIndexOriginal",
            "__messageIdIndex",
            "__messageIdIndexStats",
        ],
    },
    {
        key: "nodeStableCache",
        install: "installExistingNodeStableCache",
        uninstall: "uninstallExistingNodeStableCache",
        installedFlag: "__existingNodeStableCacheInstalled",
        slots: [
            "__existingNodeStableCacheOriginal",
            "__existingNodeStableCache",
            "__existingNodeStableCacheStats",
            "__existingNodeStableCacheApi",
        ],
    },
    {
        key: "getNodeByIdOrMessageIdCache",
        install: "installGetNodeByIdOrMessageIdCache",
        uninstall: "uninstallGetNodeByIdOrMessageIdCache",
        installedFlag: "__getNodeByIdOrMessageIdCacheInstalled",
        slots: [
            "__getNodeByIdOrMessageIdCacheOriginal",
            "__getNodeByIdOrMessageIdCache",
            "__getNodeByIdOrMessageIdCacheStats",
        ],
    },
    {
        key: "branchCache",
        install: "installBranchCache",
        uninstall: "uninstallBranchCache",
        installedFlag: "__branchCacheInstalled",
        slots: [
            "__branchCacheOriginals",
            "__branchCache",
            "__branchCacheStats",
            "__branchCacheLastInstallResult",
        ],
    },
    {
        key: "resolvedNodeFrameCache",
        install: "installResolvedNodeFrameCache",
        uninstall: "uninstallResolvedNodeFrameCache",
        installedFlag: "__resolvedNodeFrameCacheInstalled",
        slots: [
            "__resolvedNodeFrameCache",
            "__resolvedNodeFrameCacheStats",
            "__resolveNodeFast",
        ],
    },
];

export const STABLE_CACHE_SLOTS = [
    ["__existingNodeStableCache", "__existingNodeStableCacheStats"],
    ["__getNodeByIdOrMessageIdCache", "__getNodeByIdOrMessageIdCacheStats"],
    ["__branchCache", "__branchCacheStats"],
    ["__resolvedNodeFrameCache", "__resolvedNodeFrameCacheStats"],
];

export function resetStoreEnhancementSlots(bridge) {
    for (const enhancement of STORE_ENHANCEMENTS) {
        bridge[enhancement.installedFlag] = false;

        if (Array.isArray(enhancement.slots) && enhancement.slots.length > 0) {
            clearBridgeSlots(bridge, enhancement.slots);
        }
    }
}

export function runStoreEnhancementUninstalls(bridge) {
    const result = {};

    for (let i = STORE_ENHANCEMENTS.length - 1; i >= 0; i -= 1) {
        const enhancement = STORE_ENHANCEMENTS[i];
        const uninstall = bridge[enhancement.uninstall];

        result[enhancement.key] =
            typeof uninstall === "function"
                ? uninstall.call(bridge)
                : { ok: false, reason: `missing uninstaller: ${enhancement.uninstall}` };
    }

    return result;
}