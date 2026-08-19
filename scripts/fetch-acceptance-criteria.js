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
  };
}

// ─── ADF to plain text converter ──────────────────────────────────────────────
function adfToText(node, depth = 0) {
  if (!node) return '';
  if (typeof node === 'string') return node;

  let text = '';

  if (node.type === 'text') {
    return node.text || '';
  }

  if (node.type === 'hardBreak') return '\n';

  if (node.type === 'heading') {
    const level = node.attrs && node.attrs.level || 1;
    const prefix = '#'.repeat(level) + ' ';
    const inner = (node.content || []).map(c => adfToText(c, depth)).join('');
    return prefix + inner + '\n\n';
  }

  if (node.type === 'paragraph') {
    const inner = (node.content || []).map(c => adfToText(c, depth)).join('');
    return inner + '\n\n';
  }

  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content || []).map((item, i) => {
      const prefix = node.type === 'orderedList' ? `${i + 1}. ` : '- ';
      const inner = (item.content || []).map(c => adfToText(c, depth + 1)).join('').trim();
      return '  '.repeat(depth) + prefix + inner;
    }).join('\n') + '\n\n';
  }

  if (node.type === 'listItem') {
    return (node.content || []).map(c => adfToText(c, depth)).join('');
  }

  if (node.type === 'table') {
    return (node.content || []).map(row => adfToText(row, depth)).join('') + '\n';
  }

  if (node.type === 'tableRow') {
    const cells = (node.content || []).map(cell => adfToText(cell, depth).trim());
    return '| ' + cells.join(' | ') + ' |\n';
  }

  if (node.type === 'tableHeader' || node.type === 'tableCell') {
    return (node.content || []).map(c => adfToText(c, depth)).join('').trim();
  }

  if (node.type === 'codeBlock') {
    const inner = (node.content || []).map(c => adfToText(c, depth)).join('');
    return '```\n' + inner + '\n```\n\n';
  }

  if (node.type === 'blockquote') {
    const inner = (node.content || []).map(c => adfToText(c, depth)).join('');
    return inner.split('\n').map(l => '> ' + l).join('\n') + '\n';
  }

  if (node.type === 'mediaGroup' || node.type === 'mediaSingle') {
    return '[attachment]\n';
  }

  // Generic: recurse into content
  if (node.content && Array.isArray(node.content)) {
    text = node.content.map(c => adfToText(c, depth)).join('');
  }

  return text;
}

// ─── Fetch ticket details ─────────────────────────────────────────────────────
async function fetchTicketDetails(ticket) {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${ticket}`;

  try {
    const { data } = await axios.get(url, {
      headers: createAuthHeaders(),
    });

    const fields = data.fields;
    const result = {
      key: data.key,
      summary: fields.summary || '(none)',
      status: fields.status ? fields.status.name : '(unknown)',
      issueType: fields.issuetype ? fields.issuetype.name : '(unknown)',
      priority: fields.priority ? fields.priority.name : '(unknown)',
      assignee: fields.assignee ? fields.assignee.displayName : '(unassigned)',
      labels: fields.labels || [],
      description: '',
      acceptanceCriteria: '',
    };

    // Convert description (ADF) to text
    if (fields.description) {
      result.description = adfToText(fields.description).trim();
    }

    // Search for acceptance criteria in known custom fields
    // Common field IDs: customfield_10016 (Jira Cloud default for AC)
    const acFieldIds = [
      'customfield_10016', // Common AC field
      'customfield_10017',
      'customfield_10018',
      'customfield_10020',
      'customfield_10035',
    ];

    for (const fieldId of acFieldIds) {
      if (fields[fieldId]) {
        const val = fields[fieldId];
        if (typeof val === 'string') {
          result.acceptanceCriteria = val;
          break;
        } else if (typeof val === 'object' && val.type === 'doc') {
          result.acceptanceCriteria = adfToText(val).trim();
          break;
        }
      }
    }

    // If no dedicated AC field found, check if description contains AC section
    if (!result.acceptanceCriteria && result.description) {
      const acMatch = result.description.match(/(?:acceptance\s+criteria|ac[\s:]*\n)([\s\S]*?)(?:\n#|\n---|\n\*\*[A-Z]|$)/i);
      if (acMatch) {
        result.acceptanceCriteria = acMatch[0].trim();
      }
    }

    return result;
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN.');
    if (status === 404) throw new Error(`Jira ticket "${ticket}" not found.`);
    throw new Error(`Jira API error (${status || 'network'}): ${err.message}`);
  }
}

// ─── Fetch all field definitions to find AC field dynamically ─────────────────
async function findAcceptanceCriteriaField() {
  const { JIRA_BASE_URL } = process.env;
  const url = `${JIRA_BASE_URL}/rest/api/3/field`;

  try {
    const { data } = await axios.get(url, { headers: createAuthHeaders() });
    const acFields = data.filter(f =>
      f.name && f.name.toLowerCase().includes('acceptance') ||
      f.name && f.name.toLowerCase().includes('ac') && f.name.toLowerCase().includes('criteria')
    );
    return acFields;
  } catch {
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run(ticket) {
  validateEnv();

  // Try to find the AC field dynamically on first run
  const acFields = await findAcceptanceCriteriaField();
  const details = await fetchTicketDetails(ticket);

  // If we found AC fields dynamically and didn't get AC from hardcoded fields, try them
  if (!details.acceptanceCriteria && acFields.length > 0) {
    const { JIRA_BASE_URL } = process.env;
    const url = `${JIRA_BASE_URL}/rest/api/3/issue/${ticket}`;
    try {
      const { data } = await axios.get(url, { headers: createAuthHeaders() });
      for (const field of acFields) {
        if (data.fields[field.id]) {
          const val = data.fields[field.id];
          if (typeof val === 'string') {
            details.acceptanceCriteria = val;
            break;
          } else if (typeof val === 'object' && val.type === 'doc') {
            details.acceptanceCriteria = adfToText(val).trim();
            break;
          }
        }
      }
    } catch {
      // Silently ignore — we already have the main details
    }
  }

  // Output
  console.log('__TICKET_DATA_START__');
  console.log(`# ${details.key}: ${details.summary}`);
  console.log('');
  console.log(`- **Type:** ${details.issueType}`);
  console.log(`- **Status:** ${details.status}`);
  console.log(`- **Priority:** ${details.priority}`);
  console.log(`- **Assignee:** ${details.assignee}`);
  if (details.labels.length) {
    console.log(`- **Labels:** ${details.labels.join(', ')}`);
  }
  console.log('');

  if (details.description) {
    console.log('## Description');
    console.log(details.description);
    console.log('');
  }

  if (details.acceptanceCriteria) {
    console.log('## Acceptance Criteria');
    console.log(details.acceptanceCriteria);
    console.log('');
  } else {
    console.log('## Acceptance Criteria');
    console.log('(No dedicated acceptance criteria field found. Check the description above for AC.)');
    console.log('');
  }

  console.log('__TICKET_DATA_END__');
}

// ─── Entry ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (!args[0]) {
  console.error('Usage: node scripts/fetch-acceptance-criteria.js <TICKET>');
  console.error('  e.g. node scripts/fetch-acceptance-criteria.js AINEX-162');
  process.exit(1);
}

const ticket = args[0].toUpperCase();
if (!/^[A-Z]+-\d+$/.test(ticket)) {
  console.error(`Invalid ticket format: "${args[0]}". Expected format: PROJECT-123`);
  process.exit(1);
}

run(ticket).catch((err) => {
  console.error('Error: ' + err.message);
  process.exit(1);
});
