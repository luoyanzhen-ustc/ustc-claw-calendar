#!/usr/bin/env node

const {
  DEFAULT_TIMEZONE,
  generateRecurringId,
  generateStageId,
  readSettings,
  readRecurring,
  getRecurringById,
  saveRecurringItem,
  deleteRecurringById,
  toUTC,
  toLocal
} = require('./file-ops.js');
const {
  addDaysToDateString,
  diffDateStrings,
  getWeekdayFromDateString,
  normalizeWeekdayList
} = require('./date-math.js');
const { normalizeReminders: normalizeSharedReminders } = require('./reminder-utils.js');
const { syncReminderCronsForSource, buildAdHocReminderStage } = require('./cron-manager.js');

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function resolveTextField(input, key, currentValue, options = {}) {
  const { emptyValue = null } = options;
  if (!hasOwn(input, key)) {
    return currentValue;
  }

  const cleaned = cleanText(input[key]);
  return cleaned === null ? emptyValue : cleaned;
}

function normalizePriority(priority) {
  const cleaned = cleanText(priority);
  if (!cleaned) {
    return null;
  }

  const normalized = cleaned.toLowerCase();
  return ['high', 'medium', 'low'].includes(normalized) ? normalized : null;
}

function normalizeReminders(reminders = {}) {
  return normalizeSharedReminders(reminders, generateStageId);
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

function normalizeDateString(value, fallback = null) {
  const cleaned = cleanText(value);
  return cleaned && isValidDateString(cleaned) ? cleaned : fallback;
}

function parseTimeToMinutes(timeStr) {
  const match = String(timeStr || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return (hours * 60) + minutes;
}

function normalizeTimeString(value, fallback = null) {
  const cleaned = cleanText(value);
  return parseTimeToMinutes(cleaned) === null ? fallback : cleaned.padStart(5, '0');
}

function normalizeWeekdays(input) {
  return normalizeWeekdayList(input);
}

function normalizeExceptions(exceptions = []) {
  if (!Array.isArray(exceptions)) {
    return [];
  }

  return exceptions
    .map((item) => {
      if (typeof item === 'string') {
        const date = normalizeDateString(item);
        return date ? { date, action: 'skip', note: null } : null;
      }

      const date = normalizeDateString(item?.date);
      if (!date) {
        return null;
      }

      return {
        date,
        action: item.action === 'skip' ? 'skip' : 'skip',
        note: cleanText(item.note)
      };
    })
    .filter(Boolean);
}

function normalizeDisplayForInstance(date, startTime, endTime, timezone) {
  const startAt = startTime ? toUTC(date, startTime, timezone) : null;
  const endAt = endTime ? toUTC(date, endTime, timezone) : null;
  const localStart = startAt ? toLocal(startAt, timezone) : null;
  const localEnd = endAt ? toLocal(endAt, timezone) : null;

  return {
    startAt,
    endAt,
    display: {
      date: localStart?.date || date,
      startTime: localStart?.time || startTime || null,
      endTime: localEnd?.time || endTime || null,
      timezone
    }
  };
}

function normalizeRule(input = {}, currentRule = {}) {
  const settings = readSettings();
  return {
    freq: (
      cleanText(hasOwn(input, 'freq') ? input.freq : currentRule.freq || 'WEEKLY') || 'WEEKLY'
    ).toUpperCase(),
    byWeekday: normalizeWeekdays(hasOwn(input, 'byWeekday') ? input.byWeekday : currentRule.byWeekday),
    startTime: hasOwn(input, 'startTime')
      ? normalizeTimeString(input.startTime, null)
      : normalizeTimeString(currentRule.startTime, null),
    endTime: hasOwn(input, 'endTime')
      ? normalizeTimeString(input.endTime, null)
      : normalizeTimeString(currentRule.endTime, null),
    timezone:
      cleanText(hasOwn(input, 'timezone') ? input.timezone : currentRule.timezone) ||
      cleanText(currentRule.timezone) ||
      settings.displayTimezone ||
      settings.timezone ||
      DEFAULT_TIMEZONE
  };
}

function normalizeRange(input = {}, currentRange = {}) {
  return {
    startDate: hasOwn(input, 'startDate')
      ? normalizeDateString(input.startDate, null)
      : normalizeDateString(currentRange.startDate, null),
    endDate: hasOwn(input, 'endDate')
      ? normalizeDateString(input.endDate, null)
      : normalizeDateString(currentRange.endDate, null)
  };
}

function buildRecurringPayload(input = {}, currentRecurring = null) {
  const now = new Date().toISOString();
  const rule = normalizeRule(input.rule || {}, currentRecurring?.rule || {});
  const range = normalizeRange(input.range || {}, currentRecurring?.range || {});

  return {
    id: currentRecurring?.id || input.id || generateRecurringId(),
    type: 'recurring',
    title: cleanText(input.title) || currentRecurring?.title || null,
    summary: resolveTextField(input, 'summary', currentRecurring?.summary || null),
    notes: resolveTextField(input, 'notes', currentRecurring?.notes || '', { emptyValue: '' }),
    rule,
    range,
    reminders: normalizeReminders(
      input.reminders !== undefined ? input.reminders : currentRecurring?.reminders || {}
    ),
    exceptions:
      input.exceptions !== undefined
        ? normalizeExceptions(input.exceptions)
        : normalizeExceptions(currentRecurring?.exceptions || []),
    completedAt:
      input.completedAt !== undefined ? input.completedAt : currentRecurring?.completedAt || null,
    cancelledAt:
      input.cancelledAt !== undefined ? input.cancelledAt : currentRecurring?.cancelledAt || null,
    cancelNote: resolveTextField(input, 'cancelNote', currentRecurring?.cancelNote || null),
    priority:
      input.priority !== undefined ? normalizePriority(input.priority) : normalizePriority(currentRecurring?.priority),
    metadata: {
      ...(currentRecurring?.metadata || {}),
      source: input.metadata?.source || currentRecurring?.metadata?.source || 'natural-language',
      createdAt: currentRecurring?.metadata?.createdAt || now,
      updatedAt: now
    }
  };
}

function validateRecurringPayload(recurringItem) {
  if (!recurringItem.title) {
    return { success: false, error: 'Recurring title is required.' };
  }

  if (recurringItem.rule.freq !== 'WEEKLY') {
    return { success: false, error: 'Only WEEKLY recurring rules are supported in Stage D.' };
  }

  if (!Array.isArray(recurringItem.rule.byWeekday) || recurringItem.rule.byWeekday.length === 0) {
    return { success: false, error: 'Recurring weekdays are required.' };
  }

  if (!recurringItem.rule.startTime || parseTimeToMinutes(recurringItem.rule.startTime) === null) {
    return { success: false, error: 'Recurring start time is required.' };
  }

  if (recurringItem.rule.endTime) {
    const startMinutes = parseTimeToMinutes(recurringItem.rule.startTime);
    const endMinutes = parseTimeToMinutes(recurringItem.rule.endTime);
    if (endMinutes === null) {
      return { success: false, error: 'Recurring end time is invalid.' };
    }

    if (endMinutes < startMinutes) {
      return { success: false, error: 'Recurring end time cannot be earlier than start time.' };
    }
  }

  if (!recurringItem.range.startDate) {
    return { success: false, error: 'Recurring start date is required.' };
  }

  if (recurringItem.range.endDate && recurringItem.range.endDate < recurringItem.range.startDate) {
    return { success: false, error: 'Recurring end date cannot be earlier than start date.' };
  }

  return { success: true };
}

function isRecurringActive(recurringItem) {
  return !recurringItem?.cancelledAt;
}

function createRecurring(input = {}) {
  const recurringItem = buildRecurringPayload(input);
  const validation = validateRecurringPayload(recurringItem);
  if (!validation.success) {
    return validation;
  }

  saveRecurringItem(recurringItem);
  return {
    success: true,
    recurring: recurringItem
  };
}

function updateRecurring(recurringId, updates = {}) {
  const currentRecurring = getRecurringById(recurringId);
  if (!currentRecurring) {
    return { success: false, error: 'Recurring event not found.' };
  }

  const recurringItem = buildRecurringPayload(updates, currentRecurring);
  const validation = validateRecurringPayload(recurringItem);
  if (!validation.success) {
    return validation;
  }

  saveRecurringItem(recurringItem);
  return {
    success: true,
    recurring: recurringItem
  };
}

function setRecurringReminders(recurringId, reminders = {}) {
  const currentRecurring = getRecurringById(recurringId);
  if (!currentRecurring) {
    return { success: false, error: 'Recurring event not found.' };
  }

  const nextRecurring = {
    ...currentRecurring,
    reminders: normalizeReminders(reminders),
    metadata: {
      ...(currentRecurring.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };

  saveRecurringItem(nextRecurring);
  return {
    success: true,
    recurring: nextRecurring
  };
}

function applyRecurringReminders(recurringId, reminders = {}, options = {}) {
  const currentRecurring = getRecurringById(recurringId);
  if (!currentRecurring) {
    return { success: false, error: 'Recurring event not found.' };
  }

  const nextRecurring = {
    ...currentRecurring,
    reminders: normalizeReminders(reminders),
    metadata: {
      ...(currentRecurring.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };

  const syncResult = syncReminderCronsForSource({
    sourceType: 'recurring',
    sourceId: recurringId,
    sourceObject: nextRecurring,
    reminders: nextRecurring.reminders,
    options,
    dependencies: options.dependencies || {}
  });

  nextRecurring.reminders = syncResult.reminders;
  saveRecurringItem(nextRecurring);

  return {
    ...syncResult,
    recurring: nextRecurring
  };
}

function addRecurringReminderStage(recurringId, stage = {}, options = {}) {
  const currentRecurring = getRecurringById(recurringId);
  if (!currentRecurring) {
    return { success: false, error: 'Recurring event not found.' };
  }

  return applyRecurringReminders(
    recurringId,
    buildAdHocReminderStage(currentRecurring.reminders || {}, stage),
    options
  );
}

function deleteRecurring(recurringId) {
  const currentRecurring = getRecurringById(recurringId);
  if (!currentRecurring) {
    return { success: false, error: 'Recurring event not found.' };
  }

  const deleted = deleteRecurringById(recurringId);
  return {
    success: deleted,
    recurring: currentRecurring
  };
}

function getRecurring(recurringId) {
  return getRecurringById(recurringId);
}

function listRecurring(options = {}) {
  const { activeOnly = false } = options;
  const recurringItems = readRecurring().recurring;
  return activeOnly ? recurringItems.filter(isRecurringActive) : recurringItems;
}

function shouldSkipByException(recurringItem, date) {
  return (recurringItem.exceptions || []).some((exception) => exception.date === date && exception.action === 'skip');
}

function buildRecurringInstance(recurringItem, date) {
  const timing = normalizeDisplayForInstance(
    date,
    recurringItem.rule.startTime,
    recurringItem.rule.endTime,
    recurringItem.rule.timezone || DEFAULT_TIMEZONE
  );

  return {
    id: `${recurringItem.id}:${date}:${recurringItem.rule.startTime}`,
    recurringId: recurringItem.id,
    type: 'recurring-instance',
    source: 'recurring',
    title: recurringItem.title,
    summary: recurringItem.summary || null,
    notes: recurringItem.notes || '',
    date,
    startAt: timing.startAt,
    endAt: timing.endAt,
    display: timing.display,
    reminders: normalizeReminders(recurringItem.reminders || { enabled: false, stages: [] }),
    priority: recurringItem.priority || null,
    metadata: {
      sourceRecurringId: recurringItem.id,
      sourceUpdatedAt: recurringItem.metadata?.updatedAt || null
    }
  };
}

function expandOneRecurringInRange(recurringItem, rangeStart, rangeEnd) {
  if (!isRecurringActive(recurringItem)) {
    return [];
  }

  const timezone = recurringItem.rule.timezone || DEFAULT_TIMEZONE;
  const effectiveStart = recurringItem.range.startDate > rangeStart ? recurringItem.range.startDate : rangeStart;
  const effectiveEnd =
    recurringItem.range.endDate && recurringItem.range.endDate < rangeEnd ? recurringItem.range.endDate : rangeEnd;

  if (!effectiveStart || !effectiveEnd || effectiveEnd < effectiveStart) {
    return [];
  }

  const spanDays = diffDateStrings(effectiveStart, effectiveEnd);
  if (spanDays === null || spanDays < 0) {
    return [];
  }

  const instances = [];
  for (let offset = 0; offset <= spanDays; offset += 1) {
    const date = addDaysToDateString(effectiveStart, offset, timezone);
    if (!date) {
      continue;
    }

    const weekday = getWeekdayFromDateString(date, timezone);
    if (!recurringItem.rule.byWeekday.includes(weekday)) {
      continue;
    }

    if (shouldSkipByException(recurringItem, date)) {
      continue;
    }

    instances.push(buildRecurringInstance(recurringItem, date));
  }

  return instances;
}

function expandRecurringInRange(rangeStart, rangeEnd, options = {}) {
  const normalizedStart = normalizeDateString(rangeStart);
  const normalizedEnd = normalizeDateString(rangeEnd);
  if (!normalizedStart || !normalizedEnd) {
    return { success: false, error: 'A valid date range is required.' };
  }

  if (normalizedEnd < normalizedStart) {
    return { success: false, error: 'Range end date cannot be earlier than range start date.' };
  }

  const sourceItems = options.recurringId
    ? [getRecurringById(options.recurringId)].filter(Boolean)
    : listRecurring({ activeOnly: true });

  const instances = sourceItems.flatMap((item) => expandOneRecurringInRange(item, normalizedStart, normalizedEnd));

  return {
    success: true,
    range: {
      startDate: normalizedStart,
      endDate: normalizedEnd
    },
    recurringCount: sourceItems.length,
    instances
  };
}

function expandRecurringForDate(date) {
  return expandRecurringInRange(date, date);
}

function expandRecurringForWeek(weekStartDate) {
  const normalizedStart = normalizeDateString(weekStartDate);
  if (!normalizedStart) {
    return { success: false, error: 'A valid week start date is required.' };
  }

  const weekEndDate = addDaysToDateString(normalizedStart, 6);
  return expandRecurringInRange(normalizedStart, weekEndDate);
}

module.exports = {
  normalizePriority,
  normalizeReminders,
  normalizeWeekdays,
  normalizeExceptions,
  buildRecurringPayload,
  validateRecurringPayload,
  createRecurring,
  updateRecurring,
  setRecurringReminders,
  applyRecurringReminders,
  addRecurringReminderStage,
  deleteRecurring,
  getRecurring,
  listRecurring,
  expandRecurringInRange,
  expandRecurringForDate,
  expandRecurringForWeek
};
