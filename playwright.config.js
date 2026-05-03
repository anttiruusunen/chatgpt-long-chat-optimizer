import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 30000,
    fullyParallel: false,
    workers: 2,
    retries: 2,
    use: {
        actionTimeout: 5000,
        navigationTimeout: 10000,
        browserName: "firefox",
        headless: true,
        viewport: {
            width: 1400,
            height: 900,
        },
    },
});