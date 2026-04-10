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
  readEvents,
  writeEvents,
  getKnownUsersPath
} = require('../tools/file-ops.js');
const { getCurrentWeek } = require('../tools/date-math.js');
const { syncChannels } = require('../tools/channel-sync.js');

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
    syncChannels();
  }

  return knownUsersPath;
}

function checkChannels() {
  return syncChannels();
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

  const events = readEvents();
  if (!Array.isArray(events.events)) {
    writeEvents({ ...events, events: [] });
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
      totalEvents: readEvents().events.length,
      totalRecurring: readRecurring().recurring.length,
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

  console.log('渠道配置同步结果');
  console.log(`- 缓存文件: ${knownUsersPath}`);
  console.log(`- OpenClaw 根目录: ${status.openClawHome}`);
  console.log(`- 同步来源: ${status.source}`);
  console.log(`- QQ 用户数: ${status.qqCount}`);
  console.log(`- 微信用户数: ${status.wechatCount}`);

  if (status.qqKnownUsersFile) {
    console.log(`- QQ 来源文件: ${status.qqKnownUsersFile}`);
  }

  if (status.weixinAccountsDir) {
    console.log(`- 微信来源目录: ${status.weixinAccountsDir}`);
  }

  if (!status.hasAnyChannel) {
    console.log('- 状态: 尚未检测到已连通的 QQ/微信 bot。请先让用户通过 QQ 或微信与 OpenClaw 机器人聊过天，无需手动提供 ID。');
  } else if (status.synced) {
    console.log('- 状态: 已从 OpenClaw 已连通的 bot 渠道自动同步配置。');
  } else {
    console.log('- 状态: 当前未读取到新的系统配置，已保留本地缓存。');
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

  console.log('USTC Claw Calendar 初始化完成');
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
