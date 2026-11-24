async function generateWithCloudflare(prompt, accountId, apiToken) {
  const models = [
    "@cf/black-forest-labs/flux-1-schnell",
    "@cf/bytedance/stable-diffusion-xl-lightning",
    "@cf/stabilityai/stable-diffusion-xl-base-1.0"
  ];

  let lastErr = "Cloudflare AI server busy hai.";

  for (const model of models) {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt })
      }
    );

    const ct = (resp.headers.get("content-type") || "").toLowerCase();

    if (resp.ok && ct.startsWith("image/")) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return `data:${ct.split(";")[0]};base64,${buf.toString("base64")}`;
    }

    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.result?.image) {
      const b64 = data.result.image;
      const mime = b64.startsWith("iVBOR") ? "image/png" : "image/jpeg";
      return `data:${mime};base64,${b64}`;
    }

    lastErr =
      data?.errors?.[0]?.message ||
      data?.error ||
      `Cloudflare Error (${resp.status})`;

    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        "CF_ACCOUNT_ID ya CF_API_TOKEN galat hai — Cloudflare Workers AI token check karo."
      );
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

    const accountId = (process.env.CF_ACCOUNT_ID || "").trim();
    const apiToken = (process.env.CF_API_TOKEN || "").trim();

    if (!accountId || !apiToken) {
      return res.status(500).json({
        error: "Vercel Environment Variables mein CF_ACCOUNT_ID aur CF_API_TOKEN add karo."
      });
    }

    const imageUrl = await generateWithCloudflare(prompt, accountId, apiToken);
    return res.status(200).json({ imageUrl });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Image generate nahi ho payi."
    });
  }
};
