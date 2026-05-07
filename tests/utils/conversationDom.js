export function createConversationContainer() {
    const root = document.createElement("div");
    const wrapper = document.createElement("div");
    const container = document.createElement("div");

    root.appendChild(wrapper);
    wrapper.appendChild(container);
    document.body.appendChild(root);

    return container;
}

export function appendConversationSection(
    container,
    label,
    turn,
    { anchor = false } = {}
) {
    const section = document.createElement("section");

    section.setAttribute("data-testid", `conversation-turn-${label}`);
    section.setAttribute("data-turn", turn);

    if (anchor) {
        section.setAttribute("data-scroll-anchor", "true");
    }

    section.textContent = `${turn}-${label}`;
    container.appendChild(section);

    return section;
}

export function buildConversation() {
    const container = createConversationContainer();

    const s1 = appendConversationSection(container, "1", "user");
    const s2 = appendConversationSection(container, "2", "assistant");
    const s3 = appendConversationSection(container, "3", "user");
    const s4 = appendConversationSection(container, "4", "assistant");
    const s5 = appendConversationSection(container, "5", "user");
    const s6 = appendConversationSection(container, "6", "assistant", {
        anchor: true,
    });

    return {
        container,
        sections: [s1, s2, s3, s4, s5, s6],
    };
}