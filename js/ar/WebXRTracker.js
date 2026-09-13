const XR_SESSION_OPTIONS = {
  requiredFeatures: ["hit-test"],
  optionalFeatures: ["anchors", "dom-overlay", "local-floor"],
};

export class WebXRTracker {
  constructor() {
    this.canvas = null;
    this.overlayRoot = null;
    this.onWorldSelect = null;
    this.onSessionEnded = null;
    this.session = null;
    this.glCanvas = null;
    this.gl = null;
    this.worldProgram = null;
    this.worldQuadBuffer = null;
    this.worldLocations = null;
    this.templateImage = null;
    this.templateTexture = null;
    this.textureReady = false;
    this.viewerSpace = null;
    this.referenceSpace = null;
    this.hitTestSource = null;
    this.latestHit = null;
    this.latestView = null;
    this.latestFrameHitResult = null;
    this.latestFrameHitTransform = null;
    this.surface = {
      available: false,
      confidence: 0,
      mode: "webxr",
    };
    this.anchors = new Map();
    this.pendingAnchorIds = new Set();
    this.pendingWorldSelect = false;
    this.running = false;
    this.handleSessionEnd = this.handleSessionEnd.bind(this);
    this.handleSelect = this.handleSelect.bind(this);
    this.handleXRFrame = this.handleXRFrame.bind(this);
  }

  static canAttempt() {
    return Boolean(window.isSecureContext && navigator.xr?.requestSession && window.XRWebGLLayer);
  }

  static async getReadiness() {
    if (!window.isSecureContext) {
      return {
        ready: false,
        label: "Needs HTTPS",
        message: "World AR needs HTTPS or Android localhost. Preview mode can still test the tracing UI.",
      };
    }

    if (!navigator.xr?.requestSession) {
      return {
        ready: false,
        label: "No WebXR",
        message: "This browser does not expose WebXR immersive AR. Use Android Chrome with ARCore for real anchoring.",
      };
    }

    if (!window.XRWebGLLayer) {
      return {
        ready: false,
        label: "No XR layer",
        message: "This browser cannot render immersive WebXR content. Preview mode is available for UI testing.",
      };
    }

    if (navigator.xr.isSessionSupported) {
      try {
        const supported = await navigator.xr.isSessionSupported("immersive-ar");

        if (!supported) {
          return {
            ready: false,
            label: "AR unsupported",
            message: "Immersive AR is not supported on this device/browser. Real paper anchoring needs WebXR AR support.",
          };
        }
      } catch (error) {
        return {
          ready: false,
          label: "AR blocked",
          message: "The browser could not verify immersive AR support. Check device AR services and permissions.",
        };
      }
    }

    return {
      ready: true,
      label: "Ready",
      message: "World AR is available. Move the phone until the reticle finds the paper.",
    };
  }

  init({ canvas, overlayRoot, onWorldSelect, onSessionEnded } = {}) {
    this.canvas = canvas;
    this.overlayRoot = overlayRoot || document.body;
    this.onWorldSelect = onWorldSelect || null;
    this.onSessionEnded = onSessionEnded || null;
  }

  async start() {
    if (!WebXRTracker.canAttempt()) {
      throw new Error("WebXR immersive AR is not available in this browser.");
    }

    try {
      this.glCanvas = document.createElement("canvas");
      this.glCanvas.className = "xr-gl-layer";
      this.gl = this.glCanvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        xrCompatible: true,
      });

      if (!this.gl) {
        throw new Error("A WebGL context is required for WebXR.");
      }

      this.session = await navigator.xr.requestSession("immersive-ar", {
        ...XR_SESSION_OPTIONS,
        domOverlay: {
          root: this.overlayRoot,
        },
      });
      this.session.addEventListener("end", this.handleSessionEnd);
      this.session.addEventListener("select", this.handleSelect);

      if (this.gl.makeXRCompatible) {
        await this.gl.makeXRCompatible();
      }

      this.initWorldRenderer();
      this.uploadTemplateTexture();
      this.session.updateRenderState({
        baseLayer: new XRWebGLLayer(this.session, this.gl),
      });

