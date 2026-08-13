#!/usr/bin/env node
'use strict';

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGitHub = !!process.env.GITHUB_TOKEN && process.env.AI_PROVIDER === 'github';
  
  if (!hasOpenAI && !hasGitHub) {
    console.log('⚠ AI evaluation requires AI provider configuration');
    console.log('  Option 1: Add OPENAI_API_KEY to .env (recommended)');
    console.log('  Option 2: Set AI_PROVIDER=github and use GITHUB_TOKEN');
    console.log('');
    return false;
  }
  
  if (hasGitHub) {
    console.log('ℹ Using GitHub Models API for AI evaluation');
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

// ─── Folder Management ────────────────────────────────────────────────────────
function getReportsFolder() {
  // Get Documents folder path (cross-platform)
  const homeDir = require('os').homedir();
  const documentsPath = path.join(homeDir, 'Documents', 'Copilot Review');
  
  // Create folder if it doesn't exist
  if (!fs.existsSync(documentsPath)) {
    fs.mkdirSync(documentsPath, { recursive: true });
    console.log('  ✓ Created folder: ' + documentsPath);
  }
  
  return documentsPath;
}

function cleanupOldReports() {
  const reportsFolder = getReportsFolder();
  const MAX_FILES = 20; // Keep last 20 reports
  const MAX_AGE_DAYS = 30; // Remove files older than 30 days
  
  try {
    const files = fs.readdirSync(reportsFolder)
      .filter(f => f.startsWith('pr-') && f.includes('-evaluation-'))
      .map(f => ({
        name: f,
        path: path.join(reportsFolder, f),
        stat: fs.statSync(path.join(reportsFolder, f))
      }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs); // Sort by modified time, newest first
    
    // Remove files older than MAX_AGE_DAYS
    const now = Date.now();
    const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;
    
    files.forEach((file, index) => {
      const age = now - file.stat.mtimeMs;
      if (age > maxAge || index >= MAX_FILES) {
        fs.unlinkSync(file.path);
        removed++;
      }
    });
    
    if (removed > 0) {
      console.log('  ✓ Cleaned up ' + removed + ' old report(s)');
    }
  } catch (err) {
    console.warn('  Warning: Could not cleanup old reports: ' + err.message);
  }
}

// ─── Input Parsing ────────────────────────────────────────────────────────────
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
    
    const prs = data.filter((pr) => {
      const headBranch = pr.head.ref;
      return headBranch.startsWith('feature/' + branchPrefix) || 
             headBranch.startsWith('bug/' + branchPrefix);
    });
    
    if (prs.length === 0) return null;
    if (prs.length === 1) return prs[0].number;
    
    const midPR = prs.find((pr) => pr.head.ref.endsWith('-mid'));
    return midPR ? midPR.number : prs[0].number;
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

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
      state: data.state,
      url: data.html_url,
    };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
    if (status === 404) throw new Error('PR #' + prNumber + ' not found in ' + org + '/' + repo + '.');
    throw new Error('GitHub API error (' + (status || 'network') + '): ' + err.message);
  }
}

