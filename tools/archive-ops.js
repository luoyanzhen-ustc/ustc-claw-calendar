#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_TIMEZONE,
  readCourses,
  readEvents,
  readRecurring,
  readMetadata,
  getArchiveDir,
  getActiveDir,
  toLocal
} = require('./file-ops.js');
const { buildItemsForRange } = require('./rebuild-index.js');

function groupBy(items, key) {
  return (items || []).reduce((accumulator, item) => {
    const value = item[key] || 'unknown';
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
}

function getWeekRange(weekNumber, metadata) {
  return metadata.weekMapping?.[`week${weekNumber}`] || null;
}

function getEventLocalDate(event, timezone = DEFAULT_TIMEZONE) {
  if (event.display?.date) {
    return event.display.date;
  }

  const local = event.startAt ? toLocal(event.startAt, timezone) : null;
  return local?.date || null;
}

function buildWeeklyStats(days) {
  const items = days.flatMap((day) => day.events || []);
  const byStateLabel = items.reduce((accumulator, item) => {
    const label = item.state?.label || 'unknown';
    accumulator[label] = (accumulator[label] || 0) + 1;
    return accumulator;
  }, {});

  return {
    totalItems: items.length,
    totalDays: days.length,
    byType: groupBy(items, 'type'),
    bySource: groupBy(items, 'sourceType'),
    byPriority: groupBy(items, 'priority'),
    byStateLabel,
    withReminders: items.filter((item) => item.reminders?.enabled).length,
    completed: items.filter((item) => Boolean(item.completedAt)).length,
    cancelled: items.filter((item) => Boolean(item.cancelledAt)).length,
    pastUncompleted: items.filter((item) => item.state?.label === '已过时间，未标记完成').length
  };
}

function extractHighlights(days) {
  const items = days.flatMap((day) => day.events || []);
  const completed = items
    .filter((item) => Boolean(item.completedAt))
    .slice(0, 5)
    .map((item) => `Completed: ${item.title}`);

  const highPriority = items
    .filter((item) => item.priority === 'high')
    .slice(0, 5)
    .map((item) => `High priority: ${item.title}`);

  const withReminders = items
    .filter((item) => item.reminders?.enabled)
    .slice(0, 5)
    .map((item) => `Reminder attached: ${item.title}`);

  const pastUncompleted = items
    .filter((item) => item.state?.label === '已过时间，未标记完成')
    .slice(0, 5)
    .map((item) => `Past and still open: ${item.title}`);

  return [...completed, ...highPriority, ...withReminders, ...pastUncompleted].slice(0, 8);
}

function buildWeeklySourceSnapshot(weekRange, metadata) {
  const timezone = metadata.displayTimezone || DEFAULT_TIMEZONE;
  const courses = readCourses().courses || [];
  const events = (readEvents().events || []).filter((event) => {
    const date = getEventLocalDate(event, timezone);
    return date && date >= weekRange.start && date <= weekRange.end;
  });
  const recurring = readRecurring().recurring || [];
  const days = buildItemsForRange(weekRange.start, weekRange.end, {
    timezone,
    metadata
  });

  return {
    weekRange,
    sourceCounts: {
      courses: courses.length,
      events: events.length,
      recurringRules: recurring.length
    },
    active: {
      courses,
      events,
      recurring
    },
    expanded: {
      days,
      totalItems: days.flatMap((day) => day.events || []).length
    }
  };
}

function generateWeeklyReport(weekNumber) {
  const metadata = readMetadata();
  const weekRange = getWeekRange(weekNumber, metadata);
  if (!weekRange) {
    return null;
  }

  const timezone = metadata.displayTimezone || DEFAULT_TIMEZONE;
  const days = buildItemsForRange(weekRange.start, weekRange.end, {
    timezone,
    metadata
  });
  const stats = buildWeeklyStats(days);

  return {
    week: weekNumber,
    period: `${weekRange.start} ~ ${weekRange.end}`,
    range: weekRange,
    semester: metadata.semester,
    stats,
    days,
    highlights: extractHighlights(days),
    generatedAt: new Date().toISOString()
  };
}

function archiveWeekSnapshot(weekNumber) {
  const metadata = readMetadata();
  const weekRange = getWeekRange(weekNumber, metadata);
  if (!weekRange) {
    return { success: false, error: 'Week range not found.' };
  }

  const archiveDir = path.join(getArchiveDir(metadata.semester), 'raw');
  fs.mkdirSync(archiveDir, { recursive: true });

  const snapshot = {
    week: weekNumber,
    semester: metadata.semester,
    archivedAt: new Date().toISOString(),
    ...buildWeeklySourceSnapshot(weekRange, metadata)
  };

  const filePath = path.join(archiveDir, `week-${weekNumber}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');

  return {
    success: true,
    filePath,
    snapshot
  };
}

function archiveLastWeekSnapshot() {
  const metadata = readMetadata();
  const lastWeek = (metadata.currentWeek || 1) - 1;
  if (lastWeek < 1) {
    return { success: true, skipped: true, reason: 'no-previous-week' };
  }

  return archiveWeekSnapshot(lastWeek);
}

function archiveSemester(semesterName = null) {
  const metadata = readMetadata();
  const semester = semesterName || metadata.semester;
  const archiveDir = getArchiveDir(semester);
  fs.mkdirSync(archiveDir, { recursive: true });

  for (const fileName of ['courses.json', 'events.json', 'recurring.json']) {
    const source = path.join(getActiveDir(), fileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(archiveDir, fileName));
    }
  }

  return generateSemesterSummary(semester);
}

function generateSemesterSummary(semester) {
  const archiveDir = getArchiveDir(semester);
  const readArrayFromFile = (fileName, key) => {
    const filePath = path.join(archiveDir, fileName);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed[key]) ? parsed[key] : [];
  };

  const courses = readArrayFromFile('courses.json', 'courses');
  const events = readArrayFromFile('events.json', 'events');
  const recurring = readArrayFromFile('recurring.json', 'recurring');

  const summary = {
    semester,
    totalCourses: courses.length,
    totalEvents: events.length,
    totalRecurring: recurring.length,
    completedEvents: events.filter((event) => Boolean(event.completedAt)).length,
    cancelledEvents: events.filter((event) => Boolean(event.cancelledAt)).length,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(archiveDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}

module.exports = {
  generateWeeklyReport,
  archiveWeekSnapshot,
  archiveLastWeekSnapshot,
  archiveSemester,
  generateSemesterSummary
};
