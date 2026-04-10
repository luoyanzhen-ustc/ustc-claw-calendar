#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  readJsonFile,
  readKnownUsers,
  writeKnownUsers,
  normalizeKnownUsers
} = require('./file-ops.js');
const {
  getKnownUsersPath,
  getOpenClawHome,
  getOpenClawConfigFile,
  getOpenClawQQKnownUsersFile,
  getOpenClawWeixinAccountsDir
} = require('./path-utils.js');

function normalizeWeixinAccountId(value) {
  if (!value) {
    return null;
  }

  return String(value).replace(/-im-bot(?:\.json)?$/, '');
}

function buildWeixinAccountName(accountId) {
  const normalized = normalizeWeixinAccountId(accountId);
  return normalized ? `${normalized}-im-bot` : null;
}

function buildQQTarget(openid) {
  return openid ? `qqbot:c2c:${openid}` : null;
}

function buildWeixinTarget(userId) {
  return userId || null;
}

function resolvePathFromOpenClawHome(inputPath, openClawHome = getOpenClawHome()) {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }

  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  if (inputPath.startsWith('~/')) {
    return path.join(require('os').homedir(), inputPath.slice(2));
  }

  return path.resolve(openClawHome, inputPath);
}

function collectStrings(node, collector = []) {
  if (typeof node === 'string') {
    collector.push(node);
    return collector;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectStrings(item, collector));
    return collector;
  }

  if (node && typeof node === 'object') {
    Object.values(node).forEach((value) => collectStrings(value, collector));
  }

  return collector;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function resolveOpenClawPaths() {
  const openClawHome = getOpenClawHome();
  const configFile = getOpenClawConfigFile();
  const config = readJsonFile(configFile, {});
  const rawStrings = collectStrings(config);

  const qqKnownUsersCandidates = uniqueStrings([
    getOpenClawQQKnownUsersFile(),
    ...rawStrings
      .filter((value) => /qqbot[\\/].*known-users\.json$/i.test(value))
      .map((value) => resolvePathFromOpenClawHome(value, openClawHome))
  ]);

  const weixinAccountsDirCandidates = uniqueStrings([
    getOpenClawWeixinAccountsDir(),
    ...rawStrings
      .filter((value) => /openclaw-weixin[\\/].*accounts/i.test(value))
      .map((value) => {
        const resolved = resolvePathFromOpenClawHome(value, openClawHome);
        return resolved && resolved.endsWith('.json') ? path.dirname(resolved) : resolved;
      })
  ]);

  return {
    openClawHome,
    configFile,
    qqKnownUsersCandidates,
    weixinAccountsDirCandidates
  };
}

function readFirstExistingJson(paths) {
  for (const filePath of paths || []) {
    if (filePath && fs.existsSync(filePath)) {
      return {
        filePath,
        data: readJsonFile(filePath, null)
      };
    }
  }

  return {
    filePath: null,
    data: null
  };
}

function findExistingDir(paths) {
  for (const dirPath of paths || []) {
    if (dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      return dirPath;
    }
  }

  return null;
}

function extractQqUsers(rawData) {
  const normalizedUsers = normalizeKnownUsers(rawData);
  if (normalizedUsers.length > 0) {
    const qqUsers = normalizedUsers
      .filter((user) => user.qq?.openid)
      .map((user) => ({
        name: user.name || 'default',
        qq: {
          openid: user.qq.openid,
          enabled: true
        },
        weixin: {
          userId: null,
          accountId: null,
          enabled: false
        }
      }));

    if (qqUsers.length > 0) {
      return qqUsers;
    }
  }

  const values = collectStrings(rawData).filter((value) => /^[A-F0-9]{32}$/i.test(value));
  return uniqueStrings(values).map((openid, index) => ({
    name: `qq-${index + 1}`,
    qq: {
      openid,
      enabled: true
    },
    weixin: {
      userId: null,
      accountId: null,
      enabled: false
    }
  }));
}

function extractWeixinUserIds(rawData) {
  return uniqueStrings(
    collectStrings(rawData).filter((value) => typeof value === 'string' && /@im\.wechat$/i.test(value))
  );
}

function extractWeixinUsers(accountsDir) {
  if (!accountsDir || !fs.existsSync(accountsDir)) {
    return [];
  }

  const files = fs.readdirSync(accountsDir)
    .filter((fileName) => /-im-bot\.json$/i.test(fileName))
    .map((fileName) => path.join(accountsDir, fileName));

  const users = [];

  for (const filePath of files) {
    const rawData = readJsonFile(filePath, null);
    if (!rawData) {
      continue;
    }

    const fileName = path.basename(filePath, '.json');
    const accountId = normalizeWeixinAccountId(fileName);
    const userIds = extractWeixinUserIds(rawData);

    for (const userId of userIds) {
      users.push({
        name: userId,
        qq: {
          openid: null,
          enabled: false
        },
        weixin: {
          userId,
          accountId,
          enabled: true
        }
      });
    }
  }

  return users.filter((user, index, array) => {
    return array.findIndex((item) => {
      return item.weixin.userId === user.weixin.userId && item.weixin.accountId === user.weixin.accountId;
    }) === index;
  });
}

