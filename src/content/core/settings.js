import { DEFAULT_SETTINGS } from "../core/state.js";
import { storageSyncGet } from "../../shared/ext.js";

/**
 * Loads user settings from extension storage.
 *
 * Defaults are merged automatically via storageSyncGet, so callers always
 * receive a complete settings object.
 */
export function getSettings() {
    return storageSyncGet(DEFAULT_SETTINGS);
}