const dom = {
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  previewCanvas: document.querySelector("#previewCanvas"),
  emptyState: document.querySelector("#emptyState"),
  compareLabels: document.querySelector("#compareLabels"),
  statusText: document.querySelector("#statusText"),
  aiStatus: document.querySelector("#aiStatus"),
  styleSelect: document.querySelector("#styleSelect"),
  saveButton: document.querySelector("#saveButton"),
  saveAllButton: document.querySelector("#saveAllButton"),
  rotateLeftButton: document.querySelector("#rotateLeftButton"),
  rotateRightButton: document.querySelector("#rotateRightButton"),
  smartSummary: document.querySelector("#smartSummary"),
  fileList: document.querySelector("#fileList"),
  imageCount: document.querySelector("#imageCount")
};

const DEFAULT_SETTINGS = Object.freeze({
  presetKey: "natural",
  strength: 72,
  exposure: 0,
  contrast: 0,
  warmth: 0,
  saturation: 0,
  clarity: 16,
  vignette: 0,
  grain: 0,
  autoWhiteBalance: true,
  autoTone: true
});

const STYLE_BIAS = {
  natural: { exposure: 0, contrast: 0, warmth: 0, saturation: 0, clarity: 0, vignette: 0 },
  bright: { exposure: 14, contrast: 2, warmth: -2, saturation: 2, clarity: 6, vignette: -10 },
  vivid: { exposure: 4, contrast: 14, warmth: 2, saturation: 22, clarity: 12, vignette: 2 },
  soft: { exposure: 8, contrast: -8, warmth: 4, saturation: 2, clarity: -10, vignette: 3 },
  warm: { exposure: 5, contrast: 6, warmth: 15, saturation: 7, clarity: 3, vignette: 1 },
  cool: { exposure: 2, contrast: 9, warmth: -15, saturation: 3, clarity: 8, vignette: 4 },
  instagram: { exposure: 7, contrast: 5, warmth: 7, saturation: 10, clarity: 4, vignette: 4 },
  cafe: { exposure: 5, contrast: 8, warmth: 12, saturation: 8, clarity: 2, vignette: 8, grain: 4 },
  travel: { exposure: 8, contrast: 10, warmth: 3, saturation: 18, clarity: 10, vignette: -4 },
  cinematic: { exposure: -4, contrast: 14, warmth: -7, saturation: -6, clarity: 8, vignette: 14 },
  film: { exposure: -1, contrast: 9, warmth: 7, saturation: -4, clarity: 0, vignette: 10, grain: 8 },
  moody: { exposure: -8, contrast: 18, warmth: -3, saturation: -8, clarity: 8, vignette: 18, grain: 3 },
  portrait: { exposure: 8, contrast: -4, warmth: 5, saturation: 4, clarity: -6, vignette: 6 },
  product: { exposure: 10, contrast: 6, warmth: -4, saturation: -6, clarity: 12, vignette: -10 },
  food: { exposure: 5, contrast: 8, warmth: 12, saturation: 14, clarity: 6, vignette: 0 },
  space: { exposure: 12, contrast: 0, warmth: -3, saturation: -8, clarity: 6, vignette: -12 },
  night: { exposure: 6, contrast: 18, warmth: -8, saturation: 5, clarity: 14, vignette: 14, grain: 6 },
  mono: { exposure: 2, contrast: 18, warmth: -3, saturation: -82, clarity: 12, vignette: 8, grain: 4 }
};

let photos = [];
let selectedIndex = -1;
let settings = cloneSettings(DEFAULT_SETTINGS);
let renderToken = 0;
let originalPreview = null;
let processedPreview = null;
let smartInFlight = false;
let aiApiUnavailable = false;
let pendingSmartAfterFlight = false;
let compareSplit = 0.5;
let compareFrame = null;
let compareDragging = false;

function cloneSettings(source) {
  return { ...DEFAULT_SETTINGS, ...source, autoWhiteBalance: true, autoTone: true };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value, min, max, fallback = 0) {
  const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  return clamp(number, min, max);
}

function init() {
  bindEvents();
  setButtonsEnabled(false);
  setAiStatus("idle", "AI 대기");
  updateControlsFromSettings();
  drawComparison();
}

