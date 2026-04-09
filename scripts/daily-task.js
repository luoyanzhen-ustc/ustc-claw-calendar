#!/usr/bin/env node

const { main } = require('../tools/rebuild-index.js');

try {
  main();
  console.log('每日任务执行完成');
} catch (error) {
  console.error('每日任务执行失败:', error.message);
  process.exit(1);
}
