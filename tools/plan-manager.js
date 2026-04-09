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
    high: [1440, 60],
    medium: [30],
    low: [10]
  };

  const offsets = defaults[priority] || defaults.medium || [];

  return offsets.map((offset) => ({
    id: generateStageId(),
    offset,
    offsetUnit: 'minutes',
    message: `${offset} 分钟后有安排`,
    priority,
    cronJobIds: [],
    pushedChannels: {},
    triggerTime: null
  }));
}

function appendPlan(plan) {
  const schedule = normalizeSchedule(plan.schedule || {});
  if (!schedule.utcStart) {
    return { success: false, error: '无法解析事件时间' };
  }

  const event = {
    id: generateEventId(),
    title: plan.title,
    type: plan.type || 'plan',
    priority: plan.priority || 'medium',
    schedule,
    location: plan.location || null,
    description: plan.description || null,
    reminderStages: Array.isArray(plan.reminderStages) && plan.reminderStages.length > 0
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
  for (const stage of event.reminderStages) {
    const cronResult = createReminderCron({
      eventId: event.id,
      stageId: stage.id,
      event,
      eventTime: schedule.utcStart,
      offset: stage.offset,
      offsetUnit: stage.offsetUnit || 'minutes'
    });

    if (cronResult.success) {
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
      createdCrons.push(...stage.cronJobIds);
    }
  }

  savePlan(event);

  return {
    success: true,
    event,
    createdCrons: createdCrons.length
  };
}

function updatePlan(planId, updates = {}) {
  const event = getPlanById(planId);
  if (!event) {
    return { success: false, error: '事件不存在' };
  }

  let updatedSchedule = event.schedule;
  if (updates.schedule) {
    updatedSchedule = normalizeSchedule({
      ...event.schedule,
      ...updates.schedule
    });

    if (!updatedSchedule.utcStart) {
      return { success: false, error: '无法解析新的事件时间' };
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
    updateReminderCrons(planId, updatedSchedule.utcStart);
  }

  return {
    success: true,
    event: updatedEvent
  };
}

function deletePlan(planId) {
  const event = getPlanById(planId);
  if (!event) {
    return { success: false, error: '事件不存在' };
  }

  const cronResult = deleteReminderCrons(planId);
  const deleted = deletePlanById(planId);

  return {
    success: deleted,
    deletedCrons: cronResult.deletedCount || 0
  };
}

function cancelPlan(planId, reason = '用户取消') {
  const event = getPlanById(planId);
  if (!event) {
    return { success: false, error: '事件不存在' };
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
    return { success: false, error: '事件不存在' };
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
