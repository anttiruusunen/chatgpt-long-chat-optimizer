export function dispatchClick(element) {
    if (!element) {
        throw new Error("dispatchClick: element is required");
    }

    // Prevent jsdom navigation side-effects
    element.addEventListener(
        "click",
        (event) => {
            event.preventDefault();
        },
        { once: true }
    );

    element.dispatchEvent(
        new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
        })
    );
}