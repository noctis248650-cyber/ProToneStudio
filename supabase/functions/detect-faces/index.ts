type FaceBox = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence?: number;
  subjectRole?: string;
};

const FACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    faces: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          x: numberSchema(0, 1),
          y: numberSchema(0, 1),
          width: numberSchema(0, 1),
          height: numberSchema(0, 1),
          confidence: numberSchema(0, 1),
          subjectRole: { type: "string", enum: ["primary", "secondary"] }
        },
        required: ["x", "y", "width", "height", "confidence", "subjectRole"]
      }
    }
  },
  required: ["faces"]
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
      body: JSON.stringify(buildOpenAiPayload(imageDataUrl))
    });

    const responseText = await response.text();
    if (!response.ok) {
      return jsonResponse({ error: "OpenAI API error", detail: responseText.slice(0, 1000) }, response.status, corsHeaders);
    }

    const outputText = extractOutputText(JSON.parse(responseText));
    const parsed = JSON.parse(extractJson(outputText));
    return jsonResponse({ source: "SUPABASE_AI", faces: normalizeFaces(parsed.faces) }, 200, corsHeaders);
  } catch (error) {
    return jsonResponse({
      error: "AI face detection failed",
      detail: error instanceof Error ? error.message : String(error)
    }, 500, corsHeaders);
  }
});

function buildOpenAiPayload(imageDataUrl: string) {
  return {
    model: Deno.env.get("OPENAI_VISION_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Detect human faces in this image and return JSON only.",
              "Return bounding boxes as fractions of the image dimensions, where x/y are the top-left corner and width/height are box size.",
              "Only include visible human faces that are suitable for portrait retouching.",
              "Include side faces and partially shadowed faces if a retouching user would reasonably select them.",
              "Do not include pets, posters, drawings, objects, or background clutter.",
              "Use subjectRole primary for the dominant foreground face and secondary for other selectable faces.",
              "If there are no visible human faces, return an empty faces array.",
              "Be generous enough for selfies and close-up portraits; the box may include hairline, jaw, and ears."
            ].join("\n")
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high"
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "face_detection",
        strict: true,
        schema: FACE_SCHEMA
      }
    },
    max_output_tokens: 700
  };
}

function normalizeFaces(rawFaces: unknown) {
  if (!Array.isArray(rawFaces)) {
    return [];
  }

  return rawFaces
    .map((face): FaceBox => typeof face === "object" && face !== null ? face as FaceBox : {})
    .map((face) => ({
      x: clampNumber(face.x, 0, 1, 0),
      y: clampNumber(face.y, 0, 1, 0),
      width: clampNumber(face.width, 0, 1, 0),
      height: clampNumber(face.height, 0, 1, 0),
      confidence: clampNumber(face.confidence, 0, 1, 0.6),
      subjectRole: face.subjectRole === "primary" ? "primary" : "secondary"
    }))
    .filter((face) => {
      const area = face.width * face.height;
      return face.width > 0.02 && face.height > 0.02 && area > 0.001;
    })
    .sort((a, b) => {
      if (a.subjectRole !== b.subjectRole) {
        return a.subjectRole === "primary" ? -1 : 1;
      }
      return (b.width * b.height) - (a.width * a.height);
    })
    .slice(0, 12);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function numberSchema(minimum: number, maximum: number) {
  return { type: "number", minimum, maximum };
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
