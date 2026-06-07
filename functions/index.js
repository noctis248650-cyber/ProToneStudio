const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const openAiApiKey = defineSecret("OPENAI_API_KEY");

const ALLOWED_PRESETS = ["natural", "portrait", "cinematic", "food", "product", "night"];
const STYLES = {
  natural: "Natural professional photo retouching. Preserve the original mood, clean contrast, balanced color.",
  instagram: "Modern social media color grade. Bright, warm, crisp, attractive but not overdone.",
  cinematic: "Cinematic editorial look. Controlled highlights, deeper mood, subtle teal/orange if suitable.",
  product: "Clean commercial product photography. Accurate whites, neutral color, crisp detail.",
  food: "Appetizing food photography. Warmth, texture, fresh color, natural contrast.",
  space: "Interior and real estate photography. Bright, clean, wide-feeling, neutral walls, no heavy vignette."
};

exports.smartAdjust = onRequest(
  {
    region: "asia-northeast3",
    secrets: [openAiApiKey],
    timeoutSeconds: 60,
    memory: "512MiB"
  },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const imageDataUrl = String(body.imageDataUrl || "");
      const styleKey = String(body.style || "natural");
      const stylePrompt = STYLES[styleKey] || STYLES.natural;
      if (!imageDataUrl.startsWith("data:image/")) {
        res.status(400).json({ error: "imageDataUrl is required" });
        return;
      }

      const apiKey = openAiApiKey.value() || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
        return;
      }

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildOpenAiPayload(imageDataUrl, stylePrompt))
      });

      const responseText = await response.text();
      if (!response.ok) {
        res.status(response.status).json({ error: "OpenAI API error", detail: safeDetail(responseText) });
        return;
      }

      const outputText = extractOutputText(JSON.parse(responseText));
      const parsed = normalizeAdjustment(JSON.parse(extractJson(outputText)));
      res.status(200).json(parsed);
    } catch (error) {
      res.status(500).json({ error: "AI smart adjustment failed", detail: String(error && error.message ? error.message : error) });
    }
  }
);

function buildOpenAiPayload(imageDataUrl, stylePrompt) {
  return {
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "You are a professional photo retoucher.",
              "Analyze this photo and return JSON only.",
              `Goal style: ${stylePrompt}`,
              "Choose subtle Lightroom-like values that preserve the original image and make it look professionally color graded.",
              "Avoid fake HDR, crushed blacks, clipped highlights, excessive saturation, and skin tone damage.",
              "sceneName and reason must be Korean.",
              "Return integer slider values only."
            ].join("\n")
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "low"
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "photo_adjustment",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            presetKey: { type: "string", enum: ALLOWED_PRESETS },
            sceneName: { type: "string" },
            reason: { type: "string" },
            strength: intSchema(0, 100),
            exposure: intSchema(-100, 100),
            contrast: intSchema(-100, 100),
            warmth: intSchema(-100, 100),
            saturation: intSchema(-100, 100),
            clarity: intSchema(0, 100),
            vignette: intSchema(0, 100),
            grain: intSchema(0, 50)
          },
          required: ["presetKey", "sceneName", "reason", "strength", "exposure", "contrast", "warmth", "saturation", "clarity", "vignette", "grain"]
        }
      }
    },
    max_output_tokens: 700
  };
}

function intSchema(minimum, maximum) {
  return { type: "integer", minimum, maximum };
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const chunks = [];
  for (const item of payload.output || []) {
    for (const part of item.content || []) {
      if (typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  if (!chunks.length) {
    throw new Error("No output text in OpenAI response");
  }

  return chunks.join("\n");
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fenced) {
    return fenced[1];
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  return trimmed;
}

function normalizeAdjustment(raw) {
  return {
    source: "AI",
    presetKey: ALLOWED_PRESETS.includes(raw.presetKey) ? raw.presetKey : "natural",
    sceneName: String(raw.sceneName || "AI 자동"),
    reason: String(raw.reason || "AI가 사진 분위기에 맞춰 보정값을 골랐습니다."),
    strength: clampInt(raw.strength, 0, 100, 76),
    exposure: clampInt(raw.exposure, -100, 100, 0),
    contrast: clampInt(raw.contrast, -100, 100, 0),
    warmth: clampInt(raw.warmth, -100, 100, 0),
    saturation: clampInt(raw.saturation, -100, 100, 0),
    clarity: clampInt(raw.clarity, 0, 100, 18),
    vignette: clampInt(raw.vignette, 0, 100, 8),
    grain: clampInt(raw.grain, 0, 50, 0)
  };
}

function clampInt(value, min, max, fallback) {
  const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  return Math.min(max, Math.max(min, number));
}

function safeDetail(text) {
  return String(text || "").slice(0, 1200);
}

function setCors(req, res) {
  const origin = req.get("origin") || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}
