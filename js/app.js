/* ============================================================
 * 词流 WordFlow — 界面与学习流程
 * 依赖：SRS / Importer / Store / DEMO_WORDS
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function fmtMinutes(sec) {
    if (sec < 60) return '不到 1 分钟';
    var m = Math.round(sec / 60);
    return m + ' 分钟';
  }

  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function dateLabel() {
    var d = new Date();
    var w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + w;
  }

  /* ============================================================
   * 弹层
   * ============================================================ */
  var modalStack = [];
  function openSheet(opts) {
    var root = $('#modalRoot');
    root.classList.add('open');
    root.innerHTML =
      '<div class="modal-mask" data-close="1"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true">' +
        '<div class="sheet-head"><h2>' + esc(opts.title || '') + '</h2>' +
        '<button class="modal-x" data-close="1" aria-label="关闭">✕</button></div>' +
        '<div class="sheet-body">' + (opts.body || '') + '</div>' +
        (opts.foot ? '<div class="sheet-foot">' + opts.foot + '</div>' : '') +
      '</div>';
    modalStack.push(opts);
    root.onclick = function (e) {
      if (e.target.dataset && e.target.dataset.close) closeSheet();
    };
    if (opts.onMount) opts.onMount(root);
    return root;
  }
  function closeSheet() {
    var root = $('#modalRoot');
    root.classList.remove('open');
    root.innerHTML = '';
    var top = modalStack.pop();
    if (top && top.onClose) top.onClose();
  }

  function confirmSheet(o) {
    return new Promise(function (resolve) {
      var done = false;
      openSheet({
        title: o.title || '确认',
        body: '<p class="hint-line" style="font-size:14px;color:var(--text-2)">' + esc(o.text || '') + '</p>',
        foot: '<button class="btn btn-ghost" data-act="no">' + esc(o.cancelText || '取消') + '</button>' +
              '<button class="btn ' + (o.danger ? 'btn-ghost danger' : 'btn-primary') + '" data-act="yes">' + esc(o.okText || '确定') + '</button>',
        onMount: function (root) {
          root.onclick = function (e) {
            var act = e.target.dataset && e.target.dataset.act;
            if (e.target.dataset && e.target.dataset.close) { done = true; closeSheet(); resolve(false); return; }
            if (act === 'yes' || act === 'no') {
              done = true; closeSheet(); resolve(act === 'yes');
            }
          };
        },
        onClose: function () { if (!done) resolve(false); }
      });
    });
  }

  /* ============================================================
   * 主题
   * ============================================================ */
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resolvedTheme() {
    var p = Store.data.settings.theme || 'auto';
    if (p === 'auto') return (mq && mq.matches) ? 'dark' : 'light';
    return p;
  }
  function applyTheme() {
    var t = resolvedTheme();
    document.documentElement.dataset.theme = t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0b0e14' : '#4f46e5');
  }
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function () { applyTheme(); });
  }

  /* ============================================================
   * 发音
   * ============================================================ */
  var voices = [];
  var speakWarned = false;
  function loadVoices() {
    if (!('speechSynthesis' in window)) return [];
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    return voices;
  }
  /* 返回某语言可用语音数量（设置页用来显示“检测到几个语音”） */
  function voiceCount(lang) {
    var pre = String(lang || 'en').slice(0, 2).toLowerCase();
    return loadVoices().filter(function (v) {
      return v.lang && v.lang.toLowerCase().indexOf(pre) === 0;
    }).length;
  }
  function pickVoice(lang) {
    var list = loadVoices();
    if (!list.length) return null;
    var want = String(lang).replace('_', '-').toLowerCase();
    var pre = want.slice(0, 2);
    var norm = function (v) { return String(v.lang || '').replace('_', '-').toLowerCase(); };
    var exact = list.filter(function (v) { return norm(v) === want; });
    var loose = list.filter(function (v) { return norm(v).indexOf(pre) === 0; });
    /* 优先本地语音（localService），联网语音在断网时不出声 */
    var local = loose.filter(function (v) { return v.localService; });
    return exact.filter(function (v) { return v.localService; })[0] || exact[0] || local[0] || loose[0] || null;
  }
  function speak(text, opts) {
    if (!text) return;
    var quiet = !!(opts && opts.quiet);
    if (!('speechSynthesis' in window)) {
      if (!quiet) toast('这个浏览器不支持朗读');
      return;
    }
    var synth = window.speechSynthesis;
    var accent = Store.data.settings.accent || 'en-US';
    /* 含汉字的卡（如化学术语）改用中文语音，英文语音会把汉字读成乱码 */
    if (/[\u4e00-\u9fa5]/.test(text)) accent = 'zh-CN';
    var lang = accent;
    var phrase = text;
    function run() {
      try {
        var u = new SpeechSynthesisUtterance(phrase);
        u.lang = lang;
        u.rate = Number(Store.data.settings.rate) || 0.9;
        u.pitch = 1;
        u.volume = 1;
        var v = pickVoice(lang);
        if (v) u.voice = v;
        u.onerror = function (ev) {
          var err = (ev && ev.error) || '';
          if (err === 'canceled' || err === 'interrupted') return; /* 我们自己 cancel 的，忽略 */
          if (speakWarned || quiet) return;
          speakWarned = true;
          toast(err === 'language-unavailable' || err === 'voice-unavailable'
            ? '这台手机没有 ' + lang + ' 语音包，去系统设置里装一个中文/英文 TTS 再试'
            : '朗读失败（' + (err || '未知原因') + '），可能是系统静音或缺少语音包');
        };
        synth.speak(u);
        /* 兜底：既没在念也没排队 → 大概率静音 / 无语音包，只提示一次 */
        setTimeout(function () {
          if (speakWarned || quiet) return;
          if (!synth.speaking && !synth.pending && !synth.paused) {
            speakWarned = true;
            toast('没听到声音？检查手机侧边静音开关，或到「设置 → 发音」点试听换个语音');
          }
        }, 1000);
      } catch (e) {
        if (!speakWarned && !quiet) { speakWarned = true; toast('朗读失败：' + e.message); }
      }
    }
    try { synth.cancel(); } catch (e) { /* ignore */ }
    try { if (synth.paused) synth.resume(); } catch (e) { /* ignore */ }
    /* 部分 Android/Chrome 上 cancel() 后立刻 speak() 会被吞掉，隔一帧再放 */
    setTimeout(run, 60);
  }

  /* ============================================================
   * 路由
   * ============================================================ */
  var currentView = 'home';
  function showView(name) {
    currentView = name;
    ['home', 'books', 'stats', 'settings', 'words'].forEach(function (v) {
      var el = $('#view-' + v);
      if (el) el.hidden = (v !== name);
    });
    $$('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === name);
    });
    if (name === 'home') renderHome();
    if (name === 'books') renderBooks();
    if (name === 'stats') renderStats();
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  /* ============================================================
   * 首页
   * ============================================================ */
  function planOf(book) {
    var s = Store.data.settings;
    var today = Store.today();
    var c = SRS.counts(book.cards);
    var newLeft = Math.max(0, s.newPerDay - (today.new || 0));
    var revLeft = Math.max(0, s.reviewPerDay - (today.rev || 0));
    var newPlanned = Math.min(c.new, newLeft);
    var revPlanned = Math.min(c.due, revLeft);
    return {
      counts: c,
      doneNew: today.new || 0,
      doneRev: today.rev || 0,
      newPlanned: newPlanned,
      revPlanned: revPlanned,
      newTotal: (today.new || 0) + newPlanned,
      revTotal: (today.rev || 0) + revPlanned
    };
  }

  function renderHome() {
    $('#homeGreet').textContent = greeting() + ' · ' + dateLabel();

    var books = Store.books();
    var sel = $('#homeBookSelect');
    if (!books.length) {
      sel.innerHTML = '<option>还没有词库</option>';
      $('#homeBookMeta').textContent = '';
      $('#planNewNum').textContent = '0 / 0';
      $('#planRevNum').textContent = '0 / 0';
      $('#planNewBar').style.width = '0%';
      $('#planRevBar').style.width = '0%';
      $('#planEst').textContent = '先导入一个词库';
      $('#btnStart').textContent = '导入词库';
      $('#btnStart').dataset.action = 'import';
      $('#btnCram').hidden = true;
      $('#homeForecast').innerHTML = '';
      $('#homeStatStrip').innerHTML = statStripHTML();
      return;
    }

    var active = Store.activeBook();
    sel.innerHTML = books.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (b.id === active.id ? ' selected' : '') + '>' + esc(b.name) + '</option>';
    }).join('');
    $('#homeBookMeta').textContent = active.cards.length + ' 词';

    var p = planOf(active);
    var pending = getPending();
    var left = pending ? (pending.queue.length - pending.i) : (p.newPlanned + p.revPlanned);

    $('#planNewNum').textContent = p.doneNew + ' / ' + p.newTotal;
    $('#planRevNum').textContent = p.doneRev + ' / ' + p.revTotal;
    $('#planNewBar').style.width = (p.newTotal ? Math.round(p.doneNew / p.newTotal * 100) : 0) + '%';
    $('#planRevBar').style.width = (p.revTotal ? Math.round(p.doneRev / p.revTotal * 100) : 0) + '%';

    var estSec = p.newPlanned * 22 + p.revPlanned * 9;
    $('#planEst').textContent = estSec > 0 ? '预计 ' + fmtMinutes(estSec) : '今日已完成';

    var btn = $('#btnStart');
    btn.hidden = false;
    btn.dataset.action = 'start';
    if (left <= 0 && !pending) {
      btn.textContent = '今天学完了 🎉';
      btn.disabled = true;
    } else {
      btn.disabled = false;
      btn.textContent = pending ? '继续学习 · 剩余 ' + left : '开始学习';
    }
    var cram = $('#btnCram');
    cram.hidden = !(p.counts.new + p.counts.due + p.counts.learning > 0);
    cram.textContent = p.newPlanned + p.revPlanned === 0 ? '想让记忆更牢？自由复习一轮' : '自由复习（不按计划）';

    $('#homeStatStrip').innerHTML = statStripHTML();

    $('#homeForecast').innerHTML = forecastHTML(active.cards);
  }

  function forecastHTML(cards) {
    var fc = SRS.forecast(cards, 7);
    var total = fc.reduce(function (a, x) { return a + x.count; }, 0);
    if (!total) return '<p class="chart-empty">接下来 7 天还没有安排复习</p>';
    var max = Math.max.apply(null, fc.map(function (x) { return x.count; }).concat([1]));
    var names = ['今天', '明天', '后天'];
    return fc.map(function (x, i) {
      var label = i < 3 ? names[i] : '周' + '日一二三四五六'[new Date(x.day.replace(/-/g, '/')).getDay()];
      return '<div class="mini-col" title="' + x.count + ' 个"><b>' + (x.count || '') + '</b>' +
        '<i class="' + (x.count ? 'has' : '') + '" style="height:' + Math.round(x.count / max * 100) + '%"></i>' +
        '<span>' + label + '</span></div>';
    }).join('');
  }

  function statStripHTML() {
    var t = Store.totals();
    var today = Store.today();
    return '<div class="stat-cell"><div class="v">' + Store.streak() + '</div><div class="k">连续天数</div></div>' +
      '<div class="stat-cell"><div class="v">' + ((today.new || 0) + (today.rev || 0)) + '</div><div class="k">今日已学</div></div>' +
      '<div class="stat-cell"><div class="v">' + (t.retention || 0) + '%</div><div class="k">记忆率</div></div>';
  }

  /* ============================================================
   * 词库页
   * ============================================================ */
  function renderBooks() {
    var books = Store.books();
    var list = $('#bookList');
    if (!books.length) {
      list.innerHTML = '<div class="tip-box" style="text-align:center;padding:28px 16px">' +
        '<b style="font-size:15px">还没有词库</b><div style="margin-top:6px;color:var(--sub)">导入一份 CSV / TXT 就能开始</div></div>';
      return;
    }
    list.innerHTML = books.map(function (b) {
      var c = SRS.counts(b.cards);
      return '<div class="book-item' + (b.id === Store.data.activeBookId ? ' active' : '') + '" data-book="' + esc(b.id) + '">' +
        '<span class="book-dot"></span>' +
        '<span class="book-main" data-open="' + esc(b.id) + '">' +
          '<span class="book-name">' + esc(b.name) + '</span>' +
          '<span class="book-meta">' + c.total + ' 词 · 待复习 <b>' + c.due + '</b> · 未学 ' + c.new + ' · 已掌握 ' + c.mastered + '</span>' +
        '</span>' +
        '<button class="book-more" data-menu="' + esc(b.id) + '" aria-label="词库菜单">⋯</button>' +
      '</div>';
    }).join('');
  }

  function bookMenu(bookId) {
    var b = Store.getBook(bookId);
    if (!b) return;
    openSheet({
      title: b.name,
      body: '<div class="dist-list">' +
        '<div><span>单词总数</span><b>' + b.cards.length + '</b></div>' +
        '<div><span>待复习 / 未学</span><b>' + SRS.counts(b.cards).due + ' / ' + SRS.counts(b.cards).new + '</b></div>' +
        '</div>' +
        '<div class="sheet-foot" style="flex-direction:column;gap:8px;margin-top:18px">' +
        '<button class="btn btn-ghost" data-m="use">设为当前词库</button>' +
        '<button class="btn btn-ghost" data-m="view">查看单词</button>' +
        '<button class="btn btn-ghost" data-m="append">追加导入单词</button>' +
        '<button class="btn btn-ghost" data-m="rename">重命名</button>' +
        '<button class="btn btn-ghost danger" data-m="delete">删除词库</button>' +
        '</div>',
      onMount: function (root) {
        root.querySelector('.sheet-body').addEventListener('click', function (e) {
          var m = e.target.closest('[data-m]');
          if (!m) return;
          var act = m.dataset.m;
          closeSheet();
          if (act === 'use') { Store.setActive(bookId); renderBooks(); toast('已切换词库'); }
          if (act === 'view') openWords(bookId);
          if (act === 'append') openImportSheet(bookId);
          if (act === 'rename') renameDialog(bookId);
          if (act === 'delete') {
            confirmSheet({
              title: '删除词库', text: '「' + b.name + '」及其学习进度会被删除，无法恢复。', okText: '删除', danger: true
            }).then(function (ok) {
              if (!ok) return;
              Store.deleteBook(bookId);
              renderBooks(); toast('已删除');
            });
          }
        });
      }
    });
  }

  function renameDialog(bookId) {
    var b = Store.getBook(bookId);
    if (!b) return;
    openSheet({
      title: '重命名词库',
      body: '<div class="field"><label>名称</label><input class="input" id="renameInput" value="' + esc(b.name) + '"></div>',
      foot: '<button class="btn btn-ghost" data-close="1">取消</button><button class="btn btn-primary" id="renameOk">保存</button>',
      onMount: function (root) {
        var input = root.querySelector('#renameInput');
        input.focus(); input.select();
        root.querySelector('#renameOk').onclick = function () {
          Store.renameBook(bookId, input.value);
          closeSheet(); renderBooks(); renderHome(); toast('已重命名');
        };
      }
    });
  }

  /* ============================================================
   * 单词列表
   * ============================================================ */
  var wordsState = { bookId: null, filter: 'all', q: '', limit: 200 };

  function openWords(bookId) {
    if (!bookId) {
      var a = Store.activeBook();
      bookId = a ? a.id : null;
    }
    wordsState = { bookId: bookId, filter: 'all', q: '', limit: 200 };
    var b = Store.getBook(bookId);
    $('#wordsTitle').textContent = b ? b.name : '单词';
    $('#wordSearch').value = '';
    $$('#wordFilterChips .chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.filter === 'all');
    });
    renderWords();
    showView('words');
  }

  function renderWords() {
    var b = Store.getBook(wordsState.bookId);
    if (!b) {
      $('#wordList').innerHTML = '<p class="hint-line" style="text-align:center;padding:30px 0">还没有词库，先去「词库」导入一份</p>';
      $('#btnWordMore').hidden = true;
      return;
    }
    var q = wordsState.q.trim().toLowerCase();
    var f = wordsState.filter;
    var list = b.cards.filter(function (c) {
      if (f !== 'all' && SRS.statusOf(c) !== f) return false;
      if (!q) return true;
      return c.word.toLowerCase().indexOf(q) >= 0 || (c.meaning || '').toLowerCase().indexOf(q) >= 0;
    });
    var shown = list.slice(0, wordsState.limit);
    var labels = { new: '未学', learning: '学习中', review: '复习中', mastered: '已掌握' };
    if (!shown.length) {
      $('#wordList').innerHTML = '<p class="hint-line" style="text-align:center;padding:30px 0">没有匹配的单词</p>';
    } else {
      $('#wordList').innerHTML = shown.map(function (c) {
        var s = SRS.statusOf(c);
        return '<button class="word-row" data-cid="' + esc(c.id) + '">' +
          '<span class="wr-main"><span class="wr-word ' + (s === 'mastered' ? 'mastered' : '') + '">' + esc(c.word) + '</span>' +
          '<span class="wr-mean">' + esc(c.meaning || '—') + '</span></span>' +
          '<span class="wr-state s-' + s + '">' + labels[s] + '</span></button>';
      }).join('');
    }
    $('#btnWordMore').hidden = list.length <= wordsState.limit;
    $('#btnWordMore').textContent = '显示更多（还有 ' + Math.max(0, list.length - wordsState.limit) + ' 个）';
  }

  function editCardSheet(cid) {
    var b = Store.getBook(wordsState.bookId);
    if (!b) return;
    var card = null;
    b.cards.forEach(function (c) { if (c.id === cid) card = c; });
    if (!card) return;
    var s = SRS.statusOf(card);
    var dueTxt = card.st === 'new' ? '未开始学习'
      : (s === 'learning' ? '本轮巩固中' : '下次复习 ' + SRS.formatInterval(card.due - Date.now()) + '后');
    openSheet({
      title: '编辑单词',
      body:
        '<div class="field"><label>单词</label><input class="input" id="ecWord" value="' + esc(card.word) + '"></div>' +
        '<div class="field"><label>音标</label><input class="input" id="ecPhon" value="' + esc(card.phonetic) + '" placeholder="/ˈwɜːd/"></div>' +
        '<div class="field"><label>释义</label><textarea id="ecMean" style="min-height:80px">' + esc(card.meaning) + '</textarea></div>' +
        '<div class="field"><label>例句</label><textarea id="ecEx" style="min-height:64px">' + esc(card.example) + '</textarea></div>' +
        '<div class="field"><label>例句翻译</label><input class="input" id="ecExCn" value="' + esc(card.exampleCn) + '"></div>' +
        '<div class="field"><label>标签</label><input class="input" id="ecTags" value="' + esc(card.tags) + '"></div>' +
        '<p class="hint-line">' + esc(dueTxt) + ' · 已作答 ' + (card.reps || 0) + ' 次' + (card.lapses ? ' · 遗忘 ' + card.lapses + ' 次' : '') + '</p>' +
        '<div class="sheet-foot" style="flex-direction:column;gap:8px">' +
        '<button class="btn btn-primary" id="ecSave">保存</button>' +
        '<button class="btn btn-ghost danger" id="ecDel">删除这个单词</button>' +
        '</div>',
      onMount: function (root) {
        root.querySelector('#ecSave').onclick = function () {
          Store.updateCard(b.id, cid, {
            word: root.querySelector('#ecWord').value.trim(),
            phonetic: root.querySelector('#ecPhon').value.trim(),
            meaning: root.querySelector('#ecMean').value.trim(),
            example: root.querySelector('#ecEx').value.trim(),
            exampleCn: root.querySelector('#ecExCn').value.trim(),
            tags: root.querySelector('#ecTags').value.trim()
          });
          closeSheet(); renderWords(); toast('已保存');
        };
        root.querySelector('#ecDel').onclick = function () {
          confirmSheet({ title: '删除单词', text: '将删除「' + card.word + '」及其进度。', okText: '删除', danger: true }).then(function (ok) {
            if (!ok) return;
            Store.removeCard(b.id, cid);
            renderWords(); toast('已删除');
          });
        };
      }
    });
  }

  /* ============================================================
   * 统计页
   * ============================================================ */
  function renderStats() {
    var book = Store.activeBook();
    var t = Store.totals();
    var days = Store.lastDays(14);
    var max = Math.max.apply(null, days.map(function (d) { return d.new + d.rev; }).concat([1]));
    var week = ['日', '一', '二', '三', '四', '五', '六'];

    var chart = days.map(function (d) {
      var h1 = Math.round(d.new / max * 100), h2 = Math.round(d.rev / max * 100);
      var dt = new Date(d.key.replace(/-/g, '/'));
      return '<div class="col" title="' + d.key + ' 新学 ' + d.new + ' / 复习 ' + d.rev + '">' +
        '<div class="stack">' + (d.rev ? '<i class="r" style="height:' + h2 + '%"></i>' : '') +
        (d.new ? '<i class="n" style="height:' + h1 + '%"></i>' : '') + '</div>' +
        '<span>' + week[dt.getDay()] + '</span></div>';
    }).join('');
    var hasHistory = days.some(function (d) { return d.new + d.rev > 0; });

    var html = '<div class="stat-cards">' +
      card(Store.streak() + ' 天', '连续打卡') +
      card(t.days, '累计学习天数') +
      card(t.ans, '累计作答') +
      card(t.retention + '%', '整体记忆率') +
      '</div>';

    html += '<div class="section"><div class="section-head"><h2>近 14 天</h2></div>' +
      '<div class="chart-box"><div class="chart-legend"><span><i style="background:var(--new)"></i>新学</span>' +
      '<span><i style="background:var(--rev)"></i>复习</span></div>' +
      (hasHistory ? '<div class="chart">' + chart + '</div>'
        : '<p class="chart-empty">还没有学习记录，学完第一组词就会出现在这里</p>') + '</div></div>';

    if (book) {
      var c = SRS.counts(book.cards);
      var tot = Math.max(1, c.total);
      var seg = [['new', '未学', c.new, 'var(--line-strong)'], ['learning', '学习中', c.learning, 'var(--warn)'],
        ['review', '复习中', c.review, 'var(--rev)'], ['mastered', '已掌握', c.mastered, 'var(--good)']];
      html += '<div class="section"><div class="section-head"><h2>「' + esc(book.name) + '」掌握情况</h2></div>' +
        '<div class="chart-box">' +
        '<div class="dist">' + seg.map(function (s) {
          return '<i style="width:' + (s[2] / tot * 100) + '%;background:' + s[3] + '"></i>';
        }).join('') + '</div>' +
        '<div class="dist-list">' + seg.map(function (s) {
          return '<div><span><i class="dist-dot" style="background:' + s[3] + '"></i>' + s[1] + '</span><b>' + s[2] + '　' + Math.round(s[2] / tot * 100) + '%</b></div>';
        }).join('') + '</div></div></div>';

      html += '<div class="section"><div class="section-head"><h2>未来 7 天待复习</h2></div>' +
        '<div class="mini-chart">' + forecastHTML(book.cards) + '</div></div>';
    }

    html += '<div class="section"><div class="section-head"><h2>累计数据</h2></div><div class="chart-box dist-list">' +
      '<div><span>累计新学单词</span><b>' + t.newN + '</b></div>' +
      '<div><span>累计复习次数</span><b>' + t.revN + '</b></div>' +
      '<div><span>答对次数</span><b>' + t.correct + '</b></div>' +
      '</div></div>';

    $('#statsBody').innerHTML = html;
  }

  function card(v, k) {
    return '<div class="stat-card"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + '</div></div>';
  }

  /* ============================================================
   * 设置页
   * ============================================================ */
  function renderSettings() {
    var s = Store.data.settings;
    $('#setNewPerDay').value = s.newPerDay;
    $('#setReviewPerDay').value = s.reviewPerDay;
    $('#setAutoSpeak').checked = !!s.autoSpeak;
    $('#setAccent').value = s.accent;
    $('#setRate').value = s.rate;
    $('#setRateVal').textContent = Number(s.rate).toFixed(1) + '×';
    $('#setTheme').value = s.theme || 'auto';
    var n = voiceCount(s.accent);
    $('#setVoiceInfo').textContent = n > 0 ? ('检测到 ' + n + ' 个可用语音') : '先点试听，让系统加载语音';
  }

  function bindSettings() {
    function set(k, v) {
      Store.data.settings[k] = v;
      Store.save();
    }
    $('#setNewPerDay').addEventListener('change', function (e) {
      var v = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 20));
      e.target.value = v; set('newPerDay', v); renderHome();
    });
    $('#setReviewPerDay').addEventListener('change', function (e) {
      var v = Math.max(10, Math.min(999, parseInt(e.target.value, 10) || 150));
      e.target.value = v; set('reviewPerDay', v); renderHome();
    });
    $('#setAutoSpeak').addEventListener('change', function (e) { set('autoSpeak', e.target.checked); });
    $('#setAccent').addEventListener('change', function (e) { set('accent', e.target.value); speak('Hello'); });
    $('#setRate').addEventListener('input', function (e) {
      var v = Number(e.target.value);
      $('#setRateVal').textContent = v.toFixed(1) + '×';
      set('rate', v);
    });
    $('#setRate').addEventListener('change', function () { speak('Vocabulary'); });
    $('#btnTestSpeak').addEventListener('click', function () {
      speak('Vocabulary');
      setTimeout(function () {
        var n = voiceCount(Store.data.settings.accent);
        $('#setVoiceInfo').textContent = n > 0 ? ('检测到 ' + n + ' 个可用语音') : '系统没提供语音包（安卓可在「设置→系统→语言与输入→文字转语音」里装）';
      }, 400);
    });
    $('#setTheme').addEventListener('change', function (e) {
      set('theme', e.target.value); applyTheme();
    });

    $('#btnExport').addEventListener('click', exportBackup);
    $('#btnImportBackup').addEventListener('click', importBackup);
    $('#btnReset').addEventListener('click', function () {
      confirmSheet({
        title: '清空全部数据',
        text: '所有词库、学习进度与统计都会被删除，且无法恢复。确定继续吗？',
        okText: '全部清空', danger: true
      }).then(function (ok) {
        if (!ok) return;
        Store.resetAll();
        renderAll();
        toast('已清空');
        showView('home');
      });
    });
  }

  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1500);
      return true;
    } catch (e) {
      return false;
    }
  }

  function todayStamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }

  function exportBackup() {
    var json = Store.exportJSON();
    if (download('wordflow-backup-' + todayStamp() + '.json', json)) toast('备份已导出');
    else toast('导出失败，请换一个浏览器试试');
  }

  function importBackup() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(reader.result)); } catch (e) { obj = null; }
        if (!obj || !Array.isArray(obj.books)) { toast('这不是有效的备份文件'); return; }
        var total = obj.books.reduce(function (a, b) { return a + (b.cards ? b.cards.length : 0); }, 0);
        openSheet({
          title: '导入备份',
          body: '<p class="hint-line" style="font-size:14px;color:var(--text-2)">备份包含 ' + obj.books.length + ' 个词库、' + total + ' 个单词。</p>',
          foot: '<button class="btn btn-ghost" data-close="1">取消</button>' +
                '<button class="btn btn-ghost" id="bkMerge">合并</button>' +
                '<button class="btn btn-primary" id="bkReplace">覆盖</button>',
          onMount: function (root) {
            root.querySelector('#bkMerge').onclick = function () {
              try { Store.importJSON(obj, 'merge'); closeSheet(); renderAll(); toast('已合并导入'); } catch (e) { toast('导入失败：' + e.message); }
            };
            root.querySelector('#bkReplace').onclick = function () {
              confirmSheet({ title: '覆盖导入', text: '当前所有词库与统计会被备份内容替换。', okText: '覆盖', danger: true }).then(function (ok) {
                if (!ok) return;
                try { Store.importJSON(obj, 'replace'); closeSheet(); renderAll(); toast('已覆盖导入'); showView('home'); }
                catch (e) { toast('导入失败：' + e.message); }
              });
            };
          }
        });
      };
      reader.readAsText(f, 'utf-8');
    };
    input.click();
  }

  /* ============================================================
   * 导入词库
   * ============================================================ */
  function openImportSheet(targetBookId) {
    var isAppend = !!targetBookId;
    var parsed = null;
    openSheet({
      title: isAppend ? '追加单词' : '导入词库',
      body:
        '<div class="field"><label>词库名称</label>' +
          '<input class="input" id="impName" placeholder="例如：考研核心词 / 雅思 6.5 / 我的生词本"' +
          (isAppend ? ' disabled' : '') + '></div>' +
        '<div id="impBanks"></div>' +
        '<div class="file-drop" id="impDrop">点击选择文件（.csv / .tsv / .txt / .json）<br><span style="font-size:11px;opacity:.75">或直接把内容粘贴到下面</span>' +
        '<input type="file" id="impFile" accept=".csv,.tsv,.txt,.json,text/csv,text/plain,application/json" hidden></div>' +
        '<textarea id="impText" placeholder="word,phonetic,meaning,example&#10;abandon,/əˈbændən/,v. 抛弃；放弃,He abandoned the plan.&#10;"></textarea>' +
        '<div id="impPreview" style="margin-top:10px"></div>' +
        '<p class="hint-line">列顺序默认「单词, 音标, 释义, 例句」；带表头会自动识别列名。文件请另存为 UTF-8 编码。</p>',
      foot: '<button class="btn btn-ghost" data-close="1">取消</button>' +
            '<button class="btn btn-primary" id="impDo" disabled>导入</button>',
      onMount: function (root) {
        var nameEl = root.querySelector('#impName');
        var textEl = root.querySelector('#impText');
        var drop = root.querySelector('#impDrop');
        var fileEl = root.querySelector('#impFile');
        var prev = root.querySelector('#impPreview');
        var btn = root.querySelector('#impDo');
        if (isAppend) {
          var b = Store.getBook(targetBookId);
          nameEl.placeholder = b ? b.name : '';
        } else {
          nameEl.value = '';
        }

        /* 内置词库：一键填入，避免手机上还要传文件 */
        var banksEl = root.querySelector('#impBanks');
        if (!isAppend && banksEl && window.BUNDLED_BANKS && window.BUNDLED_BANKS.length) {
          banksEl.innerHTML = '<p class="hint-line" style="margin:0 0 8px">现成词库，点一下直接填入：</p>' +
            '<div class="bank-picks">' + window.BUNDLED_BANKS.map(function (bk, i) {
              return '<button class="chip" data-bank="' + i + '">' + esc(bk.name) +
                '<br><span style="font-weight:500;opacity:.7">' + bk.count + ' 词</span></button>';
            }).join('') + '</div>';
          banksEl.addEventListener('click', function (e) {
            var hit = e.target.closest('[data-bank]');
            if (!hit) return;
            var bk = window.BUNDLED_BANKS[+hit.dataset.bank];
            if (!bk) return;
            textEl.value = bk.csv;
            nameEl.value = bk.name;
            Array.prototype.forEach.call(banksEl.querySelectorAll('.chip'), function (c) {
              c.classList.toggle('active', c === hit);
            });
            update();
          });
        }

        var timer = null;
        function update() {
          var txt = textEl.value;
          if (!txt.trim()) {
            parsed = null;
            prev.innerHTML = '';
            btn.disabled = true;
            return;
          }
          parsed = Importer.parse(txt, { sourceName: nameEl.value });
          var n = parsed.cards.length;
          var m = parsed.meta;
          var fmt = { csv: 'CSV', tsv: 'TSV', pipe: '竖线分隔', text: '纯文本', json: 'JSON' }[m.format] || m.format;
          var rows = parsed.cards.slice(0, 3).map(function (c) {
            return '<tr><td>' + esc(c.word) + '</td><td>' + esc(c.phonetic || '') + '</td><td>' + esc(c.meaning || '') + '</td></tr>';
          }).join('');
          prev.innerHTML = '<p class="hint-line" style="color:var(--text)"><b>识别到 ' + n + ' 个单词</b> · ' + fmt +
            (m.header ? ' · 已识别表头' : '') + (m.skipped ? ' · 跳过 ' + m.skipped + ' 行' : '') + '</p>' +
            '<table class="preview-table"><tr><th>单词</th><th>音标</th><th>释义</th></tr>' + rows + '</table>';
          btn.disabled = n === 0;
        }
        textEl.addEventListener('input', function () {
          clearTimeout(timer);
          timer = setTimeout(update, 260);
        });
        drop.addEventListener('click', function () { fileEl.click(); });
        fileEl.addEventListener('change', function () {
          var f = fileEl.files && fileEl.files[0];
          if (!f) return;
          var r = new FileReader();
          r.onload = function () {
            var txt = String(r.result);
            if (txt.indexOf('\ufffd') >= 0) {
              toast('文件可能不是 UTF-8 编码，请另存为 UTF-8 后重试');
            }
            textEl.value = txt;
            if (!isAppend && !nameEl.value) nameEl.value = f.name.replace(/\.[^.]+$/, '');
            drop.textContent = '已选择：' + f.name;
            drop.classList.add('has');
            update();
          };
          r.readAsText(f, 'utf-8');
        });

        btn.onclick = function () {
          if (!parsed || !parsed.cards.length) return;
          var cards = parsed.cards;
          if (isAppend) {
            var res = Store.appendCards(targetBookId, cards);
            closeSheet();
            renderAll();
            toast('新增 ' + res.added + ' 个单词' + (res.dupes ? '，跳过重复 ' + res.dupes + ' 个' : ''));
          } else {
            var name = (nameEl.value || '').trim() || '导入词库 ' + (Store.books().length + 1);
            var book = Store.addBook(name, cards);
            Store.setActive(book.id);
            closeSheet();
            renderAll();
            showView('home');
            toast('已导入 ' + cards.length + ' 个单词，开始学习吧');
          }
        };
      }
    });
  }

  /* ============================================================
   * 学习会话
   * ============================================================ */
  var session = null;

  function findCard(book, cid) {
    for (var i = 0; i < book.cards.length; i++) if (book.cards[i].id === cid) return book.cards[i];
    return null;
  }

  function interleave(a, b) {
    var out = [];
    var na = a.length, nb = b.length, tot = na + nb;
    var ia = 0, ib = 0;
    for (var k = 0; k < tot; k++) {
      var needA = Math.round((k + 1) * na / tot);
      if (ia < na && ia < needA) { out.push({ cid: a[ia].id, kind: 'new', re: 0 }); ia++; }
      else if (ib < nb) { out.push({ cid: b[ib].id, kind: 'rev', re: 0 }); ib++; }
      else if (ia < na) { out.push({ cid: a[ia].id, kind: 'new', re: 0 }); ia++; }
    }
    return out;
  }

  function buildSession(book, mode) {
    var s = Store.data.settings;
    var now = Date.now();
    var today = Store.today();
    var news = [], revs = [];

    if (mode === 'cram') {
      var pool = book.cards.filter(function (c) { return SRS.statusOf(c) !== 'new'; });
      pool.sort(function (x, y) { return (x.due - y.due) || ((x.ease || 2.5) - (y.ease || 2.5)); });
      revs = pool.slice(0, 100);
      if (!revs.length) news = book.cards.slice(0, 20);
    } else {
      var newQuota = Math.max(0, (s.newPerDay || 20) - (today.new || 0));
      var revQuota = Math.max(0, (s.reviewPerDay || 150) - (today.rev || 0));
      news = book.cards.filter(function (c) { return c.st === 'new'; }).slice(0, newQuota);
      revs = book.cards.filter(function (c) {
        if (c.st === 'new') return false;
        var slack = SRS.isLearning(c) ? 15 * 60000 : 0;
        return c.due <= now + slack;
      }).sort(function (x, y) { return x.due - y.due; }).slice(0, revQuota);
    }

    var queue = interleave(news, revs);
    if (!queue.length) return null;
    return {
      bookId: book.id,
      mode: mode,
      day: SRS.dayKey(),
      queue: queue,
      i: 0,
      revealed: false,
      counts: { new: 0, rev: 0, ans: 0, correct: 0 },
      startAt: Date.now(),
      newTotal: news.length,
      revTotal: revs.length
    };
  }

  function getPending() {
    var s = Store.getSession();
    if (!s || !s.queue || s.i >= s.queue.length) return null;
    if (s.day !== SRS.dayKey()) return null;
    if (!Store.getBook(s.bookId)) return null;
    return s;
  }

  function startSession(mode, resume) {
    var book = Store.activeBook();
    if (!book) { openImportSheet(null); return; }
    if (resume) {
      var p = getPending();
      if (p) session = p;
    } else {
      session = buildSession(book, mode);
      if (!session) {
        toast(mode === 'cram' ? '还没有可以复习的单词' : '今天要学的都学完了 🎉');
        return;
      }
      Store.saveSession(session);
    }
    if (!session) return;
    session.revealed = false;
    $('#study').hidden = false;
    $('#done').hidden = true;
    renderCard();
  }

  function endSessionUI() {
    $('#study').hidden = true;
    $('#done').hidden = true;
    renderHome();
    showView('home');
  }

  function exitSession() {
    if (!session) return;
    var left = session.queue.length - session.i;
    if (left > 0 && session.counts.ans > 0) {
      confirmSheet({
        title: '退出本轮学习？',
        text: '还剩 ' + left + ' 个单词，进度已保存，下次可以从首页继续。',
        okText: '退出', cancelText: '继续学'
      }).then(function (ok) {
        if (!ok) return;
        Store.saveSession(session);
        session = null;
        endSessionUI();
      });
    } else {
      Store.saveSession(session);
      session = null;
      endSessionUI();
    }
  }

  function currentCard() {
    if (!session) return null;
    var item = session.queue[session.i];
    if (!item) return null;
    var book = Store.getBook(session.bookId);
    if (!book) return null;
    return { item: item, card: findCard(book, item.cid), book: book };
  }

  function renderCard() {
    if (!session) return;
    if (session.i >= session.queue.length) { finishSession(); return; }
    var cur = currentCard();
    if (!cur || !cur.card) {
      session.i++;
      renderCard();
      return;
    }
    var c = cur.card;
    var statusLabel = cur.item.kind === 'new' ? '新词' : (cur.item.re ? '再认' : (SRS.isLearning(c) ? '巩固' : '复习'));

    var el = $('#flashcard');
    el.classList.remove('revealed');
    session.revealed = false;

    $('#fcKind').textContent = statusLabel;
    $('#fcKind2').textContent = statusLabel;
    var tags = (c.tags || '').trim();
    $('#fcTags').textContent = tags;
    $('#fcTags2').textContent = tags;
    $('#fcTags').hidden = !tags;
    $('#fcTags2').hidden = !tags;
    $('#fcWord').textContent = c.word;
    $('#fcWord2').textContent = c.word;
    $('#fcPhon').textContent = c.phonetic || '';
    $('#fcPhon2').textContent = c.phonetic || '';

    var mean = c.meaning || '';
    $('#fcMeaning').innerHTML = mean
      ? mean.split(/<br\s*\/?>|\n/).filter(function (x) { return x.trim(); }).map(function (line) {
        return '<div>' + esc(line) + '</div>';
      }).join('')
      : '<div style="color:var(--sub)">（暂无释义，可在词库中编辑）</div>';

    $('#fcExample').innerHTML = c.example ? highlight(c.example, c.word) : '';
    $('#fcExampleCn').textContent = c.exampleCn || '';

    var reps = [];
    if (c.reps) reps.push('已作答 ' + c.reps + ' 次');
    if (c.lapses) reps.push('遗忘 ' + c.lapses + ' 次');
    if (c.st === 'review' && c.ivl) reps.push('当前间隔 ' + c.ivl + ' 天');
    $('#fcReps').textContent = reps.join(' · ');

    $('#btnReveal').hidden = false;
    $('#ratings').hidden = true;

    // 评分按钮的间隔预览
    $$('#ratings .rate').forEach(function (btn) {
      var g = Number(btn.dataset.g);
      var pv = SRS.preview(c, g);
      btn.querySelector('span').textContent = pv.label;
    });

    var total = session.queue.length;
    var pct = Math.round(session.i / total * 100);
    $('#studyBar').style.width = pct + '%';
    $('#studyCount').textContent = session.i + 1 + ' / ' + total;

    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');

    if (Store.data.settings.autoSpeak && (cur.item.kind === 'new' || cur.item.re)) {
      /* quiet：自动发音可能是被浏览器拦掉的（iOS 要求用户手势），不弹提示 */
      setTimeout(function () { speak(c.word, { quiet: true }); }, 120);
    }
  }

  function highlight(text, word) {
    var t = esc(text);
    var w = esc(String(word || '').trim());
    if (!w || w.length < 2) return t;
    try {
      var re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return t.replace(re, '<mark>$1</mark>');
    } catch (e) {
      return t;
    }
  }

  function reveal() {
    if (!session || session.revealed) return;
    session.revealed = true;
    $('#flashcard').classList.add('revealed');
    $('#btnReveal').hidden = true;
    $('#ratings').hidden = false;
  }

  function answer(g) {
    if (!session || !session.revealed) return;
    var cur = currentCard();
    if (!cur || !cur.card) { session.i++; renderCard(); return; }
    var c = cur.card;
    var wasNew = c.st === 'new';

    SRS.rate(c, g, Date.now());
    Store.updateCard(cur.book.id, c.id, {}); // 触发保存
    Store.bump(wasNew ? 'new' : 'rev', g >= 2);

    session.counts.ans++;
    if (wasNew) session.counts.new++;
    else session.counts.rev++;
    if (g >= 2) session.counts.correct++;

    // 忘了的词，后面再考一次（同类间隔里最多 2 次）
    if (g <= 1 && (cur.item.re || 0) < 2) {
      var pos = Math.min(session.queue.length, session.i + 4);
      session.queue.splice(pos, 0, { cid: c.id, kind: cur.item.kind, re: (cur.item.re || 0) + 1 });
    }

    session.i++;
    session.revealed = false;
    Store.saveSession(session);
    if (session.i >= session.queue.length) finishSession();
    else renderCard();
  }

  function finishSession() {
    if (!session) return;
    var s = session;
    Store.clearSession();
    session = null;
    $('#study').hidden = true;

    var acc = s.counts.ans ? Math.round(s.counts.correct / s.counts.ans * 100) : 0;
    var mins = Math.max(1, Math.round((Date.now() - s.startAt) / 60000));
    $('#doneEmoji').textContent = acc >= 85 ? '🎉' : (acc >= 60 ? '💪' : '🌱');
    $('#doneTitle').textContent = s.mode === 'cram' ? '这一轮复习完成' : '今日任务完成';
    $('#doneSub').textContent = '用时约 ' + mins + ' 分钟' + (acc >= 85 ? '，状态不错！' : '，明天再巩固一遍会更牢');

    var book = Store.getBook(s.bookId);
    var leftNew = book ? SRS.counts(book.cards).new : 0;
    $('#doneGrid').innerHTML =
      '<div class="done-cell"><div class="v">' + s.counts.new + '</div><div class="k">新学</div></div>' +
      '<div class="done-cell"><div class="v">' + s.counts.rev + '</div><div class="k">复习</div></div>' +
      '<div class="done-cell"><div class="v">' + acc + '%</div><div class="k">记忆率</div></div>';
    $('#doneAgain').textContent = leftNew > 0 ? '再学一轮（还有 ' + leftNew + ' 个新词）' : '再复习一轮（自由模式）';
    $('#done').hidden = false;
  }

  function bindStudy() {
    $('#btnStart').addEventListener('click', function (e) {
      if (e.currentTarget.dataset.action === 'import') { openImportSheet(null); return; }
      if (e.currentTarget.disabled) return;
      startSession('daily', !!getPending());
    });
    $('#btnCram').addEventListener('click', function () { startSession('cram', false); });
    $('#btnReveal').addEventListener('click', reveal);
    $('#flashcard').addEventListener('click', function (e) {
      if (e.target.closest('#fcSpeak')) return;
      reveal();
    });
    $('#fcSpeak').addEventListener('click', function (e) {
      e.stopPropagation();
      var cur = currentCard();
      if (cur && cur.card) speak(cur.card.word);
    });
    $('#studySpeakToggle').addEventListener('click', function () {
      var cur = currentCard();
      if (cur && cur.card) speak(cur.card.word);
    });
    $('#ratings').addEventListener('click', function (e) {
      var b = e.target.closest('.rate');
      if (!b) return;
      answer(Number(b.dataset.g));
    });
    $('#studyClose').addEventListener('click', exitSession);
    $('#doneHome').addEventListener('click', function () {
      $('#done').hidden = true;
      endSessionUI();
    });
    $('#doneAgain').addEventListener('click', function () {
      $('#done').hidden = true;
      var book = Store.activeBook();
      var left = book ? SRS.counts(book.cards).new : 0;
      startSession(left > 0 ? 'daily' : 'cram', false);
    });

    document.addEventListener('keydown', function (e) {
      if ($('#study').hidden) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!session) return;
        if (!session.revealed) reveal();
        return;
      }
      if (e.key === 'Escape') { exitSession(); return; }
      var n = Number(e.key);
      if (n >= 1 && n <= 4) { e.preventDefault(); answer(n - 1); }
    });
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  function bindNav() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { showView(t.dataset.view); });
    });
    $('#homeBookSelect').addEventListener('change', function (e) {
      Store.setActive(e.target.value);
      renderHome();
    });
    $('#btnTheme').addEventListener('click', function () {
      var order = ['auto', 'light', 'dark'];
      var cur = Store.data.settings.theme || 'auto';
      var next = order[(order.indexOf(cur) + 1) % 3];
      Store.data.settings.theme = next;
      Store.save();
      applyTheme();
      toast({ auto: '跟随系统', light: '浅色模式', dark: '深色模式' }[next]);
    });
    $('#btnNewBook').addEventListener('click', function () { openImportSheet(null); });
    $('#bookList').addEventListener('click', function (e) {
      var more = e.target.closest('[data-menu]');
      if (more) { bookMenu(more.dataset.menu); return; }
      var open = e.target.closest('[data-open]');
      if (open) openWords(open.dataset.open);
    });
    $('#btnWordsBack').addEventListener('click', function () { showView('books'); });
    $('#btnWordsMenu').addEventListener('click', function () {
      if (wordsState.bookId) bookMenu(wordsState.bookId);
    });
    $('#wordSearch').addEventListener('input', function (e) {
      wordsState.q = e.target.value;
      wordsState.limit = 200;
      renderWords();
    });
    $('#wordFilterChips').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      wordsState.filter = c.dataset.filter;
      wordsState.limit = 200;
      $$('#wordFilterChips .chip').forEach(function (x) { x.classList.toggle('active', x === c); });
      renderWords();
    });
    $('#btnWordMore').addEventListener('click', function () {
      wordsState.limit += 300;
      renderWords();
    });
    $('#wordList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-cid]');
      if (row) editCardSheet(row.dataset.cid);
    });
  }

  function renderAll() {
    renderHome();
    renderBooks();
    renderStats();
    renderSettings();
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return; // 本地文件打开时无法注册
    navigator.serviceWorker.register('sw.js').catch(function () { /* 静默失败 */ });
  }

  function storageBanner() {
    if (Store.storageOk) return;
    var host = document.querySelector('.app');
    if (!host || host.querySelector('.warnbar')) return;
    var bar = document.createElement('div');
    bar.className = 'warnbar';
    bar.innerHTML = '<span><b>进度存不下来。</b>当前浏览器在这个打开方式下禁用了本地存储，刷新会丢失进度。' +
      '建议把应用托管到 https 后「添加到主屏幕」，或每学完一次到设置里点「导出备份」。</span>' +
      '<button class="warnbar-x" aria-label="关闭">×</button>';
    bar.querySelector('.warnbar-x').addEventListener('click', function () { bar.remove(); });
    host.insertBefore(bar, host.firstChild);
  }

  function boot() {
    Store.load();
    Store.seedIfEmpty();
    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    applyTheme();
    bindNav();
    bindSettings();
    bindStudy();
    renderAll();
    showView('home');

    window.addEventListener('pagehide', function () { Store.flush(); if (session) Store.saveSession(session); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { Store.flush(); if (session) Store.saveSession(session); }
    });
    Store.onError = function (e) {
      toast('本地存储空间不足，请导出备份后清理一些词库');
    };
    storageBanner();
    registerSW();

    // 深链接：index.html#books / #stats / #settings / #words / #study
    var hash = String(location.hash || '').replace(/^#/, '');
    if (hash === 'study') {
      startSession('daily', !!getPending());
      // 截图/调试：index.html?reveal=1#study 直接显示答案面
      if (/[?&]reveal=1/.test(location.search) && session) setTimeout(reveal, 250);
    } else if (['home', 'books', 'stats', 'settings', 'words'].indexOf(hash) >= 0) {
      if (hash === 'words') openWords();
      else showView(hash);
    }

    // 从其他页面回来时刷新首页计划
    setInterval(function () {
      if (currentView === 'home' && !session) renderHome();
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();