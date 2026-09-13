# eDraw

eDraw is a browser-based camera tracing prototype. It starts with a no-backend proof of concept: select a drawing template, open the camera, place the template over the paper, adjust it, lock it, and trace.

## Run

```sh
python -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

Use `localhost` or HTTPS for camera access. Mobile browsers usually require permission and a supported camera.

## Testing Real Anchoring

Real paper anchoring needs the `World AR` badge in the app. If the app shows `Preview mode`, the template is not anchored to the real world.

In World AR, point the center reticle at the paper/table and tap `Place`. If WebXR has not produced a hit-test yet, eDraw arms placement and drops the template onto the first detected surface.

For local testing on Android:

```sh
adb reverse tcp:5173 tcp:5173
```

Then open this on the Android device:

```text
http://127.0.0.1:5173/
```

That keeps the page on a browser secure origin while using your desktop dev server. Opening `http://192.168.x.x:5173/` from the phone is not enough for WebXR because it is not HTTPS or device-local localhost.

Desktop browsers and iPhone Safari do not provide the browser-native markerless WebXR AR path needed for this no-backend prototype. For MyWebAR-style cross-platform anchoring on iOS and Android, eDraw would need a commercial WebAR SDK or a native ARKit/ARCore app wrapper.

## Current POC

- Static HTML/CSS/JavaScript
- WebXR hit-test startup on supported secure mobile browsers
- Optional WebXR anchor creation, with emulated anchors when the anchors API is missing
- WebXR world-space rendering for the selected SVG/PNG/JPG template
- Translucent WebXR placement patch when a template texture is not ready
- Plane-space drag calibration in WebXR mode
- Rear-camera request for the fallback camera-overlay mode
- Template library with built-in SVG line drawings
- PNG, JPG, and SVG uploads saved in IndexedDB
- Placement, drag, pinch scale, two-finger rotate, nudge controls, opacity, lock, reset, and tracing mode
- Tracking abstraction in `js/ar/TrackingManager.js`

The primary button now starts WebXR World AR only. If the browser rejects `immersive-ar` or `hit-test`, eDraw stays on the start screen and reports the issue. `Open Preview` is separate and is only for testing templates, touch controls, and tracing UI.

Only the WebXR path is real world tracking. Preview mode is useful for testing templates, touch controls, and the tracing UI, but it cannot keep the drawing fixed to paper while the device moves.

## Next Milestone

The WebXR backend now renders the selected template as a textured plane in world space and projects the same anchor into the 2D tracing canvas. Drag calibration updates the template's offset on the detected plane. The next step is a device pass on Android Chrome or another WebXR AR browser to tune scale, placement depth, and hit-test behavior against real paper.
