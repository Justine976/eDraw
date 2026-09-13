export class Toolbar {
  constructor(elements, actions) {
    this.elements = elements;
    this.actions = actions;

    elements.placeButton.addEventListener("click", () => actions.place());
    elements.traceButton.addEventListener("click", () => actions.toggleTracing());
    elements.lockButton.addEventListener("click", () => actions.toggleLock());
    elements.resetButton.addEventListener("click", () => actions.reset());
    elements.templatesButton.addEventListener("click", () => actions.toggleTemplates());
  }

  update(state) {
    const { placeButton, traceButton, lockButton, resetButton } = this.elements;

    placeButton.disabled = !state.hasTemplate || state.locked;
    traceButton.disabled = !state.hasTemplate;
    lockButton.disabled = !state.hasTemplate;
    resetButton.disabled = !state.placed;

    placeButton.classList.toggle("is-ready", !state.placed && state.canPlace);
    traceButton.classList.toggle("is-active", state.tracing);
    lockButton.classList.toggle("is-active", state.locked);
    placeButton.textContent = state.placed ? "Center" : "Place";
    lockButton.textContent = state.locked ? "Unlock" : "Lock";
  }
}
