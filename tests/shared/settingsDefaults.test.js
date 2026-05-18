import { describe, it, expect } from "vitest";

import { DEFAULT_SETTINGS } from "../../src/shared/settingsDefaults.js";

describe("shared settings defaults", () => {
    it("keeps store read optimization enabled by default", () => {
        expect(DEFAULT_SETTINGS.enableStoreReadOptimization).toBe(true);
    });

    it("defines the canonical popup/content settings shape", () => {
        expect(DEFAULT_SETTINGS).toEqual({
            historyKeptExchanges: 10,
            autoPrune: true,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: false,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });
    });

    it("is immutable at runtime", () => {
        expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    });
});