#!/usr/bin/env node

/**
 * Scraper runner script for CI/CD workflows
 * Runs the orchestrator in single-pass mode and exits cleanly
 */

require('dotenv').config();

const { ScraperOrchestrator } = require('./wbm-scraper');

async function main() {
  try {
    console.log(`[${new Date().toISOString()}] Starting single-pass scraper run...`);

    const orchestrator = new ScraperOrchestrator();

    // Run all scrapers once
    await orchestrator.runAllScrapers();

    console.log(`[${new Date().toISOString()}] Scraper run completed successfully`);
    process.exit(0);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Scraper run failed:`, error);
    process.exit(1);
  }
}

main();
