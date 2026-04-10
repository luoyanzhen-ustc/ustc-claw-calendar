#!/usr/bin/env node

const { execSync } = require('child_process');
const {
  DEFAULT_TIMEZONE,
  readSettings,
  toUTC,
  toLocal
} = require('./file-ops.js');
const {
  syncChannels,
  getEffectiveUserChannelConfig,
  buildWeixinAccountName,
  buildQQTarget
} = require('./channel-sync.js');

const MIN_SCHEDULE_LEAD_MS = 5000;
const DEFAULT_LOOKAHEAD_DAYS = 366;

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

function getSourceKind(sourceType) {
  if (sourceType === 'event') {
    return 'one-time';
  }

  if (sourceType === 'course' || sourceType === 'recurring') {
    return 'rule-based';
  }

  return 'unknown';
}

function getLocalParts(date, timezone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function addDays(dateString, days, timezone = DEFAULT_TIMEZONE) {
  const parsed = new Date(`${dateString}T12:00:00${timezone === 'UTC' ? 'Z' : '+08:00'}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return getLocalParts(parsed, timezone).date;
}

function getWeekday(dateString, timezone = DEFAULT_TIMEZONE) {
  const parsed = new Date(`${dateString}T12:00:00${timezone === 'UTC' ? 'Z' : '+08:00'}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const weekday = parsed.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function diffDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function computeWeekNumber(semesterStart, dateString) {
  if (!semesterStart || !dateString) {
    return null;
  }

  const days = diffDays(semesterStart, dateString);
  if (days === null || days < 0) {
    return null;
  }

  return Math.floor(days / 7) + 1;
}

function isWeekAllowed(weekNumber, weekRanges = []) {
  if (!Array.isArray(weekRanges) || weekRanges.length === 0) {
    return true;
  }

  return weekRanges.some((range) => {
    if (!Array.isArray(range) || range.length < 2) {
      return false;
    }

    return weekNumber >= Number(range[0]) && weekNumber <= Number(range[1]);
  });
}

function normalizeDisplay(date, startTime, endTime, timezone) {
  return {
    date,
    startTime,
    endTime: endTime || null,
    timezone
  };
}

function buildResolvedOccurrence(sourceType, sourceId, sourceObject, eventTime, display, extra = {}) {
  return {
    sourceType,
    sourceId,
    eventTime,
    display,
    title: sourceObject.title || sourceObject.name || 'Untitled event',
    summary: sourceObject.summary || sourceObject.description || null,
    location: sourceObject.location || null,
    reminders: sourceObject.reminders || { enabled: false, stages: [] },
    sourceKind: getSourceKind(sourceType),
    rawSource: sourceObject,
    ...extra
  };
}

function resolveEventOccurrence(sourceId, sourceObject) {
  if (!sourceObject?.startAt) {
    return { success: false, error: 'Event start time is missing.' };
  }

  const timezone = sourceObject.display?.timezone || readSettings().displayTimezone || DEFAULT_TIMEZONE;
  const localDisplay = toLocal(sourceObject.startAt, timezone);
  const display = sourceObject.display || normalizeDisplay(
    localDisplay?.date || null,
    localDisplay?.time || null,
    sourceObject.endAt ? toLocal(sourceObject.endAt, timezone)?.time || null : null,
    timezone
  );

  return {
    success: true,
    occurrence: buildResolvedOccurrence('event', sourceId, sourceObject, sourceObject.startAt, display)
  };
}

function resolveCourseOccurrence(sourceId, sourceObject, options = {}) {
  const schedule = sourceObject.schedule || {};
  const timezone = schedule.timezone || readSettings().displayTimezone || DEFAULT_TIMEZONE;
  const now = options.now instanceof Date ? options.now : new Date();
  const localToday = getLocalParts(now, timezone).date;
  const weekday = Number(schedule.weekday);

  if (!weekday || !schedule.startTime) {
    return { success: false, error: 'Course schedule is incomplete.' };
  }

  for (let offset = 0; offset <= (options.lookaheadDays || DEFAULT_LOOKAHEAD_DAYS); offset += 1) {
    const date = addDays(localToday, offset, timezone);
    if (!date || getWeekday(date, timezone) !== weekday) {
      continue;
    }

    if (schedule.semesterStart && date < schedule.semesterStart) {
      continue;
    }

    const weekNumber = computeWeekNumber(schedule.semesterStart || date, date);
    if (weekNumber !== null && !isWeekAllowed(weekNumber, schedule.weekRanges || [])) {
      continue;
    }

    const eventTime = toUTC(date, schedule.startTime, timezone);
    if (!eventTime || new Date(eventTime).getTime() <= now.getTime()) {
      continue;
    }

    return {
      success: true,
      occurrence: buildResolvedOccurrence(
        'course',
        sourceId,
        sourceObject,
        eventTime,
        normalizeDisplay(date, schedule.startTime, schedule.endTime || null, timezone),
        {
          weekNumber
        }
      )
    };
  }

  return { success: false, error: 'No upcoming course occurrence was found.' };
}

function shouldSkipRecurringDate(sourceObject, date) {
  return (sourceObject.exceptions || []).some((item) => item.date === date && item.action === 'skip');
}

function resolveRecurringOccurrence(sourceId, sourceObject, options = {}) {
  const rule = sourceObject.rule || {};
  const range = sourceObject.range || {};
  const timezone = rule.timezone || readSettings().displayTimezone || DEFAULT_TIMEZONE;
  const now = options.now instanceof Date ? options.now : new Date();
  const localToday = getLocalParts(now, timezone).date;
  const weekdays = Array.isArray(rule.byWeekday) ? rule.byWeekday.map(Number) : [];
  const searchStart = range.startDate && range.startDate > localToday ? range.startDate : localToday;

  if (!rule.startTime || weekdays.length === 0) {
    return { success: false, error: 'Recurring rule is incomplete.' };
  }

  for (let offset = 0; offset <= (options.lookaheadDays || DEFAULT_LOOKAHEAD_DAYS); offset += 1) {
    const date = addDays(searchStart, offset, timezone);
    if (!date) {
      continue;
    }

    if (range.endDate && date > range.endDate) {
      break;
    }

    if (!weekdays.includes(getWeekday(date, timezone))) {
      continue;
    }

    if (shouldSkipRecurringDate(sourceObject, date)) {
      continue;
    }

    const eventTime = toUTC(date, rule.startTime, timezone);
    if (!eventTime || new Date(eventTime).getTime() <= now.getTime()) {
      continue;
    }

    return {
      success: true,
      occurrence: buildResolvedOccurrence(
        'recurring',
        sourceId,
        sourceObject,
        eventTime,
        normalizeDisplay(date, rule.startTime, rule.endTime || null, timezone)
      )
    };
  }

  return { success: false, error: 'No upcoming recurring occurrence was found.' };
}

function resolveReminderOccurrence({ sourceType, sourceId, sourceObject, options = {} }) {
  if (sourceType === 'event') {
    return resolveEventOccurrence(sourceId, sourceObject);
  }

  if (sourceType === 'course') {
    return resolveCourseOccurrence(sourceId, sourceObject, options);
  }

  if (sourceType === 'recurring') {
    return resolveRecurringOccurrence(sourceId, sourceObject, options);
  }

  return { success: false, error: `Unsupported reminder source type: ${sourceType}` };
}

function createReminderPrompt(occurrence, offset, offsetUnit, channel) {
  const unitText = offsetUnit === 'days' ? 'days' : offsetUnit === 'hours' ? 'hours' : 'minutes';

  return [
    'You are a calendar reminder assistant.',
    'Reply with a short reminder message for the user.',
    `Event title: ${occurrence.title}`,
    `Event time: ${occurrence.display.date || 'date unavailable'} ${occurrence.display.startTime || 'time unavailable'} (Beijing time)`,
    occurrence.summary ? `Event summary: ${occurrence.summary}` : null,
    occurrence.location ? `Location: ${occurrence.location}` : null,
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

function cloneReminderStage(stage) {
  return {
    ...stage,
    cronJobIds: Array.isArray(stage?.cronJobIds) ? [...stage.cronJobIds] : [],
    triggerTime: stage?.triggerTime || null,
    pushedChannels: stage?.pushedChannels ? { ...stage.pushedChannels } : {}
  };
}

function clearReminderStageRuntime(stage) {
  return {
    ...cloneReminderStage(stage),
    cronJobIds: [],
    triggerTime: null,
    pushedChannels: {}
  };
}

function cloneReminders(reminders = {}) {
  return {
    enabled: reminders.enabled === true && Array.isArray(reminders.stages) && reminders.stages.length > 0,
    stages: Array.isArray(reminders.stages) ? reminders.stages.map(cloneReminderStage) : []
  };
}

function deleteReminderCronIds(cronJobIds = [], dependencies = {}) {
  const deleteJob = dependencies.deleteCronJob || deleteCronJob;
  const deletedCronIds = [];
  const failures = [];

  for (const cronJobId of cronJobIds) {
    const result = deleteJob(cronJobId);
    if (result.success) {
      deletedCronIds.push(cronJobId);
    } else {
      failures.push({
        cronJobId,
        error: result.error || 'Failed to delete cron job.'
      });
    }
  }

  return {
    deletedCronIds,
    deletedCount: deletedCronIds.length,
    failures
  };
}

function clearReminderCrons(reminders = {}, dependencies = {}) {
  const nextReminders = cloneReminders(reminders);
  const allCronIds = nextReminders.stages.flatMap((stage) => stage.cronJobIds || []);
  const deleted = deleteReminderCronIds(allCronIds, dependencies);

  nextReminders.stages = nextReminders.stages.map(clearReminderStageRuntime);

  return {
    success: deleted.failures.length === 0,
    partialSuccess: deleted.failures.length > 0 && deleted.deletedCount > 0,
    reminders: nextReminders,
    deletedCount: deleted.deletedCount,
    deletedCronIds: deleted.deletedCronIds,
    failures: deleted.failures
  };
}

function createReminderCronForOccurrence({ sourceType, sourceId, stage, occurrence, dependencies = {} }) {
  const sync = dependencies.syncChannels || syncChannels;
  const getChannels = dependencies.getEnabledChannels || getEnabledChannels;
  const createJob = dependencies.createCronJob || createCronJob;

  sync();
  const enabledChannels = getChannels();
  if (enabledChannels.length === 0) {
    return { success: false, error: 'No available QQ or WeChat bot channel configuration was detected.' };
  }

  const timing = resolveReminderTriggerTime(
    occurrence.eventTime,
    stage.offset,
    stage.offsetUnit || 'minutes'
  );
  if (!timing.success) {
    return timing;
  }

  const created = [];
  const failures = [];

  for (const channel of enabledChannels) {
    const cronName = `ustc-claw-calendar-${sourceType}-${sourceId}-${stage.id}-${channel.type}`;
    const result = createJob(
      cronName,
      { kind: 'at', at: timing.triggerTime },
      createReminderPrompt(occurrence, stage.offset, stage.offsetUnit || 'minutes', channel.type),
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

function syncReminderCronsForSource({
  sourceType,
  sourceId,
  sourceObject,
  reminders,
  options = {},
  dependencies = {}
}) {
  const currentReminders = cloneReminders(reminders || sourceObject?.reminders || {});
  const deleted = clearReminderCrons(currentReminders, dependencies);
  const nextReminders = cloneReminders(deleted.reminders);

  if (!nextReminders.enabled || nextReminders.stages.length === 0) {
    return {
      success: deleted.failures.length === 0,
      partialSuccess: deleted.partialSuccess,
      reminders: nextReminders,
      occurrence: null,
      createdCrons: 0,
      deletedCrons: deleted.deletedCount,
      deletedCronIds: deleted.deletedCronIds,
      failures: deleted.failures,
      error: deleted.failures.length > 0 ? 'Some existing reminder cron jobs failed to delete.' : null
    };
  }

  const resolved = resolveReminderOccurrence({ sourceType, sourceId, sourceObject, options });
  if (!resolved.success) {
    return {
      success: false,
      reminders: nextReminders,
      occurrence: null,
      createdCrons: 0,
      deletedCrons: deleted.deletedCount,
      deletedCronIds: deleted.deletedCronIds,
      failures: deleted.failures,
      error: resolved.error
    };
  }

  const occurrence = resolved.occurrence;
  const createdCronIds = [];
  const failures = [...deleted.failures];

  nextReminders.stages = nextReminders.stages.map((stage) => {
    const result = createReminderCronForOccurrence({
      sourceType,
      sourceId,
      stage,
      occurrence,
      dependencies
    });

    if (Array.isArray(result.channels) && result.channels.length > 0) {
      const cronJobIds = result.channels.map((channel) => channel.cronJobId);
      createdCronIds.push(...cronJobIds);
      return {
        ...stage,
        cronJobIds,
        triggerTime: result.triggerTime || null,
        pushedChannels: Object.fromEntries(
          result.channels.map((channel) => [
            channel.channel,
            {
              pushedAt: null,
              cronJobId: channel.cronJobId,
              status: 'pending'
            }
          ])
        )
      };
    }

    failures.push({
      stageId: stage.id,
      error: result.error || 'Failed to create reminder cron jobs.',
      partialSuccess: Boolean(result.partialSuccess),
      triggerTime: result.triggerTime || null,
      failures: result.failures || []
    });

    return clearReminderStageRuntime(stage);
  });

  if (nextReminders.stages.length > 0 && createdCronIds.length === 0) {
    return {
      success: false,
      reminders: nextReminders,
      occurrence,
      createdCrons: 0,
      deletedCrons: deleted.deletedCount,
      deletedCronIds: deleted.deletedCronIds,
      failures,
      error: 'No reminder cron jobs were created.'
    };
  }

  if (failures.length > 0) {
    return {
      success: false,
      partialSuccess: createdCronIds.length > 0,
      reminders: nextReminders,
      occurrence,
      createdCrons: createdCronIds.length,
      deletedCrons: deleted.deletedCount,
      deletedCronIds: deleted.deletedCronIds,
      failures,
      error: 'Some reminder cron jobs failed to synchronize.'
    };
  }

  return {
    success: true,
    reminders: nextReminders,
    occurrence,
    createdCrons: createdCronIds.length,
    deletedCrons: deleted.deletedCount,
    deletedCronIds: deleted.deletedCronIds,
    failures: []
  };
}

function buildAdHocReminderStage(reminders = {}, stage = {}) {
  return {
    enabled: true,
    stages: [
      ...(Array.isArray(reminders.stages) ? reminders.stages.map(cloneReminderStage) : []),
      {
        ...stage,
        id: stage.id || `stage-${Math.random().toString(36).slice(2, 10)}`,
        offset: Math.max(0, Number(stage.offset) || 0),
        offsetUnit: ['minutes', 'hours', 'days'].includes(stage.offsetUnit) ? stage.offsetUnit : 'minutes',
        cronJobIds: Array.isArray(stage.cronJobIds) ? [...stage.cronJobIds] : [],
        triggerTime: stage.triggerTime || null,
        createdAt: stage.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  };
}

function listReminderCronsForSource(sourceType, sourceId) {
  const listResult = listCalendarCrons();
  if (!listResult.success) {
    return listResult;
  }

  const prefix = `ustc-claw-calendar-${sourceType}-${sourceId}-`;
  const cronJobs = listResult.jobs.filter((job) => job.name?.startsWith(prefix));
  return {
    success: true,
    cronJobs,
    total: cronJobs.length
  };
}

module.exports = {
  createCronJob,
  deleteCronJob,
  listCalendarCrons,
  getUserChannelConfig,
  getEnabledChannels,
  exec,
  parseCronList,
  resolveReminderTriggerTime,
  resolveReminderOccurrence,
  syncReminderCronsForSource,
  clearReminderCrons,
  buildAdHocReminderStage,
  listReminderCronsForSource
};
