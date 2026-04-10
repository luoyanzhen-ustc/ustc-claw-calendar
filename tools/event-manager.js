#!/usr/bin/env node

const {
  generateEventId,
  generateStageId,
  readSettings,
  readEvents,
  getEventById,
  saveEvent,
  deleteEventById,
  toUTC,
  toLocal
} = require('./file-ops.js');
const { detectEventConflicts } = require('./conflict-detector.js');
const { normalizeReminders: normalizeSharedReminders } = require('./reminder-utils.js');
const { syncReminderCronsForSource, buildAdHocReminderStage, clearReminderCrons } = require('./cron-manager.js');

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

function normalizeDisplayFromUtc(startAt, endAt, timezone) {
  const localStart = startAt ? toLocal(startAt, timezone) : null;
  const localEnd = endAt ? toLocal(endAt, timezone) : null;

  return {
    date: localStart?.date || null,
    startTime: localStart?.time || null,
    endTime: localEnd?.time || null,
    timezone
  };
}

function normalizeDisplayInput(input = {}) {
  const settings = readSettings();
  const display = input.display || {};
  const schedule = input.schedule || {};
  const timezone =
    display.timezone ||
    schedule.displayTimezone ||
    schedule.timezone ||
    input.timezone ||
    settings.displayTimezone ||
    settings.timezone ||
    'Asia/Shanghai';

  const date = display.date || schedule.displayDate || schedule.date || input.date || null;
  const startTime = display.startTime || schedule.displayTime || schedule.startTime || input.startTime || null;
  const endTime = display.endTime || schedule.endTime || input.endTime || null;

  return {
    date,
    startTime,
    endTime,
    timezone
  };
}

function normalizeEventTiming(input = {}) {
  const explicitStartAt = cleanText(input.startAt);
  const explicitEndAt = cleanText(input.endAt);
  const display = normalizeDisplayInput(input);

  const startAt = explicitStartAt || (display.date && display.startTime ? toUTC(display.date, display.startTime, display.timezone) : null);
  const endAt = explicitEndAt || (display.date && display.endTime ? toUTC(display.date, display.endTime, display.timezone) : null);

  const normalizedDisplay =
    startAt || endAt
      ? normalizeDisplayFromUtc(startAt, endAt, display.timezone)
      : {
          date: display.date,
          startTime: display.startTime,
          endTime: display.endTime,
          timezone: display.timezone
        };

  return {
    startAt,
    endAt,
    display: normalizedDisplay
  };
}

function buildEventPayload(input = {}, currentEvent = null) {
  const now = new Date().toISOString();
  const timing = normalizeEventTiming({
    ...(currentEvent || {}),
    ...input,
    display: {
      ...((currentEvent && currentEvent.display) || {}),
      ...((input && input.display) || {})
    },
    schedule: {
      ...((currentEvent && currentEvent.schedule) || {}),
      ...((input && input.schedule) || {})
    }
  });

  let reminders = normalizeReminders(
    input.reminders !== undefined ? input.reminders : (currentEvent && currentEvent.reminders) || {}
  );
  let completedAt =
    input.completedAt !== undefined ? input.completedAt : (currentEvent && currentEvent.completedAt) || null;
  let cancelledAt =
    input.cancelledAt !== undefined ? input.cancelledAt : (currentEvent && currentEvent.cancelledAt) || null;
  let cancelNote = resolveTextField(input, 'cancelNote', (currentEvent && currentEvent.cancelNote) || null);

  if (completedAt) {
    cancelledAt = null;
    cancelNote = null;
  } else if (cancelledAt) {
    completedAt = null;
  }

  if (completedAt || cancelledAt) {
    reminders = {
      ...reminders,
      enabled: false
    };
  }

  return {
    id: (currentEvent && currentEvent.id) || input.id || generateEventId(),
    type: 'event',
    title: cleanText(input.title) || (currentEvent && currentEvent.title) || null,
    summary: resolveTextField(input, 'summary', (currentEvent && currentEvent.summary) || null),
    notes: resolveTextField(input, 'notes', (currentEvent && currentEvent.notes) || '', { emptyValue: '' }),
    startAt: timing.startAt || null,
    endAt: timing.endAt || null,
    display: timing.display,
    reminders,
    completedAt,
    cancelledAt,
    cancelNote,
    priority:
      input.priority !== undefined ? normalizePriority(input.priority) : normalizePriority(currentEvent && currentEvent.priority),
    metadata: {
      ...((currentEvent && currentEvent.metadata) || {}),
      source: input.metadata?.source || currentEvent?.metadata?.source || 'natural-language',
      createdAt: currentEvent?.metadata?.createdAt || now,
      updatedAt: now
    }
  };
}

function clearEventReminderRuntime(currentEvent, options = {}) {
  const cleared = clearReminderCrons(currentEvent.reminders || {}, options.dependencies || {});
  return {
    cleanup: cleared,
    reminders: {
      ...cleared.reminders,
      enabled: false
    }
  };
}

function validateEventPayload(event) {
  if (!event.title) {
    return { success: false, error: 'Event title is required.' };
  }

  if (!event.startAt) {
    return { success: false, error: 'Event start time is required.' };
  }

  const start = new Date(event.startAt);
  if (Number.isNaN(start.getTime())) {
    return { success: false, error: 'Event start time is invalid.' };
  }

  if (event.endAt) {
    const end = new Date(event.endAt);
    if (Number.isNaN(end.getTime())) {
      return { success: false, error: 'Event end time is invalid.' };
    }

    if (end.getTime() < start.getTime()) {
      return { success: false, error: 'Event end time cannot be earlier than start time.' };
    }
  }

  return { success: true };
}