      this.referenceSpace = await this.requestBestReferenceSpace();
      this.viewerSpace = await this.session.requestReferenceSpace("viewer");
      this.hitTestSource = await this.requestHitTestSource();
      this.running = true;
      document.body.classList.add("is-xr-active");
      this.session.requestAnimationFrame(this.handleXRFrame);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    const session = this.session;
    this.cleanup();

    if (session) {
      session.end().catch(() => {});
    }
  }

  updateFrame() {
    return this.surface;
  }

  detectSurface() {
    return this.surface;
  }

  handleSelect() {
    this.queuePlacement();
  }

  queuePlacement() {
    if (!this.onWorldSelect) {
      return false;
    }

    if (this.surface.available) {
      this.onWorldSelect(this.surface.point || { x: 0.5, y: 0.5 });
      return true;
    }

    this.pendingWorldSelect = true;
    return true;
  }

  createAnchor(point) {
    const id = `xr-anchor-${Date.now()}`;
    const hitPoint = this.latestHit?.screenPoint || point;
    const anchor = {
      id,
      pose: {
        x: hitPoint.x,
        y: hitPoint.y,
        rotation: 0,
      },
      rawScreenPoint: hitPoint,
      screenOffset: {
        x: point.x - hitPoint.x,
        y: point.y - hitPoint.y,
      },
      worldMatrix: this.latestHit?.matrix ? new Float32Array(this.latestHit.matrix) : null,
      planeOffset: { x: 0, z: 0 },
      hasPlaneOffset: false,
      xrAnchor: null,
      pending: true,
      materializing: false,
      emulated: false,
    };
    const initialOffset = this.getPlaneOffsetFromScreenPoint(point, anchor);

    if (initialOffset) {
      anchor.planeOffset = initialOffset;
      anchor.hasPlaneOffset = true;
      anchor.screenOffset = { x: 0, y: 0 };
      anchor.pose = {
        ...anchor.pose,
        x: point.x,
        y: point.y,
      };
    }

    this.anchors.set(id, anchor);
    this.pendingAnchorIds.add(id);
    return anchor;
  }

  updateAnchor(id, pose) {
    const anchor = this.anchors.get(id);

    if (!anchor) {
      return;
    }

    const nextScreenPoint = {
      x: Number.isFinite(pose.x) ? pose.x : anchor.pose.x,
      y: Number.isFinite(pose.y) ? pose.y : anchor.pose.y,
    };
    const nextPlaneOffset = this.getPlaneOffsetFromScreenPoint(nextScreenPoint, anchor);

    if (nextPlaneOffset) {
      anchor.planeOffset = nextPlaneOffset;
      anchor.hasPlaneOffset = true;
      anchor.screenOffset = { x: 0, y: 0 };
    }

    if (!nextPlaneOffset && Number.isFinite(pose.x) && anchor.rawScreenPoint) {
      anchor.screenOffset.x = pose.x - anchor.rawScreenPoint.x;
    }

    if (!nextPlaneOffset && Number.isFinite(pose.y) && anchor.rawScreenPoint) {
      anchor.screenOffset.y = pose.y - anchor.rawScreenPoint.y;
    }

    anchor.pose = {
      ...anchor.pose,
      ...pose,
    };
  }

  getPose(id) {
    return this.anchors.get(id)?.pose || null;
  }

  getCapabilities() {
    return {
      name: this.session ? "World AR" : "World AR ready",
      mode: "webxr",
      needsCamera: false,
      worldAnchors: true,
      active: Boolean(this.session),
    };
  }

  setTemplateImage(image) {
    this.templateImage = image || null;
    this.textureReady = false;
    this.uploadTemplateTexture();
  }

  async requestBestReferenceSpace() {
    try {
      return await this.session.requestReferenceSpace("local-floor");
    } catch (error) {
      return this.session.requestReferenceSpace("local");
    }
  }

  async requestHitTestSource() {
    try {
      return await this.session.requestHitTestSource({
        space: this.viewerSpace,
        entityTypes: ["plane"],
      });
    } catch (error) {
      return this.session.requestHitTestSource({
        space: this.viewerSpace,
      });
    }
  }

  handleXRFrame(time, frame) {
    if (!this.running || !this.session) {
      return;
    }

    this.session.requestAnimationFrame(this.handleXRFrame);
    this.clearXRFramebuffer();

    const viewerPose = frame.getViewerPose(this.referenceSpace);
    const view = viewerPose?.views[0];

    if (!view) {
      this.surface = {
        available: false,
        confidence: 0,
        mode: "webxr",
      };
      return;
    }

    this.updateHitTest(frame, view);
    this.materializePendingAnchors(frame);
    this.updateAnchorPoses(frame, view);
    this.renderWorldAnchors(viewerPose.views);
  }

  updateHitTest(frame, view) {
    this.latestView = view;
    const hitResults = this.hitTestSource ? frame.getHitTestResults(this.hitTestSource) : [];
    const hitResult = hitResults[0];

    this.latestFrameHitResult = hitResult || null;
    this.latestFrameHitTransform = null;

    if (!hitResult) {
      this.surface = {
        available: false,
        confidence: 0.2,
        mode: "webxr",
      };
      return;
    }

    const pose = hitResult.getPose(this.referenceSpace);
    const screenPoint = pose ? projectMatrixPoint(pose.transform.matrix, view) : null;

    if (!pose || !screenPoint) {
      this.surface = {
        available: false,
        confidence: 0.35,
        mode: "webxr",
      };
      return;
    }

    this.latestFrameHitTransform = pose.transform;
    this.latestHit = {
      matrix: new Float32Array(pose.transform.matrix),
      screenPoint,
    };
    this.surface = {
      available: true,
      confidence: 1,
      mode: "webxr",
      point: screenPoint,
    };

    if (this.pendingWorldSelect && this.onWorldSelect) {
      this.pendingWorldSelect = false;
      this.onWorldSelect(screenPoint);
    }
  }

  materializePendingAnchors(frame) {
    if (!this.pendingAnchorIds.size || !this.latestFrameHitResult || !this.latestFrameHitTransform) {
      return;
    }

    this.pendingAnchorIds.forEach((id) => {
      const anchor = this.anchors.get(id);

      if (!anchor || anchor.materializing) {
        return;
      }

      anchor.materializing = true;

      if (this.latestFrameHitResult.createAnchor) {
        this.latestFrameHitResult.createAnchor().then(
          (xrAnchor) => this.resolveAnchor(id, xrAnchor),
          () => this.emulateAnchor(id),
        );
        return;
      }

      if (frame.createAnchor) {
        frame.createAnchor(this.latestFrameHitTransform, this.referenceSpace).then(
          (xrAnchor) => this.resolveAnchor(id, xrAnchor),
          () => this.emulateAnchor(id),
        );
        return;
      }

      this.emulateAnchor(id);
    });
  }

  resolveAnchor(id, xrAnchor) {
    const anchor = this.anchors.get(id);

    if (!anchor) {
      xrAnchor?.delete?.();
      return;
    }

    anchor.xrAnchor = xrAnchor;
    anchor.pending = false;
    anchor.materializing = false;
    this.pendingAnchorIds.delete(id);
  }

  emulateAnchor(id) {
    const anchor = this.anchors.get(id);

    if (!anchor) {
      return;
    }

    anchor.pending = false;
    anchor.materializing = false;
    anchor.emulated = true;
    this.pendingAnchorIds.delete(id);
  }

  updateAnchorPoses(frame, view) {
    this.anchors.forEach((anchor) => {
      let screenPoint = null;

      if (anchor.xrAnchor) {
        const pose = frame.getPose(anchor.xrAnchor.anchorSpace, this.referenceSpace);
        if (pose) {
          anchor.worldMatrix = new Float32Array(pose.transform.matrix);
          const modelMatrix = getAnchorModelMatrix(anchor);
          screenPoint = modelMatrix ? projectMatrixPoint(modelMatrix, view) : null;
        }
      } else if (anchor.worldMatrix) {
        const modelMatrix = getAnchorModelMatrix(anchor);
        screenPoint = modelMatrix ? projectMatrixPoint(modelMatrix, view) : null;
      }

      if (!screenPoint) {
        return;
      }

      anchor.rawScreenPoint = screenPoint;
      anchor.pose = {
        ...anchor.pose,
        x: clamp01(screenPoint.x + (anchor.hasPlaneOffset ? 0 : anchor.screenOffset.x)),
        y: clamp01(screenPoint.y + (anchor.hasPlaneOffset ? 0 : anchor.screenOffset.y)),
        tracking: anchor.xrAnchor ? "native" : "emulated",
      };
    });
  }

  getPlaneOffsetFromScreenPoint(point, anchor) {
    if (!this.latestView || !anchor.worldMatrix) {
      return null;
    }

    const worldPoint = screenPointToPlaneIntersection(point, anchor.worldMatrix, this.latestView);

    if (!worldPoint) {
      return null;
    }

    return worldPointToPlaneOffset(worldPoint, anchor.worldMatrix);
  }

  initWorldRenderer() {
    const vertexShader = compileShader(
      this.gl,
      this.gl.VERTEX_SHADER,
      `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        uniform mat4 u_projection;
        uniform mat4 u_view;
        uniform mat4 u_model;
        uniform vec2 u_size;
        varying vec2 v_texCoord;

        void main() {
          v_texCoord = a_texCoord;
          vec4 localPosition = vec4(a_position.x * u_size.x, 0.0, a_position.y * u_size.y, 1.0);
          gl_Position = u_projection * u_view * u_model * localPosition;
        }
      `,
    );
    const fragmentShader = compileShader(
      this.gl,
      this.gl.FRAGMENT_SHADER,
      `
        precision mediump float;
        uniform vec4 u_color;
        uniform sampler2D u_texture;
        uniform bool u_hasTexture;
        varying vec2 v_texCoord;

        void main() {
          if (u_hasTexture) {
            vec4 templateColor = texture2D(u_texture, v_texCoord);
            gl_FragColor = vec4(templateColor.rgb, templateColor.a * u_color.a);
          } else {
            gl_FragColor = u_color;
          }
        }
      `,
    );

    this.worldProgram = this.gl.createProgram();
    this.gl.attachShader(this.worldProgram, vertexShader);
    this.gl.attachShader(this.worldProgram, fragmentShader);
    this.gl.linkProgram(this.worldProgram);

    if (!this.gl.getProgramParameter(this.worldProgram, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(this.worldProgram) || "Could not link the XR world renderer.");
    }

    this.worldQuadBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.worldQuadBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([
        -0.5, -0.5, 0, 1,
        0.5, -0.5, 1, 1,
        -0.5, 0.5, 0, 0,
        0.5, 0.5, 1, 0,
      ]),
      this.gl.STATIC_DRAW,
    );

    this.worldLocations = {
      position: this.gl.getAttribLocation(this.worldProgram, "a_position"),
      texCoord: this.gl.getAttribLocation(this.worldProgram, "a_texCoord"),
      projection: this.gl.getUniformLocation(this.worldProgram, "u_projection"),
      view: this.gl.getUniformLocation(this.worldProgram, "u_view"),
      model: this.gl.getUniformLocation(this.worldProgram, "u_model"),
      size: this.gl.getUniformLocation(this.worldProgram, "u_size"),
      color: this.gl.getUniformLocation(this.worldProgram, "u_color"),
      texture: this.gl.getUniformLocation(this.worldProgram, "u_texture"),
      hasTexture: this.gl.getUniformLocation(this.worldProgram, "u_hasTexture"),
    };
  }

  uploadTemplateTexture() {
    if (!this.gl || !this.templateImage?.complete) {
      return;
    }

    if (!this.templateTexture) {
      this.templateTexture = this.gl.createTexture();
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.templateTexture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.templateImage);
    this.textureReady = true;
  }

  renderWorldAnchors(views) {
    const layer = this.session?.renderState.baseLayer;

    if (!layer || !this.gl || !this.worldProgram || !this.anchors.size) {
      return;
    }

    this.gl.useProgram(this.worldProgram);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.worldQuadBuffer);
    this.gl.enableVertexAttribArray(this.worldLocations.position);
    this.gl.vertexAttribPointer(this.worldLocations.position, 2, this.gl.FLOAT, false, 16, 0);
    this.gl.enableVertexAttribArray(this.worldLocations.texCoord);
    this.gl.vertexAttribPointer(this.worldLocations.texCoord, 2, this.gl.FLOAT, false, 16, 8);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    this.gl.depthMask(false);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.templateTexture);
    this.gl.uniform1i(this.worldLocations.texture, 0);
    this.gl.uniform1i(this.worldLocations.hasTexture, this.textureReady ? 1 : 0);

    views.forEach((view) => {
      const viewport = layer.getViewport(view);

      this.gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      this.gl.uniformMatrix4fv(this.worldLocations.projection, false, view.projectionMatrix);
      this.gl.uniformMatrix4fv(this.worldLocations.view, false, view.transform.inverse.matrix);

      this.anchors.forEach((anchor) => {
        if (!anchor.worldMatrix) {
          return;
        }

        const modelMatrix = multiplyMatrix4(getAnchorModelMatrix(anchor), makeYRotationMatrix(anchor.pose.rotation || 0));
        const size = getWorldPatchSize(anchor.pose.scale || 1, this.templateImage);
        const templateAlpha = Math.min(1, Math.max(0.15, anchor.pose.opacity ?? 0.82));
        const patchAlpha = Math.min(0.32, Math.max(0.1, templateAlpha * 0.32));

        this.gl.uniformMatrix4fv(this.worldLocations.model, false, modelMatrix);
        this.gl.uniform2f(this.worldLocations.size, size.width, size.height);
        this.gl.uniform4f(this.worldLocations.color, 0.31, 0.82, 0.75, this.textureReady ? templateAlpha : patchAlpha);
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
      });
    });

    this.gl.depthMask(true);
  }

  clearXRFramebuffer() {
    const layer = this.session?.renderState.baseLayer;

    if (!layer || !this.gl) {
      return;
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, layer.framebuffer);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  handleSessionEnd() {
    this.cleanup();

    if (this.onSessionEnded) {
      this.onSessionEnded();
    }
  }

  cleanup() {
    this.running = false;
    this.hitTestSource?.cancel?.();
    this.anchors.forEach((anchor) => anchor.xrAnchor?.delete?.());
    this.anchors.clear();
    this.pendingAnchorIds.clear();
    this.pendingWorldSelect = false;
    this.latestHit = null;
    this.latestView = null;
    this.latestFrameHitResult = null;
    this.latestFrameHitTransform = null;
    this.surface = {
      available: false,
      confidence: 0,
      mode: "webxr",
    };

    if (this.session) {
      this.session.removeEventListener("end", this.handleSessionEnd);
      this.session.removeEventListener("select", this.handleSelect);
    }

    this.session = null;
    this.viewerSpace = null;
    this.referenceSpace = null;
    this.hitTestSource = null;
    this.gl = null;
    this.worldProgram = null;
    this.worldQuadBuffer = null;
    this.worldLocations = null;
    this.templateTexture = null;
    this.textureReady = false;
    this.glCanvas?.remove();
    this.glCanvas = null;
    document.body.classList.remove("is-xr-active");
  }
}

