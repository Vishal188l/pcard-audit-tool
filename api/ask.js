// Turns a natural-language question into a read-only SQL query.
// The Gemini API key is read from an environment variable (set in the
// Vercel dashboard) — it is never present in this file or anywhere in
// the GitHub repository.

const SCHEMA = `
Table: pcards
Columns:
  Year INTEGER                 -- transaction year (2010-2014)
  Month INTEGER                -- transaction month (1-12)
  FullName TEXT                -- cardholder's full name
  AgencyName TEXT              -- always 'OKLAHOMA STATE UNIVERSITY' in this dataset
  CardholderLastName TEXT
  CardholderFirstInitial TEXT
  Description TEXT             -- free-text description entered by the cardholder
  Amount REAL                  -- transaction amount in USD (positive = charge, negative = credit/return)
  Vendor TEXT                  -- merchant name
  TransactionDate TEXT         -- format M/D/YYYY, stored as text
  PostedDate TEXT              -- format M/D/YYYY, stored as text
  MCC TEXT                     -- merchant category code description, e.g. 'PACKAGE STORES--BEER,WINE,AND LIQUOR'
`;

const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|CREATE|REPLACE|PRAGMA|VACUUM|TRIGGER)\b/i;
const GEMINI_MODEL = "gemini-3.6-flash";

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
  const question = (body && body.question || "").toString().trim();
  if (!question) {
    res.status(400).json({ error: "Missing question." });
    return;
  }

  const prompt = `You are a SQLite expert helping a university internal auditor. Given the table schema below and a question in plain English, write ONE single read-only SQLite query (SELECT or WITH ... SELECT only) that answers it.

${SCHEMA}

Rules:
- Output ONLY the SQL query, no explanation, no markdown fences, no trailing semicolon.
- Use only SELECT or WITH ... SELECT. Never write INSERT, UPDATE, DELETE, DROP, ALTER, PRAGMA, or any statement that changes data.
- If the question doesn't mention a year, don't filter by year.
- Amounts are in USD; positive values are charges, negative are credits/returns.
- Keep the query reasonably simple and make sure column names match the schema exactly.

Question: ${question}`;

  try {
    const sql = await callGemini(apiKey, prompt, 512);
    const cleaned = sql.replace(/```sql/gi, "").replace(/```/g, "").trim().replace(/;+\s*$/, "");

    if (!/^(SELECT|WITH)\b/i.test(cleaned) || FORBIDDEN_SQL.test(cleaned)) {
      res.status(422).json({ error: "The generated query wasn't a safe read-only SELECT. Try rephrasing your question." });
      return;
    }

    res.status(200).json({ sql: cleaned, model: GEMINI_MODEL });
  } catch (err) {
    res.status(502).json({ error: "Couldn't reach the AI model: " + err.message });
  }
};

async function callGemini(apiKey, promptText, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 },
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
