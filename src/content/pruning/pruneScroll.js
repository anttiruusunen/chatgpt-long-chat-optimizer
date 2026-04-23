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
        !lastRestoredSection?.isConnected ||
        !scrollContainer
    ) {
        return;
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!anchorSection?.isConnected || !lastRestoredSection?.isConnected) {
                return;
            }

            const anchorTopAfter = anchorSection.getBoundingClientRect().top;
            const anchorDelta = anchorTopAfter - anchorTopBefore;

            if (Math.abs(anchorDelta) > 1) {
                scrollContainer.scrollTop += anchorDelta;
            }

            /*
             * Do not apply a second "fit restored section into viewport" adjustment here.
             * That extra nudge can skip over the immediately previous message when restoring
             * older content during upward scrolling.
             */
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
        anchorTopBefore == null ||
        !scrollContainer
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