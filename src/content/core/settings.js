import { DEFAULT_SETTINGS } from "../core/state.js";
import { storageSyncGet } from "../../shared/ext.js";

export function getSettings() {
    return storageSyncGet(DEFAULT_SETTINGS);
}