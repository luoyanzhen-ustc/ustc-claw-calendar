#!/usr/bin/env node

const { DEFAULT_TIMEZONE, readEvents, toLocal } = require('./file-ops.js');
const { buildCourseInstancesForDate } = require('./rebuild-index.js');
const { expandRecurringForDate } = require('./recurring-manager.js');

function getDisplayDate(eventLike, timezone = DEFAULT_TIMEZONE) {
  if (eventLike?.display?.date) {
    return eventLike.display.date;
  }

  if (!eventLike?.startAt) {
    return null;
  }

  return toLocal(eventLike.startAt, timezone)?.date || null;
}

function getTimeRange(item) {
  if (!item?.startAt) {
    return null;
  }

  const startMs = new Date(item.startAt).getTime();
  const endMs = item.endAt ? new Date(item.endAt).getTime() : startMs;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return null;
  }

  return {
    startMs,
    endMs: Math.max(startMs, endMs)
  };
}

function overlaps(left, right) {
  return left.startMs <= right.endMs && right.startMs <= left.endMs;
}

function buildConflictWarning(item) {
  return {
    reason: 'time-overlap',
    sourceType: item.sourceType || item.type || 'unknown',
    sourceId: item.sourceId || item.recurringId || item.id || null,
    title: item.title || item.name || 'Untitled event',
    date: item.display?.date || item.date || null,
    startTime: item.display?.startTime || null,
    endTime: item.display?.endTime || null
  };
}

function listEventCandidates(date, timezone, options = {}) {
  const excludeEventId = options.excludeEventId || null;

  return (readEvents().events || [])
    .filter((item) => item?.startAt)
    .filter((item) => !item.cancelledAt)
    .filter((item) => !item.completedAt)
    .filter((item) => item.id !== excludeEventId)
    .map((item) => ({
      ...item,
      sourceType: 'event',
      sourceId: item.id,
      date: getDisplayDate(item, timezone)
    }))
    .filter((item) => item.date === date);
}

function listRecurringCandidates(date) {
  const expanded = expandRecurringForDate(date);
  if (!expanded.success) {
    return [];
  }

  return (expanded.instances || []).map((item) => ({
    ...item,
    sourceType: 'recurring',
    sourceId: item.recurringId || item.id
  }));
}

function detectEventConflicts(event, options = {}) {
  const timezone = event?.display?.timezone || DEFAULT_TIMEZONE;
  const date = getDisplayDate(event, timezone);
  const targetRange = getTimeRange(event);

  if (!date || !targetRange) {
    return [];
  }

  const candidates = [
    ...buildCourseInstancesForDate(date, { timezone }),
    ...listRecurringCandidates(date),
    ...listEventCandidates(date, timezone, options)
  ];

  return candidates
    .filter((item) => {
      const range = getTimeRange(item);
      return range && overlaps(targetRange, range);
    })
    .map(buildConflictWarning);
}

module.exports = {
  detectEventConflicts
};
