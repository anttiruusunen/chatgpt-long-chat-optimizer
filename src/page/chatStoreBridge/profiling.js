export function createEmptyMethodProfile() {
    return {
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0,
        errors: 0,
        recentArgs: [],
    };
}

export function normalizeStack(stack) {
    if (!stack || typeof stack !== "string") {
        return "unknown";
    }

    return stack
        .split("\n")
        .slice(2, 8)
        .map((line) =>
            line
                .trim()
                .replace(window.location.origin, "")
                .replace(/:\d+:\d+/g, ":<line>:<col>")
        )
        .join("\n");
}