#!/usr/bin/env node

const fs = require('fs');
const {
  ensureDataLayout,
  readSettings,
  writeSettings,
  readMetadata,
  writeMetadata,
  readCourses,
  writeCourses,
  readRecurring,
  writeRecurring,
  readPlans,
  writePlans,
  readKnownUsers,
  writeKnownUsers,
  normalizeKnownUsers,
  getKnownUsersPath
} = require('../tools/file-ops.js');
const { getCurrentWeek } = require('../tools/date-math.js');

const DEFAULT_START_DATE = '2026-03-01';
const DEFAULT_TOTAL_WEEKS = 20;

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deriveSemesterName(startDate) {
  const [year, month] = startDate.split('-').map(Number);
  return month >= 8 ? `${year}-fall` : `${year}-spring`;
}

function calculateEndDate(startDate, totalWeeks = DEFAULT_TOTAL_WEEKS) {
  const start = new Date(`${startDate}T00:00:00+08:00`);
  start.setDate(start.getDate() + totalWeeks * 7 - 1);
  return formatDate(start);
}

function generateWeekMapping(startDate, totalWeeks = DEFAULT_TOTAL_WEEKS) {
  const mapping = {};
  const start = new Date(`${startDate}T00:00:00+08:00`);

  for (let week = 1; week <= totalWeeks; week += 1) {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + (week - 1) * 7);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    mapping[`week${week}`] = {
      start: formatDate(weekStart),
      end: formatDate(weekEnd)
    };
  }

  return mapping;
}

function calculateCurrentWeek(startDate) {
  const currentWeek = getCurrentWeek(startDate);
  if (!currentWeek || currentWeek < 1) {
    return 1;
  }

  return Math.min(currentWeek, DEFAULT_TOTAL_WEEKS);
}

function ensureKnownUsersFile() {
  const knownUsersPath = getKnownUsersPath();
  if (!fs.existsSync(knownUsersPath)) {
    writeKnownUsers(readKnownUsers());
  }

  return knownUsersPath;
}

function checkChannels() {
  const normalizedUsers = normalizeKnownUsers(readKnownUsers());
  const qqCount = normalizedUsers.filter((user) => user.qq.enabled && user.qq.openid).length;
  const wechatCount = normalizedUsers.filter((user) => user.weixin.enabled && user.weixin.userId).length;

  return {
    qqCount,
    wechatCount,
    hasAnyChannel: qqCount > 0 || wechatCount > 0
  };
}

function initializeFiles(semesterName) {
  const courses = readCourses();
  if (!Array.isArray(courses.courses)) {
    writeCourses({ ...courses, semester: semesterName, courses: [] });
  } else if (!courses.semester) {
    writeCourses({ ...courses, semester: semesterName });
  }

  const recurring = readRecurring();
  if (!Array.isArray(recurring.recurring)) {
    writeRecurring({ ...recurring, recurring: [] });
  }

  const plans = readPlans();
  if (!Array.isArray(plans.plans)) {
    writePlans({ ...plans, plans: [] });
  }
}

function initializeSemester(options = {}) {
  ensureDataLayout();

  const startDate = options.startDate || DEFAULT_START_DATE;
  const semesterName = options.semesterName || deriveSemesterName(startDate);
  const endDate = options.endDate || calculateEndDate(startDate);
  const currentWeek = calculateCurrentWeek(startDate);

  const currentSettings = readSettings();
  writeSettings({
    ...currentSettings,
    timezone: 'Asia/Shanghai',
    displayTimezone: 'Asia/Shanghai',
    semesterStart: startDate,
    semesterName
  });

  const previousMetadata = readMetadata();
  writeMetadata({
    ...previousMetadata,
    semester: semesterName,
    name: `${semesterName}学期`,
    school: 'USTC',
    startDate,
    endDate,
    totalWeeks: DEFAULT_TOTAL_WEEKS,
    currentWeek,
    weekMapping: generateWeekMapping(startDate),
    stats: {
      totalCourses: readCourses().courses.length,
      totalRecurring: readRecurring().recurring.length,
      totalPlans: readPlans().plans.length,
      byStatus: previousMetadata.stats?.byStatus || {}
    }
  });

  initializeFiles(semesterName);
  ensureKnownUsersFile();

  return {
    semesterName,
    startDate,
    endDate,
    currentWeek
  };
}

function printChannelStatus() {
  const knownUsersPath = ensureKnownUsersFile();
  const status = checkChannels();

  console.log('渠道配置检查:');
  console.log(`- known-users.json: ${knownUsersPath}`);
  console.log(`- QQ 用户数: ${status.qqCount}`);
  console.log(`- 微信用户数: ${status.wechatCount}`);

  if (!status.hasAnyChannel) {
    console.log('- 状态: 尚未配置 QQ/微信渠道，请编辑 known-users.json');
  }
}

function parseArgs(argv) {
  const options = {
    startDate: null,
    semesterName: null,
    endDate: null,
    checkChannelsOnly: false
  };

  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--semester-start') {
      options.startDate = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--semester-name') {
      options.semesterName = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--end-date') {
      options.endDate = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--check-channels') {
      options.checkChannelsOnly = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    positional.push(arg);
  }

  if (!options.semesterName && positional[0]) {
    options.semesterName = positional[0];
  }

  if (!options.startDate && positional[1]) {
    options.startDate = positional[1];
  }

  return options;
}

function printHelp() {
  console.log('用法:');
  console.log('  node auto-init.js');
  console.log('  node auto-init.js <semesterName> <startDate>');
  console.log('  node auto-init.js --semester-start 2026-03-01 --semester-name 2026-spring');
  console.log('  node auto-init.js --check-channels');
  console.log('');
  console.log(`默认学期起始日期: ${DEFAULT_START_DATE}`);
}

function runFromArgs(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return { success: true, help: true };
  }

  ensureDataLayout();

  if (options.checkChannelsOnly) {
    printChannelStatus();
    return { success: true, mode: 'check-channels' };
  }

  const result = initializeSemester(options);

  console.log('USTC Claw Calendar 初始化完成:');
  console.log(`- 学期: ${result.semesterName}`);
  console.log(`- 学期开始: ${result.startDate}`);
  console.log(`- 学期结束: ${result.endDate}`);
  console.log(`- 当前周: 第 ${result.currentWeek} 周`);
  printChannelStatus();

  return {
    success: true,
    ...result
  };
}

if (require.main === module) {
  try {
    runFromArgs(process.argv.slice(2));
  } catch (error) {
    console.error('初始化失败:', error.message);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_START_DATE,
  calculateCurrentWeek,
  generateWeekMapping,
  deriveSemesterName,
  ensureKnownUsersFile,
  checkChannels,
  initializeSemester,
  runFromArgs
};
