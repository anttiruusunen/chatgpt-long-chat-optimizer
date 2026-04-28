const MAX_SCROLL_PRESERVE_FRAMES = 6;
const SCROLL_PRESERVE_EPSILON_PX = 1;

function adjustScrollToPreserveAnchor({
    anchorSection,
    anchorTopBefore,
    scrollContainer,
}) {
    if (!anchorSection?.isConnected || !scrollContainer) {
        return false;
    }

    const anchorTopAfter = anchorSection.getBoundingClientRect().top;
    const anchorDelta = anchorTopAfter - anchorTopBefore;

    if (Math.abs(anchorDelta) <= SCROLL_PRESERVE_EPSILON_PX) {
        return false;
    }

    scrollContainer.scrollTop += anchorDelta;
    return true;
}

function preserveScrollAcrossFrames({
    anchorSection,
    anchorTopBefore,
    scrollContainer,
    frame = 0,
}) {
    requestAnimationFrame(() => {
        if (!anchorSection?.isConnected || !scrollContainer) {
            return;
        }

        adjustScrollToPreserveAnchor({
            anchorSection,
            anchorTopBefore,
            scrollContainer,
        });

        if (frame + 1 >= MAX_SCROLL_PRESERVE_FRAMES) {
            return;
        }

        preserveScrollAcrossFrames({
            anchorSection,
            anchorTopBefore,
            scrollContainer,
            frame: frame + 1,
        });
    });
}

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

    preserveScrollAcrossFrames({
        anchorSection,
        anchorTopBefore,
        scrollContainer,
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

    preserveScrollAcrossFrames({
        anchorSection,
        anchorTopBefore,
        scrollContainer,
    });
}