function mergeDiscoveredUsers(qqUsers = [], weixinUsers = []) {
  if (qqUsers.length === 1 && weixinUsers.length === 1) {
    return [
      {
        name: qqUsers[0].name !== 'default' ? qqUsers[0].name : weixinUsers[0].name || 'default',
        qq: qqUsers[0].qq,
        weixin: weixinUsers[0].weixin
      }
    ];
  }

  const merged = [];
  const usedWeixinIndexes = new Set();

  qqUsers.forEach((qqUser) => {
    const matchedIndex = weixinUsers.findIndex((weixinUser, index) => {
      return !usedWeixinIndexes.has(index) && weixinUser.name && qqUser.name && weixinUser.name === qqUser.name;
    });

    if (matchedIndex >= 0) {
      usedWeixinIndexes.add(matchedIndex);
      merged.push({
        name: qqUser.name || weixinUsers[matchedIndex].name || 'default',
        qq: qqUser.qq,
        weixin: weixinUsers[matchedIndex].weixin
      });
      return;
    }

    merged.push(qqUser);
  });

  weixinUsers.forEach((weixinUser, index) => {
    if (!usedWeixinIndexes.has(index)) {
      merged.push(weixinUser);
    }
  });

  return merged;
}

function summarizeUsers(users) {
  const normalizedUsers = normalizeKnownUsers(users);
  const qqCount = normalizedUsers.filter((user) => user.qq?.enabled && user.qq?.openid).length;
  const wechatCount = normalizedUsers.filter((user) => user.weixin?.enabled && user.weixin?.userId).length;

  return {
    users: normalizedUsers,
    userCount: normalizedUsers.length,
    qqCount,
    wechatCount,
    hasAnyChannel: qqCount > 0 || wechatCount > 0
  };
}

function syncChannels(options = {}) {
  const runtimeUsers = options.runtimeUsers || null;
  const resolvedPaths = resolveOpenClawPaths();
  const qqSource = readFirstExistingJson(resolvedPaths.qqKnownUsersCandidates);
  const weixinAccountsDir = findExistingDir(resolvedPaths.weixinAccountsDirCandidates);

  const qqUsers = qqSource.data ? extractQqUsers(qqSource.data) : [];
  const weixinUsers = extractWeixinUsers(weixinAccountsDir);
  const discoveredUsers = mergeDiscoveredUsers(qqUsers, weixinUsers);

  let source = 'none';
  let synced = false;

  if (discoveredUsers.length > 0) {
    writeKnownUsers({
      users: discoveredUsers,
      metadata: {
        source: 'openclaw-system',
        lastSyncedAt: new Date().toISOString(),
        qqKnownUsersFile: qqSource.filePath,
        weixinAccountsDir
      }
    });
    source = 'openclaw-system';
    synced = true;
  } else if (runtimeUsers) {
    writeKnownUsers({
      users: runtimeUsers,
      metadata: {
        source: 'runtime-channel',
        lastSyncedAt: new Date().toISOString()
      }
    });
    source = 'runtime-channel';
    synced = true;
  } else {
    const cachedUsers = normalizeKnownUsers(readKnownUsers());
    if (cachedUsers.length > 0) {
      source = 'cache';
    } else {
      writeKnownUsers({
        users: [],
        metadata: {
          source: 'default',
          lastSyncedAt: new Date().toISOString()
        }
      });
    }
  }

  const summary = summarizeUsers(readKnownUsers());

  return {
    success: true,
    synced,
    source,
    cachePath: getKnownUsersPath(),
    openClawHome: resolvedPaths.openClawHome,
    qqKnownUsersFile: qqSource.filePath,
    weixinAccountsDir,
    sourcesTried: {
      configFile: resolvedPaths.configFile,
      qqKnownUsersCandidates: resolvedPaths.qqKnownUsersCandidates,
      weixinAccountsDirCandidates: resolvedPaths.weixinAccountsDirCandidates
    },
    ...summary
  };
}

function getEffectiveUserChannelConfig(options = {}) {
  if (options.refresh !== false) {
    syncChannels(options);
  }

  const users = normalizeKnownUsers(readKnownUsers());
  return users[0] || null;
}

module.exports = {
  normalizeWeixinAccountId,
  buildWeixinAccountName,
  buildQQTarget,
  buildWeixinTarget,
  resolveOpenClawPaths,
  extractQqUsers,
  extractWeixinUsers,
  mergeDiscoveredUsers,
  syncChannels,
  getEffectiveUserChannelConfig
};
