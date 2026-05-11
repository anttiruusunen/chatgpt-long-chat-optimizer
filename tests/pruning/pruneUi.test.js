import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    hideContainer,
    installStartupPruneMask,
    removeStartupPruneMask,
    revealContainer,
} from "../../src/content/pruning/pruneUi.js";

const STARTUP_MASK_ATTR = "data-thread-optimizer-startup-mask";
const STARTUP_MASK_STYLE_ID = "thread-optimizer-startup-mask-style";

function getStartupMaskStyle() {
    return document.getElementById(STARTUP_MASK_STYLE_ID);
}

describe("pruneUi", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = "";
        removeStartupPruneMask();
    });

    afterEach(() => {
        removeStartupPruneMask();
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    it("hides and reveals the conversation container", () => {
        const container = document.createElement("div");

        hideContainer(container);
        expect(container.style.visibility).toBe("hidden");

        revealContainer(container);
        expect(container.style.visibility).toBe("");
    });

    it("installs a startup prune mask on a valid container", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        installStartupPruneMask(container, 4);

        expect(container.getAttribute(STARTUP_MASK_ATTR)).toBe("true");

        const style = getStartupMaskStyle();

        expect(style).toBeInstanceOf(HTMLStyleElement);
        expect(style.textContent).toContain(`[${STARTUP_MASK_ATTR}="true"]`);
        expect(style.textContent).toContain(":nth-last-of-type(-n + 4)");
        expect(style.textContent).toContain("display: none !important");
    });

    it("replaces an existing startup prune mask when installing a new one", () => {
        const firstContainer = document.createElement("div");
        const secondContainer = document.createElement("div");

        document.body.append(firstContainer, secondContainer);

        installStartupPruneMask(firstContainer, 2);

        const firstStyle = getStartupMaskStyle();

        expect(firstContainer.getAttribute(STARTUP_MASK_ATTR)).toBe("true");
        expect(firstStyle.textContent).toContain(":nth-last-of-type(-n + 2)");

        installStartupPruneMask(secondContainer, 6);

        const secondStyle = getStartupMaskStyle();

        expect(firstContainer.hasAttribute(STARTUP_MASK_ATTR)).toBe(false);
        expect(secondContainer.getAttribute(STARTUP_MASK_ATTR)).toBe("true");
        expect(secondStyle).not.toBe(firstStyle);
        expect(secondStyle.textContent).toContain(":nth-last-of-type(-n + 6)");
        expect(document.querySelectorAll(`#${STARTUP_MASK_STYLE_ID}`)).toHaveLength(1);
    });

    it("does not install a startup prune mask for invalid input", () => {
        installStartupPruneMask(null, 2);
        installStartupPruneMask(document.createTextNode("not an element"), 2);

        const container = document.createElement("div");
        document.body.appendChild(container);

        installStartupPruneMask(container, 0);
        installStartupPruneMask(container, Number.NaN);

        expect(container.hasAttribute(STARTUP_MASK_ATTR)).toBe(false);
        expect(getStartupMaskStyle()).toBe(null);
    });

    it("removes startup masks from all masked elements", () => {
        const firstContainer = document.createElement("div");
        const secondContainer = document.createElement("div");

        firstContainer.setAttribute(STARTUP_MASK_ATTR, "true");
        secondContainer.setAttribute(STARTUP_MASK_ATTR, "true");

        const style = document.createElement("style");
        style.id = STARTUP_MASK_STYLE_ID;

        document.body.append(firstContainer, secondContainer);
        document.head.appendChild(style);

        removeStartupPruneMask();

        expect(firstContainer.hasAttribute(STARTUP_MASK_ATTR)).toBe(false);
        expect(secondContainer.hasAttribute(STARTUP_MASK_ATTR)).toBe(false);
        expect(getStartupMaskStyle()).toBe(null);
    });

    it("is safe to remove the startup mask when none exists", () => {
        expect(() => removeStartupPruneMask()).not.toThrow();
        expect(getStartupMaskStyle()).toBe(null);
    });
});