function bindEvents() {
  dom.fileInput.addEventListener("change", (event) => {
    handleFiles(event.target.files);
    event.target.value = "";
  });

  dom.dropZone.addEventListener("click", () => {
    if (!selectedPhoto()) {
      dom.fileInput.click();
    }
  });
  dom.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dom.dropZone.classList.add("dragging");
  });
  dom.dropZone.addEventListener("dragleave", () => dom.dropZone.classList.remove("dragging"));
  dom.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dom.dropZone.classList.remove("dragging");
    handleFiles(event.dataTransfer.files);
  });

  dom.dropZone.addEventListener("pointerdown", startCompareDrag);
  dom.dropZone.addEventListener("pointermove", moveCompareDrag);
  dom.dropZone.addEventListener("pointerup", stopCompareDrag);
  dom.dropZone.addEventListener("pointercancel", stopCompareDrag);
  dom.saveButton.addEventListener("click", saveCurrentImage);
  dom.saveAllButton.addEventListener("click", saveAllImages);
  dom.rotateLeftButton.addEventListener("click", () => rotateSelectedPhoto(-90));
  dom.rotateRightButton.addEventListener("click", () => rotateSelectedPhoto(90));
  dom.styleSelect.addEventListener("change", () => {
    const photo = selectedPhoto();
    if (!photo) {
      setSummary("이미지를 올리면 선택한 스타일로 자동 분석합니다.");
      return;
    }
    setSummary("스타일이 변경되어 AI 분석을 다시 시작합니다.");
    void applySmartAdjustment();
  });

  window.addEventListener("resize", drawComparison);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => drawComparison());
    observer.observe(dom.dropZone);
  }
}

async function handleFiles(fileList) {
  const imageFiles = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) {
    setStatus("이미지 파일만 열 수 있습니다.");
    return;
  }

  setStatus("이미지 불러오는 중...");
  const decoded = [];
  for (const file of imageFiles) {
    try {
      const image = await decodeImage(file);
      decoded.push({
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        file,
        name: file.name,
        path: file.webkitRelativePath || file.name,
        image: image.source,
        width: image.width,
        height: image.height,
        rotation: 0,
        settings: null,
        smartBase: null,
        smartSummary: ""
      });
    } catch (error) {
      console.warn("Image decode failed", error);
    }
  }

  if (!decoded.length) {
    setStatus("이미지를 읽지 못했습니다.");
    return;
  }

  photos = photos.concat(decoded);
  renderFileList();
  setButtonsEnabled(true);

  if (selectedIndex < 0) {
    await selectPhoto(0);
  } else {
    setStatus(`${decoded.length}장 추가됨`);
  }
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch (error) {
      console.warn("createImageBitmap fallback", error);
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    image.src = url;
  });
}

async function selectPhoto(index) {
  if (index < 0 || index >= photos.length) {
    return;
  }

  selectedIndex = index;
  const photo = selectedPhoto();
  compareSplit = 0.5;
  settings = cloneSettings(photo.settings || DEFAULT_SETTINGS);
  updateControlsFromSettings();
  setButtonsEnabled(true);
  renderFileList();

  if (!photo.smartBase) {
    await applySmartAdjustment();
  } else {
    setSummary(photo.smartSummary || "스마트 보정 대기");
    renderSelected();
  }
}

function selectedPhoto() {
  return photos[selectedIndex] || null;
}

function persistSelectedSettings() {
  const photo = selectedPhoto();
  if (!photo) {
    return;
  }
  photo.settings = cloneSettings(settings);
}

function renderFileList() {
  dom.imageCount.textContent = String(photos.length);
  dom.fileList.replaceChildren();

  if (!photos.length) {
    const empty = document.createElement("div");
    empty.className = "file-empty";
    empty.textContent = "이미지를 추가하면 여기에 표시됩니다.";
    dom.fileList.append(empty);
    return;
  }

  photos.forEach((photo, index) => {
    const item = document.createElement("div");
    item.className = `file-item${index === selectedIndex ? " selected" : ""}`;

    const selectButton = document.createElement("button");
    selectButton.className = "thumbnail-button";
    selectButton.type = "button";
    selectButton.setAttribute("aria-label", "이미지 선택");
    selectButton.addEventListener("click", () => selectPhoto(index));

    const thumbnail = document.createElement("img");
    thumbnail.alt = "";
    thumbnail.src = createThumbnailDataUrl(photo);
    selectButton.append(thumbnail);

    const removeButton = document.createElement("button");
    removeButton.className = "remove-thumb";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", "이미지 제거");
    removeButton.textContent = "X";
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void removePhoto(index);
    });

    item.append(selectButton, removeButton);
    dom.fileList.append(item);
  });
}

