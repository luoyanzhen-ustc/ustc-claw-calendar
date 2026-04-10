#!/usr/bin/env node

const { execSync } = require('child_process');
const { syncChannels, getEffectiveUserChannelConfig, buildWeixinAccountName, buildQQTarget } = require('./channel-sync.js');

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
    return {
      success: true,
      cronJobId: payload.id,
      channel: channelConfig.channel,
      to: channelConfig.to,
      rawData: payload
    };
  } catch (error) {
    return {
      success: true,
      cronJobId: null,
      channel: channelConfig.channel,
      to: channelConfig.to,
      rawData: result.output
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
  const displayDate = event.schedule.displayDate || event.schedule.date || '未设置日期';
  const displayTime = event.schedule.displayTime || event.schedule.startTime || '未设置时间';
  const unitText = offsetUnit === 'days' ? '天' : offsetUnit === 'hours' ? '小时' : '分钟';

  return [
    '你是日历提醒助手。',
    '请直接生成一条提醒文案，输出给用户即可。',
    `事件标题：${event.title}`,
    `事件时间：${displayDate} ${displayTime}（北京时间）`,
    event.location ? `事件地点：${event.location}` : null,
    `提醒提前量：${offset}${unitText}`,
    `渠道：${channel === 'qq' ? 'QQ' : '微信'}`,
    '要求：',
    '1. 用北京时间表达，不要使用 UTC。',
    '2. 不要调用任何工具。',
    '3. 不要输出内部字段、渠道 ID 或系统说明。',
    '4. 保持简短、自然、像真人提醒。'
  ].filter(Boolean).join('\n');
}

function createReminderCron({ eventId, stageId, event, eventTime, offset, offsetUnit }) {
  syncChannels();
  const enabledChannels = getEnabledChannels();
  if (enabledChannels.length === 0) {
    return { success: false, error: '未检测到可用的 QQ/微信 bot 渠道配置' };
  }

  const eventDate = new Date(eventTime);
  const multiplier = offsetUnit === 'days' ? 24 * 60 * 60 * 1000 : offsetUnit === 'hours' ? 60 * 60 * 1000 : 60 * 1000;
  const triggerTime = new Date(eventDate.getTime() - offset * multiplier).toISOString();

  const created = [];
  for (const channel of enabledChannels) {
    const cronName = `ustc-claw-calendar-${eventId}-${stageId}-${channel.type}`;
    const result = createCronJob(
      cronName,
      { kind: 'at', at: triggerTime },
      createReminderPrompt(event, offset, offsetUnit, channel.type),
      channel
    );

    if (result.success) {
      created.push({
        channel: channel.channel,
        cronJobId: result.cronJobId,
        to: channel.to
      });
    }
  }

  if (created.length === 0) {
    return { success: false, error: '未成功创建提醒 Cron 任务' };
  }

  return {
    success: true,
    triggerTime,
    channels: created
  };
}

function updateReminderCrons(eventId, newEventTime) {
  const { getPlanById, savePlan } = require('./file-ops.js');
  const event = getPlanById(eventId);
  if (!event) {
    return { success: false, error: '事件不存在' };
  }

  const deleted = deleteReminderCrons(eventId);
  const createdCronIds = [];

  for (const stage of event.reminderStages || []) {
    const result = createReminderCron({
      eventId,
      stageId: stage.id,
      event,
      eventTime: newEventTime,
      offset: stage.offset,
      offsetUnit: stage.offsetUnit || 'minutes'
    });

    if (result.success) {
      stage.cronJobIds = result.channels.map((channel) => channel.cronJobId);
      stage.triggerTime = result.triggerTime;
      createdCronIds.push(...stage.cronJobIds);
    }
  }

  savePlan(event);

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
  parseCronList
};
