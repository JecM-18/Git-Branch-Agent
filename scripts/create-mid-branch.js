'use strict';
require('dotenv').config();
const axios = require('axios');

const PROJECT_REPO_MAP = { AINEX: 'rrp', AIPACT: 'contractdb' };

const ENV_BRANCH_MAP = {
  AINEX:  { staging: 'Release/Staging', uat: 'Release/UAT', prod: 'Release/Production', production: 'Release/Production' },
  AIPACT: { staging: 'deployment/staging', uat: 'deployment/UAT', prod: 'deployment/Production', production: 'deployment/Production' },
};

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

function validateEnv() {
  var required = ['JIRA_BASE_URL','JIRA_EMAIL','JIRA_API_TOKEN','GITHUB_PAT','GITHUB_ORG'];
  var missing = required.filter(function(k){ return !process.env[k]; });
  if (missing.length) throw new Error('Missing env vars: ' + missing.join(', '));
}

async function fetchJiraIssue(ticket) {
  var JIRA_BASE_URL = process.env.JIRA_BASE_URL, JIRA_EMAIL = process.env.JIRA_EMAIL, JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
  var token = Buffer.from(JIRA_EMAIL + ':' + JIRA_API_TOKEN).toString('base64');
  try {
    var r = await axios.get(JIRA_BASE_URL + '/rest/api/3/issue/' + ticket, {
      headers: { Authorization: 'Basic ' + token, Accept: 'application/json' },
      params: { fields: 'summary,issuetype' }
    });
    return { summary: r.data.fields.summary, issueType: r.data.fields.issuetype.name };
  } catch(err) {
    var s = err.response && err.response.status;
    if (s === 401) throw new Error('Jira auth failed.');
    if (s === 404) throw new Error('Ticket not found: ' + ticket);
    throw new Error('Jira error (' + (s||'network') + '): ' + err.message);
  }
}

function ghHeaders() {
  return { Authorization: 'Bearer ' + process.env.GITHUB_PAT, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

async function getBranchSHA(repo, branch) {
  var org = process.env.GITHUB_ORG;
  try {
    var r = await axios.get('https://api.github.com/repos/' + org + '/' + repo + '/git/ref/heads/' + encodeURIComponent(branch), { headers: ghHeaders() });
    return r.data.object.sha;
  } catch(err) {
    var s = err.response && err.response.status;
    if (s === 401) throw new Error('GitHub auth failed.');
    if (s === 404) throw new Error('Branch not found: ' + branch);
    throw new Error('GitHub error (' + (s||'network') + '): ' + err.message);
  }
}

async function createBranch(repo, name, sha) {
  var org = process.env.GITHUB_ORG;
  try {
    await axios.post('https://api.github.com/repos/' + org + '/' + repo + '/git/refs', { ref: 'refs/heads/' + name, sha: sha }, { headers: ghHeaders() });
  } catch(err) {
    var s = err.response && err.response.status;
    if (s === 422) throw new Error('Branch already exists: ' + name);
    if (s === 401) throw new Error('GitHub auth failed.');
    throw new Error('GitHub error (' + (s||'network') + '): ' + err.message);
  }
}

async function mergeBranch(repo, base, head) {
  var org = process.env.GITHUB_ORG;
  try {
    var r = await axios.post('https://api.github.com/repos/' + org + '/' + repo + '/merges',
      { base: base, head: head, commit_message: 'Merge ' + head + ' into ' + base },
      { headers: ghHeaders() }
    );
    return r.status === 204 ? 'already-up-to-date' : 'merged';
  } catch(err) {
    var s = err.response && err.response.status;
    if (s === 409) throw new Error('Merge conflict. Resolve manually on GitHub.');
    if (s === 404) throw new Error('Feature branch not found: ' + head + '. Run create-branch.js first.');
    if (s === 401) throw new Error('GitHub auth failed.');
    throw new Error('GitHub error (' + (s||'network') + '): ' + err.message);
  }
}

async function main() {
  var ticket = process.argv[2];
  var env    = process.argv[3] && process.argv[3].toLowerCase();
  if (!ticket || !env) {
    console.error('Usage: node scripts/create-mid-branch.js <TICKET> <environment>');
    console.error('Example: node scripts/create-mid-branch.js AINEX-27 staging');
    process.exit(1);
  }
  var m = ticket.toUpperCase().match(/^([A-Z]+)-(\d+)$/);
  if (!m) { console.error('Invalid ticket: ' + ticket); process.exit(1); }
  var ticketKey = m[0], projectKey = m[1];
  validateEnv();
  var repo = PROJECT_REPO_MAP[projectKey];
  if (!repo) { console.error('Unknown project: ' + projectKey); process.exit(1); }
  var envMap = ENV_BRANCH_MAP[projectKey];
  var envBranch = envMap && envMap[env];
  if (!envBranch) { console.error('Unknown env: ' + env + '. Supported: ' + Object.keys(envMap||{}).join(', ')); process.exit(1); }
  var org = process.env.GITHUB_ORG;
  console.log('Fetching Jira issue ' + ticketKey + '...');
  var issue = await fetchJiraIssue(ticketKey);
  console.log('  Title     : ' + issue.summary);
  console.log('  Type      : ' + issue.issueType);
  var prefix = issue.issueType.toLowerCase() === 'bug' ? 'bug' : 'feature';
  var slug   = slugify(issue.summary);
  var featureBranch = prefix + '/' + ticketKey + '-' + slug;
  var midBranch     = featureBranch + '-mid';
  console.log('  Feature   : ' + featureBranch);
  console.log('  Mid       : ' + midBranch);
  console.log('  Env branch: ' + envBranch);
  console.log('  Repo      : ' + org + '/' + repo);
  console.log('');
  console.log('Fetching SHA for env branch...');
  var sha = await getBranchSHA(repo, envBranch);
  console.log('  SHA: ' + sha);
  console.log('');
  console.log('Creating mid branch...');
  await createBranch(repo, midBranch, sha);
  console.log('  Created: ' + midBranch);
  console.log('');
  console.log('Merging feature branch into mid...');
  var result = await mergeBranch(repo, midBranch, featureBranch);
  console.log('  Merge: ' + result);
  console.log('');
  console.log('Mid branch ready!');
  console.log('  ' + midBranch);
  console.log('  https://github.com/' + org + '/' + repo + '/tree/' + midBranch);
}

main().catch(function(err) { console.error('Error: ' + err.message); process.exit(1); });
