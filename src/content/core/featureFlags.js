import { state } from "./state.js";

/**
 * Sync runtime feature flags from persisted user settings.
 *
 * This is the single source of truth for mapping settings → featureFlags.
 * Keep this flat and explicit so it’s easy to audit and extend.
 */
export function syncFeatureFlagsFromSettings() {
    const { settings, featureFlags } = state;

    featureFlags.pruning = Boolean(settings.enablePruning);
    featureFlags.offscreenOptimization = Boolean(settings.enableOffscreenOptimization);
    featureFlags.largeCodeBlockOptimization = Boolean(settings.enableLargeCodeBlockOptimization);
    featureFlags.storeReadOptimization = Boolean(settings.enableStoreReadOptimization);
    featureFlags.codeBlockScrollbars = Boolean(settings.enableCodeBlockScrollbars);
    featureFlags.userMessageClamp = Boolean(settings.enableUserMessageClamp);
    featureFlags.codeBlockCollapse = Boolean(settings.enableCodeBlockCollapse);
}