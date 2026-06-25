#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

// ─── Mappings ─────────────────────────────────────────────────────────────────
const PROJECT_REPO_MAP = {
  AINEX: 'rrp',
  AIPACT: 'contractdb',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function validateEnv() {
  const required = ['GITHUB_PAT', 'GITHUB_ORG'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error('Missing environment variables: ' + missing.join(', ') + '\nCopy .env.example to .env and fill in the values.');
  }
}

function validateAIEnv() {
  // AI is optional, but warn if not configured
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGitHub = !!process.env.GITHUB_TOKEN && process.env.AI_PROVIDER === 'github';
  
  if (!hasOpenAI && !hasGitHub && process.env.AI_REVIEW_ENABLED !== 'false') {
    console.log('ℹ AI Review disabled: No AI provider configured');
    console.log('  Option 1: Add OPENAI_API_KEY to .env (recommended)');
    console.log('  Option 2: Set AI_PROVIDER=github and use GITHUB_TOKEN');
    console.log('');
    return false;
  }
  
  if (hasGitHub) {
    console.log('ℹ Using GitHub Models API for AI review');
  }
  
  return true;
}

function ghHeaders() {
  return {
    Authorization: 'Bearer ' + process.env.GITHUB_PAT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Input Parsing ────────────────────────────────────────────────────────────

// Parse input and return { repo, prNumber, inputType }
function parseInput(input) {
  const org = process.env.GITHUB_ORG;
  const trimmed = input.trim();
  
  // Check if it's a Jira ticket (e.g., AINEX-27)
  const ticketRegex = /^([A-Z]+)-(\d+)$/;
  const ticketMatch = trimmed.toUpperCase().match(ticketRegex);
  if (ticketMatch) {
    const projectKey = ticketMatch[1];
    const repo = PROJECT_REPO_MAP[projectKey];
    if (!repo) {
      throw new Error('Unknown project key: "' + projectKey + '". Supported: ' + Object.keys(PROJECT_REPO_MAP).join(', '));
    }
    return { repo: repo, prNumber: null, ticket: trimmed.toUpperCase(), inputType: 'ticket' };
  }
  
  // Check if it's a GitHub URL (e.g., https://github.com/org/repo/pull/123)
  const urlRegex = /github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/;
  const urlMatch = trimmed.match(urlRegex);
  if (urlMatch) {
    const urlOrg = urlMatch[1];
    const repo = urlMatch[2];
    const prNumber = parseInt(urlMatch[3], 10);
    
    if (urlOrg !== org) {
      throw new Error('PR URL organization "' + urlOrg + '" does not match GITHUB_ORG "' + org + '".');
    }
    
    return { repo: repo, prNumber: prNumber, inputType: 'url' };
  }
  
  // Check if it's just a PR number
  const numberRegex = /^\d+$/;
  if (numberRegex.test(trimmed)) {
    throw new Error(
      'Bare PR numbers are not supported. Please provide:\n' +
      '  - A Jira ticket (e.g., AINEX-27)\n' +
      '  - A full PR URL (e.g., https://github.com/' + org + '/repo/pull/123)'
    );
  }
  
  throw new Error('Invalid input format. Expected a Jira ticket (e.g., AINEX-27) or GitHub PR URL.');
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

async function fetchPRDetails(repo, prNumber) {
  const org = process.env.GITHUB_ORG;
  try {
    const { data } = await axios.get(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber,
      { headers: ghHeaders() }
    );
    return {
      number: data.number,
      title: data.title,
      body: data.body || '(no description)',
      state: data.state,
      user: data.user.login,
      head: data.head.ref,
      base: data.base.ref,
      mergeable: data.mergeable,
      mergeable_state: data.mergeable_state,
      changed_files: data.changed_files,
      additions: data.additions,
      deletions: data.deletions,
      commits: data.commits,
      url: data.html_url,
    };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    if (status === 404) throw new Error('PR #' + prNumber + ' not found in ' + org + '/' + repo + '.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function fetchPRFiles(repo, prNumber) {
  const org = process.env.GITHUB_ORG;
  try {
    const { data } = await axios.get(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber + '/files',
      { headers: ghHeaders() }
    );
    return data.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch || '',
    }));
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    if (status === 404) throw new Error('Files not found for PR #' + prNumber + ' in ' + org + '/' + repo + '.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function findPRByBranch(repo, branchPrefix) {
  const org = process.env.GITHUB_ORG;
  try {
    const { data } = await axios.get(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls',
      { 
        headers: ghHeaders(),
        params: { state: 'open', per_page: 100 }
      }
    );
    
    // Find PR where head branch matches the pattern
    const prs = data.filter((pr) => {
      const headBranch = pr.head.ref;
      return headBranch.startsWith('feature/' + branchPrefix) || 
             headBranch.startsWith('bug/' + branchPrefix);
    });
    
    if (prs.length === 0) return null;
    if (prs.length === 1) return prs[0].number;
    
    // Multiple PRs found - prefer -mid branch, otherwise return first
    const midPR = prs.find((pr) => pr.head.ref.endsWith('-mid'));
    return midPR ? midPR.number : prs[0].number;
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function approvePR(repo, prNumber, comment) {
  const org = process.env.GITHUB_ORG;
  const reviewComment = comment || process.env.GITHUB_REVIEW_COMMENT || '';
  
  try {
    const { data } = await axios.post(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber + '/reviews',
      { event: 'APPROVE', body: reviewComment },
      { headers: ghHeaders() }
    );
    return { id: data.id, state: data.state, url: data.html_url };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    if (status === 422) {
      const msg = err.response.data && err.response.data.message;
      throw new Error('Cannot approve PR: ' + (msg || 'validation failed. You may have already reviewed this PR.'));
    }
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

// Polls up to 3 times (2 s apart) for GitHub to compute mergeability
async function checkMergeable(repo, prNumber) {
  const org = process.env.GITHUB_ORG;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(2000);
    try {
      const { data } = await axios.get(
        'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber,
        { headers: ghHeaders() }
      );
      if (data.mergeable === true)  return 'clean';
      if (data.mergeable === false) return 'conflict';
      // null → GitHub hasn't computed yet, keep polling
    } catch (err) {
      const status = err.response && err.response.status;
      throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
    }
  }
  return 'unknown';
}

async function fetchCIStatus(repo, prNumber) {
  const org = process.env.GITHUB_ORG;
  try {
    // Get the PR to find the head SHA
    const { data: pr } = await axios.get(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber,
      { headers: ghHeaders() }
    );
    
    const headSha = pr.head.sha;
    
    // Get combined status for the commit
    const { data } = await axios.get(
      'https://api.github.com/repos/' + org + '/' + repo + '/commits/' + headSha + '/status',
      { headers: ghHeaders() }
    );
    
    return {
      state: data.state, // success, failure, pending, error
      total: data.total_count,
      statuses: data.statuses.map((s) => ({
        context: s.context,
        state: s.state,
        description: s.description || '(no description)',
      })),
    };
  } catch (err) {
    const status = err.response && err.response.status;
    // If no checks exist, GitHub returns 404
    if (status === 404) return { state: 'none', total: 0, statuses: [] };
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

// ─── AI Review ────────────────────────────────────────────────────────────────

// Helper to make a single AI API call
async function callAI(apiBase, apiKey, model, messages, isGitHubModels) {
  const response = await axios.post(
    apiBase + '/chat/completions',
    {
      model: model,
      messages: messages,
      temperature: 0.3,
      max_tokens: 1000,
    },
    {
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data.choices[0].message.content;
}

// Split files into chunks for processing
function chunkFiles(files) {
  const MAX_LINES_PER_CHUNK = 150;  // Lines per API call (very conservative for GitHub Models API)
  const MAX_FILES_PER_CHUNK = 3;    // Files per API call (very conservative)
  
  // Filter out lock files and sort by importance
  const reviewableFiles = files
    .filter(f => f.patch) // Only files with patches
    .filter(f => !/(package-lock|yarn\.lock|pnpm-lock)\.json$/i.test(f.filename)) // Skip lock files
    .sort((a, b) => {
      // Prioritize code files over config files
      const aIsConfig = /\.(json|md|txt|yml|yaml)$/i.test(a.filename);
      const bIsConfig = /\.(json|md|txt|yml|yaml)$/i.test(b.filename);
      if (aIsConfig !== bIsConfig) return aIsConfig ? 1 : -1;
      return 0; // Keep original order otherwise
    });
  
  const chunks = [];
  let currentChunk = [];
  let currentLines = 0;
  
  for (const file of reviewableFiles) {
    const lines = file.patch.split('\n').length;
    
    // Start new chunk if limits exceeded
    if (currentChunk.length >= MAX_FILES_PER_CHUNK || 
        (currentLines + lines > MAX_LINES_PER_CHUNK && currentChunk.length > 0)) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLines = 0;
    }
    
    currentChunk.push(file);
    currentLines += lines;
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

async function performAIReview(pr, files) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN;
  const model = process.env.AI_MODEL || 'gpt-4o';
  
  // Support for GitHub Models API (uses GITHUB_TOKEN instead of OPENAI_API_KEY)
  const isGitHubModels = process.env.AI_PROVIDER === 'github';
  const apiBase = isGitHubModels 
    ? 'https://models.inference.ai.azure.com'
    : (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');
  
  // Prepare full files summary
  const filesSummary = files.map((f) => {
    const statusIcon = f.status === 'added' ? '[+]' : f.status === 'removed' ? '[-]' : '[~]';
    return `${statusIcon} ${f.filename} (+${f.additions}/-${f.deletions})`;
  }).join('\n');
  
  // Truncate file summary if too long (keep first 50 files)
  const filesSummaryLines = filesSummary.split('\n');
  const truncatedFilesSummary = filesSummaryLines.length > 50
    ? filesSummaryLines.slice(0, 50).join('\n') + `\n[... ${filesSummaryLines.length - 50} more files]`
    : filesSummary;
  
  // Split files into manageable chunks
  const chunks = chunkFiles(files);
  
  console.log(`  Reviewing ${files.length} files in ${chunks.length} chunk${chunks.length !== 1 ? 's' : ''}...`);
  
  const chunkReviews = [];
  
  // Review each chunk
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkNum = i + 1;
    
    console.log(`  Processing chunk ${chunkNum}/${chunks.length} (${chunk.length} files)...`);
    
    // Build patch content for this chunk with per-file size limits
    let patchContent = '';
    const MAX_LINES_PER_FILE = 100; // Truncate individual large files (very conservative)
    
    for (const file of chunk) {
      const lines = file.patch.split('\n');
      
      if (lines.length > MAX_LINES_PER_FILE) {
        // Truncate large files
        const truncatedPatch = lines.slice(0, MAX_LINES_PER_FILE).join('\n');
        patchContent += `\n### ${file.filename} ###\n${truncatedPatch}\n[... ${lines.length - MAX_LINES_PER_FILE} more lines omitted - file too large]\n`;
      } else {
        patchContent += `\n### ${file.filename} ###\n${file.patch}\n`;
      }
    }
    
    const chunkFilesList = chunk.map(f => `- ${f.filename}`).join('\n');
    
    // Truncate PR description if too long to save payload space
    const maxDescLength = 500;
    const truncatedDesc = pr.body.length > maxDescLength 
      ? pr.body.substring(0, maxDescLength) + '...[truncated]'
      : pr.body;
    
    const prompt = chunks.length === 1 
      ? `Review this Pull Request.

Title: ${pr.title}
Files: ${pr.changed_files} changed (+${pr.additions}/-${pr.deletions})

**Code Changes:**
${patchContent}

**Provide:**
1. Summary (2-3 sentences)
2. Security Issues (or "None")
3. Bugs/Issues (or "None")
4. Best Practices suggestions

Be concise.`
      : `Review PR part ${chunkNum}/${chunks.length}.

Title: ${pr.title}

**Code:**
${patchContent}

**Report:**
1. Security issues (or "None")
2. Bugs/issues (or "None")
3. Best practices

Be brief.`;

    try {
      const review = await callAI(
        apiBase,
        apiKey,
        model,
        [
          {
            role: 'system',
            content: 'Expert code reviewer. Find bugs, security issues, suggest best practices. Be concise.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        isGitHubModels
      );
      
      chunkReviews.push({ chunkNum, review });
    } catch (err) {
      const status = err.response && err.response.status;
      const provider = isGitHubModels ? 'GitHub Models' : 'OpenAI';
      
      if (status === 401) throw new Error(provider + ' authentication failed. Check your API key/token in .env');
      if (status === 413) throw new Error('Request payload too large even after chunking. The individual files are too large. Try reviewing fewer files.');
      if (status === 429) throw new Error(provider + ' rate limit exceeded. Try again later.');
      if (status === 400) {
        const errMsg = err.response.data && err.response.data.error && err.response.data.error.message;
        throw new Error(provider + ' API error: ' + (errMsg || 'Invalid request'));
      }
      throw new Error('AI Review failed on chunk ' + chunkNum + ' (' + (status || 'network') + '): ' + err.message);
    }
  }
  
  // If single chunk, return as-is
  if (chunkReviews.length === 1) {
    return chunkReviews[0].review;
  }
  
  // Combine multiple chunk reviews
  let combinedReview = `## Summary\nThis PR was reviewed in ${chunks.length} parts due to its size.\n\n`;
  
  for (const { chunkNum, review } of chunkReviews) {
    combinedReview += `### Part ${chunkNum}/${chunks.length}\n${review}\n\n`;
  }
  
  return combinedReview;
}

function displayAIReview(aiReview) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🤖 AI-POWERED CODE REVIEW');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  
  // Split by lines and format nicely
  const lines = aiReview.split('\n');
  for (const line of lines) {
    // Highlight section headers
    if (line.startsWith('##')) {
      console.log('');
      console.log('  ' + line.replace('##', '▸'));
      console.log('  ' + '─'.repeat(60));
    } else if (line.trim()) {
      console.log('  ' + line);
    }
  }
  
  console.log('');
  console.log('  ' + '─'.repeat(60));
  console.log('  Powered by ' + (process.env.AI_MODEL || 'GPT-4'));
  console.log('');
}

// ─── Display Functions ────────────────────────────────────────────────────────

function displayPRMetadata(pr) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PR #' + pr.number + ': ' + pr.title);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Status      : ' + pr.state.toUpperCase());
  console.log('  Author      : @' + pr.user);
  console.log('  Branch      : ' + pr.head + ' → ' + pr.base);
  console.log('  Commits     : ' + pr.commits);
  console.log('  Files       : ' + pr.changed_files + ' changed');
  console.log('  Changes     : +' + pr.additions + ' / -' + pr.deletions);
  console.log('  URL         : ' + pr.url);
  console.log('');
  console.log('  Description:');
  console.log('  ' + pr.body.split('\n').join('\n  '));
  console.log('');
}

function displayFilesSummary(files) {
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  CHANGED FILES (' + files.length + ')');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  
  const MAX_DISPLAY = 50;
  const displayFiles = files.slice(0, MAX_DISPLAY);
  
  for (const file of displayFiles) {
    const statusIcon = file.status === 'added' ? '+' : file.status === 'removed' ? '-' : '~';
    const changes = '+' + file.additions + '/-' + file.deletions;
    console.log('  ' + statusIcon + ' ' + file.filename + ' (' + changes + ')');
  }
  
  if (files.length > MAX_DISPLAY) {
    console.log('');
    console.log('  ... and ' + (files.length - MAX_DISPLAY) + ' more files.');
    console.log('  View full list on GitHub.');
  }
  
  console.log('');
}

function displayCodeDiff(files) {
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  CODE CHANGES');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  
  const MAX_DIFF_LINES = 500;
  let lineCount = 0;
  
  for (const file of files) {
    if (lineCount >= MAX_DIFF_LINES) {
      console.log('  ... diff truncated (too large) ...');
      console.log('  View full diff on GitHub.');
      break;
    }
    
    if (!file.patch) continue;
    
    console.log('  ━━━ ' + file.filename + ' ━━━');
    console.log('');
    
    const lines = file.patch.split('\n');
    for (const line of lines) {
      if (lineCount >= MAX_DIFF_LINES) break;
      console.log('  ' + line);
      lineCount++;
    }
    
    console.log('');
  }
  
  console.log('');
}

function displayMergeStatus(status) {
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  MERGE STATUS');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  
  if (status === 'clean') {
    console.log('  ✓ No merge conflicts detected.');
  } else if (status === 'conflict') {
    console.log('  ✗ Merge conflicts detected!');
    console.log('  Resolve conflicts before approving.');
  } else {
    console.log('  ? Mergeability could not be determined.');
    console.log('  Check the PR manually on GitHub.');
  }
  
  console.log('');
}

function displayCIStatus(ciStatus) {
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  CI/CD CHECKS');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
  
  if (ciStatus.state === 'none' || ciStatus.total === 0) {
    console.log('  ℹ No CI/CD checks configured for this PR.');
  } else {
    const stateIcon = ciStatus.state === 'success' ? '✓' : 
                      ciStatus.state === 'failure' ? '✗' : 
                      ciStatus.state === 'pending' ? '⋯' : '⚠';
    const stateText = ciStatus.state.toUpperCase();
    console.log('  Overall Status: ' + stateIcon + ' ' + stateText);
    console.log('  Total Checks  : ' + ciStatus.total);
    console.log('');
    
    if (ciStatus.statuses.length > 0) {
      console.log('  Checks:');
      for (const check of ciStatus.statuses) {
        const icon = check.state === 'success' ? '✓' : 
                     check.state === 'failure' ? '✗' : 
                     check.state === 'pending' ? '⋯' : '⚠';
        console.log('    ' + icon + ' ' + check.context + ' — ' + check.description);
      }
    }
  }
  
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(input, approve = false) {
  validateEnv();
  
  const org = process.env.GITHUB_ORG;
  
  // Parse input to determine repo and PR number
  console.log('Parsing input: ' + input);
  const parsed = parseInput(input);
  
  let repo = parsed.repo;
  let prNumber = parsed.prNumber;
  
  // If input was a ticket, find the associated PR
  if (parsed.inputType === 'ticket') {
    console.log('Searching for PR associated with ' + parsed.ticket + ' in ' + org + '/' + repo + '...');
    prNumber = await findPRByBranch(repo, parsed.ticket);
    if (!prNumber) {
      throw new Error(
        'No open PR found for ticket ' + parsed.ticket + ' in ' + org + '/' + repo + '.\n' +
        'Expected branch prefix: feature/' + parsed.ticket + ' or bug/' + parsed.ticket
      );
    }
    console.log('  Found PR #' + prNumber);
  }
  
  // If we're approving, do it and exit
  if (approve) {
    console.log('');
    console.log('Approving PR #' + prNumber + ' in ' + org + '/' + repo + '...');
    
    // First check if PR is still open
    const prCheck = await fetchPRDetails(repo, prNumber);
    if (prCheck.state === 'closed') {
      throw new Error('Cannot approve a closed PR. PR #' + prNumber + ' is already closed.');
    }
    
    const review = await approvePR(repo, prNumber);
    console.log('');
    console.log('✓ PR #' + prNumber + ' approved!');
    console.log('  Review ID   : ' + review.id);
    console.log('  Status      : ' + review.state);
    console.log('');
    return;
  }
  
  // Fetch PR details
  console.log('Fetching PR #' + prNumber + ' from ' + org + '/' + repo + '...');
  const pr = await fetchPRDetails(repo, prNumber);
  
  // Check if PR is closed
  if (pr.state === 'closed') {
    console.log('');
    console.log('⚠ WARNING: This PR is CLOSED');
    console.log('  You cannot approve a closed PR.');
    console.log('');
  }
  
  // Display PR metadata
  displayPRMetadata(pr);
  
  // Fetch changed files (needed for AI review)
  console.log('Fetching changed files...');
  const files = await fetchPRFiles(repo, prNumber);
  
  // File list and code diff display disabled
  // displayFilesSummary(files);
  // displayCodeDiff(files);
  
  // Perform AI-powered review if enabled
  const aiEnabled = validateAIEnv();
  let aiReviewText = '';
  if (aiEnabled) {
    try {
      console.log('Running AI-powered code analysis (this may take 10-30 seconds)...');
      aiReviewText = await performAIReview(pr, files);
      displayAIReview(aiReviewText);
    } catch (err) {
      console.log('⚠ AI Review failed: ' + err.message);
      console.log('  Continuing with manual review...');
      console.log('');
    }
  }
  
  // Check CI/CD status
  console.log('Fetching CI/CD check status...');
  const ciStatus = await fetchCIStatus(repo, prNumber);
  displayCIStatus(ciStatus);
  
  // Check merge status
  console.log('Checking for merge conflicts (this may take a few seconds)...');
  const mergeStatus = await checkMergeable(repo, prNumber);
  displayMergeStatus(mergeStatus);
  
  // Warn if there are conflicts
  if (mergeStatus === 'conflict') {
    console.log('⚠ WARNING: Do not approve this PR until conflicts are resolved!');
    console.log('');
  }
  
  // Warn if CI checks are failing
  if (ciStatus.state === 'failure' || ciStatus.state === 'error') {
    console.log('⚠ WARNING: CI/CD checks are failing! Review the errors before approving.');
    console.log('');
  }
  
  // Output completion marker for UI
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  REVIEW COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  const aiStatus = aiReviewText ? 'ai-enabled' : 'ai-disabled';
  console.log('REVIEW_COMPLETE|' + repo + '|' + prNumber + '|' + mergeStatus + '|' + ciStatus.state + '|' + aiStatus);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const approveIndex = args.indexOf('--approve');
const approve = approveIndex !== -1;

// Remove --approve flag from args if present
if (approveIndex !== -1) {
  args.splice(approveIndex, 1);
}

const input = args[0];

if (!input) {
  console.error('Usage: node scripts/review-pr.js <ticket-or-url> [--approve]');
  console.error('Examples:');
  console.error('  node scripts/review-pr.js AINEX-27');
  console.error('  node scripts/review-pr.js https://github.com/org/repo/pull/123');
  console.error('  node scripts/review-pr.js AINEX-27 --approve  (approve after review)');
  process.exit(1);
}

run(input, approve).catch((err) => {
  console.error('Error: ' + err.message);
  process.exit(1);
});
