#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

// ─── Mappings ─────────────────────────────────────────────────────────────────
const PROJECT_REPO_MAP = {
  AINEX: 'rrp',
  AIPACT: 'contractdb',
};

const PROJECT_NAME_MAP = {
  AINEX: 'NEXUS',
  AIPACT: 'PACT-X',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function validateEnv() {
  const required = ['JIRA_BASE_URL', 'GITHUB_PAT', 'GITHUB_ORG'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error('Missing environment variables: ' + missing.join(', ') + '\nConfigure in Settings tab.');
  }
}

function ghHeaders() {
  return {
    Authorization: 'Bearer ' + process.env.GITHUB_PAT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// ─── Parse Ticket ─────────────────────────────────────────────────────────────
function parseTicket(ticket) {
  const match = ticket.match(/^([A-Z]+)-(\d+)$/);
  if (!match) {
    throw new Error('Invalid ticket format. Use e.g. AINEX-27 or AIPACT-40');
  }

  const project = match[1];
  const ticketNum = match[2];

  if (!PROJECT_REPO_MAP[project]) {
    throw new Error(
      'Unknown project: ' + project + '\nSupported: AINEX, AIPACT'
    );
  }

  const repo = PROJECT_REPO_MAP[project];
  const projectName = PROJECT_NAME_MAP[project];

  return { project, ticketNum, repo, projectName, fullTicket: ticket };
}

// ─── Find PR ──────────────────────────────────────────────────────────────────
async function findPRForTicket(repo, ticket) {
  const org = process.env.GITHUB_ORG;
  
  try {
    console.log('🔍 Searching for PRs in ' + org + '/' + repo + ' containing "' + ticket + '"...');
    
    // Fetch all PRs (open first, then closed if no open PR found)
    const { data: openPRs } = await axios.get(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls',
      {
        headers: ghHeaders(),
        params: { state: 'open', per_page: 100, sort: 'created', direction: 'desc' },
      }
    );

    // Find PR where head branch contains the ticket number
    let pr = openPRs.find((p) => p.head.ref.includes(ticket));

    if (pr) {
      console.log('✓ Found open PR #' + pr.number + ': ' + pr.title);
      return { number: pr.number, url: pr.html_url, state: 'open' };
    }

    // If no open PR, search closed/merged PRs
    console.log('  No open PR found. Checking closed/merged PRs...');
    const { data: closedPRs } = await axios.get(
      'https://api.github.com/repos/' + org + '/' + repo + '/pulls',
      {
        headers: ghHeaders(),
        params: { state: 'closed', per_page: 100, sort: 'created', direction: 'desc' },
      }
    );

    pr = closedPRs.find((p) => p.head.ref.includes(ticket));

    if (pr) {
      console.log('✓ Found closed/merged PR #' + pr.number + ': ' + pr.title);
      return { number: pr.number, url: pr.html_url, state: pr.merged_at ? 'merged' : 'closed' };
    }

    throw new Error(
      'No PR found for ticket ' + ticket + ' in ' + org + '/' + repo + '\n' +
      'Make sure you have created a PR for this ticket first.'
    );

  } catch (err) {
    if (err.message && err.message.startsWith('No PR found')) {
      throw err;
    }
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT in Settings.');
    if (status === 404) throw new Error('Repository not found: ' + org + '/' + repo + '\nCheck GITHUB_ORG in Settings.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

// ─── Format Message ───────────────────────────────────────────────────────────
function formatTeamsMessage(ticket, prUrl, projectName) {
  const jiraUrl = process.env.JIRA_BASE_URL + '/browse/' + ticket;
  
  return (
    '@everyone PR to ' + projectName + ' STAGING => ' + prUrl + '\n' +
    '- ' + jiraUrl
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  try {
    const ticket = process.argv[2];

    if (!ticket) {
      console.error('Usage: node format-teams-message.js <TICKET>');
      console.error('Example: node format-teams-message.js AIPACT-40');
      process.exit(1);
    }

    validateEnv();

    const ticketUpper = ticket.trim().toUpperCase();
    const { repo, projectName, fullTicket } = parseTicket(ticketUpper);

    const pr = await findPRForTicket(repo, fullTicket);

    const message = formatTeamsMessage(fullTicket, pr.url, projectName);

    console.log('\n' + '─'.repeat(60));
    console.log('📋 Teams Message Generated:');
    console.log('─'.repeat(60));
    console.log(message);
    console.log('─'.repeat(60));
    console.log('\n✓ Copy this message and paste it into your Teams chat');

  } catch (err) {
    console.error('✗ Error: ' + err.message);
    process.exit(1);
  }
}

main();
