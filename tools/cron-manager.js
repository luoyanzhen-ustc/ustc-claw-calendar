#!/usr/bin/env node

const { execSync } = require('child_process');
const {
  syncChannels,
  getEffectiveUserChannelConfig,
  buildWeixinAccountName,
  buildQQTarget
} = require('./channel-sync.js');

const MIN_SCHEDULE_LEAD_MS = 5000;

function getUserChannelConfig(options = {}) {
  return getEffectiveUserChannelConfig(options) || {
    name: 'default',
    qq: { openid: null, enabled: false },
    weixin: { userId: null, accountId: null, enabled: false }
  };
}

function getEnabledChannels(userConfig = getUserChannelConfig()) {
  const channels = [];

  if (userConfig.qq?.enabled && userConfig.qq?.openid) {
    channels.push({
      type: 'qq',
      channel: 'qq',
      cliChannel: 'qqbot',
      to: buildQQTarget(userConfig.qq.openid),
      account: null
    });
  }

  if (userConfig.weixin?.enabled && userConfig.weixin?.userId) {
    channels.push({
      type: 'wechat',
      channel: 'wechat',
      cliChannel: 'openclaw-weixin',
      to: userConfig.weixin.userId,
      account: buildWeixinAccountName(userConfig.weixin.accountId)
    });
  }

  return channels;
}

function exec(command, options = {}) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      ...options
    });

    return { success: true, output };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || '',
      error: error.message
    };
  }
}

function parseCronList(output) {
  try {
    const parsed = JSON.parse(output);
    return parsed.jobs || parsed || [];
  } catch (error) {
    return [];
  }
}

