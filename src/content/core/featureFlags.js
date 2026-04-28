import { state } from "./state.js";

export function syncFeatureFlagsFromSettings() {
    state.featureFlags.pruning = Boolean(state.settings.enablePruning);
    state.featureFlags.offscreenOptimization = Boolean(state.settings.enableOffscreenOptimization);
    state.featureFlags.largeCodeBlockOptimization = Boolean(state.settings.enableLargeCodeBlockOptimization);
    state.featureFlags.storeReadOptimization = Boolean(state.settings.enableStoreReadOptimization);
}