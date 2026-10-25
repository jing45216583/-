/* WordFlow 发音音源层
 *
 * 系统 TTS（机器音）不好听，所以优先用「词典真人发音」：
 *   英文 → 有道词典 dictvoice（多数是真人录音，美音 type=2 / 英音 type=1）
 *   中文 → 有道 dictvoice 的 le=zh 通道（中文 TTS，音色比手机自带的自然）
 *
 * 为什么用 <audio src> 直接播放、而不是 fetch 成 blob：
 *   有道不发 Access-Control-Allow-Origin，浏览器里 fetch 会被 CORS 拦掉，
 *   但 <audio src> 属于媒体加载，不受 CORS 限制 —— 所以能放，不能缓存成 blob。
 *   播放过的 URL 会留在浏览器 HTTP 缓存里，第二次起就很快。
 *
 * 都失败时返回 null，由 app.js 退回系统 TTS。
 */
(function (global) {
  'use strict';

  function isChinese(text) {
    return /[\u4e00-\u9fa5]/.test(String(text || ''));
  }

  /* 生成在线音源地址：纯函数，方便测试
     · 英文：有道 dictvoice（type=1 英音 / 2 美音），真人录音
     · 中文：有道 dictvoice 的 le=zh 通道（走中文 TTS）
       注意别用 fanyi.baidu.com/gettts —— 它带 Referer 时返回空 html，浏览器里必然失败 */
  function sourceUrl(text, lang) {
    var w = String(text || '').trim();
    if (!w) return '';
    if (isChinese(w)) {
      return 'https://dict.youdao.com/dictvoice?le=zh&audio=' + encodeURIComponent(w);
    }
    var type = (lang === 'en-GB') ? 1 : 2;   /* 1 = 英音，2 = 美音 */
    return 'https://dict.youdao.com/dictvoice?type=' + type + '&audio=' + encodeURIComponent(w);
  }

  var current = null;              /* 当前在播的 Audio，避免两句话叠在一起 */
  var lastMode = '';
  var lastLang = '';
  var failures = Object.create(null);   /* url -> 时间戳：失败过的地址 1 分钟内不再重试 */
  var FAIL_TTL = 60000;
  var warm = [];                   /* 预热的 Audio 对象，最多留 6 个 */

  function stop() {
    if (current) {
      try { current.pause(); current.currentTime = 0; } catch (e) { /* ignore */ }
      current = null;
    }
  }

  function play(url) {
    stop();
    return new Promise(function (resolve) {
      var a;
      try {
        a = new global.Audio();
      } catch (e) {
        resolve(false);
        return;
      }
      current = a;
      var settled = false;
      var finish = function (ok) {
        if (settled) return;
        settled = true;
        a.onended = null;
        a.onerror = null;
        a.oncanplay = null;
        if (!ok && current === a) current = null;
        resolve(ok);
      };
      a.onended = function () { if (current === a) current = null; };
      a.onerror = function () { finish(false); };
      /* 能播就算成功（不等放完），也不阻塞 UI */
      a.oncanplay = function () { finish(true); };
      a.preload = 'auto';
      a.src = url;
      var p = null;
      try { p = a.play(); } catch (e) { p = null; }
      if (p && p.then) {
        p.then(function () { finish(true); }, function () {
          /* 自动播放被拦或解码失败：再等一下 oncanplay，不行就判失败 */
          setTimeout(function () { finish(false); }, 1200);
        });
      } else {
        setTimeout(function () { finish(true); }, 1200);
      }
      /* 兜底：3 秒还没判定就当失败，退回 TTS */
      setTimeout(function () { finish(false); }, 3000);
    });
  }

  /* 主入口：返回 'online' 或 null（null = 该退回系统 TTS） */
  function pronounce(text, lang) {
    var url = sourceUrl(text, lang);
    if (!url) return Promise.resolve(null);
    var failedAt = failures[url];
    if (failedAt && Date.now() - failedAt < FAIL_TTL) return Promise.resolve(null);
    lastLang = String(lang || '');
    return play(url).then(function (ok) {
      if (!ok) {
        failures[url] = Date.now();
        lastMode = '';
        return null;
      }
      lastMode = 'online';
      return 'online';
    }).catch(function () {
      failures[url] = Date.now();
      return null;
    });
  }

  /* 预取：卡片一出现就悄悄加载音频，点发音时几乎立刻出声 */
  function prefetch(text, lang) {
    var url = sourceUrl(text, lang);
    if (!url || !global.Audio) return;
    if (failures[url]) return;
    try {
      var a = new global.Audio();
      a.preload = 'auto';
      a.src = url;
      warm.push(a);
      if (warm.length > 6) {
        var old = warm.shift();
        try { old.src = ''; } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  function stats() {
    return { mode: lastMode, lang: lastLang, failures: Object.keys(failures).length };
  }

  function clearCache() {
    failures = Object.create(null);
    lastMode = '';
  }

  var API = {
    sourceUrl: sourceUrl,
    isChinese: isChinese,
    pronounce: pronounce,
    prefetch: prefetch,
    stop: stop,
    stats: stats,
    clearCache: clearCache
  };

  global.WFAudio = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);