let overlayWatchdogObserver = null;
let overlayWatchdogTimer = null;
let overlayWatchdogRepair = null;

const WATCHDOG_INTERVAL_MS = 250;

function runRepair() {
    if (typeof overlayWatchdogRepair !== "function") {
        return;
    }

    overlayWatchdogRepair();
}

export function startPruneOverlayWatchdog(repair) {
    overlayWatchdogRepair = typeof repair === "function" ? repair : null;

    if (!overlayWatchdogRepair) {
        return;
    }

    runRepair();

    if (!overlayWatchdogObserver) {
        overlayWatchdogObserver = new MutationObserver(() => {
            runRepair();
        });

        overlayWatchdogObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    if (!overlayWatchdogTimer) {
        overlayWatchdogTimer = setInterval(() => {
            runRepair();
        }, WATCHDOG_INTERVAL_MS);
    }
}

export function stopPruneOverlayWatchdog() {
    overlayWatchdogRepair = null;

    if (overlayWatchdogObserver) {
        overlayWatchdogObserver.disconnect();
        overlayWatchdogObserver = null;
    }

    if (overlayWatchdogTimer) {
        clearInterval(overlayWatchdogTimer);
        overlayWatchdogTimer = null;
    }
}

export function resetPruneOverlayWatchdogForTests() {
    stopPruneOverlayWatchdog();
}