import { BUILT_IN_TEMPLATES, fileToTemplate, loadImage } from "./TemplateLoader.js";

const DB_NAME = "edraw-template-library";
const DB_VERSION = 1;
const STORE_NAME = "templates";

export class TemplateManager {
  constructor() {
    this.templates = [...BUILT_IN_TEMPLATES];
    this.activeTemplate = null;
    this.activeImage = null;
    this.imageCache = new Map();
    this.listeners = new Set();
  }

  async init() {
    const savedTemplates = await loadSavedTemplates();
    this.templates = [...BUILT_IN_TEMPLATES, ...savedTemplates];
    await this.setActive(this.templates[0].id, { silent: true });
    this.emit();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAll() {
    return [...this.templates];
  }

  async setActive(id, options = {}) {
    const template = this.templates.find((item) => item.id === id);

    if (!template) {
      throw new Error("Template was not found.");
    }

    this.activeTemplate = template;
    this.activeImage = await this.getImage(template.src);

    if (!options.silent) {
      this.emit();
    }
  }

  async addFromFile(file) {
    const template = await fileToTemplate(file);
    await saveTemplate(template);
    this.templates = [...this.templates, template];
    await this.setActive(template.id);
    return template;
  }

  async getImage(src) {
    if (!this.imageCache.has(src)) {
      this.imageCache.set(src, loadImage(src));
    }

    return this.imageCache.get(src);
  }

  emit() {
    const state = {
      templates: this.getAll(),
      activeTemplate: this.activeTemplate,
      activeImage: this.activeImage,
    };

    this.listeners.forEach((listener) => listener(state));
  }
}

async function loadSavedTemplates() {
  try {
    const db = await openDatabase();
    return await requestFromStore(db, "readonly", (store) => store.getAll());
  } catch (error) {
    return [];
  }
}

async function saveTemplate(template) {
  try {
    const db = await openDatabase();
    await requestFromStore(db, "readwrite", (store) => store.put(template));
  } catch (error) {
    throw new Error("The template could not be saved in this browser.");
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function requestFromStore(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => db.close());
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}