async function fetchPRComments(repo, prNumber) {
  const org = process.env.GITHUB_ORG;
  const comments = [];
  
  try {
    // Use GraphQL API to fetch comments with resolved status
    // This is the most reliable way to check if conversations are resolved
    const graphqlQuery = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 100) {
                  nodes {
                    id
                    databaseId
                    author {
                      login
                      ... on Bot {
                        __typename
                      }
                    }
                    body
                    path
                    line
                    createdAt
                  }
                }
              }
            }
            reviews(first: 100) {
              nodes {
                id
                databaseId
                author {
                  login
                  ... on Bot {
                    __typename
                  }
                }
                body
                createdAt
              }
            }
          }
        }
      }
    `;
    
    const { data: graphqlData } = await axios.post(
      'https://api.github.com/graphql',
      {
        query: graphqlQuery,
        variables: { owner: org, repo: repo, number: parseInt(prNumber) }
      },
      { headers: { ...ghHeaders(), 'Content-Type': 'application/json' } }
    );
    
    if (graphqlData && graphqlData.data && graphqlData.data.repository && graphqlData.data.repository.pullRequest) {
      const pr = graphqlData.data.repository.pullRequest;
      
      // Process review threads (inline comments with resolution status)
      if (pr.reviewThreads && pr.reviewThreads.nodes) {
        for (const thread of pr.reviewThreads.nodes) {
          // Skip resolved threads
          if (thread.isResolved) {
            continue;
          }
          
          // Add unresolved comments from this thread
          if (thread.comments && thread.comments.nodes) {
            for (const comment of thread.comments.nodes) {
              if (!comment.author) continue;
              
              comments.push({
                id: comment.databaseId,
                type: 'review_comment',
                user: comment.author.login,
                userType: comment.author.__typename === 'Bot' ? 'Bot' : 'User',
                body: comment.body,
                file: comment.path || '(no file)',
                line: comment.line || null,
                createdAt: comment.createdAt,
              });
            }
          }
        }
      }
      
      // Process review summaries (don't have resolution status)
      if (pr.reviews && pr.reviews.nodes) {
        for (const review of pr.reviews.nodes) {
          if (review.body && review.body.trim() && review.author) {
            comments.push({
              id: review.databaseId,
              type: 'review',
              user: review.author.login,
              userType: review.author.__typename === 'Bot' ? 'Bot' : 'User',
              body: review.body,
              file: '(review summary)',
              line: null,
              createdAt: review.createdAt,
            });
          }
        }
      }
    } else {
      throw new Error('Invalid GraphQL response structure');
    }
    
    return comments;
  } catch (err) {
    // If GraphQL fails, fall back to REST API (but won't filter resolved comments)
    console.warn('  Note: Could not use GraphQL API to check resolved status, falling back to REST API');
    console.warn('  (Resolved comments will be included)');
    
    try {
      const { data: reviewComments } = await axios.get(
        'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber + '/comments',
        { headers: ghHeaders(), params: { per_page: 100 } }
      );
      
      for (const comment of reviewComments) {
        comments.push({
          id: comment.id,
          type: 'review_comment',
          user: comment.user.login,
          userType: comment.user.type,
          body: comment.body,
          file: comment.path || '(no file)',
          line: comment.line || comment.original_line || null,
          createdAt: comment.created_at,
        });
      }
      
      // Fetch review summaries
      const { data: reviews } = await axios.get(
        'https://api.github.com/repos/' + org + '/' + repo + '/pulls/' + prNumber + '/reviews',
        { headers: ghHeaders(), params: { per_page: 100 } }
      );
      
      for (const review of reviews) {
        if (review.body && review.body.trim()) {
          comments.push({
            id: review.id,
            type: 'review',
            user: review.user.login,
            userType: review.user.type,
            body: review.body,
            file: '(review summary)',
            line: null,
            createdAt: review.submitted_at,
          });
        }
      }
      
      return comments;
    } catch (fallbackErr) {
      const status = fallbackErr.response && fallbackErr.response.status;
      if (status === 401) throw new Error('GitHub authentication failed. Check GITHUB_PAT.');
      if (status === 404) throw new Error('Comments not found for PR #' + prNumber + ' in ' + org + '/' + repo + '.');
      throw new Error('GitHub API error (' + (status || 'network') + '): ' + fallbackErr.message);
    }
  }
}

function filterCopilotComments(comments) {
  return comments.filter((c) => {
    const userLower = c.user.toLowerCase();
    const isBot = c.userType === 'Bot';
    const isCopilot = userLower.includes('copilot') || 
                      userLower.includes('github-advanced-security') ||
                      userLower.includes('dependabot');
    return isBot && isCopilot;
  });
}

// ─── AI Evaluation ────────────────────────────────────────────────────────────
async function callAI(apiBase, apiKey, model, messages) {
  const response = await axios.post(
    apiBase + '/chat/completions',
    {
      model: model,
      messages: messages,
      temperature: 0.3,
      max_tokens: 300,
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

async function evaluateComment(comment, apiBase, apiKey, model) {
  const prompt = `Evaluate this GitHub Copilot code review comment:

