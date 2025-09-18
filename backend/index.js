/**
 * Simple Express backend for Article Drafting MVP.
 * - In-memory store (Map)
 * - Optional OpenAI integration via OPENAI_API_KEY (env)
 *
 * Run:
 *   cd server
 *   npm install
 *   OPENAI_API_KEY=yourkey node index.js
 *
 * If no OPENAI_API_KEY, fallback heuristics will be used.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

const PORT = process.env.PORT || 4000;
const OPENAI_KEY = process.env.OPENAI_API_KEY || null;
const PROJECTS = new Map();

/* ---------------- Utilities ---------------- */

function stripHtml(html) {
  if (!html) return '';
  // remove scripts/styles and tags
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUrlText(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (ct.includes('text/html')) {
      return stripHtml(text).slice(0, 200000); // limit length
    }
    return text.slice(0, 200000);
  } catch (e) {
    console.warn('fetchUrlText error', e.message);
    return '';
  }
}

function splitParagraphs(markdown) {
  // split on double newline
  return markdown.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

function findSourceMatchesForText(text, sources) {
  // naive substring search: return matches with snippet
  const lowered = text.toLowerCase();
  const matches = [];
  for (const s of sources) {
    if (!s.text) continue;
    const i = s.text.toLowerCase().indexOf(lowered);
    if (i !== -1) {
      const start = Math.max(0, i - 60);
      const end = Math.min(s.text.length, i + text.length + 60);
      const snippet = (start > 0 ? '...' : '') + s.text.slice(start, end).trim().replace(/\s+/g, ' ') + (end < s.text.length ? '...' : '');
      matches.push({ sourceId: s.id, snippet });
    } else {
      // try checking if any sentence in text appears in source
      const sentences = text.split(/[.?!]\s+/).map(s => s.trim()).filter(Boolean);
      for (const sent of sentences) {
        if (sent.length < 30) continue;
        const ii = s.text.toLowerCase().indexOf(sent.toLowerCase());
        if (ii !== -1) {
          const start = Math.max(0, ii - 60);
          const end = Math.min(s.text.length, ii + sent.length + 60);
          const snippet = (start > 0 ? '...' : '') + s.text.slice(start, end).trim().replace(/\s+/g, ' ') + (end < s.text.length ? '...' : '');
          matches.push({ sourceId: s.id, snippet });
          break;
        }
      }
    }
  }
  return matches;
}

function detectQuotes(markdown) {
  const quotes = [];
  // match double quotes
  const re = /"([^"]{8,500}?)"/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    quotes.push(m[1].trim());
  }
  // also simple blockquotes lines starting with >
  const lines = markdown.split('\n').map(l => l.trim());
  let block = [];
  for (const line of lines) {
    if (line.startsWith('>')) {
      block.push(line.replace(/^>\s?/, ''));
    } else {
      if (block.length) {
        const joined = block.join(' ');
        if (joined.length >= 8) quotes.push(joined.trim());
        block = [];
      }
    }
  }
  if (block.length) {
    const joined = block.join(' ');
    if (joined.length >= 8) quotes.push(joined.trim());
  }
  return Array.from(new Set(quotes)); // unique
}

/* ----------------- LLM Integration ----------------- */

async function callOpenAIChat(messages, maxTokens = 800) {
  if (!OPENAI_KEY) throw new Error('No OPENAI_API_KEY');
  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: 'gpt-3.5-turbo',
    messages,
    max_tokens: maxTokens,
    temperature: 0.6
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify(body),
    timeout: 20000
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  return content;
}

