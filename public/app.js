const dom = {
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  previewCanvas: document.querySelector("#previewCanvas"),
  emptyState: document.querySelector("#emptyState"),
  compareRange: document.querySelector("#compareRange"),
  currentName: document.querySelector("#currentName"),
  statusText: document.querySelector("#statusText"),
  styleSelect: document.querySelector("#styleSelect"),
  smartButton: document.querySelector("#smartButton"),
  saveButton: document.querySelector("#saveButton"),
  saveAllButton: document.querySelector("#saveAllButton"),
  autoWhiteBalance: document.querySelector("#autoWhiteBalance"),
  autoTone: document.querySelector("#autoTone"),
  smartSummary: document.querySelector("#smartSummary"),
  presetGrid: document.querySelector("#presetGrid"),
  adjustmentBody: document.querySelector("#adjustmentBody"),
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

const CONTROL_DEFS = [
  { key: "strength", label: "강도", min: 0, max: 100, step: 1 },
  { key: "exposure", label: "노출", min: -100, max: 100, step: 1 },
  { key: "contrast", label: "대비", min: -100, max: 100, step: 1 },
  { key: "warmth", label: "온도", min: -100, max: 100, step: 1 },
  { key: "saturation", label: "색감", min: -100, max: 100, step: 1 },
  { key: "clarity", label: "선명도", min: 0, max: 100, step: 1 },
  { key: "vignette", label: "비네팅", min: 0, max: 100, step: 1 },
  { key: "grain", label: "필름입자", min: 0, max: 50, step: 1 }
];

const PRESETS = [
  {
    key: "natural",
    name: "Natural",
    description: "깨끗한 기본 톤",
    values: { exposure: 0, contrast: 5, warmth: 0, saturation: 4, clarity: 12, vignette: 0, grain: 0 }
  },
  {
    key: "portrait",
    name: "Portrait",
    description: "부드러운 인물",
    values: { exposure: 6, contrast: -4, warmth: 5, saturation: 3, clarity: 8, vignette: 8, grain: 0 }
  },
  {
    key: "cinematic",
    name: "Cinema",
    description: "차분한 영화톤",
    values: { exposure: -5, contrast: 18, warmth: -5, saturation: -4, clarity: 18, vignette: 16, grain: 6 }
  },
  {
    key: "food",
    name: "Food",
    description: "따뜻하고 선명하게",
    values: { exposure: 5, contrast: 12, warmth: 10, saturation: 14, clarity: 16, vignette: 4, grain: 0 }
  },
  {
    key: "product",
    name: "Product",
    description: "중립적인 상업컷",
    values: { exposure: 8, contrast: 10, warmth: -3, saturation: -2, clarity: 22, vignette: 0, grain: 0 }
  },
  {
    key: "night",
    name: "Night",
    description: "야간 톤 정리",
    values: { exposure: 4, contrast: 20, warmth: -8, saturation: 2, clarity: 24, vignette: 18, grain: 8 }
  }
];

const STYLE_BIAS = {
  natural: { exposure: 0, contrast: 0, warmth: 0, saturation: 0, clarity: 0, vignette: 0 },
  instagram: { exposure: 7, contrast: 5, warmth: 7, saturation: 10, clarity: 4, vignette: 4 },
  cinematic: { exposure: -4, contrast: 14, warmth: -7, saturation: -6, clarity: 8, vignette: 14 },
  product: { exposure: 10, contrast: 6, warmth: -4, saturation: -6, clarity: 12, vignette: -10 },
  food: { exposure: 5, contrast: 8, warmth: 12, saturation: 14, clarity: 6, vignette: 0 },
  space: { exposure: 12, contrast: 0, warmth: -3, saturation: -8, clarity: 6, vignette: -12 }
};

let photos = [];
let selectedIndex = -1;
let settings = cloneSettings(DEFAULT_SETTINGS);
let renderToken = 0;
let originalPreview = null;
let processedPreview = null;
let smartInFlight = false;
let aiApiUnavailable = false;

function cloneSettings(source) {
  return { ...DEFAULT_SETTINGS, ...source };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value, min, max, fallback = 0) {
  const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  return clamp(number, min, max);
}

function init() {
  buildPresetButtons();
  buildAdjustmentSliders();
  bindEvents();
  setButtonsEnabled(false);
  updateControlsFromSettings();
  drawComparison();
}

function bindEvents() {
  dom.fileInput.addEventListener("change", (event) => {
    handleFiles(event.target.files);
    event.target.value = "";
  });

  dom.dropZone.addEventListener("click", () => dom.fileInput.click());
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

  dom.compareRange.addEventListener("input", drawComparison);
  dom.smartButton.addEventListener("click", applySmartAdjustment);
  dom.saveButton.addEventListener("click", saveCurrentImage);
  dom.saveAllButton.addEventListener("click", saveAllImages);
  dom.styleSelect.addEventListener("change", () => {
    setSummary("스타일이 변경되었습니다. AI 스마트를 누르면 새 스타일로 다시 판단합니다.");
  });

  dom.autoWhiteBalance.addEventListener("change", () => {
    settings.autoWhiteBalance = dom.autoWhiteBalance.checked;
    persistSelectedSettings();
    renderSelected();
  });
  dom.autoTone.addEventListener("change", () => {
    settings.autoTone = dom.autoTone.checked;
    persistSelectedSettings();
    renderSelected();
  });

  window.addEventListener("resize", drawComparison);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => drawComparison());
    observer.observe(dom.dropZone);
  }
}