File: ${comment.file}
Line: ${comment.line || 'N/A'}
Comment: ${comment.body}

Provide a structured evaluation in this exact format:
SHOULD_APPLY: [Yes/No]
PRIORITY: [High/Medium/Low]
CATEGORY: [Security/Bugs/Performance/Quality/Style]
REASONING: [1-2 sentence explanation]`;

  try {
    const response = await callAI(
      apiBase,
      apiKey,
      model,
      [
        {
          role: 'system',
          content: 'You are a code review expert. Evaluate Copilot suggestions and classify them. Be concise and accurate.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ]
    );
    
    // Parse response
    const shouldApplyMatch = response.match(/SHOULD_APPLY:\s*(Yes|No)/i);
    const priorityMatch = response.match(/PRIORITY:\s*(High|Medium|Low)/i);
    const categoryMatch = response.match(/CATEGORY:\s*(Security|Bugs|Performance|Quality|Style)/i);
    const reasoningMatch = response.match(/REASONING:\s*(.+?)(?:\n|$)/i);
    
    return {
      shouldApply: shouldApplyMatch ? shouldApplyMatch[1].toLowerCase() === 'yes' : false,
      priority: priorityMatch ? priorityMatch[1] : 'Medium',
      category: categoryMatch ? categoryMatch[1] : 'Quality',
      reasoning: reasoningMatch ? reasoningMatch[1].trim() : 'Unable to parse reasoning',
    };
  } catch (err) {
    console.warn('  Warning: Failed to evaluate comment #' + comment.id + ': ' + err.message);
    return {
      shouldApply: false,
      priority: 'Low',
      category: 'Unknown',
      reasoning: 'Evaluation failed: ' + err.message,
    };
  }
}

async function evaluateAllComments(comments) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN;
  const model = process.env.AI_MODEL || 'gpt-4o';
  const isGitHubModels = process.env.AI_PROVIDER === 'github';
  const apiBase = isGitHubModels 
    ? 'https://models.inference.ai.azure.com'
    : (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1');
  
  console.log(`  Evaluating ${comments.length} comment${comments.length !== 1 ? 's' : ''}...`);
  
  const evaluations = [];
  
  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    console.log(`  Processing comment ${i + 1}/${comments.length}...`);
    
    const evaluation = await evaluateComment(comment, apiBase, apiKey, model);
    
    evaluations.push({
      ...comment,
      ...evaluation,
    });
    
    // Rate limiting: small delay between requests
    if (i < comments.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return evaluations;
}

// ─── Output Formatting ────────────────────────────────────────────────────────
function generateConsoleOutput(pr, evaluations) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🤖 COPILOT COMMENT EVALUATION - ACTIONABLE REPORT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  PR #' + pr.number + ': ' + pr.title);
  console.log('  URL: ' + pr.url);
  console.log('');
  
  const stats = {
    total: evaluations.length,
    shouldApply: evaluations.filter(e => e.shouldApply).length,
    high: evaluations.filter(e => e.priority === 'High').length,
    medium: evaluations.filter(e => e.priority === 'Medium').length,
    low: evaluations.filter(e => e.priority === 'Low').length,
  };
  
  console.log('  📊 Summary:');
  console.log('    Total Comments           : ' + stats.total);
  console.log('    Recommended to Apply     : ' + stats.shouldApply + ' (' + Math.round(stats.shouldApply/stats.total*100) + '%)');
  console.log('    🔴 High Priority         : ' + stats.high);
  console.log('    🟡 Medium Priority       : ' + stats.medium);
  console.log('    🟢 Low Priority          : ' + stats.low);
  console.log('');
  console.log('  💡 Tip: Ask Copilot to apply fixes using:');
  console.log('     "@workspace /fix [File:Line]"');
  console.log('');
  
  // Group by priority
  const byPriority = {
    High: evaluations.filter(e => e.priority === 'High'),
    Medium: evaluations.filter(e => e.priority === 'Medium'),
    Low: evaluations.filter(e => e.priority === 'Low'),
  };
  
  for (const priority of ['High', 'Medium', 'Low']) {
    const items = byPriority[priority];
    if (items.length === 0) continue;
    
    const icon = priority === 'High' ? '🔴' : priority === 'Medium' ? '🟡' : '🟢';
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  ${icon} ${priority.toUpperCase()} PRIORITY (${items.length})`);
    console.log('───────────────────────────────────────────────────────────────');
    console.log('');
    
    for (const item of items) {
      const applyIcon = item.shouldApply ? '✅ APPLY' : '⏭️  SKIP';
      const lineRef = item.line ? ':' + item.line : '';
      console.log(`  ${applyIcon} [${item.category}] ${item.file}${lineRef}`);
      console.log(`    💬 ${item.body.substring(0, 100)}${item.body.length > 100 ? '...' : ''}`);
      console.log(`    📝 ${item.reasoning}`);
      if (item.shouldApply && item.line) {
        console.log(`    🔧 Ask Copilot: "@workspace /fix ${item.file}:${item.line}"`);
      }
      console.log('');
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ✅ EVALUATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  📁 Reports will be saved to: Documents\\Copilot Review');
  console.log('  🎯 Next Steps:');
  console.log('     1. Open the .md file in VS Code');
  console.log('     2. Review high-priority items');
  console.log('     3. Ask Copilot to implement fixes');
  console.log('     4. Check off completed items');
  console.log('');
}

