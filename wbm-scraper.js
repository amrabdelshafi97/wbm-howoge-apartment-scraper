require('dotenv').config();
const path = require('path');
const schedule = require('node-schedule');
const BaseScraper = require('./base-scraper');
const HowogeScraper = require('./howoge-scraper');

const DEFAULT_CONFIG = {
  targetRooms: 3,
  maxRent: 1200,
  checkInterval: '*/5 * * * *',
  dataFile: path.join(__dirname, 'apartments-data.json'),
  url: 'https://www.wbm.de/wohnungen-berlin/angebote/'
};

class WBMScraper extends BaseScraper {
  mergeConfig(config) {
    return { ...DEFAULT_CONFIG, ...config };
  }

  getSourceName() {
    return 'WBM';
  }

  async fetchApartments() {
    try {
      console.log(`[${this.timestamp()}] [${this.getSourceName()}] Fetching apartments from WBM...`);

      await this.setupBrowser();
      console.log(`[${this.timestamp()}] [${this.getSourceName()}] Loading page: ${this.config.url}`);
      await this.page.goto(this.config.url, { waitUntil: 'networkidle', timeout: 30000 });
      console.log(`[${this.timestamp()}] [${this.getSourceName()}] Page loaded successfully`);

      console.log(`[${this.timestamp()}] [${this.getSourceName()}] Waiting for apartment listings...`);
      try {
        await this.page.locator('article.immo-element').first().waitFor({ timeout: 10000 });
        console.log(`[${this.timestamp()}] [${this.getSourceName()}] Apartment listings found`);
      } catch (e) {
        console.warn(`[${this.timestamp()}] [${this.getSourceName()}] ⚠️  Timeout waiting for listings, continuing anyway... Error: ${e.message}`);
      }

      const count = await this.page.locator('article.immo-element').count();
      console.log(`[${this.timestamp()}] [${this.getSourceName()}] Before evaluate: found ${count} immo-element articles on page`);

      console.log(`[${this.timestamp()}] [${this.getSourceName()}] Extracting apartments...`);
      const apartments = await this.page.evaluate(() => {
        const results = [];
        const listings = document.querySelectorAll('article.immo-element:not(.teaserBox)');
        let skipped = 0;
        let extracted = 0;
        let missingFields = 0;

        listings.forEach((item, idx) => {
          try {
            const titleEl = item.querySelector('h2.imageTitle');
            const addressEl = item.querySelector('.address');
            const roomsEl = item.querySelector('.main-property-rooms');
            const rentEl = item.querySelector('.main-property-rent');

            if (!titleEl || !addressEl || !roomsEl) {
              missingFields++;
              skipped++;
              return;
            }

            const title = titleEl.textContent?.trim() || '';
            const address = addressEl.textContent?.trim() || '';
            const roomsText = roomsEl.textContent?.trim() || '';
            const rooms = parseInt(roomsText) || 0;

            const rentText = rentEl?.textContent?.trim() || '';
            const rent = rentText ? parseFloat(rentText.replace(/[^0-9,.-]/g, '').replace(',', '.')) : 0;

            const sizeMatch = item.textContent.match(/(\d+)\s*(?:m²|m2|qm)/i);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;

            const link = item.querySelector('a')?.href || '';

            if (title && address && rooms > 0) {
              results.push({
                title,
                address,
                rooms,
                rent,
                size,
                link
              });
              extracted++;
            }
          } catch (e) {
            // Skip problematic items
          }
        });

        return {
          apartments: results,
          stats: { total: listings.length, extracted, skipped, missingFields }
        };
      });

      const apartmentsList = apartments.apartments || apartments;
      const stats = apartments.stats;

      if (stats) {
        console.log(`[${this.timestamp()}] [${this.getSourceName()}] Stats: Found ${stats.total} total articles, extracted ${stats.extracted}, missing fields ${stats.missingFields}, skipped ${stats.skipped}`);
      }
      console.log(`[${this.timestamp()}] [${this.getSourceName()}] Found ${apartmentsList.length} valid apartments`);

      return apartmentsList.map(apt => ({
        ...apt,
        id: this.generateId(apt.address, apt.title, apt.link),
        fetchedAt: this.timestamp()
      }));

    } catch (error) {
      console.error(`[${this.timestamp()}] [${this.getSourceName()}] ❌ Error fetching apartments:`, error.message);
      console.error(`[${this.timestamp()}] [${this.getSourceName()}] Error stack:`, error.stack);
      throw error;
    } finally {
      await this.cleanupBrowser();
    }
  }