function projectMatrixPoint(matrix, view) {
  const position = {
    x: matrix[12],
    y: matrix[13],
    z: matrix[14],
    w: 1,
  };
  const cameraPoint = multiplyMatrixAndPoint(view.transform.inverse.matrix, position);
  const clipPoint = multiplyMatrixAndPoint(view.projectionMatrix, cameraPoint);

  if (!Number.isFinite(clipPoint.w) || clipPoint.w <= 0) {
    return null;
  }

  const ndcX = clipPoint.x / clipPoint.w;
  const ndcY = clipPoint.y / clipPoint.w;

  return {
    x: clamp01((ndcX + 1) / 2),
    y: clamp01((1 - ndcY) / 2),
    depth: clipPoint.z / clipPoint.w,
  };
}

function getAnchorModelMatrix(anchor) {
  if (!anchor.worldMatrix) {
    return null;
  }

  return multiplyMatrix4(
    anchor.worldMatrix,
    makeTranslationMatrix(anchor.planeOffset?.x || 0, 0, anchor.planeOffset?.z || 0),
  );
}

function screenPointToPlaneIntersection(point, planeMatrix, view) {
  const inverseProjection = invertMatrix4(view.projectionMatrix);

  if (!inverseProjection) {
    return null;
  }

  const ndcX = point.x * 2 - 1;
  const ndcY = 1 - point.y * 2;
  const rayOrigin = transformClipPoint({ x: ndcX, y: ndcY, z: -1, w: 1 }, inverseProjection, view.transform.matrix);
  const rayTarget = transformClipPoint({ x: ndcX, y: ndcY, z: 1, w: 1 }, inverseProjection, view.transform.matrix);

  if (!rayOrigin || !rayTarget) {
    return null;
  }

  const rayDirection = normalizeVector(subtractVector(rayTarget, rayOrigin));
  const planeOrigin = getMatrixTranslation(planeMatrix);
  const planeNormal = normalizeVector({
    x: planeMatrix[4],
    y: planeMatrix[5],
    z: planeMatrix[6],
  });
  const denominator = dotVector(planeNormal, rayDirection);

  if (Math.abs(denominator) < 0.00001) {
    return null;
  }

  const distance = dotVector(subtractVector(planeOrigin, rayOrigin), planeNormal) / denominator;

  if (!Number.isFinite(distance) || distance < 0) {
    return null;
  }

  return addVector(rayOrigin, scaleVector(rayDirection, distance));
}

