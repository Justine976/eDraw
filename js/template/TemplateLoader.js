export const BUILT_IN_TEMPLATES = [
  {
    id: "cat",
    name: "Cat",
    src: "./assets/templates/cat.svg",
    source: "built-in",
  },
  {
    id: "portrait",
    name: "Portrait",
    src: "./assets/templates/portrait.svg",
    source: "built-in",
  },
  {
    id: "car",
    name: "Car",
    src: "./assets/templates/car.svg",
    source: "built-in",
  },
  {
    id: "leaf",
    name: "Leaf",
    src: "./assets/templates/leaf.svg",
    source: "built-in",
  },
];

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml"]);

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";

    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Template image could not be loaded.")), { once: true });

    image.src = src;
  });
}

export function fileToTemplate(file) {
  if (!file || !ACCEPTED_TYPES.has(file.type)) {
    return Promise.reject(new Error("Use a PNG, JPG, or SVG template."));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve({
        id: createTemplateId(),
        name: cleanTemplateName(file.name),
        src: reader.result,
        source: "upload",
        type: file.type,
        createdAt: Date.now(),
      });
    });

    reader.addEventListener("error", () => reject(new Error("Template file could not be read.")));
    reader.readAsDataURL(file);
  });
}

function createTemplateId() {
  if (globalThis.crypto?.randomUUID) {
    return `custom-${globalThis.crypto.randomUUID()}`;
  }

  return `custom-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function cleanTemplateName(fileName) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const collapsed = withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 32) || "Custom template";
}
