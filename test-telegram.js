const axios = require('axios');
require('dotenv').config();

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

console.log('Testing Telegram notification...');
console.log(`Token: ${telegramToken ? '✓ Set' : '✗ Missing'}`);
console.log(`Chat ID: ${telegramChatId ? '✓ Set' : '✗ Missing'}`);

if (!telegramToken || !telegramChatId) {
  console.error('❌ Telegram credentials not configured!');
  process.exit(1);
}

(async () => {
  try {
    const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
    console.log(`\nSending to: ${url}`);

    const response = await axios.post(url, {
      chat_id: telegramChatId,
      text: '🧪 Test notification from apartment scraper!',
      parse_mode: 'HTML'
    });

    console.log('✅ Notification sent successfully!');
    console.log('Response:', response.data);
  } catch (error) {
    console.error('❌ Error sending notification:', error.response?.data || error.message);
  }
})();