/* fallback extract */
function fallbackExtractKeypoints(transcript, n = 8) {
  const sentences = transcript.split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
  // take long sentences with common 'keyword' heuristics
  const scored = sentences.map(s => {
    const score = s.length * (/(product|launch|company|founder|ai|model|launch|customers|problem|solution)/i.test(s) ? 2 : 1);
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((x, idx) => ({ id: `kp-${idx+1}`, text: x.s.slice(0, 300) }));
}

/* ----------------- Routes ----------------- */

app.post('/api/projects', (req, res) => {
  const id = uuidv4();
  const project = { id, title: req.body.title || `Project ${id.slice(0,6)}`, transcript: '', sources: [], candidateKeypoints: [], approvedKeypoints: [], direction: {}, draft: null, quoteMatches: [] };
  PROJECTS.set(id, project);
  res.json(project);
});

app.post('/api/projects/:id/transcript', (req, res) => {
  const p = PROJECTS.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.transcript = req.body.transcript || '';
  res.json({ ok: true });
});

app.post('/api/projects/:id/sources', async (req, res) => {
  const p = PROJECTS.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { url, text, title } = req.body;
  let content = text || '';
  if (url && !text) {
    content = await fetchUrlText(url);
  }
  const sid = uuidv4();
  const s = { id: sid, url, title: title || url || `source-${sid.slice(0,6)}`, text: content };
  p.sources.push(s);
  res.json(s);
});

app.post('/api/projects/:id/extract-keypoints', async (req, res) => {
  const p = PROJECTS.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const transcript = p.transcript || req.body.transcript || '';
  if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

  // If OpenAI key is available, ask it for 8 concise bullet keypoints
  try {
    if (OPENAI_KEY) {
      const prompt = [
        { role: 'system', content: 'You extract concise, distinct key points (6-12 bullets) from an interview transcript. Keep each bullet short (1-2 sentences).' },
        { role: 'user', content: `Transcript:\n\n${transcript}\n\nReturn the result as JSON array of strings only.` }
      ];
      const content = await callOpenAIChat(prompt, 600);
      // try parse JSON; if not, fallback to line splitting
      let arr = null;
      try { arr = JSON.parse(content); } catch (e) {
        // fallback parse lines
        arr = content.split(/\n/).map(l => l.replace(/^[\-\*\d\.\)\s]+/, '').trim()).filter(Boolean);
      }
      const kps = arr.slice(0,12).map((t, i) => ({ id: `kp-${i+1}`, text: t }));
      p.candidateKeypoints = kps;
      return res.json({ candidateKeypoints: kps });
    } else {
      // fallback
      const kps = fallbackExtractKeypoints(transcript, 8);
      p.candidateKeypoints = kps;
      return res.json({ candidateKeypoints: kps, simulated: true });
    }
  } catch (err) {
    console.error('extract-keypoints error', err.message);
    // fallback
    const kps = fallbackExtractKeypoints(transcript, 8);
    p.candidateKeypoints = kps;
    return res.json({ candidateKeypoints: kps, simulated: true, warning: err.message });
  }
});

app.post('/api/projects/:id/approve-keypoints', (req, res) => {
  const p = PROJECTS.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const approved = req.body.approved || [];
  p.approvedKeypoints = approved.map((t, i) => ({ id: `ak-${i+1}`, text: t }));
  res.json({ ok: true, approved: p.approvedKeypoints });
});

app.post('/api/projects/:id/generate-draft', async (req, res) => {
  const p = PROJECTS.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const direction = req.body.direction || {};
  p.direction = direction;

  const approved = p.approvedKeypoints.map(k => k.text).join('\n\n');
  if (!approved) return res.status(400).json({ error: 'No approved keypoints' });

  const sourceSummaries = p.sources.map(s => `Source (${s.id}): ${s.title}\n${(s.text||'').slice(0,500)}\n`).join('\n\n');

  // Build prompt for the LLM
  const userPrompt = `You are an editorial assistant. Produce a story-driven draft article in Markdown. Use these approved key points as the backbone, preserve the editor's direction, and for any factual claim optionally indicate which source supports it in square brackets (e.g., [source-id]). Keep the article human-friendly, about ${direction.length || 'medium'} length, tone: ${direction.tone || 'neutral'}. Approved points:\n\n${approved}\n\nSources (short extracts):\n\n${sourceSummaries}\n\nReturn the article in Markdown. Make paragraphs logically separated. At the end, produce a JSON block labeled "PROVENANCE" mapping each paragraph index (starting 0) to an array of source ids that support it.`;

  try {
    let output = '';
    if (OPENAI_KEY) {
      const messages = [
        { role: 'system', content: 'You are a helpful editor that writes drafts from approved points.' },
        { role: 'user', content: userPrompt }
      ];
      output = await callOpenAIChat(messages, 1000);
    } else {
      // fallback draft: expand each approved point into a short paragraph
      const paras = p.approvedKeypoints.map((kp, idx) => `### ${idx+1}. ${kp.text}\n\n${kp.text} — expanded into a paragraph that explains and ties it to context. (SIMULATED)`);
      output = paras.join('\n\n');
    }

    // parse paragraphs
    const paragraphs = splitParagraphs(output);
    const paraObjs = paragraphs.map((t, i) => {
      const matches = findSourceMatchesForText(t, p.sources);
      return { index: i, text: t, sources: matches };
    });

    p.draft = { markdown: output, paragraphs: paraObjs };

    // simple quote-checking precompute
    const quotes = detectQuotes(output);
    const quoteMatches = quotes.map(q => {
      return { quoteText: q, matches: findSourceMatchesForText(q, p.sources) };
    });
    p.quoteMatches = quoteMatches;

    res.json({ draft: p.draft, quoteMatches: p.quoteMatches, simulated: !OPENAI_KEY });
  } catch (err) {
    console.error('generate-draft error', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/quote-check', (req, res) => {
  const p = PROJECTS.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!p.draft) return res.status(400).json({ error: 'No draft generated' });
  // return precomputed matches
  res.json({ quoteMatches: p.quoteMatches });
});

app.get('/api/projects/:id/export', (req, res) => {
  const p = PROJECTS.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const markdown = p.draft ? p.draft.markdown : '';
  const provenance = (p.draft && p.draft.paragraphs) ? p.draft.paragraphs.map(pg => ({ index: pg.index, sources: pg.sources })) : [];
  const out = {
    id: p.id,
    title: p.title,
    markdown,
    provenance
  };
  res.json(out);
});

/* health */
app.get('/', (req, res) => {
  res.send('Article Drafting MVP backend running.');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (OPENAI=${!!OPENAI_KEY})`);
});