function createEvent(input = {}) {
  const event = buildEventPayload(input);
  const validation = validateEventPayload(event);
  if (!validation.success) {
    return validation;
  }

  const warnings = detectEventConflicts(event);
  saveEvent(event);
  return {
    success: true,
    event,
    warnings
  };
}

function updateEvent(eventId, updates = {}) {
  const currentEvent = getEventById(eventId);
  if (!currentEvent) {
    return { success: false, error: 'Event not found.' };
  }

  const event = buildEventPayload(updates, currentEvent);
  const validation = validateEventPayload(event);
  if (!validation.success) {
    return validation;
  }

  const warnings = detectEventConflicts(event, { excludeEventId: eventId });
  saveEvent(event);
  return {
    success: true,
    event,
    warnings
  };
}

function setEventReminders(eventId, reminders = {}) {
  const currentEvent = getEventById(eventId);
  if (!currentEvent) {
    return { success: false, error: 'Event not found.' };
  }

  const nextEvent = {
    ...currentEvent,
    reminders: normalizeReminders(reminders),
    metadata: {
      ...(currentEvent.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };

  saveEvent(nextEvent);
  return {
    success: true,
    event: nextEvent
  };
}

function applyEventReminders(eventId, reminders = {}, options = {}) {
  const currentEvent = getEventById(eventId);
  if (!currentEvent) {
    return { success: false, error: 'Event not found.' };
  }

  const nextEvent = {
    ...currentEvent,
    reminders: normalizeReminders(reminders),
    metadata: {
      ...(currentEvent.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };

  const syncResult = syncReminderCronsForSource({
    sourceType: 'event',
    sourceId: eventId,
    sourceObject: nextEvent,
    reminders: nextEvent.reminders,
    options,
    dependencies: options.dependencies || {}
  });

  nextEvent.reminders = syncResult.reminders;
  saveEvent(nextEvent);

  return {
    ...syncResult,
    event: nextEvent
  };
}

function addEventReminderStage(eventId, stage = {}, options = {}) {
  const currentEvent = getEventById(eventId);
  if (!currentEvent) {
    return { success: false, error: 'Event not found.' };
  }

  return applyEventReminders(
    eventId,
    buildAdHocReminderStage(currentEvent.reminders || {}, stage),
    options
  );
}

function completeEvent(eventId, completedAt = null, options = {}) {
  const currentEvent = getEventById(eventId);
  if (!currentEvent) {
    return { success: false, error: 'Event not found.' };
  }

  const cleared = clearEventReminderRuntime(currentEvent, options);

  const nextEvent = {
    ...currentEvent,
    reminders: cleared.reminders,
    completedAt: completedAt || new Date().toISOString(),
    cancelledAt: null,
    cancelNote: null,
    metadata: {
      ...(currentEvent.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };

  saveEvent(nextEvent);
  return {
    success: true,
    partialSuccess: cleared.cleanup.failures.length > 0,
    event: nextEvent,
    deletedCrons: cleared.cleanup.deletedCount,
    deletedCronIds: cleared.cleanup.deletedCronIds,
    failures: cleared.cleanup.failures,
    warning:
      cleared.cleanup.failures.length > 0
        ? 'Event was marked completed, but some reminder cron jobs failed to delete.'
        : null
  };
}

function cancelEvent(eventId, cancelNote = null, cancelledAt = null, options = {}) {
  const currentEvent = getEventById(eventId);
  if (!currentEvent) {
    return { success: false, error: 'Event not found.' };
  }

  const cleared = clearEventReminderRuntime(currentEvent, options);

  const nextEvent = {
    ...currentEvent,
    reminders: cleared.reminders,
    completedAt: null,
    cancelledAt: cancelledAt || new Date().toISOString(),
    cancelNote: cleanText(cancelNote),
    metadata: {
      ...(currentEvent.metadata || {}),
      updatedAt: new Date().toISOString()
    }
  };

  saveEvent(nextEvent);
  return {
    success: true,
    partialSuccess: cleared.cleanup.failures.length > 0,
    event: nextEvent,
    deletedCrons: cleared.cleanup.deletedCount,
    deletedCronIds: cleared.cleanup.deletedCronIds,
    failures: cleared.cleanup.failures,
    warning:
      cleared.cleanup.failures.length > 0
        ? 'Event was marked cancelled, but some reminder cron jobs failed to delete.'
        : null
  };
}

function deleteEvent(eventId) {
  const currentEvent = getEventById(eventId);
  if (!currentEvent) {
    return { success: false, error: 'Event not found.' };
  }

  const deleted = deleteEventById(eventId);
  return {
    success: deleted,
    event: currentEvent
  };
}

function getEvent(eventId) {
  return getEventById(eventId);
}

function listEvents() {
  return readEvents().events;
}

module.exports = {
  normalizePriority,
  normalizeReminders,
  normalizeEventTiming,
  createEvent,
  updateEvent,
  setEventReminders,
  applyEventReminders,
  addEventReminderStage,
  completeEvent,
  cancelEvent,
  deleteEvent,
  getEvent,
  listEvents
};
