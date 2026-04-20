#!/usr/bin/env node

require('dotenv').config();
const { chromium } = require('playwright');

async function debugHowoge() {
  const url = 'https://www.howoge.de/immobiliensuche/wohnungssuche.html?tx_howrealestate_json_list%5Bpage%5D=1&tx_howrealestate_json_list%5Blimit%5D=12&tx_howrealestate_json_list%5Blang%5D=&tx_howrealestate_json_list%5Broooms%5D=3&tx_howrealestate_json_list%5Bwbs%5D=';

  console.log('🔍 Detailed Howoge Structure Analysis\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for results to load
  await page.waitForTimeout(5000);

  const results = await page.evaluate(() => {
    console.log('Analyzing page structure...');

    // Check results wrapper
    const resultsWrapper = document.querySelector('.results-wrapper');
    console.log('Results wrapper found:', !!resultsWrapper);

    if (resultsWrapper) {
      console.log('Results wrapper classes:', resultsWrapper.className);
      console.log('Results wrapper children:', resultsWrapper.children.length);

      // Check for grid items
      const gridItems = resultsWrapper.querySelectorAll('.flat-single-grid-item');
      console.log('Grid items found:', gridItems.length);

      if (gridItems.length > 0) {
        const firstItem = gridItems[0];
        console.log('First item HTML:', firstItem.outerHTML.substring(0, 500));
      }
    }

    // Try to find any divs that might be apartments
    const allDivs = document.querySelectorAll('div[class*="item"]');
    console.log('Divs with "item" in class:', allDivs.length);

    // Check for links to apartments
    const allLinks = document.querySelectorAll('a[href*="immobilie"], a[href*="property"], a[href*="wohnung"]');
    console.log('Apartment links found:', allLinks.length);

    if (allLinks.length > 0) {
      console.log('Sample links:');
      Array.from(allLinks).slice(0, 3).forEach((link, idx) => {
        console.log(`  ${idx + 1}. ${link.href}`);
      });
    }

    // Try to find text with prices and rooms
    const bodyText = document.body.innerText;
    const roomMatches = bodyText.match(/(\d+)\s*(?:Zimmer|Z\.)/gi);
    console.log('Room mentions found:', roomMatches ? roomMatches.length : 0);

    const priceMatches = bodyText.match(/€\s*[\d.,]+|[\d.,]+\s*€/g);
    console.log('Price mentions found:', priceMatches ? priceMatches.length : 0);

    return {
      resultsWrapperExists: !!resultsWrapper,
      gridItemsCount: resultsWrapper ? resultsWrapper.querySelectorAll('.flat-single-grid-item').length : 0,
      allItemsCount: allDivs.length,
      linksCount: allLinks.length,
      roomMentions: roomMatches ? roomMatches.length : 0,
      priceMentions: priceMatches ? priceMatches.length : 0
    };
  });

  console.log('\n📊 Analysis Results:');
  console.log(JSON.stringify(results, null, 2));

  // Now try to extract specific item structure
  console.log('\n🏠 Extracting apartment structure from first item:');

  const sampleData = await page.evaluate(() => {
    const wrapper = document.querySelector('.results-wrapper');
    if (!wrapper) return null;

    // Try various selectors
    let items = wrapper.querySelectorAll('.flat-single-grid-item');
    if (items.length === 0) {
      items = wrapper.querySelectorAll('[class*="item"]');
    }

    if (items.length === 0) return { noItemsFound: true };

    const firstItem = items[0];

    return {
      html: firstItem.outerHTML.substring(0, 1500),
      textContent: firstItem.textContent.substring(0, 500),
      childrenCount: firstItem.children.length,
      children: Array.from(firstItem.children).map((child, idx) => ({
        tag: child.tagName,
        class: child.className,
        text: child.textContent.substring(0, 100)
      }))
    };
  });

  console.log('\n📝 Sample Item Data:');
  if (sampleData) {
    console.log(JSON.stringify(sampleData, null, 2));
  } else {
    console.log('No items found');
  }

  await browser.close();
  console.log('\n✅ Debug complete');
}

debugHowoge().catch(console.error);
