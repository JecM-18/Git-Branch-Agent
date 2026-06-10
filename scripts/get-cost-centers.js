#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');

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
 * Get available cost center options for a project and issue type
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
    if (!project) return null;
    
    const issueType = project.issuetypes && project.issuetypes[0];
    if (!issueType) return null;
    
    const costCenterField = issueType.fields && issueType.fields.customfield_10103;
    if (!costCenterField) return null;
    
    return {
      fieldName: costCenterField.name,
      required: costCenterField.required,
      allowedValues: costCenterField.allowedValues ? costCenterField.allowedValues.map(v => v.value) : []
    };
  } catch (err) {
    console.error('Failed to fetch cost center options:', err.message);
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  validateEnv();

  const projectArg = process.argv[2];

  if (!projectArg) {
    console.error('Usage: node scripts/get-cost-centers.js <PROJECT>');
    console.error('  PROJECT: ainex | aipact');
    console.error('');
    console.error('Example: node scripts/get-cost-centers.js aipact');
    process.exit(1);
  }

  const projectKey = projectArg.toUpperCase();

  if (!['AINEX', 'AIPACT'].includes(projectKey)) {
    console.error(`Invalid project: "${projectArg}". Supported: ainex, aipact`);
    process.exit(1);
  }

  console.log(`Fetching cost center options for ${projectKey}...\n`);

  try {
    // Get issue types first
    const issueTypes = await getProjectIssueTypes(projectKey);
    
    if (!issueTypes.length) {
      console.log('No issue types found for this project.');
      return;
    }

    // Check Task issue type (most common)
    const taskType = issueTypes.find(t => t.name.toLowerCase() === 'task');
    
    if (!taskType) {
      console.log('Task issue type not found. Available types:');
      issueTypes.forEach(t => console.log(`  - ${t.name} (ID: ${t.id})`));
      return;
    }

    const costCenterInfo = await getCostCenterOptions(projectKey, taskType.id);

    if (!costCenterInfo) {
      console.log('Cost Center field (customfield_10103) not found for Task issue type.');
      console.log('This field may not be required for this project.');
      return;
    }

    console.log('Cost Center Field Information:');
    console.log(`  Field Name: ${costCenterInfo.fieldName}`);
    console.log(`  Required: ${costCenterInfo.required ? 'Yes' : 'No'}`);
    console.log('');
    
    if (costCenterInfo.allowedValues.length > 0) {
      console.log('Available Cost Centers:');
      costCenterInfo.allowedValues.forEach((value, index) => {
        console.log(`  ${index + 1}. ${value}`);
      });
    } else {
      console.log('No predefined cost center values found.');
    }
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
