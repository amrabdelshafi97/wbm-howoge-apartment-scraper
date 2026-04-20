require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/**
 * Abstract base class for apartment scrapers.
 * Provides common functionality for all scraper implementations.
 */
class BaseScraper {
  constructor(config = {}) {
    this.config = this.mergeConfig(config);
    this.lastResults = this.loadData();
    this.setupNotifier();
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  /**
   * Merge provided config with defaults. Must be implemented by subclass.
   * @abstract
   */
  mergeConfig(config) {
    throw new Error('mergeConfig() must be implemented by subclass');
  }

  /**
   * Get the scraper name for logging purposes.
   * @abstract
   */
  getSourceName() {
    throw new Error('getSourceName() must be implemented by subclass');
  }

  /**
   * Fetch apartments from the source. Must be implemented by subclass.
   * @abstract
   */
  async fetchApartments() {
    throw new Error('fetchApartments() must be implemented by subclass');
  }

  setupNotifier() {
    this.telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID;

    const source = this.getSourceName();
    console.log(`[${this.timestamp()}] [${source}] Environment variables check:`);
    console.log(`[${this.timestamp()}] [${source}] NODE_ENV = ${process.env.NODE_ENV}`);
    console.log(`[${this.timestamp()}] [${source}] TELEGRAM_BOT_TOKEN exists: ${!!this.telegramToken} (length: ${this.telegramToken?.length || 0})`);
    console.log(`[${this.timestamp()}] [${source}] TELEGRAM_CHAT_ID exists: ${!!this.telegramChatId} (value: ${this.telegramChatId || 'undefined'})`);

    if (!this.telegramToken || !this.telegramChatId) {
      console.warn(`[${this.timestamp()}] [${source}] ⚠️  Telegram credentials not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars.`);
    } else {
      console.log(`[${this.timestamp()}] [${source}] ✅ Telegram notifications enabled`);
    }
  }

  loadData() {
    try {
      if (fs.existsSync(this.config.dataFile)) {
        const data = fs.readFileSync(this.config.dataFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error(`[${this.timestamp()}] [${this.getSourceName()}] Error loading data:`, error.message);
    }
    return [];
  }

  saveData(data) {
    try {
      fs.writeFileSync(this.config.dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[${this.timestamp()}] [${this.getSourceName()}] Error saving data:`, error.message);
    }
  }

  async launchBrowserWithRetry(options, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          try {
            const { execSync } = require('child_process');
            execSync('pkill -9 chromium || true', { stdio: 'ignore' });
            console.log(`[${this.timestamp()}] [${this.getSourceName()}] Force-killed zombie chromium processes`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (e) {
            // Process cleanup failed, continue anyway
          }
        }

        return await chromium.launch(options);
      } catch (error) {
        console.error(`[${this.timestamp()}] [${this.getSourceName()}] Browser launch failed (attempt ${attempt}/${maxRetries}): ${error.message}`);

        if (attempt === maxRetries) {
          throw error;
        }

        const delay = Math.pow(2, attempt) * 1000;
        console.error(`[${this.timestamp()}] [${this.getSourceName()}] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Launches browser with retry and sets up context and page.
   */
  async setupBrowser() {
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };

    if (process.env.NODE_ENV === 'production') {
      launchOptions.executablePath = '/usr/bin/chromium';
    }

    console.log(`[${this.timestamp()}] [${this.getSourceName()}] Launching browser...`);
    this.browser = await this.launchBrowserWithRetry(launchOptions);
    console.log(`[${this.timestamp()}] [${this.getSourceName()}] Browser launched successfully`);

    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    console.log(`[${this.timestamp()}] [${this.getSourceName()}] Context and page created`);
  }

  /**
   * Gracefully close all browser resources.
   */
  async cleanupBrowser() {
    const source = this.getSourceName();
    const cleanup = async (resource, name) => {
      if (resource) {
        try {
          await resource.close();
        } catch (e) {
          console.warn(`[${this.timestamp()}] [${source}] Warning: Failed to close ${name}:`, e.message);
        }
      }
    };

    await cleanup(this.page, 'page');
    await cleanup(this.context, 'context');
    await cleanup(this.browser, 'browser');

    this.page = null;
    this.context = null;
    this.browser = null;
  }

  /**
   * Generate stable ID from apartment data.
   * Can use link (recommended) or address+title.
   * Link is more stable across scrape runs.
   */
  generateId(address, title, link = null) {
    const source = this.getSourceName().toLowerCase();

    // If link is provided, use it for better stability
    if (link) {
      // Extract the ID from the link if available (e.g., from URL)
      // or use the full link as the basis
      return `${source}-${link}`.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }

    // Fallback to address+title if no link provided
    return `${source}-${address}-${title}`.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  }

  filterApartments(apartments) {
    return apartments.filter(apt => {
      const roomsOk = this.config.targetRooms === 0 || apt.rooms === this.config.targetRooms;
      const rentOk = this.config.maxRent === 0 || apt.rent <= this.config.maxRent;
      return roomsOk && rentOk;
    });
  }

  findNewApartments(currentList) {
    const lastIds = new Set(this.lastResults.map(apt => apt.id));
    const newApts = currentList.filter(apt => !lastIds.has(apt.id));
    console.log(`[${this.timestamp()}] [${this.getSourceName()}] Found ${currentList.length} total apartments, ${newApts.length} are new (${lastIds.size} already seen)`);
    return newApts;
  }

  async sendTelegramNotification(message) {
    const source = this.getSourceName();
    if (!this.telegramToken || !this.telegramChatId) {
      console.warn(`[${this.timestamp()}] [${source}] ⚠️  Telegram credentials not set`);
      return;
    }

    try {
      const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
      console.log(`[${this.timestamp()}] [${source}] 📤 Sending Telegram notification...`);
      await axios.post(url, {
        chat_id: this.telegramChatId,
        text: message,
        parse_mode: 'HTML'
      });
      console.log(`[${this.timestamp()}] [${source}] ✅ Telegram notification sent successfully`);
    } catch (error) {
      console.error(`[${this.timestamp()}] [${source}] ❌ Error sending Telegram notification:`, error.response?.data || error.message);
    }
  }

  formatApartmentMessage(apartment) {
    const source = this.getSourceName();
    return `<b>🏠 New Apartment Found - ${source}!</b>

<b>Address:</b> ${this.escapeHtml(apartment.address)}
<b>Rooms:</b> ${apartment.rooms}
<b>Size:</b> ${apartment.size}m²
<b>Rent:</b> €${apartment.rent}

<a href="${apartment.link}">View Listing</a>`;
  }

  formatSummaryMessage(apartments) {
    const source = this.getSourceName();
    const details = apartments
      .map(apt => `• ${apt.rooms}R | €${apt.rent} | ${apt.size}m² | ${apt.address}`)
      .join('\n');

    return `<b>🏠 ${apartments.length} New Apartment(s) Found - ${source}!</b>

${details}`;
  }

  escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async sendNotification(newApartments) {
    const source = this.getSourceName();
    if (newApartments.length === 0) {
      console.log(`[${this.timestamp()}] [${source}] No new apartments to notify`);
      return;
    }

    console.log(`[${this.timestamp()}] [${source}] 🔔 Sending notifications for ${newApartments.length} new apartments...`);

    const consoleOutput = this.formatConsoleOutput(newApartments);
    console.log(consoleOutput);

    const summaryMessage = this.formatSummaryMessage(newApartments);
    console.log(`[${this.timestamp()}] [${source}] Sending summary message...`);
    await this.sendTelegramNotification(summaryMessage);

    console.log(`[${this.timestamp()}] [${source}] Sending ${newApartments.length} individual notifications...`);
    for (const apt of newApartments) {
      const aptMessage = this.formatApartmentMessage(apt);
      await this.sendTelegramNotification(aptMessage);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`[${this.timestamp()}] [${source}] ✅ All notifications sent!`);
  }

  formatConsoleOutput(apartments) {
    const source = this.getSourceName();
    const header = `\n${'='.repeat(80)}\n🏠 NEW APARTMENTS FOUND - ${source}\n${'='.repeat(80)}\n`;
    const rows = apartments
      .map(apt => `  ${apt.rooms}R | €${apt.rent} | ${apt.size}m² | ${apt.address}`)
      .join('\n');
    return `${header}${rows}\n${'='.repeat(80)}\n`;
  }

  async run() {
    try {
      const source = this.getSourceName();
      console.log(`\n[${this.timestamp()}] [${source}] ========== SCRAPER RUN START ==========`);

      const apartments = await this.fetchApartments();
      console.log(`[${this.timestamp()}] [${source}] Total apartments fetched: ${apartments.length}`);

      const filteredApartments = this.filterApartments(apartments);
      console.log(`[${this.timestamp()}] [${source}] After filtering: ${filteredApartments.length} apartments`);

      const newApartments = this.findNewApartments(filteredApartments);
      console.log(`[${this.timestamp()}] [${source}] New apartments found: ${newApartments.length}`);

      if (newApartments.length > 0) {
        await this.sendNotification(newApartments);
      } else {
        console.log(`[${this.timestamp()}] [${source}] ℹ️  No new apartments found. (Total: ${filteredApartments.length})`);
      }

      this.lastResults = filteredApartments;
      this.saveData(filteredApartments);

      console.log(`[${this.timestamp()}] [${source}] ========== SCRAPER RUN END ==========\n`);
    } catch (error) {
      console.error(`[${this.timestamp()}] [${this.getSourceName()}] ❌ CRITICAL ERROR in scraper run:`, error);
      throw error;
    }
  }

  /**
   * Helper method for consistent timestamp formatting.
   */
  timestamp() {
    return new Date().toISOString();
  }
}

module.exports = BaseScraper;
