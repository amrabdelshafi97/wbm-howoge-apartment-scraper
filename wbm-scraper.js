require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const { chromium } = require('playwright');
const HowogeScraper = require('./howoge-scraper');

const CONFIG = {
  targetRooms: 3,
  maxRent: 1200,
  checkInterval: '*/5 * * * *', // Every 5 minutes
  dataFile: path.join(__dirname, 'apartments-data.json'),
  url: 'https://www.wbm.de/wohnungen-berlin/angebote/'
};

class WBMScraper {
  constructor(config = {}) {
    this.config = { ...CONFIG, ...config };
    this.lastResults = this.loadData();
    this.setupNotifier();
  }

  setupNotifier() {
    this.telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID;

    console.log(`[${new Date().toISOString()}] [WBM] Environment variables check:`);
    console.log(`[${new Date().toISOString()}] [WBM] NODE_ENV = ${process.env.NODE_ENV}`);
    console.log(`[${new Date().toISOString()}] [WBM] TELEGRAM_BOT_TOKEN exists: ${!!this.telegramToken} (length: ${this.telegramToken?.length || 0})`);
    console.log(`[${new Date().toISOString()}] [WBM] TELEGRAM_CHAT_ID exists: ${!!this.telegramChatId} (value: ${this.telegramChatId || 'undefined'})`);

    if (!this.telegramToken || !this.telegramChatId) {
      console.warn(`[${new Date().toISOString()}] [WBM] ⚠️  Telegram credentials not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars.`);
    } else {
      console.log(`[${new Date().toISOString()}] [WBM] ✅ Telegram notifications enabled`);
    }
  }

  loadData() {
    try {
      if (fs.existsSync(this.config.dataFile)) {
        const data = fs.readFileSync(this.config.dataFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WBM] Error loading data:`, error.message);
    }
    return [];
  }

  saveData(data) {
    try {
      fs.writeFileSync(this.config.dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WBM] Error saving data:`, error.message);
    }
  }

