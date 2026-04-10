#!/usr/bin/env node

const { main } = require('../tools/rebuild-index.js');

try {
  const result = main();
  console.log('Daily task completed.');
  console.log(`- Today: ${result.todayIndex.date}`);
  console.log(`- Today items: ${result.todayIndex.summary.total}`);
  console.log(`- This week items: ${result.thisWeekIndex.summary.total}`);
  console.log(`- Upcoming range: ${result.upcomingIndex.range.start} ~ ${result.upcomingIndex.range.end}`);
} catch (error) {
  console.error('Daily task failed:', error.message);
  process.exit(1);
}