function worldPointToPlaneOffset(worldPoint, planeMatrix) {
  const planeOrigin = getMatrixTranslation(planeMatrix);
  const planeX = normalizeVector({
    x: planeMatrix[0],
    y: planeMatrix[1],
    z: planeMatrix[2],
  });
  const planeZ = normalizeVector({
    x: planeMatrix[8],
    y: planeMatrix[9],
    z: planeMatrix[10],
  });
  const delta = subtractVector(worldPoint, planeOrigin);

  return {
    x: dotVector(delta, planeX),
    z: dotVector(delta, planeZ),
  };
}

function transformClipPoint(point, inverseProjection, viewMatrix) {
  const viewPoint = multiplyMatrixAndPoint(inverseProjection, point);

  if (!Number.isFinite(viewPoint.w) || Math.abs(viewPoint.w) < 0.00001) {
    return null;
  }

  return multiplyMatrixAndPoint(viewMatrix, {
    x: viewPoint.x / viewPoint.w,
    y: viewPoint.y / viewPoint.w,
    z: viewPoint.z / viewPoint.w,
    w: 1,
  });
}

function multiplyMatrixAndPoint(matrix, point) {
  return {
    x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12] * point.w,
    y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13] * point.w,
    z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14] * point.w,
    w: matrix[3] * point.x + matrix[7] * point.y + matrix[11] * point.z + matrix[15] * point.w,
  };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Could not compile the XR world renderer.");
  }

  return shader;
}

