#!/usr/bin/env node

const {
  generateEventId,
  generateStageId,
  savePlan,
  getPlanById,
  deletePlanById,
  readSettings,
  readPlans,
  toUTC
} = require('./file-ops.js');
const { createReminderCron, updateReminderCrons, deleteReminderCrons } = require('./cron-manager.js');

function parseTime(timeStr) {
  const match = String(timeStr || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

function normalizeSchedule(schedule = {}) {
  const settings = readSettings();
  const displayTimezone = schedule.displayTimezone || settings.displayTimezone || settings.timezone || 'Asia/Shanghai';
  const date = schedule.displayDate || schedule.date || null;
  const startTime = schedule.displayTime || schedule.startTime || null;
  const endTime = schedule.endTime || null;

  return {
    ...schedule,
    date,
    displayDate: date,
    startTime,
    displayTime: startTime,
    endTime,
    displayTimezone,
    utcStart: date && startTime ? toUTC(date, startTime, displayTimezone) : null,
    utcEnd: date && endTime ? toUTC(date, endTime, displayTimezone) : null
  };
}

function calculateEventTime(schedule, timezone = 'Asia/Shanghai') {
  const normalized = normalizeSchedule({
    ...schedule,
    displayTimezone: timezone
  });
  return normalized.utcStart;
}

function createDefaultStages(priority = 'medium') {
  const settings = readSettings();
  const defaults = settings.reminderDefaults || {
    high: [0],
    medium: [0],
    low: [0]
  };
  const offsets = defaults[priority] || defaults.medium || [];

  return offsets.map((offset) => ({
    id: generateStageId(),
    offset,
    offsetUnit: 'minutes',
    message: Number(offset) === 0 ? 'Event reminder' : `Event reminder (${offset} minutes early)`,
    priority,
    cronJobIds: [],
    pushedChannels: {},
    triggerTime: null
  }));
}

function applyReminderResultToStage(stage, cronResult) {
  if (!Array.isArray(cronResult.channels) || cronResult.channels.length === 0) {
    stage.cronJobIds = [];
    stage.triggerTime = null;
    stage.pushedChannels = {};
    return [];
  }

  stage.cronJobIds = cronResult.channels.map((channel) => channel.cronJobId);
  stage.triggerTime = cronResult.triggerTime;
  stage.pushedChannels = Object.fromEntries(
    cronResult.channels.map((channel) => [
      channel.channel,
      {
        pushedAt: null,
        cronJobId: channel.cronJobId,
        status: 'pending'
      }
    ])
  );

  return stage.cronJobIds;
}

function appendPlan(plan) {
  const schedule = normalizeSchedule(plan.schedule || {});
  if (!schedule.utcStart) {
    return { success: false, error: 'Unable to parse event time.' };
  }

  const event = {
    id: generateEventId(),
    title: plan.title,
    type: plan.type || 'plan',
    priority: plan.priority || 'medium',
    schedule,
    location: plan.location || null,
    description: plan.description || null,
    reminderStages:
      Array.isArray(plan.reminderStages) && plan.reminderStages.length > 0
        ? plan.reminderStages
        : createDefaultStages(plan.priority || 'medium'),
    notify: plan.notify || {
      channels: ['qq', 'wechat'],
      enabled: true
    },
    lifecycle: {
      status: 'active',
      completedAt: null,
      cancelledAt: null,
      expiredAt: null
    },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 4,
      archived: false,
      archivedAt: null,
      source: plan.metadata?.source || 'natural-language'
    }
  };

  savePlan(event);

  const createdCrons = [];
  const reminderFailures = [];
  for (const stage of event.reminderStages) {
    const cronResult = createReminderCron({
      eventId: event.id,
      stageId: stage.id,
      event,
      eventTime: schedule.utcStart,
      offset: stage.offset,
      offsetUnit: stage.offsetUnit || 'minutes'
    });

    createdCrons.push(...applyReminderResultToStage(stage, cronResult));

    if (!cronResult.success) {
      reminderFailures.push({
        stageId: stage.id,
        error: cronResult.error || 'Failed to create reminder cron jobs.',
        partialSuccess: Boolean(cronResult.partialSuccess),
        triggerTime: cronResult.triggerTime || null,
        failures: cronResult.failures || []
      });
    }
  }

  savePlan(event);

  if (event.reminderStages.length > 0 && createdCrons.length === 0) {
    return {
      success: false,
      eventSaved: true,
      event,
      createdCrons: 0,
      reminderFailures,
      error: 'Plan was saved, but no reminder cron jobs were created.'
    };
  }

  if (reminderFailures.length > 0) {
    return {
      success: false,
      partialSuccess: true,
      eventSaved: true,
      event,
      createdCrons: createdCrons.length,
      reminderFailures,
      error: 'Plan was saved, but some reminder cron jobs failed to create.'
    };
  }

  return {
    success: true,
    event,
    createdCrons: createdCrons.length
  };
}

function updatePlan(planId, updates = {}) {
  const event = getPlanById(planId);
  if (!event) {
    return { success: false, error: 'Event not found.' };
  }

  let updatedSchedule = event.schedule;
  if (updates.schedule) {
    updatedSchedule = normalizeSchedule({
      ...event.schedule,
      ...updates.schedule
    });

    if (!updatedSchedule.utcStart) {
      return { success: false, error: 'Unable to parse updated event time.' };
    }
  }

  const updatedEvent = {
    ...event,
    ...updates,
    schedule: updatedSchedule,
    metadata: {
      ...event.metadata,
      updatedAt: new Date().toISOString()
    }
  };

  savePlan(updatedEvent);

  if (updates.schedule) {
    const reminderResult = updateReminderCrons(planId, updatedSchedule.utcStart);
    if (!reminderResult.success) {
      return {
        success: false,
        eventUpdated: true,
        partialSuccess: Boolean(reminderResult.partialSuccess),
        event: getPlanById(planId) || updatedEvent,
        error: reminderResult.error,
        createdCrons: reminderResult.createdCrons || 0,
        deletedCrons: reminderResult.deletedCrons || 0,
        reminderFailures: reminderResult.failures || []
      };
    }

    return {
      success: true,
      event: getPlanById(planId) || updatedEvent,
      createdCrons: reminderResult.createdCrons || 0,
      deletedCrons: reminderResult.deletedCrons || 0
    };
  }

  return {
    success: true,
    event: updatedEvent
  };
}

function deletePlan(planId) {
  const event = getPlanById(planId);
  if (!event) {
    return { success: false, error: 'Event not found.' };
  }

  const cronResult = deleteReminderCrons(planId);
  const deleted = deletePlanById(planId);

  return {
    success: deleted,
    deletedCrons: cronResult.deletedCount || 0
  };
}

function cancelPlan(planId, reason = 'Cancelled by user') {
  const event = getPlanById(planId);
  if (!event) {
    return { success: false, error: 'Event not found.' };
  }

  deleteReminderCrons(planId);

  event.lifecycle = {
    ...event.lifecycle,
    status: 'cancelled',
    cancelledAt: new Date().toISOString()
  };
  event.cancelReason = reason;
  event.metadata.updatedAt = new Date().toISOString();
  savePlan(event);

  return { success: true, event };
}

function completePlan(planId) {
  const event = getPlanById(planId);
  if (!event) {
    return { success: false, error: 'Event not found.' };
  }

  event.lifecycle = {
    ...event.lifecycle,
    status: 'completed',
    completedAt: new Date().toISOString()
  };
  event.metadata.updatedAt = new Date().toISOString();
  savePlan(event);

  return { success: true, event };
}

function getPlan(planId) {
  return getPlanById(planId);
}

function listPlans() {
  return readPlans().plans;
}

module.exports = {
  appendPlan,
  updatePlan,
  deletePlan,
  cancelPlan,
  completePlan,
  getPlan,
  listPlans,
  parseTime,
  normalizeSchedule,
  calculateEventTime,
  createDefaultStages
};