function generateMarkdownReport(pr, evaluations) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `pr-${pr.number}-evaluation-${timestamp}.md`;
  
  const stats = {
    total: evaluations.length,
    shouldApply: evaluations.filter(e => e.shouldApply).length,
    high: evaluations.filter(e => e.priority === 'High').length,
    medium: evaluations.filter(e => e.priority === 'Medium').length,
    low: evaluations.filter(e => e.priority === 'Low').length,
  };
  
  let content = `# 🤖 Copilot Comment Evaluation Report\n\n`;
  content += `> **Instructions for GitHub Copilot:** This report evaluates code review suggestions. Use this file to:\n`;
  content += `> - Generate code fixes for high-priority items marked with ✓\n`;
  content += `> - Ask Copilot: "@workspace /fix Apply the high-priority changes from this evaluation"\n`;
  content += `> - Review each item and check the boxes as you apply them\n\n`;
  
  content += `**PR #${pr.number}:** ${pr.title}\n\n`;
  content += `**URL:** ${pr.url}\n\n`;
  content += `**Generated:** ${new Date().toLocaleString()}\n\n`;
  content += `---\n\n`;
  content += `## 📊 Summary\n\n`;
  content += `- **Total Comments:** ${stats.total}\n`;
  content += `- **Recommended to Apply:** ${stats.shouldApply} (${Math.round(stats.shouldApply/stats.total*100)}%)\n`;
  content += `- **High Priority:** ${stats.high} 🔴\n`;
  content += `- **Medium Priority:** ${stats.medium} 🟡\n`;
  content += `- **Low Priority:** ${stats.low} 🟢\n\n`;
  content += `---\n\n`;
  
  // Group by priority
  const byPriority = {
    High: evaluations.filter(e => e.priority === 'High'),
    Medium: evaluations.filter(e => e.priority === 'Medium'),
    Low: evaluations.filter(e => e.priority === 'Low'),
  };
  
  // Quick action checklist
  content += `## ✅ Quick Action Checklist\n\n`;
  content += `Mark items as you apply them:\n\n`;
  
  for (const priority of ['High', 'Medium', 'Low']) {
    const items = byPriority[priority].filter(e => e.shouldApply);
    if (items.length === 0) continue;
    
    const icon = priority === 'High' ? '🔴' : priority === 'Medium' ? '🟡' : '🟢';
    content += `### ${icon} ${priority} Priority\n\n`;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const lineRef = item.line ? `:${item.line}` : '';
      content += `- [ ] **[${item.category}]** \`${item.file}${lineRef}\`\n`;
      content += `  - ${item.body.substring(0, 100).replace(/\n/g, ' ')}${item.body.length > 100 ? '...' : ''}\n`;
    }
    content += `\n`;
  }
  
  content += `---\n\n`;
  
  // Detailed breakdown with file links
  for (const priority of ['High', 'Medium', 'Low']) {
    const items = byPriority[priority];
    if (items.length === 0) continue;
    
    const icon = priority === 'High' ? '🔴' : priority === 'Medium' ? '🟡' : '🟢';
    content += `## ${icon} ${priority} Priority Issues (${items.length})\n\n`;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const applyBadge = item.shouldApply ? '✅ APPLY' : '⏭️ SKIP';
      const lineRef = item.line ? `#L${item.line}` : '';
      
      content += `### ${i + 1}. ${applyBadge} [${item.category}]\n\n`;
      content += `**File:** \`${item.file}${item.line ? ':' + item.line : ''}\`\n\n`;
      
      if (item.line) {
        content += `**Quick Jump:** [Open in VS Code](vscode://file/${item.file}:${item.line})\n\n`;
      }
      
      content += `**Copilot's Comment:**\n\`\`\`\n${item.body}\n\`\`\`\n\n`;
      
      content += `**AI Evaluation:**\n`;
      content += `- **Recommendation:** ${item.shouldApply ? '✅ Apply this change' : '⏭️ Skip this change'}\n`;
      content += `- **Priority Level:** ${item.priority}\n`;
      content += `- **Impact Category:** ${item.category}\n`;
      content += `- **Reasoning:** ${item.reasoning}\n\n`;
      
      if (item.shouldApply) {
        content += `**Suggested Action:**\n`;
        content += `\`\`\`\n`;
        content += `@workspace Review ${item.file}${item.line ? ' line ' + item.line : ''} and apply the suggested fix\n`;
        content += `\`\`\`\n\n`;
      }
      
      content += `---\n\n`;
    }
  }
  
  // Add instructions for Copilot
  content += `## 🎯 How to Use This Report with GitHub Copilot\n\n`;
  content += `1. **Review Priority Items First:** Start with 🔴 High priority issues\n`;
  content += `2. **Ask Copilot for Fixes:** Use commands like:\n`;
  content += `   - \`@workspace /fix [File path and line number]\`\n`;
  content += `   - \`@workspace Implement the fix for [specific issue]\`\n`;
  content += `3. **Check Off Completed Items:** Mark checkboxes as you apply changes\n`;
  content += `4. **Verify Changes:** Test each fix before moving to the next\n\n`;
  
  content += `---\n\n`;
  content += `*Report generated by Git Branch Agent | Powered by AI Code Analysis*\n`;
  
  const reportsFolder = getReportsFolder();
  const filepath = path.join(reportsFolder, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  
  return filepath;
}

