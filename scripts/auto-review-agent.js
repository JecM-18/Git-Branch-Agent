#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const REPOS = ['rrp', 'contractdb'];
const CACHE_FILE = path.join(__dirname, '..', '.pr-review-cache.json');
const AGENT_BRAIN_FILE = path.join(__dirname, '..', 'AGENT-AUTO-REVIEW-PR.md');

// Max entries to keep in cache (prevent unbounded growth)
const MAX_CACHE_ENTRIES = 200;

// ─── Output helpers ───────────────────────────────────────────────────────────
function emit(type, data) {
  console.log(JSON.stringify({ type, ...data }));
}

// ─── Env validation ───────────────────────────────────────────────────────────
function validateEnv() {
  const required = ['GITHUB_PAT', 'GITHUB_ORG', 'GITHUB_USERNAME'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error('Missing env vars: ' + missing.join(', ') + '. Add them to .env or Settings.');
  }
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────
function ghHeaders() {
  return {
    Authorization: 'Bearer ' + process.env.GITHUB_PAT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function fetchAssignedPRs(repo) {
  const org = process.env.GITHUB_ORG;
  const username = process.env.GITHUB_USERNAME.toLowerCase();

  const { data } = await axios.get(
    'https://api.github.com/repos/' + org + '/' + repo + '/pulls',
    {
      headers: ghHeaders(),
      params: { state: 'open', per_page: 50 },
    }
  );

  return data.filter((pr) =>
    pr.requested_reviewers.some((r) => r.login.toLowerCase() === username)
  );
}

async function fetchPRFiles(repo, prNumber) {
  const org = process.env.GITHUB_ORG;
  const { data } = await axios.get(
    'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber + '/files',
    { headers: ghHeaders() }
  );
  return data.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch || '',
  }));
}

// ─── Review cache ─────────────────────────────────────────────────────────────
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch { /* corrupt cache — start fresh */ }
  return { reviewed: {} };
}

