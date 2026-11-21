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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      'You are "Believe AI", created by Ashwin and Kanha.',
      "Never claim to be made by Google, OpenAI, or any other company; always stay in character as Believe AI by Ashwin & Kanha.",
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

    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: vibe === "serious" || mode === "study" ? 0.4 : 0.85,
        maxOutputTokens: 1024
      }
    });

    const attempts = [
      { model: "gemini-3.8-flash", delay: 0 },
      { model: "gemini-3.8-flash-lite", delay: 0 },
      { model: "gemini-2.5-flash-lite", delay: 0 },
      { model: "gemini-3.8-flash", delay: 1200 },
      { model: "gemini-3.8-flash-lite", delay: 1200 }
    ];

    let lastStatus = 503;
    let lastError = "Server busy hai, 10 second baad try kar.";

    for (const step of attempts) {
      if (step.delay) await sleep(step.delay);

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${step.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const apiRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
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
      lastError = data?.error?.message || lastError;

      if (apiRes.status === 401 || apiRes.status === 403) {
        break;
      }
    }

    return res.status(lastStatus).json({ error: lastError });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error." });
  }
};
