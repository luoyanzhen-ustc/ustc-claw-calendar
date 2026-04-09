#!/usr/bin/env node

const { runFromArgs, DEFAULT_START_DATE, deriveSemesterName } = require('./auto-init.js');

function normalizeArgs(argv) {
  if (argv.length > 0) {
    return argv;
  }

  return [
    '--semester-start',
    process.env.CLAW_CALENDAR_SEMESTER_START || DEFAULT_START_DATE,
    '--semester-name',
    process.env.CLAW_CALENDAR_SEMESTER_NAME || deriveSemesterName(process.env.CLAW_CALENDAR_SEMESTER_START || DEFAULT_START_DATE)
  ];
}

try {
  runFromArgs(normalizeArgs(process.argv.slice(2)));
  console.log('安装后初始化完成');
} catch (error) {
  console.error('安装后初始化失败:', error.message);
  process.exit(1);
}
