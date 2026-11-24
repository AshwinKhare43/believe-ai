const SUPPORTED_PROVIDERS = [
  "hf-inference",
  "nscale",
  "fal-ai",
  "together",
  "nebius",
  "replicate"
];

let cachedCandidates = null;
let cacheTime = 0;

function extractCandidates(models) {
  const seen = new Set();
  const list = [];

  for (const m of models || []) {
    const mapping = m.inferenceProviderMapping;
    if (!mapping) continue;

    const entries = Array.isArray(mapping)
      ? mapping.map((item) => [item.provider, item])
      : Object.entries(mapping);

    for (const [provider, info] of entries) {
      if (!info || !SUPPORTED_PROVIDERS.includes(provider)) continue;
      if (info.status && info.status !== "live") continue;
      if (info.task && info.task !== "text-to-image") continue;

      const providerId = info.providerId || m.id || m.modelId;
      if (!providerId) continue;

      const key = `${provider}::${providerId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      list.push({
        provider,
        providerId,
        rank: SUPPORTED_PROVIDERS.indexOf(provider)
      });
    }
  }

  return list.sort((a, b) => a.rank - b.rank);
}

async function getLiveCandidates(hfToken) {
  const now = Date.now();
  if (cachedCandidates && now - cacheTime < 10 * 60 * 1000) {
    return cachedCandidates;
  }

  const fallback = [
    { provider: "fal-ai", providerId: "fal-ai/flux/schnell" },
    { provider: "together", providerId: "black-forest-labs/FLUX.1-schnell" },
    { provider: "nebius", providerId: "black-forest-labs/flux-schnell" },
    { provider: "nscale", providerId: "black-forest-labs/FLUX.1-schnell" },
    { provider: "replicate", providerId: "black-forest-labs/flux-schnell" }
  ];

  try {
    const res = await fetch(
      "https://huggingface.co/api/models?pipeline_tag=text-to-image&inference_provider=all&expand[]=inferenceProviderMapping&sort=trendingScore&direction=-1&limit=15",
      {
        headers: { Authorization: `Bearer ${hfToken}` }
      }
    );
    if (res.ok) {
      const models = await res.json();
      const live = extractCandidates(models);
      if (live.length > 0) {
        cachedCandidates = live.slice(0, 8);
        cacheTime = now;
        return cachedCandidates;
      }
    }
  } catch (_) {}

  return fallback;
}

async function urlToDataUri(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return url;
    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch (_) {
    return url;
  }
}

async function callProvider(candidate, prompt, hfToken) {
  const { provider, providerId } = candidate;
  const headers = {
    Authorization: `Bearer ${hfToken}`,
    "Content-Type": "application/json"
  };

  if (provider === "hf-inference") {
    const resp = await fetch(
      `https://router.huggingface.co/hf-inference/models/${providerId}`,
      {
        method: "POST",
        headers: { ...headers, Accept: "image/jpeg" },
        body: JSON.stringify({ inputs: prompt })
      }
    );
    const ct = resp.headers.get("content-type") || "";
    if (resp.ok && ct.startsWith("image/")) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return `data:${ct.split(";")[0]};base64,${buf.toString("base64")}`;
    }
    const err = await resp.text().catch(() => `HTTP ${resp.status}`);
    throw Object.assign(new Error(err), { status: resp.status });
  }

  if (provider === "fal-ai") {
    const resp = await fetch(
      `https://router.huggingface.co/fal-ai/${providerId}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt })
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      const imgUrl = data?.images?.[0]?.url || data?.image?.url;
      if (imgUrl) return await urlToDataUri(imgUrl);
    }
    throw Object.assign(new Error(data?.error || data?.detail || `HTTP ${resp.status}`), {
      status: resp.status
    });
  }

  if (provider === "replicate") {
    const resp = await fetch(
      `https://router.huggingface.co/replicate/v1/models/${providerId}/predictions`,
      {
        method: "POST",
        headers: { ...headers, Prefer: "wait" },
        body: JSON.stringify({ input: { prompt } })
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      const out = Array.isArray(data?.output) ? data.output[0] : data?.output;
      if (typeof out === "string") return await urlToDataUri(out);
    }
    throw Object.assign(new Error(data?.detail || data?.error || `HTTP ${resp.status}`), {
      status: resp.status
    });
  }

  // OpenAI-compatible HF providers: nscale, together, nebius
  const resp = await fetch(
    `https://router.huggingface.co/${provider}/v1/images/generations`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: providerId,
        prompt,
        response_format: "b64_json"
      })
    }
  );
  const data = await resp.json().catch(() => ({}));
  if (resp.ok) {
    const first = data?.data?.[0];
    if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
    if (first?.url) return await urlToDataUri(first.url);
  }
  throw Object.assign(
    new Error(data?.error?.message || data?.error || `HTTP ${resp.status}`),
    { status: resp.status }
  );
}

async function generateWithHuggingFace(prompt, hfToken) {
  const candidates = await getLiveCandidates(hfToken);
  let lastErr = "Hugging Face server abhi busy hai.";

  for (const cand of candidates) {
    try {
      return await callProvider(cand, prompt, hfToken);
    } catch (err) {
      lastErr = `[${cand.provider}] ${err.message}`;
      if (err.status === 401 || err.status === 403) {
        throw new Error(
          "HF_TOKEN permission error: Hugging Face token settings mein 'Make calls to Inference Providers' enable karo."
        );
      }
      if (err.status === 402) {
        throw new Error("Hugging Face monthly free image credits khatam ho gaye hain.");
      }
    }
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
      try {
        const imageUrl = await generateWithHuggingFace(prompt, hfToken);
        return res.status(200).json({ imageUrl });
      } catch (hfErr) {
        if (geminiKey) {
          try {
            const imageUrl = await generateWithGemini(prompt, geminiKey);
            return res.status(200).json({ imageUrl });
          } catch (_) {}
        }
        return res.status(503).json({ error: hfErr.message });
      }
    }

    if (geminiKey) {
      const imageUrl = await generateWithGemini(prompt, geminiKey);
      return res.status(200).json({ imageUrl });
    }

    return res.status(500).json({ error: "HF_TOKEN missing in Vercel." });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Image generate nahi ho payi." });
  }
};
