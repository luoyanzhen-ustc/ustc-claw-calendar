#!/usr/bin/env node

const {
  readCourses,
  readRecurring,
  readPlans,
  readMetadata,
  writeMetadata,
  writeTodayIndex,
  writeUpcomingIndex,
  writePlans
} = require('./file-ops.js');
const { getCurrentWeek } = require('./date-math.js');

function groupBy(items, key) {
  return (items || []).reduce((accumulator, item) => {
    const value = item[key] || 'unknown';
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
}

function getBeijingDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function addDays(dateString, days) {
  const source = new Date(`${dateString}T00:00:00+08:00`);
  source.setUTCDate(source.getUTCDate() + days);
  return getBeijingDateString(source);
}

function getWeekday(dateString) {
  const date = new Date(`${dateString}T12:00:00+08:00`);
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function isActive(statusHolder) {
  return (statusHolder?.lifecycle?.status || statusHolder?.status || 'active') === 'active';
}

function isCourseInCurrentWeek(course, currentWeek) {
  const weekRanges = course.schedule?.weekRanges || [];
  if (!Array.isArray(weekRanges) || weekRanges.length === 0) {
    return true;
  }

  return weekRanges.some(([start, end]) => currentWeek >= start && currentWeek <= end);
}

function sortByStartTime(events) {
  return events.sort((left, right) => {
    const leftTime = left.schedule?.displayTime || left.schedule?.startTime || '00:00';
    const rightTime = right.schedule?.displayTime || right.schedule?.startTime || '00:00';
    return leftTime.localeCompare(rightTime);
  });
}

function buildEventsForDate(dateString, currentWeek) {
  const weekday = getWeekday(dateString);
  const courses = readCourses().courses
    .filter((course) => isActive(course))
    .filter((course) => Number(course.schedule?.weekday) === weekday)
    .filter((course) => isCourseInCurrentWeek(course, currentWeek))
    .map((course) => ({
      ...course,
      source: 'courses',
      type: 'course'
    }));

  const recurring = readRecurring().recurring
    .filter((item) => isActive(item))
    .filter((item) => {
      const weekdays = Array.isArray(item.schedule?.weekday) ? item.schedule.weekday : [item.schedule?.weekday];
      return weekdays.map(Number).includes(weekday);
    })
    .map((item) => ({
      ...item,
      source: 'recurring',
      type: 'recurring'
    }));

  const plans = readPlans().plans
    .filter((plan) => isActive(plan))
    .filter((plan) => (plan.schedule?.displayDate || plan.schedule?.date) === dateString)
    .map((plan) => ({
      ...plan,
      source: 'plans',
      type: 'plan'
    }));

  return sortByStartTime([...courses, ...recurring, ...plans]);
}

function buildTodayIndex() {
  const metadata = readMetadata();
  const today = getBeijingDateString();
  const currentWeek = metadata.startDate ? Math.max(getCurrentWeek(metadata.startDate) || 1, 1) : metadata.currentWeek || 1;
  const events = buildEventsForDate(today, currentWeek);

  return {
    generatedAt: new Date().toISOString(),
    date: today,
    currentWeek,
    events,
    summary: {
      total: events.length,
      byType: groupBy(events, 'type'),
      byPriority: groupBy(events, 'priority')
    }
  };
}

function buildUpcomingIndex(days = 7) {
  const metadata = readMetadata();
  const today = getBeijingDateString();
  const currentWeek = metadata.startDate ? Math.max(getCurrentWeek(metadata.startDate) || 1, 1) : metadata.currentWeek || 1;
  const events = [];

  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(today, offset);
    events.push({
      date,
      events: buildEventsForDate(date, currentWeek)
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    range: {
      start: today,
      end: addDays(today, days - 1)
    },
    events,
    reminders: []
  };
}

function cleanupExpiredPlans() {
  const plansData = readPlans();
  const today = getBeijingDateString();
  let changed = false;

  for (const plan of plansData.plans) {
    const planDate = plan.schedule?.displayDate || plan.schedule?.date;
    if (isActive(plan) && planDate && planDate < today) {
      plan.lifecycle = {
        ...(plan.lifecycle || {}),
        status: 'expired',
        expiredAt: new Date().toISOString()
      };
      changed = true;
    }
  }

  if (changed) {
    writePlans(plansData);
  }

  return changed;
}

function updateCourseWeek() {
  const metadata = readMetadata();
  if (!metadata.startDate) {
    return false;
  }

  const nextWeek = Math.max(getCurrentWeek(metadata.startDate) || 1, 1);
  if (nextWeek === metadata.currentWeek) {
    return false;
  }

  metadata.currentWeek = nextWeek;
  metadata.updatedAt = new Date().toISOString();
  writeMetadata(metadata);
  return true;
}

function main() {
  const todayIndex = buildTodayIndex();
  const upcomingIndex = buildUpcomingIndex(7);
  writeTodayIndex(todayIndex);
  writeUpcomingIndex(upcomingIndex);
  cleanupExpiredPlans();
  updateCourseWeek();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('重建索引失败:', error.message);
    process.exit(1);
  }
}

module.exports = {
  buildTodayIndex,
  buildUpcomingIndex,
  cleanupExpiredPlans,
  updateCourseWeek,
  main
};
