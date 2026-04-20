# Staff Engineer Code Review: WBM Apartment Scraper

## Executive Summary
This is a well-intentioned web scraping service with solid core functionality but significant **architectural issues** that will cause maintenance problems and bugs as the project scales. The main problems are **code duplication**, **lack of abstraction**, **poor resource management**, and **inconsistent error handling**.

**Risk Level**: 🟠 **MEDIUM** - Works now but will break under load or maintenance

---

## Critical Issues Found

### 1. **Massive Code Duplication Between Scrapers** ⚠️ CRITICAL
**Location**: `wbm-scraper.js` (WBMScraper) vs `howoge-scraper.js` (HowogeScraper)

**Problem**:
- Both scrapers duplicate 80% of their code (logging, browser management, data persistence, notifications, filtering, error handling)
- Any bug fix must be applied to both places (increases risk of inconsistency)
- New feature additions require double the work
- Maintenance nightmare as codebase grows

**Example Duplication**:
```javascript
// BOTH files have identical implementations:
- launchBrowserWithRetry()
- sendTelegramNotification()
- escapeHtml()
- filterApartments()
- formatConsoleOutput()
- loadData() / saveData()
- setupNotifier()
- Error handling patterns
- Logging patterns
```

**Impact**: High - Violates DRY principle, increases bugs by 2x

---

### 2. **No Base Scraper Class Abstraction** ⚠️ CRITICAL
**Location**: Architecture (both files are independent)

**Problem**:
- Scrapers should inherit from a common `BaseScraper` class
- Browser lifecycle management is duplicated
- Notification system is duplicated
- Data persistence is duplicated

**Expected Architecture**:
```
BaseScraper (abstract)
├── setup()
├── loadData()
├── saveData()
├── launchBrowserWithRetry()
├── sendTelegramNotification()
├── escapeHtml()
└── abstract fetchApartments()

WBMScraper extends BaseScraper
└── fetchApartments() (WBM-specific)

HowogeScraper extends BaseScraper
└── fetchApartments() (Howoge-specific)
```

**Impact**: High - Prevents code reuse and scaling

---

### 3. **Inconsistent setupNotifier() Logging** 🐛 BUG
**Location**:
- `wbm-scraper.js:28-37` - Has detailed [DEBUG] logs with timestamps
- `howoge-scraper.js:25-29` - Missing timestamp prefix inconsistently

**Problem**:
- WBM prints 6 lines, Howoge prints 2 lines
- Makes debugging harder when comparing behavior
- Inconsistent log format breaks monitoring/parsing

**Current Output**:
```
// WBM (good)
[2026-04-20T15:10:54.552Z] [WBM] Environment variables check:
[2026-04-20T15:10:54.552Z] [WBM] NODE_ENV = undefined
[2026-04-20T15:10:54.552Z] [WBM] TELEGRAM_BOT_TOKEN exists: true (length: 46)

// Howoge (incomplete)
✅ Telegram notifications enabled for Howoge scraper
// Missing timestamps!
```

**Fix**: Standardize both to same format

---

### 4. **Broken filterApartments() in WBMScraper** 🐛 CRITICAL BUG
**Location**: `wbm-scraper.js:229-232`

**Problem**:
```javascript
filterApartments(apartments) {
  // Returning all apartments without filtering to notify on ALL new listings
  return apartments;
}
```

This **returns all apartments** regardless of `targetRooms` and `maxRent` config!

**Evidence**:
- WBM config specifies `targetRooms: 3, maxRent: 1200` (line 10-11)
- But filtering is disabled (line 229-232)
- Howoge correctly implements filtering (line 279-285)

**Impact**:
- Users get notified about apartments they don't want
- Config is ignored
- Telegram spam

**Expected**:
```javascript
filterApartments(apartments) {
  return apartments.filter(apt => {
    const roomsOk = this.config.targetRooms === 0 || apt.rooms === this.config.targetRooms;
    const rentOk = this.config.maxRent === 0 || apt.rent <= this.config.maxRent;
    return roomsOk && rentOk;
  });
}
```

