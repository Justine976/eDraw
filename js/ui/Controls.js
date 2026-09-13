export class Controls {
  constructor(elements, actions) {
    this.elements = elements;
    this.actions = actions;

    elements.opacityRange.addEventListener("input", () => {
      actions.setOpacity(Number(elements.opacityRange.value) / 100);
    });

    elements.scaleRange.addEventListener("input", () => {
      actions.setScale(Number(elements.scaleRange.value) / 100);
    });

    elements.rotationRange.addEventListener("input", () => {
      actions.setRotation(Number(elements.rotationRange.value));
    });

    elements.nudgeUpButton.addEventListener("click", () => actions.nudge(0, -1));
    elements.nudgeLeftButton.addEventListener("click", () => actions.nudge(-1, 0));
    elements.nudgeRightButton.addEventListener("click", () => actions.nudge(1, 0));
    elements.nudgeDownButton.addEventListener("click", () => actions.nudge(0, 1));
    elements.rotateLeftButton.addEventListener("click", () => actions.rotateBy(-2));
    elements.rotateRightButton.addEventListener("click", () => actions.rotateBy(2));
    elements.scaleDownButton.addEventListener("click", () => actions.scaleBy(-0.04));
    elements.scaleUpButton.addEventListener("click", () => actions.scaleBy(0.04));
    elements.confirmButton.addEventListener("click", () => actions.confirm());
  }

  update(state) {
    const {
      opacityRange,
      scaleRange,
      rotationRange,
      nudgeUpButton,
      nudgeLeftButton,
      nudgeRightButton,
      nudgeDownButton,
      rotateLeftButton,
      rotateRightButton,
      scaleDownButton,
      scaleUpButton,
      confirmButton,
    } = this.elements;
    const disabled = !state.placed;
    const lockedEditDisabled = disabled || state.locked;

    opacityRange.disabled = disabled;
    scaleRange.disabled = lockedEditDisabled;
    rotationRange.disabled = lockedEditDisabled;
    [
      nudgeUpButton,
      nudgeLeftButton,
      nudgeRightButton,
      nudgeDownButton,
      rotateLeftButton,
      rotateRightButton,
      scaleDownButton,
      scaleUpButton,
      confirmButton,
    ].forEach((button) => {
      button.disabled = lockedEditDisabled;
    });

    setRangeValue(opacityRange, Math.round(state.transform.opacity * 100));
    setRangeValue(scaleRange, Math.round(state.transform.scale * 100));
    setRangeValue(rotationRange, Math.round(state.transform.rotation));
  }
}

function setRangeValue(input, value) {
  if (document.activeElement !== input) {
    input.value = String(value);
  }
}
