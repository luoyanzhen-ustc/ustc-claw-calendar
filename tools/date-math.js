#!/usr/bin/env node

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const BEIJING_OFFSET = '+08:00';

function getCurrentWeek(semesterStart) {
  if (!semesterStart) {
    return null;
  }

  const today = new Date();
  const start = new Date(`${semesterStart}T00:00:00${BEIJING_OFFSET}`);
  const todayBeijing = new Date(today.toLocaleString('en-US', { timeZone: DEFAULT_TIMEZONE }));
  todayBeijing.setHours(0, 0, 0, 0);

  const diffMs = todayBeijing.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays < 0) {
    return 0;
  }

  return Math.floor(diffDays / 7) + 1;
}

function parseRelativeTime(text, baseDate = new Date()) {
  const result = new Date(baseDate);
  result.setHours(0, 0, 0, 0);

  if (/后天/.test(text)) {
    result.setDate(result.getDate() + 2);
  } else if (/明天|明晚/.test(text)) {
    result.setDate(result.getDate() + 1);
  } else if (/大后天/.test(text)) {
    result.setDate(result.getDate() + 3);
  } else if (/前天/.test(text)) {
    result.setDate(result.getDate() - 2);
  }

  const weekdayMatch = text.match(/(?:周|星期)([一二三四五六日天0-6])/);
  if (weekdayMatch) {
    const weekdayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
    const target = weekdayMap[weekdayMatch[1]];
    const current = result.getDay();
    let diff = target - current;

    if (/下周/.test(text)) {
      diff += 7;
    } else if (diff <= 0 && !/这周|本周/.test(text)) {
      diff += 7;
    }

    result.setDate(result.getDate() + diff);
  }

  let hour = null;
  let minute = 0;
  const timeMatch = text.match(/(\d{1,2})(?:[:：点](\d{1,2})?)?/);
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
  }

  if (hour === null) {
    if (/早上/.test(text)) {
      hour = 8;
    } else if (/上午/.test(text)) {
      hour = 9;
    } else if (/中午/.test(text)) {
      hour = 12;
    } else if (/下午/.test(text)) {
      hour = 15;
    } else if (/晚上|今晚|明晚/.test(text)) {
      hour = 19;
    } else {
      hour = 9;
    }
  }

  if ((/下午|晚上|今晚|明晚/.test(text)) && hour < 12) {
    hour += 12;
  }

  result.setHours(hour, minute, 0, 0);
  return result;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getWeekdayName(date) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
}

function parseWeekRanges(weeksStr) {
  if (!weeksStr) {
    return [];
  }

  return weeksStr
    .replace(/周/g, '')
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const rangeMatch = part.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (rangeMatch) {
        return [[Number(rangeMatch[1]), Number(rangeMatch[2])]];
      }

      const single = Number(part);
      return Number.isFinite(single) ? [[single, single]] : [];
    });
}

function isWithinWeekRanges(date, semesterStart, weekRanges) {
  if (!semesterStart || !Array.isArray(weekRanges) || weekRanges.length === 0) {
    return true;
  }

  const currentWeek = getCurrentWeek(semesterStart);
  if (!currentWeek) {
    return false;
  }

  return weekRanges.some(([start, end]) => currentWeek >= start && currentWeek <= end);
}

function daysBetween(date1, date2) {
  const start = new Date(date1);
  const end = new Date(date2);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

module.exports = {
  DEFAULT_TIMEZONE,
  getCurrentWeek,
  parseRelativeTime,
  formatDate,
  formatTime,
  getWeekdayName,
  parseWeekRanges,
  isWithinWeekRanges,
  daysBetween
};
