#!/usr/bin/env node

function toDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function deriveWorkflowStatus(item = {}) {
  if (item.cancelledAt) {
    return { code: 'cancelled', label: '已取消' };
  }

  if (item.completedAt) {
    return { code: 'completed', label: '已完成' };
  }

  return { code: 'open', label: '未标记完成' };
}

function deriveTimeStatus(item = {}, now = new Date()) {
  const start = toDate(item.startAt);
  const end = toDate(item.endAt);

  if (!start) {
    return { code: 'unscheduled', label: '时间未定' };
  }

  if (start.getTime() > now.getTime()) {
    return { code: 'upcoming', label: '未开始' };
  }

  if (end && end.getTime() > now.getTime()) {
    return { code: 'ongoing', label: '进行中' };
  }

  return { code: 'past', label: '已过时间' };
}

function deriveReminderStageState(stage = {}, now = new Date()) {
  const triggerDate = toDate(stage.triggerTime);
  const channelEntries = Object.values(stage.pushedChannels || {});
  const hasSent = channelEntries.some((channel) => Boolean(channel?.pushedAt));
  const hasPendingChannel = channelEntries.some((channel) => (channel?.status || 'pending') === 'pending');
  const hasCronJobIds = Array.isArray(stage.cronJobIds) && stage.cronJobIds.length > 0;

  if (hasSent) {
    return { code: 'sent', label: '已触发' };
  }

  if (triggerDate && triggerDate.getTime() <= now.getTime() && (hasPendingChannel || hasCronJobIds)) {
    return { code: 'past-due', label: '已过提醒时间' };
  }

  if (triggerDate && triggerDate.getTime() > now.getTime()) {
    return { code: 'scheduled', label: '提醒已安排' };
  }

  if (hasCronJobIds) {
    return { code: 'scheduled', label: '提醒已安排' };
  }

  return { code: 'none', label: '无提醒' };
}

function deriveReminderState(reminders = {}, now = new Date()) {
  const stages = Array.isArray(reminders.stages) ? reminders.stages : [];
  const stageStates = stages.map((stage) => ({
    stageId: stage.id || null,
    triggerTime: stage.triggerTime || null,
    cronJobIds: stage.cronJobIds || [],
    state: deriveReminderStageState(stage, now)
  }));

  if (stageStates.some((stage) => stage.state.code === 'past-due')) {
    return { code: 'past-due', label: '存在已过提醒时间的提醒', stages: stageStates };
  }

  if (stageStates.some((stage) => stage.state.code === 'scheduled')) {
    return { code: 'scheduled', label: '提醒已安排', stages: stageStates };
  }

  if (stageStates.some((stage) => stage.state.code === 'sent')) {
    return { code: 'sent', label: '提醒已触发', stages: stageStates };
  }

  return { code: 'none', label: '无提醒', stages: stageStates };
}

function deriveItemState(item = {}, now = new Date()) {
  const workflow = deriveWorkflowStatus(item);
  const time = deriveTimeStatus(item, now);
  const reminder = deriveReminderState(item.reminders || {}, now);

  let label = workflow.label;
  if (workflow.code === 'open' && time.code === 'past') {
    label = '已过时间，未标记完成';
  } else if (workflow.code === 'open') {
    label = time.label;
  }

  return {
    workflow,
    time,
    reminder,
    label
  };
}

module.exports = {
  deriveWorkflowStatus,
  deriveTimeStatus,
  deriveReminderStageState,
  deriveReminderState,
  deriveItemState
};
