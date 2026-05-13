import { describe, it, expect, beforeEach } from "vitest";
import { state, DEFAULT_SETTINGS } from "../../src/content/core/state.js";
import { syncFeatureFlagsFromSettings } from "../../src/content/core/featureFlags.js";
import { resetCoreStateForTests } from "../utils/state.js";

const FLAG_CASES = [
    {
        settingKey: "enablePruning",
        featureFlagKey: "pruning",
    },
    {
        settingKey: "enableOffscreenOptimization",
        featureFlagKey: "offscreenOptimization",
    },
    {
        settingKey: "enableStoreReadOptimization",
        featureFlagKey: "storeReadOptimization",
    },
    {
        settingKey: "enableCodeBlockScrollbars",
        featureFlagKey: "codeBlockScrollbars",
    },
    {
        settingKey: "enableUserMessageClamp",
        featureFlagKey: "userMessageClamp",
    },
];

describe("featureFlags", () => {
    beforeEach(() => {
        resetCoreStateForTests(state, DEFAULT_SETTINGS);
    });

    it.each(FLAG_CASES)(
        "maps $settingKey=false to $featureFlagKey=false",
        ({ settingKey, featureFlagKey }) => {
            state.settings = {
                ...DEFAULT_SETTINGS,
                enablePruning: true,
                enableOffscreenOptimization: true,
                enableStoreReadOptimization: true,
                enableCodeBlockScrollbars: true,
                enableUserMessageClamp: true,
                [settingKey]: false,
            };

            syncFeatureFlagsFromSettings();

            expect(state.featureFlags[featureFlagKey]).toBe(false);
        }
    );

    it.each(FLAG_CASES)(
        "maps $settingKey=true to $featureFlagKey=true",
        ({ settingKey, featureFlagKey }) => {
            state.settings = {
                ...DEFAULT_SETTINGS,
                enablePruning: false,
                enableOffscreenOptimization: false,
                enableStoreReadOptimization: false,
                enableCodeBlockScrollbars: false,
                enableUserMessageClamp: false,
                [settingKey]: true,
            };

            syncFeatureFlagsFromSettings();

            expect(state.featureFlags[featureFlagKey]).toBe(true);
        }
    );

    it("does not map debug logging into featureFlags", () => {
        state.settings = {
            ...DEFAULT_SETTINGS,
            enableDebugLogging: true,
        };

        syncFeatureFlagsFromSettings();

        expect(state.featureFlags).not.toHaveProperty("debugLogging");
        expect(state.debugLoggingEnabled).not.toBe(true);
    });
});