const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Opening page...');
  await page.goto('https://www.wbm.de/wohnungen-berlin/angebote/', { waitUntil: 'networkidle' });

  console.log('Waiting for content...');
  await page.waitForTimeout(3000);

  // First check if elements exist using Playwright locators
  const count1 = await page.locator('article.teaserBox.immo-element').count();
  const count2 = await page.locator('article.teaserBox').count();
  const count3 = await page.locator('h2.imageTitle').count();
  const count4 = await page.locator('.main-property-rooms').count();

  console.log(`Elements found:
  - article.teaserBox.immo-element: ${count1}
  - article.teaserBox: ${count2}
  - h2.imageTitle: ${count3}
  - .main-property-rooms: ${count4}`);

  // Get first item details manually to debug
  const firstTitle = await page.locator('h2.imageTitle').first().textContent();
  const firstAddress = await page.locator('.address').first().textContent();
  const firstRoomsText = await page.locator('.main-property-rooms').first().textContent();

  console.log(`\nFirst item details:
  - Title: "${firstTitle}"
  - Address: "${firstAddress}"
  - Rooms text: "${firstRoomsText}"`);

  // Check which frame contains the elements
  const firstTeaserBox = await page.locator('article.teaserBox').first();
  const frameOfElement = await firstTeaserBox.evaluate(el => {
    // Check if we can find parent frames/document info
    return {
      documentTitle: document.title,
      documentURL: document.location.href,
      elementTag: el.tagName,
      elementClass: el.className
    };
  });
  console.log(`\nElement details:
  - Document title: "${frameOfElement.documentTitle}"
  - Document URL: "${frameOfElement.documentURL}"
  - Element tag: "${frameOfElement.elementTag}"
  - Element class: "${frameOfElement.elementClass}"`);

  // Debug: Let's find where the actual data is located
  console.log('\n🔍 Finding actual data location...');

  // Get all h2.imageTitle elements - see if they're siblings or under teaserBox
  const allTitles = page.locator('h2.imageTitle');
  const titleCount = await allTitles.count();
  console.log(`Total h2.imageTitle found: ${titleCount}`);

  if (titleCount > 0) {
    const firstTitle = allTitles.first();

    // Get the parent structure
    const parentInfo = await firstTitle.evaluate(el => {
      let current = el;
      let depth = 0;
      const parents = [];

      while (current && depth < 10) {
        parents.push({
          tag: current.tagName,
          class: current.className,
          id: current.id
        });
        current = current.parentElement;
        depth++;
      }

      return {
        titleText: el.textContent,
        parents
      };
    });

    console.log('\nParent chain of h2.imageTitle:');
    parentInfo.parents.forEach((p, i) => {
      console.log(`  ${i}: <${p.tag} class="${p.class}" id="${p.id}">`);
    });
  }

  // Test extraction - check for shadow dom and get actual structure
  const apartments = await page.evaluate(() => {
    const results = [];
    const listings = document.querySelectorAll('article.teaserBox.immo-element');
    let structureInfo = [];
    let iframesInPage = document.querySelectorAll('iframe').length;

    for (let i = 0; i < listings.length; i++) {
      const item = listings[i];

      // Log detailed structure of first item
      if (i === 0) {
        const allChildren = Array.from(item.children).map(child => ({
          tag: child.tagName,
          class: child.className,
          id: child.id,
          children: child.children.length
        }));

        structureInfo.push({
          itemText: item.textContent?.substring(0, 200),
          directChildren: allChildren,
          totalText: item.innerText?.substring(0, 200) || 'no innerText'
        });
      }

      // Try alternative extraction - look for ALL elements and parse structure
      const title = item.textContent?.match(/^\s*([\w\s\-äöüß,]+?)(?=\n|$)/i)?.[1]?.trim() || '';
      const address = item.textContent?.match(/([0-9]+[,\s]*Berlin)/i)?.[1] || '';
      const roomsText = item.textContent?.match(/(\d+)\s*[-–]Zimmer/i)?.[1] || '';
      const rooms = parseInt(roomsText) || 0;

      if (title && rooms > 0) {
        results.push({
          title,
          address,
          rooms,
          extractMethod: 'textContent'
        });
      }
    }

    return {
      apartments: results,
      structureInfo,
      iframesInPage
    };
  });

  console.log('\n✅ Found apartments:', apartments.apartments?.length || 0);
  console.log('Iframes in page.evaluate():', apartments.iframesInPage);

  if (apartments.structureInfo && apartments.structureInfo.length > 0) {
    const info = apartments.structureInfo[0];
    console.log('\nFirst item structure:');
    console.log('  Text (first 200 chars):', info.itemText);
    console.log('  InnerText (first 200 chars):', info.totalText);
    console.log('  Direct children:', info.directChildren);
  }

  apartments.apartments?.slice(0, 3).forEach((apt, i) => {
    console.log(`\n${i + 1}. ${apt.title}`);
    console.log(`   Address: ${apt.address}`);
    console.log(`   Rooms: ${apt.rooms}`);
  });

  // Let's check the actual HTML of the rent and size fields
  console.log('\n📋 Checking data field HTML...');
  const firstImmoEl = page.locator('article.immo-element').first();

  const rentHTML = await firstImmoEl.locator('.main-property-rent').evaluate(el => ({
    text: el.textContent,
    html: el.innerHTML
  })).catch(() => ({ text: 'not found', html: '' }));

  const sizeHTML = await firstImmoEl.evaluate(el => {
    const text = el.textContent;
    const match = text.match(/(\d+)\s*(?:m²|m2|qm)/i);
    return {
      fullText: text.substring(0, 500),
      sizeMatch: match ? match[0] : null
    };
  });

  console.log('Rent field HTML:', rentHTML);
  console.log('Size extraction:', sizeHTML);

  await context.close();
  await browser.close();
})();
