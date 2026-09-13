import { ARManager } from "./ar/ARManager.js";
import { CameraManager } from "./camera/CameraManager.js";
import { TemplateManager } from "./template/TemplateManager.js";
import { CalibrationUI } from "./ui/CalibrationUI.js";
import { Controls } from "./ui/Controls.js";
import { Toolbar } from "./ui/Toolbar.js";

const refs = {
  startScreen: document.querySelector("#startScreen"),
  arScreen: document.querySelector("#arScreen"),
  startButton: document.querySelector("#startButton"),
  previewButton: document.querySelector("#previewButton"),
  homeStatus: document.querySelector("#homeStatus"),
  worldReadiness: document.querySelector("#worldReadiness"),
  worldReadinessText: document.querySelector("#worldReadinessText"),
  homeTemplateGrid: document.querySelector("#homeTemplateGrid"),
  arTemplateGrid: document.querySelector("#arTemplateGrid"),
  templateUpload: document.querySelector("#templateUpload"),
  homeUploadButton: document.querySelector("#homeUploadButton"),
  drawerUploadButton: document.querySelector("#drawerUploadButton"),
  drawerCloseButton: document.querySelector("#drawerCloseButton"),
  templateDrawer: document.querySelector("#templateDrawer"),
  closeButton: document.querySelector("#closeButton"),
  cameraFeed: document.querySelector("#cameraFeed"),
  sceneCanvas: document.querySelector("#sceneCanvas"),
  surfaceReticle: document.querySelector("#surfaceReticle"),
  reticleLabel: document.querySelector("#reticleLabel"),
  statusText: document.querySelector("#statusText"),
  trackingBadge: document.querySelector("#trackingBadge"),
  placeButton: document.querySelector("#placeButton"),
  traceButton: document.querySelector("#traceButton"),
  lockButton: document.querySelector("#lockButton"),
  resetButton: document.querySelector("#resetButton"),
  templatesButton: document.querySelector("#templatesButton"),
  opacityRange: document.querySelector("#opacityRange"),
  scaleRange: document.querySelector("#scaleRange"),
  rotationRange: document.querySelector("#rotationRange"),
  nudgeUpButton: document.querySelector("#nudgeUpButton"),
  nudgeLeftButton: document.querySelector("#nudgeLeftButton"),
  nudgeRightButton: document.querySelector("#nudgeRightButton"),
  nudgeDownButton: document.querySelector("#nudgeDownButton"),
  rotateLeftButton: document.querySelector("#rotateLeftButton"),
  rotateRightButton: document.querySelector("#rotateRightButton"),
  scaleDownButton: document.querySelector("#scaleDownButton"),
  scaleUpButton: document.querySelector("#scaleUpButton"),
  confirmButton: document.querySelector("#confirmButton"),
};

const camera = new CameraManager(refs.cameraFeed);
const templates = new TemplateManager();
const ar = new ARManager({
  root: refs.arScreen,
  video: refs.cameraFeed,
  canvas: refs.sceneCanvas,
  reticle: refs.surfaceReticle,
  reticleLabel: refs.reticleLabel,
  statusText: refs.statusText,
  trackingBadge: refs.trackingBadge,
});

const toolbar = new Toolbar(
  {
    placeButton: refs.placeButton,
    traceButton: refs.traceButton,
    lockButton: refs.lockButton,
    resetButton: refs.resetButton,
    templatesButton: refs.templatesButton,
  },
  {
    place: () => ar.place(),
    toggleTracing: () => ar.toggleTracing(),
    toggleLock: () => ar.toggleLock(),
    reset: () => ar.reset(),
    toggleTemplates: () => toggleTemplateDrawer(),
  },
);

const controls = new Controls(
  {
    opacityRange: refs.opacityRange,
    scaleRange: refs.scaleRange,
    rotationRange: refs.rotationRange,
    nudgeUpButton: refs.nudgeUpButton,
    nudgeLeftButton: refs.nudgeLeftButton,
    nudgeRightButton: refs.nudgeRightButton,
    nudgeDownButton: refs.nudgeDownButton,
    rotateLeftButton: refs.rotateLeftButton,
    rotateRightButton: refs.rotateRightButton,
    scaleDownButton: refs.scaleDownButton,
    scaleUpButton: refs.scaleUpButton,
    confirmButton: refs.confirmButton,
  },
  {
    setOpacity: (value) => ar.setOpacity(value),
    setScale: (value) => ar.setScale(value),
    setRotation: (value) => ar.setRotation(value),
    nudge: (deltaX, deltaY) => ar.nudge(deltaX, deltaY),
    rotateBy: (degrees) => ar.rotateBy(degrees),
    scaleBy: (amount) => ar.scaleBy(amount),
    confirm: () => ar.confirmPlacement(),
  },
);

templates.onChange((state) => {
  renderTemplateGrid(refs.homeTemplateGrid, state.templates, state.activeTemplate?.id);
  renderTemplateGrid(refs.arTemplateGrid, state.templates, state.activeTemplate?.id);
  ar.setTemplate(state.activeTemplate, state.activeImage);

  if (state.activeTemplate) {
    refs.homeStatus.textContent = CalibrationUI.templateSelected(state.activeTemplate.name);
  }
});