function buildPresetButtons() {
  dom.presetGrid.replaceChildren();
  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.className = "preset-button";
    button.type = "button";
    button.dataset.preset = preset.key;
    button.innerHTML = `<strong>${preset.name}</strong><span>${preset.description}</span>`;
    button.addEventListener("click", () => applyPresetLook(preset.key));
    dom.presetGrid.append(button);
  }
}

function buildAdjustmentSliders() {
  dom.adjustmentBody.replaceChildren();
  for (const def of CONTROL_DEFS) {
    const row = document.createElement("label");
    row.className = "slider-row";
    row.innerHTML = `
      <span>${def.label}</span>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" data-control="${def.key}" />
      <output data-output="${def.key}">0</output>
    `;
    row.querySelector("input").addEventListener("input", (event) => {
      settings[def.key] = Number(event.target.value);
      updateControlOutputs();
      persistSelectedSettings();
      renderSelected();
    });
    dom.adjustmentBody.append(row);
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
  settings = cloneSettings(photo.settings || DEFAULT_SETTINGS);
  updateControlsFromSettings();
  renderFileList();
  updateCurrentInfo();

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

function updateCurrentInfo() {
  const photo = selectedPhoto();
  if (!photo) {
    dom.currentName.textContent = "이미지 없음";
    return;
  }
  dom.currentName.textContent = `${photo.name} · ${photo.width} x ${photo.height}`;
}

function renderFileList() {
  dom.imageCount.textContent = String(photos.length);
  dom.fileList.replaceChildren();

  if (!photos.length) {
    const empty = document.createElement("div");
    empty.className = "file-empty";
    empty.textContent = "아직 추가된 이미지가 없습니다.";
    dom.fileList.append(empty);
    return;
  }

  photos.forEach((photo, index) => {
    const item = document.createElement("button");
    item.className = `file-item${index === selectedIndex ? " selected" : ""}`;
    item.type = "button";
    item.innerHTML = `
      <span class="file-name">${escapeHtml(photo.name)}</span>
      <span class="file-path">${escapeHtml(photo.path)}</span>
    `;
    item.addEventListener("click", () => selectPhoto(index));
    dom.fileList.append(item);
  });
}

function setButtonsEnabled(enabled) {
  for (const button of [dom.smartButton, dom.saveButton, dom.saveAllButton]) {
    button.disabled = !enabled;
  }
}

async function applySmartAdjustment() {
  const photo = selectedPhoto();
  if (!photo || smartInFlight) {
    if (!photo) {
      setStatus("이미지를 먼저 올려주세요.");
      setSummary("작업 캔버스를 클릭해서 이미지를 추가할 수 있습니다.");
    }
    return;
  }

  smartInFlight = true;
  setSmartButtonsBusy(true);
  setStatus("AI 스마트 분석 중...");
  setSummary("사진의 밝기, 색온도, 대비, 장면 분위기를 분석하고 있습니다.");

  try {
    const aiResult = await requestAiAdjustment(photo);
    settings = normalizeSettings(aiResult);
    photo.smartBase = cloneSettings(settings);
    photo.settings = cloneSettings(settings);
    photo.smartSummary = `${aiResult.sceneName || "AI 자동"} · ${aiResult.reason || "사진에 맞는 보정값을 적용했습니다."} · ${formatSettingsDigest(settings)}`;
    setSummary(photo.smartSummary);
    setStatus("AI 보정 적용됨");
  } catch (error) {
    const localResult = await buildLocalSmartAdjustment(photo);
    settings = normalizeSettings(localResult);
    photo.smartBase = cloneSettings(settings);
    photo.settings = cloneSettings(settings);
    photo.smartSummary = `${localResult.sceneName} · ${localResult.reason} · ${formatSettingsDigest(settings)}`;
    setSummary(aiApiUnavailable ? `${photo.smartSummary} · AI API 연결 실패로 로컬 보정으로 전환됨` : `${photo.smartSummary} (로컬 분석)`);
    setStatus("로컬 스마트 보정 적용됨");
  } finally {
    smartInFlight = false;
    setSmartButtonsBusy(false);
    updateControlsFromSettings();
    renderFileList();
    renderSelected();
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

  for (const key of ["exposure", "contrast", "warmth", "saturation", "clarity", "vignette"]) {
    result[key] += bias[key] || 0;
  }

  if (!dom.autoWhiteBalance.checked) {
    result.warmth = bias.warmth || 0;
  }
  if (!dom.autoTone.checked) {
    result.exposure = bias.exposure || 0;
    result.contrast = bias.contrast || 0;
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
    autoWhiteBalance: typeof raw.autoWhiteBalance === "boolean" ? raw.autoWhiteBalance : dom.autoWhiteBalance.checked,
    autoTone: typeof raw.autoTone === "boolean" ? raw.autoTone : dom.autoTone.checked
  };

  return enforceVisibleSmartGrade(normalized);
}

function enforceVisibleSmartGrade(nextSettings) {
  const floors = {
    natural: { strength: 82, contrast: 12, saturation: 9, clarity: 20 },
    portrait: { strength: 78, exposure: 5, contrast: -4, warmth: 5, saturation: 6, clarity: 14, vignette: 6 },
    cinematic: { strength: 84, exposure: -4, contrast: 20, warmth: -6, saturation: -5, clarity: 22, vignette: 16, grain: 4 },
    food: { strength: 86, exposure: 5, contrast: 16, warmth: 10, saturation: 18, clarity: 22, vignette: 4 },
    product: { strength: 82, exposure: 8, contrast: 14, warmth: -3, saturation: -4, clarity: 26 },
    night: { strength: 86, exposure: 8, contrast: 22, warmth: -7, saturation: 7, clarity: 26, vignette: 18, grain: 6 }
  };
  const floor = floors[nextSettings.presetKey] || floors.natural;
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

function applyPresetLook(key) {
  const photo = selectedPhoto();
  if (!photo) {
    return;
  }

  const preset = PRESETS.find((item) => item.key === key);
  if (!preset) {
    return;
  }

  const base = cloneSettings(photo.smartBase || photo.settings || settings || DEFAULT_SETTINGS);
  settings = cloneSettings({
    ...base,
    presetKey: key,
    exposure: clampInt(base.exposure + preset.values.exposure, -100, 100),
    contrast: clampInt(base.contrast + preset.values.contrast, -100, 100),
    warmth: clampInt(base.warmth + preset.values.warmth, -100, 100),
    saturation: clampInt(base.saturation + preset.values.saturation, -100, 100),
    clarity: clampInt(Math.max(base.clarity, preset.values.clarity), 0, 100),
    vignette: clampInt(Math.max(base.vignette, preset.values.vignette), 0, 100),
    grain: clampInt(Math.max(base.grain, preset.values.grain), 0, 50)
  });

  photo.settings = cloneSettings(settings);
  setSummary(`프리셋 ${preset.name} 적용 · 스마트 보정값 위에 룩만 더했습니다.`);
  updateControlsFromSettings();
  renderSelected();
}

function resetCurrentImage() {
  const photo = selectedPhoto();
  if (!photo) {
    return;
  }

  settings = cloneSettings(DEFAULT_SETTINGS);
  photo.settings = cloneSettings(settings);
  photo.smartBase = null;
  photo.smartSummary = "";
  setSummary("초기화되었습니다. AI 스마트를 누르면 다시 판단합니다.");
  setStatus("초기화됨");
  updateControlsFromSettings();
  renderSelected();
}

function updateControlsFromSettings() {
  dom.autoWhiteBalance.checked = settings.autoWhiteBalance;
  dom.autoTone.checked = settings.autoTone;
  updateControlOutputs();

  for (const input of dom.adjustmentBody.querySelectorAll("input[type='range']")) {
    const key = input.dataset.control;
    input.value = settings[key];
  }

  for (const button of dom.presetGrid.querySelectorAll(".preset-button")) {
    button.classList.toggle("selected", button.dataset.preset === settings.presetKey);
  }
}

function updateControlOutputs() {
  for (const def of CONTROL_DEFS) {
    const input = dom.adjustmentBody.querySelector(`[data-control="${def.key}"]`);
    const output = dom.adjustmentBody.querySelector(`[data-output="${def.key}"]`);
    if (input && Number(input.value) !== settings[def.key]) {
      input.value = settings[def.key];
    }
    if (output) {
      output.textContent = String(settings[def.key]);
    }
  }
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
  updateCurrentInfo();
  setStatus("보정 중...");

  requestAnimationFrame(() => {
    if (token !== renderToken) {
      return;
    }
    originalPreview = createSourceCanvas(photo, 1800);
    processedPreview = processCanvas(originalPreview, settings);
    drawComparison();
    setStatus(`${processedPreview.width} x ${processedPreview.height}`);
  });
}

function createSourceCanvas(photo, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(photo.width, photo.height));
  const width = Math.max(1, Math.round(photo.width * scale));
  const height = Math.max(1, Math.round(photo.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(photo.image, 0, 0, width, height);
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
  dom.emptyState.classList.toggle("hidden", hasImage);
  if (!hasImage) {
    return;
  }

  const fit = fitInside(processedPreview.width, processedPreview.height, cssWidth - 34, cssHeight - 34);
  const drawX = Math.round((cssWidth - fit.width) / 2);
  const drawY = Math.round((cssHeight - fit.height) / 2);
  const split = Number(dom.compareRange.value) / 100;
  const splitX = drawX + fit.width * split;

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 14;
  context.fillStyle = "#0b0d12";
  context.fillRect(drawX - 8, drawY - 8, fit.width + 16, fit.height + 16);
  context.restore();

  context.drawImage(processedPreview, drawX, drawY, fit.width, fit.height);
  context.save();
  context.beginPath();
  context.rect(drawX, drawY, fit.width * split, fit.height);
  context.clip();
  context.drawImage(originalPreview, drawX, drawY, fit.width, fit.height);
  context.restore();

  context.strokeStyle = "rgba(238, 241, 246, 0.82)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(splitX, drawY);
  context.lineTo(splitX, drawY + fit.height);
  context.stroke();

  drawHandle(context, splitX, drawY + fit.height / 2);
  drawHud(context, drawX, drawY, `${processedPreview.width} x ${processedPreview.height}`);
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
  context.fillRect(x - 6, y - 9, 2, 18);
  context.fillRect(x + 4, y - 9, 2, 18);
}

function drawHud(context, x, y, text) {
  context.font = "12px DNFBitBit, sans-serif";
  const metrics = context.measureText(text);
  const width = metrics.width + 18;
  const height = 26;
  roundRect(context, x + 10, y + 10, width, height, 6);
  context.fillStyle = "rgba(10, 12, 16, 0.74)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.16)";
  context.stroke();
  context.fillStyle = "rgba(238, 241, 246, 0.82)";
  context.fillText(text, x + 19, y + 28);
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

function setSmartButtonsBusy(busy) {
  dom.smartButton.disabled = busy || !selectedPhoto();
  dom.smartButton.textContent = busy ? "분석 중..." : "AI 스마트";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

init();
