# GitHub Actions Workflow Update Required

## Issue
The GitHub Actions workflow at `.github/workflows/scrape.yml` still references the old filename `apartment-scraper.js`, which has been renamed to `wbm-scraper.js` as part of the refactoring.

## Impact
Current workflow will fail with:
```
Error: Cannot find module './apartment-scraper.js'
```

## Solution
The workflow file requires manual update in the GitHub web UI (due to GitHub's workflow scope restrictions).

**Two options:**

### Option 1: Use npm script (RECOMMENDED)
Update the workflow step from:
```yaml
run: |
  node -e "const ApartmentScraper = require('./apartment-scraper.js'); const scraper = new ApartmentScraper(); scraper.run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });"
```

To:
```yaml
run: npm run scrape
```

This is cleaner, simpler, and uses the standard npm run mechanism.

### Option 2: Direct file reference
Update the workflow step to:
```yaml
run: |
  node wbm-scraper.js
```

However, this won't work because `wbm-scraper.js` runs the orchestrator in daemon mode (with scheduling). We need single-pass execution for CI/CD.

## How to Update GitHub Actions Workflow

1. Go to your GitHub repository
2. Click "Actions" tab
3. Click "Scrape WBM Apartments" workflow
4. Click the three dots (...) and select "Edit"
5. Find the step named "Run scraper (single pass)"
6. Change the `run` command to: `npm run scrape`
7. Click "Commit changes"
8. Confirm the commit

## Verification
After updating, the workflow should:
1. ✅ Run scrapers in single-pass mode (no scheduling)
2. ✅ Exit cleanly after completion
3. ✅ Commit updated data files
4. ✅ Not leave any background processes

## Files Involved
- **Updated**: `package.json` - Added `"scrape"` script
- **New**: `run-scraper.js` - CI/CD runner script
- **Needs Update**: `.github/workflows/scrape.yml` - Change run command

## Testing Locally
You can test the scraper locally before the workflow update:
```bash
npm run scrape
```

This should:
1. Run both scrapers once
2. Commit any updates to data files
3. Exit cleanly with status 0 (success) or 1 (failure)

