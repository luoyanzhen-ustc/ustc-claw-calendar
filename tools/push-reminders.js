#!/usr/bin/env node

const fs = require('fs');
const { getPlansFile, readSettings } = require('./file-ops.js');
const { syncChannels, getEffectiveUserChannelConfig, buildWeixinAccountName, buildQQTarget } = require('./channel-sync.js');

function getUserChannelConfig(options = {}) {
  return getEffectiveUserChannelConfig(options);
}

function formatReminderMessage(event, stageMessage) {
  const date = event.schedule?.displayDate || event.schedule?.date || '未设置日期';
  const time = event.schedule?.displayTime || event.schedule?.startTime || '未设置时间';
  const location = event.location ? `\n地点：${event.location}` : '';
  const note = stageMessage ? `\n提醒：${stageMessage}` : '';
  return `提醒：${event.title}\n时间：${date} ${time}${location}${note}`;
}

function pushToQQ(event, stageMessage, callMessage) {
  const user = getUserChannelConfig();
  if (!user?.qq?.enabled || !user.qq.openid) {
    return { success: false, reason: 'not_configured' };
  }

  return callMessage({
    action: 'send',
    channel: 'qqbot',
    target: buildQQTarget(user.qq.openid),
    message: formatReminderMessage(event, stageMessage)
  });
}

function pushToWeChat(event, stageMessage, callMessage) {
  const user = getUserChannelConfig();
  if (!user?.weixin?.enabled || !user.weixin.userId) {
    return { success: false, reason: 'not_configured' };
  }

  const payload = {
    action: 'send',
    channel: 'openclaw-weixin',
    target: user.weixin.userId,
    message: formatReminderMessage(event, stageMessage)
  };

  const account = buildWeixinAccountName(user.weixin.accountId);
  if (account) {
    payload.account = account;
  }

  return callMessage(payload);
}

function pushToWeb(event, stageMessage) {
  console.log(formatReminderMessage(event, stageMessage));
  return { success: true, channel: 'webchat' };
}

function pushReminder({ eventId, stageId, callMessage }) {
  syncChannels();

  const plansFile = getPlansFile();
  if (!fs.existsSync(plansFile)) {
    return { success: false, error: 'plans.json 不存在' };
  }

  const data = JSON.parse(fs.readFileSync(plansFile, 'utf8'));
  const event = data.plans.find((plan) => plan.id === eventId);
  if (!event) {
    return { success: false, error: '事件不存在' };
  }

  const stage = (event.reminderStages || []).find((item) => item.id === stageId);
  if (!stage) {
    return { success: false, error: '提醒阶段不存在' };
  }

  const settings = readSettings();
  const channels = Array.isArray(settings.notify?.channels) ? settings.notify.channels : ['qq', 'wechat'];
  const results = {};

  for (const channel of channels) {
    if (channel === 'qq') {
      results.qq = pushToQQ(event, stage.message, callMessage);
    } else if (channel === 'wechat') {
      results.wechat = pushToWeChat(event, stage.message, callMessage);
    } else if (channel === 'webchat' || channel === 'current') {
      results.webchat = pushToWeb(event, stage.message);
    }
  }

  stage.pushedChannels = {
    ...(stage.pushedChannels || {}),
    ...Object.fromEntries(
      Object.entries(results).map(([channel, result]) => [
        channel,
        {
          pushedAt: result.success ? new Date().toISOString() : null,
          status: result.success ? 'delivered' : 'failed',
          error: result.success ? null : result.reason || result.error || 'push_failed'
        }
      ])
    )
  };

  data.metadata = {
    ...(data.metadata || {}),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(plansFile, JSON.stringify(data, null, 2), 'utf8');

  return {
    success: Object.values(results).some((result) => result.success),
    results
  };
}

function testPush(callMessage) {
  const event = {
    title: '测试提醒',
    schedule: {
      displayDate: '2026-03-01',
      displayTime: '09:00'
    }
  };

  return {
    qq: pushToQQ(event, '这是一条测试提醒。', callMessage),
    wechat: pushToWeChat(event, '这是一条测试提醒。', callMessage)
  };
}

module.exports = {
  getUserChannelConfig,
  formatReminderMessage,
  pushToQQ,
  pushToWeChat,
  pushToWeb,
  pushReminder,
  testPush
};
