/* ============================================================
 * 词流 WordFlow — 间隔重复调度（SRS）
 * 改良 SM-2：新词有「学习步」，毕业进入天级间隔；
 * 忘记会衰减难度因子并回炉，回答质量越高间隔涨得越快。
 * 全局对象：SRS
 * ============================================================ */
(function (global) {
  'use strict';

  var DAY = 86400000;
  var MIN = 60000;
  var DAY_START_HOUR = 4; // 凌晨 4 点算新的一天，熬夜学习不断打卡

  var EASE_MIN = 1.3;
  var EASE_MAX = 3.2;
  var EASE_START = 2.5;
  var IVL_MAX = 3650;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** 学习日的起点时间戳（当天 4:00；若尚未到 4:00 则算前一天） */
  function dayStart(ts) {
    if (ts === undefined || ts === null) ts = Date.now();
    var d = new Date(ts);
    d.setHours(DAY_START_HOUR, 0, 0, 0);
    if (d.getTime() > ts) d.setDate(d.getDate() - 1);
    return d.getTime();
  }

  /** 学习日 key：YYYY-MM-DD */
  function dayKey(ts) {
    if (ts === undefined || ts === null) ts = Date.now();
    var d = new Date(ts - DAY_START_HOUR * 3600000);
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  function addDaysKey(key, n) {
    var p = key.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  /** 新卡片的初始记忆状态 */
  function init(card) {
    if (!card) return card;
    if (!card.st) card.st = 'new';
    if (typeof card.due !== 'number') card.due = 0;
    if (typeof card.ivl !== 'number') card.ivl = 0;
    if (typeof card.ease !== 'number') card.ease = EASE_START;
    if (typeof card.reps !== 'number') card.reps = 0;
    if (typeof card.lapses !== 'number') card.lapses = 0;
    return card;
  }

  function isLearning(c) { return c.st === 'new' || c.st === 'learning' || c.st === 'relearn'; }

  /**
   * 应用一次评分
   * @param {object} c 单词卡（会被就地修改）
   * @param {number} g 0=忘记 1=模糊 2=认识 3=简单
   * @param {number} [now]
   * @returns {{card:object, ivlDays:number, nextDue:number}}
   */
  function rate(c, g, now) {
    init(c);
    now = now || Date.now();
    if (!c.first) c.first = now;
    c.last = now;
    c.reps = (c.reps || 0) + 1;

    if (isLearning(c)) {
      var relearn = c.st === 'relearn';
      if (g === 0) {
        c.st = relearn ? 'relearn' : 'learning';
        c.due = now + (relearn ? 10 : 1) * MIN;
        c.ivl = 0;
      } else if (g === 1) {
        c.st = relearn ? 'relearn' : 'learning';
        c.due = now + (relearn ? 15 : 6) * MIN;
        c.ivl = 0;
      } else if (g === 2) {
        c.ivl = relearn ? Math.max(1, Math.round((c.ivl || 1) * 0.5)) : 1;
        graduate(c, now);
      } else {
        c.ivl = relearn ? Math.max(1, Math.round((c.ivl || 1) * 0.7)) : 4;
        graduate(c, now);
      }
      return { card: c, ivlDays: c.ivl, nextDue: c.due };
    }

    // —— 复习阶段 ——
    if (g === 0) {
      c.lapses = (c.lapses || 0) + 1;
      c.ease = clamp(c.ease - 0.2, EASE_MIN, EASE_MAX);
      c.ivl = Math.max(1, Math.round((c.ivl || 1) * 0.3));
      c.st = 'relearn';
      c.due = now + 10 * MIN;
      return { card: c, ivlDays: 0, nextDue: c.due };
    }
    if (g === 1) {
      c.ease = clamp(c.ease - 0.15, EASE_MIN, EASE_MAX);
      c.ivl = Math.max(1, Math.round((c.ivl || 1) * 1.15));
    } else if (g === 2) {
      c.ivl = Math.max(1, Math.round((c.ivl || 1) * c.ease));
    } else {
      c.ease = clamp(c.ease + 0.1, EASE_MIN, EASE_MAX);
      c.ivl = Math.max(1, Math.round((c.ivl || 1) * c.ease * 1.35));
    }
    c.ivl = clamp(c.ivl, 1, IVL_MAX);
    c.st = 'review';
    c.due = dayStart(now) + c.ivl * DAY;
    return { card: c, ivlDays: c.ivl, nextDue: c.due };
  }

  function graduate(c, now) {
    c.ivl = clamp(c.ivl, 1, IVL_MAX);
    c.st = 'review';
    c.due = dayStart(now) + c.ivl * DAY;
  }

  /** 不改动原卡片的评分预览，返回 {ivlDays, nextDue, label} */
  function preview(c, g, now) {
    var copy = {};
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k];
    var r = rate(copy, g, now || Date.now());
    return { ivlDays: r.ivlDays, nextDue: r.nextDue, label: formatInterval(r.nextDue - (now || Date.now())) };
  }

  /** 把毫秒差格式化成「1 分钟 / 6 分钟 / 2 天 / 3 月」 */
  function formatInterval(ms) {
    if (ms < 0) ms = 0;
    var m = Math.round(ms / MIN);
    if (m < 1) return '马上';
    if (m < 60) return m + ' 分钟';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' 小时';
    var d = Math.round(ms / DAY);
    if (d < 31) return d + ' 天';
    var mo = Math.round(d / 30);
    if (mo < 12) return mo + ' 个月';
    return (d / 365).toFixed(1) + ' 年';
  }

  function isDue(c, now) {
    init(c);
    return c.st !== 'new' && c.due <= (now || Date.now());
  }

  /** 卡片归类，用于列表/统计展示 */
  function statusOf(c) {
    init(c);
    if (c.st === 'new') return 'new';
    if (c.st === 'learning' || c.st === 'relearn') return 'learning';
    if ((c.ivl || 0) >= 21) return 'mastered';
    return 'review';
  }

  /** 词库总体统计 + 今日待办 */
  function counts(cards, now) {
    now = now || Date.now();
    var out = { total: cards.length, new: 0, learning: 0, review: 0, mastered: 0, due: 0, dueLearning: 0 };
    for (var i = 0; i < cards.length; i++) {
      var c = init(cards[i]);
      var s = statusOf(c);
      out[s]++;
      if (c.st !== 'new' && c.due <= now) {
        out.due++;
        if (s === 'learning') out.dueLearning++;
      }
    }
    return out;
  }

  /** 未来 n 天（含今天）每天到期数量 */
  function forecast(cards, days, now) {
    now = now || Date.now();
    var start = dayStart(now);
    var out = [];
    for (var i = 0; i < days; i++) out.push({ day: addDaysKey(dayKey(now), i), count: 0 });
    for (var j = 0; j < cards.length; j++) {
      var c = init(cards[j]);
      if (c.st === 'new') continue;
      var dueDay = dayStart(c.due);
      var idx = Math.round((dueDay - start) / DAY);
      if (idx < 0) idx = 0;
      if (idx < days) out[idx].count++;
    }
    return out;
  }

  var SRS = {
    DAY: DAY, MIN: MIN,
    dayStart: dayStart, dayKey: dayKey, addDaysKey: addDaysKey,
    init: init, rate: rate, preview: preview, isDue: isDue,
    statusOf: statusOf, counts: counts, forecast: forecast,
    formatInterval: formatInterval, isLearning: isLearning
  };

  global.SRS = SRS;
  if (typeof module !== 'undefined' && module.exports) module.exports = SRS;
})(typeof window !== 'undefined' ? window : globalThis);