ar.onStateChange((state) => {
  toolbar.update(state);
  controls.update(state);
});

refs.startButton.addEventListener("click", () => startExperience({ mode: "world" }));
refs.previewButton.addEventListener("click", () => startExperience({ mode: "preview" }));
refs.closeButton.addEventListener("click", () => closeExperience());
refs.homeUploadButton.addEventListener("click", () => requestTemplateUpload());
refs.drawerUploadButton.addEventListener("click", () => requestTemplateUpload());
refs.drawerCloseButton.addEventListener("click", () => toggleTemplateDrawer(false));
refs.templateUpload.addEventListener("change", () => handleTemplateUpload());

await initialize();

async function initialize() {
  setBusy(true, "Loading templates...");

  try {
    await templates.init();
    await updateWorldReadiness();
    refs.homeStatus.textContent = "Choose a template, then start World AR.";
  } catch (error) {
    refs.homeStatus.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function startExperience({ mode }) {
  const isPreview = mode === "preview";

  setBusy(true, isPreview ? "Starting preview..." : "Preparing World AR...");
  let cameraActive = false;

  refs.startScreen.hidden = true;
  refs.arScreen.hidden = false;
  refs.templateDrawer.hidden = true;
  refs.cameraFeed.classList.remove("is-unavailable");
  refs.statusText.textContent = isPreview ? "Starting preview..." : "Preparing World AR...";

  try {
    ar.init({
      cameraActive,
      overlayRoot: document.body,
      forceFallback: isPreview,
    });
    ar.setTemplate(templates.activeTemplate, templates.activeImage);

    const capabilities = await ar.start({
      allowFallback: isPreview,
    });

    if (capabilities.needsCamera) {
      if (capabilities.fallbackReason) {
        refs.statusText.textContent = CalibrationUI.webXRFallback();
      } else {
        refs.statusText.textContent = "Starting camera...";
      }

      try {
        const cameraResult = await camera.start();
        cameraActive = true;
        ar.setCameraActive(cameraActive);
        refs.statusText.textContent = CalibrationUI.cameraStarted(cameraResult.label);
      } catch (error) {
        refs.cameraFeed.classList.add("is-unavailable");
        ar.setCameraActive(false);
        refs.statusText.textContent = CalibrationUI.cameraFallback();
      }
    } else {
      camera.stop();
      ar.setCameraActive(true);
      refs.statusText.textContent = CalibrationUI.webXRStarted();
    }
  } catch (error) {
    ar.stop();
    camera.stop();
    refs.arScreen.hidden = true;
    refs.startScreen.hidden = false;
    refs.homeStatus.textContent = error.message;
    updateWorldReadiness();
  } finally {
    setBusy(false);
  }
}

function closeExperience() {
  ar.stop();
  ar.reset();
  camera.stop();
  refs.arScreen.hidden = true;
  refs.startScreen.hidden = false;
  refs.templateDrawer.hidden = true;
}

function requestTemplateUpload() {
  refs.templateUpload.value = "";
  refs.templateUpload.click();
}

async function handleTemplateUpload() {
  const [file] = refs.templateUpload.files;

  if (!file) {
    return;
  }

  refs.homeStatus.textContent = "Loading template...";

  try {
    const template = await templates.addFromFile(file);
    refs.homeStatus.textContent = CalibrationUI.templateSelected(template.name);
    refs.statusText.textContent = CalibrationUI.templateSelected(template.name);
  } catch (error) {
    refs.homeStatus.textContent = error.message;
    refs.statusText.textContent = error.message;
  }
}

function renderTemplateGrid(container, list, activeId) {
  const fragment = document.createDocumentFragment();

  list.forEach((template) => {
    const button = document.createElement("button");
    button.className = "template-card";
    button.type = "button";
    button.setAttribute("aria-pressed", String(template.id === activeId));
    button.classList.toggle("is-active", template.id === activeId);

    const preview = document.createElement("span");
    preview.className = "template-preview";

    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.src = template.src;

    const name = document.createElement("span");
    name.className = "template-name";
    name.textContent = template.name;

    preview.append(image);
    button.append(preview, name);
    button.addEventListener("click", async () => {
      refs.homeStatus.textContent = `Loading ${template.name}...`;
      await templates.setActive(template.id);
      refs.statusText.textContent = CalibrationUI.templateSelected(template.name);
    });

    fragment.append(button);
  });

  container.replaceChildren(fragment);
}

function toggleTemplateDrawer(force) {
  refs.templateDrawer.hidden = typeof force === "boolean" ? !force : !refs.templateDrawer.hidden;
}

function setBusy(isBusy, message = "") {
  refs.startButton.disabled = isBusy;
  refs.previewButton.disabled = isBusy;
  refs.startButton.textContent = isBusy ? "Working..." : "Start World AR";

  if (message) {
    refs.homeStatus.textContent = message;
  }
}

async function updateWorldReadiness() {
  const readiness = await ar.getWorldReadiness();

  refs.worldReadiness.classList.toggle("is-ready", readiness.ready);
  refs.worldReadiness.classList.toggle("is-unavailable", !readiness.ready);
  refs.worldReadinessText.textContent = readiness.label;

  if (!readiness.ready) {
    refs.homeStatus.textContent = readiness.message;
  }
}
