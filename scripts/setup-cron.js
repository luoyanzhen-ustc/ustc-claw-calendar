#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const { getWorkspace } = require('../tools/path-utils.js');

const WORKSPACE = getWorkspace();
const CALENDAR_DIR = path.join(WORKSPACE, 'ustc-claw-calendar');

function exec(command) {
  try {
    const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    return { success: true, output };
  } catch (error) {
    return { success: false, error: error.message, output: error.stdout || '' };
  }
}

function setupCronJobs() {
  const jobs = [
    {
      name: 'ustc-claw-calendar-daily',
      schedule: '0 2 * * *',
      description: 'daily indexes refresh',
      message:
        '执行 USTC Claw Calendar 的每日维护任务：重建 today、this-week、upcoming 三个索引，并汇报结果。完成后回复 HEARTBEAT_OK。'
    },
    {
      name: 'ustc-claw-calendar-weekly',
      schedule: '0 0 * * 1',
      description: 'weekly report and archive snapshot',
      message:
        '执行 USTC Claw Calendar 的每周维护任务：重建索引、生成上周周报，并写入上周 raw 快照归档。完成后回复 HEARTBEAT_OK。'
    }
  ];

  const results = [];

  for (const job of jobs) {
    const checkResult = exec(`openclaw cron list --name '${job.name}'`);
    if (checkResult.output && checkResult.output.includes(job.name)) {
      results.push({ name: job.name, status: 'exists' });
      continue;
    }

    const createCommand = `openclaw cron add --schedule '${job.schedule}' --name '${job.name}' --payload '{"kind":"agentTurn","message":"${job.message}"}'`;
    const createResult = exec(createCommand);
    results.push({
      name: job.name,
      status: createResult.success ? 'created' : 'failed',
      error: createResult.error || null
    });
  }

  return results;
}

function verifyCronJobs() {
  return exec('openclaw cron list');
}

function main() {
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Calendar dir: ${CALENDAR_DIR}`);
  const results = setupCronJobs();
  const failed = results.filter((result) => result.status === 'failed');

  if (failed.length > 0) {
    console.log('存在未创建成功的 Cron 任务:');
    failed.forEach((item) => console.log(`- ${item.name}: ${item.error}`));
    process.exitCode = 1;
  }

  return results;
}

if (require.main === module) {
  main();
}

module.exports = {
  WORKSPACE,
  CALENDAR_DIR,
  exec,
  setupCronJobs,
  verifyCronJobs,
  main
};
