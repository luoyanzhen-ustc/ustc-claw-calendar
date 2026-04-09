#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  readPlans,
  writePlans,
  readMetadata,
  getArchiveDir,
  getActiveDir
} = require('./file-ops.js');

function groupBy(items, key) {
  return (items || []).reduce((accumulator, item) => {
    const value = item[key] || 'unknown';
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
}

function getWeekRange(weekNumber, metadata) {
  return metadata.weekMapping?.[`week${weekNumber}`] || null;
}

function getLifecycleStatus(item) {
  return item.lifecycle?.status || item.status || 'active';
}

function extractHighlights(events) {
  return (events || [])
    .filter((event) => getLifecycleStatus(event) === 'completed')
    .slice(0, 5)
    .map((event) => `完成：${event.title}`);
}

function generateWeeklyReport(weekNumber) {
  const metadata = readMetadata();
  const weekRange = getWeekRange(weekNumber, metadata);
  if (!weekRange) {
    return null;
  }

  const plans = readPlans().plans.filter((plan) => {
    const date = plan.schedule?.displayDate || plan.schedule?.date;
    return date >= weekRange.start && date <= weekRange.end;
  });

  const stats = {
    totalEvents: plans.length,
    totalPlans: plans.length,
    byType: groupBy(plans, 'type'),
    byStatus: plans.reduce((accumulator, plan) => {
      const status = getLifecycleStatus(plan);
      accumulator[status] = (accumulator[status] || 0) + 1;
      return accumulator;
    }, {}),
    completed: plans.filter((plan) => getLifecycleStatus(plan) === 'completed').length,
    cancelled: plans.filter((plan) => getLifecycleStatus(plan) === 'cancelled').length,
    expired: plans.filter((plan) => getLifecycleStatus(plan) === 'expired').length,
    active: plans.filter((plan) => getLifecycleStatus(plan) === 'active').length
  };

  stats.completionRate = stats.totalPlans > 0 ? stats.completed / stats.totalPlans : 0;

  return {
    week: weekNumber,
    period: `${weekRange.start} ~ ${weekRange.end}`,
    semester: metadata.semester,
    stats,
    events: plans,
    highlights: extractHighlights(plans),
    generatedAt: new Date().toISOString()
  };
}

function archiveLastWeekPlans() {
  const metadata = readMetadata();
  const lastWeek = (metadata.currentWeek || 1) - 1;
  if (lastWeek < 1) {
    return true;
  }

  const weekRange = getWeekRange(lastWeek, metadata);
  if (!weekRange) {
    return false;
  }

  const plansData = readPlans();
  const archivedPlans = plansData.plans.filter((plan) => {
    const date = plan.schedule?.displayDate || plan.schedule?.date;
    return date >= weekRange.start && date <= weekRange.end;
  });

  if (archivedPlans.length === 0) {
    return true;
  }

  const archiveDir = path.join(getArchiveDir(metadata.semester), 'plans');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, `week-${lastWeek}.json`),
    JSON.stringify(
      {
        week: lastWeek,
        period: weekRange,
        plans: archivedPlans,
        archivedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );

  plansData.plans = plansData.plans.filter((plan) => {
    const date = plan.schedule?.displayDate || plan.schedule?.date;
    return !(date >= weekRange.start && date <= weekRange.end);
  });

  return writePlans(plansData);
}

function archiveSemester(semesterName = null) {
  const metadata = readMetadata();
  const semester = semesterName || metadata.semester;
  const archiveDir = getArchiveDir(semester);
  fs.mkdirSync(archiveDir, { recursive: true });

  for (const fileName of ['courses.json', 'recurring.json', 'plans.json']) {
    const source = path.join(getActiveDir(), fileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(archiveDir, fileName));
    }
  }

  return generateSemesterSummary(semester);
}

function generateSemesterSummary(semester) {
  const archiveDir = getArchiveDir(semester);
  const plansFile = path.join(archiveDir, 'plans.json');
  const plans = fs.existsSync(plansFile) ? JSON.parse(fs.readFileSync(plansFile, 'utf8')).plans || [] : [];

  const summary = {
    semester,
    totalPlans: plans.length,
    completed: plans.filter((plan) => getLifecycleStatus(plan) === 'completed').length,
    cancelled: plans.filter((plan) => getLifecycleStatus(plan) === 'cancelled').length,
    expired: plans.filter((plan) => getLifecycleStatus(plan) === 'expired').length,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(archiveDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}

module.exports = {
  generateWeeklyReport,
  archiveLastWeekPlans,
  archiveSemester,
  generateSemesterSummary
};