function getWorldPatchSize(scale, image) {
  const width = 0.18 * Math.min(2.2, Math.max(0.35, scale));
  const aspectRatio = image?.naturalWidth && image?.naturalHeight ? image.naturalHeight / image.naturalWidth : 0.72;

  return {
    width,
    height: width * aspectRatio,
  };
}

function makeYRotationMatrix(degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return new Float32Array([
    cos, 0, -sin, 0,
    0, 1, 0, 0,
    sin, 0, cos, 0,
    0, 0, 0, 1,
  ]);
}

function makeTranslationMatrix(x, y, z) {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function multiplyMatrix4(a, b) {
  const out = new Float32Array(16);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }

  return out;
}

function invertMatrix4(matrix) {
  const a00 = matrix[0];
  const a01 = matrix[1];
  const a02 = matrix[2];
  const a03 = matrix[3];
  const a10 = matrix[4];
  const a11 = matrix[5];
  const a12 = matrix[6];
  const a13 = matrix[7];
  const a20 = matrix[8];
  const a21 = matrix[9];
  const a22 = matrix[10];
  const a23 = matrix[11];
  const a30 = matrix[12];
  const a31 = matrix[13];
  const a32 = matrix[14];
  const a33 = matrix[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

  if (!determinant) {
    return null;
  }

  const inverseDeterminant = 1 / determinant;

  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant,
    (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant,
    (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant,
    (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant,
    (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant,
    (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant,
    (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant,
    (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant,
    (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant,
    (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant,
    (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant,
    (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant,
    (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant,
    (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant,
    (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant,
    (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant,
  ]);
}

function getMatrixTranslation(matrix) {
  return {
    x: matrix[12],
    y: matrix[13],
    z: matrix[14],
  };
}

function addVector(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function subtractVector(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function dotVector(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
