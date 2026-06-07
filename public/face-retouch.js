(function () {
  "use strict";

  const BUTTON_SELECTOR = "#faceRetouchButton, [data-protone-face-retouch], [data-face-retouch-button], .face-retouch-button";
  const PANEL_ID = "faceRetouchPanel";
  const OVERLAY_ID = "faceRetouchOverlay";
  const STYLE_ID = "faceRetouchStyles";
  const PATCH_FLAG = "__protoneFaceRetouchPatchState";
  const DETECT_MAX_EDGE = 1200;

  const DEFAULT_OPTIONS = Object.freeze({
    enabled: true,
    skinSmoothing: 34,
    wrinkleRemoval: 28,
    blemishSoftening: 18,
    darkCircleRemoval: 24,
    toneEvenness: 24,
    faceBrightness: 4
  });

  const SLIDERS = [
    { key: "skinSmoothing", label: "피부 부드러움", min: 0, max: 100, step: 1 },
    { key: "wrinkleRemoval", label: "주름 완화", min: 0, max: 100, step: 1 },
    { key: "blemishSoftening", label: "잡티 완화", min: 0, max: 100, step: 1 },
    { key: "darkCircleRemoval", label: "다크서클 완화", min: 0, max: 100, step: 1 },
    { key: "toneEvenness", label: "피부톤 균일", min: 0, max: 100, step: 1 },
    { key: "faceBrightness", label: "얼굴 밝기", min: -30, max: 30, step: 1 }
  ];

  const state = {
    options: { ...DEFAULT_OPTIONS },
    active: false,
    selectionMode: false,
    detecting: false,
    button: null,
    panel: null,
    overlay: null,
    meta: null,
    sliderList: null,
    controls: new Map(),
    boundButtons: new WeakSet(),
    originalProcessCanvas: null,
    originalRenderSelected: null,
    originalSavePhoto: null,
    observer: null,
    pollTimer: 0,
    aiApiUnavailable: false,
    detectToken: 0,
    detectTimer: 0,
    renderFrame: 0,
    processingPhoto: null,
    lastPhoto: null,
    lastAnchor: null,
    lastDebug: "초기화됨"
  };

  window.ProToneFaceRetouch = {
    applyToCanvas,
    bindButton,
    closePanel,
    detectCurrentPhoto,
    getOptions,
    getDebugInfo,
    openPanel,
    refreshPreview,
    reset,
    setOptions,
    togglePanel
  };

  patchWhenReady();
  bootWhenReady();

  function bootWhenReady() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
      return;
    }
    boot();
  }

  function boot() {
    injectStyles();
    ensureToolbarButton();
    bindAvailableButtons();
    observeButtons();
    startPhotoPolling();
    scheduleFaceDetection();

    window.addEventListener("resize", () => {
      renderFaceOverlay(getCurrentPhoto());
      if (state.panel && !state.panel.hidden) {
        positionPanel(state.lastAnchor || state.button);
      }
    });
  }

  function patchWhenReady(attempt = 0) {
    const patchState = window[PATCH_FLAG] || { processCanvas: false, renderSelected: false, savePhoto: false };
    window[PATCH_FLAG] = patchState;

    if (!patchState.processCanvas && typeof window.processCanvas === "function") {
      state.originalProcessCanvas = window.processCanvas;
      window.processCanvas = function patchedProcessCanvas(sourceCanvas, currentSettings) {
        const processed = state.originalProcessCanvas(sourceCanvas, currentSettings);
        if (!state.active || !state.options.enabled) {
          return processed;
        }

        const photo = state.processingPhoto || getCurrentPhoto();
        const faces = getSelectedFacesForCanvas(photo, processed.width, processed.height);
        if (!faces.length) {
          return processed;
        }

        return applyToCanvas(processed, state.options, faces);
      };
      patchState.processCanvas = true;
    }

    if (!patchState.renderSelected && typeof window.renderSelected === "function") {
      state.originalRenderSelected = window.renderSelected;
      window.renderSelected = function patchedRenderSelected() {
        const result = state.originalRenderSelected.apply(this, arguments);
        scheduleFaceDetection(120);
        return result;
      };
      patchState.renderSelected = true;
    }

    if (!patchState.savePhoto && typeof window.savePhoto === "function") {
      state.originalSavePhoto = window.savePhoto;
      window.savePhoto = async function patchedSavePhoto(photo, photoSettings) {
        const previous = state.processingPhoto;
        state.processingPhoto = photo;
        try {
          return await state.originalSavePhoto.call(this, photo, photoSettings);
        } finally {
          state.processingPhoto = previous;
        }
      };
      patchState.savePhoto = true;
    }

    if ((!patchState.processCanvas || !patchState.renderSelected || !patchState.savePhoto) && attempt < 80) {
      window.setTimeout(() => patchWhenReady(attempt + 1), 50);
    }
  }

  function ensureToolbarButton() {
    let button = document.querySelector("#faceRetouchButton");
    if (!button) {
      const rotateButton = document.querySelector("#rotateButton");
      const toolbar = rotateButton?.parentElement || document.querySelector(".canvas-tools");
      if (!toolbar) {
        return null;
      }

      button = document.createElement("button");
      button.id = "faceRetouchButton";
      button.className = "tool-button icon-tool face-retouch-button";
      button.type = "button";
      button.title = "얼굴 보정";
      button.setAttribute("aria-label", "얼굴 보정");
      button.textContent = "☺";
      button.disabled = true;
      rotateButton?.after(button) || toolbar.append(button);
    }

    state.button = button;
    return button;
  }

  function bindAvailableButtons() {
    document.querySelectorAll(BUTTON_SELECTOR).forEach(bindButton);
  }

  function observeButtons() {
    if (state.observer || !("MutationObserver" in window)) {
      return;
    }

    state.observer = new MutationObserver(() => {
      ensureToolbarButton();
      bindAvailableButtons();
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function bindButton(button) {
    if (!button || state.boundButtons.has(button)) {
      return false;
    }

    state.boundButtons.add(button);
    button.type = button.type || "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.dataset.faceRetouchBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void togglePanel(button);
    });
    syncButtonState(button);
    return true;
  }

  async function togglePanel(anchor) {
    const photo = getCurrentPhoto();
    debug("button_click", { hasPhoto: Boolean(photo), sceneName: photo?.sceneName || "", summary: photo?.smartSummary || "" }, true);
    state.detecting = true;
    syncAllButtons();
    let analysis = { faces: [] };
    try {
      analysis = await ensureFaceAnalysis(photo, false);
    } catch (error) {
      console.warn("Face retouch analysis failed", error);
    } finally {
      state.detecting = false;
      syncAllButtons();
    }
    if (!photo || !analysis.faces.length) {
      closePanel();
      return;
    }

    if (state.panel && !state.panel.hidden && !state.selectionMode) {
      closePanel();
      return;
    }

    if (analysis.faces.length === 1) {
      setSelectedFaceIds(photo, [analysis.faces[0].id]);
      state.active = true;
      state.selectionMode = false;
      hideFaceOverlay();
      openPanel(anchor);
      refreshPreview();
      return;
    }

    state.selectionMode = true;
    state.active = getSelectedFaceIds(photo).length > 0;
    renderFaceOverlay(photo);
    openPanel(anchor);
    refreshPreview();
  }

  function openPanel(anchor) {
    ensurePanel();
    state.lastAnchor = anchor || state.button;
    syncPanelControls();
    positionPanel(state.lastAnchor);
    state.panel.hidden = false;
    syncAllButtons();
  }

  function closePanel() {
    if (state.panel) {
      state.panel.hidden = true;
    }
    state.selectionMode = false;
    hideFaceOverlay();
    syncAllButtons();
  }

  function ensurePanel() {
    if (state.panel) {
      return state.panel;
    }

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "face-retouch-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "얼굴 보정");

    const title = document.createElement("div");
    title.className = "face-retouch-title";
    title.textContent = "얼굴 보정";

    const enableLabel = document.createElement("label");
    enableLabel.className = "face-retouch-toggle";
    const enableInput = document.createElement("input");
    enableInput.type = "checkbox";
    enableInput.checked = state.options.enabled;
    enableInput.addEventListener("change", () => {
      setOptions({ enabled: enableInput.checked });
    });
    const enableText = document.createElement("span");
    enableText.textContent = "적용";
    enableLabel.append(enableInput, enableText);

    const header = document.createElement("header");
    header.className = "face-retouch-header";
    header.append(title, enableLabel);

    const meta = document.createElement("p");
    meta.className = "face-retouch-meta";

    const sliderList = document.createElement("div");
    sliderList.className = "face-retouch-sliders";
    for (const slider of SLIDERS) {
      sliderList.append(createSlider(slider));
    }

    const footer = document.createElement("footer");
    footer.className = "face-retouch-footer";

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "초기화";
    resetButton.addEventListener("click", reset);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "닫기";
    closeButton.addEventListener("click", closePanel);

    footer.append(resetButton, closeButton);
    panel.append(header, meta, sliderList, footer);
    document.body.append(panel);

    state.panel = panel;
    state.meta = meta;
    state.sliderList = sliderList;
    state.controls.set("enabled", enableInput);
    return panel;
  }

  function createSlider(slider) {
    const field = document.createElement("label");
    field.className = "face-retouch-slider";

    const row = document.createElement("span");
    row.className = "face-retouch-slider-row";

    const label = document.createElement("span");
    label.textContent = slider.label;

    const value = document.createElement("output");
    value.textContent = String(state.options[slider.key]);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(slider.min);
    input.max = String(slider.max);
    input.step = String(slider.step);
    input.value = String(state.options[slider.key]);
    input.addEventListener("input", () => {
      value.textContent = input.value;
      setOptions({ [slider.key]: Number(input.value) });
    });

    row.append(label, value);
    field.append(row, input);
    state.controls.set(slider.key, { input, value });
    return field;
  }

  function positionPanel(anchor) {
    if (!state.panel || !anchor || typeof anchor.getBoundingClientRect !== "function") {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(330, window.innerWidth - 20);
    const panelHeight = Math.min(state.panel.offsetHeight || 430, window.innerHeight - 20);
    const left = clamp(rect.right - width, 10, Math.max(10, window.innerWidth - width - 10));
    const top = clamp(rect.bottom + 8, 10, Math.max(10, window.innerHeight - panelHeight - 10));
    state.panel.style.left = `${Math.round(left)}px`;
    state.panel.style.top = `${Math.round(top)}px`;
    state.panel.style.width = `${Math.round(width)}px`;
  }

  function setOptions(nextOptions) {
    state.options = normalizeOptions({ ...state.options, ...nextOptions });
    syncPanelControls();
    syncAllButtons();
    refreshPreview();
  }

  function getOptions() {
    return { ...state.options };
  }

  function reset() {
    setOptions({ ...DEFAULT_OPTIONS });
  }

  function normalizeOptions(options) {
    return {
      enabled: options.enabled !== false,
      skinSmoothing: clampInt(options.skinSmoothing, 0, 100, DEFAULT_OPTIONS.skinSmoothing),
      wrinkleRemoval: clampInt(options.wrinkleRemoval, 0, 100, DEFAULT_OPTIONS.wrinkleRemoval),
      blemishSoftening: clampInt(options.blemishSoftening, 0, 100, DEFAULT_OPTIONS.blemishSoftening),
      darkCircleRemoval: clampInt(options.darkCircleRemoval, 0, 100, DEFAULT_OPTIONS.darkCircleRemoval),
      toneEvenness: clampInt(options.toneEvenness, 0, 100, DEFAULT_OPTIONS.toneEvenness),
      faceBrightness: clampInt(options.faceBrightness, -30, 30, DEFAULT_OPTIONS.faceBrightness)
    };
  }

  function syncPanelControls() {
    const photo = getCurrentPhoto();
    const selectedCount = getSelectedFaceIds(photo).length;
    const faceCount = getFaceAnalysis(photo)?.faces.length || 0;

    const enabled = state.controls.get("enabled");
    if (enabled) {
      enabled.checked = state.options.enabled;
      enabled.disabled = selectedCount === 0;
    }

    for (const slider of SLIDERS) {
      const control = state.controls.get(slider.key);
      if (!control) {
        continue;
      }
      const value = String(state.options[slider.key]);
      control.input.value = value;
      control.input.disabled = selectedCount === 0;
      control.value.textContent = value;
    }

    if (state.meta) {
      state.meta.textContent = selectedCount > 0
        ? `선택된 얼굴 ${selectedCount}개에만 보정을 적용합니다.`
        : faceCount > 1
          ? "수정할 얼굴을 선택하세요. 여러 얼굴을 함께 선택할 수 있습니다."
          : "얼굴 보정 옵션을 준비하고 있습니다.";
    }

    if (state.sliderList) {
      state.sliderList.hidden = selectedCount === 0;
    }
  }

  function syncAllButtons() {
    document.querySelectorAll(BUTTON_SELECTOR).forEach(syncButtonState);
  }

  function syncButtonState(button) {
    if (!button) {
      return;
    }

    const photo = getCurrentPhoto();
    const faceCount = getFaceAnalysis(photo)?.faces.length || 0;
    const canUse = Boolean(photo && faceCount > 0 && !state.detecting);

    button.disabled = !canUse;
    button.classList.toggle("is-active", Boolean(state.panel && !state.panel.hidden));
    button.classList.toggle("is-face-retouch-ready", canUse && !state.active);
    button.classList.toggle("is-face-retouch-enabled", state.active && state.options.enabled && getSelectedFaceIds(photo).length > 0);
    button.classList.toggle("is-face-retouch-detecting", state.detecting);
    button.setAttribute("aria-expanded", state.panel && !state.panel.hidden ? "true" : "false");
    button.setAttribute("aria-busy", state.detecting ? "true" : "false");
    button.title = state.detecting
      ? "얼굴 감지 중"
      : canUse
        ? faceCount > 0 ? `얼굴 보정 (${faceCount}개 감지됨)` : "얼굴 보정"
        : photo ? "얼굴을 감지하지 못했습니다" : "사진을 올리면 얼굴 보정을 사용할 수 있습니다";
  }

  function startPhotoPolling() {
    if (state.pollTimer) {
      return;
    }

    state.pollTimer = window.setInterval(() => {
      const photo = getCurrentPhoto();
      if (photo === state.lastPhoto) {
        syncAllButtons();
        return;
      }

      state.lastPhoto = photo;
      state.active = false;
      state.selectionMode = false;
      hideFaceOverlay();
      if (state.panel && !state.panel.hidden) {
        closePanel();
      }
      scheduleFaceDetection(120);
      syncAllButtons();
    }, 450);
  }

  function refreshPreview() {
    window.cancelAnimationFrame(state.renderFrame);
    state.renderFrame = window.requestAnimationFrame(() => {
      if (typeof window.renderSelected === "function") {
        window.renderSelected();
      }
    });
  }

  function scheduleFaceDetection(delay = 80) {
    window.clearTimeout(state.detectTimer);
    state.detectTimer = window.setTimeout(() => {
      void detectCurrentPhoto();
    }, delay);
  }

  async function detectCurrentPhoto() {
    const photo = getCurrentPhoto();
    const token = ++state.detectToken;

    if (!photo) {
      debug("detect_skip_no_photo", {}, false);
      state.active = false;
      state.selectionMode = false;
      hideFaceOverlay();
      closePanel();
      syncAllButtons();
      return null;
    }

    state.detecting = true;
    syncAllButtons();

    try {
      const analysis = await ensureFaceAnalysis(photo, true);
      debug("detect_done", { faces: analysis.faces.length, sourceWidth: analysis.sourceWidth, sourceHeight: analysis.sourceHeight }, false);
      if (token !== state.detectToken) {
        return analysis;
      }

      if (!analysis.faces.length) {
        state.active = false;
        state.selectionMode = false;
        hideFaceOverlay();
        if (state.panel && !state.panel.hidden) {
          closePanel();
        }
      }

      renderFaceOverlay(photo);
      syncPanelControls();
      return analysis;
    } finally {
      if (token === state.detectToken) {
        state.detecting = false;
        syncAllButtons();
      }
    }
  }

  async function ensureFaceAnalysis(photo, allowCached = true) {
    if (!photo || typeof window.createSourceCanvas !== "function") {
      debug("analysis_unavailable", { hasPhoto: Boolean(photo), hasCreateSourceCanvas: typeof window.createSourceCanvas === "function" }, true);
      return { faces: [], sourceWidth: 0, sourceHeight: 0, rotation: 0 };
    }

    const rotation = Number(photo.rotation || 0);
    const cached = getFaceAnalysis(photo);
    if (allowCached && cached && cached.rotation === rotation) {
      if (!cached.faces.length && shouldUsePortraitFallback(photo)) {
        debug("cache_empty_reset_for_portrait", { sceneName: photo.sceneName || "", summary: photo.smartSummary || "" }, false);
        photo.__faceRetouchAnalysis = null;
      } else {
        debug("analysis_cache_hit", { faces: cached.faces.length }, false);
        return cached;
      }
    }

    const refreshedCached = getFaceAnalysis(photo);
    if (allowCached && refreshedCached && refreshedCached.rotation === rotation) {
      debug("analysis_cache_hit_refreshed", { faces: refreshedCached.faces.length }, false);
      return refreshedCached;
    }

    const sourceCanvas = window.createSourceCanvas(photo, DETECT_MAX_EDGE);
    debug("analysis_start", { width: sourceCanvas.width, height: sourceCanvas.height, allowCached }, false);
    const detected = await detectFaces(sourceCanvas);
    let faces = normalizeFaces(detected, sourceCanvas.width, sourceCanvas.height);
    debug("analysis_normalized", { rawFaces: detected.length, faces: faces.length }, false);
    if (!faces.length && shouldUsePortraitFallback(photo)) {
      faces = normalizeFaces([buildPrimaryFaceCandidate(sourceCanvas.width, sourceCanvas.height)], sourceCanvas.width, sourceCanvas.height);
      debug("portrait_fallback_used", { faces: faces.length, sceneName: photo.sceneName || "", summary: photo.smartSummary || "" }, true);
    }
    const analysis = {
      rotation,
      sourceWidth: sourceCanvas.width,
      sourceHeight: sourceCanvas.height,
      faces
    };

    photo.__faceRetouchAnalysis = analysis;
    setSelectedFaceIds(photo, getSelectedFaceIds(photo).filter((id) => faces.some((face) => face.id === id)));
    return analysis;
  }

  function getFaceAnalysis(photo) {
    return photo?.__faceRetouchAnalysis || null;
  }

  function shouldUsePortraitFallback(photo) {
    if (!photo) {
      return false;
    }

    const settings = photo.settings || {};
    const text = [
      photo.sceneName,
      photo.smartSummary,
      settings.styleKey,
      settings.presetKey
    ].filter(Boolean).join(" ").toLowerCase();

    return text.includes("portrait") ||
      text.includes("selfie") ||
      text.includes("인물") ||
      text.includes("셀카") ||
      text.includes("사람") ||
      text.includes("얼굴");
  }

  function buildPrimaryFaceCandidate(width, height) {
    const portraitish = height >= width * 0.9;
    const faceWidth = width * (portraitish ? 0.58 : 0.42);
    const faceHeight = height * (portraitish ? 0.56 : 0.46);
    return {
      x: (width - faceWidth) * 0.5,
      y: height * (portraitish ? 0.26 : 0.2),
      width: faceWidth,
      height: faceHeight,
      confidence: 0.36
    };
  }

  async function detectFaces(canvas) {
    const aiFaces = await requestAiFaceDetection(canvas);
    if (aiFaces.length) {
      debug("ai_faces_used", { faces: aiFaces.length }, true);
      return aiFaces;
    }

    if ("FaceDetector" in window) {
      try {
        const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 24 });
        const nativeFaces = await detector.detect(canvas);
        if (nativeFaces.length) {
          debug("native_faces_used", { faces: nativeFaces.length }, true);
          return nativeFaces.map((face) => ({
            x: face.boundingBox.x,
            y: face.boundingBox.y,
            width: face.boundingBox.width,
            height: face.boundingBox.height,
            confidence: 1
          }));
        }
      } catch (error) {
        console.warn("FaceDetector unavailable, using local fallback", error);
        debug("native_face_detector_failed", { message: error instanceof Error ? error.message : String(error) }, false);
      }
    }

    const fallbackFaces = fallbackDetectFaces(canvas);
    debug("local_fallback_used", { faces: fallbackFaces.length }, true);
    return fallbackFaces;
  }

  async function requestAiFaceDetection(canvas) {
    if (state.aiApiUnavailable) {
      debug("ai_skip_unavailable", {}, false);
      return [];
    }

    const supabase = getSupabaseConfig();
    if (!supabase) {
      state.aiApiUnavailable = true;
      debug("ai_skip_no_supabase_config", { hasConfig: Boolean(window.PROTONE_SUPABASE) }, true);
      return [];
    }

    try {
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.82);
      debug("ai_request_start", { endpoint: `${supabase.url}/functions/v1/detect-faces`, payloadLength: imageDataUrl.length }, false);
      const response = await fetch(`${supabase.url}/functions/v1/detect-faces`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain"
        },
        body: JSON.stringify({ imageDataUrl })
      });

      if (!response.ok) {
        console.warn("AI face detection failed", response.status);
        const detail = await response.text().catch(() => "");
        debug("ai_response_error", { status: response.status, detail: detail.slice(0, 220) }, true);
        return [];
      }

      const payload = await response.json();
      const faces = normalizeAiFaces(payload.faces, canvas.width, canvas.height);
      debug("ai_response_ok", { rawFaces: Array.isArray(payload.faces) ? payload.faces.length : -1, faces: faces.length }, true);
      return faces;
    } catch (error) {
      console.warn("AI face detection unavailable", error);
      debug("ai_request_failed", { message: error instanceof Error ? error.message : String(error) }, true);
      return [];
    }
  }

  function normalizeAiFaces(rawFaces, width, height) {
    if (!Array.isArray(rawFaces)) {
      return [];
    }

    return rawFaces.map((face) => ({
      x: clamp(Number(face.x) * width, 0, width),
      y: clamp(Number(face.y) * height, 0, height),
      width: clamp(Number(face.width) * width, 0, width),
      height: clamp(Number(face.height) * height, 0, height),
      confidence: Number.isFinite(Number(face.confidence)) ? clamp(Number(face.confidence), 0, 1) : 0.8
    }));
  }

  function getSupabaseConfig() {
    const config = window.PROTONE_SUPABASE || {};
    const url = String(config.url || "").replace(/\/$/, "");
    const anonKey = String(config.anonKey || "");
    if (!url || url.includes("YOUR_SUPABASE")) {
      return null;
    }
    return { url, anonKey };
  }

  function getDebugInfo() {
    const photo = getCurrentPhoto();
    const analysis = getFaceAnalysis(photo);
    return {
      lastDebug: state.lastDebug,
      aiApiUnavailable: state.aiApiUnavailable,
      detecting: state.detecting,
      hasPhoto: Boolean(photo),
      sceneName: photo?.sceneName || "",
      smartSummary: photo?.smartSummary || "",
      faces: analysis?.faces.length || 0,
      selectedFaces: getSelectedFaceIds(photo).length,
      hasSupabaseConfig: Boolean(getSupabaseConfig())
    };
  }

  function debug(event, detail = {}, visible = false) {
    const safeDetail = {};
    for (const [key, value] of Object.entries(detail || {})) {
      if (typeof value === "string") {
        safeDetail[key] = value.length > 180 ? `${value.slice(0, 180)}...` : value;
      } else {
        safeDetail[key] = value;
      }
    }

    state.lastDebug = `${event}: ${JSON.stringify(safeDetail)}`;
    console.info("[ProToneFaceRetouch]", event, safeDetail);
  }

  function normalizeFaces(rawFaces, sourceWidth, sourceHeight) {
    const area = sourceWidth * sourceHeight;
    return rawFaces
      .map((face, index) => ({
        id: `face-${index}`,
        x: clamp(face.x, 0, sourceWidth),
        y: clamp(face.y, 0, sourceHeight),
        width: clamp(face.width, 0, sourceWidth),
        height: clamp(face.height, 0, sourceHeight),
        confidence: Number.isFinite(face.confidence) ? face.confidence : 0.7
      }))
      .filter((face) => {
        const faceArea = face.width * face.height;
        const minEdge = Math.min(face.width, face.height);
        const ratio = faceArea / Math.max(1, area);
        return faceArea > 0 && minEdge >= 24 && ratio >= 0.0014;
      })
      .sort((a, b) => a.x - b.x)
      .map((face, index) => ({ ...face, id: `face-${index}` }));
  }

  function fallbackDetectFaces(sourceCanvas) {
    const maxEdge = 420;
    const scale = Math.min(1, maxEdge / Math.max(sourceCanvas.width, sourceCanvas.height));
    const width = Math.max(1, Math.round(sourceCanvas.width * scale));
    const height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(sourceCanvas, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    const mask = new Uint8Array(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (skinMask(data[index], data[index + 1], data[index + 2]) > 0.38) {
          mask[y * width + x] = 1;
        }
      }
    }

    const visited = new Uint8Array(mask.length);
    const stack = new Int32Array(mask.length);
    const components = [];
    const minArea = Math.max(70, Math.round(width * height * 0.00055));

    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) {
        continue;
      }

      let stackSize = 0;
      let area = 0;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      visited[start] = 1;
      stack[stackSize++] = start;

      while (stackSize > 0) {
        const point = stack[--stackSize];
        const x = point % width;
        const y = Math.floor(point / width);
        area += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        visitNeighbor(point - 1, x > 0);
        visitNeighbor(point + 1, x < width - 1);
        visitNeighbor(point - width, y > 0);
        visitNeighbor(point + width, y < height - 1);
      }

      if (area < minArea) {
        continue;
      }

      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const aspect = boxWidth / Math.max(1, boxHeight);
      const fill = area / Math.max(1, boxWidth * boxHeight);
      const centerX = (minX + maxX) * 0.5 / width;
      const centerWeight = 1 - Math.min(0.55, Math.abs(centerX - 0.5));
      const score = area * fill * centerWeight;

      if (boxWidth >= 18 && boxHeight >= 20 && aspect >= 0.45 && aspect <= 1.75 && fill >= 0.18 && fill <= 0.88) {
        components.push({
          x: minX / scale,
          y: minY / scale,
          width: boxWidth / scale,
          height: boxHeight / scale,
          confidence: clamp(score / 900, 0.2, 0.82)
        });
      }
    }

    if (!components.length) {
      const aggregate = buildSkinAggregateCandidate(mask, width, height, scale);
      if (aggregate) {
        components.push(aggregate);
      }
    }

    return dedupeFaces(components)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height))
      .slice(0, 12);

    function visitNeighbor(point, inside) {
      if (!inside || !mask[point] || visited[point]) {
        return;
      }
      visited[point] = 1;
      stack[stackSize++] = point;
    }
  }

  function buildSkinAggregateCandidate(mask, width, height, scale) {
    const leftLimit = Math.round(width * 0.16);
    const rightLimit = Math.round(width * 0.84);
    const topLimit = Math.round(height * 0.08);
    const bottomLimit = Math.round(height * 0.82);

    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    for (let y = topLimit; y < bottomLimit; y += 1) {
      for (let x = leftLimit; x < rightLimit; x += 1) {
        if (!mask[y * width + x]) {
          continue;
        }

        count += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    const scanArea = Math.max(1, (rightLimit - leftLimit) * (bottomLimit - topLimit));
    const skinRatio = count / scanArea;
    if (count < 220 || skinRatio < 0.006) {
      return null;
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const aspect = boxWidth / Math.max(1, boxHeight);
    if (boxWidth < 20 || boxHeight < 24 || aspect < 0.34 || aspect > 2.35) {
      return null;
    }

    const paddingX = boxWidth * 0.32;
    const paddingTop = boxHeight * 0.28;
    const paddingBottom = boxHeight * 0.18;
    return {
      x: Math.max(0, (minX - paddingX) / scale),
      y: Math.max(0, (minY - paddingTop) / scale),
      width: Math.min(width, boxWidth + paddingX * 2) / scale,
      height: Math.min(height, boxHeight + paddingTop + paddingBottom) / scale,
      confidence: clamp(0.34 + skinRatio * 18, 0.34, 0.72)
    };
  }

  function dedupeFaces(faces) {
    const accepted = [];
    for (const face of faces) {
      const overlaps = accepted.some((item) => intersectionRatio(item, face) > 0.42);
      if (!overlaps) {
        accepted.push(face);
      }
    }
    return accepted;
  }

  function intersectionRatio(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const minArea = Math.min(a.width * a.height, b.width * b.height);
    return intersection / Math.max(1, minArea);
  }

  function ensureOverlay() {
    if (state.overlay) {
      return state.overlay;
    }

    const dropZone = document.querySelector("#dropZone");
    if (!dropZone) {
      return null;
    }

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "face-retouch-overlay";
    overlay.hidden = true;
    dropZone.append(overlay);
    state.overlay = overlay;
    return overlay;
  }

  function renderFaceOverlay(photo) {
    const overlay = ensureOverlay();
    const analysis = getFaceAnalysis(photo);
    if (!overlay || !analysis || !state.selectionMode) {
      hideFaceOverlay();
      return;
    }

    const frame = getDisplayedImageFrame(analysis.sourceWidth, analysis.sourceHeight);
    if (!frame) {
      hideFaceOverlay();
      return;
    }

    const selected = new Set(getSelectedFaceIds(photo));
    overlay.replaceChildren();
    overlay.hidden = false;

    analysis.faces.forEach((face, index) => {
      const box = mapFaceToFrame(face, analysis, frame);
      const faceButton = document.createElement("button");
      faceButton.type = "button";
      faceButton.className = `face-retouch-face-box${selected.has(face.id) ? " selected" : ""}`;
      faceButton.style.left = `${box.x}px`;
      faceButton.style.top = `${box.y}px`;
      faceButton.style.width = `${box.width}px`;
      faceButton.style.height = `${box.height}px`;
      faceButton.textContent = String(index + 1);
      faceButton.setAttribute("aria-label", `얼굴 ${index + 1} 선택`);
      faceButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFaceSelection(photo, face.id);
      });
      overlay.append(faceButton);
    });
  }

  function hideFaceOverlay() {
    if (!state.overlay) {
      return;
    }
    state.overlay.hidden = true;
    state.overlay.replaceChildren();
  }

  function toggleFaceSelection(photo, faceId) {
    const selected = new Set(getSelectedFaceIds(photo));
    if (selected.has(faceId)) {
      selected.delete(faceId);
    } else {
      selected.add(faceId);
    }

    setSelectedFaceIds(photo, [...selected]);
    state.active = selected.size > 0;
    syncPanelControls();
    renderFaceOverlay(photo);
    syncAllButtons();
    refreshPreview();
  }

  function getSelectedFaceIds(photo) {
    return Array.isArray(photo?.__faceRetouchSelectedFaceIds) ? photo.__faceRetouchSelectedFaceIds : [];
  }

  function setSelectedFaceIds(photo, ids) {
    if (!photo) {
      return;
    }
    photo.__faceRetouchSelectedFaceIds = [...new Set(ids)];
  }

  function getSelectedFacesForCanvas(photo, targetWidth, targetHeight) {
    const analysis = getFaceAnalysis(photo);
    if (!analysis || !analysis.faces.length) {
      return [];
    }

    const selected = new Set(getSelectedFaceIds(photo));
    if (!selected.size) {
      return [];
    }

    return analysis.faces
      .filter((face) => selected.has(face.id))
      .map((face) => ({
        x: face.x * targetWidth / analysis.sourceWidth,
        y: face.y * targetHeight / analysis.sourceHeight,
        width: face.width * targetWidth / analysis.sourceWidth,
        height: face.height * targetHeight / analysis.sourceHeight
      }));
  }

  function getDisplayedImageFrame(imageWidth, imageHeight) {
    const dropZone = document.querySelector("#dropZone");
    if (!dropZone || imageWidth <= 0 || imageHeight <= 0) {
      return null;
    }

    const rect = dropZone.getBoundingClientRect();
    const maxWidth = Math.max(1, rect.width - 34);
    const maxHeight = Math.max(1, rect.height - 34);
    const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight, 1);
    const width = Math.max(1, Math.round(imageWidth * scale));
    const height = Math.max(1, Math.round(imageHeight * scale));
    return {
      x: Math.round((rect.width - width) / 2),
      y: Math.round((rect.height - height) / 2),
      width,
      height
    };
  }

  function mapFaceToFrame(face, analysis, frame) {
    const scaleX = frame.width / analysis.sourceWidth;
    const scaleY = frame.height / analysis.sourceHeight;
    const padX = face.width * scaleX * 0.12;
    const padY = face.height * scaleY * 0.14;
    return {
      x: frame.x + face.x * scaleX - padX,
      y: frame.y + face.y * scaleY - padY,
      width: face.width * scaleX + padX * 2,
      height: face.height * scaleY + padY * 2
    };
  }

  function applyToCanvas(sourceCanvas, options = state.options, selectedFaces = []) {
    const normalized = normalizeOptions(options);
    if (!sourceCanvas || !normalized.enabled || !selectedFaces.length || !hasActiveAdjustment(normalized)) {
      return sourceCanvas;
    }

    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;

    const context = output.getContext("2d", { willReadFrequently: true });
    context.drawImage(sourceCanvas, 0, 0);

    const blurCanvas = document.createElement("canvas");
    blurCanvas.width = width;
    blurCanvas.height = height;
    const blurContext = blurCanvas.getContext("2d", { willReadFrequently: true });
    blurContext.filter = `blur(${buildBlurRadius(width, height, normalized)}px)`;
    blurContext.drawImage(sourceCanvas, 0, 0);
    blurContext.filter = "none";

    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    const blurData = blurContext.getImageData(0, 0, width, height).data;

    const smoothPower = normalized.skinSmoothing / 100;
    const wrinklePower = normalized.wrinkleRemoval / 100;
    const blemishPower = normalized.blemishSoftening / 100;
    const darkCirclePower = normalized.darkCircleRemoval / 100;
    const tonePower = normalized.toneEvenness / 100;
    const brightnessOffset = normalized.faceBrightness * 0.68;

    for (let index = 0; index < data.length; index += 4) {
      const pixel = index / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const faceRegion = selectedFaceMask(x, y, selectedFaces);
      if (faceRegion <= 0.01) {
        continue;
      }

      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const br = blurData[index];
      const bg = blurData[index + 1];
      const bb = blurData[index + 2];

      const mask = skinMask(r, g, b) * faceRegion;
      const darkCircleRegion = darkCirclePower > 0 ? darkCircleMask(x, y, selectedFaces) * faceRegion : 0;
      const underEyeMask = darkCircleRegion * underEyeSkinMask(r, g, b);
      if (mask <= 0.02 && underEyeMask <= 0.02) {
        continue;
      }

      const luma = getLuma(r, g, b);
      const blurLuma = getLuma(br, bg, bb);
      const detail = Math.abs(r - br) * 0.28 + Math.abs(g - bg) * 0.42 + Math.abs(b - bb) * 0.3;
      const edgeProtect = 1 - smoothstep(18, 52, detail);
      const baseMask = mask * edgeProtect;
      const underEyeBaseMask = Math.max(baseMask, underEyeMask * edgeProtect);

      const smoothMix = clamp(baseMask * (smoothPower * 0.58 + tonePower * 0.16), 0, 0.68);
      const wrinkleMix = clamp(baseMask * wrinklePower * smoothstep(3, 28, blurLuma - luma) * 0.86, 0, 0.78);
      const blemishMix = clamp(baseMask * blemishPower * blemishMask(r, g, b, br, bg, bb) * 0.68, 0, 0.62);
      const darkCircleShadow = smoothstep(-4, 34, blurLuma - luma);
      const darkCircleMix = clamp(underEyeBaseMask * darkCirclePower * (0.34 + darkCircleShadow * 0.92), 0, 0.66);
      const toneMix = clamp(mask * tonePower * 0.24, 0, 0.28);

      let nr = mix(r, br, smoothMix);
      let ng = mix(g, bg, smoothMix);
      let nb = mix(b, bb, smoothMix);

      nr = mix(nr, br, wrinkleMix + blemishMix);
      ng = mix(ng, bg, wrinkleMix + blemishMix);
      nb = mix(nb, bb, wrinkleMix + blemishMix);

      nr = mix(nr, br, darkCircleMix * 0.58);
      ng = mix(ng, bg, darkCircleMix * 0.54);
      nb = mix(nb, bb, darkCircleMix * 0.48);

      const targetWarmth = Math.max(0, (br + bg) * 0.5 - bb * 0.18);
      nr = mix(nr, targetWarmth, toneMix * 0.22);
      ng = mix(ng, targetWarmth * 0.9, toneMix * 0.12);
      nb = mix(nb, targetWarmth * 0.82, toneMix * 0.1);

      const darkLift = darkCircleMix * (8 + darkCirclePower * 16) * (1 - smoothstep(142, 218, luma));
      nr += darkLift * 0.94;
      ng += darkLift;
      nb += darkLift * 1.04;

      nr += brightnessOffset * mask;
      ng += brightnessOffset * mask;
      nb += brightnessOffset * mask * 0.94;

      const textureRestore = 0.18 + smoothstep(0, 100, 100 - normalized.skinSmoothing) * 0.22;
      const restoreMask = Math.max(mask, darkCircleMix * 0.72);
      data[index] = clampByte(mix(nr, r, textureRestore * restoreMask));
      data[index + 1] = clampByte(mix(ng, g, textureRestore * restoreMask));
      data[index + 2] = clampByte(mix(nb, b, textureRestore * restoreMask));
    }

    context.putImageData(imageData, 0, 0);
    return output;
  }

  function selectedFaceMask(x, y, selectedFaces) {
    let strongest = 0;
    for (const face of selectedFaces) {
      const padX = face.width * 0.18;
      const padTop = face.height * 0.18;
      const padBottom = face.height * 0.28;
      const centerX = face.x + face.width * 0.5;
      const centerY = face.y + face.height * 0.52;
      const radiusX = face.width * 0.5 + padX;
      const radiusY = face.height * 0.5 + (padTop + padBottom) * 0.5;
      const dx = (x - centerX) / Math.max(1, radiusX);
      const dy = (y - centerY) / Math.max(1, radiusY);
      const distance = dx * dx + dy * dy;
      strongest = Math.max(strongest, 1 - smoothstep(0.72, 1.08, distance));
    }
    return strongest;
  }

  function darkCircleMask(x, y, selectedFaces) {
    let strongest = 0;
    for (const face of selectedFaces) {
      if (face.width <= 0 || face.height <= 0) {
        continue;
      }

      const nx = (x - face.x) / face.width;
      const ny = (y - face.y) / face.height;
      if (nx < 0.08 || nx > 0.92 || ny < 0.32 || ny > 0.64) {
        continue;
      }

      const verticalGate = smoothstep(0.36, 0.43, ny) * (1 - smoothstep(0.56, 0.64, ny));
      const leftEye = eyeBagMask(nx, ny, 0.35, 0.46);
      const rightEye = eyeBagMask(nx, ny, 0.65, 0.46);
      strongest = Math.max(strongest, Math.max(leftEye, rightEye) * verticalGate);
    }
    return strongest;
  }

  function eyeBagMask(nx, ny, centerX, centerY) {
    const dx = (nx - centerX) / 0.2;
    const dy = (ny - centerY) / 0.11;
    return 1 - smoothstep(0.62, 1.12, dx * dx + dy * dy);
  }

  function buildBlurRadius(width, height, options) {
    const base = Math.max(width, height) / 900;
    const strength = 1 + (options.skinSmoothing + options.wrinkleRemoval + options.blemishSoftening + options.darkCircleRemoval * 0.7) / 200;
    return clamp(base * strength, 1.2, 5.4).toFixed(2);
  }

  function hasActiveAdjustment(options) {
    return options.skinSmoothing > 0 ||
      options.wrinkleRemoval > 0 ||
      options.blemishSoftening > 0 ||
      options.darkCircleRemoval > 0 ||
      options.toneEvenness > 0 ||
      options.faceBrightness !== 0;
  }

  function skinMask(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = getLuma(r, g, b);
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    const rgbRule = r > 35 && g > 24 && b > 16 && r >= g * 0.78 && r > b * 0.96 && max - min > 7;
    const chromaRule = cr > 130 && cr < 184 && cb > 70 && cb < 142;
    const lightRule = y > 34 && y < 242 && luma > 34 && luma < 246;
    if (!rgbRule || !chromaRule || !lightRule) {
      return 0;
    }

    const redBalance = smoothstep(-18, 42, r - g);
    const blueDistance = smoothstep(-2, 62, r - b);
    const chromaCenter = 1 - clamp((Math.abs(cr - 154) + Math.abs(cb - 104)) / 104, 0, 1);
    const lumaWeight = smoothstep(34, 76, luma) * (1 - smoothstep(232, 250, luma));
    return clamp(redBalance * blueDistance * (0.4 + chromaCenter * 0.6) * lumaWeight, 0, 1);
  }

  function underEyeSkinMask(r, g, b) {
    const luma = getLuma(r, g, b);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const fleshLike = r > 28 && g > 22 && b > 18 && r >= g * 0.62 && r >= b * 0.68 && max - min > 4;
    if (!fleshLike || luma < 28 || luma > 224) {
      return 0;
    }

    const shadowWeight = smoothstep(30, 82, luma) * (1 - smoothstep(180, 232, luma));
    return clamp(Math.max(skinMask(r, g, b), 0.46) * shadowWeight, 0, 1);
  }

  function blemishMask(r, g, b, br, bg, bb) {
    const luma = getLuma(r, g, b);
    const blurLuma = getLuma(br, bg, bb);
    const redSpot = smoothstep(10, 42, r - Math.max(g, b));
    const darkSpot = smoothstep(5, 34, blurLuma - luma);
    return clamp(Math.max(redSpot * 0.7, darkSpot), 0, 1);
  }

  function getCurrentPhoto() {
    try {
      return typeof window.selectedPhoto === "function" ? window.selectedPhoto() : null;
    } catch (error) {
      return null;
    }
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .face-retouch-button {
        color: #707989;
        border-style: dashed;
        font-size: 1rem;
      }

      .face-retouch-button:disabled {
        color: #707989;
        border-color: #343b49;
        background: linear-gradient(#202633, #151a23);
        opacity: 0.62;
      }

      .face-retouch-button.is-face-retouch-ready {
        color: #eef1f6;
        border-style: solid;
        border-color: #4b5567;
      }

      .face-retouch-button.is-face-retouch-enabled {
        border-color: rgba(143, 216, 210, 0.72) !important;
        border-style: solid;
        color: #071011;
        background: linear-gradient(#bcefeb, #7ccbc5);
        opacity: 1;
      }

      .face-retouch-button.is-face-retouch-detecting {
        color: #bcefeb;
        border-style: solid;
      }

      .face-retouch-panel {
        position: fixed;
        z-index: 80;
        display: grid;
        gap: 12px;
        padding: 12px;
        border: 1px solid #343b49;
        border-radius: 10px;
        color: #eef1f6;
        background: #171c25;
        box-shadow: 0 24px 54px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.05);
        max-height: min(520px, calc(100vh - 24px));
        overflow-y: auto;
      }

      .face-retouch-panel[hidden],
      .face-retouch-sliders[hidden],
      .face-retouch-overlay[hidden] {
        display: none;
      }

      .face-retouch-header,
      .face-retouch-footer,
      .face-retouch-slider-row,
      .face-retouch-toggle {
        display: flex;
        align-items: center;
      }

      .face-retouch-header,
      .face-retouch-footer,
      .face-retouch-slider-row {
        justify-content: space-between;
        gap: 10px;
      }

      .face-retouch-title {
        font-size: 0.92rem;
      }

      .face-retouch-meta {
        margin: 0;
        padding: 9px;
        border: 1px solid #343b49;
        border-radius: 8px;
        color: #9aa3b2;
        background: #12161e;
        font-size: 0.78rem;
        line-height: 1.45;
      }

      .face-retouch-toggle {
        gap: 6px;
        color: #9aa3b2;
        font-size: 0.78rem;
      }

      .face-retouch-sliders {
        display: grid;
        gap: 10px;
      }

      .face-retouch-slider {
        display: grid;
        gap: 6px;
        color: #9aa3b2;
        font-size: 0.78rem;
      }

      .face-retouch-slider output {
        color: #eef1f6;
      }

      .face-retouch-slider input[type="range"] {
        width: 100%;
        accent-color: #8fd8d2;
      }

      .face-retouch-footer button {
        min-height: 30px;
        padding: 0 10px;
        border: 1px solid #343b49;
        border-radius: 8px;
        color: #eef1f6;
        background: linear-gradient(#252b36, #171c25);
        cursor: pointer;
      }

      .face-retouch-footer button:hover {
        border-color: #8fd8d2;
      }

      .face-retouch-overlay {
        position: absolute;
        inset: 0;
        z-index: 8;
        pointer-events: none;
      }

      .face-retouch-face-box {
        position: absolute;
        display: grid;
        place-items: center;
        min-width: 26px;
        min-height: 26px;
        padding: 0;
        border: 2px solid rgba(188, 239, 235, 0.88);
        border-radius: 8px;
        color: #071011;
        background: rgba(188, 239, 235, 0.18);
        box-shadow: 0 0 0 1px rgba(7, 9, 13, 0.72), 0 12px 24px rgba(0, 0, 0, 0.28);
        cursor: pointer;
        font-size: 0.78rem;
        pointer-events: auto;
      }

      .face-retouch-face-box.selected {
        border-color: #ffffff;
        background: rgba(188, 239, 235, 0.68);
      }
    `;
    document.head.append(style);
  }

  function getLuma(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function mix(a, b, amount) {
    return a + (b - a) * amount;
  }

  function smoothstep(edge0, edge1, value) {
    const x = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampInt(value, min, max, fallback) {
    const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
    return clamp(number, min, max);
  }

  function clampByte(value) {
    return clamp(Math.round(value), 0, 255);
  }
})();