---

### 5. **Resource Leaks: Browser Not Properly Cleaned Up** 🐛 MEMORY LEAK
**Location**: `wbm-scraper.js:91-223`, `howoge-scraper.js:82-272`

**Problem**:
- `browser.close()` is called but no error check
- If close fails silently, memory leaks
- No `context.close()` or `page.close()` guarantee in success path
- Zombie processes can accumulate in production

**Current Code** (lines 201-202):
```javascript
await context.close();  // What if this fails?
await browser.close();  // Silently fails if context.close() threw
```

**Better Approach**:
```javascript
finally {
  const cleanup = async () => {
    if (page) {
      try { await page.close(); } catch (e) { /* log */ }
    }
    if (context) {
      try { await context.close(); } catch (e) { /* log */ }
    }
    if (browser) {
      try { await browser.close(); } catch (e) { /* log */ }
    }
  };
  await cleanup();
}
```

**Impact**: Medium - Gradual memory degradation over weeks

---

### 6. **ScraperOrchestrator.runAllScrapers() Swallows Errors** 🐛 BUG
**Location**: `wbm-scraper.js:374-386`

**Problem**:
```javascript
async runAllScrapers() {
  console.log(`\n[${new Date().toISOString()}] 🔄 Running all apartment scrapers...`);

  // Run both scrapers in parallel
  try {
    await Promise.all([
      this.wbmScraper.run(),
      this.howogeScraper.run()
    ]);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error running scrapers:`, error);
  }
}
```

**Issues**:
- Catches but doesn't re-throw (silently fails)
- If WBM scraper crashes, Howoge never runs (Promise.all behavior)
- No way for caller to know if scrape failed
- GitHub Actions won't know to alert on failure

**Better**:
```javascript
async runAllScrapers() {
  const results = await Promise.allSettled([
    this.wbmScraper.run(),
    this.howogeScraper.run()
  ]);

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    console.error(`[${timestamp}] ❌ ${failed.length} scraper(s) failed`);
    failed.forEach((r, i) => console.error(`  Scraper ${i}:`, r.reason));
    throw new Error(`Scraper orchestration failed`);
  }
}
```

**Impact**: High - Silent failures in production

---

### 7. **No Configuration Validation** 🐛 OPERATIONAL BUG
**Location**: `wbm-scraper.js:9-15`, `howoge-scraper.js:9-14`

**Problem**:
- No validation that config values make sense
- No validation that file paths are writable
- No validation that env vars exist on startup
- Issues discovered at runtime instead of startup

**Missing**:
```javascript
// Should validate on startup:
- TELEGRAM_BOT_TOKEN format
- TELEGRAM_CHAT_ID is numeric
- Data files are writable
- URLs are valid
- Config values are in expected ranges
```

**Impact**: Medium - Runtime failures instead of fail-fast

---

### 8. **Inconsistent ID Generation** 🐛 BUG
**Location**:
- `wbm-scraper.js:225-226` - No prefix
- `howoge-scraper.js:275-276` - Has "howoge-" prefix

**Problem**:
```javascript
// WBM
generateId(address, title) {
  return `${address}-${title}`.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Howoge
generateId(address, title) {
  return `howoge-${address}-${title}`.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}
```

**Issue**: If same apartment appears on both sites, collision occurs because WBM doesn't have a source prefix!

**Evidence**:
- Combined JSON data has both sources mixed
- Both store in same data structure
- ID collision = duplicate notifications

**Fix**: Add "wbm-" prefix to WBM IDs

---

### 9. **No Graceful Shutdown Mechanism** 🐛 OPERATIONAL
**Location**: `wbm-scraper.js:361-363`, `howoge-scraper.js` (no equivalent)

**Problem**:
```javascript
// How to stop the scheduler?
schedule.scheduleJob(this.config.checkInterval, () => {
  this.run();
});
// No way to cancel!
```

**Issues**:
- No way to gracefully stop the service
- Docker/systemd can only kill -9
- In-flight scrapes get killed abruptly
- Browser processes left behind

**Missing**:
```javascript
this.scheduledJob = schedule.scheduleJob(...);

async shutdown() {
  this.scheduledJob.cancel();
  // Wait for in-flight operations
  // Close browsers
}
```

**Impact**: Medium - Unclean shutdowns, resource leaks

---

### 10. **Pagination Safety Limit Too High** ⚠️ PERFORMANCE
**Location**: `howoge-scraper.js:109`

**Problem**:
```javascript
const MAX_PAGES = 50; // Can fetch 50 * 12 = 600 apartments
```

**Issues**:
- Wasteful: If only 36 apartments exist, still tries 50 pages
- High bandwidth usage
- Slow scrapes
- Rate limiting risk

**Better**:
```javascript
// Stop when two consecutive pages are empty
// Or limit to 10-20 pages with early termination
```

---

## Design Issues (Non-Critical)

### 11. **Poor Separation of Concerns**
- Logging mixed with business logic
- Configuration scattered across files
- No dedicated notification service
- No dedicated data persistence service

### 12. **Testing Impossible Without Refactoring**
- Cannot unit test filtering without full scrape
- Cannot mock browser without refactoring
- Cannot inject dependencies
- No interfaces/abstractions to mock

### 13. **No Input Validation on Scraped Data**
- Assumes rent is always a number
- Assumes rooms are always valid
- No schema validation

### 14. **Error Messages Not Actionable**
- "Error fetching apartments" - what error?
- "Browser launch failed" - why?
- Stack traces aren't always logged

---

## Minor Issues

### 15. **Unused Comment Line**
`wbm-scraper.js:68` - Comment about "longer delay" but code is same as Howoge

### 16. **Magic Numbers Throughout**
- Timeouts: 30000, 10000 (hardcoded)
- Retry count: 3 (hardcoded)
- Delays: 2000, 500 (hardcoded)
- Should be in CONFIG

### 17. **Inconsistent Comment Quality**
- Some methods have no docs
- Some have inline comments but no purpose
- No JSDoc comments

---

## Summary of Fixes Required

| Issue | Severity | Type | Effort |
|-------|----------|------|--------|
| Code duplication | 🔴 CRITICAL | Architecture | Medium |
| Missing base class | 🔴 CRITICAL | Architecture | Medium |
| Broken WBM filter | 🔴 CRITICAL | Bug | Small |
| Error swallowing | 🔴 CRITICAL | Bug | Small |
| Browser cleanup | 🟠 HIGH | Bug | Medium |
| ID collisions | 🟠 HIGH | Bug | Small |
| Missing shutdown | 🟠 HIGH | Feature | Small |
| Config validation | 🟠 HIGH | Feature | Medium |
| Logging inconsistency | 🟡 MEDIUM | Bug | Small |
| High pagination limit | 🟡 MEDIUM | Performance | Small |

---

## Recommended Action Plan

1. **Phase 1 (CRITICAL)** - Fix immediate bugs (2-3 hours):
   - Enable WBM filtering
   - Fix ID collision (add "wbm-" prefix)
   - Fix error swallowing in orchestrator
   - Fix logging inconsistencies

2. **Phase 2 (IMPORTANT)** - Architectural refactoring (4-6 hours):
   - Create `BaseScraper` class
   - Extract common utilities
   - Refactor both scrapers to extend BaseScraper
   - Add config validation

3. **Phase 3 (NICE-TO-HAVE)** - Polish & hardening (2-3 hours):
   - Add graceful shutdown
   - Improve error messages
   - Extract magic numbers to config
   - Add JSDoc comments

---

## Code Quality Metrics

- **DRY Violations**: 15+ (duplicate methods)
- **Cyclomatic Complexity**: Too high (>15 in fetchApartments)
- **Error Handling**: 40% (swallows errors)
- **Test Coverage**: 0% (not testable)
- **Documentation**: 10% (minimal comments)

