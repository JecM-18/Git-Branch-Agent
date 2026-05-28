#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

// ─── Repo mapping ────────────────────────────────────────────────────────────
const PROJECT_REPO_MAP = {
  AINEX: 'rrp',
  AIPACT: 'contractdb',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // non-alphanumeric runs → dash
    .replace(/^-+|-+$/g, '')       // trim leading/trailing dashes
    .replace(/-{2,}/g, '-');       // collapse consecutive dashes
}

function validateEnv() {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'GITHUB_PAT', 'GITHUB_ORG'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}\nCopy .env.example to .env and fill in the values.`);
  }
}

// ─── Jira ─────────────────────────────────────────────────────────────────────
async function fetchJiraIssue(ticket) {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${ticket}`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
      },
      params: {
        fields: 'summary,issuetype',
      },
    });
    return {
      summary: data.fields.summary,
      issueType: data.fields.issuetype.name,
    };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN.');
    if (status === 404) throw new Error('Jira ticket "' + ticket + '" not found.');
    throw new Error('Jira API error (' + (status || 'network') + '): ' + err.message);
  }
}

// ─── GitHub ───────────────────────────────────────────────────────────────────
async function getDevelopSHA(repo) {
  const { GITHUB_PAT, GITHUB_ORG } = process.env;
  const headers = {
    Authorization: `Bearer ${GITHUB_PAT}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  for (const branchName of ['Develop', 'develop']) {
    try {
      const url = `https://api.github.com/repos/${GITHUB_ORG}/${repo}/git/ref/heads/${branchName}`;
      const { data } = await axios.get(url, { headers });
      return data.object.sha;
    } catch (err) {
      const status = err.response && err.response.status;
      if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
      if (status !== 404) throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
    }
  }
  throw new Error('Neither "Develop" nor "develop" branch found in repo "' + GITHUB_ORG + '/' + repo + '".')
}

async function createGitHubBranch(repo, branchName, sha) {
  const { GITHUB_PAT, GITHUB_ORG } = process.env;
  const url = `https://api.github.com/repos/${GITHUB_ORG}/${repo}/git/refs`;

  try {
    await axios.post(
      url,
      { ref: `refs/heads/${branchName}`, sha },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_PAT}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
  } catch (err) {
    const status = err.response && err.response.status;
    // 422 Unprocessable Entity is GitHub's response when the ref already exists
    if (status === 422) throw new Error('Branch "' + branchName + '" already exists in "' + GITHUB_ORG + '/' + repo + '".');
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const ticket = process.argv[2];

  if (!ticket) {
    console.error('Usage: node scripts/create-branch.js <TICKET-NUMBER>');
    console.error('Example: node scripts/create-branch.js AINEX-27');
    process.exit(1);
  }

  // Validate ticket format
  const ticketMatch = ticket.toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  if (!ticketMatch) {
    console.error(`Invalid ticket format: "${ticket}". Expected format: PROJECT-123 (e.g. AINEX-27)`);
    process.exit(1);
  }

  const ticketKey = ticketMatch[0]; // normalised uppercase e.g. AINEX-27
  const projectKey = ticketMatch[1]; // e.g. AINEX

  validateEnv();

  // Resolve repo
  const repo = PROJECT_REPO_MAP[projectKey];
  if (!repo) {
    console.error(`Unknown project key "${projectKey}". Supported keys: ${Object.keys(PROJECT_REPO_MAP).join(', ')}`);
    process.exit(1);
  }

  console.log(`Fetching Jira issue ${ticketKey}...`);
  const { summary, issueType } = await fetchJiraIssue(ticketKey);
  console.log(`  Title     : ${summary}`);
  console.log(`  Type      : ${issueType}`);

  // Determine branch prefix
  const prefix = issueType.toLowerCase() === 'bug' ? 'bug' : 'feature';

  // Build branch name
  const slug = slugify(summary);
  const branchName = `${prefix}/${ticketKey}-${slug}`;
  console.log(`  Branch    : ${branchName}`);
  console.log(`  Repo      : ${process.env.GITHUB_ORG}/${repo}`);

  console.log(`\nFetching latest SHA for develop branch...`);
  const sha = await getDevelopSHA(repo);
  console.log(`  develop SHA: ${sha}`);

  console.log(`\nCreating branch off develop...`);
  await createGitHubBranch(repo, branchName, sha);

  console.log(`\nBranch created successfully!`);
  console.log(`  ${branchName}`);
  console.log(`  https://github.com/${process.env.GITHUB_ORG}/${repo}/tree/${branchName}`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
