const MODE_PROMPTS = {
  auto: "Adapt automatically to the user's question (gaming, study, tech, or roasting).",
  gaming: "Focus as an elite Gaming Buddy. Give sharp strategies, loadouts, and tips, with light banter if the user makes a noob play.",
  study: "Focus as a Study Helper. Switch to locked-in, clear, accurate, step-by-step explanations with zero distractions.",
  tech: "Focus as a sharp Tech Guru. Give logical, spec-accurate advice on smartphones, PCs, software, and troubleshooting.",
  roaster: "Focus as a witty, savage-yet-playful Roaster (keep it fun and safe, never genuinely hateful or cruel)."
};

const VIBE_PROMPTS = {
  balanced: "Mix sharp sarcasm with cool anime rival/protagonist energy, switching to serious focus whenever study or tech help is needed.",
  anime: "Channel cool anime rival/protagonist energy (dramatic one-liners, sharp confidence, high intensity).",
  sarcastic: "Be extra witty, dry, and playfully sarcastic while still giving useful answers.",
  serious: "Stay 100% dead-serious, focused, concise, and tactical. No jokes."
};

let cachedModels = null;

function scoreModel(id) {
  let s = 0;
  if (/flash-lite/i.test(id)) s += 55;
  else if (/flash/i.test(id)) s += 45;
  else if (/gemma-3/i.test(id)) s += 38;
  else if (/pro/i.test(id)) s += 25;
  else if (/gemma/i.test(id)) s += 20;

  if (/gemini-3/i.test(id)) s += 15;
  if (/exp|thinking/i.test(id)) s -= 10;
  if (/preview/i.test(id)) s -= 3;
  return s;
}

async function getAvailableModels(apiKey) {
  if (cachedModels && cachedModels.length > 0) return cachedModels;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
    );
    const data = await res.json();
    const blocked = /embedding|imagen|veo|tts|audio|image|robotics|computer-use|deep-research|aqa|vision|nano|learnlm|^gemini-1\.|^gemini-2\.0|^gemini-2\.5-flash$/i;

    const list = (data.models || [])
      .filter(
        (m) =>
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes("generateContent")
      )
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((id) => !blocked.test(id))
      .sort((a, b) => scoreModel(b) - scoreModel(a));

    if (list.length > 0) {
      cachedModels = list.slice(0, 5);
      return cachedModels;
    }
  } catch (_) {}
  return ["gemini-3.8-flash", "gemma-3-27b-it", "gemma-3-12b-it"];
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY missing." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { history = [], mode = "auto", vibe = "balanced" } = body;

    const systemPrompt = [
      'You are "Believe AI". If anyone asks who made you, clearly say that Ashwin coded and built you, while Kanha gave the idea.',
"Never claim to be made by Google, OpenAI, or any other company; always stay in character as Believe AI (coded by Ashwin, idea by Kanha).",
      "Reply in crisp, natural Hinglish (unless user writes purely in English or Hindi).",
      "Keep replies punchy, direct, and easy to read.",
      `Current Mode: ${MODE_PROMPTS[mode] || MODE_PROMPTS.auto}`,
      `Current Vibe: ${VIBE_PROMPTS[vibe] || VIBE_PROMPTS.balanced}`
    ].join("\n");

    const contents = [];
    for (const item of history.slice(-20)) {
      const role = item.role === "model" ? "model" : "user";
      const text = String(item.text || "").trim();
      if (!text) continue;
      if (contents.length === 0 && role !== "user") continue;
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += "\n" + text;
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }

    if (contents.length === 0) {
      return res.status(400).json({ error: "No valid user message found." });
    }

    const models = await getAvailableModels(apiKey);
    let lastStatus = 503;
    let lastError = "Sabhi models abhi busy hain, thodi der baad try kar.";

    for (const modelId of models) {
      const isGemma = /^gemma/i.test(modelId);
      const reqContents = isGemma
        ? contents.map((c, i) =>
            i === 0
              ? { role: c.role, parts: [{ text: `${systemPrompt}\n\nUser: ${c.parts[0].text}` }] }
              : c
          )
        : contents;

      const reqBody = {
        contents: reqContents,
        generationConfig: {
          temperature: vibe === "serious" || mode === "study" ? 0.4 : 0.85,
          maxOutputTokens: 1024
        }
      };
      if (!isGemma) {
        reqBody.system_instruction = { parts: [{ text: systemPrompt }] };
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const apiRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody)
      });

      const data = await apiRes.json().catch(() => ({}));

      if (apiRes.ok) {
        const reply = data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || "")
          .join("")
          .trim();
        return res.status(200).json({
          reply: reply || "Hmph... signal cut gaya. Dobara bol."
        });
      }

      lastStatus = apiRes.status;
      lastError = `[${modelId}] ${data?.error?.message || lastError}`;
      if (apiRes.status === 401 || apiRes.status === 403) break;
    }

    return res.status(lastStatus).json({ error: lastError });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error." });
  }
};
