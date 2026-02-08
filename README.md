# WBM Apartment Scraper

A background service that monitors WBM Berlin apartments and notifies you when new 3-room apartments under €1200/month become available.

## Features

- 🔍 **Automatic Scraping**: Checks WBM listings every 5 minutes (configurable)
- 📱 **Telegram Notifications**: Get notified via Telegram when NEW apartments match your criteria
- 💾 **Data Persistence**: Tracks previous results to detect only new listings
- 🎯 **Filtered Results**: Only shows 3-room apartments under €1200
- 📊 **Diff Detection**: Only notifies on NEW listings, never duplicates

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

Edit the CONFIG object in `apartment-scraper.js`:

```javascript
const CONFIG = {
  targetRooms: 3,              // Number of rooms to filter
  maxRent: 1200,               // Maximum rent in euros
  checkInterval: '*/30 * * * *', // Cron format (every 30 min)
  dataFile: 'apartments-data.json', // Where to store results
  url: 'https://www.wbm.de/wohnungen-berlin/angebote/'
};
```

**Check Interval (Cron Format)**:
- `*/30 * * * *` - Every 30 minutes
- `0 * * * *` - Every hour
- `0 9,18 * * *` - At 9 AM and 6 PM
- `0 8-18 * * 1-5` - Every hour 8 AM-6 PM on weekdays

## Data Storage

Results are saved to `apartments-data.json`. This file tracks all apartments that match your criteria, allowing the service to detect new listings.

## Notifications

The service sends two types of Telegram messages:

1. **Summary Message**: Shows all new apartments found at once
2. **Individual Messages**: Detailed message for each apartment with link to listing

Messages are formatted with apartment details (address, rooms, size, rent, link).

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
```bash
node apartment-scraper.js
```

## License

MIT
