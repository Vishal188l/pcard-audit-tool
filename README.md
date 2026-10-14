# OSU P-Card Audit Tool

Part IV of the Analytics Mindset P-Card case: a two-tab website for auditors —
ask questions about the P-card data in plain English, and search for
prohibited-purchase transactions on a dashboard.

## How it's built

- **Frontend** (`index.html`, `style.css`, `script.js`): a static page. The
  entire P-card database (`data/pcards.db.gz`, gzip-compressed) is downloaded
  once and read directly in your browser using `sql.js` (SQLite compiled to
  WebAssembly) — the dashboard searches never leave your browser.
- **Backend** (`api/ask.js`, `api/summarize.js`): two small serverless
  functions, deployed on Vercel, used only by the "Ask a Question" tab. They
  call Google's Gemini API to (1) turn your question into a SQL query and
  (2) turn the query results into a plain-English sentence.

**Why a backend at all, if the data is in the browser?** Because calling
Gemini needs an API key, and an API key typed into browser JavaScript can be
read by anyone who opens developer tools. Putting the two small Gemini calls
behind a serverless function keeps the key server-side, as a secret
environment variable on Vercel — it is never in this repo and never visible
to a site visitor.

## Deploying it yourself (step by step)

### 1. Get a free Gemini API key

Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign
in with a Google account, and click "Create API key". Copy it somewhere safe
— you'll paste it into Vercel in step 4, never into a file here.

### 2. Push this folder to a new GitHub repository

Create a new **public** repo (e.g. `pcard-audit-tool`), then from this
folder:

```bash
git init
git add .
git commit -m "P-Card audit tool"
git branch -M main
git remote add origin https://github.com/<your-username>/pcard-audit-tool.git
git push -u origin main
```

The `.gitignore` already excludes anything that could hold a real key, so
nothing you push will contain it.

### 3. Create a Vercel account and import the repo

1. Go to [vercel.com](https://vercel.com) and sign up with your GitHub
   account (free).
2. Click **Add New → Project**, and pick the repo you just pushed.
3. Leave the build settings as-is (no framework needed) and click **Deploy**.

### 4. Add your API key as a secret environment variable

1. In the Vercel project, go to **Settings → Environment Variables**.
2. Add one: Key = `GEMINI_API_KEY`, Value = the key from step 1. Leave it
   set for all environments.
3. Go to **Deployments**, open the latest one, and click **Redeploy** so the
   function picks up the new variable.

### 5. You're done

Vercel gives you a live URL (something like
`https://pcard-audit-tool.vercel.app`). That's the link to submit, along
with the GitHub repo link. Open it and try both tabs.

## Submission checklist

- [ ] Completed Word document (Parts II and III)
- [ ] Live website link (your `*.vercel.app` URL)
- [ ] GitHub repository link (public)
- [ ] API key is **only** in Vercel's Environment Variables — never
      committed to GitHub

## Local testing (optional)

The dashboard tab (no AI involved) works from any static file server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. The "Ask a Question" tab will show an
error locally because `/api/ask` only exists once deployed to Vercel — to
test it locally too, install the Vercel CLI (`npm i -g vercel`), run
`vercel dev`, and create a local `.env.local` file with your key (never
commit that file — it's already in `.gitignore`).
