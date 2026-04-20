#!/usr/bin/env node

require('dotenv').config();
const { chromium } = require('playwright');

async function debugHowoge() {
  const url = 'https://www.howoge.de/immobiliensuche/wohnungssuche.html?tx_howrealestate_json_list%5Bpage%5D=1&tx_howrealestate_json_list%5Blimit%5D=12&tx_howrealestate_json_list%5Blang%5D=&tx_howrealestate_json_list%5Broooms%5D=3&tx_howrealestate_json_list%5Bwbs%5D=';

  console.log('🔍 Debugging Howoge Price/Rent Extraction\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  const sampleItem = await page.evaluate(() => {
    const firstItem = document.querySelector('.flat-single-grid-item');
    if (!firstItem) return { error: 'No item found' };

    return {
      fullHTML: firstItem.outerHTML.substring(0, 2000),
      allClasses: Array.from(firstItem.querySelectorAll('*')).map(el => ({
        tag: el.tagName,
        class: el.className,
        text: el.textContent.substring(0, 80)
      })).slice(0, 20)
    };
  });

  console.log('📝 First Item HTML and Structure:');
  console.log(JSON.stringify(sampleItem, null, 2));

  // Try to find price elements
  const priceInfo = await page.evaluate(() => {
    const firstItem = document.querySelector('.flat-single-grid-item');
    if (!firstItem) return null;

    return {
      itemText: firstItem.innerText.substring(0, 500),
      allText: firstItem.textContent.substring(0, 500),
      priceElements: Array.from(firstItem.querySelectorAll('*')).filter(el =>
        el.textContent.includes('€') || el.className.includes('price') || el.className.includes('rent')
      ).map(el => ({
        tag: el.tagName,
        class: el.className,
        text: el.textContent.trim()
      }))
    };
  });

  console.log('\n💰 Price Information:');
  console.log(JSON.stringify(priceInfo, null, 2));

  await browser.close();
}

debugHowoge().catch(console.error);