function setButtonsEnabled(enabled) {
  const hasPhoto = Boolean(selectedPhoto()) && enabled;
  const hasAny = photos.length > 0 && enabled;
  dom.saveButton.disabled = !hasPhoto;
  dom.saveAllButton.disabled = !hasAny;
  dom.rotateLeftButton.disabled = !hasPhoto;
  dom.rotateRightButton.disabled = !hasPhoto;
}

function createThumbnailDataUrl(photo) {
  const canvas = createSourceCanvas(photo, 280);
  return canvas.toDataURL("image/jpeg", 0.74);
}

async function removePhoto(index) {
  if (index < 0 || index >= photos.length) {
    return;
  }

  const removedSelected = index === selectedIndex;
  photos.splice(index, 1);

  if (!photos.length) {
    selectedIndex = -1;
    settings = cloneSettings(DEFAULT_SETTINGS);
    originalPreview = null;
    processedPreview = null;
    compareFrame = null;
    setButtonsEnabled(false);
    setAiStatus("idle", "AI 대기");
    setStatus("준비됨");
    setSummary("스마트 보정 대기");
    renderFileList();
    drawComparison();
    return;
  }

  if (index < selectedIndex) {
    selectedIndex -= 1;
  }

  if (removedSelected) {
    await selectPhoto(Math.min(index, photos.length - 1));
  } else {
    setButtonsEnabled(true);
    renderFileList();
  }
}

function rotateSelectedPhoto(delta) {
  const photo = selectedPhoto();
  if (!photo) {
    return;
  }

  photo.rotation = normalizeRotation((photo.rotation || 0) + delta);
  photo.settings = cloneSettings(settings);
  renderFileList();
  renderSelected();
  setStatus("회전 적용됨");
}

function normalizeRotation(value) {
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
}

async function applySmartAdjustment() {
  const photo = selectedPhoto();
  if (!photo || smartInFlight) {
    if (smartInFlight) {
      pendingSmartAfterFlight = true;
    }
    if (!photo) {
      setStatus("이미지를 먼저 올려주세요.");
      setSummary("작업 캔버스를 클릭해서 이미지를 추가할 수 있습니다.");
    }
    return;
  }

  smartInFlight = true;
  setAiStatus("busy", "AI 분석중");
  setButtonsEnabled(true);
  setStatus("AI 스마트 분석 중...");
  setSummary("사진의 밝기, 색온도, 대비, 장면 분위기를 분석하고 있습니다.");

  try {
    const aiResult = await requestAiAdjustment(photo);
    settings = normalizeSettings(aiResult);
    photo.smartBase = cloneSettings(settings);
    photo.settings = cloneSettings(settings);
    photo.smartSummary = `${aiResult.sceneName || "AI 자동"} · ${aiResult.reason || "사진에 맞는 보정값을 적용했습니다."} · ${formatSettingsDigest(settings)}`;
    setSummary(photo.smartSummary);
    setAiStatus("ready", "AI 연결됨");
    setStatus("AI 보정 적용됨");
  } catch (error) {
    const localResult = await buildLocalSmartAdjustment(photo);
    settings = normalizeSettings(localResult);
    photo.smartBase = cloneSettings(settings);
    photo.settings = cloneSettings(settings);
    photo.smartSummary = `${localResult.sceneName} · ${localResult.reason} · ${formatSettingsDigest(settings)}`;
    setSummary(aiApiUnavailable ? `${photo.smartSummary} · AI API 연결 실패로 로컬 보정으로 전환됨` : `${photo.smartSummary} (로컬 분석)`);
    setAiStatus("offline", "AI 연결안됨");
    setStatus("로컬 스마트 보정 적용됨");
  } finally {
    smartInFlight = false;
    setButtonsEnabled(true);
    updateControlsFromSettings();
    renderFileList();
    renderSelected();
    if (pendingSmartAfterFlight) {
      pendingSmartAfterFlight = false;
      void applySmartAdjustment();
    }
  }
}

