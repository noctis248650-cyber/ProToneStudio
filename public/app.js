const dom = {
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  previewCanvas: document.querySelector("#previewCanvas"),
  emptyState: document.querySelector("#emptyState"),
  compareLabels: document.querySelector("#compareLabels"),
  compareHandle: document.querySelector("#compareHandle"),
  beforeButton: document.querySelector("#beforeButton"),
  afterButton: document.querySelector("#afterButton"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  sceneTitle: document.querySelector("#sceneTitle"),
  styleSelect: document.querySelector("#styleSelect"),
  batchButton: document.querySelector("#batchButton"),
  saveButton: document.querySelector("#saveButton"),
  saveAllButton: document.querySelector("#saveAllButton"),
  rotateButton: document.querySelector("#rotateButton"),
  smartSummary: document.querySelector("#smartSummary"),
  detailGrid: document.querySelector("#detailGrid"),
  fileList: document.querySelector("#fileList"),
  imageCount: document.querySelector("#imageCount")
};

const IMAGE_PICKER_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

const DEFAULT_SETTINGS = Object.freeze({
  styleKey: "natural",
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

const STYLE_LABELS = {
  auto: "AI 추천",
  natural: "자연스럽게",
  bright: "밝고 깨끗하게",
  vivid: "선명하게",
  soft: "부드럽게",
  warm: "따뜻하게",
  cool: "차갑게",
  instagram: "인스타 감성",
  cafe: "카페 감성",
  travel: "여행 사진",
  cinematic: "시네마틱",
  film: "필름 감성",
  moody: "무드 있게",
  portrait: "인물/셀카",
  product: "제품 사진",
  food: "음식 사진",
  space: "공간/부동산",
  night: "야간 사진",
  mono: "흑백"
};

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
let batchInFlight = false;
let compareSplit = 0.5;
let compareFrame = null;
let compareDragging = false;
let previewLoading = false;

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
  renderFileList();
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
      openImageLibrary();
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

  dom.compareHandle.addEventListener("pointerdown", startCompareDrag);
  dom.compareHandle.addEventListener("click", (event) => event.stopPropagation());
  dom.beforeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setCompareSplit(0);
  });
  dom.afterButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setCompareSplit(1);
  });
  dom.compareHandle.addEventListener("pointermove", moveCompareDrag);
  dom.compareHandle.addEventListener("pointerup", stopCompareDrag);
  dom.compareHandle.addEventListener("pointercancel", stopCompareDrag);
  dom.batchButton.addEventListener("click", retouchAllImages);
  dom.saveButton.addEventListener("click", saveCurrentImage);
  dom.saveAllButton.addEventListener("click", saveAllImages);
  dom.rotateButton.addEventListener("click", () => rotateSelectedPhoto(-90));
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
        smartSummary: "",
        sceneName: ""
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
  updateSceneTitle(photo.sceneName || "분석 대기");
  showLoading(true);
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

  const addItem = document.createElement("button");
  addItem.className = "add-thumb";
  addItem.type = "button";
  addItem.setAttribute("aria-label", "이미지 추가");
  addItem.innerHTML = "<span>+</span>";
  addItem.addEventListener("click", openImageLibrary);
  dom.fileList.append(addItem);

  if (!photos.length) {
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

function openImageLibrary() {
  dom.fileInput.accept = IMAGE_PICKER_ACCEPT;
  dom.fileInput.multiple = true;
  dom.fileInput.removeAttribute("capture");
  dom.fileInput.click();
}

function setButtonsEnabled(enabled) {
  const canUse = enabled && !batchInFlight;
  const hasPhoto = Boolean(selectedPhoto()) && canUse;
  const hasAny = photos.length > 0 && canUse;
  dom.batchButton.disabled = !hasAny || smartInFlight;
  dom.saveButton.disabled = !hasPhoto;
  dom.saveAllButton.disabled = !hasAny;
  dom.rotateButton.disabled = !hasPhoto;
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
    updateSceneTitle("이미지를 올려주세요");
    setStatus("준비됨");
    setSummary("스마트 보정 대기");
    updateControlsFromSettings();
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

async function applySmartAdjustment(options = {}) {
  const silentRender = options.silentRender === true;
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
  setButtonsEnabled(true);
  updateSceneTitle("분석 중...");
  showLoading(true);
  setStatus("AI 스마트 분석 중...");
  setSummary("사진의 밝기, 색온도, 대비, 장면 분위기를 분석하고 있습니다.");

  try {
    const aiResult = await requestAiAdjustment(photo);
    settings = normalizeSettings(aiResult);
    photo.smartBase = cloneSettings(settings);
    photo.settings = cloneSettings(settings);
    photo.sceneName = aiResult.sceneName || "AI 자동";
    photo.smartSummary = buildSmartSummary(aiResult, settings);
    updateSceneTitle(photo.sceneName);
    setSummary(photo.smartSummary);
    setStatus("AI 보정 적용됨");
  } catch (error) {
    const localResult = await buildLocalSmartAdjustment(photo);
    settings = normalizeSettings(localResult);
    photo.smartBase = cloneSettings(settings);
    photo.settings = cloneSettings(settings);
    photo.sceneName = localResult.sceneName || "로컬 자동";
    photo.smartSummary = buildSmartSummary(localResult, settings);
    updateSceneTitle(photo.sceneName);
    setSummary(aiApiUnavailable ? `${photo.smartSummary} · AI API 연결 실패로 로컬 보정으로 전환됨` : `${photo.smartSummary} (로컬 분석)`);
    setStatus("로컬 스마트 보정 적용됨");
  } finally {
    smartInFlight = false;
    setButtonsEnabled(true);
    updateControlsFromSettings();
    renderFileList();
    if (!silentRender) {
      renderSelected();
    }
    if (!silentRender && pendingSmartAfterFlight) {
      pendingSmartAfterFlight = false;
      void applySmartAdjustment();
    }
  }
}

async function retouchAllImages() {
  if (!photos.length || batchInFlight) {
    return;
  }

  batchInFlight = true;
  const originalLabel = dom.batchButton.textContent;
  dom.batchButton.textContent = "보정 중...";
  setButtonsEnabled(true);
  showLoading(true);
  setSummary("첨부한 모든 이미지를 순서대로 스마트 보정하고 있습니다.");

  try {
    for (let index = 0; index < photos.length; index += 1) {
      selectedIndex = index;
      const photo = selectedPhoto();
      settings = cloneSettings(photo.settings || DEFAULT_SETTINGS);
      compareSplit = 0.5;
      updateControlsFromSettings();
      renderFileList();
      updateSceneTitle(`전체 보정 중 ${index + 1}/${photos.length}`);
      await applySmartAdjustment({ silentRender: true });
      await wait(80);
    }

    selectedIndex = 0;
    settings = cloneSettings(photos[0].settings || DEFAULT_SETTINGS);
    updateControlsFromSettings();
    renderFileList();
    updateSceneTitle(photos[0].sceneName || "전체 보정 완료");
    setSummary(photos[0].smartSummary || "전체 보정 완료");
    renderSelected();
  } finally {
    batchInFlight = false;
    dom.batchButton.textContent = originalLabel;
    setButtonsEnabled(true);
  }
}

async function requestAiAdjustment(photo) {
  if (aiApiUnavailable) {
    throw new Error("AI API is disabled for this session");
  }

  const supabase = getSupabaseConfig();
  const canvas = createSourceCanvas(photo, 960);
  const imageDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const requestedStyle = getRequestedStyleKey();
  try {
    const response = await fetch(`${supabase.url}/functions/v1/smart-adjust`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({ imageDataUrl, style: requestedStyle })
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

  const requestedStyle = getRequestedStyleKey();
  const styleKey = requestedStyle === "auto" ? recommendLocalStyleKey(stats, presetKey) : requestedStyle;
  const bias = STYLE_BIAS[styleKey] || STYLE_BIAS.natural;

  const result = {
    source: "LOCAL",
    styleKey,
    presetKey,
    sceneName,
    reason: `브라우저에서 장면을 분석해 ${getStyleLabel(styleKey)} 방향의 보정값을 골랐습니다.`,
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
  const requestedStyle = getRequestedStyleKey();
  const rawStyle = String(raw.styleKey || "");
  const styleKey = STYLE_BIAS[rawStyle] ? rawStyle : requestedStyle === "auto" ? "natural" : requestedStyle;
  const normalized = {
    styleKey,
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

  return enforceVisibleSmartGrade(normalized, styleKey);
}

function getRequestedStyleKey() {
  const key = String(dom.styleSelect.value || "auto");
  return key === "auto" || STYLE_BIAS[key] ? key : "auto";
}

function getStyleLabel(styleKey) {
  return STYLE_LABELS[styleKey] || STYLE_LABELS.natural;
}

function recommendLocalStyleKey(stats, presetKey) {
  if (presetKey === "food") {
    return "food";
  }
  if (presetKey === "night") {
    return "night";
  }
  if (presetKey === "product") {
    return "bright";
  }
  if (stats.avgL > 155 && stats.saturation < 38) {
    return "space";
  }
  if (stats.saturation > 52 && stats.contrastSpan > 112) {
    return "travel";
  }
  if (stats.contrastSpan > 145 && stats.avgL < 138) {
    return "cinematic";
  }
  if (stats.avgR > stats.avgB + 12) {
    return "cafe";
  }
  if (stats.contrastSpan < 82) {
    return "vivid";
  }
  return "natural";
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

function buildSmartSummary(result, nextSettings) {
  const reason = result.reason || "사진에 맞는 보정값을 적용했습니다.";
  const styleLabel = getRequestedStyleKey() === "auto" ? "추천 스타일" : "선택 스타일";
  return `${styleLabel}: ${getStyleLabel(nextSettings.styleKey)} · ${reason}`;
}

function updateControlsFromSettings() {
  settings = cloneSettings(settings);
  renderDetailValues();
}

function renderDetailValues() {
  if (!dom.detailGrid) {
    return;
  }

  const rows = [
    ["스타일", getStyleLabel(settings.styleKey)],
    ["강도", settings.strength],
    ["노출", settings.exposure],
    ["대비", settings.contrast],
    ["온도", settings.warmth],
    ["색감", settings.saturation],
    ["선명도", settings.clarity],
    ["비네팅", settings.vignette],
    ["필름입자", settings.grain]
  ];

  dom.detailGrid.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("div");
    row.className = "detail-row";
    row.innerHTML = `<span>${label}</span><output>${value}</output>`;
    return row;
  }));
}

function renderSelected() {
  const token = ++renderToken;
  const photo = selectedPhoto();
  if (!photo) {
    showLoading(false);
    originalPreview = null;
    processedPreview = null;
    drawComparison();
    return;
  }

  persistSelectedSettings();
  setStatus("보정 중...");
  showLoading(true);

  requestAnimationFrame(() => {
    if (token !== renderToken) {
      return;
    }
    originalPreview = createSourceCanvas(photo, 1800);
    processedPreview = window.processCanvas(originalPreview, settings);
    previewLoading = false;
    drawComparison();
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
  dom.compareHandle.setPointerCapture?.(event.pointerId);
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
  dom.compareHandle.releasePointerCapture?.(event.pointerId);
}

function updateCompareFromEvent(event) {
  if (!compareFrame) {
    return;
  }

  const rect = dom.dropZone.getBoundingClientRect();
  const x = event.clientX - rect.left;
  setCompareSplit((x - compareFrame.x) / compareFrame.width);
}

function setCompareSplit(value) {
  compareSplit = clamp(value, 0, 1);
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
  const showImage = hasImage && !previewLoading;
  dom.dropZone.classList.toggle("has-image", showImage);
  dom.emptyState.classList.toggle("hidden", showImage || previewLoading);
  dom.compareLabels.classList.toggle("hidden", !showImage);
  dom.compareHandle.classList.toggle("hidden", !showImage);
  dom.loadingOverlay.classList.toggle("hidden", !previewLoading);
  dom.dropZone.classList.toggle("is-loading", previewLoading);
  if (previewLoading) {
    compareFrame = null;
    return;
  }

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

  dom.compareHandle.style.left = `${splitX}px`;
  dom.compareHandle.style.top = `${drawY + fit.height / 2}px`;
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
  await window.savePhoto(photo, settings);
  setStatus("현재 이미지 저장됨");
}

async function saveAllImages() {
  if (!photos.length) {
    return;
  }

  setStatus("전체 저장 중...");
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    await window.savePhoto(photo, cloneSettings(photo.settings || settings));
    await wait(240);
  }
  setStatus("전체 저장 완료");
}

async function savePhoto(photo, photoSettings) {
  const source = createSourceCanvas(photo, 4096);
  const processed = window.processCanvas(source, photoSettings);
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

function setStatus(_text) {
  // 상태 표시는 장면명과 스마트 보정 설명으로 통합합니다.
}

function updateSceneTitle(text) {
  dom.sceneTitle.textContent = text || "분석 대기";
}

function showLoading(loading) {
  previewLoading = loading;
  drawComparison();
}

function setSummary(text) {
  dom.smartSummary.textContent = text;
}

function setAiStatus(_mode, _text) {
  // AI 연결 상태 뱃지는 화면에서 제거했습니다.
}

function exposeGlobalApi() {
  Object.assign(window, {
    createSourceCanvas,
    processCanvas,
    renderSelected,
    savePhoto,
    selectedPhoto,
    setSummary
  });
}

exposeGlobalApi();
init();
