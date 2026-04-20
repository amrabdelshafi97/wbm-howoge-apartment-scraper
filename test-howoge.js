#!/usr/bin/env node

require('dotenv').config();
const HowogeScraper = require('./howoge-scraper');

async function testHowogeScraper() {
  console.log('🧪 Testing Howoge Scraper\n');

  const scraper = new HowogeScraper();

  console.log('Configuration:');
  console.log(`  URL: ${scraper.config.url}`);
  console.log(`  Target Rooms: ${scraper.config.targetRooms}`);
  console.log(`  Max Rent: €${scraper.config.maxRent}`);
  console.log(`  Data File: ${scraper.config.dataFile}`);
  console.log(`\nTelegram Status:`);
  console.log(`  Token: ${scraper.telegramToken ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`  Chat ID: ${scraper.telegramChatId ? '✅ Configured' : '❌ Not configured'}`);

  console.log('\n🌐 Fetching apartments from Howoge...\n');

  try {
    const apartments = await scraper.fetchApartments();
    console.log(`\n✅ Fetched ${apartments.length} apartments`);

    if (apartments.length > 0) {
      console.log('\nSample apartments:');
      apartments.slice(0, 3).forEach((apt, idx) => {
        console.log(`\n  ${idx + 1}. ${apt.address}`);
        console.log(`     Rooms: ${apt.rooms}, Rent: €${apt.rent}, Size: ${apt.size}m²`);
        console.log(`     Link: ${apt.link.substring(0, 80)}...`);
      });
    }
  } catch (error) {
    console.error('\n❌ Error testing scraper:');
    console.error(error.message);
  }

  console.log('\n✅ Test completed');
  process.exit(0);
}

testHowogeScraper();
