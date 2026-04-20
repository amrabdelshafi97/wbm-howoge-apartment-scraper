# WBM Apartment Scraper

A background service that monitors multiple apartment sources in Berlin and notifies you when new apartments matching your criteria become available.

## Features

- 🔍 **Multi-Source Scraping**: Monitors both WBM Berlin and Howoge apartments
- 📱 **Telegram Notifications**: Get notified via Telegram when NEW apartments match your criteria
- 💾 **Data Persistence**: Tracks previous results for each source to detect only new listings
- 🎯 **Filtered Results**: Customizable filters (rooms, maximum rent)
- 📊 **Diff Detection**: Only notifies on NEW listings, never duplicates
- ⚡ **Parallel Execution**: Scrapes multiple sources simultaneously for efficiency

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Telegram Bot

First, get your Telegram Bot Token and Chat ID:

1. **Create a Telegram Bot**:
   - Open Telegram and search for `@BotFather`
   - Send `/newbot` and follow the prompts
   - You'll get a bot token: `123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh`

2. **Get your Chat ID**:
   - Send any message to your bot
   - Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` (replace `<YOUR_TOKEN>`)
   - Look for `"chat":{"id":123456789}` - that's your chat ID

3. **Create `.env` file**:

```bash
cp .env.example .env
```

4. **Edit `.env`** and add your credentials:

```
TELEGRAM_BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
TELEGRAM_CHAT_ID=123456789
```

### 3. Run the Service

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
WorkingDirectory=/Users/aabdelshafi/Private
Environment="PATH=/usr/local/bin:/usr/bin"
EnvironmentFile=/Users/aabdelshafi/Private/.env
ExecStart=/usr/bin/node /Users/aabdelshafi/Private/apartment-scraper.js
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
