#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readMetadata, getArchiveDir } = require('../tools/file-ops.js');
const { main: rebuildIndexes } = require('../tools/rebuild-index.js');
const { generateWeeklyReport, archiveWeekSnapshot } = require('../tools/archive-ops.js');

try {
  rebuildIndexes();

  const metadata = readMetadata();
  const lastWeek = (metadata.currentWeek || 1) - 1;

  if (lastWeek < 1) {
    console.log('Weekly task completed.');
    console.log('- No previous week to summarize yet.');
    process.exit(0);
  }

  const report = generateWeeklyReport(lastWeek);
  if (!report) {
    throw new Error(`Week ${lastWeek} range not found.`);
  }

  const weeklyDir = path.join(getArchiveDir(metadata.semester), 'weekly');
  fs.mkdirSync(weeklyDir, { recursive: true });
  const reportPath = path.join(weeklyDir, `week-${lastWeek}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const snapshotResult = archiveWeekSnapshot(lastWeek);
  if (!snapshotResult.success) {
    throw new Error(snapshotResult.error || 'Failed to archive weekly snapshot.');
  }

  console.log('Weekly task completed.');
  console.log(`- Week: ${lastWeek}`);
  console.log(`- Report: ${reportPath}`);
  console.log(`- Raw snapshot: ${snapshotResult.filePath}`);
  console.log(`- Items: ${report.stats.totalItems}`);
} catch (error) {
  console.error('Weekly task failed:', error.message);
  process.exit(1);
}