function generateTextReport(pr, evaluations) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `pr-${pr.number}-evaluation-${timestamp}.txt`;
  
  const stats = {
    total: evaluations.length,
    shouldApply: evaluations.filter(e => e.shouldApply).length,
    high: evaluations.filter(e => e.priority === 'High').length,
    medium: evaluations.filter(e => e.priority === 'Medium').length,
    low: evaluations.filter(e => e.priority === 'Low').length,
  };
  
  let content = ``;
  content += `${'='.repeat(75)}\n`;
  content += `  COPILOT COMMENT EVALUATION REPORT - ACTIONABLE FORMAT\n`;
  content += `${'='.repeat(75)}\n\n`;
  
  content += `INSTRUCTIONS FOR GITHUB COPILOT:\n`;
  content += `${'-'.repeat(75)}\n`;
  content += `This report contains evaluated code review suggestions from GitHub Copilot.\n`;
  content += `Use this file to generate fixes by asking:\n`;
  content += `  "@workspace /fix Apply changes from evaluation report"\n`;
  content += `  "@workspace Implement fix for [File:Line]"\n\n`;
  content += `Focus on HIGH PRIORITY items marked with [APPLY] first.\n`;
  content += `${'='.repeat(75)}\n\n`;
  
  content += `PR DETAILS\n`;
  content += `${'-'.repeat(75)}\n`;
  content += `PR Number   : #${pr.number}\n`;
  content += `Title       : ${pr.title}\n`;
  content += `URL         : ${pr.url}\n`;
  content += `Generated   : ${new Date().toLocaleString()}\n\n`;
  
  content += `${'='.repeat(75)}\n`;
  content += `SUMMARY STATISTICS\n`;
  content += `${'-'.repeat(75)}\n`;
  content += `Total Comments           : ${stats.total}\n`;
  content += `Recommended to Apply     : ${stats.shouldApply} (${Math.round(stats.shouldApply/stats.total*100)}%)\n`;
  content += `High Priority Issues     : ${stats.high}\n`;
  content += `Medium Priority Issues   : ${stats.medium}\n`;
  content += `Low Priority Issues      : ${stats.low}\n\n`;
  
  // Group by priority
  const byPriority = {
    High: evaluations.filter(e => e.priority === 'High'),
    Medium: evaluations.filter(e => e.priority === 'Medium'),
    Low: evaluations.filter(e => e.priority === 'Low'),
  };
  
  // Quick action checklist
  content += `${'='.repeat(75)}\n`;
  content += `QUICK ACTION CHECKLIST - Mark [X] when applied\n`;
  content += `${'='.repeat(75)}\n\n`;
  
  for (const priority of ['High', 'Medium', 'Low']) {
    const items = byPriority[priority].filter(e => e.shouldApply);
    if (items.length === 0) continue;
    
    content += `${priority.toUpperCase()} PRIORITY:\n`;
    content += `${'-'.repeat(75)}\n`;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const lineRef = item.line ? `:${item.line}` : '';
      content += `[ ] ${item.category.toUpperCase()} - ${item.file}${lineRef}\n`;
      content += `    ${item.body.substring(0, 100).replace(/\n/g, ' ')}${item.body.length > 100 ? '...' : ''}\n\n`;
    }
  }
  
  // Detailed issues
  for (const priority of ['High', 'Medium', 'Low']) {
    const items = byPriority[priority];
    if (items.length === 0) continue;
    
    content += `${'='.repeat(75)}\n`;
    content += `${priority.toUpperCase()} PRIORITY ISSUES (${items.length})\n`;
    content += `${'='.repeat(75)}\n\n`;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const applyStatus = item.shouldApply ? '[APPLY THIS]' : '[SKIP THIS]';
      const lineRef = item.line ? `:${item.line}` : '';
      
      content += `ISSUE #${i + 1}: ${applyStatus} [${item.category.toUpperCase()}]\n`;
      content += `${'-'.repeat(75)}\n`;
      content += `File Location : ${item.file}${lineRef}\n`;
      
      if (item.line) {
        content += `Quick Jump    : vscode://file/${item.file}:${item.line}\n`;
      }
      
      content += `\nCopilot's Original Comment:\n`;
      content += `${item.body}\n\n`;
      
      content += `AI Evaluation:\n`;
      content += `  Recommendation : ${item.shouldApply ? 'APPLY THIS CHANGE' : 'Skip this change'}\n`;
      content += `  Priority Level : ${item.priority}\n`;
      content += `  Impact Type    : ${item.category}\n`;
      content += `  Reasoning      : ${item.reasoning}\n\n`;
      
      if (item.shouldApply) {
        content += `Action for Copilot:\n`;
        content += `  Ask: "@workspace Review ${item.file}${item.line ? ' line ' + item.line : ''} and apply fix"\n\n`;
      }
      
      content += `${'-'.repeat(75)}\n\n`;
    }
  }
  
  content += `${'='.repeat(75)}\n`;
  content += `HOW TO USE THIS REPORT WITH GITHUB COPILOT\n`;
  content += `${'='.repeat(75)}\n\n`;
  content += `1. Open this file in VS Code\n`;
  content += `2. Start with HIGH PRIORITY items\n`;
  content += `3. For each [APPLY THIS] item, ask Copilot:\n`;
  content += `   "@workspace /fix [File:Line]" or\n`;
  content += `   "@workspace Implement the suggested fix for [issue description]"\n`;
  content += `4. Mark the checkbox [ ] -> [X] after applying each fix\n`;
  content += `5. Test changes before moving to next priority level\n\n`;
  
  content += `${'='.repeat(75)}\n`;
  content += `END OF EVALUATION REPORT\n`;
  content += `Report generated by Git Branch Agent | AI Code Analysis\n`;
  content += `${'='.repeat(75)}\n`;
  
  const reportsFolder = getReportsFolder();
  const filepath = path.join(reportsFolder, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  
  return filepath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run(input, noAi = false) {
  validateEnv();
  
  if (!noAi && !validateAIEnv()) {
    throw new Error('AI provider configuration required. See .env.example for setup instructions.');
  }
  
  const org = process.env.GITHUB_ORG;
  
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
  
  // Fetch PR details
  console.log('\nFetching PR #' + prNumber + ' from ' + org + '/' + repo + '...');
  const pr = await fetchPRDetails(repo, prNumber);
  console.log('  Title: ' + pr.title);
  console.log('  State: ' + pr.state);
  
  // Fetch comments
  console.log('\nFetching PR comments...');
  console.log('  (Skipping resolved conversations)');
  const allComments = await fetchPRComments(repo, prNumber);
  console.log('  Found ' + allComments.length + ' unresolved comment(s)');
  
  // Filter for Copilot comments
  const copilotComments = filterCopilotComments(allComments);
  console.log('  Found ' + copilotComments.length + ' Copilot comment(s)');
  
  if (copilotComments.length === 0) {
    console.log('');
    console.log('✓ No Copilot comments found in this PR.');
    console.log('  This PR has no automated code review suggestions to evaluate.');
    console.log('');
    return;
  }
  
  // --no-ai mode: output raw comments for the agent to evaluate
  if (noAi) {
    console.log('');
    console.log('__RAW_COMMENTS_DATA_START__');
    console.log(JSON.stringify({
      pr: { number: pr.number, title: pr.title, state: pr.state, url: pr.url },
      comments: copilotComments.map(c => ({
        id: c.id,
        user: c.user,
        type: c.type,
        file: c.file,
        line: c.line,
        body: c.body,
      })),
    }));
    console.log('__RAW_COMMENTS_DATA_END__');
    return;
  }
  
  // Evaluate comments
  console.log('\nEvaluating Copilot comments with AI...');
  const evaluations = await evaluateAllComments(copilotComments);
  
  // Generate console output
  generateConsoleOutput(pr, evaluations);
  
  // Cleanup old reports before generating new ones
  cleanupOldReports();
  
  // Generate reports
  console.log('Generating reports...');
  const mdPath = generateMarkdownReport(pr, evaluations);
  console.log('  ✓ Markdown report: ' + mdPath);
  
  const txtPath = generateTextReport(pr, evaluations);
  console.log('  ✓ Text report: ' + txtPath);
  
  const reportsFolder = getReportsFolder();
  console.log('');
  console.log('Reports saved to: ' + reportsFolder);
  console.log('');
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const noAiIndex = args.indexOf('--no-ai');
const noAi = noAiIndex !== -1;

if (noAiIndex !== -1) args.splice(noAiIndex, 1);

const input = args[0];

if (!input) {
  console.error('Usage: node scripts/evaluate-pr-comments.js <ticket-or-url> [--no-ai]');
  console.error('Examples:');
  console.error('  node scripts/evaluate-pr-comments.js AINEX-27');
  console.error('  node scripts/evaluate-pr-comments.js https://github.com/org/repo/pull/123');
  console.error('  node scripts/evaluate-pr-comments.js AINEX-27 --no-ai  (output raw data for agent)');
  process.exit(1);
}

run(input, noAi).catch((err) => {
  console.error('Error: ' + err.message);
  process.exit(1);
});
