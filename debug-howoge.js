#!/usr/bin/env node

require('dotenv').config();
const { chromium } = require('playwright');

async function debugHowoge() {
  const url = 'https://www.howoge.de/immobiliensuche/wohnungssuche.html?tx_howrealestate_json_list%5Bpage%5D=1&tx_howrealestate_json_list%5Blimit%5D=12&tx_howrealestate_json_list%5Blang%5D=&tx_howrealestate_json_list%5Broooms%5D=3&tx_howrealestate_json_list%5Bwbs%5D=';

  console.log('🔍 Debugging Howoge website structure...\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('📄 Loading page...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('✅ Page loaded\n');

  const pageContent = await page.content();

  // Check for various possible selectors
  const selectors = [
    '[data-testid="property-item"]',
    '.property-item',
    '.immo-element',
    '[class*="property"]',
    '[class*="apartment"]',
    '[class*="listing"]',
    'article',
    '.card',
    '.result-item',
    '.immobilie',
    '[data-type="property"]'
  ];

  console.log('🔎 Checking common selectors:\n');

  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    console.log(`  ${selector}: ${count} found`);
  }

  console.log('\n📋 Page structure analysis:');
  console.log(`  Page title: ${await page.title()}`);
  console.log(`  Page URL: ${page.url()}`);

  // Look for any divs with specific classes
  const divClasses = await page.evaluate(() => {
    const divs = document.querySelectorAll('div[class]');
    const classes = new Set();
    divs.forEach(div => {
      div.className.split(' ').forEach(cls => {
        if (cls.toLowerCase().includes('item') ||
            cls.toLowerCase().includes('card') ||
            cls.toLowerCase().includes('result') ||
            cls.toLowerCase().includes('property') ||
            cls.toLowerCase().includes('apartment') ||
            cls.toLowerCase().includes('immobilie')) {
          classes.add(cls);
        }
      });
    });
    return Array.from(classes).sort();
  });

  console.log('\n🏷️ Relevant CSS classes found:');
  divClasses.forEach(cls => console.log(`  .${cls}`));

  // Check the HTML structure
  console.log('\n📝 Body HTML (first 2000 chars):');
  const bodyHTML = await page.evaluate(() => document.body.innerHTML);
  console.log(bodyHTML.substring(0, 2000));
  console.log('...\n');

  // Try to find any apartment-like data
  const apartmentData = await page.evaluate(() => {
    // Try to find data in window object
    const dataKeys = Object.keys(window).filter(k =>
      k.toLowerCase().includes('data') ||
      k.toLowerCase().includes('apartment') ||
      k.toLowerCase().includes('property') ||
      k.toLowerCase().includes('immobilie')
    );
    return dataKeys;
  });

  console.log('💾 Data variables found in window:');
  apartmentData.forEach(key => console.log(`  window.${key}`));

  await browser.close();
  console.log('\n✅ Debug complete');
}

debugHowoge().catch(console.error);
