#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

// ─── Mappings ─────────────────────────────────────────────────────────────────
const PROJECT_REPO_MAP = {
  AINEX: 'rrp',
  AIPACT: 'contractdb',
};

const PROJECT_DISPLAY_MAP = {
  nexus: 'AINEX',
  'pact-x': 'AIPACT',
  pactx: 'AIPACT',
};

const ENV_BRANCH_MAP = {
  AINEX:  { uat: 'Release/UAT', prod: 'Release/Production', production: 'Release/Production' },
  AIPACT: { uat: 'deployment/UAT', prod: 'deployment/Production', production: 'deployment/Production' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function validateEnv() {
  const required = ['GITHUB_PAT', 'GITHUB_ORG'];
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

// ─── GitHub API ───────────────────────────────────────────────────────────────
async function getDevelopSHA(repo) {
  const org = process.env.GITHUB_ORG;
  const headers = ghHeaders();
  
  for (const branchName of ['Develop', 'develop']) {
    try {
      const url = https://api.github.com/repos///git/ref/heads/;
      const { data } = await axios.get(url, { headers });
      return { sha: data.object.sha, branch: branchName };
    } catch (err) {
      const status = err.response && err.response.status;
      if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
      if (status !== 404) throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
    }
  }
  throw new Error('Neither \"Develop\" nor \"develop\" branch found in repo \"' + org + '/' + repo + '\".');
}

async function createGitHubBranch(repo, branchName, sha) {
  const org = process.env.GITHUB_ORG;
  const url = https://api.github.com/repos///git/refs;

  try {
    await axios.post(
      url,
      { ref: efs/heads/, sha },
      { headers: ghHeaders() }
    );
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 422) throw new Error('Branch \"' + branchName + '\" already exists in \"' + org + '/' + repo + '\".');
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function getOpenPRs(repo) {
  const org = process.env.GITHUB_ORG;
  try {
    const { data } = await axios.get(
      https://api.github.com/repos///pulls,
      { 
        headers: ghHeaders(),
        params: { state: 'open', per_page: 100, base: 'Develop' }
      }
    );
    
    const { data: data2 } = await axios.get(
      https://api.github.com/repos///pulls,
      { 
        headers: ghHeaders(),
        params: { state: 'open', per_page: 100, base: 'develop' }
      }
    );
    
    const allPRs = [...data, ...data2];
    
    return allPRs
      .filter(pr => {
        const match = pr.head.ref.match(/^(feature|bug)\/([A-Z]+-\d+)/);
        return match !== null;
      })
      .map(pr => {
        const match = pr.head.ref.match(/^(feature|bug)\/([A-Z]+-\d+)/);
        return {
          number: pr.number,
          ticket: match[2],
          branch: pr.head.ref,
          title: pr.title,
          url: pr.html_url,
        };
      });
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function mergeBranch(repo, base, head) {
  const org = process.env.GITHUB_ORG;
  try {
    const { data } = await axios.post(
      https://api.github.com/repos///merges,
      { 
        base: base, 
        head: head, 
        commit_message: Merge  into  
      },
      { headers: ghHeaders() }
    );
    return { success: true, alreadyUpToDate: false };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 204) return { success: true, alreadyUpToDate: true };
    if (status === 409) return { success: false, conflict: true };
    if (status === 404) throw new Error('Branch not found: ' + head);
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function createPR(repo, head, base, title, body) {
  const org = process.env.GITHUB_ORG;
  try {
    const { data } = await axios.post(
      https://api.github.com/repos///pulls,
      { title: title, body: body || '', head: head, base: base },
      { headers: ghHeaders() }
    );
    return { number: data.number, url: data.html_url };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 422) {
      const errors = err.response.data && err.response.data.errors;
      const detail = errors ? errors.map((e) => e.message).join('; ') : 'Validation failed.';
      throw new Error('PR creation failed: ' + detail);
    }
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function run(projectInput, version, targetEnv, createPRFlag) {
  validateEnv();

  const projectKey = PROJECT_DISPLAY_MAP[projectInput.toLowerCase()] || projectInput.toUpperCase();
  const repo = PROJECT_REPO_MAP[projectKey];
  
  if (!repo) {
    throw new Error('Unknown project: \"' + projectInput + '\". Supported: Nexus, Pact-X');
  }

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Invalid version format. Expected: X.Y.Z (e.g., 3.51.0)');
  }

  const org = process.env.GITHUB_ORG;
  const releaseBranch = eature/;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RELEASE BRANCH CREATION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Project         : ' + projectKey);
  console.log('  Repo            : ' + org + '/' + repo);
  console.log('  Release Version : ' + version);
  console.log('  Branch Name     : ' + releaseBranch);
  console.log('');

  console.log('[1/5] Creating release branch from develop...');
  const { sha: developSha, branch: developBranch } = await getDevelopSHA(repo);
  console.log('  ✓ Found ' + developBranch + ' at SHA: ' + developSha.substring(0, 7));
  
  await createGitHubBranch(repo, releaseBranch, developSha);
  console.log('  ✓ Created branch: ' + releaseBranch);
  console.log('');

  console.log('[2/5] Fetching open PRs targeting develop...');
  const openPRs = await getOpenPRs(repo);
  
  if (openPRs.length === 0) {
    console.log('  ℹ No open PRs found targeting develop.');
    console.log('');
    console.log('Release branch created successfully!');
    console.log('Branch: ' + releaseBranch);
    console.log('You can now manually merge tickets or create a PR to ' + (targetEnv || 'UAT/PROD'));
    return;
  }

  console.log('  ✓ Found ' + openPRs.length + ' open PR(s):');
  console.log('');
  openPRs.forEach((pr, index) => {
    console.log('    ' + (index + 1) + '. ' + pr.ticket + ' - ' + pr.title);
    console.log('       Branch: ' + pr.branch);
    console.log('       PR: ' + pr.url);
    console.log('');
  });

  console.log('[3/5] Merging tickets into release branch...');
  const mergeResults = [];
  let hasConflicts = false;

  for (const pr of openPRs) {
    console.log('  Merging ' + pr.ticket + ' (' + pr.branch + ')...');
    const result = await mergeBranch(repo, releaseBranch, pr.branch);
    
    if (result.success) {
      if (result.alreadyUpToDate) {
        console.log('    ✓ Already up to date');
      } else {
        console.log('    ✓ Merged successfully');
      }
      mergeResults.push({ ...pr, status: 'merged' });
    } else if (result.conflict) {
      console.log('    ✗ MERGE CONFLICT DETECTED');
      mergeResults.push({ ...pr, status: 'conflict' });
      hasConflicts = true;
    } else {
      console.log('    ? Unknown merge status');
      mergeResults.push({ ...pr, status: 'unknown' });
    }
  }
  console.log('');

  console.log('[4/5] Merge Summary');
  console.log('───────────────────────────────────────────────────────────────');
  const merged = mergeResults.filter(r => r.status === 'merged').length;
  const conflicts = mergeResults.filter(r => r.status === 'conflict').length;
  
  console.log('  Total Tickets    : ' + openPRs.length);
  console.log('  ✓ Merged         : ' + merged);
  console.log('  ✗ Conflicts      : ' + conflicts);
  console.log('');

  if (hasConflicts) {
    console.log('  ⚠ WARNING: Merge conflicts detected in the following tickets:');
    mergeResults
      .filter(r => r.status === 'conflict')
      .forEach(pr => {
        console.log('    • ' + pr.ticket + ' (' + pr.branch + ')');
      });
    console.log('');
    console.log('  You must resolve these conflicts manually before creating a PR.');
    console.log('  Resolve conflicts on GitHub, then re-run with --create-pr flag.');
    console.log('');
    return;
  }

  if (createPRFlag && targetEnv) {
    console.log('[5/5] Creating PR to ' + targetEnv.toUpperCase() + '...');
    
    const envMap = ENV_BRANCH_MAP[projectKey];
    const baseBranch = envMap[targetEnv.toLowerCase()];
    
    if (!baseBranch) {
      throw new Error('Invalid environment: \"' + targetEnv + '\". Supported: uat, prod');
    }

    const prTitle = Release ;
    const ticketList = mergeResults.map(pr => - : ).join('\n');
    const prBody = ## Release \n\n +
                   **Project:** \n +
                   **Environment:** \n +
                   **Target Branch:** \n\n +
                   ### Tickets Included\n\n\n\n +
                   ### Release Notes\n\n +
                   <!-- Add release notes here -->\n;

    const pr = await createPR(repo, releaseBranch, baseBranch, prTitle, prBody);
    console.log('  ✓ PR #' + pr.number + ' created!');
    console.log('  URL: ' + pr.url);
    console.log('');
  } else {
    console.log('[5/5] Skipping PR creation (use --create-pr flag to create PR)');
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ✓ RELEASE BRANCH CREATED SUCCESSFULLY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Branch: ' + releaseBranch);
  console.log('  Tickets Merged: ' + merged + '/' + openPRs.length);
  console.log('');
  
  if (!createPRFlag) {
    console.log('  To create a PR, run:');
    console.log('  node scripts/create-release-branch.js ' + projectInput + ' ' + version + ' uat --create-pr');
    console.log('  node scripts/create-release-branch.js ' + projectInput + ' ' + version + ' prod --create-pr');
  }
  console.log('');
}

const args = process.argv.slice(2);
const projectInput = args[0];
const version = args[1];
const targetEnv = args[2];
const createPRFlag = args.includes('--create-pr');

if (!projectInput || !version) {
  console.error('Usage: node scripts/create-release-branch.js <project> <version> [environment] [--create-pr]');
  console.error('');
  console.error('Arguments:');
  console.error('  project      : Nexus or Pact-X');
  console.error('  version      : Release version (e.g., 3.51.0)');
  console.error('  environment  : uat or prod (optional, required with --create-pr)');
  console.error('  --create-pr  : Create PR after merging tickets');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/create-release-branch.js Nexus 3.51.0');
  console.error('  node scripts/create-release-branch.js Pact-X 2.10.0 uat --create-pr');
  console.error('  node scripts/create-release-branch.js AINEX 3.51.0 prod --create-pr');
  process.exit(1);
}

if (createPRFlag && !targetEnv) {
  console.error('Error: --create-pr flag requires an environment (uat or prod)');
  process.exit(1);
}

run(projectInput, version, targetEnv, createPRFlag).catch((err) => {
  console.error('Error: ' + err.message);
  process.exit(1);
});
