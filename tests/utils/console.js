import { vi } from "vitest";

export function silenceConsole(methods = ["log", "debug", "warn", "error"]) {
    const spies = methods.map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {})
    );

    return () => {
        for (const spy of spies) {
            spy.mockRestore();
        }
    };
}