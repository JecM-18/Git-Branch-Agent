#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

// ─── Mappings ─────────────────────────────────────────────────────────────────
const PROJECT_REPO_MAP = {
  AINEX: 'rrp',
  AIPACT: 'contractdb',
};

const ENV_BRANCH_MAP = {
  AINEX:  { staging: 'Release/Staging', uat: 'Release/UAT', prod: 'Release/Production', production: 'Release/Production' },
  AIPACT: { staging: 'deployment/staging', uat: 'deployment/UAT', prod: 'deployment/Production', production: 'deployment/Production' },
};

// Maps display-name aliases (lowercase) to project keys
const RELEASE_PROJECT_MAP = {
  nexus:  'AINEX',
  pact:   'AIPACT',
  'pact-x': 'AIPACT',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function validateEnv() {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'GITHUB_PAT', 'GITHUB_ORG'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error('Missing environment variables: ' + missing.join(', ') + '\nCopy .env.example to .env and fill in the values.');
  }
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

// ─── Jira ─────────────────────────────────────────────────────────────────────
async function fetchJiraIssue(ticket) {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const token = Buffer.from(JIRA_EMAIL + ':' + JIRA_API_TOKEN).toString('base64');
  try {
    const { data } = await axios.get(JIRA_BASE_URL + '/rest/api/3/issue/' + ticket, {
      headers: { Authorization: 'Basic ' + token, Accept: 'application/json' },
      params: { fields: 'summary,issuetype' },
    });
    return { summary: data.fields.summary, issueType: data.fields.issuetype.name };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN.');
    if (status === 404) throw new Error('Jira ticket "' + ticket + '" not found.');
    throw new Error('Jira API error (' + (status || 'network') + '): ' + err.message);
  }
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

// Returns array of branch names whose full ref starts with heads/{prefix}
async function findBranches(repo, prefix) {
  const org = process.env.GITHUB_ORG;
  try {
    const { data } = await axios.get(
      'https://api.github.com/repos/' + org + '/' + repo + '/git/matching-refs/heads/' + prefix,
      { headers: ghHeaders() }
    );
    return data.map((r) => r.ref.replace('refs/heads/', ''));
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    // 404 from matching-refs just means no results — return empty
    if (status === 404) return [];
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function createPR(repo, head, base, title, body) {
  const org = process.env.GITHUB_ORG;
  try {
    const { data } = await axios.post(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls',
      { title: title, body: body || '', head: head, base: base },
      { headers: ghHeaders() }
    );
    return { number: data.number, url: data.html_url };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 422) {
      const errors = err.response.data && err.response.data.errors;
      const detail = errors ? errors.map((e) => e.message).join('; ') : 'Validation failed.';
      throw new Error(
        'PR creation failed: ' + detail + '\n' +
        'A PR for this branch may already exist. Check: https://github.com/' + org + '/' + repo + '/pulls'
      );
    }
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

// reviewers: comma-separated GitHub usernames string (may be empty/undefined)
async function requestReviewers(repo, prNumber, reviewers) {
  const logins = reviewers
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (!logins.length) return;
  const org = process.env.GITHUB_ORG;
  try {
    await axios.post(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber + '/requested_reviewers',
      { reviewers: logins },
      { headers: ghHeaders() }
    );
  } catch (err) {
    const status = err.response && err.response.status;
    // 422 often means user not found or not a collaborator — warn but don't abort
    if (status === 422) {
      const msg = err.response.data && err.response.data.message;
      throw new Error('Could not add reviewers: ' + (msg || 'one or more usernames are invalid or not collaborators.'));
    }
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function closePR(repo, prNumber) {
  const org = process.env.GITHUB_ORG;
  try {
    await axios.patch(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber,
      { state: 'closed' },
      { headers: ghHeaders() }
    );
  } catch (err) {
    const status = err.response && err.response.status;
    throw new Error('Failed to close PR #' + prNumber + ': GitHub API error (' + (status || 'network') + '): ' + err.message);
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

// Prefer a branch ending in '-mid', otherwise fall back to first result
function pickBranch(branches) {
  const mid = branches.find((b) => b.endsWith('-mid'));
  if (mid) return { branch: mid, isMid: true };
  if (branches.length > 0) return { branch: branches[0], isMid: false };
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run(input, envArg, reviewersArg) {
  validateEnv();

  const org = process.env.GITHUB_ORG;
  const ticketRegex = /^([A-Z]+)-(\d+)$/;
  const isTicket = ticketRegex.test(input.trim().toUpperCase());

  let projectKey, repo, baseBranch, prTitle, prBody, searchPrefixes;

  if (isTicket) {
    // ── Ticket mode ────────────────────────────────────────────────────────
    const ticket = input.trim().toUpperCase();
    const m = ticket.match(ticketRegex);
    projectKey = m[1];

    repo = PROJECT_REPO_MAP[projectKey];
    if (!repo) {
      throw new Error('Unknown project key: "' + projectKey + '". Supported: ' + Object.keys(PROJECT_REPO_MAP).join(', '));
    }

    const envMap = ENV_BRANCH_MAP[projectKey];
    baseBranch = envMap.staging;

    console.log('Fetching Jira issue ' + ticket + '...');
    const issue = await fetchJiraIssue(ticket);
    console.log('  Summary : ' + issue.summary);
    console.log('  Type    : ' + issue.issueType);

    prTitle = ticket + ' - ' + issue.summary;
    prBody  = process.env.JIRA_BASE_URL + '/browse/' + ticket;

    searchPrefixes = ['feature/' + ticket, 'bug/' + ticket];

  } else {
    // ── Release mode ──────────────────────────────────────────────────────
    const parts = input.trim().split(/\s+/);
    if (parts.length < 2) {
      throw new Error('Release input must be "<Alias> <version>", e.g. "Nexus 3.56.7"');
    }

    const alias   = parts[0].toLowerCase();
    const version = parts.slice(1).join(' ');

    projectKey = RELEASE_PROJECT_MAP[alias];
    if (!projectKey) {
      throw new Error('Unknown release alias: "' + parts[0] + '". Supported: ' + Object.keys(RELEASE_PROJECT_MAP).join(', '));
    }

    repo = PROJECT_REPO_MAP[projectKey];

    const env = (envArg || '').toLowerCase();
    if (env !== 'uat' && env !== 'prod' && env !== 'production') {
      throw new Error('For release PRs, environment must be "uat" or "prod".');
    }

    const envMap = ENV_BRANCH_MAP[projectKey];
    baseBranch = envMap[env];
    if (!baseBranch) {
      throw new Error('No branch mapping found for environment "' + env + '" in project "' + projectKey + '".');
    }

    prTitle = 'Release ' + version;
    prBody  = '';

    searchPrefixes = ['feature/' + version];
  }

  // ── Find branch ───────────────────────────────────────────────────────────
  console.log('\nSearching for branches in ' + org + '/' + repo + '...');

  let allBranches = [];
  for (const prefix of searchPrefixes) {
    const found = await findBranches(repo, prefix);
    allBranches = allBranches.concat(found);
  }

  const picked = pickBranch(allBranches);
  if (!picked) {
    throw new Error(
      'No branches found matching "' + input + '" in ' + org + '/' + repo + '.\n' +
      'Expected prefixes: ' + searchPrefixes.join(', ') + '\n' +
      'Run "Create Branch" first, then try again.'
    );
  }

  const { branch: headBranch, isMid } = picked;
  console.log('  Found   : ' + headBranch + (isMid ? ' (mid branch — using this)' : ''));
  console.log('  Head    : ' + headBranch);
  console.log('  Base    : ' + baseBranch);
  console.log('  Title   : ' + prTitle);
  console.log('  Repo    : ' + org + '/' + repo);

  // ── Create PR ─────────────────────────────────────────────────────────────
  console.log('\nCreating pull request...');
  const pr = await createPR(repo, headBranch, baseBranch, prTitle, prBody);
  console.log('  PR #' + pr.number + ' created!');
  console.log('  ' + pr.url);

  // ── Request reviewers ──────────────────────────────────────────────────
  if (reviewersArg && reviewersArg.trim()) {
    const logins = reviewersArg.split(',').map((r) => r.trim()).filter(Boolean);
    console.log('\nRequesting reviewers: ' + logins.join(', ') + '...');
    await requestReviewers(repo, pr.number, reviewersArg);
    console.log('  ✓ Reviewers requested.');
  }

  // ── Check mergeability ────────────────────────────────────────────────────
  console.log('\nChecking for merge conflicts (this may take a few seconds)...');
  const mergeStatus = await checkMergeable(repo, pr.number);

  if (mergeStatus === 'conflict') {
    console.log('  ✗ Merge conflicts detected — closing PR #' + pr.number + '...');
    await closePR(repo, pr.number);
    console.log('  PR #' + pr.number + ' closed.');
    throw new Error(
      'PR closed due to merge conflicts.\n' +
      'Create a mid branch for "' + input + '", resolve the conflicts there, then re-run Create PR.'
    );
  }

  if (mergeStatus === 'unknown') {
    console.log('  ? Mergeability could not be determined — check the PR manually on GitHub.');
  } else {
    console.log('  ✓ No merge conflicts detected.');
  }

  console.log('');
  console.log('PR ready!');
  console.log('  ' + pr.url);
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const input     = process.argv[2];
const env       = process.argv[3];
const reviewers = process.argv[4];

if (!input) {
  console.error('Usage: node scripts/create-pr.js <ticket-or-release> [env] [reviewer1,reviewer2]');
  console.error('Examples:');
  console.error('  node scripts/create-pr.js AINEX-27 staging johndoe');
  console.error('  node scripts/create-pr.js "Nexus 3.56.7" uat johndoe,janedoe');
  process.exit(1);
}

run(input, env, reviewers).catch((err) => {
  console.error('Error: ' + err.message);
  process.exit(1);
});
