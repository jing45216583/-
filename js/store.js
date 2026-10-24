/* ============================================================
 * 词流 WordFlow — 数据层（localStorage）
 * 全局对象：Store
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'wordflow.v1';
  var SRS = global.SRS;

  var DEFAULTS = {
    newPerDay: 20,
    reviewPerDay: 150,
    autoSpeak: true,
    accent: 'en-US',
    rate: 0.9,
    theme: 'auto',
    showExample: true
  };

  function uid(p) {
    return (p || 'c') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var Store = {
    data: null,
    onError: null,

    /* 本地存储是否真的可用（file:// 或隐私模式下可能被禁用 —— 那样数据只在内存里，刷新就没） */
    storageOk: true,
    probe: function () {
      try {
        var k = '__wf_probe__';
        localStorage.setItem(k, '1');
        var v = localStorage.getItem(k);
        localStorage.removeItem(k);
        this.storageOk = (v === '1');
      } catch (e) {
        this.storageOk = false;
      }
      return this.storageOk;
    },

    load: function () {
      this.probe();
      var raw = null;
      try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
      var d = null;
      if (raw) {
        try { d = JSON.parse(raw); } catch (e) { d = null; }
      }
      if (!d || typeof d !== 'object') d = this.fresh();
      this.data = this.migrate(d);
      return this.data;
    },

    fresh: function () {
      var d = {
        v: 1,
        createdAt: Date.now(),
        activeBookId: null,
        books: [],
        settings: clone(DEFAULTS),
        stats: { daily: {} },
        session: null
      };
      return d;
    },

    migrate: function (d) {
      d.v = d.v || 1;
      d.books = Array.isArray(d.books) ? d.books : [];
      d.settings = Object.assign({}, DEFAULTS, d.settings || {});
      d.stats = d.stats && typeof d.stats === 'object' ? d.stats : { daily: {} };
      d.stats.daily = d.stats.daily && typeof d.stats.daily === 'object' ? d.stats.daily : {};
      d.books.forEach(function (b) {
        b.id = b.id || uid('b');
        b.name = b.name || '未命名词库';
        b.cards = Array.isArray(b.cards) ? b.cards : [];
        b.cards.forEach(function (c) {
          c.id = c.id || uid();
          SRS.init(c);
        });
      });
      if (!d.activeBookId || !d.books.some(function (b) { return b.id === d.activeBookId; })) {
        d.activeBookId = d.books.length ? d.books[0].id : null;
      }
      return d;
    },

    /* ---------------- 保存 ---------------- */
    _timer: null,
    save: function () {
      var self = this;
      if (this._timer) return;
      this._timer = setTimeout(function () {
        self._timer = null;
        self.flush();
      }, 350);
    },
    flush: function () {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch (e) {
        if (typeof this.onError === 'function') this.onError(e);
      }
    },

    /* ---------------- 词库 ---------------- */
    books: function () { return this.data.books; },
    getBook: function (id) {
      var bs = this.data.books;
      for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i];
      return null;
    },
    activeBook: function () { return this.getBook(this.data.activeBookId) || this.data.books[0] || null; },
    setActive: function (id) {
      if (!this.getBook(id)) return;
      this.data.activeBookId = id;
      this.data.session = null; // 换词库时结束旧会话
      this.save();
    },

    cardFrom: function (obj) {
      var c = {
        id: uid(),
        word: String(obj.word || '').trim(),
        phonetic: String(obj.phonetic || '').trim(),
        meaning: String(obj.meaning || '').trim(),
        example: String(obj.example || '').trim(),
        exampleCn: String(obj.exampleCn || '').trim(),
        tags: String(obj.tags || '').trim(),
        st: 'new', due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0,
        first: 0, last: 0
      };
      return c;
    },

    addBook: function (name, cards) {
      var book = {
        id: uid('b'),
        name: String(name || '新词库').trim() || '新词库',
        createdAt: Date.now(),
        cards: (cards || []).map(this.cardFrom.bind(this))
      };
      this.data.books.push(book);
      if (!this.data.activeBookId) this.data.activeBookId = book.id;
      this.save();
      return book;
    },

    appendCards: function (bookId, cards) {
      var book = this.getBook(bookId);
      if (!book) return { added: 0, dupes: 0 };
      var seen = Object.create(null);
      book.cards.forEach(function (c) { seen[String(c.word).trim().toLowerCase()] = 1; });
      var added = 0, dupes = 0;
      for (var i = 0; i < cards.length; i++) {
        var k = String(cards[i].word || '').trim().toLowerCase();
        if (!k) continue;
        if (seen[k]) { dupes++; continue; }
        seen[k] = 1;
        book.cards.push(this.cardFrom(cards[i]));
        added++;
      }
      this.save();
      return { added: added, dupes: dupes };
    },

    renameBook: function (id, name) {
      var b = this.getBook(id);
      if (!b) return;
      b.name = String(name || '').trim() || b.name;
      this.save();
    },

    deleteBook: function (id) {
      this.data.books = this.data.books.filter(function (b) { return b.id !== id; });
      if (this.data.activeBookId === id) {
        this.data.activeBookId = this.data.books.length ? this.data.books[0].id : null;
      }
      this.data.session = null;
      this.save();
    },

    updateCard: function (bookId, cid, patch) {
      var book = this.getBook(bookId);
      if (!book) return null;
      for (var i = 0; i < book.cards.length; i++) {
        if (book.cards[i].id === cid) {
          Object.assign(book.cards[i], patch);
          this.save();
          return book.cards[i];
        }
      }
      return null;
    },

    removeCard: function (bookId, cid) {
      var book = this.getBook(bookId);
      if (!book) return;
      book.cards = book.cards.filter(function (c) { return c.id !== cid; });
      this.save();
    },

    resetCard: function (bookId, cid) {
      return this.updateCard(bookId, cid, { st: 'new', due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0, first: 0, last: 0 });
    },

    /* ---------------- 统计 ---------------- */
    today: function () {
      var k = SRS.dayKey();
      var daily = this.data.stats.daily;
      if (!daily[k]) daily[k] = { new: 0, rev: 0, ans: 0, correct: 0 };
      return daily[k];
    },
    dayEntry: function (k) {
      var daily = this.data.stats.daily;
      if (!daily[k]) daily[k] = { new: 0, rev: 0, ans: 0, correct: 0 };
      return daily[k];
    },
    bump: function (kind, correct) {
      var t = this.today();
      if (kind === 'new') t.new++;
      else if (kind === 'rev') t.rev++;
      t.ans++;
      if (correct) t.correct++;
      this.save();
    },
    streak: function () {
      var daily = this.data.stats.daily;
      var k = SRS.dayKey();
      var n = 0;
      // 今天没学也不断签，从昨天开始算
      if (!(daily[k] && daily[k].ans > 0)) k = SRS.addDaysKey(k, -1);
      for (var i = 0; i < 4000; i++) {
        var e = daily[k];
        if (!e || !e.ans) break;
        n++;
        k = SRS.addDaysKey(k, -1);
      }
      return n;
    },
    totals: function () {
      var daily = this.data.stats.daily;
      var days = 0, ans = 0, correct = 0, newN = 0, revN = 0;
      for (var k in daily) {
        if (!Object.prototype.hasOwnProperty.call(daily, k)) continue;
        var e = daily[k];
        if (e.ans > 0) days++;
        ans += e.ans || 0;
        correct += e.correct || 0;
        newN += e.new || 0;
        revN += e.rev || 0;
      }
      return {
        days: days, ans: ans, correct: correct, newN: newN, revN: revN,
        retention: ans ? Math.round(correct / ans * 100) : 0
      };
    },
    lastDays: function (n) {
      var out = [];
      var k = SRS.dayKey();
      for (var i = n - 1; i >= 0; i--) {
        var key = SRS.addDaysKey(k, -i);
        var e = this.data.stats.daily[key] || { new: 0, rev: 0, ans: 0, correct: 0 };
        out.push({ key: key, new: e.new || 0, rev: e.rev || 0, ans: e.ans || 0, correct: e.correct || 0 });
      }
      return out;
    },

    /* ---------------- 会话 ---------------- */
    saveSession: function (s) {
      this.data.session = s;
      this.save();
    },
    getSession: function () { return this.data.session; },
    clearSession: function () {
      this.data.session = null;
      this.save();
    },

    /* ---------------- 备份 ---------------- */
    exportJSON: function () {
      this.flush();
      return JSON.stringify({
        app: 'wordflow',
        v: 1,
        exportedAt: new Date().toISOString(),
        books: this.data.books,
        settings: this.data.settings,
        stats: this.data.stats
      });
    },
    importJSON: function (obj, mode) {
      if (!obj || !Array.isArray(obj.books)) throw new Error('备份文件格式不正确');
      var books = obj.books.map(function (b) {
        return {
          id: uid('b'),
          name: b.name || '导入词库',
          createdAt: b.createdAt || Date.now(),
          cards: (b.cards || []).map(function (c) {
            var n = Object.assign({}, c, { id: uid() });
            SRS.init(n);
            return n;
          })
        };
      });
      if (mode === 'replace') {
        this.data.books = books;
        this.data.stats = obj.stats && obj.stats.daily ? obj.stats : { daily: {} };
        this.data.settings = Object.assign({}, DEFAULTS, obj.settings || {});
        this.data.activeBookId = books.length ? books[0].id : null;
      } else {
        var exist = Object.create(null);
        this.data.books.forEach(function (b) { exist[b.name] = 1; });
        var self = this;
        books.forEach(function (b) {
          if (exist[b.name]) b.name = b.name + '（导入）';
          self.data.books.push(b);
        });
        var d = (obj.stats && obj.stats.daily) || {};
        for (var k in d) {
          if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
          var cur = this.dayEntry(k);
          cur.new += d[k].new || 0;
          cur.rev += d[k].rev || 0;
          cur.ans += d[k].ans || 0;
          cur.correct += d[k].correct || 0;
        }
      }
      this.data.session = null;
      this.flush();
      return { books: books.length };
    },
    resetAll: function () {
      this.data = this.fresh();
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      this.flush();
    },

    seedIfEmpty: function () {
      if (this.data.books.length) return false;
      var demo = global.DEMO_WORDS;
      if (!demo || !demo.length) return false;
      var book = this.addBook('示例词库 · CET-4 高频词', demo);
      this.data.activeBookId = book.id;
      this.flush();
      return true;
    }
  };

  global.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);