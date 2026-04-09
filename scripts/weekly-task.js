#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readMetadata, getArchiveDir } = require('../tools/file-ops.js');
const { generateWeeklyReport, archiveLastWeekPlans } = require('../tools/archive-ops.js');

try {
  const metadata = readMetadata();
  const lastWeek = (metadata.currentWeek || 1) - 1;

  if (lastWeek >= 1) {
    const report = generateWeeklyReport(lastWeek);
    if (report) {
      const weeklyDir = path.join(getArchiveDir(metadata.semester), 'weekly');
      fs.mkdirSync(weeklyDir, { recursive: true });
      fs.writeFileSync(path.join(weeklyDir, `week-${lastWeek}.json`), JSON.stringify(report, null, 2), 'utf8');
    }
  }

  archiveLastWeekPlans();
  console.log('每周任务执行完成');
} catch (error) {
  console.error('每周任务执行失败:', error.message);
  process.exit(1);
}
