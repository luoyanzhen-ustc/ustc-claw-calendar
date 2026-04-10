#!/usr/bin/env node

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizePushedChannels(pushedChannels = {}) {
  if (!pushedChannels || typeof pushedChannels !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(pushedChannels)
      .map(([channel, value]) => {
        if (!value || typeof value !== 'object') {
          return null;
        }

        const cronJobId = value.cronJobId || value.jobId || value.id || null;
        return [
          channel,
          {
            pushedAt: value.pushedAt || null,
            cronJobId,
            status: value.status || (cronJobId ? 'pending' : 'unknown')
          }
        ];
      })
      .filter(Boolean)
  );
}

function deriveStageCronJobIds(stage = {}) {
  const pushedChannels = normalizePushedChannels(stage.pushedChannels);
  const pushedChannelIds = uniqueStrings(
    Object.values(pushedChannels)
      .map((channel) => channel.cronJobId)
      .filter(Boolean)
  );

  if (pushedChannelIds.length > 0) {
    return pushedChannelIds;
  }

  return uniqueStrings(stage.cronJobIds || []);
}

function normalizeReminderStage(stage = {}, createStageId) {
  const pushedChannels = normalizePushedChannels(stage.pushedChannels);

  return {
    id: stage.id || createStageId(),
    offset: Math.max(0, Number(stage.offset) || 0),
    offsetUnit: ['minutes', 'hours', 'days'].includes(stage.offsetUnit) ? stage.offsetUnit : 'minutes',
    cronJobIds: deriveStageCronJobIds({ ...stage, pushedChannels }),
    triggerTime: stage.triggerTime || null,
    createdAt: stage.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pushedChannels
  };
}

function normalizeReminders(reminders = {}, createStageId) {
  const stages = Array.isArray(reminders.stages)
    ? reminders.stages.map((stage) => normalizeReminderStage(stage, createStageId))
    : [];

  return {
    enabled: reminders.enabled === true && stages.length > 0,
    stages
  };
}

module.exports = {
  uniqueStrings,
  normalizePushedChannels,
  deriveStageCronJobIds,
  normalizeReminderStage,
  normalizeReminders
};
