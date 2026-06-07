const ALLOWED_PRESETS = ["natural", "portrait", "cinematic", "food", "product", "night"];
const ALLOWED_STYLES = [
  "natural",
  "bright",
  "vivid",
  "soft",
  "warm",
  "cool",
  "instagram",
  "cafe",
  "travel",
  "cinematic",
  "film",
  "moody",
  "portrait",
  "product",
  "food",
  "space",
  "night",
  "mono"
];

const STYLES: Record<string, string> = {
  natural: "Natural professional photo retouching. Preserve the original mood, clean contrast, balanced color.",
  bright: "Bright and clean professional retouching. Lift exposure, keep whites clean, maintain natural color.",
  vivid: "Vivid polished color grade. Clear contrast, lively color, crisp detail without neon oversaturation.",
  soft: "Soft elegant retouching. Gentle contrast, pleasant highlights, smooth color, avoid harsh clarity.",
  warm: "Warm cozy retouching. Add tasteful warmth and inviting color while protecting highlights.",
  cool: "Cool refined retouching. Clean cooler white balance, crisp shadows, modern restrained color.",
  instagram: "Modern social media color grade. Bright, warm, crisp, attractive but not overdone.",
  cafe: "Cafe lifestyle color grade. Warm ambience, creamy highlights, soft contrast, subtle film character.",
  travel: "Travel photography retouching. Bright air, clear scenery, lively color, crisp texture.",
  cinematic: "Cinematic editorial look. Controlled highlights, deeper mood, subtle teal/orange if suitable.",
  film: "Analog film-inspired grade. Gentle warmth, restrained saturation, subtle grain, natural contrast.",
  moody: "Moody editorial retouching. Deeper contrast, restrained color, atmospheric shadows without crushing detail.",
  portrait: "Portrait and selfie retouching. Pleasant skin tones, gentle contrast, bright eyes, avoid over-sharpening skin.",
  product: "Clean commercial product photography. Accurate whites, neutral color, crisp detail.",
  food: "Appetizing food photography. Warmth, texture, fresh color, natural contrast.",
  space: "Interior and real estate photography. Bright, clean, wide-feeling, neutral walls, no heavy vignette.",
  night: "Night photo retouching. Lift usable detail, control noise feeling, protect lights, crisp but not harsh.",
  mono: "Black and white professional retouching. Remove color, emphasize luminance contrast and shape, tasteful grain if useful."
};

type Adjustment = {
  styleKey?: string;
  presetKey?: string;
  sceneName?: string;
  reason?: string;
  strength?: number;
  exposure?: number;
  contrast?: number;
  warmth?: number;
  saturation?: number;
  clarity?: number;
  vignette?: number;
  grain?: number;
};

Deno.serve(async (request) => {
  const corsHeaders = buildCorsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  if (!isAllowedOrigin(request)) {
    return jsonResponse({ error: "Origin not allowed" }, 403, corsHeaders);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const imageDataUrl = String(body.imageDataUrl || "");
    const styleKey = String(body.style || "auto");
    const requestedStyleKey = styleKey === "auto" || STYLES[styleKey] ? styleKey : "auto";
    const stylePrompt = requestedStyleKey === "auto"
      ? "AI recommendation mode. Choose the best styleKey from the allowed style list after analyzing the photo. Do not blindly use natural; pick a useful visual direction."
      : STYLES[requestedStyleKey] || STYLES.natural;

    if (!imageDataUrl.startsWith("data:image/")) {
      return jsonResponse({ error: "imageDataUrl is required" }, 400, corsHeaders);
    }

    if (imageDataUrl.length > 2_800_000) {
      return jsonResponse({ error: "Image payload is too large" }, 413, corsHeaders);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) {
      return jsonResponse({ error: "OPENAI_API_KEY Edge Function secret is missing" }, 500, corsHeaders);
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildOpenAiPayload(imageDataUrl, stylePrompt, requestedStyleKey))
    });

    const responseText = await response.text();
    if (!response.ok) {
      return jsonResponse({ error: "OpenAI API error", detail: responseText.slice(0, 1000) }, response.status, corsHeaders);
    }

    const outputText = extractOutputText(JSON.parse(responseText));
    const parsed = normalizeAdjustment(JSON.parse(extractJson(outputText)));
    return jsonResponse(parsed, 200, corsHeaders);
  } catch (error) {
    return jsonResponse({
      error: "AI smart adjustment failed",
      detail: error instanceof Error ? error.message : String(error)
    }, 500, corsHeaders);
  }
});

function buildOpenAiPayload(imageDataUrl: string, stylePrompt: string, requestedStyleKey: string) {
  return {
    model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "You are a professional photo retoucher.",
              "Analyze this photo and return JSON only.",
              `Style mode: ${requestedStyleKey === "auto" ? "AI must choose the style" : "User provided a style direction"}`,
              `Goal style: ${stylePrompt}`,
              `Allowed styleKey values: ${ALLOWED_STYLES.join(", ")}`,
              requestedStyleKey === "auto"
                ? "Pick the most suitable styleKey for the image content, lighting, subject, and mood."
                : `Return styleKey as ${requestedStyleKey} unless it would clearly make the photo worse.`,
              "Choose visible, professional Lightroom-like values. The before/after difference should be clearly noticeable but still tasteful.",
              "Avoid fake HDR, crushed blacks, clipped highlights, excessive saturation, and skin tone damage.",
              "For ordinary photos, prefer strength 78-92, contrast 10-28, saturation 6-22, clarity 16-32 unless the scene requires restraint.",
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
            styleKey: { type: "string", enum: ALLOWED_STYLES },
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
          required: ["styleKey", "presetKey", "sceneName", "reason", "strength", "exposure", "contrast", "warmth", "saturation", "clarity", "vignette", "grain"]
        }
      }
    },
    max_output_tokens: 700
  };
}

function intSchema(minimum: number, maximum: number) {
  return { type: "integer", minimum, maximum };
}

function extractOutputText(payload: any) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const chunks: string[] = [];
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

function extractJson(text: string) {
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

function normalizeAdjustment(raw: Adjustment) {
  return {
    source: "SUPABASE_AI",
    styleKey: ALLOWED_STYLES.includes(String(raw.styleKey)) ? String(raw.styleKey) : "natural",
    presetKey: ALLOWED_PRESETS.includes(String(raw.presetKey)) ? raw.presetKey : "natural",
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

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  return Math.min(max, Math.max(min, number));
}

function jsonResponse(body: unknown, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}

function buildCorsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowOrigin = chooseAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin") || "";
  if (!origin) {
    return false;
  }
  const allowed = getAllowedOrigins();
  return allowed.includes("*") || allowed.includes(origin);
}

function chooseAllowedOrigin(origin: string) {
  const allowed = getAllowedOrigins();
  if (allowed.includes("*")) {
    return origin || "*";
  }
  if (origin && allowed.includes(origin)) {
    return origin;
  }
  return allowed[0] || "https://noctis248650-cyber.github.io";
}

function getAllowedOrigins() {
  const raw = Deno.env.get("ALLOWED_ORIGINS") || "https://noctis248650-cyber.github.io,http://localhost:5174,http://127.0.0.1:5174";
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}
