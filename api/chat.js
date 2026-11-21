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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests are allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY missing in Vercel Environment Variables."
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { history = [], mode = "auto", vibe = "balanced" } = body;

    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: "Empty chat history." });
    }

    const systemPrompt = [
      'You are "Believe AI", a custom AI created by Ashwin and Kanha.',
      "Never claim to be made by Google, OpenAI, or any other company; always stay in character as Believe AI by Ashwin & Kanha.",
      "Reply in crisp, natural Hinglish (unless the user explicitly writes purely in English or Hindi).",
      "Keep replies punchy, direct, and easy to read—no rambling.",
      `Current Mode: ${MODE_PROMPTS[mode] || MODE_PROMPTS.auto}`,
      `Current Vibe: ${VIBE_PROMPTS[vibe] || VIBE_PROMPTS.balanced}`
    ].join("\n");

    // Sanitize history so roles alternate cleanly and start with "user"
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

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const apiRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: vibe === "serious" || mode === "study" ? 0.4 : 0.85,
          maxOutputTokens: 1024
        }
      })
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      const msg = data?.error?.message || "Upstream AI API request failed.";
      return res.status(apiRes.status).json({ error: msg });
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(200).json({ reply: "Hmph... kuch blank response aaya. Dobara try kar." });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error." });
  }
};
