/* ============================================================
 * 词流 WordFlow — 词库解析器
 * 支持 CSV / TSV / 竖线 / 分号 / 全角逗号 / 纯文本 / JSON
 * 自动识别表头（中英文）、自动猜列、自动去重
 * 全局对象：Importer
 * ============================================================ */
(function (global) {
  'use strict';

  var FIELDS = ['word', 'phonetic', 'meaning', 'example', 'exampleCn', 'tags'];

  /* 表头别名 —— 归一化后的写法 -> 字段名 */
  var ALIAS = {
    word: ['word', 'words', 'term', 'terms', 'spelling', 'english', 'vocab', 'vocabulary',
      '单词', '词', '词汇', '生词', '词条', '英文', '拼写', '英语', '词组'],
    phonetic: ['phonetic', 'phonetics', 'ipa', 'pron', 'pronunciation', 'sound', 'pinyin',
      '音标', '发音', '读音', '国际音标', '注音'],
    meaning: ['meaning', 'meanings', 'definition', 'define', 'def', 'translation', 'trans', 'translate',
      'chinese', 'cn', 'zh', 'gloss', 'sense',
      '释义', '意思', '中文', '翻译', '解释', '词义', '含义', '中文释义', '中文意思', '词意', '意思解释'],
    example: ['example', 'examples', 'sentence', 'sentences', 'usage', 'sample', 'context',
      '例句', '例子', '句子', '示例', '用法', '例句原文'],
    exampleCn: ['examplecn', 'examplezh', 'sentencecn', 'sentencezh', 'exampletrans', 'translationofexample',
      '例句翻译', '例句中文', '例句释义', '例句译文', '译文', '例句的意思'],
    tags: ['tag', 'tags', 'label', 'labels', 'category', 'cat', 'book', 'unit', 'lesson', 'group', 'list', 'level',
      '标签', '分类', '类别', '单元', '课', '课程', '词组分类', '等级', '来源']
  };

  /* 别名 -> 字段 反查表 */
  var ALIAS_MAP = Object.create(null);
  (function buildAliasMap() {
    for (var field in ALIAS) {
      if (!Object.prototype.hasOwnProperty.call(ALIAS, field)) continue;
      var list = ALIAS[field];
      for (var i = 0; i < list.length; i++) {
        var k = normHeader(list[i]);
        if (k && !ALIAS_MAP[k]) ALIAS_MAP[k] = field;
      }
    }
  })();

  /** 表头归一化：去空白/标点/括号，全角转半角，小写 */
  function normHeader(s) {
    return String(s == null ? '' : s)
      .replace(/^\ufeff/, '')
      .replace(/[\uff01-\uff5e]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/\u3000/g, ' ')
      .toLowerCase()
      .replace(/[\s_\-:：*·•()（）\[\]【】<>《》"'“”‘’]/g, '');
  }

  /** 判断一列内容像不像音标 */
  function looksPhonetic(s) {
    if (!s) return false;
    var t = String(s).trim();
    if (!t) return false;
    if (/^[\/\[][^\/\]]{1,60}[\/\]]$/.test(t)) return true;
    if (/[ˈˌəɪʊæɑɔɜθðʃʒŋː]/.test(t)) return true;
    return false;
  }

  /** 像不像一个完整例句 */
  function looksSentence(s) {
    if (!s) return false;
    var t = String(s).trim();
    if (t.length < 12) return false;
    var words = t.split(/\s+/).filter(function (w) { return w.length > 1; });
    return words.length >= 4;
  }

  /** 去掉行首的序号/项目符号与包裹引号 */
  function stripBullet(s) {
    return String(s == null ? '' : s)
      .replace(/^\ufeff/, '')
      .replace(/^\s*(?:[-*•·]|\d{1,3}[.、)）])\s*/, '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim();
  }

  /** 统计一行里某个分隔符出现次数（忽略引号内的） */
  function countOutsideQuotes(line, ch) {
    var n = 0, inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') inQuote = !inQuote;
      else if (!inQuote && c === ch) n++;
    }
    return n;
  }

  /** 引号跨行合并：把未闭合引号的行与下一行拼起来 */
  function mergeQuotedLines(text) {
    var raw = String(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [], buf = null;
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      if (buf !== null) {
        buf += ' ' + line;
        if (countOutsideQuotes(buf, '"') % 2 === 0) { out.push(buf); buf = null; }
        continue;
      }
      var q = (line.match(/"/g) || []).length;
      if (q % 2 === 1) { buf = line; continue; }
      out.push(line);
    }
    if (buf !== null) out.push(buf);
    return out;
  }

  /** 用候选分隔符切开后，第一格是否像一个「词」 */
  function firstCellOk(line, ch) {
    var cells = splitLine(line, ch);
    if (cells.length < 2) return false;
    var w = cells[0];
    if (!w || w.length > 40) return false;
    if (/\s/.test(w)) return false;
    return /[A-Za-z\u4e00-\u9fa5]/.test(w);
  }

  /**
   * 探测分隔符：优先 tab / 竖线 / 分号 / 逗号
   * 1) 首行切出来后能认出表头 -> 直接采用
   * 2) 否则看「大多数行切出的第一格像单词」且行内符号数稳定
   */
  function detectDelimiter(lines) {
    var cands = ['\t', '|', ';', '；', '，', ','];
    var sample = lines.filter(function (l) { return l.trim(); }).slice(0, 12);
    if (!sample.length) return null;

    for (var h = 0; h < cands.length; h++) {
      var hc = headerMap(splitLine(sample[0], cands[h]));
      if (hc.hasWord && hc.hits >= 2) return cands[h];
    }

    for (var c = 0; c < cands.length; c++) {
      var ch = cands[c];
      var good = 0;
      var counts = [];
      for (var i = 0; i < sample.length; i++) {
        if (firstCellOk(sample[i], ch)) {
          good++;
          counts.push(countOutsideQuotes(sample[i], ch));
        }
      }
      if (!good || good / sample.length < 0.6) continue;
      var freq = Object.create(null), mode = 0, modeN = 0;
      for (var k = 0; k < counts.length; k++) {
        freq[counts[k]] = (freq[counts[k]] || 0) + 1;
        if (freq[counts[k]] > modeN) { modeN = freq[counts[k]]; mode = counts[k]; }
      }
      if (mode >= 1 && modeN / counts.length >= 0.6) return ch;
    }
    return null;
  }

  /** 按分隔符切一行，支持双引号包裹与 "" 转义 */
  function splitLine(line, delim) {
    if (!delim) return [line];
    var cells = [], cur = '', inQuote = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQuote) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuote = false;
        } else cur += c;
      } else if (c === '"') {
        inQuote = true;
      } else if (c === delim) {
        cells.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells.map(function (s) { return s.trim(); });
  }

  /** 识别表头行；没有可用表头返回 {hits:0} */
  function headerMap(cells) {
    var map = {}, hits = 0, hasWord = false;
    for (var i = 0; i < (cells || []).length; i++) {
      var key = normHeader(cells[i]);
      var field = key && ALIAS_MAP[key];
      if (!field) continue;
      if (map[field] !== undefined) continue;
      map[field] = i;
      hits++;
      if (field === 'word') hasWord = true;
    }
    return { map: map, hits: hits, hasWord: hasWord };
  }

  /** 无表头时按位置+内容猜列 */
  function guessMap(cells) {
    var map = {}, used = Object.create(null);
    if (!cells || !cells.length) return map;
    map[0] = 'word';
    for (var i = 1; i < cells.length; i++) {
      var v = cells[i];
      if (!v) continue;
      if (!used.phonetic && looksPhonetic(v)) { map[i] = 'phonetic'; used.phonetic = 1; continue; }
      if (!used.meaning) { map[i] = 'meaning'; used.meaning = 1; continue; }
      if (!used.example && looksSentence(v)) { map[i] = 'example'; used.example = 1; continue; }
      if (!used.tags) { map[i] = 'tags'; used.tags = 1; }
    }
    return map;
  }

  /** 组装标准卡片对象（不生成 id，由 Store 负责） */
  function makeCard(obj) {
    obj = obj || {};
    var card = { word: '', phonetic: '', meaning: '', example: '', exampleCn: '', tags: '' };
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      var v = obj[f];
      card[f] = v == null ? '' : String(v).trim();
    }
    card.word = stripBullet(card.word).replace(/\s+/g, ' ');
    card.meaning = card.meaning.replace(/[ \t]+/g, ' ').trim();
    if (card.phonetic && !/^[\/\[].*[\/\]]$/.test(card.phonetic)) {
      var p = stripBullet(card.phonetic).replace(/^[\/\[]+/, '').replace(/[\/\]]+$/, '');
      card.phonetic = p ? '/' + p + '/' : '';
    }
    return card;
  }

  function normWord(w) { return String(w || '').trim().toLowerCase(); }

  /** 单个 JSON 对象是否是「一张卡片」（有能映射到 word 的键） */
  function isSingleCard(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    if (Array.isArray(o.books) || Array.isArray(o.cards) || Array.isArray(o.words)) return false;
    var keys = Object.keys(o);
    for (var i = 0; i < keys.length; i++) {
      if (ALIAS_MAP[normHeader(keys[i])] === 'word') return true;
    }
    return false;
  }

  function dedupe(cards) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < cards.length; i++) {
      var k = normWord(cards[i].word);
      if (!k || seen[k]) continue;
      seen[k] = 1;
      out.push(cards[i]);
    }
    return out;
  }

  /** 收尾：去重 + 记录重复数 */
  function finish(cards, meta) {
    var out = dedupe(cards);
    meta.dupes = cards.length - out.length;
    return { cards: out, meta: meta };
  }

  /** JSON 对象 -> 标准卡片 */
  function cardFromObject(item) {
    var obj = {};
    for (var key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
      var field = ALIAS_MAP[normHeader(key)];
      if (!field && FIELDS.indexOf(key) >= 0) field = key;
      if (field) obj[field] = item[key];
    }
    return makeCard(obj);
  }

  /**
   * 解析任意文本
   * @param {string} text
   * @param {object} [opts] {sourceName}
   * @returns {{cards:Array, meta:object}}
   */
  function parse(text, opts) {
    opts = opts || {};
    var raw = String(text == null ? '' : text).replace(/^\ufeff/, '');
    var cards = [];
    var meta = {
      format: 'text', delimiter: null, header: false,
      columns: [], skipped: 0, blank: 0, dupes: 0, source: opts.sourceName || ''
    };
    if (!raw.trim()) return { cards: cards, meta: meta };

    /* ---- JSON ---- */
    var t = raw.trim();
    if (t[0] === '[' || t[0] === '{') {
      var data = null;
      try { data = JSON.parse(t); } catch (e) { data = null; }
      if (data && typeof data === 'object') {
        var arr = Array.isArray(data) ? data
          : (Array.isArray(data.cards) ? data.cards
            : (Array.isArray(data.words) ? data.words
              : (Array.isArray(data.list) ? data.list
                : (isSingleCard(data) ? [data] : []))));
        if (arr.length) {
          meta.format = 'json';
          meta.header = true;
          for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            var c;
            if (typeof item === 'string') {
              var sp = item.split(/\t+|\s{2,}/);
              c = makeCard({ word: sp[0], meaning: sp.slice(1).join(' ') });
            } else if (item && typeof item === 'object') {
              c = cardFromObject(item);
            } else {
              c = makeCard({});
            }
            if (c.word) cards.push(c); else meta.skipped++;
          }
          meta.columns = FIELDS.slice();
          return finish(cards, meta);
        }
      }
      /* 不是可用 JSON，继续按文本解析 */
    }

    /* ---- 文本 / 分隔符 ---- */
    var lines = mergeQuotedLines(raw);
    var delim = detectDelimiter(lines);
    meta.delimiter = delim;
    var rows = [];
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (!line.trim()) { meta.blank++; continue; }
      if (!delim) {
        var l2 = stripBullet(line);
        var m = l2.match(/^(\S+)[\s\u3000]+([\s\S]+)$/);
        rows.push(m ? [m[1], m[2]] : [l2]);
      } else {
        rows.push(splitLine(line, delim));
      }
    }
    meta.format = delim ? ({ '\t': 'tsv', '|': 'pipe' }[delim] || 'csv') : 'text';

    var map;
    var h = headerMap(rows[0] || []);
    if (h.hasWord && h.hits >= 2) {
      meta.header = true;
      map = {};
      for (var field in h.map) {
        if (Object.prototype.hasOwnProperty.call(h.map, field)) map[h.map[field]] = field;
      }
      rows = rows.slice(1);
    } else {
      map = guessMap(rows[0] || []);
    }
    meta.columns = Object.keys(map)
      .sort(function (a, b) { return a - b; })
      .map(function (k) { return map[k]; });

    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r];
      if (!cells || !cells.length) { meta.blank++; continue; }
      var obj = {};
      for (var idx in map) {
        if (!Object.prototype.hasOwnProperty.call(map, idx)) continue;
        obj[map[idx]] = cells[idx];
      }
      var card = makeCard(obj);
      if (!card.word || !/[A-Za-z\u4e00-\u9fa5]/.test(card.word)) { meta.skipped++; continue; }
      cards.push(card);
    }
    return finish(cards, meta);
  }

  global.Importer = { parse: parse, normWord: normWord, makeCard: makeCard, dedupe: dedupe, FIELDS: FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Importer;
})(typeof window !== 'undefined' ? window : globalThis);