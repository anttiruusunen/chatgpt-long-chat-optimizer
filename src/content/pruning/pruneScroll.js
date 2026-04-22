export function preserveScrollAfterRestore({
    visibleSectionsChanged,
    anchorSection,
    anchorTopBefore,
    lastRestoredSection,
    scrollContainer,
}) {
    if (
        !visibleSectionsChanged ||
        !anchorSection?.isConnected ||
        anchorTopBefore == null ||
        !lastRestoredSection?.isConnected
    ) {
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!anchorSection?.isConnected || !lastRestoredSection?.isConnected) return;

            const anchorTopAfter = anchorSection.getBoundingClientRect().top;
            const anchorDelta = anchorTopAfter - anchorTopBefore;

            if (Math.abs(anchorDelta) > 1) {
                scrollContainer.scrollTop += anchorDelta;
            }

            requestAnimationFrame(() => {
                if (!lastRestoredSection?.isConnected) return;

                const bottomClearance = 32;
                const rect = lastRestoredSection.getBoundingClientRect();
                const targetBottom = window.innerHeight - bottomClearance;
                const bottomDelta = rect.bottom - targetBottom;

                if (bottomDelta > 1) {
                    scrollContainer.scrollTop += bottomDelta;
                }
            });
        });
    });
}

export function preserveScrollAfterReprune({
    visibleSectionsChanged,
    anchorSection,
    anchorTopBefore,
    scrollContainer,
}) {
    if (
        !visibleSectionsChanged ||
        !anchorSection?.isConnected ||
        anchorTopBefore == null
    ) {
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!anchorSection?.isConnected) return;

            const anchorTopAfter = anchorSection.getBoundingClientRect().top;
            const anchorDelta = anchorTopAfter - anchorTopBefore;

            if (Math.abs(anchorDelta) > 1) {
                scrollContainer.scrollTop += anchorDelta;
            }
        });
    });
}