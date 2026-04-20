require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

class HowogeScraper {
  constructor(config = {}) {
    const DEFAULT_CONFIG = {
      targetRooms: 3,
      maxRent: 1200,
      dataFile: path.join(__dirname, 'howoge-data.json'),
      url: 'https://www.howoge.de/immobiliensuche/wohnungssuche.html?tx_howrealestate_json_list%5Bpage%5D=1&tx_howrealestate_json_list%5Blimit%5D=12&tx_howrealestate_json_list%5Blang%5D=&tx_howrealestate_json_list%5Broooms%5D=3&tx_howrealestate_json_list%5Bwbs%5D='
    };

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastResults = this.loadData();
    this.setupNotifier();
  }

  setupNotifier() {
    this.telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    this.telegramChatId = process.env.TELEGRAM_CHAT_ID;

    if (!this.telegramToken || !this.telegramChatId) {
      console.warn(`[${new Date().toISOString()}] ⚠️  Telegram credentials not configured for Howoge scraper.`);
    } else {
      console.log(`[${new Date().toISOString()}] ✅ Telegram notifications enabled for Howoge scraper`);
    }
  }

  loadData() {
    try {
      if (fs.existsSync(this.config.dataFile)) {
        const data = fs.readFileSync(this.config.dataFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error(`[Howoge] Error loading data:`, error.message);
    }
    return [];
  }

  saveData(data) {
    try {
      fs.writeFileSync(this.config.dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[Howoge] Error saving data:`, error.message);
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
            console.log(`[${new Date().toISOString()}] [Howoge] Force-killed zombie chromium processes`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (e) {
            // Process cleanup failed, continue anyway
          }
        }

        return await chromium.launch(options);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [Howoge] Browser launch failed (attempt ${attempt}/${maxRetries}): ${error.message}`);

        if (attempt === maxRetries) {
          throw error;
        }

        const delay = Math.pow(2, attempt) * 1000;
        console.error(`[${new Date().toISOString()}] [Howoge] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async fetchApartments() {
    let browser;
    let context;
    let page;

    try {
      console.log(`[${new Date().toISOString()}] [Howoge] Fetching apartments from Howoge...`);

      let launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      };

      if (process.env.NODE_ENV === 'production') {
        launchOptions.executablePath = '/usr/bin/chromium';
      }

      browser = await this.launchBrowserWithRetry(launchOptions);
      console.log(`[${new Date().toISOString()}] [Howoge] Browser launched successfully`);

      context = await browser.newContext();
      page = await context.newPage();
      console.log(`[${new Date().toISOString()}] [Howoge] Context and page created`);

      console.log(`[${new Date().toISOString()}] [Howoge] Loading page: ${this.config.url}`);
      await page.goto(this.config.url, { waitUntil: 'networkidle', timeout: 30000 });
      console.log(`[${new Date().toISOString()}] [Howoge] Page loaded successfully`);

      // Wait for apartment listings to load
      console.log(`[${new Date().toISOString()}] [Howoge] Waiting for apartment listings...`);
      try {
        await page.locator('[data-testid="property-item"]').first().waitFor({ timeout: 10000 });
        console.log(`[${new Date().toISOString()}] [Howoge] Apartment listings found`);
      } catch (e) {
        console.warn(`[${new Date().toISOString()}] [Howoge] ⚠️  Timeout waiting for listings, trying alternative selector...`);
        // Try alternative selector
        try {
          await page.locator('.property-item').first().waitFor({ timeout: 10000 });
          console.log(`[${new Date().toISOString()}] [Howoge] Apartment listings found (using alternative selector)`);
        } catch (e2) {
          console.warn(`[${new Date().toISOString()}] [Howoge] ⚠️  Timeout with alternative selector too, continuing anyway...`);
        }
      }

      // Extract apartments using page.evaluate
      console.log(`[${new Date().toISOString()}] [Howoge] Extracting apartments...`);
      const apartments = await page.evaluate(() => {
        const results = [];

        // Try multiple selectors to find property items
        let listings = document.querySelectorAll('[data-testid="property-item"]');
        if (listings.length === 0) {
          listings = document.querySelectorAll('.property-item');
        }
        if (listings.length === 0) {
          listings = document.querySelectorAll('.immo-element');
        }

        let extracted = 0;
        let skipped = 0;

        listings.forEach((item) => {
          try {
            // Extract text content for debugging
            const fullText = item.textContent || '';

            // Try to find address (usually in a heading or address element)
            let address = '';
            const addressEl = item.querySelector('[data-testid="property-address"]') ||
                            item.querySelector('.property-address') ||
                            item.querySelector('h3') ||
                            item.querySelector('h2');
            if (addressEl) {
              address = addressEl.textContent?.trim() || '';
            }

            // If no address found, try to extract from main content
            if (!address) {
              const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              address = lines[0] || '';
            }

            // Extract rooms
            let rooms = 0;
            const roomsMatch = fullText.match(/(\d+)\s*(?:zimmer|zi\.?|z\.?|bedroom|room)/i);
            if (roomsMatch) {
              rooms = parseInt(roomsMatch[1]);
            }

            // Extract rent
            let rent = 0;
            const rentMatch = fullText.match(/€\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*€/);
            if (rentMatch) {
              const rentStr = (rentMatch[1] || rentMatch[2]).replace(',', '.');
              rent = parseFloat(rentStr);
            }

            // Extract size in m²
            let size = 0;
            const sizeMatch = fullText.match(/(\d+)\s*(?:m²|m2|qm)/i);
            if (sizeMatch) {
              size = parseInt(sizeMatch[1]);
            }

            // Extract link
            let link = '';
            const linkEl = item.querySelector('a');
            if (linkEl) {
              link = linkEl.href || '';
            }

            // Extract title (sometimes same as address, sometimes different)
            let title = address;

            // Only include if we have essential info
            if (address && (rooms > 0 || rent > 0)) {
              results.push({
                title: title || 'Howoge Apartment',
                address,
                rooms,
                rent,
                size,
                link
              });
              extracted++;
            } else {
              skipped++;
            }
          } catch (e) {
            skipped++;
          }
        });

        return {
          apartments: results,
          stats: { total: listings.length, extracted, skipped }
        };
      });

      const apartmentsList = apartments.apartments || apartments;
      const stats = apartments.stats;

      if (stats) {
        console.log(`[${new Date().toISOString()}] [Howoge] Stats: Found ${stats.total} total listings, extracted ${stats.extracted}, skipped ${stats.skipped}`);
      }
      console.log(`[${new Date().toISOString()}] [Howoge] Found ${apartmentsList.length} valid apartments`);

      await context.close();
      await browser.close();

      // Add IDs and timestamps, mark as Howoge source
      return apartmentsList.map(apt => ({
        ...apt,
        source: 'Howoge',
        id: this.generateId(apt.address, apt.title),
        fetchedAt: new Date().toISOString()
      }));

    } catch (error) {
      console.error(`[${new Date().toISOString()}] [Howoge] ❌ Error fetching apartments:`, error.message);
      try {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
      } catch (e) {
        console.error(`[${new Date().toISOString()}] [Howoge] Error during cleanup:`, e.message);
      }
      return [];
    }
  }

  generateId(address, title) {
    return `howoge-${address}-${title}`.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  }

  filterApartments(apartments) {
    // Filter based on config (rooms and rent)
    return apartments.filter(apt => {
      const roomsOk = this.config.targetRooms === 0 || apt.rooms === this.config.targetRooms;
      const rentOk = this.config.maxRent === 0 || apt.rent <= this.config.maxRent;
      return roomsOk && rentOk;
    });
  }

  findNewApartments(currentList) {
    const lastIds = new Set(this.lastResults.map(apt => apt.id));
    const newApts = currentList.filter(apt => !lastIds.has(apt.id));
    console.log(`[Howoge] Found ${currentList.length} total apartments, ${newApts.length} are new (${lastIds.size} already seen)`);
    return newApts;
  }

  async sendTelegramNotification(message) {
    if (!this.telegramToken || !this.telegramChatId) {
      console.warn('[Howoge] ⚠️  Telegram credentials not set');
      return;
    }

    try {
      const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
      console.log('[Howoge] 📤 Sending Telegram notification...');
      await axios.post(url, {
        chat_id: this.telegramChatId,
        text: message,
        parse_mode: 'HTML'
      });
      console.log('[Howoge] ✅ Telegram notification sent successfully');
    } catch (error) {
      console.error('[Howoge] ❌ Error sending Telegram notification:', error.response?.data || error.message);
    }
  }

  formatApartmentMessage(apartment) {
    return `<b>🏠 New Apartment Found - Howoge!</b>

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

    return `<b>🏠 ${apartments.length} New Apartment(s) Found - Howoge!</b>

${details}`;
  }

  escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async sendNotification(newApartments) {
    if (newApartments.length === 0) {
      console.log('[Howoge] No new apartments to notify');
      return;
    }

    console.log(`\n[Howoge] 🔔 Sending notifications for ${newApartments.length} new apartments...`);

    const consoleOutput = this.formatConsoleOutput(newApartments);
    console.log(consoleOutput);

    // Send summary message
    const summaryMessage = this.formatSummaryMessage(newApartments);
    console.log('[Howoge] Sending summary message...');
    await this.sendTelegramNotification(summaryMessage);

    // Send individual notifications for each apartment
    console.log(`[Howoge] Sending ${newApartments.length} individual notifications...`);
    for (const apt of newApartments) {
      const aptMessage = this.formatApartmentMessage(apt);
      await this.sendTelegramNotification(aptMessage);
      // Small delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('[Howoge] ✅ All notifications sent!');
  }

  formatConsoleOutput(apartments) {
    const header = `\n${'='.repeat(80)}\n🏠 NEW APARTMENTS FOUND - HOWOGE\n${'='.repeat(80)}\n`;
    const rows = apartments
      .map(apt => `  ${apt.rooms}R | €${apt.rent} | ${apt.size}m² | ${apt.address}`)
      .join('\n');
    return `${header}${rows}\n${'='.repeat(80)}\n`;
  }

  async run() {
    try {
      console.log(`\n[${new Date().toISOString()}] ========== HOWOGE SCRAPER RUN START ==========`);

      const apartments = await this.fetchApartments();
      console.log(`[${new Date().toISOString()}] [Howoge] Total apartments fetched: ${apartments.length}`);

      const filteredApartments = this.filterApartments(apartments);
      console.log(`[${new Date().toISOString()}] [Howoge] After filtering: ${filteredApartments.length} apartments`);

      const newApartments = this.findNewApartments(filteredApartments);
      console.log(`[${new Date().toISOString()}] [Howoge] New apartments found: ${newApartments.length}`);

      if (newApartments.length > 0) {
        await this.sendNotification(newApartments);
      } else {
        console.log(`[${new Date().toISOString()}] [Howoge] ℹ️  No new apartments found. (Total: ${filteredApartments.length})`);
      }

      this.lastResults = filteredApartments;
      this.saveData(filteredApartments);

      console.log(`[${new Date().toISOString()}] ========== HOWOGE SCRAPER RUN END ==========\n`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [Howoge] ❌ CRITICAL ERROR in scraper run:`, error);
    }
  }
}

module.exports = HowogeScraper;
