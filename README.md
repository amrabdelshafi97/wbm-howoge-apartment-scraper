# WBM Apartment Scraper

A background service that monitors multiple apartment sources in Berlin and notifies you when new apartments matching your criteria become available.

## Features

- 🔍 **Multi-Source Scraping**: Monitors both WBM Berlin and Howoge apartments
- 📱 **Telegram Notifications**: Get notified via Telegram when NEW apartments match your criteria
- 💾 **Data Persistence**: Tracks previous results for each source to detect only new listings
- 🎯 **Filtered Results**: Customizable filters (rooms, maximum rent)
- 📊 **Diff Detection**: Only notifies on NEW listings, never duplicates
- ⚡ **Parallel Execution**: Scrapes multiple sources simultaneously for efficiency

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/amrabdelshafi97/wbm-apartment-scraper.git
cd wbm-apartment-scraper
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Telegram Bot

#### Step 1: Create a Telegram Bot with BotFather

1. Open **Telegram** on your phone or web app
2. Search for **`@BotFather`** (official Telegram bot creator)
3. Click on it and press **Start**
4. Send the command: `/newbot`
5. BotFather will ask for a name for your bot (e.g., "Apartment Scraper Bot")
6. BotFather will ask for a username (must end with "bot", e.g., "apartment_scraper_bot")
7. BotFather will respond with:
   ```
   Done! Congratulations on your new bot. You will find it at t.me/your_bot_username.
   You can now add a description, about section and commands for your bot.

   Use this token to access the HTTP API:
   123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
   ```
8. **Copy this token** - you'll need it for your `.env` file

#### Step 2: Get Your Chat ID

1. Search for your newly created bot (use the username from above)
2. Click **Start** to initialize the chat
3. Send any message to your bot (e.g., "hello")
4. Go to this URL in your browser:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   (Replace `<YOUR_TOKEN>` with the token from BotFather)
5. You'll see JSON output. Look for:
   ```json
   {
     "ok": true,
     "result": [
       {
         "update_id": 123456789,
         "message": {
           "message_id": 1,
           "from": {
             "id": 987654321,  // <-- This is your CHAT_ID
             "is_bot": false,
             "first_name": "Your Name"
           },
           ...
         }
       }
     ]
   }
   ```
   **Copy the `id` value** - this is your Chat ID

3. **Create `.env` file**:

```bash
cp .env.example .env
```

4. **Edit `.env`** and add your credentials:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
TELEGRAM_CHAT_ID=123456789
```

### 4. (Optional) Deploy to cron-job.org

For automatic recurring scraping without running a local server:

1. **Create a cron-job.org Account**:
   - Go to [https://cron-job.org](https://cron-job.org)
   - Click **Sign Up** at the top right
   - Enter your email and create a password
   - Verify your email address

2. **Create a New Cron Job**:
   - After logging in, click **Create Cron Job** (or use the dashboard)
   - Fill in the following details:

   | Field | Value |
   |-------|-------|
   | **Title** | WBM Apartment Scraper |
   | **URL** | Your GitHub Actions webhook URL or deployment URL |
   | **Execution Schedule** | Every 5 minutes (*/5 * * * *) |
   | **Notifications** | Enable email notifications (optional) |

3. **Deploy Your Application**:

   You can host this scraper on various platforms:

   **Option A: GitHub Actions (Recommended - Free)**
   - The project includes a `.github/workflows/scrape.yml` GitHub Actions workflow
   - Scraper runs automatically every 5 minutes
   - Requires: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` GitHub secrets
   - No manual setup needed - just push to GitHub!

   **Option B: Heroku, Railway, Render, or similar**
   - Deploy the Node.js application to your preferred platform
   - Set environment variables in the platform's dashboard
   - Service will run continuously

   **Option C: Your Own Server**
   - Run the service on your local machine or VPS
   - Use `nohup npm start > apartment-scraper.log 2>&1 &` to run in background
   - Or set up as a systemd service (see below)

   **Option D: cron-job.org**
   - Create a simple webhook endpoint that triggers `npm start`
   - Set the cron schedule to your desired interval
   - Works well for low-frequency checks (every 30 min or less frequently)

### 5. Run the Service Locally

**Single run:**
```bash
npm start
```

**Development mode (auto-restart on file changes):**
```bash
npm run dev
```

**Run in background (macOS/Linux):**
```bash
nohup npm start > apartment-scraper.log 2>&1 &
```

**Run as systemd service (Linux):**

Create `/etc/systemd/system/apartment-scraper.service`:

```ini
[Unit]
Description=WBM Apartment Scraper
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/wbm-apartment-scraper
Environment="PATH=/usr/local/bin:/usr/bin"
EnvironmentFile=/path/to/wbm-apartment-scraper/.env
ExecStart=/usr/bin/node /path/to/wbm-apartment-scraper/apartment-scraper.js
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable apartment-scraper
sudo systemctl start apartment-scraper
sudo systemctl status apartment-scraper
```

**Check logs:**
```bash
sudo journalctl -u apartment-scraper -f
```

## Configuration

### WBM Configuration

Edit the CONFIG object in `apartment-scraper.js`:

```javascript
const CONFIG = {
  targetRooms: 3,              // Number of rooms to filter
  maxRent: 1200,               // Maximum rent in euros
  checkInterval: '*/5 * * * *', // Cron format (every 5 min)
  dataFile: 'apartments-data.json', // Where to store results
  url: 'https://www.wbm.de/wohnungen-berlin/angebote/'
};
```

### Howoge Configuration

Edit the configuration in `howoge-scraper.js`:

```javascript
const DEFAULT_CONFIG = {
  targetRooms: 3,              // Number of rooms to filter
  maxRent: 1200,               // Maximum rent in euros
  dataFile: 'howoge-data.json', // Where to store Howoge results
  url: 'https://www.howoge.de/immobiliensuche/wohnungssuche.html?...'
};
```

**Check Interval (Cron Format)**:
- `*/30 * * * *` - Every 30 minutes
- `0 * * * *` - Every hour
- `0 9,18 * * *` - At 9 AM and 6 PM
- `0 8-18 * * 1-5` - Every hour 8 AM-6 PM on weekdays

## Data Storage

Results are saved to separate JSON files for each source:

- **`apartments-data.json`**: WBM Berlin apartment listings
- **`howoge-data.json`**: Howoge apartment listings

Each file tracks all apartments from that source that match your criteria, allowing the service to detect new listings.

## Notifications

The service sends two types of Telegram messages per source:

1. **Summary Message**: Shows all new apartments found at once
2. **Individual Messages**: Detailed message for each apartment with link to listing

Messages are formatted with apartment details (address, rooms, size, rent, link) and include the source (WBM or Howoge).

### Notification Timing

- Both scrapers run in parallel on the schedule (default: every 5 minutes)
- Separate notifications for each source
- Notifications are sent immediately when new apartments are detected

## Troubleshooting

**Not receiving Telegram notifications?**
- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in `.env`
- Make sure you've sent a message to your bot first
- Test by manually sending a message: `curl -X POST https://api.telegram.org/bot<TOKEN>/sendMessage -d chat_id=<CHAT_ID> -d text="Test"`
- Check that the bot is not restricted by Telegram (privacy settings)

**Service not finding apartments?**
- The website structure may have changed. The service uses CSS selectors that might need updating.
- Run once manually to see console output and debug selector issues
- Check the website to see how apartments are currently displayed

**How to test manually?**

Test both scrapers:
```bash
node apartment-scraper.js
```

Test Howoge scraper specifically:
```bash
node test-howoge.js
```

Test WBM scraper specifically:
```bash
node debug.js
```

## License

MIT
