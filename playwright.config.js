import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 10000,
    fullyParallel: false,
    workers: 1,
    use: {
        browserName: "firefox",
        headless: true,
        viewport: {
            width: 1400,
            height: 900,
        },
    },
});