async function requestAiAdjustment(photo) {
  if (aiApiUnavailable) {
    throw new Error("AI API is disabled for this session");
  }

  const supabase = getSupabaseConfig();
  const canvas = createSourceCanvas(photo, 960);
  const imageDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  try {
    const response = await fetch(`${supabase.url}/functions/v1/smart-adjust`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({ imageDataUrl, style: dom.styleSelect.value })
    });

    if (!response.ok) {
      aiApiUnavailable = true;
      throw new Error(`AI request failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    aiApiUnavailable = true;
    throw error;
  }
}

function getSupabaseConfig() {
  const config = window.PROTONE_SUPABASE || {};
  const url = String(config.url || "").replace(/\/$/, "");
  const anonKey = String(config.anonKey || "");
  if (!url || !anonKey || url.includes("YOUR_SUPABASE") || anonKey.includes("YOUR_SUPABASE")) {
    aiApiUnavailable = true;
    throw new Error("Supabase smart-adjust endpoint is not configured");
  }
  return { url, anonKey };
}

async function buildLocalSmartAdjustment(photo) {
  const canvas = createSourceCanvas(photo, 900);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const stats = analyzeImageData(context.getImageData(0, 0, canvas.width, canvas.height), 10);
  const bias = STYLE_BIAS[dom.styleSelect.value] || STYLE_BIAS.natural;

  const under = stats.avgL < 108;
  const over = stats.avgL > 178;
  const lowContrast = stats.contrastSpan < 92;
  const warmCast = stats.avgR - stats.avgB > 16;
  const coolCast = stats.avgB - stats.avgR > 16;
  const greenCast = stats.avgG - ((stats.avgR + stats.avgB) / 2) > 10;

  let presetKey = "natural";
  let sceneName = "균형 보정";
  if (stats.saturation > 56 && stats.avgR > stats.avgB + 8) {
    presetKey = "food";
    sceneName = "따뜻한 컬러 사진";
  } else if (stats.avgL < 92) {
    presetKey = "night";
    sceneName = "어두운 장면";
  } else if (stats.contrastSpan > 150 && stats.saturation < 36) {
    presetKey = "cinematic";
    sceneName = "대비가 강한 장면";
  } else if (stats.avgL > 160 && stats.saturation < 34) {
    presetKey = "product";
    sceneName = "밝은 제품/공간 사진";
  }

  const result = {
    source: "LOCAL",
    presetKey,
    sceneName,
    reason: "브라우저에서 밝기와 색 균형을 판단해 자연스러운 기본값을 골랐습니다.",
    strength: 74,
    exposure: under ? 18 : over ? -12 : Math.round((142 - stats.avgL) * 0.22),
    contrast: lowContrast ? 18 : stats.contrastSpan > 152 ? -4 : 8,
    warmth: warmCast ? -9 : coolCast ? 8 : greenCast ? -4 : 0,
    saturation: stats.saturation < 28 ? 12 : stats.saturation > 68 ? -8 : 4,
    clarity: lowContrast ? 18 : 14,
    vignette: presetKey === "cinematic" || presetKey === "night" ? 12 : 3,
    grain: presetKey === "cinematic" ? 4 : 0
  };

  for (const key of ["exposure", "contrast", "warmth", "saturation", "clarity", "vignette", "grain"]) {
    result[key] += bias[key] || 0;
  }

  return result;
}

function normalizeSettings(raw) {
  const normalized = {
    presetKey: String(raw.presetKey || "natural"),
    strength: clampInt(raw.strength, 0, 100, DEFAULT_SETTINGS.strength),
    exposure: clampInt(raw.exposure, -100, 100),
    contrast: clampInt(raw.contrast, -100, 100),
    warmth: clampInt(raw.warmth, -100, 100),
    saturation: clampInt(raw.saturation, -100, 100),
    clarity: clampInt(raw.clarity, 0, 100, DEFAULT_SETTINGS.clarity),
    vignette: clampInt(raw.vignette, 0, 100),
    grain: clampInt(raw.grain, 0, 50),
    autoWhiteBalance: true,
    autoTone: true
  };

  return enforceVisibleSmartGrade(normalized, dom.styleSelect.value);
}

function enforceVisibleSmartGrade(nextSettings, styleKey = "natural") {
  const floors = {
    natural: { strength: 82, contrast: 12, saturation: 9, clarity: 20 },
    portrait: { strength: 78, exposure: 5, contrast: -4, warmth: 5, saturation: 6, clarity: 14, vignette: 6 },
    cinematic: { strength: 84, exposure: -4, contrast: 20, warmth: -6, saturation: -5, clarity: 22, vignette: 16, grain: 4 },
    food: { strength: 86, exposure: 5, contrast: 16, warmth: 10, saturation: 18, clarity: 22, vignette: 4 },
    product: { strength: 82, exposure: 8, contrast: 14, warmth: -3, saturation: -4, clarity: 26 },
    night: { strength: 86, exposure: 8, contrast: 22, warmth: -7, saturation: 7, clarity: 26, vignette: 18, grain: 6 }
  };
  const styleFloors = {
    bright: { strength: 82, exposure: 10, contrast: 8, saturation: 5, clarity: 18 },
    vivid: { strength: 86, contrast: 18, saturation: 24, clarity: 22 },
    soft: { strength: 76, exposure: 6, contrast: -4, warmth: 4, saturation: 4, clarity: 8 },
    warm: { strength: 82, warmth: 12, saturation: 8, clarity: 16 },
    cool: { strength: 82, warmth: -12, contrast: 14, clarity: 20 },
    cafe: { strength: 82, warmth: 12, saturation: 10, vignette: 8, grain: 4 },
    travel: { strength: 86, exposure: 6, contrast: 16, saturation: 22, clarity: 24 },
    film: { strength: 80, warmth: 6, saturation: -4, vignette: 10, grain: 8 },
    moody: { strength: 84, exposure: -6, contrast: 22, saturation: -6, vignette: 18 },
    mono: { strength: 84, contrast: 20, saturation: -82, clarity: 22, vignette: 10, grain: 5 }
  };
  const floor = { ...(floors[nextSettings.presetKey] || floors.natural), ...(styleFloors[styleKey] || {}) };
  const boosted = cloneSettings(nextSettings);

  boosted.strength = Math.max(boosted.strength, floor.strength || boosted.strength);
  for (const key of ["exposure", "contrast", "warmth", "saturation", "clarity", "vignette", "grain"]) {
    if (typeof floor[key] !== "number") {
      continue;
    }

    if (Math.abs(boosted[key]) < Math.abs(floor[key])) {
      boosted[key] = floor[key];
    }
  }

  return boosted;
}

function formatSettingsDigest(nextSettings) {
  return `강도 ${nextSettings.strength} / 대비 ${nextSettings.contrast} / 색감 ${nextSettings.saturation} / 선명도 ${nextSettings.clarity}`;
}

function updateControlsFromSettings() {
  settings = cloneSettings(settings);
}

function renderSelected() {
  const token = ++renderToken;
  const photo = selectedPhoto();
  if (!photo) {
    originalPreview = null;
    processedPreview = null;
    drawComparison();
    return;
  }

  persistSelectedSettings();
  setStatus("보정 중...");

  requestAnimationFrame(() => {
    if (token !== renderToken) {
      return;
    }
    originalPreview = createSourceCanvas(photo, 1800);
    processedPreview = processCanvas(originalPreview, settings);
    drawComparison();
    setStatus("보정 완료");
  });
}

function createSourceCanvas(photo, maxEdge) {
  const rotation = normalizeRotation(photo.rotation || 0);
  const rotated = rotation === 90 || rotation === 270;
  const outputSourceWidth = rotated ? photo.height : photo.width;
  const outputSourceHeight = rotated ? photo.width : photo.height;
  const scale = Math.min(1, maxEdge / Math.max(outputSourceWidth, outputSourceHeight));
  const width = Math.max(1, Math.round(outputSourceWidth * scale));
  const height = Math.max(1, Math.round(outputSourceHeight * scale));
  const drawWidth = Math.max(1, Math.round(photo.width * scale));
  const drawHeight = Math.max(1, Math.round(photo.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.save();
  if (rotation === 90) {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(width, height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(photo.image, 0, 0, drawWidth, drawHeight);
  context.restore();
  return canvas;
}

function processCanvas(sourceCanvas, currentSettings) {
  const output = document.createElement("canvas");
  output.width = sourceCanvas.width;
  output.height = sourceCanvas.height;
  const context = output.getContext("2d", { willReadFrequently: true });
  context.drawImage(sourceCanvas, 0, 0);

  const imageData = context.getImageData(0, 0, output.width, output.height);
  const data = imageData.data;
  const stats = analyzeImageData(imageData, 12);
  const strength = currentSettings.strength / 100;

  const autoExposure = currentSettings.autoTone ? clamp((140 - stats.avgL) * 0.2, -20, 22) : 0;
  const autoContrast = currentSettings.autoTone ? clamp((122 - stats.contrastSpan) * 0.16, -10, 18) : 0;
  const autoWarmth = currentSettings.autoWhiteBalance ? clamp((stats.avgB - stats.avgR) * 0.1, -14, 14) : 0;
  const autoGreen = currentSettings.autoWhiteBalance ? clamp((((stats.avgR + stats.avgB) / 2) - stats.avgG) * 0.055, -7, 7) : 0;

  const exposureOffset = (currentSettings.exposure + autoExposure) * 1.26;
  const contrastValue = currentSettings.contrast + autoContrast;
  const contrastFactor = 1 + contrastValue * 0.0115;
  const warmth = (currentSettings.warmth + autoWarmth) * 0.74;
  const saturationFactor = 1 + currentSettings.saturation * 0.0115;
  const clarityFactor = currentSettings.clarity * 0.0048;
  const vignettePower = currentSettings.vignette * 0.0055;
  const grainPower = currentSettings.grain * 0.68;
  const width = output.width;
  const height = output.height;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const originalR = data[index];
      const originalG = data[index + 1];
      const originalB = data[index + 2];

      let r = originalR + exposureOffset + warmth;
      let g = originalG + exposureOffset + autoGreen;
      let b = originalB + exposureOffset - warmth;

      r = (r - 128) * contrastFactor + 128;
      g = (g - 128) * contrastFactor + 128;
      b = (b - 128) * contrastFactor + 128;

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * saturationFactor;
      g = luma + (g - luma) * saturationFactor;
      b = luma + (b - luma) * saturationFactor;

      const midContrast = (luma - 128) * clarityFactor;
      r += midContrast;
      g += midContrast;
      b += midContrast;

      if (vignettePower > 0) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy) / maxDistance;
        const vignette = 1 - Math.pow(distance, 1.85) * vignettePower;
        r *= vignette;
        g *= vignette;
        b *= vignette;
      }

      if (grainPower > 0) {
        const noise = seededNoise(x, y) * grainPower;
        r += noise;
        g += noise;
        b += noise;
      }

      data[index] = clamp(Math.round(originalR * (1 - strength) + r * strength), 0, 255);
      data[index + 1] = clamp(Math.round(originalG * (1 - strength) + g * strength), 0, 255);
      data[index + 2] = clamp(Math.round(originalB * (1 - strength) + b * strength), 0, 255);
    }
  }

  context.putImageData(imageData, 0, 0);
  return output;
}

function analyzeImageData(imageData, sampleStep) {
  const { data, width, height } = imageData;
  const step = Math.max(1, sampleStep);
  const lumas = [];
  let count = 0;
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalL = 0;
  let saturation = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);

      totalR += r;
      totalG += g;
      totalB += b;
      totalL += luma;
      saturation += max === 0 ? 0 : ((max - min) / max) * 100;
      lumas.push(luma);
      count += 1;
    }
  }

  lumas.sort((a, b) => a - b);
  const p10 = lumas[Math.floor(lumas.length * 0.1)] || 0;
  const p90 = lumas[Math.floor(lumas.length * 0.9)] || 255;

  return {
    avgR: totalR / count,
    avgG: totalG / count,
    avgB: totalB / count,
    avgL: totalL / count,
    saturation: saturation / count,
    contrastSpan: p90 - p10
  };
}

function startCompareDrag(event) {
  if (!selectedPhoto() || event.button !== 0) {
    return;
  }

  compareDragging = true;
  dom.dropZone.setPointerCapture?.(event.pointerId);
  updateCompareFromEvent(event);
  event.preventDefault();
}

function moveCompareDrag(event) {
  if (!compareDragging) {
    return;
  }

  updateCompareFromEvent(event);
  event.preventDefault();
}

function stopCompareDrag(event) {
  if (!compareDragging) {
    return;
  }

  compareDragging = false;
  dom.dropZone.releasePointerCapture?.(event.pointerId);
}

function updateCompareFromEvent(event) {
  if (!compareFrame) {
    return;
  }

  const rect = dom.dropZone.getBoundingClientRect();
  const x = event.clientX - rect.left;
  compareSplit = clamp((x - compareFrame.x) / compareFrame.width, 0, 1);
  drawComparison();
}

function drawComparison() {
  const canvas = dom.previewCanvas;
  const context = canvas.getContext("2d");
  const rect = dom.dropZone.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.floor(rect.width));
  const cssHeight = Math.max(1, Math.floor(rect.height));
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  if (canvas.width !== Math.floor(cssWidth * dpr) || canvas.height !== Math.floor(cssHeight * dpr)) {
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = "#07090d";
  context.fillRect(0, 0, cssWidth, cssHeight);

  const hasImage = Boolean(originalPreview && processedPreview);
  dom.dropZone.classList.toggle("has-image", hasImage);
  dom.emptyState.classList.toggle("hidden", hasImage);
  dom.compareLabels.classList.toggle("hidden", !hasImage);
  if (!hasImage) {
    compareFrame = null;
    return;
  }

  const fit = fitInside(processedPreview.width, processedPreview.height, cssWidth - 34, cssHeight - 34);
  const drawX = Math.round((cssWidth - fit.width) / 2);
  const drawY = Math.round((cssHeight - fit.height) / 2);
  const split = clamp(compareSplit, 0, 1);
  const splitX = drawX + fit.width * split;
  compareFrame = { x: drawX, y: drawY, width: fit.width, height: fit.height };

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 14;
  context.fillStyle = "#0b0d12";
  context.fillRect(drawX - 8, drawY - 8, fit.width + 16, fit.height + 16);
  context.restore();

  context.drawImage(originalPreview, drawX, drawY, fit.width, fit.height);
  context.save();
  context.beginPath();
  context.rect(drawX, drawY, fit.width * split, fit.height);
  context.clip();
  context.drawImage(processedPreview, drawX, drawY, fit.width, fit.height);
  context.restore();

  context.strokeStyle = "rgba(238, 241, 246, 0.82)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(splitX, drawY);
  context.lineTo(splitX, drawY + fit.height);
  context.stroke();

  drawHandle(context, splitX, drawY + fit.height / 2);
}

function drawHandle(context, x, y) {
  const width = 36;
  const height = 42;
  const left = x - width / 2;
  const top = y - height / 2;
  roundRect(context, left, top, width, height, 8);
  context.fillStyle = "rgba(21, 24, 32, 0.92)";
  context.fill();
  context.strokeStyle = "rgba(238, 241, 246, 0.78)";
  context.stroke();

  context.fillStyle = "#d9dee8";
  context.font = "14px DNFBitBit, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("<", x - 10, y + 1);
  context.fillText("I", x, y + 1);
  context.fillText(">", x + 10, y + 1);
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
}

function fitInside(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function seededNoise(x, y) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (value - Math.floor(value) - 0.5) * 2;
}

async function saveCurrentImage() {
  const photo = selectedPhoto();
  if (!photo) {
    return;
  }
  setStatus("현재 이미지 저장 준비...");
  await savePhoto(photo, settings);
  setStatus("현재 이미지 저장됨");
}

async function saveAllImages() {
  if (!photos.length) {
    return;
  }

  setStatus("전체 저장 중...");
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    await savePhoto(photo, cloneSettings(photo.settings || settings));
    await wait(240);
  }
  setStatus("전체 저장 완료");
}

async function savePhoto(photo, photoSettings) {
  const source = createSourceCanvas(photo, 4096);
  const processed = processCanvas(source, photoSettings);
  const blob = await canvasToBlob(processed, "image/jpeg", 0.94);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildOutputName(photo.name);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Canvas export failed"));
      }
    }, type, quality);
  });
}

function buildOutputName(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}_protone.jpg`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setStatus(text) {
  dom.statusText.textContent = text;
}

function setSummary(text) {
  dom.smartSummary.textContent = text;
}

function setAiStatus(mode, text) {
  dom.aiStatus.classList.remove("is-idle", "is-busy", "is-ready", "is-offline");
  dom.aiStatus.classList.add(`is-${mode}`);
  dom.aiStatus.textContent = text;
}

init();
