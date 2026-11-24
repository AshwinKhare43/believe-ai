async function generateWithHuggingFace(prompt, hfToken) {
  const models = [
    "black-forest-labs/FLUX.1-schnell",
    "stabilityai/stable-diffusion-xl-base-1.0"
  ];

  let lastErr = "Hugging Face server busy hai.";
  for (const model of models) {
    const resp = await fetch(
      `https://router.huggingface.co/hf-inference/models/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfToken}`,
          "Content-Type": "application/json",
          Accept: "image/jpeg"
        },
        body: JSON.stringify({ inputs: prompt })
      }
    );

    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.startsWith("image/")) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return `data:${ct.split(";")[0]};base64,${buf.toString("base64")}`;
    }

    const errText = await resp.text().catch(() => "");
    try {
      const parsed = JSON.parse(errText);
      lastErr = parsed.error || errText || lastErr;
    } catch (_) {
      lastErr = errText || `HF Error ${resp.status}`;
    }
    if (resp.status === 401 || resp.status === 403) break;
  }
  throw new Error(lastErr);
}

async function generateWithGemini(prompt, apiKey) {
  const listRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
  );
  const listData = await listRes.json().catch(() => ({}));
  const all = listData.models || [];

  const geminiImageModels = all
    .filter(
      (m) =>
        /image/i.test(m.name) &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent")
    )
    .map((m) => m.name.replace(/^models\//, ""))
    .reverse();

  const imagenModels = all
    .filter(
      (m) =>
        /imagen/i.test(m.name) &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("predict")
    )
    .map((m) => m.name.replace(/^models\//, ""))
    .reverse();

  let lastErr = "Gemini free tier par image model available nahi hai.";

  for (const modelId of geminiImageModels.slice(0, 3)) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `Generate an image: ${prompt}` }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        })
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
      if (imgPart) {
        const inline = imgPart.inlineData || imgPart.inline_data;
        const mime = inline.mimeType || inline.mime_type || "image/png";
        return `data:${mime};base64,${inline.data}`;
      }
    } else {
      lastErr = data?.error?.message || lastErr;
    }
  }

  for (const modelId of imagenModels.slice(0, 2)) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:predict?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1 }
        })
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.predictions?.[0]?.bytesBase64Encoded) {
      const mime = data.predictions[0].mimeType || "image/png";
      return `data:${mime};base64,${data.predictions[0].bytesBase64Encoded}`;
    } else if (!resp.ok) {
      lastErr = data?.error?.message || lastErr;
    }
  }

  throw new Error(lastErr);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ error: "Prompt khali hai." });
    }

    const hfToken = process.env.HF_TOKEN;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (hfToken) {
      const imageUrl = await generateWithHuggingFace(prompt, hfToken);
      return res.status(200).json({ imageUrl });
    }

    if (geminiKey) {
      try {
        const imageUrl = await generateWithGemini(prompt, geminiKey);
        return res.status(200).json({ imageUrl });
      } catch (gemErr) {
        return res.status(503).json({
          error: `Gemini image unavailable (${gemErr.message}). Free watermark-free HD images ke liye Vercel mein HF_TOKEN add karo.`
        });
      }
    }

    return res.status(500).json({
      error: "Vercel Environment Variables mein HF_TOKEN add karo."
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Image generate nahi ho payi." });
  }
};
