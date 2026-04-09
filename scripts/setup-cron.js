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
      description: '每日索引重建',
      message: '执行每日索引重建任务。调用 calendar_build_today_index、calendar_build_upcoming_index 和 calendar_cleanup_expired。完成后回复 HEARTBEAT_OK。'
    },
    {
      name: 'ustc-claw-calendar-weekly',
      schedule: '0 0 * * 1',
      description: '每周总结归档',
      message: '执行每周总结归档任务。调用 calendar_archive_last_week 和 calendar_generate_weekly_report。完成后回复 HEARTBEAT_OK。'
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