  async launchBrowserWithRetry(options, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Only clean up on retry attempts, not first attempt
        if (attempt > 1) {
          try {
            const { execSync } = require('child_process');
            execSync('pkill -9 chromium || true', { stdio: 'ignore' });
            console.log(`[${new Date().toISOString()}] [WBM] Force-killed zombie chromium processes`);
            // Longer delay to ensure processes are fully reaped by OS
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (e) {
            // Process cleanup failed, continue anyway
          }
        }

        return await chromium.launch(options);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [WBM] Browser launch failed (attempt ${attempt}/${maxRetries}): ${error.message}`);

        if (attempt === maxRetries) {
          throw error;
        }

        const delay = Math.pow(2, attempt) * 1000;
        console.error(`[${new Date().toISOString()}] [WBM] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async fetchApartments() {
    let browser;
    let context;
    let page;

    try {
      console.log(`[${new Date().toISOString()}] [WBM] Fetching apartments from WBM...`);

      console.log(`[${new Date().toISOString()}] [WBM] Launching browser...`);

      // Try to use system Chromium if available, otherwise use downloaded version
      let launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      };

      // In production (Docker), use system chromium
      if (process.env.NODE_ENV === 'production') {
        launchOptions.executablePath = '/usr/bin/chromium';
      }

      browser = await this.launchBrowserWithRetry(launchOptions);
      console.log(`[${new Date().toISOString()}] [WBM] Browser launched successfully`);

      context = await browser.newContext();
      page = await context.newPage();
      console.log(`[${new Date().toISOString()}] [WBM] Context and page created`);

      console.log(`[${new Date().toISOString()}] [WBM] Loading page: ${this.config.url}`);
      await page.goto(this.config.url, { waitUntil: 'networkidle', timeout: 30000 });
      console.log(`[${new Date().toISOString()}] [WBM] Page loaded successfully`);

      // Wait for apartment listings to load
      console.log(`[${new Date().toISOString()}] [WBM] Waiting for apartment listings...`);
      try {
        await page.locator('article.immo-element').first().waitFor({ timeout: 10000 });
        console.log(`[${new Date().toISOString()}] [WBM] Apartment listings found`);
      } catch (e) {
        console.warn(`[${new Date().toISOString()}] [WBM] ⚠️  Timeout waiting for listings, continuing anyway... Error: ${e.message}`);
      }

      // First check if elements exist
      const count = await page.locator('article.immo-element').count();
      console.log(`[${new Date().toISOString()}] [WBM] Before evaluate: found ${count} immo-element articles on page`);

      // Extract apartments using page.evaluate with debugging
      console.log(`[${new Date().toISOString()}] [WBM] Extracting apartments...`);
      const apartments = await page.evaluate(() => {
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
        console.log(`[${new Date().toISOString()}] [WBM] Stats: Found ${stats.total} total articles, extracted ${stats.extracted}, missing fields ${stats.missingFields}, skipped ${stats.skipped}`);
      }
      console.log(`[${new Date().toISOString()}] [WBM] Found ${apartmentsList.length} valid apartments`);

      await context.close();
      await browser.close();

      // Add IDs and timestamps
      return apartmentsList.map(apt => ({
        ...apt,
        id: this.generateId(apt.address, apt.title),
        fetchedAt: new Date().toISOString()
      }));

    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WBM] ❌ Error fetching apartments:`, error.message);
      console.error(`[${new Date().toISOString()}] [WBM] Error stack:`, error.stack);
      try {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
      } catch (e) {
        console.error(`[${new Date().toISOString()}] [WBM] Error during cleanup:`, e.message);
      }
      return [];
    }
  }

  generateId(address, title) {
    return `${address}-${title}`.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  }

  filterApartments(apartments) {
    // Returning all apartments without filtering to notify on ALL new listings
    return apartments;
  }

  findNewApartments(currentList) {
    const lastIds = new Set(this.lastResults.map(apt => apt.id));
    const newApts = currentList.filter(apt => !lastIds.has(apt.id));
    console.log(`[${new Date().toISOString()}] [WBM] Found ${currentList.length} total apartments, ${newApts.length} are new (${lastIds.size} already seen)`);
    return newApts;
  }

  async sendTelegramNotification(message) {
    if (!this.telegramToken || !this.telegramChatId) {
      console.warn(`[${new Date().toISOString()}] [WBM] ⚠️  Telegram credentials not set`);
      return;
    }

    try {
      const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
      console.log(`[${new Date().toISOString()}] [WBM] 📤 Sending Telegram notification...`);
      const response = await axios.post(url, {
        chat_id: this.telegramChatId,
        text: message,
        parse_mode: 'HTML'
      });
      console.log(`[${new Date().toISOString()}] [WBM] ✅ Telegram notification sent successfully`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WBM] ❌ Error sending Telegram notification:`, error.response?.data || error.message);
    }
  }

  formatApartmentMessage(apartment) {
    return `<b>🏠 New Apartment Found - WBM!</b>

<b>Address:</b> ${this.escapeHtml(apartment.address)}
<b>Rooms:</b> ${apartment.rooms}
<b>Size:</b> ${apartment.size}m²
<b>Rent:</b> €${apartment.rent}

<a href="${apartment.link}">View Listing</a>`;
  }

  formatSummaryMessage(apartments) {
    const details = apartments
      .map(apt => `• ${apt.rooms}R | €${apt.rent} | ${apt.size}m² | ${apt.address}`)
      .join('\n');

    return `<b>🏠 ${apartments.length} New Apartment(s) Found - WBM!</b>

${details}`;
  }

  escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async sendNotification(newApartments) {
    if (newApartments.length === 0) {
      console.log(`[${new Date().toISOString()}] [WBM] No new apartments to notify`);
      return;
    }

    console.log(`[${new Date().toISOString()}] [WBM] 🔔 Sending notifications for ${newApartments.length} new apartments...`);

    const consoleOutput = this.formatConsoleOutput(newApartments);
    console.log(consoleOutput);

    // Send summary message
    const summaryMessage = this.formatSummaryMessage(newApartments);
    console.log(`[${new Date().toISOString()}] [WBM] Sending summary message...`);
    await this.sendTelegramNotification(summaryMessage);

    // Send individual notifications for each apartment
    console.log(`[${new Date().toISOString()}] [WBM] Sending ${newApartments.length} individual notifications...`);
    for (const apt of newApartments) {
      const aptMessage = this.formatApartmentMessage(apt);
      await this.sendTelegramNotification(aptMessage);
      // Small delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`[${new Date().toISOString()}] [WBM] ✅ All notifications sent!`);
  }


  formatConsoleOutput(apartments) {
    const header = `\n${'='.repeat(80)}\n🏠 NEW APARTMENTS FOUND - WBM\n${'='.repeat(80)}\n`;
    const rows = apartments
      .map(apt => `  ${apt.rooms}R | €${apt.rent} | ${apt.size}m² | ${apt.address}`)
      .join('\n');
    return `${header}${rows}\n${'='.repeat(80)}\n`;
  }

  async run() {
    try {
      console.log(`\n[${new Date().toISOString()}] [WBM] ========== SCRAPER RUN START ==========`);

      const apartments = await this.fetchApartments();
      console.log(`[${new Date().toISOString()}] [WBM] Total apartments fetched: ${apartments.length}`);

      const filteredApartments = this.filterApartments(apartments);
      console.log(`[${new Date().toISOString()}] [WBM] After filtering: ${filteredApartments.length} apartments`);

      const newApartments = this.findNewApartments(filteredApartments);
      console.log(`[${new Date().toISOString()}] [WBM] New apartments found: ${newApartments.length}`);

      if (newApartments.length > 0) {
        await this.sendNotification(newApartments);
      } else {
        console.log(`[${new Date().toISOString()}] [WBM] ℹ️  No new apartments found. (Total: ${filteredApartments.length})`);
      }

      this.lastResults = filteredApartments;
      this.saveData(filteredApartments);

      console.log(`[${new Date().toISOString()}] [WBM] ========== SCRAPER RUN END ==========\n`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [WBM] ❌ CRITICAL ERROR in scraper run:`, error);
    }
  }

  start() {
    console.log(`🚀 WBM Scraper started!`);
    console.log(`   Mode: Notifying ALL new apartments found`);
    console.log(`   Check interval: ${this.config.checkInterval}`);
    console.log(`   Data file: ${this.config.dataFile}\n`);

    // Run immediately
    this.run();

    // Schedule recurring checks
    schedule.scheduleJob(this.config.checkInterval, () => {
      this.run();
    });
  }
}

class ScraperOrchestrator {
  constructor() {
    this.wbmScraper = new WBMScraper();
    this.howogeScraper = new HowogeScraper();
    this.checkInterval = CONFIG.checkInterval;
  }

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

  start() {
    console.log(`🚀 Apartment Scraper Orchestrator started!`);
    console.log(`   Scrapers: WBM Berlin, Howoge`);
    console.log(`   Check interval: ${this.checkInterval}`);
    console.log(`   Data files: apartments-data.json, howoge-data.json\n`);

    // Run immediately
    this.runAllScrapers();

    // Schedule recurring checks
    schedule.scheduleJob(this.checkInterval, () => {
      this.runAllScrapers();
    });
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

    // Log unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error(`[${new Date().toISOString()}] ❌ Unhandled Rejection at:`, promise, 'reason:', reason);
    });

    // Log uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error(`[${new Date().toISOString()}] ❌ Uncaught Exception:`, error);
      process.exit(1);
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Failed to start scraper:`, error);
    process.exit(1);
  }
}