function escapeSingleQuotes(value) {
  return String(value).replace(/'/g, `'\\''`);
}

function createCronJob(name, schedule, payloadMessage, channelConfig, options = {}) {
  let command = `openclaw cron add --name '${escapeSingleQuotes(name)}'`;

  if (schedule.kind === 'at') {
    command += ` --at '${escapeSingleQuotes(schedule.at)}'`;
  } else if (schedule.kind === 'cron') {
    command += ` --cron '${escapeSingleQuotes(schedule.expr)}'`;
  } else if (schedule.kind === 'every') {
    command += ` --every '${escapeSingleQuotes(schedule.everyMs)}'`;
  }

  command += ` --message '${escapeSingleQuotes(payloadMessage)}'`;
  command += ` --session 'isolated'`;
  command += ` --announce`;
  command += ` --channel '${channelConfig.cliChannel}'`;
  command += ` --to '${escapeSingleQuotes(channelConfig.to)}'`;

  if (channelConfig.account) {
    command += ` --account '${escapeSingleQuotes(channelConfig.account)}'`;
  }

  if (options.deleteAfterRun !== false) {
    command += ' --delete-after-run';
  }

  command += ' --json';

  const result = exec(command);
  if (!result.success) {
    return result;
  }

  try {
    const payload = JSON.parse(result.output);
    const cronJobId = payload.id || payload.jobId || payload.job?.id || null;
    if (!cronJobId) {
      return {
        success: false,
        channel: channelConfig.channel,
        to: channelConfig.to,
        error: 'Cron creation returned no job id.',
        output: result.output
      };
    }

    return {
      success: true,
      cronJobId,
      channel: channelConfig.channel,
      to: channelConfig.to,
      rawData: payload
    };
  } catch (error) {
    return {
      success: false,
      channel: channelConfig.channel,
      to: channelConfig.to,
      error: 'Failed to parse cron creation response.',
      output: result.output
    };
  }
}

function deleteCronJob(jobId) {
  const result = exec(`openclaw cron remove --jobId '${escapeSingleQuotes(jobId)}'`);
  return {
    success: result.success,
    deleted: result.success,
    error: result.error || null
  };
}

function listCalendarCrons() {
  const result = exec('openclaw cron list --json');
  if (!result.success) {
    return { success: false, error: result.error, jobs: [] };
  }

  const jobs = parseCronList(result.output).filter((job) => job.name?.startsWith('ustc-claw-calendar-'));
  return {
    success: true,
    jobs,
    total: jobs.length
  };
}

function createReminderPrompt(event, offset, offsetUnit, channel) {
  const displayDate = event.schedule.displayDate || event.schedule.date || 'date unavailable';
  const displayTime = event.schedule.displayTime || event.schedule.startTime || 'time unavailable';
  const unitText = offsetUnit === 'days' ? 'days' : offsetUnit === 'hours' ? 'hours' : 'minutes';

  return [
    'You are a calendar reminder assistant.',
    'Reply with a short reminder message for the user.',
    `Event title: ${event.title}`,
    `Event time: ${displayDate} ${displayTime} (Beijing time)`,
    event.location ? `Location: ${event.location}` : null,
    `Lead time: ${offset} ${unitText}`,
    `Channel: ${channel === 'qq' ? 'QQ' : 'WeChat'}`,
    'Requirements:',
    '1. Use Beijing time wording, not UTC.',
    '2. Do not call any tools.',
    '3. Do not mention internal ids or system fields.',
    '4. Keep it short and natural.'
  ]
    .filter(Boolean)
    .join('\n');
}

function getOffsetMultiplier(offsetUnit) {
  if (offsetUnit === 'days') {
    return 24 * 60 * 60 * 1000;
  }

  if (offsetUnit === 'hours') {
    return 60 * 60 * 1000;
  }

  return 60 * 1000;
}

function resolveReminderTriggerTime(eventTime, offset, offsetUnit) {
  const eventDate = new Date(eventTime);
  if (Number.isNaN(eventDate.getTime())) {
    return { success: false, error: 'Invalid event time for reminder scheduling.' };
  }

  const now = new Date();
  if (eventDate.getTime() <= now.getTime()) {
    return { success: false, error: 'Event time is already in the past.' };
  }

  const requestedOffset = Math.max(0, Number(offset) || 0);
  const triggerDate = new Date(eventDate.getTime() - requestedOffset * getOffsetMultiplier(offsetUnit));
  if (triggerDate.getTime() <= now.getTime()) {
    const fallbackTime = new Date(Math.max(eventDate.getTime(), now.getTime() + MIN_SCHEDULE_LEAD_MS));
    return {
      success: true,
      triggerTime: fallbackTime.toISOString(),
      adjusted: true,
      requestedOffset,
      effectiveOffset: fallbackTime.getTime() === eventDate.getTime() ? 0 : null,
      adjustmentReason: 'requested-trigger-time-was-in-the-past'
    };
  }

  return {
    success: true,
    triggerTime: triggerDate.toISOString(),
    adjusted: false,
    requestedOffset,
    effectiveOffset: requestedOffset,
    adjustmentReason: null
  };
}

function createReminderCron({ eventId, stageId, event, eventTime, offset, offsetUnit }) {
  syncChannels();
  const enabledChannels = getEnabledChannels();
  if (enabledChannels.length === 0) {
    return { success: false, error: 'No available QQ or WeChat bot channel configuration was detected.' };
  }

  const timing = resolveReminderTriggerTime(eventTime, offset, offsetUnit);
  if (!timing.success) {
    return timing;
  }

  const created = [];
  const failures = [];
  for (const channel of enabledChannels) {
    const cronName = `ustc-claw-calendar-${eventId}-${stageId}-${channel.type}`;
    const result = createCronJob(
      cronName,
      { kind: 'at', at: timing.triggerTime },
      createReminderPrompt(event, offset, offsetUnit, channel.type),
      channel
    );

    if (result.success) {
      created.push({
        channel: channel.channel,
        cronJobId: result.cronJobId,
        to: channel.to
      });
    } else {
      failures.push({
        channel: channel.channel,
        to: channel.to,
        error: result.error || 'Failed to create cron job.',
        output: result.output || null
      });
    }
  }

  if (created.length === 0) {
    return {
      success: false,
      error: 'Failed to create reminder cron jobs.',
      triggerTime: timing.triggerTime,
      adjusted: timing.adjusted,
      adjustmentReason: timing.adjustmentReason,
      requestedOffset: timing.requestedOffset,
      effectiveOffset: timing.effectiveOffset,
      failures
    };
  }

  return {
    success: failures.length === 0,
    partialSuccess: failures.length > 0,
    triggerTime: timing.triggerTime,
    adjusted: timing.adjusted,
    adjustmentReason: timing.adjustmentReason,
    requestedOffset: timing.requestedOffset,
    effectiveOffset: timing.effectiveOffset,
    channels: created,
    failures,
    error: failures.length > 0 ? 'Some reminder cron jobs failed to create.' : null
  };
}

function updateReminderCrons(eventId, newEventTime) {
  const { getPlanById, savePlan } = require('./file-ops.js');
  const event = getPlanById(eventId);
  if (!event) {
    return { success: false, error: 'Event not found.' };
  }

  const deleted = deleteReminderCrons(eventId);
  const createdCronIds = [];
  const failures = [];

  for (const stage of event.reminderStages || []) {
    const result = createReminderCron({
      eventId,
      stageId: stage.id,
      event,
      eventTime: newEventTime,
      offset: stage.offset,
      offsetUnit: stage.offsetUnit || 'minutes'
    });

    if (Array.isArray(result.channels) && result.channels.length > 0) {
      stage.cronJobIds = result.channels.map((channel) => channel.cronJobId);
      stage.triggerTime = result.triggerTime;
      createdCronIds.push(...stage.cronJobIds);
    } else {
      stage.cronJobIds = [];
      stage.triggerTime = null;
    }

    if (!result.success) {
      failures.push({
        stageId: stage.id,
        error: result.error || 'Failed to recreate reminder cron jobs.',
        partialSuccess: Boolean(result.partialSuccess),
        triggerTime: result.triggerTime || null,
        failures: result.failures || []
      });
    }
  }

  savePlan(event);

  if ((event.reminderStages || []).length > 0 && createdCronIds.length === 0) {
    return {
      success: false,
      deletedCrons: deleted.deletedCount || 0,
      createdCrons: 0,
      cronJobIds: [],
      failures,
      error: 'No reminder cron jobs were recreated.'
    };
  }

  if (failures.length > 0) {
    return {
      success: false,
      partialSuccess: true,
      deletedCrons: deleted.deletedCount || 0,
      createdCrons: createdCronIds.length,
      cronJobIds: createdCronIds,
      failures,
      error: 'Some reminder cron jobs failed to recreate.'
    };
  }

  return {
    success: true,
    deletedCrons: deleted.deletedCount || 0,
    createdCrons: createdCronIds.length,
    cronJobIds: createdCronIds
  };
}

function deleteReminderCrons(eventId) {
  const { getPlanById } = require('./file-ops.js');
  const event = getPlanById(eventId);
  if (!event) {
    return { success: true, deletedCount: 0 };
  }

  const deletedCronIds = [];
  for (const stage of event.reminderStages || []) {
    for (const cronJobId of stage.cronJobIds || []) {
      const result = deleteCronJob(cronJobId);
      if (result.success) {
        deletedCronIds.push(cronJobId);
      }
    }
  }

  return {
    success: true,
    deletedCount: deletedCronIds.length,
    deletedCronIds
  };
}

function listReminderCrons(eventId) {
  const listResult = listCalendarCrons();
  if (!listResult.success) {
    return listResult;
  }

  const cronJobs = listResult.jobs.filter((job) => job.name?.startsWith(`ustc-claw-calendar-${eventId}-`));
  return {
    success: true,
    cronJobs,
    total: cronJobs.length
  };
}

module.exports = {
  createReminderCron,
  updateReminderCrons,
  deleteReminderCrons,
  listReminderCrons,
  createCronJob,
  deleteCronJob,
  listCalendarCrons,
  getUserChannelConfig,
  getEnabledChannels,
  exec,
  parseCronList,
  resolveReminderTriggerTime
};
