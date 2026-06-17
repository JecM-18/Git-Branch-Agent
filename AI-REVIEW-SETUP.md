# 🤖 AI-Powered PR Review Setup Guide

## Overview

Your Git Branch Agent now includes **AI-powered code review** capabilities! The system automatically analyzes pull requests and provides:

- 📊 **Code Quality Scoring** (1-10 rating)
- 🔒 **Security Vulnerability Detection**
- 🐛 **Bug & Logic Error Identification**
- 💡 **Best Practice Suggestions**
- ✨ **Positive Feedback** on well-written code
- 📝 **PR Summary Generation**

---

## Setup Instructions

### 1. Get an OpenAI API Key

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click **"Create new secret key"**
4. Copy the key (starts with `sk-...`)
5. **Important**: You'll need billing set up (pay-as-you-go)

**Cost Estimate:**
- GPT-4o: ~$0.01-0.05 per PR review (recommended)
- GPT-3.5-turbo: ~$0.001-0.005 per review (faster, cheaper)

### 2. Configure in Git Branch Agent

1. Open the app
2. Go to **⚙ Settings** tab
3. Scroll to **🤖 AI-Powered Code Review** section
4. Enter your OpenAI API Key
5. Select AI Model (GPT-4o recommended)
6. Click **Save Settings**

---

## Using AI Review

### Automatic Review (Default)

When you review a PR, AI analysis runs automatically:

1. Go to **Review PR** tab
2. Enter Jira ticket or PR URL
3. Click **Review PR**
4. Wait 10-30 seconds for analysis
5. See AI insights in the output log

### What You'll See

```
═══════════════════════════════════════════════════════════════
  🤖 AI-POWERED CODE REVIEW
═══════════════════════════════════════════════════════════════

  ▸ Summary
  ────────────────────────────────────────────────────────────
  This PR implements a new authentication feature using JWT tokens...

  ▸ Code Quality Score
  ────────────────────────────────────────────────────────────
  8/10 - Well-structured code with good error handling...

  ▸ Security Issues
  ────────────────────────────────────────────────────────────
  - Potential SQL injection in line 45 of auth.js
  - Missing input validation for user email

  ▸ Bugs & Potential Issues
  ────────────────────────────────────────────────────────────
  - Race condition in async function at login.js:78
  - Uncaught promise rejection possible

  ▸ Best Practices & Improvements
  ────────────────────────────────────────────────────────────
  - Consider using bcrypt rounds of 12 instead of 10
  - Add JSDoc comments for public API functions

  ▸ Positive Notes
  ────────────────────────────────────────────────────────────
  - Excellent test coverage (95%)
  - Good separation of concerns
```

---

## Configuration Options

### Environment Variables (.env)

Add these to your `.env` file:

```bash
# Required for AI Review
OPENAI_API_KEY=sk-your-key-here

# Optional: Choose model (default: gpt-4o)
AI_MODEL=gpt-4o

# Optional: Use Azure OpenAI or custom endpoint
OPENAI_API_BASE=https://api.openai.com/v1

# Optional: Completely disable AI review
AI_REVIEW_ENABLED=false
```

### Available Models

| Model | Speed | Quality | Cost | Recommended |
|-------|-------|---------|------|-------------|
| **gpt-4o** | Fast | Excellent | Medium | ✅ Yes |
| gpt-4-turbo | Medium | Excellent | High | For complex PRs |
| gpt-4 | Slow | Excellent | High | Not recommended |
| gpt-3.5-turbo | Very Fast | Good | Low | Budget option |

---

## Troubleshooting

### "AI Review disabled: OPENAI_API_KEY not set"
- Go to Settings → Add your OpenAI API key → Save
- Restart the app

### "OpenAI authentication failed"
- Check your API key is correct
- Verify billing is set up at platform.openai.com
- Check key hasn't expired

### "OpenAI rate limit exceeded"
- You've hit the API rate limit
- Wait a few minutes or upgrade your OpenAI plan
- Consider using GPT-3.5-turbo for lower limits

### "AI Review failed: token limit"
- Very large PRs (>8000 lines of diff) are truncated
- AI will review the first ~8000 lines
- Consider reviewing in smaller chunks

### AI Review Takes Too Long
- Large PRs take 30-60 seconds
- Switch to GPT-3.5-turbo for faster reviews
- Or disable AI review for quick checks

---

## Privacy & Security

### What Gets Sent to OpenAI?

- PR title, description, author
- File names and change statistics
- Code diffs (up to 8000 lines)
- **NOT sent**: GitHub tokens, Jira credentials, .env secrets

### Best Practices

✅ **Safe to review:**
- Public repositories
- Internal code without secrets
- Code that will be public anyway

⚠️ **Be cautious:**
- Proprietary algorithms
- Code with embedded secrets (shouldn't be in code anyway!)
- Highly sensitive business logic

🔒 **Security tip:** Use `.gitignore` to ensure secrets never enter code diffs

---

## Advanced Usage

### Custom AI Instructions

Edit `review-pr.js` line ~270 to customize the AI prompt:

```javascript
const prompt = `You are an expert code reviewer focusing on [YOUR SPECIALTY]...`;
```

### Change Response Format

Modify `performAIReview()` to request different output formats (JSON, markdown, etc.)

### Add Auto-Comments

Integrate with `approvePR()` to automatically post AI findings as PR comments

---

## FAQ

**Q: Does AI review replace human review?**
A: No! AI is a helpful assistant that catches common issues. Human judgment is still essential.

**Q: How much does it cost?**
A: Typically $0.01-0.05 per review with GPT-4o. GPT-3.5-turbo costs ~$0.001-0.005.

**Q: Can I use this offline?**
A: Not with OpenAI. Consider using Ollama with local models (requires code changes).

**Q: Will AI approve/reject PRs automatically?**
A: No. AI only provides insights. You must manually approve.

**Q: Can I review PRs without AI?**
A: Yes! AI is optional. Reviews work fine without it.

**Q: Can I use Azure OpenAI?**
A: Yes! Set `OPENAI_API_BASE` to your Azure endpoint.

---

## What's Next?

Planned features:
- [ ] Support for Claude/Anthropic API
- [ ] Local LLM support (Ollama)
- [ ] Auto-post AI comments to GitHub
- [ ] Custom review checklists
- [ ] Team-specific coding standards

---

**Enjoy smarter code reviews! 🚀**

For issues or questions, check the main [README.md](README.md)
