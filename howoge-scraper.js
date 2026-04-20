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

      const allApartments = [];
      let currentPage = 1;
      let hasMorePages = true;
      const MAX_PAGES = 50; // Safety limit to prevent infinite loops

      // Pagination loop
      while (hasMorePages && currentPage <= MAX_PAGES) {
        try {
          const pageUrl = `https://www.howoge.de/immobiliensuche/wohnungssuche.html?tx_howrealestate_json_list%5Bpage%5D=${currentPage}&tx_howrealestate_json_list%5Blimit%5D=12&tx_howrealestate_json_list%5Broooms%5D=3&tx_howrealestate_json_list%5Bwbs%5D=`;

          console.log(`[${new Date().toISOString()}] [Howoge] Loading page ${currentPage}: ${pageUrl}`);
          await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
          console.log(`[${new Date().toISOString()}] [Howoge] Page ${currentPage} loaded successfully`);

          // Wait for apartment listings to load
          console.log(`[${new Date().toISOString()}] [Howoge] Waiting for apartment listings on page ${currentPage}...`);
          try {
            await page.locator('.flat-single-grid-item').first().waitFor({ timeout: 10000 });
            console.log(`[${new Date().toISOString()}] [Howoge] Apartment listings found on page ${currentPage}`);
          } catch (e) {
            console.warn(`[${new Date().toISOString()}] [Howoge] ⚠️  Timeout waiting for listings on page ${currentPage}, may be last page`);
          }
        } catch (pageError) {
          console.error(`[${new Date().toISOString()}] [Howoge] Error loading page ${currentPage}: ${pageError.message}`);
          hasMorePages = false;
          break;
        }

        // Extract apartments from current page using page.evaluate
        console.log(`[${new Date().toISOString()}] [Howoge] Extracting apartments from page ${currentPage}...`);
        let pageApartments;
        try {
          pageApartments = await page.evaluate(() => {
          const results = [];
          const listings = document.querySelectorAll('.flat-single-grid-item');

          let extracted = 0;
          let skipped = 0;

          listings.forEach((item) => {
            try {
              // Extract address from the address link
              const addressLink = item.querySelector('.address a.flat-single--link');
              if (!addressLink) {
                skipped++;
                return;
              }

              const address = addressLink.textContent?.trim() || '';
              const link = addressLink.href || '';

              // Extract notice/title (e.g., "3-Zimmer-Wohnung (WBS 100-140)")
              const noticeEl = item.querySelector('.notice');
              const title = noticeEl?.textContent?.trim() || address;

              // Extract rooms from notice text
              let rooms = 0;
              const roomsMatch = (noticeEl?.textContent || '').match(/(\d+)\s*-?Zimmer/i);
              if (roomsMatch) {
                rooms = parseInt(roomsMatch[1]);
              }

              // Extract rent from any element containing €
              let rent = 0;
              const fullText = item.textContent || '';
              const allPriceMatches = fullText.match(/(\d+(?:[.,]\d+)?)\s*€/g);
              if (allPriceMatches && allPriceMatches.length > 0) {
                // Try to find the rent (usually the first price mentioned after warmmiete)
                const rentMatches = fullText.match(/Warmmiete[^\d]*(\d+(?:[.,]\d+)?)/i);
                if (rentMatches) {
                  rent = parseFloat(rentMatches[1].replace(',', '.'));
                } else {
                  // Fallback: use the first price found
                  rent = parseFloat(allPriceMatches[0].replace(',', '.'));
                }
              }

              // Extract size from details
              let size = 0;
              const sizeMatch = fullText.match(/(\d+)\s*m²/i);
              if (sizeMatch) {
                size = parseInt(sizeMatch[1]);
              }

              // Only include if we have essential info (address and rooms)
              if (address && rooms > 0) {
                results.push({
                  title,
                  address,
                  rooms,
                  rent,
                  size,
                  link
                });
                extracted++;
              } else if (address) {
                // Include without rooms but with other details
                results.push({
                  title,
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
        } catch (evalError) {
          console.error(`[${new Date().toISOString()}] [Howoge] Error evaluating page ${currentPage}: ${evalError.message}`);
          hasMorePages = false;
          break;
        }

        const apartmentsList = pageApartments.apartments || pageApartments;
        const stats = pageApartments.stats;

        if (stats) {
          console.log(`[${new Date().toISOString()}] [Howoge] Page ${currentPage} stats: Found ${stats.total} total listings, extracted ${stats.extracted}, skipped ${stats.skipped}`);
        }
        console.log(`[${new Date().toISOString()}] [Howoge] Page ${currentPage}: Found ${apartmentsList.length} valid apartments`);

        // If no apartments found on this page, stop pagination
        if (apartmentsList.length === 0) {
          hasMorePages = false;
          console.log(`[${new Date().toISOString()}] [Howoge] No apartments found on page ${currentPage}, stopping pagination`);
        } else {
          allApartments.push(...apartmentsList);
          currentPage++;
        }
      }

      await context.close();
      await browser.close();

      console.log(`[${new Date().toISOString()}] [Howoge] Total apartments fetched across all pages: ${allApartments.length}`);

      // Add IDs and timestamps, mark as Howoge source
      return allApartments.map(apt => ({
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
    console.log(`[${new Date().toISOString()}] [Howoge] Found ${currentList.length} total apartments, ${newApts.length} are new (${lastIds.size} already seen)`);
    return newApts;
  }

  async sendTelegramNotification(message) {
    if (!this.telegramToken || !this.telegramChatId) {
      console.warn(`[${new Date().toISOString()}] [Howoge] ⚠️  Telegram credentials not set`);
      return;
    }

    try {
      const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
      console.log(`[${new Date().toISOString()}] [Howoge] 📤 Sending Telegram notification...`);
      await axios.post(url, {
        chat_id: this.telegramChatId,
        text: message,
        parse_mode: 'HTML'
      });
      console.log(`[${new Date().toISOString()}] [Howoge] ✅ Telegram notification sent successfully`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [Howoge] ❌ Error sending Telegram notification:`, error.response?.data || error.message);
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
      console.log(`[${new Date().toISOString()}] [Howoge] No new apartments to notify`);
      return;
    }

    console.log(`[${new Date().toISOString()}] [Howoge] 🔔 Sending notifications for ${newApartments.length} new apartments...`);

    const consoleOutput = this.formatConsoleOutput(newApartments);
    console.log(consoleOutput);

    // Send summary message
    const summaryMessage = this.formatSummaryMessage(newApartments);
    console.log(`[${new Date().toISOString()}] [Howoge] Sending summary message...`);
    await this.sendTelegramNotification(summaryMessage);

    // Send individual notifications for each apartment
    console.log(`[${new Date().toISOString()}] [Howoge] Sending ${newApartments.length} individual notifications...`);
    for (const apt of newApartments) {
      const aptMessage = this.formatApartmentMessage(apt);
      await this.sendTelegramNotification(aptMessage);
      // Small delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`[${new Date().toISOString()}] [Howoge] ✅ All notifications sent!`);
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
