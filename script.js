// ============ Config ============
const DB_GZ_PATH = "data/pcards.db.gz";
const YEARS = [2014, 2013, 2012, 2011, 2010];
const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|CREATE|REPLACE|PRAGMA|VACUUM|TRIGGER)\b/i;

let db = null;
const dbStatusEl = document.getElementById("db-status");

// ============ Load the database (gzip-compressed, decompressed in-browser) ============
async function loadDatabase() {
  try {
    const res = await fetch(DB_GZ_PATH);
    if (!res.ok) throw new Error(`Could not fetch database file (${res.status})`);

    let bytes;
    if (typeof DecompressionStream !== "undefined") {
      const ds = new DecompressionStream("gzip");
      const decompressedStream = res.body.pipeThrough(ds);
      const buf = await new Response(decompressedStream).arrayBuffer();
      bytes = new Uint8Array(buf);
    } else {
      throw new Error("This browser can't decompress the database. Use a recent Chrome, Edge, Firefox or Safari.");
    }

    const SQL = await initSqlJs({ locateFile: (f) => f });
    db = new SQL.Database(bytes);

    dbStatusEl.textContent = "Data loaded — ready";
    dbStatusEl.classList.add("ready");
    populateYears();
  } catch (err) {
    dbStatusEl.textContent = "Failed to load data";
    dbStatusEl.classList.add("error");
    console.error(err);
    alert("Couldn't load the transaction database: " + err.message);
  }
}
loadDatabase();

function populateYears() {
  const sel = document.getElementById("year-select");
  sel.innerHTML = YEARS.map((y) => `<option value="${y}">${y}</option>`).join("");
}

// ============ Tabs ============
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
  });
});

// ============ Shared: run a read-only query locally ============
function runReadonlyQuery(sql) {
  if (!db) throw new Error("Database isn't loaded yet.");
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error("Only SELECT queries are allowed.");
  }
  if (FORBIDDEN_SQL.test(trimmed)) {
    throw new Error("That query isn't allowed — only read-only SELECT statements can run.");
  }
  const results = db.exec(trimmed + " LIMIT 500");
  if (!results.length) return { columns: [], rows: [] };
  return { columns: results[0].columns, rows: results[0].values };
}

function runParamQuery(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  let columns = [];
  while (stmt.step()) {
    columns = stmt.getColumnNames();
    rows.push(Object.values(stmt.get()));
  }
  stmt.free();
  return { columns, rows };
}

function renderTable(tableEl, columns, rows) {
  if (!rows.length) {
    tableEl.innerHTML = "<tr><td>No matching transactions.</td></tr>";
    return;
  }
  const thead = `<thead><tr>${columns.map((c) => `<th>${c}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell === null ? "" : String(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  tableEl.innerHTML = thead + tbody;
}

// ============ Ask a Question tab ============
const askForm = document.getElementById("ask-form");
const questionEl = document.getElementById("question");
const askSubmit = document.getElementById("ask-submit");
const askStatus = document.getElementById("ask-status");
const askResult = document.getElementById("ask-result");
const answerText = document.getElementById("answer-text");
const sqlText = document.getElementById("sql-text");
const askTable = document.getElementById("ask-table");
const askRowNote = document.getElementById("ask-row-note");

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    questionEl.value = chip.dataset.example;
    questionEl.focus();
  });
});

askForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = questionEl.value.trim();
  if (!question) return;
  if (!db) {
    alert("Data is still loading, try again in a moment.");
    return;
  }

  askSubmit.disabled = true;
  askStatus.hidden = false;
  askStatus.className = "status";
  askStatus.textContent = "Turning your question into a query…";
  askResult.hidden = true;

  try {
    // Step 1: ask the backend to turn the question into SQL (API key stays server-side)
    const askRes = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const askData = await askRes.json();
    if (!askRes.ok) throw new Error(askData.error || "Couldn't generate a query for that question.");

    askStatus.textContent = "Running the query against the data…";
    const { columns, rows } = runReadonlyQuery(askData.sql);

    askStatus.textContent = "Summarizing the results…";
    const sumRes = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        columns,
        rows: rows.slice(0, 40),
        rowCount: rows.length,
      }),
    });
    const sumData = await sumRes.json();
    if (!sumRes.ok) throw new Error(sumData.error || "Couldn't summarize the results.");

    answerText.textContent = sumData.summary;
    sqlText.textContent = askData.sql;
    renderTable(askTable, columns, rows);
    askRowNote.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} returned${rows.length === 500 ? " (showing first 500)" : ""}`;

    askStatus.hidden = true;
    askResult.hidden = false;
  } catch (err) {
    askStatus.className = "status error";
    askStatus.textContent = err.message;
  } finally {
    askSubmit.disabled = false;
  }
});

// ============ Dashboard tab ============
const yearSelect = document.getElementById("year-select");
const descKeyword = document.getElementById("desc-keyword");
const vendorKeyword = document.getElementById("vendor-keyword");
const descBtn = document.getElementById("desc-search-btn");
const vendorBtn = document.getElementById("vendor-search-btn");
const dashStatus = document.getElementById("dash-status");
const dashResult = document.getElementById("dash-result");
const dashTable = document.getElementById("dash-table");
const dashRowNote = document.getElementById("dash-row-note");

function runSearch(field, keyword) {
  if (!db) {
    dashStatus.hidden = false;
    dashStatus.className = "status error";
    dashStatus.textContent = "Data is still loading, try again in a moment.";
    return;
  }
  if (!keyword.trim()) {
    dashStatus.hidden = false;
    dashStatus.className = "status error";
    dashStatus.textContent = "Enter a keyword first.";
    return;
  }
  dashStatus.hidden = false;
  dashStatus.className = "status";
  dashStatus.textContent = "Searching…";
  dashResult.hidden = true;

  try {
    const column = field === "description" ? "Description" : "Vendor";
    const year = Number(yearSelect.value);
    const sql = `SELECT FullName, Vendor, TransactionDate, Amount, Description, MCC
                 FROM pcards
                 WHERE Year = ? AND UPPER(${column}) LIKE ?
                 ORDER BY TransactionDate ASC
                 LIMIT 500`;
    const { columns, rows } = runParamQuery(sql, [year, `%${keyword.trim().toUpperCase()}%`]);

    renderTable(dashTable, columns, rows);
    dashRowNote.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} matched in ${year}${rows.length === 500 ? " (showing first 500)" : ""}`;
    dashStatus.hidden = true;
    dashResult.hidden = false;
  } catch (err) {
    dashStatus.className = "status error";
    dashStatus.textContent = err.message;
  }
}

descBtn.addEventListener("click", () => runSearch("description", descKeyword.value));
vendorBtn.addEventListener("click", () => runSearch("vendor", vendorKeyword.value));
descKeyword.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch("description", descKeyword.value); });
vendorKeyword.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch("vendor", vendorKeyword.value); });
