#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

// ─── Project Configuration ────────────────────────────────────────────────────
const PROJECT_CONFIG = {
  AINEX: {
    projectKey: 'AINEX',
    projectId: null, // Will be fetched dynamically
    boardName: 'AI Nexus'
  },
  AIPACT: {
    projectKey: 'AIPACT',
    projectId: null, // Will be fetched dynamically
    boardName: 'AI PactX'
  }
};

// Jira issue type IDs (these are typically standard across Jira Cloud instances)
const ISSUE_TYPES = {
  story: { name: 'Story', id: '10001' },
  task: { name: 'Task', id: '10002' },
  support: { name: 'Support', id: '10004' }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function validateEnv() {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}\nCopy .env.example to .env and fill in the values.`);
  }
}

function createAuthHeaders() {
  const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

// ─── Jira API Functions ───────────────────────────────────────────────────────
/**
 * Get current user's account ID
 */
async function getCurrentUser() {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/myself`;
  
  try {
    const { data } = await axios.get(url, { headers: createAuthHeaders() });
    return data.accountId;
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN.');
    throw new Error(`Failed to get current user: ${err.message}`);
  }
}

/**
 * Get project ID for a given project key
 */
async function getProjectId(projectKey) {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/project/${projectKey}`;
  
  try {
    const { data } = await axios.get(url, { headers: createAuthHeaders() });
    return data.id;
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN.');
    if (status === 404) throw new Error(`Project "${projectKey}" not found in Jira.`);
    throw new Error(`Jira API error (${status || 'network'}): ${err.message}`);
  }
}

/**
 * Get available issue types for a project
 */
async function getProjectIssueTypes(projectKey) {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/project/${projectKey}`;
  
  try {
    const { data } = await axios.get(url, { headers: createAuthHeaders() });
    return data.issueTypes || [];
  } catch (err) {
    const status = err.response && err.response.status;
    throw new Error(`Failed to get issue types: ${err.message}`);
  }
}

/**
 * Get available cost center options for a project
 */
async function getCostCenterOptions(projectKey, issueTypeId) {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/createmeta`;
  
  try {
    const { data } = await axios.get(url, {
      headers: createAuthHeaders(),
      params: {
        projectKeys: projectKey,
        issuetypeIds: issueTypeId,
        expand: 'projects.issuetypes.fields'
      }
    });
    
    const project = data.projects && data.projects[0];
    if (!project) return [];
    
    const issueType = project.issuetypes && project.issuetypes[0];
    if (!issueType) return [];
    
    const costCenterField = issueType.fields && issueType.fields.customfield_10103;
    if (!costCenterField || !costCenterField.allowedValues) return [];
    
    return costCenterField.allowedValues.map(v => v.value);
  } catch (err) {
    console.error('Failed to fetch cost center options:', err.message);
    return [];
  }
}

/**
 * Create a Jira issue
 */
async function createJiraIssue(projectKey, issueTypeName, summary, description = '', costCenter = '', assignToMe = false) {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/issue`;

  // First, get the project's issue types to find the correct ID
  const issueTypes = await getProjectIssueTypes(projectKey);
  const issueType = issueTypes.find(
    (it) => it.name.toLowerCase() === issueTypeName.toLowerCase()
  );

  if (!issueType) {
    // List available issue types
    const available = issueTypes.map(it => it.name).join(', ');
    throw new Error(
      `Issue type "${issueTypeName}" not found in project ${projectKey}. ` +
      `Available types: ${available}`
    );
  }

  const payload = {
    fields: {
      project: {
        key: projectKey
      },
      summary: summary,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: description || 'No description provided.'
              }
            ]
          }
        ]
      },
      issuetype: {
        id: issueType.id
      }
    }
  };

  // Add cost center if provided (required field for some projects)
  if (costCenter) {
    payload.fields.customfield_10103 = { value: costCenter };
  }

  // Add assignee if requested
  if (assignToMe) {
    const accountId = await getCurrentUser();
    payload.fields.assignee = { accountId };
  }

  try {
    const { data } = await axios.post(url, payload, { headers: createAuthHeaders() });
    return {
      key: data.key,
      id: data.id,
      self: data.self
    };
  } catch (err) {
    const status = err.response && err.response.status;
    const detail = err.response && err.response.data && JSON.stringify(err.response.data, null, 2);
    if (status === 401) throw new Error('Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN.');
    if (status === 400) throw new Error(`Invalid request: ${detail || err.message}`);
    throw new Error(`Jira API error (${status || 'network'}): ${detail || err.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  validateEnv();

  // Usage: node create-jira-ticket.js <PROJECT> <TYPE> <TITLE> [DESCRIPTION] [COST_CENTER] [ASSIGN_TO_ME]
  // e.g.:  node create-jira-ticket.js ainex task "Implement login feature"
  //        node create-jira-ticket.js aipact story "User can view dashboard" "As a user, I want..." "IT" "true"
  const [,, projectArg, typeArg, title, description, costCenter, assignToMeArg] = process.argv;

  if (!projectArg || !typeArg || !title) {
    console.error('Usage: node scripts/create-jira-ticket.js <PROJECT> <TYPE> <TITLE> [DESCRIPTION] [COST_CENTER] [ASSIGN_TO_ME]');
    console.error('  PROJECT     : ainex | aipact');
    console.error('  TYPE        : story | task | support');
    console.error('  TITLE       : Ticket summary/title (required)');
    console.error('  DESCRIPTION : Optional detailed description');
    console.error('  COST_CENTER : Cost center (e.g., IT, HR, Finance)');
    console.error('  ASSIGN_TO_ME: "true" to assign to yourself');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/create-jira-ticket.js ainex task "Fix login bug"');
    console.error('  node scripts/create-jira-ticket.js aipact story "User dashboard" "As a user..." "IT" "true"');
    process.exit(1);
  }

  // Normalize inputs
  const projectInput = projectArg.toUpperCase();
  const typeInput = typeArg.toLowerCase();

  // Validate project
  const projectConfig = PROJECT_CONFIG[projectInput];
  if (!projectConfig) {
    console.error(`Invalid project: "${projectArg}". Supported: ainex, aipact`);
    process.exit(1);
  }

  // Validate issue type
  const validTypes = ['story', 'task', 'support'];
  if (!validTypes.includes(typeInput)) {
    console.error(`Invalid issue type: "${typeArg}". Supported: story, task, support`);
    process.exit(1);
  }

  const assignToMe = assignToMeArg === 'true';

  console.log(`Creating ${typeInput} ticket in ${projectConfig.boardName} (${projectConfig.projectKey})...`);
  console.log(`  Title: ${title}`);
  if (description) {
    console.log(`  Description: ${description}`);
  }
  if (costCenter) {
    console.log(`  Cost Center: ${costCenter}`);
  }
  if (assignToMe) {
    console.log(`  Assign to: Me`);
  }
  console.log('');

  try {
    const result = await createJiraIssue(
      projectConfig.projectKey,
      typeInput,
      title,
      description || '',
      costCenter || '',
      assignToMe
    );

    console.log('✓ Ticket created successfully!');
    console.log('');
    console.log(`  Ticket: ${result.key}`);
    console.log(`  URL: ${process.env.JIRA_BASE_URL}/browse/${result.key}`);
    console.log('');
  } catch (err) {
    console.error('✗ Failed to create ticket:');
    console.error(`  ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
