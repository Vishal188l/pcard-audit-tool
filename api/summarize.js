// Turns a query's result rows into a short plain-English answer.
// The Gemini API key is read from an environment variable — never from
// this file or the repository.

const GEMINI_MODEL = "gemini-flash-latest";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Set it in the Vercel project's Environment Variables." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { question, columns, rows, rowCount } = body || {};
  if (!question || !Array.isArray(columns) || !Array.isArray(rows)) {
    res.status(400).json({ error: "Missing question, columns, or rows." });
    return;
  }

  const sample = rows
    .slice(0, 40)
    .map((r) => columns.map((c, i) => `${c}=${r[i]}`).join(", "))
    .join("\n");

  const prompt = `A university internal auditor asked: "${question}"

A query against the P-card transaction database returned ${rowCount} row(s). Here are up to 40 sample rows (columns: ${columns.join(", ")}):

${sample || "(no rows matched)"}

Write a short, direct answer (2-4 sentences, plain English, no markdown) that directly answers the question using these results. If the result set is empty, say so plainly. Don't restate the question, and don't make up any figures that aren't in the data shown.`;

  try {
    const summary = await callGemini(apiKey, prompt, 400);
    res.status(200).json({ summary: summary.trim() });
  } catch (err) {
    res.status(502).json({ error: "Couldn't reach the AI model: " + err.message });
  }
};

async function callGemini(apiKey, promptText, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error?.message || `Gemini API error (${resp.status})`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text.trim()) throw new Error("Empty response from model.");
  return text;
}