  start() {
    console.log(`🚀 WBM Scraper started!`);
    console.log(`   Mode: Notifying apartments matching criteria`);
    console.log(`   Rooms: ${this.config.targetRooms}, Max Rent: €${this.config.maxRent}`);
    console.log(`   Check interval: ${this.config.checkInterval}`);
    console.log(`   Data file: ${this.config.dataFile}\n`);

    this.run().catch(error => {
      console.error(`[${this.timestamp()}] Initial run failed:`, error);
    });

    this.scheduledJob = schedule.scheduleJob(this.config.checkInterval, () => {
      this.run().catch(error => {
        console.error(`[${this.timestamp()}] Scheduled run failed:`, error);
      });
    });
  }

  async shutdown() {
    console.log(`[${this.timestamp()}] Shutting down WBM scraper...`);
    if (this.scheduledJob) {
      this.scheduledJob.cancel();
    }
    await this.cleanupBrowser();
    console.log(`[${this.timestamp()}] WBM scraper shut down gracefully`);
  }
}

class ScraperOrchestrator {
  constructor() {
    this.wbmScraper = new WBMScraper();
    this.howogeScraper = new HowogeScraper();
    this.checkInterval = DEFAULT_CONFIG.checkInterval;
    this.scheduledJob = null;
  }

  async runAllScrapers() {
    console.log(`\n[${new Date().toISOString()}] 🔄 Running all apartment scrapers...`);

    const results = await Promise.allSettled([
      this.wbmScraper.run(),
      this.howogeScraper.run()
    ]);

    const failures = results.filter((r, idx) => r.status === 'rejected');
    if (failures.length > 0) {
      const sources = ['WBM', 'Howoge'];
      failures.forEach((result, idx) => {
        console.error(`[${new Date().toISOString()}] ❌ ${sources[idx]} scraper failed:`, result.reason.message);
      });
      // Log but don't throw - one scraper failing shouldn't block the other
      console.warn(`[${new Date().toISOString()}] ⚠️  ${failures.length} scraper(s) failed, but orchestration continues`);
    }
  }

  start() {
    console.log(`🚀 Apartment Scraper Orchestrator started!`);
    console.log(`   Scrapers: WBM Berlin, Howoge`);
    console.log(`   Check interval: ${this.checkInterval}`);
    console.log(`   Data files: apartments-data.json, howoge-data.json\n`);

    this.runAllScrapers().catch(error => {
      console.error(`[${new Date().toISOString()}] Initial orchestration failed:`, error);
    });

    this.scheduledJob = schedule.scheduleJob(this.checkInterval, () => {
      this.runAllScrapers().catch(error => {
        console.error(`[${new Date().toISOString()}] Scheduled orchestration failed:`, error);
      });
    });
  }

  async shutdown() {
    console.log(`[${new Date().toISOString()}] Shutting down orchestrator...`);
    if (this.scheduledJob) {
      this.scheduledJob.cancel();
    }
    await Promise.all([
      this.wbmScraper.shutdown(),
      this.howogeScraper.shutdown()
    ]);
    console.log(`[${new Date().toISOString()}] Orchestrator shut down gracefully`);
  }
}

// Export for use as module
module.exports = WBMScraper;
module.exports.ScraperOrchestrator = ScraperOrchestrator;

// Run as standalone service
if (require.main === module) {
  try {
    console.log(`[${new Date().toISOString()}] 🚀 Starting Scraper Orchestrator...`);
    const orchestrator = new ScraperOrchestrator();
    orchestrator.start();

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      console.log(`[${new Date().toISOString()}] SIGTERM received, shutting down...`);
      await orchestrator.shutdown();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log(`[${new Date().toISOString()}] SIGINT received, shutting down...`);
      await orchestrator.shutdown();
      process.exit(0);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error(`[${new Date().toISOString()}] ❌ Unhandled Rejection at:`, promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error(`[${new Date().toISOString()}] ❌ Uncaught Exception:`, error);
      process.exit(1);
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Failed to start scraper:`, error);
    process.exit(1);
  }
}
