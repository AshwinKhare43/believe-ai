async function generateWithHuggingFace(prompt, hfToken) {
  const models = [
    "black-forest-labs/FLUX.1-schnell",
    "stabilityai/stable-diffusion-xl-base-1.0"
  ];

  let lastErr = "Hugging Face server busy hai.";
  for (const model of models) {
    const resp = await fetch(
      `https://router.huggingface.co/hf-inference/models/${model}`, { method: "POST", headers: { Authorization: `Bearer ${hfToken}`,
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
      lastErr = errText || `HF Error ${resp.status}`; } if (resp.status === 401 \vert{}\vert{} resp.status === 403) break; } throw new Error(lastErr); }  async function generateWithGemini(prompt, apiKey) { const listRes = await fetch( `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
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
          contents: [{ role: "user", parts: [{ text: `Generate an image: ${prompt}` }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }) } ); const data = await resp.json().catch(() => ({})); if (resp.ok) { const parts = data?.candidates?.[0]?.content?.parts \vert{}\vert{} []; const imgPart = parts.find((p) => p.inlineData?.data \vert{}\vert{} p.inline_data?.data); if (imgPart) { const inline = imgPart.inlineData \vert{}\vert{} imgPart.inline_data; const mime = inline.mimeType \vert{}\vert{} inline.mime_type \vert{}\vert{} "image/png"; return `data:${mime};base64,${inline.data}`; } } else { lastErr = data?.error?.message \vert{}\vert{} lastErr; } }  for (const modelId of imagenModels.slice(0, 2)) { const resp = await fetch( `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:predict
