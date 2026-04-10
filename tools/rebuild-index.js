#!/usr/bin/env node

const {
  DEFAULT_TIMEZONE,
  readCourses,
  readEvents,
  readRecurring,
  readMetadata,
  readSettings,
  writeMetadata,
  writeTodayIndex,
  writeThisWeekIndex,
  writeUpcomingIndex,
  toUTC,
  toLocal
} = require('./file-ops.js');
const {
  addDaysToDateString,
  computeWeekNumberFromStart,
  diffDateStrings,
  getCurrentWeek,
  getDateString,
  getWeekEndDate,
  getWeekStartDate,
  getWeekdayFromDateString,
  isWeekNumberWithinRanges
} = require('./date-math.js');
const { expandRecurringInRange } = require('./recurring-manager.js');

function groupBy(items, key) {
  return (items || []).reduce((accumulator, item) => {
    const value = item[key] || 'unknown';
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
}

function getDisplayTimezone() {
  const settings = readSettings();
  return settings.displayTimezone || settings.timezone || DEFAULT_TIMEZONE;
}

function sortByStartTime(items) {
  return [...items].sort((left, right) => {
    const leftTime = left.display?.startTime || '00:00';
    const rightTime = right.display?.startTime || '00:00';
    if (leftTime !== rightTime) {
      return leftTime.localeCompare(rightTime);
    }

    return (left.title || '').localeCompare(right.title || '');
  });
}

function buildSummary(items) {
  return {
    total: items.length,
    byType: groupBy(items, 'type'),
    byPriority: groupBy(items, 'priority'),
    withReminders: items.filter((item) => item.reminders?.enabled).length,
    completed: items.filter((item) => Boolean(item.completedAt)).length,
    cancelled: items.filter((item) => Boolean(item.cancelledAt)).length
  };
}

function isCourseActive(course) {
  const status = course?.lifecycle?.status || course?.status || 'active';
  return status === 'active';
}

function isEventIndexable(event) {
  if (!event?.startAt) {
    return false;
  }

  if (event.cancelledAt) {
    return false;
  }

  return true;
}

function buildCourseInstance(course, date, weekNumber, timezone) {
  const startAt = toUTC(date, course.schedule?.startTime, timezone);
  const endAt = course.schedule?.endTime ? toUTC(date, course.schedule.endTime, timezone) : null;

  return {
    id: `${course.id}:${date}:${course.schedule?.startTime || '00:00'}`,
    sourceId: course.id,
    sourceType: 'course',
    source: 'courses',
    type: 'course',
    title: course.title || course.name || 'Unnamed course',
    summary: course.summary || course.name || null,
    notes: course.notes || '',
    location: course.location || null,
    teacher: course.teacher || null,
    date,
    startAt,
    endAt,
    display: {
      date,
      startTime: course.schedule?.startTime || null,
      endTime: course.schedule?.endTime || null,
      timezone
    },
    reminders: course.reminders || { enabled: false, stages: [] },
    priority: course.priority || null,
    completedAt: null,
    cancelledAt: null,
    cancelNote: null,
    metadata: {
      source: course.metadata?.source || 'schedule-image',
      weekNumber,
      sourceUpdatedAt: course.metadata?.updatedAt || null
    }
  };
}

function buildCourseInstancesForDate(dateString, options = {}) {
  const timezone = options.timezone || getDisplayTimezone();
  const metadata = options.metadata || readMetadata();
  const courses = readCourses().courses || [];
  const weekday = getWeekdayFromDateString(dateString, timezone);

  return sortByStartTime(
    courses
      .filter(isCourseActive)
      .filter((course) => Number(course.schedule?.weekday) === weekday)
      .filter((course) => {
        const semesterStart = course.schedule?.semesterStart || metadata.startDate || null;
        if (semesterStart && dateString < semesterStart) {
          return false;
        }

        const weekNumber = computeWeekNumberFromStart(semesterStart, dateString);
        return isWeekNumberWithinRanges(weekNumber, course.schedule?.weekRanges || []);
      })
      .map((course) => {
        const semesterStart = course.schedule?.semesterStart || metadata.startDate || null;
        const weekNumber = computeWeekNumberFromStart(semesterStart, dateString);
        return buildCourseInstance(course, dateString, weekNumber, timezone);
      })
  );
}

function buildEventInstance(event, timezone) {
  const localStart = toLocal(event.startAt, timezone);
  const localEnd = event.endAt ? toLocal(event.endAt, timezone) : null;
  const display = event.display || {
    date: localStart?.date || null,
    startTime: localStart?.time || null,
    endTime: localEnd?.time || null,
    timezone
  };

  return {
    id: event.id,
    sourceId: event.id,
    sourceType: 'event',
    source: 'events',
    type: 'event',
    title: event.title,
    summary: event.summary || null,
    notes: event.notes || '',
    location: event.location || null,
    date: display.date || localStart?.date || null,
    startAt: event.startAt,
    endAt: event.endAt || null,
    display,
    reminders: event.reminders || { enabled: false, stages: [] },
    priority: event.priority || null,
    completedAt: event.completedAt || null,
    cancelledAt: event.cancelledAt || null,
    cancelNote: event.cancelNote || null,
    metadata: {
      source: event.metadata?.source || 'natural-language',
      sourceUpdatedAt: event.metadata?.updatedAt || null
    }
  };
}

function buildEventInstancesForRange(rangeStart, rangeEnd, options = {}) {
  const timezone = options.timezone || getDisplayTimezone();
  const events = readEvents().events || [];

  return sortByStartTime(
    events
      .filter(isEventIndexable)
      .map((event) => buildEventInstance(event, timezone))
      .filter((event) => event.date && event.date >= rangeStart && event.date <= rangeEnd)
  );
}

function buildRecurringInstancesForRange(rangeStart, rangeEnd) {
  const result = expandRecurringInRange(rangeStart, rangeEnd);
  if (!result.success) {
    return [];
  }

  return sortByStartTime(
    (result.instances || []).map((instance) => ({
      ...instance,
      sourceId: instance.recurringId,
      sourceType: 'recurring',
      source: 'recurring',
      type: 'recurring'
    }))
  );
}

function buildItemsForRange(rangeStart, rangeEnd, options = {}) {
  const timezone = options.timezone || getDisplayTimezone();
  const metadata = options.metadata || readMetadata();
  const coursesByDate = new Map();
  const spanDays = diffDateStrings(rangeStart, rangeEnd);
  if (spanDays === null || spanDays < 0) {
    return [];
  }

  for (let offset = 0; offset <= spanDays; offset += 1) {
    const date = addDaysToDateString(rangeStart, offset, timezone);
    coursesByDate.set(date, buildCourseInstancesForDate(date, { timezone, metadata }));
  }

  const events = buildEventInstancesForRange(rangeStart, rangeEnd, { timezone });
  const recurring = buildRecurringInstancesForRange(rangeStart, rangeEnd);
  const eventsByDate = new Map();

  for (let offset = 0; offset <= spanDays; offset += 1) {
    const date = addDaysToDateString(rangeStart, offset, timezone);
    eventsByDate.set(date, []);
  }

  for (const item of [...events, ...recurring]) {
    const date = item.display?.date || item.date;
    if (!eventsByDate.has(date)) {
      eventsByDate.set(date, []);
    }
    eventsByDate.get(date).push(item);
  }

  const days = [];
  for (let offset = 0; offset <= spanDays; offset += 1) {
    const date = addDaysToDateString(rangeStart, offset, timezone);
    const items = sortByStartTime([
      ...(coursesByDate.get(date) || []),
      ...(eventsByDate.get(date) || [])
    ]);

    const semesterStart = metadata.startDate || null;
    const weekNumber = computeWeekNumberFromStart(semesterStart, date);

    days.push({
      date,
      weekday: getWeekdayFromDateString(date, timezone),
      weekNumber,
      events: items,
      summary: buildSummary(items)
    });
  }

  return days;
}

function buildTodayIndex(options = {}) {
  const timezone = options.timezone || getDisplayTimezone();
  const metadata = options.metadata || readMetadata();
  const today = options.today || getDateString(new Date(), timezone);
  const day = buildItemsForRange(today, today, { timezone, metadata })[0] || {
    date: today,
    events: [],
    summary: buildSummary([])
  };

  return {
    generatedAt: new Date().toISOString(),
    date: today,
    currentWeek: metadata.startDate ? Math.max(getCurrentWeek(metadata.startDate) || 1, 1) : metadata.currentWeek || 1,
    events: day.events,
    summary: day.summary
  };
}

function buildThisWeekIndex(options = {}) {
  const timezone = options.timezone || getDisplayTimezone();
  const metadata = options.metadata || readMetadata();
  const today = options.today || getDateString(new Date(), timezone);
  const weekStart = getWeekStartDate(today, timezone);
  const weekEnd = getWeekEndDate(today, timezone);
  const days = buildItemsForRange(weekStart, weekEnd, { timezone, metadata });
  const allItems = days.flatMap((day) => day.events);

  return {
    generatedAt: new Date().toISOString(),
    range: {
      start: weekStart,
      end: weekEnd
    },
    currentWeek: metadata.startDate ? Math.max(getCurrentWeek(metadata.startDate) || 1, 1) : metadata.currentWeek || 1,
    days,
    summary: buildSummary(allItems)
  };
}

function buildUpcomingIndex(days = 7, options = {}) {
  const timezone = options.timezone || getDisplayTimezone();
  const metadata = options.metadata || readMetadata();
  const today = options.today || getDateString(new Date(), timezone);
  const rangeEnd = addDaysToDateString(today, Math.max(0, days - 1), timezone);
  const dayItems = buildItemsForRange(today, rangeEnd, { timezone, metadata });
  const allItems = dayItems.flatMap((day) => day.events);

  return {
    generatedAt: new Date().toISOString(),
    range: {
      start: today,
      end: rangeEnd
    },
    currentWeek: metadata.startDate ? Math.max(getCurrentWeek(metadata.startDate) || 1, 1) : metadata.currentWeek || 1,
    events: dayItems.map((day) => ({
      date: day.date,
      weekday: day.weekday,
      weekNumber: day.weekNumber,
      events: day.events,
      summary: day.summary
    })),
    summary: buildSummary(allItems),
    reminders: []
  };
}

function updateMetadataSnapshot() {
  const metadata = readMetadata();
  const courses = readCourses().courses || [];
  const events = readEvents().events || [];
  const recurring = readRecurring().recurring || [];

  const nextMetadata = {
    ...metadata,
    currentWeek: metadata.startDate ? Math.max(getCurrentWeek(metadata.startDate) || 1, 1) : metadata.currentWeek || 1,
    stats: {
      ...(metadata.stats || {}),
      totalCourses: courses.length,
      totalEvents: events.length,
      totalRecurring: recurring.length,
    },
    updatedAt: new Date().toISOString()
  };

  writeMetadata(nextMetadata);
  return nextMetadata;
}

function main(options = {}) {
  const metadata = updateMetadataSnapshot();
  const timezone = options.timezone || getDisplayTimezone();
  const today = options.today || getDateString(new Date(), timezone);
  const todayIndex = buildTodayIndex({ timezone, metadata, today });
  const thisWeekIndex = buildThisWeekIndex({ timezone, metadata, today });
  const upcomingIndex = buildUpcomingIndex(options.days || 7, { timezone, metadata, today });

  writeTodayIndex(todayIndex);
  writeThisWeekIndex(thisWeekIndex);
  writeUpcomingIndex(upcomingIndex);

  return {
    success: true,
    todayIndex,
    thisWeekIndex,
    upcomingIndex
  };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Rebuild index failed:', error.message);
    process.exit(1);
  }
}

module.exports = {
  buildCourseInstancesForDate,
  buildEventInstancesForRange,
  buildRecurringInstancesForRange,
  buildItemsForRange,
  buildTodayIndex,
  buildThisWeekIndex,
  buildUpcomingIndex,
  updateMetadataSnapshot,
  main
};