function saveCache(cache) {
  // Trim oldest entries if cache grows too large
  const keys = Object.keys(cache.reviewed);
  if (keys.length > MAX_CACHE_ENTRIES) {
    const sorted = keys.sort((a, b) =>
      new Date(cache.reviewed[a].reviewedAt) - new Date(cache.reviewed[b].reviewedAt)
    );
    sorted.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach((k) => delete cache.reviewed[k]);
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function cacheKey(repo, prNumber, headSHA) {
  return repo + '_' + prNumber + '_' + headSHA.slice(0, 7);
}

// ─── AI helpers ───────────────────────────────────────────────────────────────
function loadAgentBrain() {
  if (fs.existsSync(AGENT_BRAIN_FILE)) {
    return fs.readFileSync(AGENT_BRAIN_FILE, 'utf8');
  }
  // Minimal fallback if the md file is missing
  return 'You are an expert code reviewer. Review the PR and respond ONLY with JSON: {"decision":"NEEDS_HUMAN","risk":"COMPLEX","summary":"","issues":[],"approvalReason":""}';
}

// Uses GITHUB_PAT with GitHub Copilot (Models API) — no separate AI key needed
async function callAI(systemPrompt, userPrompt) {
  const token = process.env.GITHUB_PAT;
  const model = process.env.AI_MODEL || 'gpt-4o';

  const { data } = await axios.post(
    'https://models.inference.ai.azure.com/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    },
    {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    }
  );
  return data.choices[0].message.content;
}

// ─── Review prompt builder ────────────────────────────────────────────────────
function buildReviewPrompt(pr, repo, files) {
  const reviewable = files
    .filter((f) => f.patch)
    .filter((f) => !/(package-lock|yarn\.lock|pnpm-lock)\.json$/i.test(f.filename));

  // Cap total lines sent to AI to stay within token limits
  const MAX_LINES_PER_FILE = 80;
  const MAX_FILES = 15;

  const fileDiffs = reviewable.slice(0, MAX_FILES).map((f) => {
    const statusIcon = f.status === 'added' ? '[NEW]' : f.status === 'removed' ? '[DEL]' : '[MOD]';
    const lines = f.patch.split('\n');
    const truncated = lines.length > MAX_LINES_PER_FILE
      ? lines.slice(0, MAX_LINES_PER_FILE).join('\n') + '\n[... ' + (lines.length - MAX_LINES_PER_FILE) + ' more lines omitted]'
      : f.patch;
    return '### ' + statusIcon + ' ' + f.filename + ' (+' + f.additions + '/-' + f.deletions + ')\n' + truncated;
  }).join('\n\n');

  const skippedCount = reviewable.length - Math.min(reviewable.length, MAX_FILES);

  return 'Repository: ' + repo + '\n' +
    'PR #' + pr.number + ': ' + pr.title + '\n' +
    'Author: ' + pr.user.login + '\n' +
    'Base branch: ' + pr.base.ref + '\n' +
    'Changed files: ' + pr.changed_files + ' total (+' + pr.additions + '/-' + pr.deletions + ')' +
    (skippedCount > 0 ? ' [' + skippedCount + ' files not shown]' : '') + '\n' +
    'Description:\n' + (pr.body || '(none)').slice(0, 500) + '\n\n' +
    'CHANGED FILES WITH DIFFS:\n' +
    (fileDiffs || '(no reviewable diffs available)') + '\n\n' +
    'Review this PR following your instructions. Respond ONLY with the JSON object.';
}

// ─── Parse AI response ────────────────────────────────────────────────────────
function parseAIResponse(raw) {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('no JSON object found');
    const parsed = JSON.parse(jsonMatch[0]);
    // Normalize and validate required fields
    return {
      decision: ['APPROVE', 'REQUEST_CHANGES', 'NEEDS_HUMAN'].includes(parsed.decision)
        ? parsed.decision
        : 'NEEDS_HUMAN',
      risk: ['LOW_RISK', 'COMPLEX'].includes(parsed.risk) ? parsed.risk : 'COMPLEX',
      summary: String(parsed.summary || ''),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      approvalReason: String(parsed.approvalReason || ''),
    };
  } catch (e) {
    return {
      decision: 'NEEDS_HUMAN',
      risk: 'COMPLEX',
      summary: 'AI response could not be parsed.',
      issues: ['AI returned non-JSON response: ' + e.message],
      approvalReason: 'Manual review required — AI response was malformed.',
    };
  }
}

// ─── Main review flow ─────────────────────────────────────────────────────────
async function reviewPR(pr, repo, systemPrompt) {
  const files = await fetchPRFiles(repo, pr.number);
  const prompt = buildReviewPrompt(pr, repo, files);
  const raw = await callAI(systemPrompt, prompt);
  const result = parseAIResponse(raw);

  return {
    prNumber: pr.number,
    repo,
    title: pr.title,
    url: pr.html_url,
    author: pr.user.login,
    headSHA: pr.head.sha,
    ...result,
  };
}

async function run() {
  validateEnv();

  const systemPrompt = loadAgentBrain();
  const cache = loadCache();
  let newReviews = 0;

  for (const repo of REPOS) {
    let prs;
    try {
      prs = await fetchAssignedPRs(repo);
    } catch (err) {
      const status = err.response && err.response.status;
      if (status === 404) continue; // repo may not exist — skip silently
      emit('error', { message: 'Failed to fetch PRs for ' + repo + ': ' + err.message });
      continue;
    }

    for (const pr of prs) {
      const key = cacheKey(repo, pr.number, pr.head.sha);
      if (cache.reviewed[key]) continue; // same commit already reviewed

      emit('log', { text: 'Reviewing PR #' + pr.number + ' [' + repo + ']: ' + pr.title });

      try {
        const result = await reviewPR(pr, repo, systemPrompt);
        cache.reviewed[key] = { ...result, reviewedAt: new Date().toISOString() };
        newReviews++;
        emit('review-result', result);
      } catch (err) {
        const status = err.response && err.response.status;
        const msg = status === 401 ? 'GitHub auth failed — check GITHUB_PAT'
          : status === 429 ? 'AI rate limit hit — will retry next cycle'
          : err.message;
        emit('error', { message: 'PR #' + pr.number + ' [' + repo + ']: ' + msg });
      }
    }
  }

  saveCache(cache);

  if (newReviews === 0) {
    emit('log', { text: 'No new PRs to review.' });
  }
}

run().catch((err) => {
  emit('error', { message: err.message });
  process.exit(0); // always exit 0 — agent errors are non-fatal for the parent
});
