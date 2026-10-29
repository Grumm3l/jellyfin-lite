/* Jellyfin Lite for Samsung TVs with Tizen 2.3 (WebKit 538.1; developed on a UE48J5670)
 * ES5 only: no fetch, no Promise, no let/const, no arrow functions.
 */
(function () {
  'use strict';

  /* ---------- languages ----------
     The texts are written in German; T() returns them in the TV's language
     (translations in i18n.js). {0}, {1} ... are filled with the further
     arguments. */
  var LANG = 'de';
  var TR = null;
  function T(text) {
    var s = (TR && TR[text]) || text;
    for (var i = 1; i < arguments.length; i++) s = s.split('{' + (i - 1) + '}').join(String(arguments[i]));
    return s;
  }

  /* The TV's browser only speaks TLS 1.0. The bundled NaCl module
     (native/dist/tlsproxy_arm.nexe) does TLS 1.2 and serves the server on
     http://127.0.0.1:<port>. Only plain http:// servers (home network) also
     work without it. The addresses are entered on the login screen (see
     "server address" below). */
  var PROXY_PORT = 18080;
  /* Seerr is reached through a second proxy in the NaCl module; sign-in
     uses the Jellyfin account (Quick Connect, approved by the app itself) */
  var SEERR_PORT = 18090;
  var API = '';
  var CLIENT = 'Jellyfin Lite';
  var DEVICE = 'Samsung Smart TV';
  /* random per installation, so several TVs show up as separate devices */
  var DEVICEID = (function () {
    var id = null;
    try {
      id = localStorage.getItem('jf_device');
      if (!id) {
        id = 'jflite-' + Math.random().toString(16).slice(2, 10) + new Date().getTime().toString(16);
        localStorage.setItem('jf_device', id);
      }
    } catch (e) {}
    return id || 'jflite-tv';
  }());
  var VERSION = '0.17.0';
  var AUTH = 'MediaBrowser Client="' + CLIENT + '", Device="' + DEVICE +
             '", DeviceId="' + DEVICEID + '", Version="' + VERSION + '"';
  var REQUEST_TIMEOUT = 20000;
  var TICKS = 10000; /* Jellyfin ticks per millisecond */
  var FIELDS = '&fields=PrimaryImageAspectRatio,ProductionYear,Overview,RunTimeTicks,Trickplay,' +
    'OfficialRating,CommunityRating,SortName' +
    '&imageTypeLimit=1&enableImageTypes=Primary,Backdrop,Thumb';
  var PAGE = 100;
  var SORTS = [
    { label: 'A–Z', by: 'SortName', order: 'Ascending' },
    { label: 'Neu hinzugefügt', by: 'DateCreated,SortName', order: 'Descending,Ascending' },
    { label: 'Erscheinungsjahr', by: 'ProductionYear,PremiereDate,SortName', order: 'Descending,Descending,Ascending' },
    { label: 'Bewertung', by: 'CommunityRating,SortName', order: 'Descending,Ascending' }
  ];

  /* remote control key codes */
  var K_LEFT = 37, K_UP = 38, K_RIGHT = 39, K_DOWN = 40, K_ENTER = 13;
  var K_RED = 403, K_GREEN = 404, K_YELLOW = 405, K_BLUE = 406;
  var K_PLAY = 415, K_PAUSE = 19, K_PLAYPAUSE = 10252, K_STOP = 413;
  var K_FF = 417, K_RW = 412, K_CH_UP = 427, K_CH_DOWN = 428, K_INFO = 457;
  var K_IME_DONE = 65376, K_IME_CANCEL = 65385;

  var content = document.getElementById('content');
  var topbar = document.getElementById('topbar');
  var crumb = document.getElementById('crumb');
  var userEl = document.getElementById('user');
  var topnav = document.getElementById('topnav');
  var tavatar = document.getElementById('tavatar');
  var topEls = [document.getElementById('tsearch'), document.getElementById('tprofile')];
  var subtitleEl = document.getElementById('subtitles');
  var playerMenu = document.getElementById('playerMenu');
  var backdropEl = document.getElementById('backdrop');        /* solid page-colour layer */
  /* optional image on top: two layers that cross-fade */
  var backdropLayers = [document.getElementById('bdA'), document.getElementById('bdB')];
  var backdropFront = 0;
  var clockEl = document.getElementById('clock');
  var hintbar = document.getElementById('hintbar');
  var toast = document.getElementById('toast');
  var playerUi = document.getElementById('playerUi');
  var ptitle = document.getElementById('ptitle');
  var psub = document.getElementById('psub');
  var ptime = document.getElementById('ptime');
  var pend = document.getElementById('pend');
  var progressFill = document.getElementById('progressFill');
  var phint = document.getElementById('phint');
  var pauseIcon = document.getElementById('pauseIcon');
  var seekPreview = document.getElementById('seekPreview');
  var seekImg = document.getElementById('seekImg');
  var seekTime = document.getElementById('seekTime');
  var loadingSpinner = document.getElementById('loadingSpinner');
  var skipBtn = document.getElementById('skipBtn');
  var upNextEl = document.getElementById('upNext');

  var state = {
    token: null,
    userId: null,
    userName: null,
    userImageTag: null,
    topFocus: -1,
    view: 'login',
    navSeq: 0,
    items: [],
    cardEls: [],
    focusEl: null,
    focus: 0,
    columns: 5,
    kind: '',
    title: '',
    basePath: null,
    totalCount: 0,
    loadingMore: false,
    stack: [],
    current: null,
    homeRows: null,
    rowFocus: 0,
    homeDirty: false,
    lib: null,
    libSort: 0,
    libUnplayed: false,
    libTitle: '',
    detailButtons: [],
    detailFocus: 0,
    detailFocusKey: 'play',  /* a button's data-key, or 'cast' */
    cast: null,              /* cast row on the details page */
    castCol: 0,
    tracks: null,            /* album / playlist page */
    trackEls: [],
    trackFocus: -1,
    music: null,             /* music player */
    libArtists: false,       /* music library: artists instead of albums */
    retryFn: null,
    exitArmedAt: 0,
    lastActivate: 0,
    qcSecret: null,
    qcTimer: null,
    loginRows: [],
    loginPos: { r: 0, c: 0 },
    loginIme: false,
    loginBack: null,
    loginScreen: '',
    publicUsers: [],
    calmMode: false,
    autoNext: true,
    overlay: null,
    bgItem: null,
    menuFocus: 0,
    sp: null,
    backdrops: false,
    playReq: 0,
    playLoading: false,
    playerReturn: null,
    playerItem: null,
    playerSource: null,
    playerDuration: 0,
    playerOffset: 0,
    playMethod: 'DirectPlay',
    playSessionId: '',
    mediaSourceId: '',
    sourceChoice: {},  /* item id -> chosen media source (version) */
    startMs: 0,
    playUrl: '',
    isLive: false,      /* playing a TV channel */
    liveStreamId: '',
    liveProgram: null,
    liveNext: null,
    liveProgramsAt: 0,
    liveChannels: null, /* channels to zap through */
    channelDigits: null,
    segments: [],       /* intro / outro etc. of the playing item (ms) */
    skipSeg: null,      /* segment whose skip button is showing */
    upNext: null,       /* 'next episode' overlay near the end */
    lastGoodPos: 0,     /* last position seen playing, to resume after a broken stream */
    recoverTries: 0,
    recoverAt: 0,
    pausedAt: 0,
    bufferingSince: 0,
    reported: false,
    lastReport: 0,
    offsetCheckUntil: 0,
    aacAudioTrack: -1,
    audioIndex: -1,
    subIndex: -1,
    subPref: null,
    subEvents: null,
    subTimer: null,
    subSeq: 0,
    subHtml: '',
    speed: 1,
    displayMode: 0,
    menuStack: [],
    reader: null,
    readerReturn: null,
    triedFallback: false,
    fallbackPending: false,
    playToken: 0,
    prepareTimer: null,
    prepared: false,
    stopping: false,
    playerUiTimer: null,
    playerPaused: false,
    playerUiHideTimer: null,
    seekTarget: null,
    seekTimer: null,
    seekCount: 0,
    seekPreviewTimer: null,
    trickplay: null,
    trickplayCache: {},
    trickplayLastUrl: '',
    trickplayPreloadAt: 0,
    trickplayPending: null
  };
  var toastTimer = null;

  /* ---------- helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function now() { return new Date().getTime(); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtClock(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  function fmtTime(ms) {
    var s = Math.floor((ms || 0) / 1000);
    if (s < 0) s = 0;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    s = s % 60;
    return (h ? h + ':' + pad2(m) : String(m)) + ':' + pad2(s);
  }

  function fmtRuntime(ticks) {
    var min = Math.round(ticks / TICKS / 60000);
    if (min < 60) return T('{0} Min.', min);
    return T('{0} Std. {1} Min.', Math.floor(min / 60), min % 60);
  }

  function errText(err) {
    if (err === 0) return T('Server nicht erreichbar');
    if (err === 'timeout') return T('Zeitüberschreitung');
    if (err === 'json') return T('ungültige Antwort');
    return T('Fehler {0}', err);
  }

  function setFocused(el, on) {
    if (!el) return;
    var c = el.className.replace(/\s*\bfocused\b/g, '');
    el.className = on ? c + ' focused' : c;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function offsetTopIn(node, ancestor) {
    var y = 0;
    while (node && node !== ancestor) {
      y += node.offsetTop;
      node = node.offsetParent;
    }
    return y;
  }

  /* keep a node inside the vertically scrolling #content area */
  function ensureVisible(node) {
    if (!node) return;
    var pad = 30;
    var top = offsetTopIn(node, content);
    var bottom = top + node.offsetHeight;
    var view = content.clientHeight;
    var st = content.scrollTop;
    if (top - pad < st) content.scrollTop = Math.max(0, top - pad);
    else if (bottom + pad > st + view) content.scrollTop = bottom + pad - view;
  }

  function exitApp() {
    try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }

  function confirmExit() {
    var t = now();
    if (t - state.exitArmedAt < 2500) { exitApp(); return; }
    state.exitArmedAt = t;
    showToast(T('Zum Beenden erneut Zurück drücken'));
  }

  /* ---------- persistence ---------- */

  function saveAuth() {
    try {
      localStorage.setItem('jf_auth', JSON.stringify({
        token: state.token,
        userId: state.userId,
        userName: state.userName,
        userImageTag: state.userImageTag
      }));
    } catch (e) {}
  }

  function loadAuth() {
    try {
      var raw = localStorage.getItem('jf_auth');
      if (!raw) return;
      var a = JSON.parse(raw);
      state.token = a.token || null;
      state.userId = a.userId || null;
      state.userName = a.userName || null;
      state.userImageTag = a.userImageTag || null;
    } catch (e) {}
  }

  function clearAuth() {
    state.token = null;
    state.userId = null;
    state.userName = null;
    state.userImageTag = null;
    try { localStorage.removeItem('jf_auth'); } catch (e) {}
  }

  function applyCalm() {
    try { document.body.className = state.calmMode ? 'calm' : ''; } catch (e) {}
  }

  function loadPrefs() {
    try {
      state.calmMode = localStorage.getItem('jf_calm') === '1';
      state.autoNext = localStorage.getItem('jf_autonext') !== '0';
      state.backdrops = localStorage.getItem('jf_backdrops') === '1';
      state.displayMode = parseInt(localStorage.getItem('jf_display'), 10) || 0;
      if (state.displayMode < 0 || state.displayMode > 2) state.displayMode = 0;
    } catch (e) {}
    applyCalm();
  }

  function savePref(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {}
  }

  function toggleCalm() {
    state.calmMode = !state.calmMode;
    applyCalm();
    savePref('jf_calm', state.calmMode);
  }

  function toggleAutoNext() {
    state.autoNext = !state.autoNext;
    savePref('jf_autonext', state.autoNext);
  }


  /* ---------- chrome: toast, crumb, hints, clock ---------- */

  function showToast(msg) {
    toast.textContent = msg;
    toast.className = '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.className = 'hidden'; }, 3500);
  }

  function setCrumb(t) {
    crumb.textContent = t || '';
  }

  var HINT_KEYS = {
    ok: '<b class="key">OK</b>',
    play: '<b class="key">&#9654;</b>',
    back: '<b class="key">ZUR&Uuml;CK</b>',
    arrows: '<b class="key">&#9650;&#9660;</b>',
    digits: '<b class="key">2&ndash;9</b>',
    numbers: '<b class="key">0&ndash;9</b>',
    red: '<i class="ck red"></i>',
    green: '<i class="ck green"></i>',
    yellow: '<i class="ck yellow"></i>',
    blue: '<i class="ck blue"></i>'
  };

  /* parts: [[keyName, label], ...] - labels are static strings */
  function setHints(parts) {
    var html = '';
    var i;
    for (i = 0; parts && i < parts.length; i++) {
      var key = parts[i][0] === 'back' ? '<b class="key">' + esc(T('ZURÜCK')) + '</b>' : HINT_KEYS[parts[i][0]];
      html += '<span class="hint">' + key + ' ' + parts[i][1] + '</span>';
    }
    hintbar.innerHTML = html;
    hintbar.className = html ? '' : 'hidden';
  }

  function setChrome(visible) {
    topbar.className = visible ? '' : 'hidden';
    content.className = visible ? '' : 'hidden';
    backdropEl.style.display = visible ? '' : 'none';
    if (!visible) hintbar.className = 'hidden';
    else if (hintbar.innerHTML) hintbar.className = '';
  }

  /* ---------- top bar: search + profile ---------- */

  var avatarKey = '';

  function setTopnav(visible) {
    if (state.topFocus >= 0) leaveTop(true);
    topnav.style.display = visible ? '' : 'none';
    if (!visible) return;
    userEl.textContent = state.userName || '';
    var key = state.userId + ':' + (state.userImageTag || '');
    if (key === avatarKey) return;
    avatarKey = key;
    tavatar.innerHTML = '';
    tavatar.textContent = (state.userName || '?').charAt(0).toUpperCase();
    if (state.userImageTag) {
      var img = document.createElement('img');
      img.onerror = function () { this.style.display = 'none'; };
      img.src = userImageUrl({ Id: state.userId, PrimaryImageTag: state.userImageTag });
      tavatar.appendChild(img);
    }
  }

  function canUseTop() {
    return !!state.token && topnav.style.display !== 'none' &&
      (state.view === 'home' || state.view === 'library' || state.view === 'series' ||
       state.view === 'season' || state.view === 'details' || state.view === 'seerr' ||
       state.view === 'person' || state.view === 'album' || state.view === 'artist' ||
       state.view === 'message');
  }

  /* move the remote focus from the page content up into the top bar */
  function enterTop() {
    if (!canUseTop()) return false;
    blurContentFocus();
    state.topFocus = 0;
    updateTopFocus();
    return true;
  }

  function updateTopFocus() {
    for (var i = 0; i < topEls.length; i++) setFocused(topEls[i], i === state.topFocus);
  }

  /* quiet: only drop the focus, the view re-renders anyway */
  function leaveTop(quiet) {
    state.topFocus = -1;
    updateTopFocus();
    if (quiet) return;
    if (state.view === 'home') updateHomeFocus();
    else if (state.view === 'details' || state.view === 'seerr') updateDetailFocus();
    else if (state.view === 'album') updateAlbumFocus();
    else if (state.view === 'message') setFocused($('retrybtn'), true);
    else updateFocus();
  }

  function activateTop(idx) {
    leaveTop(true);
    if (idx === 0) openSearchBar();
    else openSettingsMenu();
  }

  function handleTopKey(e, k) {
    e.preventDefault();
    if (k === K_LEFT && state.topFocus > 0) { state.topFocus--; updateTopFocus(); }
    else if (k === K_RIGHT && state.topFocus < topEls.length - 1) { state.topFocus++; updateTopFocus(); }
    else if (k === K_DOWN || isBackKey(k)) leaveTop(false);
    else if (k === K_ENTER) activateTop(state.topFocus);
  }

  topEls[0].onclick = function () { activateTop(0); };
  topEls[1].onclick = function () { activateTop(1); };

  function updateClock() {
    try { clockEl.textContent = fmtClock(new Date()); } catch (e) {}
  }

  /* ---------- HTTP ---------- */

  function sessionExpired() {
    if (!state.token) return;
    if (state.view === 'player') stopPlayback();
    clearAuth();
    state.stack = [];
    showLogin(T('Sitzung abgelaufen. Bitte neu anmelden.'));
  }

  function api(method, path, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    var timer = null;
    function finish(err, txt) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (err === 401 && state.token && path.indexOf('/Users/Authenticate') !== 0) {
        sessionExpired();
        return;
      }
      if (cb) cb(err, txt);
    }
    try {
      x.open(method, API + path, true);
      var auth = AUTH;
      if (state.token) auth += ', Token="' + state.token + '"';
      x.setRequestHeader('Authorization', auth);
      if (body) x.setRequestHeader('Content-Type', 'application/json');
    } catch (e) {
      setTimeout(function () { finish(0, String(e)); }, 0);
      return;
    }
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status >= 200 && x.status < 300) finish(null, x.responseText);
      else finish(x.status, x.responseText);
    };
    timer = setTimeout(function () {
      finish('timeout', '');
      try { x.abort(); } catch (e) {}
    }, REQUEST_TIMEOUT);
    try { x.send(body ? JSON.stringify(body) : null); }
    catch (e) { finish(0, String(e)); }
  }

  function getJson(path, cb) {
    api('GET', path, null, function (err, txt) {
      if (err) { cb(err); return; }
      try { cb(null, txt ? JSON.parse(txt) : null); }
      catch (e) { cb('json'); }
    });
  }

  /* Jellyfin 10.9 moved several /Users/{id}/... routes. Try the new one first. */
  function getJsonAlt(path, legacyPath, cb) {
    getJson(path, function (err, data) {
      if (err === 404 && legacyPath) { getJson(legacyPath, cb); return; }
      cb(err, data);
    });
  }

  function apiAlt(method, path, legacyPath, cb) {
    api(method, path, null, function (err, txt) {
      if (err === 404 && legacyPath) { api(method, legacyPath, null, cb); return; }
      cb(err, txt);
    });
  }

  function uidParam() { return 'userId=' + encodeURIComponent(state.userId); }

  /* ---------- simple screens ---------- */

  function showLoading(msg) {
    content.innerHTML = '<div class="loading">' + esc(msg || T('Lade ...')) + '</div>';
  }

  function showError(msg) {
    content.innerHTML = '<div class="error">' + esc(msg) + '</div>';
  }

  function showRetry(msg, fn) {
    state.view = 'message';
    state.navSeq++;
    state.retryFn = fn;
    state.items = [];
    state.cardEls = [];
    setChrome(true);
    content.innerHTML = '<div class="error">' + esc(msg) + '</div>' +
      '<div class="center"><div class="btn primary focused" id="retrybtn">Erneut versuchen</div></div>';
    $('retrybtn').onclick = fn;
    setHints([['ok', T('Erneut versuchen')], ['blue', T('Einstellungen')], ['back', T('Beenden')]]);
  }

  /* ---------- item helpers ---------- */

  var TYPE_NAMES = {
    Movie: 'Film', Series: 'Serie', Episode: 'Folge', Season: 'Staffel',
    BoxSet: 'Sammlung', Video: 'Video', MusicVideo: 'Musikvideo', Book: 'Buch',
    MusicAlbum: 'Album', Folder: 'Ordner', MusicArtist: 'Künstler', Playlist: 'Playlist', Audio: 'Titel', TvChannel: 'Sender'
  };

  function episodeCode(item) {
    if (item.ParentIndexNumber === undefined || item.ParentIndexNumber === null || !item.IndexNumber) return '';
    return 'S' + item.ParentIndexNumber + 'E' + item.IndexNumber;
  }

  function metaText(item, withType) {
    var parts = [];
    if (withType && TYPE_NAMES[item.Type]) parts.push(T(TYPE_NAMES[item.Type]));
    if (item.Type === 'Episode') {
      if (withType && item.SeriesName) parts.push(item.SeriesName);
      var se = episodeCode(item);
      if (se) parts.push(se);
    } else if (item.Type === 'MusicAlbum' || item.Type === 'Audio') {
      var by = item.AlbumArtist || (item.Artists || []).join(', ');
      if (by) parts.push(by);
      if (item.ProductionYear) parts.push(String(item.ProductionYear));
      return parts.join('  ·  ');
    } else if (item.ProductionYear) {
      parts.push(String(item.ProductionYear));
    }
    var minutes = item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS / 60000) : 0;
    if (minutes > 0 && item.Type !== 'Series' && item.Type !== 'Book') parts.push(T('{0} Min.', minutes));
    return parts.join('  ·  ');
  }

  function resumeMs(item) {
    var ud = item && item.UserData;
    if (!ud || ud.Played || !ud.PlaybackPositionTicks) return 0;
    return Math.floor(ud.PlaybackPositionTicks / TICKS);
  }

  function imageUrl(id, type, tag, height) {
    var url = API + '/Items/' + id + '/Images/' + type + '?maxHeight=' + height +
              '&ApiKey=' + encodeURIComponent(state.token);
    if (tag) url += '&tag=' + encodeURIComponent(tag);
    return url;
  }

  function posterUrl(item, height) {
    var tag = (item.ImageTags && item.ImageTags.Primary) || item.PrimaryImageTag || '';
    return imageUrl(item.Id, 'Primary', tag, height);
  }

  function backdropUrl(item, height) {
    var tags = item.BackdropImageTags || [];
    if (!tags.length) return '';
    return imageUrl(item.Id, 'Backdrop', tags[0], height);
  }

  /* landscape artwork for "continue watching" style cards */
  function wideImageUrl(item, height) {
    var tags = item.ImageTags || {};
    if (item.Type === 'Episode' && tags.Primary) return imageUrl(item.Id, 'Primary', tags.Primary, height);
    if (tags.Thumb) return imageUrl(item.Id, 'Thumb', tags.Thumb, height);
    if (item.BackdropImageTags && item.BackdropImageTags.length) return backdropUrl(item, height);
    if (item.ParentThumbItemId && item.ParentThumbImageTag) {
      return imageUrl(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag, height);
    }
    if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
      return imageUrl(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], height);
    }
    return posterUrl(item, height);
  }

  function isLandscape(item) {
    return !!(item && (item.Type === 'Episode' ||
      (item.PrimaryImageAspectRatio && item.PrimaryImageAspectRatio > 1.1)));
  }

  /* album covers, artist photos */
  function isSquare(item) {
    if (!item) return false;
    if (item.Type === 'MusicAlbum' || item.Type === 'MusicArtist' || item.Type === 'Audio' || isTrackList(item)) return true;
    var r = item.PrimaryImageAspectRatio;
    return !!r && r > 0.9 && r < 1.1;
  }

  function isPlayable(item) {
    return !!(item && (item.Type === 'Movie' || item.Type === 'Episode' ||
      item.Type === 'Video' || item.Type === 'MusicVideo' || item.Type === 'Trailer' || item.Type === 'TvChannel'));
  }

  /* ---------- server address ---------- */

  /* "jellyfin.example.com", "https://host:8920/jf", "192.168.1.10:8096" ->
     { scheme, host, port, path, url }, or null if it isn't an address */
  function parseAddress(text) {
    var s = String(text || '').replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = (/:8096$/.test(s) ? 'http://' : 'https://') + s;
    var m = s.match(/^(https?):\/\/(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.\-]+)(?::(\d{1,5}))?(\/[^\s?#]*)?$/i);
    if (!m) return null;
    var scheme = m[1].toLowerCase();
    var def = scheme === 'https' ? 443 : 80;
    var port = m[3] ? parseInt(m[3], 10) : def;
    if (!port || port > 65535) return null;
    var host = m[2].toLowerCase();
    var path = m[4] || '';
    return { scheme: scheme, host: host, port: port, path: path,
      url: scheme + '://' + host + (port !== def ? ':' + port : '') + path };
  }

  /* server addresses, entered on the login screen and kept on the TV */
  var server = { jf: null, seerr: null };

  function savedServer() {
    try { return JSON.parse(localStorage.getItem('jf_server') || 'null') || {}; } catch (e) { return {}; }
  }

  function loadServer() {
    var c = savedServer();
    server.jf = parseAddress(c.url);
    server.seerr = parseAddress(c.seerr);
  }

  /* without the NaCl module only http:// servers can be reached */
  function directApi() {
    return server.jf && server.jf.scheme === 'http' ? server.jf.url : '';
  }

  function moduleHost(a) { return a.host.replace(/^\[|\]$/g, ''); }

  function serverLine() {
    return server.jf ? server.jf.url.replace(/^https?:\/\//, '') : '';
  }

  /* ---------- login ----------
     Login screens are rows of focusable elements: ▲▼ switch rows (to the
     element closest below/above), ◀▶ move inside a row. */

  function setLoginRows(rows, r, c) {
    var clean = [];
    for (var i = 0; i < rows.length; i++) if (rows[i] && rows[i].length) clean.push(rows[i]);
    state.loginRows = clean;
    state.loginPos = { r: 0, c: 0 };
    focusLoginAt(r || 0, c || 0);
  }

  function loginEl() {
    var p = state.loginPos;
    var row = state.loginRows && p ? state.loginRows[p.r] : null;
    return row ? row[p.c] : null;
  }

  function focusLoginAt(r, c) {
    var rows = state.loginRows || [];
    if (!rows.length) return;
    r = Math.max(0, Math.min(r, rows.length - 1));
    c = Math.max(0, Math.min(c, rows[r].length - 1));
    var old = loginEl();
    if (old) setFocused(old, false);
    state.loginPos = { r: r, c: c };
    var cur = rows[r][c];
    setFocused(cur, true);
    try { cur.scrollIntoView(false); } catch (e) {}
  }

  function focusLoginElement(node) {
    var rows = state.loginRows || [];
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === node) { focusLoginAt(r, c); return; }
      }
    }
  }

  function updateLoginFocus() {
    var cur = loginEl();
    if (cur) setFocused(cur, true);
  }

  function centerX(node) {
    var b = node.getBoundingClientRect();
    return b.left + b.width / 2;
  }

  function moveLoginRow(d) {
    var rows = state.loginRows || [];
    var nr = state.loginPos.r + d;
    if (nr < 0 || nr >= rows.length) return;
    var cur = loginEl();
    var x = cur ? centerX(cur) : 0;
    var best = 0;
    var bestDist = 1e9;
    for (var i = 0; i < rows[nr].length; i++) {
      var dist = Math.abs(centerX(rows[nr][i]) - x);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    focusLoginAt(nr, best);
  }

  function userImageUrl(u) {
    var url = API + '/UserImage?userId=' + encodeURIComponent(u.Id) + '&format=Jpg';
    if (u.PrimaryImageTag) url += '&tag=' + encodeURIComponent(u.PrimaryImageTag);
    return url;
  }

  function openKeyboard(input) {
    try { input.focus(); input.click(); } catch (e) {}
  }

  /* like the search field: the app tracks whether the keyboard is open */
  function openLoginKeyboard(input) {
    state.loginIme = true;
    hintbar.className = 'hidden';
    openKeyboard(input);
  }

  function closeLoginKeyboard() {
    state.loginIme = false;
    dropTextFocus(document.activeElement);
    if (hintbar.innerHTML) hintbar.className = '';
  }

  /* common frame of all login screens */
  function loginShell(title, sub, message, back) {
    state.view = 'login';
    state.navSeq++;
    if (state.overlay) closeOverlay();
    clearBackdrop();
    stopQuickConnect();
    state.loginIme = false;
    state.loginBack = back || null;
    state.loginScreen = '';
    state.items = [];
    state.cardEls = [];
    setChrome(true);
    setTopnav(false);
    setCrumb('');
    setHints([['ok', T('Auswählen')], ['back', back ? T('Zurück') : T('Beenden')]]);
    content.scrollTop = 0;
    content.innerHTML = '';
    var box = el('div', 'loginbox');
    box.appendChild(el('div', 'logintitle', title));
    if (sub) box.appendChild(el('div', 'loginsub', sub));
    if (message) box.appendChild(el('div', 'loginmsg', message));
    content.appendChild(box);
    return box;
  }

  function loginField(box, id, label, value, type) {
    if (label) box.appendChild(el('div', 'loginlabel', label));
    var f = document.createElement('input');
    f.className = 'field';
    f.id = id;
    f.type = type || 'text';
    f.value = value || '';
    f.setAttribute('autocomplete', 'off');
    f.setAttribute('autocapitalize', 'off');
    f.setAttribute('spellcheck', 'false');
    box.appendChild(f);
    return f;
  }

  function loginButton(row, label, cls, action) {
    var b = el('div', 'btn' + (cls ? ' ' + cls : ''), label);
    b.tabIndex = 0;
    b.onclick = action;
    row.appendChild(b);
    return b;
  }

  /* first start, or "Server ändern" */
  function showServerSetup(message, values) {
    var saved = savedServer();
    var v = values || { url: saved.url || '', seerr: saved.seerr || '' };
    var box = loginShell(T('Mit Server verbinden'),
      T('z. B. jellyfin.example.com oder http://192.168.1.10:8096'),
      message, server.jf ? function () { showLogin(); } : null);
    box.className = 'loginbox wide';
    var url = loginField(box, 'srvurl', T('Server-Adresse'), v.url);
    var seerrField = loginField(box, 'srvseerr', T('Seerr (optional, für Anfragen)'), v.seerr);
    url.jfDone = function () { focusLoginElement(ok); };
    var btns = el('div', 'loginbtns');
    var ok = loginButton(btns, T('Verbinden'), 'primary', saveServerSetup);
    var cancel = server.jf ? loginButton(btns, T('Abbrechen'), '', function () { showLogin(); }) : null;
    box.appendChild(btns);
    setLoginRows([[url], [seerrField], cancel ? [ok, cancel] : [ok]], 0, 0);
  }

  function saveServerSetup() {
    var values = { url: $('srvurl').value, seerr: $('srvseerr').value };
    var a = parseAddress(values.url);
    var s = parseAddress(values.seerr);
    if (!a) { showServerSetup(T('Bitte eine gültige Server-Adresse eingeben.'), values); return; }
    if (values.seerr.replace(/\s/g, '') && !s) { showServerSetup(T('Die Seerr-Adresse ist ungültig.'), values); return; }
    var old = savedServer();
    var oldJf = parseAddress(old.url);
    var oldSeerr = parseAddress(old.seerr);
    if (!oldJf || oldJf.url !== a.url) {
      /* another server: the old login doesn't apply */
      if (state.token) api('POST', '/Sessions/Logout', null, null);
      clearAuth();
    }
    if (!s || !oldSeerr || oldSeerr.url !== s.url) {
      try { localStorage.removeItem('jf_seerr_cookies'); } catch (e) {}
    }
    try {
      localStorage.setItem('jf_server', JSON.stringify({ url: a.url, seerr: s ? s.url : '' }));
    } catch (e2) {}
    /* the NaCl module connects at start-up: restart the app */
    showLoading(T('Verbinde mit {0} ...', a.host));
    setTimeout(function () { window.location.reload(); }, 300);
  }

  /* profile selection (or the user name form if the server lists no users) */
  function showLogin(message) {
    if (!server.jf) { showServerSetup(message); return; }
    var users = state.publicUsers || [];
    var box = loginShell(users.length ? T('Wer schaut?') : T('Anmelden'), serverLine(), message, null);
    state.loginScreen = 'main';
    var rows = [];
    var userField = null;
    var passField = null;
    if (users.length) {
      /* up to 7 per row; more users are split into even rows (8 -> 4 + 4) */
      var lines = Math.ceil(users.length / 7);
      var perRow = Math.ceil(users.length / lines);
      box.className = 'loginbox people' + (lines > 1 ? ' compact' : '');
      var wrap = el('div', 'profiles');
      for (var i = 0; i < users.length; i += perRow) {
        var line = el('div', 'profilerow');
        var cards = [];
        for (var j = i; j < Math.min(users.length, i + perRow); j++) cards.push(line.appendChild(makeProfileCard(users[j])));
        wrap.appendChild(line);
        rows.push(cards);
      }
      box.appendChild(wrap);
    } else {
      userField = loginField(box, 'luser', T('Benutzername'), '');
      passField = loginField(box, 'lpass', T('Passwort'), '', 'password');
      userField.jfDone = function () { focusLoginElement(passField); openLoginKeyboard(passField); };
      passField.jfDone = function () { login(userField.value, passField.value, false, showLogin); };
      rows.push([userField], [passField]);
    }
    var btns = el('div', 'loginbtns');
    var b = [];
    if (users.length) b.push(loginButton(btns, T('Anderer Benutzer'), '', function () { showManualLogin(); }));
    else b.push(loginButton(btns, T('Anmelden'), 'primary', function () { login(userField.value, passField.value, false, showLogin); }));
    b.push(loginButton(btns, T('Quick Connect'), '', startQuickConnect));
    b.push(loginButton(btns, T('Server ändern'), '', function () { showServerSetup(); }));
    box.appendChild(btns);
    rows.push(b);
    box.appendChild(el('div', 'loginstatus', T('Verbindung: {0}', proxy.info) + '  ·  Jellyfin Lite ' + VERSION));
    setLoginRows(rows, 0, 0);
    loadPublicUsers();
  }

  function makeAvatar(u, cls) {
    var av = el('div', 'profileavatar' + (cls ? ' ' + cls : ''), (u.Name || '?').charAt(0).toUpperCase());
    if (u.PrimaryImageTag) {
      var img = document.createElement('img');
      img.onerror = function () { this.style.display = 'none'; };
      img.src = userImageUrl(u);
      av.appendChild(img);
    }
    return av;
  }

  function makeProfileCard(u) {
    var card = el('div', 'profilecard');
    card.tabIndex = 0;
    card.appendChild(makeAvatar(u));
    card.appendChild(el('div', 'profilename', u.Name || ''));
    card.onclick = function () {
      if (u.HasPassword === false) login(u.Name || '', '', true, showLogin);
      else showPasswordLogin(u);
    };
    return card;
  }

  function showPasswordLogin(u, message) {
    var box = loginShell(u.Name || '', serverLine(), message, function () { showLogin(); });
    box.insertBefore(makeAvatar(u, 'big'), box.firstChild);
    var pass = loginField(box, 'lpass', T('Passwort'), '', 'password');
    var btns = el('div', 'loginbtns');
    function go() { login(u.Name || '', pass.value, false, function (msg) { showPasswordLogin(u, msg); }); }
    pass.jfDone = go;
    var ok = loginButton(btns, T('Anmelden'), 'primary', go);
    var back = loginButton(btns, T('Zurück'), '', function () { showLogin(); });
    box.appendChild(btns);
    setLoginRows([[pass], [ok, back]], 0, 0);
    openLoginKeyboard(pass);
  }

  function showManualLogin(message, prefill) {
    var box = loginShell(T('Anmelden'), serverLine(), message, function () { showLogin(); });
    var user = loginField(box, 'luser', T('Benutzername'), prefill || '');
    var pass = loginField(box, 'lpass', T('Passwort'), '', 'password');
    var btns = el('div', 'loginbtns');
    function go() {
      login(user.value, pass.value, false, function (msg) { showManualLogin(msg, user.value); });
    }
    user.jfDone = function () { focusLoginElement(pass); openLoginKeyboard(pass); };
    pass.jfDone = go;
    var ok = loginButton(btns, T('Anmelden'), 'primary', go);
    var back = loginButton(btns, T('Zurück'), '', function () { showLogin(); });
    box.appendChild(btns);
    setLoginRows([[user], [pass], [ok, back]], prefill ? 1 : 0, 0);
  }

  /* the user list; the profile screen is redrawn if it changed */
  function loadPublicUsers() {
    var nav = state.navSeq;
    getJson('/Users/Public?t=' + now(), function (err, list) {
      if (nav !== state.navSeq || state.view !== 'login' || state.loginScreen !== 'main') return;
      if (err) {
        var msg = content.querySelector('.loginmsg');
        if (!msg && !(state.publicUsers && state.publicUsers.length)) {
          msg = el('div', 'loginmsg', T('Server nicht erreichbar ({0}). Adresse prüfen mit „Server ändern“.', errText(err)));
          var sub = content.querySelector('.loginsub');
          if (sub && sub.parentNode) sub.parentNode.insertBefore(msg, sub.nextSibling);
        }
        return;
      }
      var users = (list && list.length) ? list : [];
      var key = function (l) { var s = ''; for (var i = 0; i < l.length; i++) s += l[i].Id + (l[i].PrimaryImageTag || '') + ','; return s; };
      if (key(users) === key(state.publicUsers || [])) return;
      state.publicUsers = users;
      if (!state.loginIme) {
        var msgEl = content.querySelector('.loginmsg');
        showLogin(msgEl ? msgEl.textContent : undefined);
      }
    });
  }

  /* onError(message) shows the screen the login came from again */
  function login(user, pass, allowEmptyPassword, onError) {
    var back = onError || showLogin;
    if (!user || (!pass && !allowEmptyPassword)) {
      back(T('Bitte Benutzername und Passwort eingeben.'));
      return;
    }
    showLoading(T('Anmeldung ...'));
    api('POST', '/Users/AuthenticateByName', { Username: user, Pw: pass }, function (err, txt) {
      if (err) {
        back(err === 401 ? T('Benutzername oder Passwort falsch.') :
          T('Anmeldung fehlgeschlagen ({0}).', errText(err)));
        return;
      }
      loginDone(txt);
    });
  }

  function loginDone(txt) {
    var r;
    try { r = JSON.parse(txt); } catch (e) { showLogin(T('Ungültige Anmeldeantwort.')); return; }
    state.token = r.AccessToken;
    state.userId = r.User ? r.User.Id : null;
    state.userName = r.User ? r.User.Name : null;
    state.userImageTag = r.User ? r.User.PrimaryImageTag || null : null;
    saveAuth();
    loadHome();
  }

  /* ---------- quick connect ---------- */

  function stopQuickConnect() {
    state.qcSecret = null;
    if (state.qcTimer) { clearTimeout(state.qcTimer); state.qcTimer = null; }
  }

  function startQuickConnect() {
    showLoading(T('Quick Connect wird vorbereitet ...'));
    api('POST', '/QuickConnect/Initiate', null, function (err, txt) {
      if (err) {
        showLogin(err === 401 || err === 403 ?
          T('Quick Connect ist auf dem Server deaktiviert.') :
          T('Quick Connect ist nicht verf\u00fcgbar ({0}).', errText(err)));
        return;
      }
      var q;
      try { q = JSON.parse(txt); } catch (e) { showLogin(T('Ung\u00fcltige Antwort.')); return; }
      renderQuickConnect(q.Code);
      state.qcSecret = q.Secret;
      pollQuickConnect();
    });
  }

  function renderQuickConnect(code) {
    var box = loginShell(T('Quick Connect'), T('Jellyfin auf Handy oder PC \u00f6ffnen \u2192 Benutzermen\u00fc \u2192 Quick Connect \u2192 diesen Code eingeben:'), null, function () { showLogin(); });
    box.appendChild(el('div', 'code', code));
    box.appendChild(el('div', 'loginsub', T('Warte auf Freigabe ...')));
    var btns = el('div', 'loginbtns');
    var cancel = loginButton(btns, T('Abbrechen'), '', function () { showLogin(); });
    box.appendChild(btns);
    setLoginRows([[cancel]], 0, 0);
  }

  function pollQuickConnect() {
    if (!state.qcSecret) return;
    state.qcTimer = setTimeout(function () {
      if (!state.qcSecret) return;
      var secret = state.qcSecret;
      getJson('/QuickConnect/Connect?secret=' + encodeURIComponent(secret), function (err, q) {
        if (state.qcSecret !== secret) return;
        if (err) {
          if (err === 404 || err === 400) {
            state.qcSecret = null;
            showLogin(T('Der Quick-Connect-Code ist abgelaufen.'));
          } else {
            pollQuickConnect();
          }
          return;
        }
        if (q && q.Authenticated) authenticateQuickConnect();
        else pollQuickConnect();
      });
    }, 2000);
  }

  function authenticateQuickConnect() {
    var secret = state.qcSecret;
    api('POST', '/Users/AuthenticateWithQuickConnect', { Secret: secret }, function (err, txt) {
      if (state.qcSecret !== secret) return;
      state.qcSecret = null;
      if (state.qcTimer) { clearTimeout(state.qcTimer); state.qcTimer = null; }
      if (err) {
        showLogin(T('Quick-Connect-Anmeldung fehlgeschlagen ({0}).', errText(err)));
        return;
      }
      loginDone(txt);
    });
  }

  /* ---------- settings ---------- */

  function logout() {
    if (state.qcTimer) { clearTimeout(state.qcTimer); state.qcTimer = null; }
    if (state.token) api('POST', '/Sessions/Logout', null, null);
    clearAuth();
    state.stack = [];
    state.homeRows = null;
    state.current = null;
    showLogin(T('Abgemeldet.'));
  }

  /* ---------- overlays: settings menu and search bar ---------- */

  /* hide the page's focus frame while an overlay or the top bar has focus */
  function blurContentFocus() {
    if (state.focusEl) setFocused(state.focusEl, false);
    var i;
    for (i = 0; i < state.detailButtons.length; i++) setFocused(state.detailButtons[i], false);
    for (i = 0; state.view === 'album' && i < state.trackEls.length; i++) setFocused(state.trackEls[i], false);
    if ($('retrybtn')) setFocused($('retrybtn'), false);
  }

  function closeOverlay() {
    var was = state.overlay;
    if (!was) return;
    state.overlay = null;
    if (was === 'search') {
      var input = $('tsinput');
      var hints = state.sp ? state.sp.hints : null;
      if (state.sp) state.sp.ime = false;
      dropTextFocus(input);
      input.className = '';
      if (topbar.className === 'searching') topbar.className = '';
      $('searchPanel').className = 'hidden';
      if (state.sp && state.sp.timer) clearTimeout(state.sp.timer);
      state.sp = null;
      if (hints !== null) { hintbar.innerHTML = hints; hintbar.className = hints ? '' : 'hidden'; }
      viewBackdrop();  /* search results changed the backdrop */
    } else {
      $('settingsMenu').className = 'hidden';
      $('settingsMenu').innerHTML = '';
    }
    if (state.view === 'login') updateLoginFocus();
    else leaveTop(false);
  }

  /* settings: a drop-down under the profile instead of a page */
  function settingsItems() {
    var items = [
      { label: T('Nächste Folge automatisch'), value: state.autoNext ? T('Ein') : T('Aus'), action: toggleAutoNext },
      { label: T('Hintergrundbilder'), value: state.backdrops ? T('Ein') : T('Aus'), action: toggleBackdrops },
      { label: T('Ruhige Darstellung'), value: state.calmMode ? T('Ein') : T('Aus'), action: toggleCalm }
    ];
    if (state.token) {
      items.push({ label: T('Abmelden'), danger: true, action: function () { closeOverlay(); logout(); } });
    }
    return items;
  }

  function openSettingsMenu() {
    if (state.overlay) closeOverlay();
    if (state.topFocus >= 0) { state.topFocus = -1; updateTopFocus(); }
    blurContentFocus();
    state.overlay = 'menu';
    state.menuFocus = 0;
    renderSettingsMenu();
  }

  function renderSettingsMenu() {
    var items = settingsItems();
    if (state.menuFocus >= items.length) state.menuFocus = items.length - 1;
    var html = '<div class="pmtitle">' + esc(state.token ? (state.userName || T('Profil')) : T('Einstellungen')) + '</div>';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      html += '<div class="pmrow' + (i === state.menuFocus ? ' focused' : '') + (it.danger ? ' danger' : '') + '">' +
        '<span class="pmlabel">' + esc(it.label) + '</span>' +
        (it.value !== undefined ? '<span class="pmvalue">' + esc(it.value) + '</span>' : '') + '</div>';
    }
    html += '<div class="pmfoot">' + esc(T('Verbindung: {0}', proxy.info)) + '<br>Jellyfin Lite ' + esc(VERSION) +
      '  ·  ' + esc(server.jf ? server.jf.host : '') + '</div>';
    var m = $('settingsMenu');
    m.innerHTML = html;
    m.className = '';
  }

  function handleMenuOverlayKey(e, k) {
    e.preventDefault();
    var items = settingsItems();
    if (k === K_UP && state.menuFocus > 0) { state.menuFocus--; renderSettingsMenu(); }
    else if (k === K_DOWN && state.menuFocus < items.length - 1) { state.menuFocus++; renderSettingsMenu(); }
    else if (k === K_ENTER) {
      if (now() - state.lastActivate < 350) return;
      state.lastActivate = now();
      items[state.menuFocus].action();
      if (state.overlay === 'menu') renderSettingsMenu();
    } else if (isBackKey(k) || k === K_LEFT || k === K_BLUE) {
      closeOverlay();
    }
  }

  /* a list to pick one entry from (e.g. the version of a movie), shown in
     the middle of the screen; onPick(index) */
  function openChoice(title, labels, focus, onPick) {
    if (state.overlay) closeOverlay();
    blurContentFocus();
    state.overlay = 'choice';
    state.choice = { title: title, labels: labels, focus: focus, current: focus, onPick: onPick };
    renderChoice();
  }

  function renderChoice() {
    var c = state.choice;
    var html = '<div class="pmtitle">' + esc(c.title) + '</div>';
    for (var i = 0; i < c.labels.length; i++) {
      html += '<div class="pmrow' + (i === c.focus ? ' focused' : '') + '">' +
        '<span class="pmcheck">' + (i === c.current ? '✓' : '') + '</span>' +
        '<span class="pmlabel">' + esc(c.labels[i]) + '</span></div>';
    }
    var m = $('settingsMenu');
    m.innerHTML = html;
    m.className = 'choice';
  }

  function handleChoiceKey(e, k) {
    e.preventDefault();
    var c = state.choice;
    if (k === K_UP && c.focus > 0) { c.focus--; renderChoice(); }
    else if (k === K_DOWN && c.focus < c.labels.length - 1) { c.focus++; renderChoice(); }
    else if (k === K_ENTER) {
      if (now() - state.lastActivate < 350) return;
      state.lastActivate = now();
      closeOverlay();
      c.onPick(c.focus);
    } else if (isBackKey(k) || k === K_LEFT) {
      closeOverlay();
    }
  }

  /* search: a field expands in the top bar, results drop down below it in
     up to two rows: the library and (if available) Seerr */
  function openSearchBar() {
    if (!state.token) return;
    if (state.overlay) closeOverlay();
    if (state.topFocus >= 0) { state.topFocus = -1; updateTopFocus(); }
    blurContentFocus();
    state.overlay = 'search';
    state.sp = { rows: [], row: -1, term: '', seq: 0, timer: null, ime: false,
      hints: hintbar.innerHTML };
    var input = $('tsinput');
    input.value = '';
    input.className = 'open';
    topbar.className = 'searching';
    renderSearchPanel(T('Ab 2 Zeichen wird gesucht.'));
    updateSearchBarFocus();
    openSearchKeyboard();
  }

  /* The on-screen keyboard's state is tracked here: after "Abbrechen" on the
     Tizen keyboard the field keeps the browser focus although the keyboard is
     gone, so document.activeElement can't tell whether the user is typing. */
  function openSearchKeyboard() {
    var sp = state.sp;
    if (!sp) return;
    sp.ime = true;
    hintbar.className = 'hidden';  /* the hints make no sense while typing */
    openKeyboard($('tsinput'));
  }

  function closeSearchKeyboard() {
    var sp = state.sp;
    dropTextFocus($('tsinput'));
    if (!sp) return;
    sp.ime = false;
    setSearchHints();
  }

  function setSearchHints() {
    var sp = state.sp;
    if (!sp || sp.ime) return;
    if (sp.row === -1) setHints([['ok', T('Eingeben')], ['back', T('Suche schlie\u00dfen')]]);
    else setHints([['ok', T('\u00d6ffnen')], ['play', T('Abspielen')], ['back', T('Suche schlie\u00dfen')]]);
  }

  /* blur() alone doesn't always release the field on the TV */
  function dropTextFocus(input) {
    if (document.activeElement !== input) return;
    try { input.blur(); } catch (e) {}
    if (document.activeElement === input) { try { $('focussink').focus(); } catch (e2) {} }
  }

  function renderSearchPanel(status) {
    var sp = state.sp;
    var box = $('sprows');
    box.innerHTML = '';
    for (var r = 0; r < sp.rows.length; r++) {
      var row = sp.rows[r];
      var rowEl = el('div', 'sprow');
      rowEl.appendChild(el('div', 'sptitle', row.title));
      var scroller = el('div', 'rowscroll');
      var inner = el('div', 'rowinner');
      row.els = [];
      row.shift = 0;
      if (typeof row.col !== 'number' || row.col >= row.items.length) row.col = 0;
      for (var i = 0; i < row.items.length; i++) {
        var item = row.items[i];
        var card = item.seerr ? makeSeerrCard(item) : makeCard(item, 'items', { showType: true });
        inner.appendChild(card);
        row.els.push(card);
      }
      scroller.appendChild(inner);
      rowEl.appendChild(scroller);
      box.appendChild(rowEl);
      row.scrollEl = scroller;
      row.innerEl = inner;
    }
    if (sp.row >= sp.rows.length) sp.row = sp.rows.length - 1;
    $('spstatus').textContent = status;
    $('searchPanel').className = '';
  }

  function updateSearchBarFocus() {
    var sp = state.sp;
    setFocused($('tsinput'), sp.row === -1);
    for (var r = 0; r < sp.rows.length; r++) {
      for (var i = 0; i < sp.rows[r].els.length; i++) {
        setFocused(sp.rows[r].els[i], r === sp.row && i === sp.rows[r].col);
      }
    }
    var row = sp.rows[sp.row];
    if (!row) return;
    var card = row.els[row.col];
    var view = row.scrollEl.clientWidth;
    var left = card.offsetLeft + row.shift;
    var right = left + card.offsetWidth;
    var shift = row.shift;
    if (left - 40 < shift) shift = Math.max(0, left - 40);
    else if (right + 40 > shift + view) shift = right + 40 - view;
    if (shift !== row.shift) {
      row.shift = shift;
      row.innerEl.style.marginLeft = (-shift) + 'px';
    }
    var it = row.items[row.col];
    setBackdrop(it.seerr ? { __backdrop: it.backdrop } : it);
  }

  function searchStatus(sp) {
    var n = 0;
    for (var r = 0; r < sp.rows.length; r++) n += sp.rows[r].items.length;
    if (sp.pending) return T('Suche ...');
    if (!n) return T('Keine Treffer für „{0}“.', sp.term);
    return T('{0} Treffer für „{1}“', n, sp.term);
  }

  /* library and Seerr are searched in parallel; each row appears when ready */
  function runSearchBar(term) {
    var sp = state.sp;
    if (!sp) return;
    if (sp.timer) { clearTimeout(sp.timer); sp.timer = null; }
    term = (term || '').replace(/^\s+|\s+$/g, '');
    if (term === sp.term) return;
    sp.term = term;
    var seq = ++sp.seq;
    sp.rows = [];
    sp.row = -1;
    if (term.length < 2) {
      sp.pending = 0;
      renderSearchPanel(T('Ab 2 Zeichen wird gesucht.'));
      updateSearchBarFocus();
      return;
    }
    var lib = null;
    var ext = null;
    sp.pending = seerr.state === 'ready' ? 2 : 1;
    function show() {
      if (state.sp !== sp || seq !== sp.seq) return;
      var focusedKey = sp.rows[sp.row] ? sp.rows[sp.row].key : '';
      sp.rows = [];
      if (lib && lib.length) sp.rows.push({ key: 'lib', title: T('In der Bibliothek'), items: lib });
      if (ext && ext.length) sp.rows.push({ key: 'seerr', title: T('Bei Seerr'), items: ext });
      sp.row = -1;
      for (var r = 0; r < sp.rows.length; r++) if (sp.rows[r].key === focusedKey) sp.row = r;
      renderSearchPanel(searchStatus(sp));
      updateSearchBarFocus();
    }
    $('spstatus').textContent = T('Suche ...');
    getJson('/Items?' + uidParam() + '&searchTerm=' + encodeURIComponent(term) +
      /* no episodes: they bury the series ("Dark" matches 42 episodes, 3 series) */
      '&recursive=true&includeItemTypes=Movie,Series,BoxSet,Video,MusicVideo,Book,MusicAlbum,MusicArtist,TvChannel&limit=40' + FIELDS,
      function (err, data) {
        if (state.sp !== sp || seq !== sp.seq) return;
        sp.pending--;
        lib = err ? [] : ((data && data.Items) || []);
        if (err) showToast(T('Suche fehlgeschlagen ({0}).', errText(err)));
        show();
      });
    if (seerr.state === 'ready') {
      seerrSearch(term, function (err, items) {
        if (state.sp !== sp || seq !== sp.seq) return;
        sp.pending--;
        ext = items;
        if (err && err !== 'unavailable') showToast(T('Seerr nicht erreichbar ({0}).', errText(err)));
        show();
      });
    }
  }

  function handleSearchBarKey(e, k) {
    var sp = state.sp;
    var input = $('tsinput');
    if (sp.ime && isEditingText()) {
      /* only keys that leave the field; everything else goes to the IME */
      if (k === K_DOWN || k === K_ENTER || k === K_IME_DONE) {
        e.preventDefault();
        closeSearchKeyboard();
        runSearchBar(input.value);
        if (k === K_DOWN && sp.rows.length) { sp.row = 0; updateSearchBarFocus(); setSearchHints(); }
      } else if (k === K_IME_CANCEL || isBackKey(k)) {
        e.preventDefault();
        closeSearchKeyboard();
      }
      return;
    }
    if (sp.ime || isEditingText()) closeSearchKeyboard();  /* keyboard closed behind our back */
    e.preventDefault();
    if (k === K_IME_DONE || k === K_IME_CANCEL) return;
    var row = sp.rows[sp.row];
    var item = row ? row.items[row.col] : null;
    if (isBackKey(k) || k === K_RED) closeOverlay();
    else if (sp.row === -1) {
      if (k === K_ENTER) openSearchKeyboard();
      else if (k === K_DOWN && sp.rows.length) { sp.row = 0; updateSearchBarFocus(); setSearchHints(); }
      else if (k === K_DOWN) closeOverlay();  /* nothing found: back to the page */
      else if (k === K_UP || k === K_RIGHT) {
        closeOverlay();
        if (enterTop() && k === K_RIGHT) { state.topFocus = 1; updateTopFocus(); }
      }
    } else if (k === K_LEFT && row.col > 0) { row.col--; updateSearchBarFocus(); }
    else if (k === K_RIGHT && row.col < row.items.length - 1) { row.col++; updateSearchBarFocus(); }
    else if (k === K_UP) { sp.row--; updateSearchBarFocus(); setSearchHints(); }
    else if (k === K_DOWN && sp.row < sp.rows.length - 1) { sp.row++; updateSearchBarFocus(); }
    else if (k === K_ENTER && item) {
      closeOverlay();
      if (item.seerr) showSeerrDetails(item, true);
      else openItem(item);
    } else if (isPlayKey(k) && item && !item.seerr) { closeOverlay(); playOrOpen(item); }
  }

  $('tsinput').onblur = function () {
    var sp = state.sp;
    if (sp && sp.ime) { sp.ime = false; setSearchHints(); }
  };

  $('tsinput').oninput = function () {
    var sp = state.sp;
    if (!sp) return;
    if (sp.timer) clearTimeout(sp.timer);
    sp.timer = setTimeout(function () { runSearchBar($('tsinput').value); }, 600);
  };

  /* ---------- backdrops (optional) ---------- */

  var backdropTimer = null;
  var backdropCur = '';

  function itemBackdropUrl(item) {
    if (!item) return '';
    if (item.__backdrop !== undefined) return item.__backdrop;
    if (item.BackdropImageTags && item.BackdropImageTags.length) {
      return imageUrl(item.Id, 'Backdrop', item.BackdropImageTags[0], 720);
    }
    if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
      return imageUrl(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], 720);
    }
    return '';
  }

  /* the backdrop of one item (details, series pages, search results) */
  function setBackdrop(item) {
    if (!state.backdrops) return;
    stopBackdropRotation();
    showBackdropUrl(itemBackdropUrl(item));
  }

  /* fade in a backdrop; debounced so fast navigation stays cheap */
  function showBackdropUrl(url) {
    if (backdropTimer) clearTimeout(backdropTimer);
    backdropTimer = setTimeout(function () {
      backdropTimer = null;
      if (url === backdropCur) return;
      backdropCur = url;
      if (!url) { backdropLayers[backdropFront].className = 'bd'; afterBackdropFade(); return; }
      /* load into the hidden layer and fade it in over the visible one: the
         old picture stays until the new one is decoded (no grey gap) */
      var back = backdropLayers[1 - backdropFront];
      back.onload = function () {
        back.onload = null;
        if (backdropCur !== url) return;
        coverBackdrop(back);
        back.className = 'bd on';
        backdropLayers[backdropFront].className = 'bd';
        backdropFront = 1 - backdropFront;
        afterBackdropFade();
      };
      back.src = url;
    }, 350);
  }

  /* size like background-size: cover (object-fit is too new for the TV) */
  function coverBackdrop(img) {
    var w = img.naturalWidth || 16, h = img.naturalHeight || 9;
    var scale = Math.max(1280 / w, 720 / h);
    img.style.width = Math.ceil(w * scale) + 'px';
    img.style.height = Math.ceil(h * scale) + 'px';
    img.style.marginLeft = Math.floor((1280 - w * scale) / 2) + 'px';
  }

  /* the TV's WebKit sometimes leaves stale strips on the page above a
     changed backdrop (cut-off card edges): repaint once the fade is done */
  var fadeRepaintTimer = null;
  function afterBackdropFade() {
    if (fadeRepaintTimer) clearTimeout(fadeRepaintTimer);
    fadeRepaintTimer = setTimeout(function () {
      fadeRepaintTimer = null;
      if (state.view !== 'player' && state.view !== 'reader') forceRepaint();
    }, 1400);
  }

  /* like jellyfin-web: pages that are not about one item (home, libraries)
     show random backdrops from the library, changing every minute */
  var randomBackdrops = {};
  var rotation = { key: null, timer: null };

  function stopBackdropRotation() {
    if (rotation.timer) { clearInterval(rotation.timer); rotation.timer = null; }
    rotation.key = null;
  }

  function showRandomBackdrop(parentId) {
    if (!state.backdrops) return;
    var key = parentId || 'all';
    if (rotation.key === key && rotation.timer) return;
    stopBackdropRotation();
    rotation.key = key;
    function next() {
      var list = randomBackdrops[key];
      if (!list || !list.length) { showBackdropUrl(''); return; }
      var url = list[Math.floor(Math.random() * list.length)];
      if (list.length > 1 && url === backdropCur) url = list[(list.indexOf(url) + 1) % list.length];
      showBackdropUrl(url);
    }
    function start() {
      if (rotation.key !== key) return;
      next();
      rotation.timer = setInterval(function () {
        if (state.view === 'player' || state.view === 'reader') return;
        next();
      }, 60000);
    }
    if (randomBackdrops[key]) { start(); return; }
    getJson('/Items?' + uidParam() + (parentId ? '&parentId=' + encodeURIComponent(parentId) : '') +
      '&recursive=true&includeItemTypes=Movie,Series&imageTypes=Backdrop&sortBy=Random&limit=25' +
      '&imageTypeLimit=1&enableImageTypes=Backdrop', function (err, data) {
        var list = [];
        var items = (!err && data && data.Items) || [];
        for (var i = 0; i < items.length; i++) {
          var u = itemBackdropUrl(items[i]);
          if (u) list.push(u);
        }
        randomBackdrops[key] = list;
        start();
      });
  }

  /* backdrop for the current page */
  function viewBackdrop() {
    if (!state.backdrops) return;
    if (state.view === 'home') showRandomBackdrop(null);
    else if (state.view === 'details') setBackdrop(state.current);
    else if ((state.view === 'series' || state.view === 'season') && state.bgItem) setBackdrop(state.bgItem);
    else if (state.view === 'library') showRandomBackdrop(state.lib ? state.lib.Id : null);
    else if (state.view === 'person' || state.view === 'artist') showRandomBackdrop(null);
    else if (state.view === 'album' && state.current) musicBackdrop(state.current);
  }

  function clearBackdrop() {
    stopBackdropRotation();
    if (backdropTimer) { clearTimeout(backdropTimer); backdropTimer = null; }
    backdropCur = '';
    for (var i = 0; i < 2; i++) {
      backdropLayers[i].onload = null;
      backdropLayers[i].className = 'bd';
    }
  }

  function toggleBackdrops() {
    state.backdrops = !state.backdrops;
    savePref('jf_backdrops', state.backdrops);
    if (!state.backdrops) { clearBackdrop(); return; }
    viewBackdrop();
  }

  /* ---------- navigation stack ---------- */

  var SNAP_KEYS = ['view', 'title', 'items', 'focus', 'kind', 'current', 'basePath', 'totalCount',
    'homeRows', 'rowFocus', 'lib', 'libSort', 'libUnplayed', 'bgItem', 'libTitle', 'detailFocusKey', 'castCol',
    'tracks', 'trackFocus', 'libArtists'];

  function snapshot() {
    var s = {};
    for (var i = 0; i < SNAP_KEYS.length; i++) s[SNAP_KEYS[i]] = state[SNAP_KEYS[i]];
    s.scrollTop = content.scrollTop;
    return s;
  }

  function pushState() {
    if (state.view === 'login' || state.view === 'player' || state.view === 'message') return;
    state.stack.push(snapshot());
  }

  /* start a new content view; returns a token that async loaders compare
     against state.navSeq so late responses never overwrite a newer view */
  function enterView(view, title) {
    state.navSeq++;
    state.view = view;
    state.title = title || '';
    state.items = [];
    state.cardEls = [];
    state.focusEl = null;
    state.focus = 0;
    state.basePath = null;
    state.totalCount = 0;
    state.loadingMore = false;
    state.cast = null;
    setChrome(true);
    setCrumb(state.title);
    content.scrollTop = 0;
    return state.navSeq;
  }

  /* Tizen 2.3 WebKit sometimes repaints only the top of #content after a
     view is rebuilt (seen after leaving search). Force a full repaint. */
  function forceRepaint() {
    function kick() {
      var st = content.scrollTop;  /* display:none can reset the scroll position */
      content.style.display = 'none';
      void content.offsetHeight;
      content.style.display = '';
      content.scrollTop = st;
    }
    setTimeout(kick, 0);
    setTimeout(kick, 300);
  }

  function restoreState(s) {
    if (!s || !s.view) { goHome(); return; }
    /* the search field may still own the browser focus / on-screen keyboard */
    if (isEditingText()) { try { document.activeElement.blur(); } catch (e) {} }
    forceRepaint();
    var i;
    for (i = 0; i < SNAP_KEYS.length; i++) state[SNAP_KEYS[i]] = s[SNAP_KEYS[i]];
    if (!state.items || typeof state.items.length !== 'number') state.items = [];
    state.navSeq++;
    state.loadingMore = false;
    setChrome(true);
    setTopnav(!!state.token);
    if (s.view === 'home') {
      if (!state.homeRows) { loadHome(); return; }
      setCrumb('');
      renderHome();
      if (state.homeDirty) refreshHome();
    } else if (s.view === 'details' && s.current) {
      showDetails(s.current, false);
    } else if (s.view === 'seerr' && s.current) {
      showSeerrDetails(s.current, false);
    } else if (s.view === 'album' && s.current) {
      setCrumb(state.title);
      musicBackdrop(state.current);
      if (state.tracks) renderAlbum();
      else showAlbum(state.current);
    } else {
      setCrumb(s.view === 'library' ? libCrumb() : state.title);
      renderGrid(state.items, state.kind, s.focus);
      setGridHints();
    }
    if (s.scrollTop && s.view !== 'home') content.scrollTop = s.scrollTop;
  }

  function goBack() {
    if (state.stack.length) restoreState(state.stack.pop());
    else if (state.view !== 'home') loadHome();
    else confirmExit();
  }

  function goHome() {
    if (state.token) loadHome();
    else showLogin();
  }

  /* ---------- home screen ---------- */

  function loadHome() {
    if (!state.token) { showLogin(); return; }
    var nav = enterView('home', '');
    state.stack = [];
    state.current = null;
    state.homeRows = null;
    state.rowFocus = 0;
    state.homeDirty = false;
    setTopnav(!!state.token);
    setHints([]);
    showLoading(T('Lade ...'));
    fetchHomeRows(function (err, rows) {
      if (nav !== state.navSeq) return;
      if (err) {
        showRetry(T('Startseite konnte nicht geladen werden ({0}).', errText(err)), loadHome);
        return;
      }
      state.homeRows = rows;
      state.rowFocus = 0;
      renderHome();
    });
  }

  /* re-fetch rows (e.g. after playback) and keep the focused item if possible */
  function refreshHome() {
    var nav = state.navSeq;
    state.homeDirty = false;
    var oldRow = state.homeRows && state.homeRows[state.rowFocus];
    var oldKey = oldRow ? oldRow.key : '';
    var oldItem = oldRow ? oldRow.items[oldRow.col] : null;
    fetchHomeRows(function (err, rows) {
      if (err || nav !== state.navSeq || state.view !== 'home') return;
      var r;
      var c;
      state.rowFocus = 0;
      for (r = 0; r < rows.length; r++) {
        if (rows[r].key !== oldKey) continue;
        state.rowFocus = r;
        for (c = 0; oldItem && c < rows[r].items.length; c++) {
          if (rows[r].items[c].Id === oldItem.Id) { rows[r].col = c; break; }
        }
        if (oldRow && rows[r].col === undefined) rows[r].col = Math.min(oldRow.col, rows[r].items.length - 1);
      }
      var st = content.scrollTop;
      state.homeRows = rows;
      renderHome();
      content.scrollTop = st;
      updateHomeFocus();
    });
  }

  function fetchHomeRows(cb) {
    var uid = encodeURIComponent(state.userId);
    getJson('/UserViews?' + uidParam(), function (err, data) {
      if (err) { cb(err); return; }
      var all = (data && data.Items) || [];
      var views = [];
      var i;
      for (i = 0; i < all.length; i++) {
        if (all[i].CollectionType) views.push(all[i]);
      }
      if (!views.length) views = all;
      var libItems = views;
      var resume = null;
      var nextUp = null;
      var latest = [];
      var latestViews = [];
      for (i = 0; i < views.length && latestViews.length < 4; i++) {
        var ct = views[i].CollectionType;
        if (ct === 'movies' || ct === 'tvshows' || ct === 'homevideos' || ct === 'music') latestViews.push(views[i]);
      }
      var liveView = null;
      var liveRow = null;
      for (i = 0; i < views.length; i++) if (isLiveLib(views[i])) liveView = views[i];
      var pending = 2 + latestViews.length + (liveView ? 1 : 0);
      function done() {
        if (--pending > 0) return;
        var rows = [];
        if (resume) rows.push(resume);
        if (nextUp) rows.push(nextUp);
        rows.push({ key: 'libs', title: T('Meine Medien'), kind: 'library', items: libItems });
        if (liveRow) rows.push(liveRow);
        for (var j = 0; j < latest.length; j++) if (latest[j]) rows.push(latest[j]);
        cb(null, rows);
      }
      getJsonAlt('/UserItems/Resume?' + uidParam() + '&limit=20&mediaTypes=Video' + FIELDS,
        '/Users/' + uid + '/Items/Resume?limit=20&mediaTypes=Video' + FIELDS,
        function (e, d) {
          if (!e && d && d.Items && d.Items.length) {
            resume = { key: 'resume', title: T('Weiterschauen'), kind: 'items', wide: true, items: d.Items };
          }
          done();
        });
      getJson('/Shows/NextUp?' + uidParam() + '&limit=20&enableResumable=false' + FIELDS,
        function (e, d) {
          if (!e && d && d.Items && d.Items.length) {
            nextUp = { key: 'nextup', title: T('Nächste Folgen'), kind: 'items', wide: true, items: d.Items };
          }
          done();
        });
      if (liveView) {
        /* favourite channels first, like the TV's own list */
        getJson('/LiveTv/Channels?' + uidParam() + LIVE_FIELDS + '&limit=20&enableFavoriteSorting=true', function (e, d) {
          if (!e && d && d.Items && d.Items.length) {
            liveRow = { key: 'live', title: liveView.Name || T('Live-TV'), kind: 'items', items: d.Items };
          }
          done();
        });
      }
      for (i = 0; i < latestViews.length; i++) {
        (function (v, slot) {
          function store(e, items) {
            if (!e && items && items.length) {
              latest[slot] = { key: 'latest:' + v.Id, title: T('Neu in {0}', v.Name), kind: 'items', items: items };
            }
            done();
          }
          var q = '?parentId=' + encodeURIComponent(v.Id) + '&limit=' + (v.CollectionType === 'tvshows' ? 40 : 20) + FIELDS;
          getJsonAlt('/Items/Latest' + q + '&' + uidParam(), '/Users/' + uid + '/Items/Latest' + q,
            function (e, d) {
              if (e || !d || v.CollectionType !== 'tvshows') { store(e, d); return; }
              latestSeries(d, store);
            });
        }(latestViews[i], i));
      }
    });
  }

  /* /Items/Latest returns seasons or a lone new episode for TV libraries;
     map every entry to its series (keeping the order) and load those */
  function latestSeries(list, cb) {
    var ids = [];
    var seen = {};
    var i;
    for (i = 0; i < list.length && ids.length < 20; i++) {
      var it = list[i];
      var sid = it.Type === 'Series' ? it.Id : it.SeriesId;
      if (sid && !seen[sid]) { seen[sid] = true; ids.push(sid); }
    }
    if (!ids.length) { cb(null, []); return; }
    getJson('/Items?' + uidParam() + '&ids=' + ids.join(',') + FIELDS, function (err, data) {
      if (err) { cb(err); return; }
      var byId = {};
      var items = (data && data.Items) || [];
      for (i = 0; i < items.length; i++) byId[items[i].Id] = items[i];
      var out = [];
      for (i = 0; i < ids.length; i++) if (byId[ids[i]]) out.push(byId[ids[i]]);
      cb(null, out);
    });
  }

  function renderHome() {
    state.view = 'home';
    state.kind = 'home';
    state.focusEl = null;
    var rows = state.homeRows || [];
    content.innerHTML = '';
    content.scrollTop = 0;
    var wrap = el('div', 'home');
    var r;
    var i;
    for (r = 0; r < rows.length; r++) {
      var row = rows[r];
      var rowEl = el('div', 'row');
      rowEl.appendChild(el('div', 'rowtitle', row.title));
      var scroller = el('div', 'rowscroll');
      var inner = el('div', 'rowinner');
      row.els = [];
      for (i = 0; i < row.items.length; i++) {
        var card = makeCard(row.items[i], row.kind, { wide: row.wide, showSeries: row.wide });
        inner.appendChild(card);
        row.els.push(card);
      }
      scroller.appendChild(inner);
      rowEl.appendChild(scroller);
      wrap.appendChild(rowEl);
      row.el = rowEl;
      row.scrollEl = scroller;
      row.innerEl = inner;
      row.shift = 0;
      if (typeof row.col !== 'number' || row.col < 0 || row.col >= row.els.length) row.col = 0;
    }
    content.appendChild(wrap);
    if (!(state.rowFocus >= 0 && state.rowFocus < rows.length)) state.rowFocus = 0;
    updateHomeFocus();
    setHints([['ok', T('Öffnen')], ['play', T('Abspielen')], ['red', T('Suche')],
      ['blue', T('Einstellungen')], ['back', T('Beenden')]]);
    forceRepaint();  /* the first card's focus frame was cut off at launch */
    viewBackdrop();
  }

  function updateHomeFocus() {
    var rows = state.homeRows || [];
    if (state.focusEl) setFocused(state.focusEl, false);
    var row = rows[state.rowFocus];
    if (!row || !row.els.length) { state.focusEl = null; return; }
    var card = row.els[row.col];
    setFocused(card, true);
    state.focusEl = card;
    shiftRowTo(row, card);
    if (state.rowFocus === 0) content.scrollTop = 0;
    else ensureVisible(row.el);
  }

  /* Horizontal scroll inside a row (row: scrollEl, innerEl, shift). Shift the
     inner strip with a margin instead of scrollLeft: Tizen 2.3 WebKit doesn't
     repaint content scrolled into an overflow:hidden box until it changes
     (e.g. gets focus). */
  function shiftRowTo(row, card) {
    var pad = 40;
    var view = row.scrollEl.clientWidth;
    var shift = row.shift || 0;
    var left = card.offsetLeft + shift;
    var right = left + card.offsetWidth;
    if (left - pad < shift) shift = Math.max(0, left - pad);
    else if (right + pad > shift + view) shift = right + pad - view;
    if (shift !== row.shift) {
      row.shift = shift;
      row.innerEl.style.marginLeft = (-shift) + 'px';
    }
  }

  function homeMove(dx, dy) {
    var rows = state.homeRows || [];
    if (!rows.length) return;
    if (dy) {
      var nr = state.rowFocus + dy;
      if (nr < 0 && dy === -1) { enterTop(); return; }
      if (nr < 0 || nr >= rows.length) return;
      state.rowFocus = nr;
    } else {
      var row = rows[state.rowFocus];
      var nc = row.col + dx;
      if (nc < 0 || nc >= row.els.length) return;
      row.col = nc;
    }
    updateHomeFocus();
  }

  function homeItem() {
    var row = state.homeRows && state.homeRows[state.rowFocus];
    return row ? row.items[row.col] : null;
  }

  /* ---------- grids (library, seasons, episodes, search) ---------- */

  function typesFor(view) {
    var ct = view && view.CollectionType;
    if (ct === 'movies') return 'Movie';
    if (ct === 'tvshows') return 'Series';
    if (ct === 'homevideos') return 'Video';
    if (ct === 'musicvideos') return 'MusicVideo';
    if (ct === 'books') return 'Book';
    if (ct === 'boxsets') return 'BoxSet';
    if (ct === 'livetv') return 'LiveTvChannel';
    if (ct === 'music') return 'MusicAlbum';
    if (ct === 'playlists') return 'Playlist';
    return 'Movie,Series,Video,MusicVideo,Book,BoxSet';
  }

  function loadGridPage(nav, basePath, errMsg, retry, onEmpty, onLoaded) {
    state.basePath = basePath;
    state.totalCount = 0;
    state.loadingMore = false;
    getJson(basePath + '&startIndex=0&limit=' + PAGE, function (err, data) {
      if (nav !== state.navSeq) return;
      if (err) { showRetry(T('{0} ({1}).', errMsg, errText(err)), retry); return; }
      var items = (data && data.Items) || [];
      state.totalCount = (data && data.TotalRecordCount) || items.length;
      if (!items.length) {
        if (onEmpty) onEmpty();
        else showError(state.libUnplayed && state.view === 'library' ?
          T('Keine ungesehenen Einträge.') : T('Keine Einträge gefunden.'));
        return;
      }
      if (onLoaded && onLoaded(items)) return;
      renderGrid(items, 'items', 0);
      setGridHints();
    });
  }

  /* limit: entries to fetch (default one page); done() after they are in */
  function loadMore(limit, done) {
    if (state.loadingMore || !state.basePath || state.kind !== 'items') return;
    if (state.totalCount && state.items.length >= state.totalCount) return;
    state.loadingMore = true;
    var nav = state.navSeq;
    var path = state.basePath + '&startIndex=' + state.items.length + '&limit=' + (limit || PAGE);
    getJson(path, function (err, data) {
      if (nav !== state.navSeq) return;
      state.loadingMore = false;
      if (err) {
        showToast(T('Weitere Eintr\u00e4ge konnten nicht geladen werden ({0}).', errText(err)));
        return;
      }
      var items = (data && data.Items) || [];
      if (data && data.TotalRecordCount) state.totalCount = data.TotalRecordCount;
      if (!items.length) { state.totalCount = state.items.length; return; }
      var i;
      for (i = 0; i < items.length; i++) state.items.push(items[i]);
      appendCards(items);
      if (done) { done(); return; }
      updateFocus();
      maybeLoadMore();
    });
  }

  /* fetch the next entries well before the focus gets there */
  function maybeLoadMore() {
    if (state.kind !== 'items' || !state.basePath || state.loadingMore) return;
    if (state.totalCount && state.items.length >= state.totalCount) return;
    if (state.focus + state.columns * 10 >= state.items.length) loadMore();
  }

  /* ---------- jump to a letter (A–Z sorted libraries) ----------
     Number keys like on a phone: 2 = A B C ... 7 = P Q R S, press again for
     the next letter; 0 / 1 = to the top. The server counts the entries
     before that letter, so the focus lands there directly. */
  var T9 = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ' };
  var letterJump = { key: -1, n: 0, at: 0, timer: null, seq: 0 };

  function canJumpLetters() {
    return state.view === 'library' && state.libSort === 0 && !browsesFolders(state.lib) && !isLiveLib(state.lib) && !!state.basePath;
  }

  function letterKey(digit) {
    var t = now();
    if (letterJump.key === digit && t - letterJump.at < 1300) letterJump.n++;
    else { letterJump.key = digit; letterJump.n = 0; }
    letterJump.at = t;
    var letters = T9[digit] || '';
    var ch = letters ? letters.charAt(letterJump.n % letters.length) : '';
    showToast(ch ? T('Springe zu \u201e{0}\u201c', ch) : T('Zum Anfang'));
    if (letterJump.timer) clearTimeout(letterJump.timer);
    /* wait a moment: the key may be pressed again for the next letter */
    letterJump.timer = setTimeout(function () { letterJump.timer = null; jumpToLetter(ch); }, 650);
  }

  function sortKey(item) {
    return String(item.SortName || item.Name || '').toLowerCase();
  }

  function jumpToLetter(ch) {
    var nav = state.navSeq;
    var seq = ++letterJump.seq;
    if (!ch) { focusIndex(0); return; }
    var lower = ch.toLowerCase();
    getJson(state.basePath + '&nameLessThan=' + encodeURIComponent(lower) + '&startIndex=0&limit=0', function (err, data) {
      if (nav !== state.navSeq || seq !== letterJump.seq) return;
      if (err || !data || typeof data.TotalRecordCount !== 'number') { showToast(T('Sprung nicht m\u00f6glich.')); return; }
      focusIndex(data.TotalRecordCount, lower);
    });
  }

  /* focus entry idx, loading everything up to it first; with a letter the
     position is corrected locally in case the server counts differently */
  function focusIndex(idx, letter) {
    var nav = state.navSeq;
    if (state.totalCount && idx >= state.totalCount) idx = state.totalCount - 1;
    if (idx < 0) idx = 0;
    if (idx >= state.items.length) {
      if (state.loadingMore) { setTimeout(function () { if (nav === state.navSeq) focusIndex(idx, letter); }, 200); return; }
      loadMore(idx - state.items.length + PAGE / 2, function () { if (nav === state.navSeq) focusIndex(idx, letter); });
      return;
    }
    if (letter) {
      while (idx > 0 && sortKey(state.items[idx - 1]) >= letter) idx--;
      while (idx < state.items.length - 1 && sortKey(state.items[idx]) < letter) idx++;
    }
    state.focus = idx;
    updateFocus();
    maybeLoadMore();
  }

  function libCrumb() {
    var v = state.lib;
    var t = state.libTitle || (v ? v.Name : state.title);
    var s = SORTS[state.libSort] || SORTS[0];
    if (isMusicLib(v)) return t + '  ·  ' + (state.libArtists ? T('Künstler') : T('Alben')) + '  ·  ' + T(s.label);
    if (isLiveLib(v)) return t + '  ·  ' + (state.libUnplayed ? T('Favoriten') : T('Alle Sender'));
    return t + '  ·  ' + T(s.label) + (state.libUnplayed ? '  ·  ' + T('Ungesehen') : '');
  }

  function openLibrary(view) {
    /* a folder opened inside a library shows its path: "Bücher › Comics" */
    var parent = state.view === 'library' && state.lib ? (state.libTitle || state.lib.Name) : '';
    pushState();
    state.libTitle = parent ? parent + ' \u203a ' + view.Name : view.Name;
    state.lib = view;
    state.bgItem = null;
    state.libSort = 0;
    state.libUnplayed = false;
    state.libArtists = false;
    reloadLibrary();
    viewBackdrop();
  }

  /* Like jellyfin-web: book, home video and mixed libraries (and every
     folder inside a library) are browsed folder by folder; movie and series
     libraries list all their titles at once. */
  function browsesFolders(v) {
    if (!v) return false;
    if (!v.CollectionType) return true;  /* a folder, or a library of mixed content */
    var ct = v.CollectionType;
    return ct === 'books' || ct === 'homevideos' || ct === 'mixed' || ct === 'folders' || ct === 'photos';
  }

  function reloadLibrary() {
    var v = state.lib;
    var nav = enterView('library', v.Name);
    state.kind = 'items';
    setCrumb(libCrumb());
    setHints([]);
    showLoading(T('{0} wird geladen ...', v.Name));
    var s = SORTS[state.libSort] || SORTS[0];
    var folders = browsesFolders(v);
    var base = '/Items?' + uidParam() +
      '&parentId=' + encodeURIComponent(v.Id) +
      (folders ? '&recursive=false' : '&recursive=true&includeItemTypes=' + typesFor(v)) + FIELDS +
      /* folders first, then the items in the chosen order */
      '&sortBy=' + (folders ? 'IsFolder,' : '') + s.by +
      '&sortOrder=' + (folders ? 'Descending,' : '') + s.order +
      (state.libUnplayed ? '&filters=IsUnplayed' : '');
    if (isMusicLib(v) && state.libArtists) {
      base = '/Artists/AlbumArtists?' + uidParam() + '&parentId=' + encodeURIComponent(v.Id) + FIELDS +
        '&sortBy=' + s.by + '&sortOrder=' + s.order;
    }
    if (isLiveLib(v)) {
      base = '/LiveTv/Channels?' + uidParam() + LIVE_FIELDS + (state.libUnplayed ? '&isFavorite=true' : '');
    }
    loadGridPage(nav, base, T('Inhalt konnte nicht geladen werden'), reloadLibrary,
      isLiveLib(v) ? function () { showError(state.libUnplayed ? T('Keine Lieblingssender.') : T('Keine Sender gefunden.')); } : null);
  }

  function openSeries(series) {
    pushState();
    var nav = enterView('series', series.Name);
    state.kind = 'items';
    state.bgItem = series;
    viewBackdrop();
    setHints([]);
    showLoading(T('{0} wird geladen ...', series.Name || ''));
    var base = '/Items?' + uidParam() +
      '&parentId=' + encodeURIComponent(series.Id) +
      '&includeItemTypes=Season&recursive=false' + FIELDS +
      '&sortBy=IndexNumber,SortName&sortOrder=Ascending';
    loadGridPage(nav, base, T('Staffeln konnten nicht geladen werden'), function () { openSeries(series); }, function () {
      /* no seasons: list the episodes directly */
      loadEpisodes(nav, series.Id, true);
    }, function (seasons) {
      /* only one season: skip the season level */
      if (seasons.length !== 1) return false;
      state.view = 'season';
      loadEpisodes(nav, seasons[0].Id, false);
      return true;
    });
  }

  function openSeason(season) {
    pushState();
    var nav = enterView('season', (season.SeriesName ? season.SeriesName + '  ·  ' : '') + season.Name);
    state.kind = 'items';
    state.bgItem = season;
    viewBackdrop();
    setHints([]);
    showLoading(T('{0} wird geladen ...', season.Name));
    loadEpisodes(nav, season.Id, false);
  }

  function loadEpisodes(nav, parentId, recursive) {
    var base = '/Items?' + uidParam() +
      '&parentId=' + encodeURIComponent(parentId) +
      '&includeItemTypes=Episode&recursive=' + (recursive ? 'true' : 'false') + FIELDS +
      '&sortBy=ParentIndexNumber,IndexNumber,SortName&sortOrder=Ascending';
    var view = state.view;
    var title = state.title;
    loadGridPage(nav, base, T('Folgen konnten nicht geladen werden'), function () {
      var n = enterView(view, title);
      state.kind = 'items';
      showLoading(T('Lade ...'));
      loadEpisodes(n, parentId, recursive);
    });
  }

  function openItem(item) {
    if (!item) return;
    if (item.CollectionType) { openLibrary(item); return; }
    if (item.Type === 'Series') { openSeries(item); return; }
    if (item.Type === 'Season') { openSeason(item); return; }
    if (isTrackList(item)) { openAlbum(item); return; }
    if (item.Type === 'MusicArtist') { openArtist(item); return; }
    if (item.Type === 'Audio') { playMusic([item], 0, false); return; }
    if (item.Type === 'TvChannel') { playItem(item); return; }
    if (isPlayable(item)) { showDetails(item, true); return; }
    if (item.IsFolder) { openLibrary(item); return; }
    showDetails(item, true);
  }

  function computeColumnsFromDom() {
    var nodes = state.cardEls;
    if (!nodes.length) return 1;
    var top = nodes[0].offsetTop;
    var cols = 0;
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].offsetTop === top) cols++;
      else break;
    }
    return cols || 1;
  }

  function makeTile(item) {
    var card = el('div', 'tile');
    var timg = el('img', 'tileimg');
    timg.onerror = function () {
      var b = backdropUrl(item, 300);
      if (b && timg.src !== b) {
        timg.onerror = function () { timg.style.display = 'none'; };
        timg.src = b;
      } else {
        timg.style.display = 'none';
      }
    };
    timg.src = posterUrl(item, 300);
    card.appendChild(timg);
    card.appendChild(el('div', 'tilelabel', item.Name || ''));
    return card;
  }

  function addBadges(poster, item) {
    var ud = item.UserData || {};
    if (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'BoxSet') {
      if (ud.UnplayedItemCount) poster.appendChild(el('div', 'badge', String(ud.UnplayedItemCount)));
      else if (ud.Played) poster.appendChild(el('div', 'badge done', '✓'));
    } else if (ud.Played) {
      poster.appendChild(el('div', 'badge done', '✓'));
    }
    var pct = ud.PlayedPercentage;
    if (!ud.Played && pct > 0 && pct < 100) {
      var bar = el('div', 'cardprogress');
      var fill = el('div', 'cardprogressfill');
      fill.style.width = Math.max(3, Math.round(pct)) + '%';
      bar.appendChild(fill);
      poster.appendChild(bar);
    }
  }

  /* opts: wide (16:9 artwork), showSeries (series name as title), lazy, showType */
  function makeCard(item, kind, opts) {
    if (item && item.Type === 'TvChannel' && kind !== 'library') return makeChannelCard(item, opts || {});
    if (kind === 'library') {
      var tile = makeTile(item);
      tile.onclick = function () { openItem(item); };
      return tile;
    }
    opts = opts || {};
    var card = el('div', opts.wide ? 'card wide' : 'card');
    var poster = el('div', opts.wide ? 'poster wide' : (isLandscape(item) ? 'poster landscape' :
      (isSquare(item) ? 'poster square' : 'poster')));
    var img = document.createElement('img');
    img.onerror = function () { this.style.display = 'none'; };
    var src = opts.wide ? wideImageUrl(item, 240) : posterUrl(item, 300);
    if (opts.lazy) img.setAttribute('data-src', src);
    else img.src = src;
    poster.appendChild(img);
    addBadges(poster, item);
    var title = item.Name || '';
    var sub = metaText(item, opts.showType);
    if (item.Type === 'Episode') {
      var se = episodeCode(item);
      if (opts.showSeries || opts.showType) {
        title = item.SeriesName || title;
        sub = (se ? se + '  ·  ' : '') + (item.Name || '');
      } else if (item.IndexNumber) {
        title = item.IndexNumber + '. ' + title;
      }
    }
    card.appendChild(poster);
    card.appendChild(el('div', 'cardtitle', title));
    card.appendChild(el('div', 'cardsub', sub));
    card.onclick = function () { openItem(item); };
    return card;
  }

  function appendCards(items, grid) {
    grid = grid || content.querySelector('.grid');
    if (!grid) return;
    var i;
    /* a person's titles can be episodes: show which series they belong to */
    var opts = { lazy: true, showSeries: state.view === 'person' };
    for (i = 0; i < items.length; i++) {
      var card = makeCard(items[i], 'items', opts);
      grid.appendChild(card);
      state.cardEls.push(card);
    }
  }

  function renderGrid(items, kind, focus, keepContent) {
    dropPendingImages();
    items = items || [];
    state.items = items;
    state.kind = kind;
    state.cardEls = [];
    state.focusEl = null;
    var grid = el('div', 'grid');
    if (!keepContent) {
      content.innerHTML = '';
      content.scrollTop = 0;
    }
    content.appendChild(grid);
    appendCards(items, grid);
    state.columns = computeColumnsFromDom();
    state.focus = (typeof focus === 'number' && focus >= 0 && focus < items.length) ? focus : 0;
    updateFocus();
    viewBackdrop();
  }

  /* Posters load only once the focus rests, and loads for cards that were
     scrolled past are cancelled: the TV opens just a few connections per
     host, so queued posters would otherwise delay the request for the next
     entries and block scrolling. */
  var BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var pendingImgs = [];
  var imgTimer = null;

  function scheduleImages() {
    if (imgTimer) clearTimeout(imgTimer);
    imgTimer = setTimeout(function () {
      imgTimer = null;
      loadImagesAround(state.focus);
    }, 160);
  }

  function cancelImage(img) {
    if (img.complete && img.src !== BLANK_IMG) return false;
    img.setAttribute('data-src', img.jfSrc);
    img.src = BLANK_IMG;
    return true;
  }

  function dropPendingImages() {
    for (var i = 0; i < pendingImgs.length; i++) cancelImage(pendingImgs[i]);
    pendingImgs = [];
  }

  function loadImagesAround(idx) {
    var cols = state.columns || 1;
    var from = Math.max(0, idx - cols * 3);
    var to = Math.min(state.cardEls.length - 1, idx + cols * 5);
    var keep = [];
    var i;
    for (i = 0; i < pendingImgs.length; i++) {
      var p = pendingImgs[i];
      if (p.complete) continue;
      if (p.jfIdx < from || p.jfIdx > to) cancelImage(p);
      else keep.push(p);
    }
    pendingImgs = keep;
    for (i = from; i <= to; i++) {
      var img = state.cardEls[i].getElementsByTagName('img')[0];
      var src = img && img.getAttribute('data-src');
      if (src) {
        img.removeAttribute('data-src');
        img.jfIdx = i;
        img.jfSrc = src;
        img.src = src;
        pendingImgs.push(img);
      }
    }
  }

  function updateFocus() {
    if (state.focusEl) setFocused(state.focusEl, false);
    state.focusEl = null;
    var els = state.cardEls;
    if (!els.length) return;
    if (!(state.focus >= 0 && state.focus < els.length)) state.focus = 0;
    var card = els[state.focus];
    setFocused(card, true);
    state.focusEl = card;
    ensureVisible(card);
    scheduleImages();
  }

  function gridMove(dx, dy) {
    var n = state.items ? state.items.length : 0;
    var cols = state.columns || 1;
    var f = state.focus;
    if (!n) { if (dy === -1) enterTop(); return; }
    var next;
    if (dx) {
      next = f + dx;
    } else {
      next = f + dy * cols;
      if (next < 0) {
        if (f >= cols) next = f % cols;
        else { if (dy === -1) enterTop(); return; }
      } else if (next >= n) {
        /* jump to the last card if there is a row below the current one */
        if (Math.floor(f / cols) < Math.floor((n - 1) / cols)) next = n - 1;
        else { maybeLoadMore(); return; }
      }
    }
    if (next < 0 || next >= n) return;
    state.focus = next;
    updateFocus();
    maybeLoadMore();
  }

  function setGridHints() {
    if (state.view === 'library' && isLiveLib(state.lib)) {
      setHints([['ok', T('Abspielen')], ['green', state.libUnplayed ? T('Alle Sender') : T('Favoriten')],
        ['numbers', T('Sendernummer')], ['red', T('Suche')], ['back', T('Zurück')]]);
    } else if (state.view === 'library') {
      var music = isMusicLib(state.lib);
      var hints = [['ok', T('Öffnen')], ['play', T('Abspielen')], ['yellow', T('Sortieren')],
        ['green', music ? (state.libArtists ? T('Alben') : T('Künstler')) : T('Ungesehen')]];
      if (canJumpLetters()) hints.push(['digits', T('Buchstabe')]);
      setHints(hints.concat([['red', T('Suche')], ['back', T('Zurück')]]));
    } else {
      setHints([['ok', T('Öffnen')], ['play', T('Abspielen')], ['red', T('Suche')], ['back', T('Zurück')]]);
    }
  }

  function currentGridItem() {
    if (state.view === 'home') return homeItem();
    if (state.focus >= 0 && state.items && state.focus < state.items.length) return state.items[state.focus];
    return null;
  }

  /* ---------- search ---------- */

  /* ---------- details ---------- */

  function showDetails(item, push) {
    if (push) {
      pushState();
      state.detailFocusKey = 'play';
    }
    var nav = enterView('details', item.SeriesName || item.Name);
    state.current = item;
    renderDetailsBody(item);
    setHints([['ok', T('Auswählen')], ['arrows', T('Scrollen')], ['back', T('Zurück')]]);
    refreshDetails(nav);
  }

  /* fetch the full item: fresh resume position, genres, overview */
  function refreshDetails(nav) {
    var item = state.current;
    if (!item) return;
    var id = encodeURIComponent(item.Id);
    /* an episode lists only its guest stars; the main cast is on the series */
    var series = item.Type === 'Episode' && item.SeriesId ? null : false;
    var full = null;
    function done() {
      if (!full || series === null || nav !== state.navSeq || state.view !== 'details') return;
      if (series) full.jfCast = mergeCast(series.People, full.People);
      state.current = full;
      var st = content.scrollTop;
      renderDetailsBody(full);
      content.scrollTop = st;
    }
    getJsonAlt('/Items/' + id + '?' + uidParam(),
      '/Users/' + encodeURIComponent(state.userId) + '/Items/' + id,
      function (err, data) {
        if (err || !data) return;
        full = data;
        done();
      });
    if (series === null) {
      var sid = encodeURIComponent(item.SeriesId);
      getJsonAlt('/Items/' + sid + '?' + uidParam(),
        '/Users/' + encodeURIComponent(state.userId) + '/Items/' + sid,
        function (err, data) {
          series = (!err && data) || false;
          done();
        });
    }
  }

  /* actors and guest stars, without directors, writers etc. */
  function mergeCast() {
    var out = [];
    var seen = {};
    for (var a = 0; a < arguments.length; a++) {
      var list = arguments[a] || [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!p || !p.Id || seen[p.Id] || (p.Type !== 'Actor' && p.Type !== 'GuestStar')) continue;
        seen[p.Id] = true;
        out.push(p);
      }
    }
    return out;
  }

  function castOf(item) {
    return item.jfCast || mergeCast(item.People);
  }

  function personInitials(name) {
    var w = (name || '').split(/\s+/);
    var s = '';
    for (var i = 0; i < w.length && s.length < 2; i++) if (w[i]) s += w[i].charAt(0).toUpperCase();
    return s;
  }

  function renderCast(people) {
    state.cast = null;
    if (!people.length) return;
    var row = el('div', 'row castrow');
    row.appendChild(el('div', 'rowtitle', T('Besetzung')));
    var scroller = el('div', 'rowscroll');
    var inner = el('div', 'rowinner');
    var els = [];
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      var card = el('div', 'card person');
      var poster = el('div', 'poster person');
      poster.appendChild(el('div', 'personinitials', personInitials(p.Name)));
      if (p.PrimaryImageTag) {
        /* hidden until loaded: an <img> without src draws an empty frame */
        var img = document.createElement('img');
        img.style.display = 'none';
        img.onload = function () { this.style.display = ''; };
        img.setAttribute('data-src', imageUrl(p.Id, 'Primary', p.PrimaryImageTag, 240));
        poster.appendChild(img);
      }
      card.appendChild(poster);
      card.appendChild(el('div', 'cardtitle', p.Name || ''));
      card.appendChild(el('div', 'cardsub', p.Role || ''));
      inner.appendChild(card);
      els.push(card);
    }
    scroller.appendChild(inner);
    row.appendChild(scroller);
    content.appendChild(row);
    state.cast = { items: people, els: els, el: row, scrollEl: scroller, innerEl: inner, shift: 0 };
    if (!(state.castCol >= 0 && state.castCol < els.length)) state.castCol = 0;
    loadCastImages();
  }

  /* photos of the visible people and a few beyond */
  function loadCastImages() {
    var c = state.cast;
    if (!c) return;
    var to = Math.min(c.els.length - 1, state.castCol + 8);
    for (var i = 0; i <= to; i++) {
      var img = c.els[i].getElementsByTagName('img')[0];
      var src = img && img.getAttribute('data-src');
      if (src) {
        img.removeAttribute('data-src');
        img.src = src;
      }
    }
  }

  function castMove(dx) {
    var c = state.cast;
    var next = state.castCol + dx;
    if (!c || next < 0 || next >= c.els.length) return;
    state.castCol = next;
    updateDetailFocus();
  }

  /* a person's movies and series in the library */
  function openPerson(person) {
    if (!person || !person.Id) return;
    pushState();
    var nav = enterView('person', person.Name || '');
    state.kind = 'items';
    state.bgItem = null;
    viewBackdrop();
    setHints([]);
    showLoading(T('{0} wird geladen ...', person.Name || ''));
    var base = '/Items?' + uidParam() + '&personIds=' + encodeURIComponent(person.Id) +
      '&recursive=true' + FIELDS +
      '&sortBy=ProductionYear,PremiereDate,SortName&sortOrder=Descending,Descending,Ascending&includeItemTypes=';
    function retry() { openPerson(person); }
    var err = T('Titel konnten nicht geladen werden');
    loadGridPage(nav, base + 'Movie,Series', err, retry, function () {
      /* only guest roles: list the episodes */
      loadGridPage(nav, base + 'Episode', err, retry);
    });
  }

  function detailMeta(item) {
    var parts = [];
    if (item.Type === 'Episode') {
      var se = episodeCode(item);
      if (se) parts.push(se);
    }
    if (item.ProductionYear) parts.push(String(item.ProductionYear));
    if (item.RunTimeTicks >= 60 * 1000 * TICKS && item.Type !== 'Book') parts.push(fmtRuntime(item.RunTimeTicks));
    if (item.OfficialRating) parts.push(item.OfficialRating);
    if (item.CommunityRating) parts.push('★ ' + (Math.round(item.CommunityRating * 10) / 10));
    if (item.RunTimeTicks && isPlayable(item)) {
      var rest = item.RunTimeTicks / TICKS - resumeMs(item);
      parts.push(T('Endet um {0}', fmtClock(new Date(now() + rest))));
    }
    return parts.join('  ·  ');
  }

  function renderDetailsBody(item) {
    content.innerHTML = '';
    var wrap = el('div', 'detail');
    var poster = el('div', isLandscape(item) ? 'detailposter landscape' : 'detailposter');
    var img = document.createElement('img');
    img.onerror = function () { this.style.display = 'none'; };
    img.src = posterUrl(item, 450);
    poster.appendChild(img);
    addBadges(poster, item);
    var info = el('div', 'detailinfo');
    if (item.Type === 'Episode' && item.SeriesName) info.appendChild(el('div', 'detailseries', item.SeriesName));
    info.appendChild(el('div', 'detailtitle', item.Name || ''));
    info.appendChild(el('div', 'detailmeta', detailMeta(item)));
    if (item.Genres && item.Genres.length) info.appendChild(el('div', 'detailgenres', item.Genres.join(', ')));

    var pos = resumeMs(item);
    if (pos > 0 && item.RunTimeTicks) {
      var bar = el('div', 'detailprogress');
      var fill = el('div', 'detailprogressfill');
      fill.style.width = Math.min(100, Math.round(pos / (item.RunTimeTicks / TICKS) * 100)) + '%';
      bar.appendChild(fill);
      info.appendChild(bar);
    }

    var buttons = [];
    var btnRow = el('div', 'btnrow');
    function addBtn(key, label, cls, fn) {
      var b = el('div', 'btn' + (cls ? ' ' + cls : ''), label);
      b.onclick = fn;
      b.setAttribute('data-key', key);
      btnRow.appendChild(b);
      buttons.push(b);
    }
    if (isPlayable(item)) {
      if (pos > 0) {
        addBtn('play', T('Fortsetzen ab {0}', fmtTime(pos)), 'primary', function () { playItem(item, { startMs: pos }); });
        addBtn('restart', T('Von Anfang'), '', function () { playItem(item, { startMs: 0 }); });
      } else {
        addBtn('play', T('Abspielen'), 'primary', function () { playItem(item, { startMs: 0 }); });
      }
    }
    if (isPlayable(item) && item.MediaSources && item.MediaSources.length > 1) {
      var src = pickSource(item.MediaSources, state.sourceChoice[item.Id]);
      addBtn('version', T('Version: {0}', src.Name || src.Container || '?'), '', function () { chooseVersion(item); });
    }
    if (item.Type === 'Book') {
      var prog = readProgress(item.Id);
      if (prog && progressLabel(prog)) {
        addBtn('read', T('Weiterlesen ({0})', progressLabel(prog)), 'primary', function () { openBook(item, false); });
        addBtn('restart', T('Von vorne'), '', function () { openBook(item, true); });
      } else {
        addBtn('read', T('Lesen'), 'primary', function () { openBook(item, true); });
      }
    }
    if (isPlayable(item) || item.Type === 'Series' || item.Type === 'Season' || item.Type === 'Book') {
      var played = !!(item.UserData && item.UserData.Played);
      var book = item.Type === 'Book';
      addBtn('played', played ? (book ? T('Als ungelesen markieren') : T('Als ungesehen markieren')) :
        (book ? T('Als gelesen markieren') : T('Als gesehen markieren')), '', function () { togglePlayed(item); });
    }
    if (item.Type === 'Episode' && item.SeriesId) {
      addBtn('series', T('Zur Serie'), '', function () {
        openSeries({ Id: item.SeriesId, Name: item.SeriesName || '' });
      });
    }
    info.appendChild(btnRow);
    info.appendChild(el('div', 'overview', item.Overview || ''));
    wrap.appendChild(poster);
    wrap.appendChild(info);
    content.appendChild(wrap);
    renderCast(castOf(item));
    /* keep focus on the same action across re-renders (labels change) */
    setBackdrop(item);
    state.detailButtons = buttons;
    state.detailFocus = 0;
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-key') === state.detailFocusKey) state.detailFocus = i;
    }
    updateDetailFocus();
  }

  /* the focus is on a button or, with detailFocusKey 'cast', in the cast
     row. 'cast' is kept while the cast is still loading (back from a person). */
  function updateDetailFocus() {
    var b = state.detailButtons;
    var c = state.cast;
    var inCast = !!c && state.detailFocusKey === 'cast';
    for (var i = 0; i < b.length; i++) setFocused(b[i], !inCast && i === state.detailFocus);
    if (!inCast && state.detailFocusKey !== 'cast' && b[state.detailFocus]) {
      state.detailFocusKey = b[state.detailFocus].getAttribute('data-key');
    }
    if (!c) return;
    for (i = 0; i < c.els.length; i++) setFocused(c.els[i], inCast && i === state.castCol);
    if (inCast) {
      shiftRowTo(c, c.els[state.castCol]);
      ensureVisible(c.el);
      loadCastImages();
    }
  }

  function focusDetailButtons() {
    var b = state.detailButtons[state.detailFocus];
    state.detailFocusKey = b ? b.getAttribute('data-key') : 'play';
    updateDetailFocus();
  }

  function detailMove(dx) {
    var next = state.detailFocus + dx;
    if (next < 0 || next >= state.detailButtons.length) return;
    state.detailFocus = next;
    focusDetailButtons();
  }

  /* a changed watched/read state must also show up in the screens we return
     to (their item lists are snapshots taken when we left them) */
  function propagateUserData(id, ud) {
    function fix(list) {
      for (var i = 0; list && i < list.length; i++) {
        if (list[i] && list[i].Id === id) list[i].UserData = ud;
      }
    }
    function fixSnap(sn) {
      if (!sn) return;
      fix(sn.items);
      if (sn.current && sn.current.Id === id) sn.current.UserData = ud;
      for (var r = 0; sn.homeRows && r < sn.homeRows.length; r++) fix(sn.homeRows[r].items);
    }
    fixSnap(state);
    for (var i = 0; i < state.stack.length; i++) fixSnap(state.stack[i]);
    fixSnap(state.playerReturn);
    fixSnap(state.readerReturn);
  }

  function togglePlayed(item) {
    var played = !!(item.UserData && item.UserData.Played);
    var id = encodeURIComponent(item.Id);
    var uid = encodeURIComponent(state.userId);
    apiAlt(played ? 'DELETE' : 'POST', '/UserPlayedItems/' + id + '?' + uidParam(),
      '/Users/' + uid + '/PlayedItems/' + id,
      function (err, txt) {
        if (err) { showToast(T('Konnte Status nicht ändern ({0}).', errText(err))); return; }
        var ud = null;
        try { ud = JSON.parse(txt); } catch (e) {}
        if (!ud || typeof ud.Played !== 'boolean') {
          ud = item.UserData || {};
          ud.Played = !played;
          ud.PlaybackPositionTicks = 0;
          ud.PlayedPercentage = 0;
        }
        item.UserData = ud;
        propagateUserData(item.Id, ud);
        state.homeDirty = true;
        var book = item.Type === 'Book';
        showToast(played ? (book ? T('Als ungelesen markiert') : T('Als ungesehen markiert')) :
          (book ? T('Als gelesen markiert') : T('Als gesehen markiert')));
        if (state.view === 'details' && state.current === item) {
          var st = content.scrollTop;
          renderDetailsBody(item);
          content.scrollTop = st;
        }
      });
  }

  /* ---------- books: comic and EPUB reader ----------
     Pages come from the NaCl module's book service (/__book/..., see
     native/src/tlsproxy.cc + book.cpp): ZIP/RAR4/RAR5 comics, EPUB as ZIP. */

  var readerEl = document.getElementById('reader');
  var EPUB_FONT_SIZES = [21, 25, 30];

  function bookUrl(id, what, arg) {
    return API + '/__book/' + encodeURIComponent(id) + '/' + what +
      (arg !== undefined ? '/' + encodeURIComponent(arg) : '') +
      '?token=' + encodeURIComponent(state.token);
  }

  function bookGet(url, json, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    var timer = setTimeout(function () { finish('timeout', null); try { x.abort(); } catch (e) {} }, 90000);
    function finish(err, data) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(err, data);
    }
    x.open('GET', url, true);
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var body = x.responseText;
      if (x.status !== 200) {
        var msg = 'HTTP ' + x.status;
        try { msg = JSON.parse(body).error || msg; } catch (e) {}
        finish(msg, null);
        return;
      }
      if (!json) { finish(null, body); return; }
      try { finish(null, JSON.parse(body)); } catch (e2) { finish('json', null); }
    };
    x.send(null);
  }

  function readProgress(id) {
    try { return JSON.parse(localStorage.getItem('jf_read_' + id) || 'null'); } catch (e) { return null; }
  }

  function saveProgress(id, p) {
    try { localStorage.setItem('jf_read_' + id, JSON.stringify(p)); } catch (e) {}
  }

  function progressLabel(p) {
    if (!p) return '';
    if (typeof p.page === 'number') return T('Seite {0}', p.page + 1);
    if (typeof p.chapter === 'number') return T('Kapitel {0}', p.chapter + 1);
    return '';
  }

  /* entry from the details page; fresh = ignore the saved position */
  function openBook(item, fresh) {
    if (proxy.state !== 'on') {
      showToast(T('Bücher brauchen das TLS-Modul (NaCl).'));
      return;
    }
    var req = ++state.playReq;
    state.playLoading = true;
    showPlayerLoading();
    bookGet(bookUrl(item.Id, 'info'), true, function (err, info) {
      if (req !== state.playReq) return;
      state.playLoading = false;
      hidePlayerLoading();
      if (err || !info) {
        showToast(/unknown archive/.test(err) ? T('Dieses Dateiformat wird nicht unterstützt.') :
          T('Buch konnte nicht geöffnet werden ({0}).', err));
        return;
      }
      var saved = fresh ? null : readProgress(item.Id);
      state.reader = { item: item, info: info, done: false };
      state.readerReturn = snapshot();
      state.view = 'reader';
      setChrome(false);
      readerEl.className = info.epub ? 'epub' : 'comic';
      if (info.epub) openEpub(saved);
      else if (!info.pages) { exitReader(); showToast(T('Keine Seiten im Archiv gefunden.')); }
      else openComic(saved && typeof saved.page === 'number' ? saved.page : 0);
    });
  }

  function exitReader() {
    var r = state.reader;
    readerEl.className = 'hidden';
    readerEl.innerHTML = '';
    hidePlayerLoading();
    state.reader = null;
    var s = state.readerReturn;
    state.readerReturn = null;
    state.view = 'details';
    if (r && r.item && s && s.view === 'details') s.detailFocusKey = 'read';
    if (s) restoreState(s);
    else goHome();
  }

  /* mark as read in Jellyfin once the end is reached */
  function bookFinished() {
    var r = state.reader;
    if (!r || r.done) return;
    r.done = true;
    var id = encodeURIComponent(r.item.Id);
    var item = r.item;
    apiAlt('POST', '/UserPlayedItems/' + id + '?' + uidParam(),
      '/Users/' + encodeURIComponent(state.userId) + '/PlayedItems/' + id, function (err) {
        if (err) return;
        var ud = item.UserData || {};
        ud.Played = true;
        propagateUserData(item.Id, ud);
      });
    state.homeDirty = true;
  }

  function fadeReaderHint() {
    setTimeout(function () { var h = $('rhint'); if (h) h.className = 'fade'; }, 6000);
  }

  /* --- comics --- */

  function openComic(page) {
    readerEl.innerHTML = '<div id="rview"><img id="rimg" alt=""></div><div id="rinfo"></div>' +
      '<div id="rhint">' + esc(T('◀ ▶ Blättern  ·  OK: Seite / Breite  ·  0–9: Springen  ·  Zurück: Schließen')) + '</div>';
    fadeReaderHint();
    var r = state.reader;
    r.kind = 'comic';
    r.mode = 'page';
    r.page = Math.max(0, Math.min(page, r.info.pages - 1));
    r.scroll = 0;
    r.cache = {};
    var img = $('rimg');
    img.onload = function () {
      hidePlayerLoading();
      layoutComic(r.atEnd);
      r.atEnd = false;
      preloadNext();
    };
    img.onerror = function () {
      var page = r.page;
      /* PDF pages are rendered on the TV and can be slow or fail once:
         try again twice before giving up */
      if (r.retries < 2) {
        r.retries++;
        setTimeout(function () {
          if (state.reader !== r || r.page !== page) return;
          $('rimg').src = bookUrl(r.item.Id, 'page', page) + '&retry=' + r.retries;
        }, 800);
        return;
      }
      /* ask again to get the module's error text */
      bookGet(bookUrl(r.item.Id, 'page', page), false, function (err) {
        hidePlayerLoading();
        if (!err && state.reader === r && r.page === page) {
          $('rimg').src = bookUrl(r.item.Id, 'page', page) + '&retry=3';  /* worked now */
          return;
        }
        showToast(err ? T('Seite {0} konnte nicht geladen werden ({1}).', page + 1, err) : T('Seite {0} konnte nicht geladen werden.', page + 1));
      });
    };
    showComicPage(r.page, false);
  }

  function showComicPage(n, fromEnd) {
    var r = state.reader;
    if (n < 0 || n >= r.info.pages) return;
    r.page = n;
    r.scroll = 0;
    r.atEnd = !!fromEnd;
    r.retries = 0;
    showPlayerLoading();
    $('rimg').src = bookUrl(r.item.Id, 'page', n);
    comicInfo();
    saveProgress(r.item.Id, { page: n });
    if (n === r.info.pages - 1) bookFinished();
    /* neighbours (two ahead, one back) are preloaded after this page */
    r.preload = [n + 1, n + 2, n - 1];
  }

  /* one preload at a time, so the page the user wants never waits behind
     several others (PDF pages are rendered one by one in the module) */
  function preloadNext() {
    var r = state.reader;
    if (!r || r.kind !== 'comic' || r.preloading || !r.preload) return;
    while (r.preload.length) {
      var p = r.preload.shift();
      if (p < 0 || p >= r.info.pages || r.cache[p]) continue;
      var im = new Image();
      r.cache[p] = im;
      r.preloading = true;
      im.onload = im.onerror = function () {
        r.preloading = false;
        if (state.reader === r) preloadNext();
      };
      im.src = bookUrl(r.item.Id, 'page', p);
      return;
    }
  }

  function comicInfo() {
    var r = state.reader;
    $('rinfo').textContent = T('Seite {0} / {1}', r.page + 1, r.info.pages) +
      (r.mode === 'width' ? '  \u00b7  ' + T('Breite (\u25b2\u25bc)') : '');
  }

  function layoutComic(fromEnd) {
    var r = state.reader;
    var img = $('rimg');
    var view = $('rview');
    if (!img || !view) return;
    img.className = r.mode === 'width' ? 'fitwidth' : '';
    r.maxScroll = r.mode === 'width' ? Math.max(0, img.offsetHeight - view.clientHeight) : 0;
    r.scroll = fromEnd ? r.maxScroll : Math.min(r.scroll, r.maxScroll);
    img.style.marginTop = r.mode === 'width' ? (-r.scroll) + 'px' : '';
  }

  function comicKey(e, k) {
    var r = state.reader;
    var view = $('rview');
    var step = view ? Math.round(view.clientHeight * 0.7) : 400;
    if (k === K_RIGHT || k === K_FF || k === K_CH_DOWN) showComicPage(r.page + 1, false);
    else if (k === K_LEFT || k === K_RW || k === K_CH_UP) showComicPage(r.page - 1, true);
    else if (k === K_DOWN) {
      if (r.mode === 'width' && r.scroll < r.maxScroll) { r.scroll = Math.min(r.maxScroll, r.scroll + step); layoutComic(false); }
      else showComicPage(r.page + 1, false);
    } else if (k === K_UP) {
      if (r.mode === 'width' && r.scroll > 0) { r.scroll = Math.max(0, r.scroll - step); layoutComic(false); }
      else showComicPage(r.page - 1, true);
    } else if (k === K_ENTER) {
      r.mode = r.mode === 'page' ? 'width' : 'page';
      r.scroll = 0;
      layoutComic(false);
      comicInfo();
    } else if (k >= 48 && k <= 57) {
      showComicPage(Math.floor(r.info.pages * (k - 48) / 10), false);
    }
  }

  /* --- EPUB --- */

  function dirOf(path) { var i = path.lastIndexOf('/'); return i < 0 ? '' : path.substr(0, i + 1); }

  /* resolve "../images/a.jpg" against "OEBPS/text/" */
  function resolvePath(base, href) {
    href = href.split('#')[0];
    try { href = decodeURIComponent(href); } catch (e) {}
    var parts = (href.charAt(0) === '/' ? href.substr(1) : base + href).split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') out.pop();
      else if (parts[i] !== '.' && parts[i] !== '') out.push(parts[i]);
    }
    return out.join('/');
  }

  function parseXml(text) {
    try { return new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { return null; }
  }

  function byTag(doc, name) {
    var list = doc.getElementsByTagName(name);
    if (!list.length) list = doc.getElementsByTagName('opf:' + name);
    return list;
  }

  function openEpub(saved) {
    var r = state.reader;
    r.kind = 'epub';
    r.fontIdx = 1;
    try { r.fontIdx = parseInt(localStorage.getItem('jf_epub_font') || '1', 10) || 0; } catch (e) {}
    readerEl.innerHTML = '<div id="epub"><div id="epubInner"></div></div><div id="rinfo"></div>' +
      '<div id="rhint">' + esc(T('◀ ▶ Blättern  ·  ▲ ▼ Kapitel  ·  OK: Schriftgröße  ·  Zurück: Schließen')) + '</div>';
    fadeReaderHint();
    showPlayerLoading();
    bookGet(bookUrl(r.item.Id, 'file', 'META-INF/container.xml'), false, function (err, xml) {
      if (state.reader !== r) return;
      var doc = !err && parseXml(xml);
      var root = doc && doc.getElementsByTagName('rootfile')[0];
      var opfPath = root && root.getAttribute('full-path');
      if (!opfPath) { epubFail(err || 'container.xml'); return; }
      bookGet(bookUrl(r.item.Id, 'file', opfPath), false, function (err2, opfText) {
        if (state.reader !== r) return;
        var opf = !err2 && parseXml(opfText);
        if (!opf) { epubFail(err2 || 'OPF'); return; }
        var base = dirOf(opfPath);
        var manifest = {};
        var items = byTag(opf, 'item');
        var i;
        for (i = 0; i < items.length; i++) {
          manifest[items[i].getAttribute('id')] = {
            href: resolvePath(base, items[i].getAttribute('href') || ''),
            type: items[i].getAttribute('media-type') || ''
          };
        }
        r.chapters = [];
        var refs = byTag(opf, 'itemref');
        for (i = 0; i < refs.length; i++) {
          var m = manifest[refs[i].getAttribute('idref')];
          if (m && /html/.test(m.type) && refs[i].getAttribute('linear') !== 'no') r.chapters.push(m.href);
        }
        if (!r.chapters.length) { epubFail(T('keine Kapitel')); return; }
        var c = saved && typeof saved.chapter === 'number' ? Math.min(saved.chapter, r.chapters.length - 1) : 0;
        showChapter(c, saved && typeof saved.frac === 'number' ? saved.frac : 0);
      });
    });
  }

  function epubFail(why) {
    hidePlayerLoading();
    exitReader();
    showToast(T('EPUB konnte nicht gelesen werden ({0}).', why));
  }

  /* where: 0..1 = position in the chapter, -1 = last page */
  function showChapter(idx, where) {
    var r = state.reader;
    if (idx < 0 || idx >= r.chapters.length) return;
    r.chapter = idx;
    var path = r.chapters[idx];
    showPlayerLoading();
    bookGet(bookUrl(r.item.Id, 'file', path), false, function (err, html) {
      if (state.reader !== r || r.chapter !== idx) return;
      hidePlayerLoading();
      if (err) { showToast(T('Kapitel konnte nicht geladen werden ({0}).', err)); return; }
      var inner = $('epubInner');
      inner.innerHTML = chapterHtml(html, dirOf(path), r.item.Id);
      inner.style.fontSize = EPUB_FONT_SIZES[r.fontIdx] + 'px';
      inner.style.marginLeft = '0';
      layoutEpub(where);
      /* images change the layout once loaded */
      var imgs = inner.getElementsByTagName('img');
      for (var i = 0; i < imgs.length; i++) {
        imgs[i].onload = imgs[i].onerror = function () {
          if (state.reader === r && r.chapter === idx) layoutEpub(r.pages ? r.page / r.pages : 0);
        };
      }
    });
  }

  /* keep the text, drop scripts/styles/links; images point to the book service */
  function chapterHtml(html, base, id) {
    var m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
    var body = m ? m[1] : html;
    var box = document.createElement('div');
    box.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    var drop = box.querySelectorAll('link,meta,iframe,object,embed,video,audio');
    var i;
    for (i = 0; i < drop.length; i++) drop[i].parentNode.removeChild(drop[i]);
    var all = box.getElementsByTagName('*');
    for (i = 0; i < all.length; i++) {
      var el2 = all[i];
      el2.removeAttribute('style');
      el2.removeAttribute('class');
      if (el2.tagName.toLowerCase() === 'a') el2.removeAttribute('href');
      var src = el2.getAttribute('src');
      if (src && el2.tagName.toLowerCase() === 'img') el2.setAttribute('src', bookUrl(id, 'file', resolvePath(base, src)));
      var xl = el2.getAttribute('xlink:href');
      if (xl && el2.tagName.toLowerCase() === 'image') {
        /* SVG cover pages: show them as a plain image */
        var img = document.createElement('img');
        img.setAttribute('src', bookUrl(id, 'file', resolvePath(base, xl)));
        var svg = el2.parentNode;
        while (svg && svg.tagName && svg.tagName.toLowerCase() !== 'svg') svg = svg.parentNode;
        if (svg && svg.parentNode) svg.parentNode.replaceChild(img, svg);
      }
    }
    return box.innerHTML;
  }

  function layoutEpub(where) {
    var r = state.reader;
    var view = $('epub');
    var inner = $('epubInner');
    var w = view.clientWidth;
    var gap = 80;
    var col = Math.floor((w - gap) / 2);
    inner.style.webkitColumnWidth = col + 'px';
    inner.style.columnWidth = col + 'px';
    inner.style.webkitColumnGap = gap + 'px';
    inner.style.columnGap = gap + 'px';
    inner.style.height = view.clientHeight + 'px';
    r.step = w + gap;
    r.pages = Math.max(1, Math.ceil((inner.scrollWidth + gap) / r.step));
    r.page = where < 0 ? r.pages - 1 : Math.min(r.pages - 1, Math.floor(where * r.pages));
    showEpubPage();
  }

  function showEpubPage() {
    var r = state.reader;
    $('epubInner').style.marginLeft = (-r.page * r.step) + 'px';
    $('rinfo').textContent = T('Kapitel {0} / {1}', r.chapter + 1, r.chapters.length) + '  ·  ' + T('Seite {0} / {1}', r.page + 1, r.pages);
    saveProgress(r.item.Id, { chapter: r.chapter, frac: r.pages > 1 ? r.page / r.pages : 0 });
    if (r.chapter === r.chapters.length - 1 && r.page === r.pages - 1) bookFinished();
  }

  function epubKey(e, k) {
    var r = state.reader;
    if (!r.chapters || !r.pages) return;
    if (k === K_RIGHT || k === K_FF) {
      if (r.page < r.pages - 1) { r.page++; showEpubPage(); }
      else showChapter(r.chapter + 1, 0);
    } else if (k === K_LEFT || k === K_RW) {
      if (r.page > 0) { r.page--; showEpubPage(); }
      else showChapter(r.chapter - 1, -1);
    } else if (k === K_DOWN || k === K_CH_DOWN) showChapter(r.chapter + 1, 0);
    else if (k === K_UP || k === K_CH_UP) showChapter(r.chapter - 1, 0);
    else if (k === K_ENTER) {
      r.fontIdx = (r.fontIdx + 1) % EPUB_FONT_SIZES.length;
      try { localStorage.setItem('jf_epub_font', String(r.fontIdx)); } catch (x) {}
      $('epubInner').style.fontSize = EPUB_FONT_SIZES[r.fontIdx] + 'px';
      layoutEpub(r.pages ? r.page / r.pages : 0);
    }
  }

  function handleReaderKey(e, k) {
    e.preventDefault();
    if (isBackKey(k) || k === K_STOP) { exitReader(); return; }
    if (!state.reader) return;
    if (state.reader.kind === 'comic') comicKey(e, k);
    else if (state.reader.kind === 'epub') epubKey(e, k);
  }

  /* ---------- playback setup ---------- */

  /* host[:port] of the Jellyfin server itself: its public name, a private
     network address or the default Jellyfin ports */
  function isServerAddress(hostPort) {
    var host = hostPort.replace(/:\d+$/, '').toLowerCase();
    if (server.jf && host === server.jf.host) return true;
    if (/:(8096|8920)$/.test(hostPort)) return true;
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$|\[)/.test(host);
  }

  function absUrl(u) {
    if (!u) return '';
    if (u.charAt(0) === '/') {
      u = API + u;
    } else if (u.indexOf('http') !== 0) {
      u = API + '/' + u;
    } else {
      /* the server sometimes answers with its own internal address */
      var m = u.match(/^https?:\/\/([^\/]+)/);
      if (m && isServerAddress(m[1])) {
        u = API.replace(/^(https?:\/\/[^\/]+).*$/, '$1') + u.substring(m[0].length);
      }
    }
    u = u.replace(/([?&])api_key=/g, '$1ApiKey=');
    if (u.indexOf('ApiKey=') < 0) {
      u += (u.indexOf('?') >= 0 ? '&' : '?') + 'ApiKey=' + encodeURIComponent(state.token);
    }
    return u;
  }

  function cancelPlayLoading() {
    state.playReq++;
    state.playLoading = false;
    hidePlayerLoading();
    showToast(T('Wiedergabe abgebrochen'));
  }

  /* the media source with this id, else the server's first (preferred) one */
  function pickSource(list, id) {
    if (!list || !list.length) return null;
    for (var i = 0; id && i < list.length; i++) if (list[i].Id === id) return list[i];
    return list[0];
  }

  /* "4K  ·  2160p HEVC  ·  12.3 GB" */
  function sourceLabel(src) {
    var parts = [src.Name || src.Container || '?'];
    var streams = src.MediaStreams || [];
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      if (s.Type !== 'Video') continue;
      var res = s.Height && parts[0].indexOf(s.Height + 'p') < 0 ? s.Height + 'p' : '';  /* not twice: "1080p  ·  1080p" */
      var v = (res + (s.Codec ? ' ' + s.Codec.toUpperCase() : '')).replace(/^\s+/, '');
      if (v) parts.push(v);
      break;
    }
    if (src.Size) parts.push((Math.round(src.Size / 1e8) / 10) + ' GB');
    return parts.join('  ·  ');
  }

  function chooseVersion(item) {
    var list = item.MediaSources || [];
    var cur = pickSource(list, state.sourceChoice[item.Id]);
    var labels = [];
    var focus = 0;
    for (var i = 0; i < list.length; i++) {
      labels.push(sourceLabel(list[i]));
      if (list[i] === cur) focus = i;
    }
    openChoice(T('Version'), labels, focus, function (i) {
      state.sourceChoice[item.Id] = list[i].Id;
      if (state.view === 'details' && state.current === item) {
        var st = content.scrollTop;
        renderDetailsBody(item);
        content.scrollTop = st;
      }
    });
  }

  /* opts.startMs: resume position (defaults to the saved position)
     opts.chain: continue in the running player (next episode) */
  function playItem(item, opts) {
    opts = opts || {};
    if (!isPlayable(item)) { openItem(item); return; }
    if (item.Type === 'TvChannel') { playLive(item, opts); return; }
    var startMs = typeof opts.startMs === 'number' ? opts.startMs : resumeMs(item);
    var req = ++state.playReq;
    state.playLoading = true;
    showPlayerLoading();
    if (!opts.chain) showToast(T('Lade {0} ...', item.Name || ''));
    getJson('/Items/' + encodeURIComponent(item.Id) + '/PlaybackInfo?' + uidParam(), function (err, data) {
      if (req !== state.playReq) return;
      state.playLoading = false;
      if (err) {
        hidePlayerLoading();
        showToast(T('Wiedergabe-Info fehlgeschlagen ({0}).', errText(err)));
        if (opts.chain) stopPlayback();
        return;
      }
      var src = pickSource(data && data.MediaSources, state.sourceChoice[item.Id]);
      if (!opts.chain) {
        state.playerReturn = snapshot();
      } else if (state.playerReturn && state.playerReturn.view === 'details') {
        state.playerReturn.current = item;
      }
      state.playerItem = item;
      state.playerSource = src;
      state.playSessionId = (data && data.PlaySessionId) || '';
      state.mediaSourceId = src && src.Id ? src.Id : item.Id;
      state.startMs = startMs;
      state.playerOffset = 0;
      state.playMethod = 'DirectPlay';
      state.isLive = false;
      state.lastGoodPos = startMs;
      state.recoverTries = 0;
      state.recoverAt = 0;
      state.pausedAt = 0;
      hideSkip();
      hideUpNext();
      state.upNext = state.autoNext && item.Type === 'Episode' && item.SeriesId ?
        { itemId: item.Id, next: undefined, loading: false, shown: false, cancelled: false, focus: 0, deadline: 0 } : null;
      loadSegments(item);
      state.reported = false;
      state.triedFallback = false;
      state.fallbackPending = false;
      state.prepared = false;
      state.trickplay = findTrickplay(item);
      state.trickplayCache = {};
      state.trickplayLastUrl = '';
      state.trickplayPreloadAt = startMs;
      state.trickplayPending = null;
      try { seekImg.style.backgroundImage = 'none'; } catch (e2) {}
      if (state.trickplay) {
        var tpPer = state.trickplay.tileWidth * state.trickplay.tileHeight;
        preloadTrickplayAround(startMs, tpPer > 1 ? 10 : 5);
      }

      var audio = audioChoice(src);
      initTracks(audio);
      state.playerDuration = item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS) : 0;
      if (audio.unsupported || (src && !src.DirectStreamUrl && src.SupportsDirectPlay === false)) {
        /* E-AC3/Atmos, TrueHD etc.: let Jellyfin produce a progressive MPEG-TS
           with H.264 video and AAC stereo audio. AVPlay handles this much
           better than the HLS output on this TV. */
        state.aacAudioTrack = -1;
        state.triedFallback = true;
        startTranscode(startMs);
        return;
      }
      state.aacAudioTrack = audio.aac;
      var url = src && src.DirectStreamUrl ? src.DirectStreamUrl : '';
      if (!url) {
        url = '/Videos/' + encodeURIComponent(item.Id) + '/stream?static=true' +
          '&MediaSourceId=' + encodeURIComponent(state.mediaSourceId);
      }
      startAvplay(absUrl(url));
    });
  }

  function startTranscode(startMs) {
    if (state.isLive) { restartLive(true, true); return; }
    var item = state.playerItem;
    var req = state.playReq;
    state.playMethod = 'Transcode';
    showPlayerLoading();
    requestProgressive(item, startMs, function (turl, sessionId) {
      if (req !== state.playReq || state.stopping) return;
      if (sessionId) state.playSessionId = sessionId;
      state.playerOffset = startMs;
      var url = turl ? absUrl(turl) : hlsUrl(startMs);
      if (startMs > 0 && !/StartTimeTicks=/i.test(url)) {
        url += '&StartTimeTicks=' + Math.round(startMs * TICKS);
      }
      startAvplay(url);
    });
  }

  function hlsUrl(startMs) {
    var item = state.playerItem;
    if (!item) return '';
    return API + '/Videos/' + encodeURIComponent(item.Id) + '/main.m3u8' +
      '?ApiKey=' + encodeURIComponent(state.token) +
      '&MediaSourceId=' + encodeURIComponent(state.mediaSourceId) +
      '&VideoCodec=h264&AudioCodec=aac&MaxAudioChannels=2' +
      '&TranscodingProtocol=hls&TranscodingContainer=ts&SegmentContainer=ts' +
      (startMs > 0 ? '&StartTimeTicks=' + Math.round(startMs * TICKS) : '');
  }

  function audioChoice(src) {
    var order = 0;
    var firstCodec = '';
    var defaultCodec = '';
    var aac = -1;
    var i;
    if (!src || !src.MediaStreams) return { transcode: false, unsupported: false, aac: -1 };
    for (i = 0; i < src.MediaStreams.length; i++) {
      var st = src.MediaStreams[i];
      if (st.Type !== 'Audio') continue;
      var c = (st.Codec || '').toLowerCase();
      if (order === 0) firstCodec = c;
      if (st.IsDefault && !defaultCodec) defaultCodec = c;
      if (c === 'aac' && aac < 0) aac = order;
      order++;
    }
    if (!defaultCodec) defaultCodec = firstCodec;
    var unsupported = defaultCodec === 'eac3' || defaultCodec === 'truehd' ||
      defaultCodec === 'mlp' || defaultCodec === 'flac' || defaultCodec === 'opus';
    return { transcode: unsupported && aac < 0, unsupported: unsupported, aac: aac };
  }

  function selectPreferredAudio(token) {
    if (token !== undefined && token !== state.playToken) return;
    var p = null;
    try { p = webapis.avplay; } catch (e) { return; }
    if (!p || state.aacAudioTrack < 0) return;
    var idx = -1;
    var tracks = null;
    try { tracks = p.getTotalTrackInfo(); } catch (e) {}
    if (tracks) {
      var i;
      for (i = 0; i < tracks.length; i++) {
        var t = tracks[i];
        if (!t || String(t.type).toUpperCase() !== 'AUDIO') continue;
        var extra = t.extra_info || '';
        if (/aac/i.test(extra)) { idx = t.index; break; }
      }
    }
    if (idx < 0) idx = state.aacAudioTrack;
    if (idx >= 0) {
      try { p.setSelectTrack('AUDIO', idx); } catch (e2) {}
    }
  }

  function requestProgressive(item, startMs, callback) {
    var body = {
      MediaSourceId: state.mediaSourceId || item.Id,
      StartTimeTicks: Math.round((startMs || 0) * TICKS),
      /* No subtitle burn-in: with an encoded subtitle Jellyfin keeps the
         original video timestamps after a seek (video at e.g. 1200 s, audio
         at 0 s) and AVPlay shows one frame while only the audio plays. */
      SubtitleStreamIndex: -1,
      EnableDirectPlay: false,
      EnableDirectStream: false,
      DeviceProfile: {
        MaxStreamingBitrate: 8000000,
        DirectPlayProfiles: [],
        TranscodingProfiles: [{
          Container: 'ts',
          Type: 'Video',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          Protocol: 'http',
          Context: 'Streaming',
          MaxAudioChannels: '2'
        }],
        CodecProfiles: []
      }
    };
    var path = '/Items/' + encodeURIComponent(item.Id) + '/PlaybackInfo?' + uidParam() +
      '&StartTimeTicks=' + body.StartTimeTicks + '&SubtitleStreamIndex=-1';
    if (state.audioIndex >= 0) {
      body.AudioStreamIndex = state.audioIndex;
      path += '&AudioStreamIndex=' + state.audioIndex;
    }
    api('POST', path, body, function (err, txt) {
      if (err) { callback('', ''); return; }
      var data = null;
      try { data = JSON.parse(txt); } catch (e) { callback('', ''); return; }
      var src = pickSource(data && data.MediaSources, state.mediaSourceId);
      callback(src && src.TranscodingUrl ? src.TranscodingUrl : '', (data && data.PlaySessionId) || '');
    });
  }

  /* tell the server to kill a transcode we no longer read from */
  function stopEncoding() {
    if (state.playMethod !== 'Transcode' || !state.playSessionId) return;
    api('DELETE', '/Videos/ActiveEncodings?deviceId=' + encodeURIComponent(DEVICEID) +
      '&playSessionId=' + encodeURIComponent(state.playSessionId), null, null);
  }

  /* ---------- playback reporting (resume points, watched state) ---------- */

  function curPos() {
    var cur = 0;
    try { cur = webapis.avplay.getCurrentTime(); } catch (e) {}
    return (cur || 0) + state.playerOffset;
  }

  function curDuration() {
    if (state.playMethod === 'Transcode' && state.playerDuration) return state.playerDuration;
    var d = 0;
    try { d = webapis.avplay.getDuration(); } catch (e) {}
    return d > 0 ? d : state.playerDuration;
  }

  function reportBody(posMs) {
    var item = state.playerItem;
    return {
      ItemId: item ? item.Id : '',
      MediaSourceId: state.mediaSourceId,
      PlaySessionId: state.playSessionId,
      PositionTicks: Math.max(0, Math.round(posMs * TICKS)),
      IsPaused: state.playerPaused,
      IsMuted: false,
      CanSeek: true,
      PlayMethod: state.playMethod,
      LiveStreamId: state.liveStreamId || undefined
    };
  }

  function reportStart() {
    if (!state.playerItem) return;
    state.reported = true;
    state.lastReport = now();
    api('POST', '/Sessions/Playing', reportBody(state.startMs), null);
  }

  function reportProgress(eventName) {
    if (!state.reported || !state.prepared) return;
    state.lastReport = now();
    var body = reportBody(curPos());
    if (eventName) body.EventName = eventName;
    api('POST', '/Sessions/Playing/Progress', body, null);
  }

  function reportStopped(posMs, cb) {
    if (!state.reported || !state.playerItem) { if (cb) cb(); return; }
    state.reported = false;
    api('POST', '/Sessions/Playing/Stopped', reportBody(posMs), function () { if (cb) cb(); });
  }

  /* ---------- player UI ---------- */

  function clearPrepareTimer() {
    if (state.prepareTimer) {
      clearTimeout(state.prepareTimer);
      state.prepareTimer = null;
    }
  }

  function hidePlayerUi() {
    if (state.view !== 'player' || state.playerPaused || menuOpen()) return;
    playerUi.className = 'hidden';
    subtitleEl.className = '';
  }

  function showPlayerUi() {
    if (state.view !== 'player') return;
    playerUi.className = '';
    subtitleEl.className = 'raised';
    if (state.playerUiHideTimer) clearTimeout(state.playerUiHideTimer);
    state.playerUiHideTimer = setTimeout(hidePlayerUi, 4500);
    var cur = curPos();
    if (state.trickplay && Math.abs(cur - state.trickplayPreloadAt) > 30000) {
      state.trickplayPreloadAt = cur;
      var per = state.trickplay.tileWidth * state.trickplay.tileHeight;
      preloadTrickplayAround(cur, per > 1 ? 8 : 4);
    }
  }

  function showPlayerLoading() {
    loadingSpinner.className = '';
  }

  function hidePlayerLoading() {
    loadingSpinner.className = 'hidden';
  }

  function playerTitles(item) {
    if (!item) return ['', ''];
    if (item.Type === 'TvChannel') return [channelLabel(item), item.CurrentProgram ? item.CurrentProgram.Name || '' : ''];
    if (item.Type === 'Episode') {
      var se = episodeCode(item);
      return [item.SeriesName || item.Name || '', (se ? se + '  ·  ' : '') + (item.Name || '')];
    }
    return [item.Name || '', item.ProductionYear ? String(item.ProductionYear) : ''];
  }

  function updatePlayerUi() {
    if (state.view !== 'player') return;
    var st = '';
    try { st = webapis.avplay.getState(); } catch (e) {}
    var cur = curPos();
    /* a transcode that already carries absolute timestamps needs no offset */
    if (state.playerOffset > 60000 && st === 'PLAYING' && now() < state.offsetCheckUntil &&
        Math.abs((cur - state.playerOffset) - state.playerOffset) < 15000) {
      state.playerOffset = 0;
      cur = curPos();
    }
    var dur = curDuration();
    var display = state.seekTarget !== null ? state.seekTarget : cur;
    if (state.isLive) {
      updateLiveUi();
    } else {
    var pct = dur > 0 ? Math.min(100, Math.max(0, display / dur * 100)) : 0;
    progressFill.style.width = pct + '%';
    ptime.textContent = fmtTime(display) + ' / ' + fmtTime(dur);
    pend.textContent = dur > 0 ? T('Endet um {0}', fmtClock(new Date(now() + Math.max(0, dur - display)))) : '';
    }
    var wasPaused = state.playerPaused;
    state.playerPaused = (st === 'PAUSED');
    pauseIcon.className = state.playerPaused && state.seekTarget === null ? '' : 'hidden';
    if (wasPaused && !state.playerPaused) showPlayerUi();
    if (state.trickplay && st === 'PLAYING' &&
        state.trickplay.tileWidth * state.trickplay.tileHeight > 1 &&
        Math.abs(cur - state.trickplayPreloadAt) > 60000) {
      state.trickplayPreloadAt = cur;
      preloadTrickplayAround(cur, 2);
    }
    updateSkip(cur);
    if (state.seekTarget !== null) {
      phint.textContent = T('Spule zu {0} ...', fmtTime(state.seekTarget));
    } else {
      var it = state.playerItem;
      phint.textContent = state.isLive ? [state.playerPaused ? T('OK: Weiter') : T('OK: Pause'), T('CH ▲ ▼: Sender'),
        T('0–9: Sendernummer'), T('Blau: Optionen'), T('Zurück: Stopp')].join('  ·  ') :
        [state.skipSeg ? T('OK: Überspringen') : state.playerPaused ? T('OK: Weiter') : T('OK: Pause'), T('◀ ▶: Spulen')]
        .concat(it && it.Type === 'Episode' && it.SeriesId ? [T('CH ▲ ▼: Folge')] : [])
        .concat([T('Blau: Optionen'), T('Zurück: Stopp')]).join('  ·  ');
    }
    if (st === 'PLAYING' && now() - state.lastReport > 10000) reportProgress('TimeUpdate');
    /* paused: keep the session (and a transcode) alive on the server */
    if (st === 'PAUSED' && now() - state.lastReport > 30000) reportProgress('TimeUpdate');
    if (st === 'PLAYING' && state.seekTarget === null && state.prepared) {
      state.lastGoodPos = cur;
      if (state.recoverTries && cur > state.recoverAt + 60000) state.recoverTries = 0;
    }
    if (state.bufferingSince && now() - state.bufferingSince > 30000) {
      state.bufferingSince = 0;
      recoverPlayback(state.playToken);
    }
    updateUpNext(cur, st);
  }

  function stopUiTimer() {
    if (state.playerUiTimer) {
      clearInterval(state.playerUiTimer);
      state.playerUiTimer = null;
    }
  }

  function startUiTimer() {
    stopUiTimer();
    updatePlayerUi();
    state.playerUiTimer = setInterval(updatePlayerUi, 1000);
  }

  /* mode: 'play', 'pause' or undefined (toggle) */
  function togglePause(mode) {
    var p = null;
    try { p = webapis.avplay; } catch (e) {}
    if (!p || !state.prepared) return;
    var st = '';
    try { st = p.getState(); } catch (e) {}
    var pause = mode ? mode === 'pause' : st === 'PLAYING';
    if (!pause && st === 'PAUSED' && state.pausedAt && now() - state.pausedAt > LONG_PAUSE) {
      /* the server or a proxy has most likely closed the idle connection by now */
      state.pausedAt = 0;
      reloadAt(curPos());
      reportProgress('Unpause');
      return;
    }
    state.pausedAt = pause ? now() : 0;
    try {
      if (pause && st === 'PLAYING') p.pause();
      else if (!pause && st === 'PAUSED') p.play();
      else return;
    } catch (e) {}
    updatePlayerUi();
    showPlayerUi();
    reportProgress(pause ? 'Pause' : 'Unpause');
  }

  /* ---------- player options: subtitles, audio, speed, picture ---------- */

  /* AVPlay on Tizen 2.3 only takes integer speeds (setSpeed(long)) */
  var SPEEDS = [1, 2, 4];
  var DISPLAY_MODES = [
    { label: 'Automatisch', mode: 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO' },
    { label: 'Vollbild', mode: 'PLAYER_DISPLAY_MODE_FULL_SCREEN' },
    { label: 'Letterbox', mode: 'PLAYER_DISPLAY_MODE_LETTER_BOX' }
  ];
  var UNSUPPORTED_AUDIO = { eac3: 1, truehd: 1, mlp: 1, flac: 1, opus: 1 };
  var IMAGE_SUBS = { pgssub: 1, dvdsub: 1, dvbsub: 1, dvb_subtitle: 1, hdmv_pgs_subtitle: 1 };

  function streamsOf(type) {
    var src = state.playerSource;
    var out = [];
    var i;
    if (!src || !src.MediaStreams) return out;
    for (i = 0; i < src.MediaStreams.length; i++) {
      if (src.MediaStreams[i].Type === type) out.push(src.MediaStreams[i]);
    }
    return out;
  }

  /* subtitles we can render ourselves (image formats like PGS can't be) */
  function textSubs() {
    var all = streamsOf('Subtitle');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var st = all[i];
      var codec = (st.Codec || '').toLowerCase();
      if (st.IsTextSubtitleStream === false || IMAGE_SUBS[codec]) continue;
      out.push(st);
    }
    return out;
  }

  function streamLabel(st) {
    if (st.DisplayTitle) return st.DisplayTitle;
    var parts = [];
    if (st.Language) parts.push(st.Language);
    if (st.Codec) parts.push(st.Codec.toUpperCase());
    if (st.Channels) parts.push(T('{0} Kan.', st.Channels));
    return parts.join(' ') || T('Spur {0}', st.Index);
  }

  function findStream(list, index) {
    for (var i = 0; i < list.length; i++) if (list[i].Index === index) return list[i];
    return null;
  }

  /* pick audio/subtitle tracks when a new item starts */
  function initTracks(audio) {
    var audios = streamsOf('Audio');
    var def = null;
    var i;
    for (i = 0; i < audios.length; i++) if (audios[i].IsDefault) { def = audios[i]; break; }
    if (!def && audios.length) def = audios[0];
    if (!audio.unsupported && audio.aac >= 0 && audios[audio.aac]) def = audios[audio.aac];
    state.audioIndex = def ? def.Index : -1;
    state.speed = 1;

    /* subtitles: keep the language chosen earlier (next episode), otherwise
       follow Jellyfin's default mode: forced first, then default tracks */
    var subs = textSubs();
    var pick = null;
    if (state.subPref === 'off') {
      pick = null;
    } else if (state.subPref) {
      for (i = 0; i < subs.length && !pick; i++) if (subs[i].Language === state.subPref) pick = subs[i];
    } else {
      for (i = 0; i < subs.length && !pick; i++) if (subs[i].IsForced) pick = subs[i];
      for (i = 0; i < subs.length && !pick; i++) if (subs[i].IsDefault) pick = subs[i];
    }
    selectSubtitle(pick ? pick.Index : -1);
  }

  function subtitleHtml(text) {
    text = String(text || '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/<[^>]+>/g, '');
    return esc(text).replace(/\r?\n/g, '<br>');
  }

  function renderSubtitle(html) {
    if (html === state.subHtml) return;
    state.subHtml = html;
    subtitleEl.innerHTML = html ? '<span>' + html + '</span>' : '';
  }

  function stopSubtitles() {
    state.subSeq++;
    state.subEvents = null;
    if (state.subTimer) { clearInterval(state.subTimer); state.subTimer = null; }
    renderSubtitle('');
  }

  function tickSubtitles() {
    var ev = state.subEvents;
    if (!ev || state.view !== 'player') return;
    var t = state.seekTarget !== null ? state.seekTarget : curPos();
    var lo = 0;
    var hi = ev.length - 1;
    var idx = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (ev[mid].s <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    var html = '';
    for (var i = idx; i >= 0 && i > idx - 6; i--) {
      if (ev[i].e > t) html = ev[i].html + (html ? '<br>' + html : '');
    }
    renderSubtitle(html);
  }

  /* index: Jellyfin stream index, -1 = off. Text is fetched as JSON and drawn
     by the app; burning it into the video breaks seeking in transcodes. */
  function selectSubtitle(index) {
    stopSubtitles();
    state.subIndex = index;
    if (index < 0 || !state.playerItem) return;
    var seq = state.subSeq;
    var id = encodeURIComponent(state.playerItem.Id);
    getJson('/Videos/' + id + '/' + encodeURIComponent(state.mediaSourceId) +
      '/Subtitles/' + index + '/0/Stream.js', function (err, data) {
        if (seq !== state.subSeq) return;
        if (err || !data || !data.TrackEvents) {
          state.subIndex = -1;
          showToast(T('Untertitel konnten nicht geladen werden ({0}).', errText(err || 'json')));
          return;
        }
        var ev = [];
        for (var i = 0; i < data.TrackEvents.length; i++) {
          var t = data.TrackEvents[i];
          ev.push({ s: t.StartPositionTicks / TICKS, e: t.EndPositionTicks / TICKS, html: subtitleHtml(t.Text) });
        }
        ev.sort(function (a, b) { return a.s - b.s; });
        state.subEvents = ev;
        state.subTimer = setInterval(tickSubtitles, 250);
        tickSubtitles();
      });
  }

  function selectAudio(st) {
    if (st.Index === state.audioIndex) return;
    state.audioIndex = st.Index;
    var codec = (st.Codec || '').toLowerCase();
    if (state.playMethod !== 'Transcode' && !UNSUPPORTED_AUDIO[codec]) {
      /* direct play: switch the track inside the file */
      var audios = streamsOf('Audio');
      var order = 0;
      var i;
      for (i = 0; i < audios.length; i++) if (audios[i] === st) order = i;
      var idx = order;
      var tracks = null;
      try { tracks = webapis.avplay.getTotalTrackInfo(); } catch (e) {}
      if (tracks) {
        var n = 0;
        for (i = 0; i < tracks.length; i++) {
          if (String(tracks[i].type).toUpperCase() !== 'AUDIO') continue;
          if (n === order) { idx = tracks[i].index; break; }
          n++;
        }
      }
      state.aacAudioTrack = -1;
      try {
        webapis.avplay.setSelectTrack('AUDIO', idx);
        showToast('Audio: ' + streamLabel(st));
      } catch (e2) {
        showToast(T('Tonspur konnte nicht gewechselt werden.'));
      }
      return;
    }
    /* transcoding (or a codec the TV can't decode): restart with that track */
    showToast(T('Audio: {0} – wird neu geladen ...', streamLabel(st)));
    var pos = curPos();
    stopEncoding();
    state.triedFallback = true;
    state.startMs = pos;
    startTranscode(pos);
  }

  function setPlaybackSpeed(v) {
    try {
      webapis.avplay.setSpeed(v);
      state.speed = v;
      showToast(v === 1 ? T('Normale Geschwindigkeit') : T('{0}× Geschwindigkeit', v));
    } catch (e) {
      showToast(T('{0}× wird bei dieser Wiedergabe nicht unterstützt.', v));
    }
  }

  function applyDisplayMode(quiet) {
    var m = DISPLAY_MODES[state.displayMode] || DISPLAY_MODES[0];
    try {
      webapis.avplay.setDisplayMethod(m.mode);
      if (!quiet) showToast(T('Bildformat: {0}', T(m.label)));
    } catch (e) {
      if (!quiet) showToast(T('Bildformat wird nicht unterstützt.'));
    }
  }

  function menuMain() {
    var subs = textSubs();
    var audios = streamsOf('Audio');
    var curSub = findStream(subs, state.subIndex);
    var curAudio = findStream(audios, state.audioIndex);
    return [
      {
        label: T('Untertitel'),
        value: curSub ? streamLabel(curSub) : (subs.length ? T('Aus') : T('Keine')),
        sub: function () {
          var list = [{ label: T('Aus'), checked: state.subIndex < 0, action: function () {
            state.subPref = 'off';
            selectSubtitle(-1);
          } }];
          for (var i = 0; i < subs.length; i++) {
            (function (st) {
              list.push({ label: streamLabel(st), checked: st.Index === state.subIndex, action: function () {
                state.subPref = st.Language || '';
                selectSubtitle(st.Index);
              } });
            }(subs[i]));
          }
          return list;
        }
      },
      {
        label: 'Audio',
        value: curAudio ? streamLabel(curAudio) : '–',
        sub: function () {
          var list = [];
          for (var i = 0; i < audios.length; i++) {
            (function (st) {
              list.push({ label: streamLabel(st), checked: st.Index === state.audioIndex, action: function () {
                selectAudio(st);
              } });
            }(audios[i]));
          }
          return list;
        }
      },
      {
        label: T('Geschwindigkeit'),
        value: state.speed + '×',
        sub: function () {
          var list = [];
          for (var i = 0; i < SPEEDS.length; i++) {
            (function (v) {
              list.push({ label: v + '×', checked: v === state.speed, action: function () { setPlaybackSpeed(v); } });
            }(SPEEDS[i]));
          }
          return list;
        }
      },
      {
        label: T('Bildformat'),
        value: T(DISPLAY_MODES[state.displayMode].label),
        sub: function () {
          var list = [];
          for (var i = 0; i < DISPLAY_MODES.length; i++) {
            (function (n) {
              list.push({ label: T(DISPLAY_MODES[n].label), checked: n === state.displayMode, action: function () {
                state.displayMode = n;
                try { localStorage.setItem('jf_display', String(n)); } catch (e) {}
                applyDisplayMode(false);
              } });
            }(i));
          }
          return list;
        }
      },
      {
        label: T('Wiedergabe'),
        value: (state.playMethod === 'Transcode' ? T('Transkodiert') : T('Direkt')) +
          (state.playerSource && state.playerSource.Container ? ' (' + state.playerSource.Container.toUpperCase() + ')' : ''),
        info: true
      }
    ];
  }

  function menuOpen() { return state.menuStack.length > 0; }

  function openMenu() {
    if (!state.prepared) return;
    state.menuStack = [{ title: T('Optionen'), items: menuMain(), focus: 0 }];
    renderMenu();
    showPlayerUi();
  }

  function closeMenu() {
    state.menuStack = [];
    playerMenu.className = 'hidden';
    playerMenu.innerHTML = '';
    if (state.view === 'player') showPlayerUi();
  }

  function renderMenu() {
    var top = state.menuStack[state.menuStack.length - 1];
    if (!top) { closeMenu(); return; }
    var html = '<div class="pmtitle">' + esc(top.title) + '</div>';
    for (var i = 0; i < top.items.length; i++) {
      var it = top.items[i];
      var cls = 'pmrow' + (i === top.focus ? ' focused' : '') + (it.info ? ' info' : '');
      html += '<div class="' + cls + '">' +
        (it.checked !== undefined ? '<span class="pmcheck">' + (it.checked ? '✓' : '') + '</span>' : '') +
        '<span class="pmlabel">' + esc(it.label) + '</span>' +
        (it.value !== undefined ? '<span class="pmvalue">' + esc(it.value) + (it.sub ? ' ›' : '') + '</span>' : '') +
        '</div>';
    }
    playerMenu.innerHTML = html;
    playerMenu.className = '';
  }

  function handleMenuKey(e, k) {
    var top = state.menuStack[state.menuStack.length - 1];
    e.preventDefault();
    showPlayerUi();
    if (k === K_UP && top.focus > 0) { top.focus--; renderMenu(); }
    else if (k === K_DOWN && top.focus < top.items.length - 1) { top.focus++; renderMenu(); }
    else if (k === K_ENTER || k === K_RIGHT) {
      var it = top.items[top.focus];
      if (it.sub) {
        var items = it.sub();
        var f = 0;
        for (var i = 0; i < items.length; i++) if (items[i].checked) f = i;
        if (!items.length) return;
        state.menuStack.push({ title: it.label, items: items, focus: f });
        renderMenu();
      } else if (it.action) {
        closeMenu();
        it.action();
      }
    } else if (k === K_BLUE) {
      closeMenu();
    } else if (k === K_LEFT || isBackKey(k) || k === K_INFO) {
      state.menuStack.pop();
      if (menuOpen()) {
        /* refresh values in the main menu after a change */
        if (state.menuStack.length === 1) state.menuStack[0].items = menuMain();
        renderMenu();
      } else {
        closeMenu();
      }
    } else if (k === K_PLAYPAUSE || k === K_PLAY || k === K_PAUSE || k === 179) {
      togglePause(k === K_PLAY ? 'play' : (k === K_PAUSE ? 'pause' : undefined));
    }
  }

  /* ---------- trickplay ---------- */

  function findTrickplay(item) {
    if (!item || !item.Trickplay) return null;
    var best = null;
    var srcId;
    var w;
    var widths;
    var t;
    var width;
    for (srcId in item.Trickplay) {
      widths = item.Trickplay[srcId];
      if (!widths) continue;
      for (w in widths) {
        t = widths[w];
        if (!t || !t.Interval) continue;
        width = parseInt(w, 10) || t.Width || 0;
        var cand = {
          id: item.Id,
          width: width,
          interval: t.Interval,
          count: t.ThumbnailCount || 0,
          tileWidth: t.TileWidth || 1,
          tileHeight: t.TileHeight || 1,
          thumbWidth: t.Width || width,
          thumbHeight: t.Height || 0
        };
        if (!best) best = cand;
        else if (width > 0) {
          if (best.width > 400) {
            if (width <= 400 || width < best.width) best = cand;
          } else if (width <= 400 && width > best.width) {
            best = cand;
          }
        }
      }
    }
    if (!best || !best.interval) return null;
    return best;
  }

  function trimTrickplayCache() {
    var keys = [];
    var k;
    for (k in state.trickplayCache) keys.push(k);
    while (keys.length > 160) {
      k = keys.shift();
      var e = state.trickplayCache[k];
      if (e) {
        try { if (e.image) e.image.src = ''; } catch (x) {}
        delete state.trickplayCache[k];
      }
    }
  }

  function ensureTrickplayTile(tileIndex) {
    var info = state.trickplay;
    if (!info) return null;
    var key = info.width + ':' + tileIndex;
    var entry = state.trickplayCache[key];
    if (entry) return entry;
    var url = API + '/Videos/' + encodeURIComponent(info.id) +
      '/Trickplay/' + info.width + '/' + tileIndex + '.jpg?ApiKey=' +
      encodeURIComponent(state.token);
    entry = { url: url, loaded: false, error: false, image: null };
    state.trickplayCache[key] = entry;
    var img = new Image();
    entry.image = img;
    img.onload = function () {
      entry.loaded = true;
      if (entry.onready) {
        var fn = entry.onready;
        entry.onready = null;
        fn();
      }
    };
    img.onerror = function () { entry.error = true; };
    img.src = url;
    trimTrickplayCache();
    return entry;
  }

  function applyTrickplayView(entry, col, row, info) {
    seekImg.style.backgroundImage = 'url("' + entry.url + '")';
    state.trickplayLastUrl = entry.url;
    seekImg.style.backgroundSize = (info.tileWidth * 348) + 'px ' + (info.tileHeight * 196) + 'px';
    seekImg.style.backgroundPosition = (-col * 348) + 'px ' + (-row * 196) + 'px';
    seekImg.style.display = '';
  }

  function preloadTrickplayAround(ms, radius) {
    var info = state.trickplay;
    if (!info || !info.interval) return;
    var center = Math.floor(ms / info.interval);
    if (center < 0) center = 0;
    var from = center - radius;
    if (from < 0) from = 0;
    var to = center + radius;
    if (info.count && to >= info.count) to = info.count - 1;
    var per = info.tileWidth * info.tileHeight;
    if (per < 1) per = 1;
    var i;
    for (i = from; i <= to; i++) ensureTrickplayTile(Math.floor(i / per));
  }

  function hideSeekPreview() {
    /* Keep the last frame and tile URL in place. Clearing the image here makes
       the preview blink and reload every time the overlay is shown again. */
    seekPreview.className = 'hidden';
  }

  function showSeekPreview(target) {
    var info = state.trickplay;
    var dur = curDuration();
    if (info && info.interval) {
      var thumbIdx = Math.floor(target / info.interval);
      if (thumbIdx < 0) thumbIdx = 0;
      if (info.count && thumbIdx >= info.count) thumbIdx = info.count - 1;
      var per = info.tileWidth * info.tileHeight;
      if (per < 1) per = 1;
      preloadTrickplayAround(target, per > 1 ? 8 : 4);
      var tileIndex = Math.floor(thumbIdx / per);
      var inTile = thumbIdx % per;
      var col = inTile % info.tileWidth;
      var row = Math.floor(inTile / info.tileWidth);
      var entry = ensureTrickplayTile(tileIndex);
      if (entry) {
        if (state.trickplayLastUrl === entry.url) {
          seekImg.style.backgroundSize = (info.tileWidth * 348) + 'px ' + (info.tileHeight * 196) + 'px';
          seekImg.style.backgroundPosition = (-col * 348) + 'px ' + (-row * 196) + 'px';
          seekImg.style.display = '';
        } else if (entry.loaded) {
          applyTrickplayView(entry, col, row, info);
        } else {
          state.trickplayPending = { entry: entry, col: col, row: row, info: info };
          entry.onready = function () {
            var pv = state.trickplayPending;
            if (pv && pv.entry === entry) {
              state.trickplayPending = null;
              applyTrickplayView(pv.entry, pv.col, pv.row, pv.info);
            }
          };
        }
      }
    } else {
      seekImg.style.backgroundImage = 'none';
      seekImg.style.display = 'none';
      state.trickplayLastUrl = '';
    }
    var vw = window.innerWidth || 1280;
    var half = 196;
    var px = dur > 0 ? (target / dur) * vw : vw / 2;
    if (px > vw - half) px = vw - half;
    if (px < half) px = half;
    seekPreview.style.left = Math.round(px) + 'px';
    seekTime.textContent = fmtTime(target);
    seekPreview.className = '';
    showPlayerUi();
  }

  /* ---------- seeking ---------- */

  function doSeek() {
    state.seekTimer = null;
    state.seekCount = 0;
    var t = state.seekTarget;
    state.seekTarget = null;
    if (t === null) return;
    state.lastGoodPos = t;
    if (state.seekPreviewTimer) clearTimeout(state.seekPreviewTimer);
    state.seekPreviewTimer = setTimeout(hideSeekPreview, 1200);
    if (state.playMethod === 'Transcode') {
      /* a progressive transcode can't seek: restart it at the new position */
      reportProgress('TimeUpdate');
      stopEncoding();
      state.startMs = t;
      startTranscode(t);
      return;
    }
    try { webapis.avplay.seekTo(t); } catch (e) {}
    updatePlayerUi();
    setTimeout(function () { reportProgress('TimeUpdate'); }, 1500);
  }

  function seekTo(target) {
    if (state.view !== 'player' || !state.prepared) return;
    var dur = curDuration();
    if (target < 0) target = 0;
    if (dur > 0 && target > dur - 1000) target = Math.max(0, dur - 1000);
    state.seekTarget = target;
    showSeekPreview(target);
    if (state.seekTimer) clearTimeout(state.seekTimer);
    state.seekTimer = setTimeout(doSeek, state.playMethod === 'Transcode' ? 900 : 450);
    updatePlayerUi();
  }

  /* repeated presses accelerate: 10s, then 30s, then 60s steps */
  function seekBy(dir, baseMs) {
    if (state.view !== 'player' || !state.prepared) return;
    state.seekCount++;
    var step = baseMs;
    if (state.seekCount > 12) step = Math.max(baseMs, 60000);
    else if (state.seekCount > 4) step = Math.max(baseMs, 30000);
    var from = state.seekTarget !== null ? state.seekTarget : curPos();
    seekTo(from + dir * step);
  }

  /* ---------- AVPlay lifecycle ---------- */

  function resetAvplay(callback) {
    var p = null;
    try { p = webapis.avplay; } catch (e) { p = null; }
    if (!p) { callback(); return; }
    var tries = 0;
    function stateName() {
      try { return p.getState(); } catch (e) { return ''; }
    }
    function settle() {
      var st = stateName();
      if (st === 'PLAYING' || st === 'PAUSED') {
        try { p.stop(); } catch (e) {}
        setTimeout(settle, 200);
        return;
      }
      if (st === 'PREPARING' && tries++ < 20) {
        setTimeout(settle, 150);
        return;
      }
      try { p.close(); } catch (e) {}
      setTimeout(function () {
        var st2 = stateName();
        if (st2 === 'IDLE' || st2 === 'NONE' || st2 === 'STOPPED' ||
            st2 === 'INITIALIZED' || st2 === '') {
          callback();
        } else if (tries++ < 25) {
          setTimeout(settle, 150);
        } else {
          callback();
        }
      }, 200);
    }
    settle();
  }

  function scheduleFallback(token) {
    if (token !== state.playToken || state.stopping || state.fallbackPending) return;
    if (state.triedFallback) {
      showToast(T('Wiedergabe fehlgeschlagen'));
      stopPlayback();
      return;
    }
    state.triedFallback = true;
    state.fallbackPending = true;
    clearPrepareTimer();
    showPlayerLoading();
    state.playToken++;
    var next = state.playToken;
    var startMs = state.prepared ? curPos() : state.startMs;
    resetAvplay(function () {
      if (state.stopping || next !== state.playToken) return;
      state.fallbackPending = false;
      state.startMs = startMs;
      startTranscode(startMs);
    });
  }

  function onPlaybackEnded(token) {
    if (token !== state.playToken || state.stopping) return;
    var item = state.playerItem;
    if (state.isLive) {
      /* a channel never ends by itself */
      if (!recoverPlayback(token)) { showToast(T('Wiedergabe unterbrochen')); stopPlayback(0); }
      return;
    }
    var dur = curDuration();
    var reached = Math.max(curPos(), state.lastGoodPos);
    if (dur > 0 && reached < dur - 90000 && reached < dur * 0.92) {
      /* the stream broke off early (server closed it, network): not the end of the episode */
      if (!recoverPlayback(token)) {
        showToast(T('Wiedergabe unterbrochen'));
        stopPlayback(reached);
      }
      return;
    }
    var endPos = dur || curPos();
    var u = state.upNext;
    if (!state.autoNext || !item || item.Type !== 'Episode' || !item.SeriesId || (u && u.cancelled)) {
      stopPlayback(endPos);
      return;
    }
    stopUiTimer();
    showPlayerLoading();
    reportStopped(endPos);
    stopEncoding();
    state.homeDirty = true;
    hideUpNext();
    findNextEpisode(item, function (next) {
      if (token !== state.playToken || state.stopping) return;
      if (!next) { stopPlayback(); return; }
      showToast(T('Nächste Folge: {0}', (episodeCode(next) ? episodeCode(next) + ' ' : '') + (next.Name || '')));
      playItem(next, { startMs: 0, chain: true });
    });
  }

  /* ---------- broken streams ---------- */

  var LONG_PAUSE = 60000;  /* after this, resuming reopens the stream */

  /* open the stream again at pos (same play method) */
  function reloadAt(pos) {
    if (state.isLive) { restartLive(state.playMethod === 'Transcode', true); return; }
    state.playToken++;
    clearPrepareTimer();
    stopUiTimer();
    state.prepared = false;
    state.startMs = pos;
    state.lastGoodPos = pos;
    showPlayerLoading();
    if (state.playMethod === 'Transcode') {
      stopEncoding();
      startTranscode(pos);
    } else {
      startAvplay(state.playUrl);
    }
  }

  /* the stream broke off while playing (server closed it, network): continue
     where it stopped instead of giving up or jumping to the next episode */
  function recoverPlayback(token) {
    if (token !== state.playToken || state.stopping || state.fallbackPending) return false;
    if (!state.prepared || (state.lastGoodPos <= 0 && !state.isLive) || state.recoverTries >= 3) return false;
    state.recoverTries++;
    state.recoverAt = state.lastGoodPos;
    showToast(T('Verbindung unterbrochen, setze fort ...'));
    reloadAt(state.lastGoodPos);
    return true;
  }

  /* ---------- media segments: skip intro, next episode ---------- */

  function skipLabel(type) {
    if (type === 'Intro') return T('Intro überspringen');
    if (type === 'Recap') return T('Rückblick überspringen');
    if (type === 'Preview') return T('Vorschau überspringen');
    if (type === 'Commercial') return T('Werbung überspringen');
    return '';
  }

  /* Jellyfin 10.10+: /MediaSegments (filled by e.g. the Intro Skipper plugin
     or chapter names); older servers with Intro Skipper: its own endpoint */
  function loadSegments(item) {
    state.segments = [];
    var req = state.playReq;
    if (!item || (item.Type !== 'Episode' && item.Type !== 'Movie')) return;
    getJson('/MediaSegments/' + encodeURIComponent(item.Id), function (err, data) {
      if (req !== state.playReq) return;
      if (!err && data && data.Items) {
        var list = [];
        for (var i = 0; i < data.Items.length; i++) {
          var sg = data.Items[i];
          var a = Math.round((sg.StartTicks || 0) / TICKS);
          var b = Math.round((sg.EndTicks || 0) / TICKS);
          if (b > a) list.push({ type: String(sg.Type), start: a, end: b });
        }
        state.segments = list;
        return;
      }
      if (err !== 404 || item.Type !== 'Episode') return;
      getJson('/Episode/' + encodeURIComponent(item.Id) + '/IntroSkipperSegments', function (err2, d) {
        if (req !== state.playReq || err2 || !d) return;
        var old = [];
        if (d.Introduction && d.Introduction.Valid) {
          old.push({ type: 'Intro', start: d.Introduction.IntroStart * 1000, end: d.Introduction.IntroEnd * 1000 });
        }
        if (d.Credits && d.Credits.Valid) {
          old.push({ type: 'Outro', start: d.Credits.IntroStart * 1000, end: d.Credits.IntroEnd * 1000 });
        }
        state.segments = old;
      });
    });
  }

  function hideSkip() {
    state.skipSeg = null;
    skipBtn.className = 'hidden';
  }

  function updateSkip(cur) {
    var seg = null;
    if (state.prepared && state.seekTarget === null && !(state.upNext && state.upNext.shown) && !menuOpen()) {
      for (var i = 0; i < state.segments.length; i++) {
        var sg = state.segments[i];
        if (skipLabel(sg.type) && cur >= sg.start && cur < sg.end - 2000) { seg = sg; break; }
      }
    }
    if (!seg) { if (state.skipSeg) hideSkip(); return; }
    if (seg !== state.skipSeg) skipBtn.textContent = skipLabel(seg.type);
    state.skipSeg = seg;
    skipBtn.className = '';
  }

  function skipSegment() {
    var seg = state.skipSeg;
    if (!seg) return;
    hideSkip();
    var dur = curDuration();
    if (dur > 0 && seg.end >= dur - 1500) { onPlaybackEnded(state.playToken); return; }
    seekTo(seg.end);
  }

  /* when the overlay appears: at the credits (outro segment), else 25 s before the end */
  function upNextAt(dur) {
    for (var i = 0; i < state.segments.length; i++) {
      var sg = state.segments[i];
      if (sg.type === 'Outro' && sg.start > dur * 0.5 && sg.start < dur - 5000) return sg.start;
    }
    return dur - 25000;
  }

  function updateUpNext(cur, st) {
    var u = state.upNext;
    var item = state.playerItem;
    if (!u || !item || u.itemId !== item.Id || u.cancelled || state.seekTarget !== null || !state.prepared) return;
    var dur = curDuration();
    if (!(dur > 60000)) return;
    var at = upNextAt(dur);
    if (cur < at - 30000) { if (u.shown) hideUpNext(); return; }
    if (u.next === undefined) {
      /* look it up a little early so the picture is there in time */
      if (!u.loading) {
        u.loading = true;
        findNextEpisode(item, function (next) {
          u.loading = false;
          u.next = next || null;
        });
      }
      return;
    }
    if (!u.next) return;
    if (cur < at - 1000) { if (u.shown) hideUpNext(); return; }
    if (!u.shown) {
      u.shown = true;
      u.focus = 0;
      u.deadline = Math.min(dur, Math.max(cur, at) + 15000);
      renderUpNext();
      hideSkip();
    }
    var left = Math.max(0, Math.ceil((u.deadline - cur) / 1000));
    var cnt = $('uncount');
    if (cnt) cnt.textContent = T('Startet in {0} s', left);
    /* credits: start the next episode after the countdown; otherwise the end of the stream does it */
    if (st === 'PLAYING' && cur >= u.deadline && u.deadline < dur - 1000) playUpNext();
  }

  function renderUpNext() {
    var u = state.upNext;
    var n = u.next;
    var se = episodeCode(n);
    var img = n.ImageTags && n.ImageTags.Primary ? imageUrl(n.Id, 'Primary', n.ImageTags.Primary, 180) : '';
    upNextEl.innerHTML =
      '<div id="unimg">' + (img ? '<img src="' + esc(img) + '" onerror="this.style.display=\'none\'">' : '') + '</div>' +
      '<div id="uninfo"><div id="unlabel">' + esc(T('Nächste Folge')) + '</div>' +
      '<div id="untitle">' + esc((se ? se + '  ·  ' : '') + (n.Name || '')) + '</div>' +
      '<div id="uncount"></div>' +
      '<div id="unbtns"><span class="btn primary">' + esc(T('Jetzt abspielen')) + '</span>' +
      '<span class="btn">' + esc(T('Abbrechen')) + '</span></div></div>';
    upNextEl.className = '';
    upNextFocus();
  }

  function upNextFocus() {
    var b = upNextEl.querySelectorAll('.btn');
    for (var i = 0; i < b.length; i++) b[i].className = 'btn' + (i === 0 ? ' primary' : '') + (i === state.upNext.focus ? ' focused' : '');
  }

  function hideUpNext() {
    if (state.upNext) state.upNext.shown = false;
    upNextEl.className = 'hidden';
    upNextEl.innerHTML = '';
  }

  /* the episode counts as watched: report it at its end */
  function playUpNext() {
    var u = state.upNext;
    if (!u || !u.next) return;
    var next = u.next;
    var endPos = curDuration() || curPos();
    hideUpNext();
    state.upNext = null;
    state.playToken++;
    try { webapis.avplay.pause(); } catch (e) {}
    stopUiTimer();
    showPlayerLoading();
    reportStopped(endPos);
    stopEncoding();
    state.homeDirty = true;
    playItem(next, { startMs: 0, chain: true });
  }

  /* returns true when the key was used by the overlay */
  function handleUpNextKey(e, k) {
    var u = state.upNext;
    if (k === K_LEFT || k === K_RIGHT) {
      e.preventDefault();
      u.focus = k === K_LEFT ? 0 : 1;
      upNextFocus();
      return true;
    }
    if (k === K_ENTER) {
      e.preventDefault();
      if (u.focus === 0) playUpNext();
      else { u.cancelled = true; hideUpNext(); }
      return true;
    }
    if (isBackKey(k)) {
      e.preventDefault();
      u.cancelled = true;
      hideUpNext();
      return true;
    }
    return false;
  }

  /* CH ▲ / CH ▼ in the player: next (dir 1) or previous (dir -1) episode */
  function switchEpisode(dir) {
    var item = state.playerItem;
    if (!item || item.Type !== 'Episode' || !item.SeriesId || state.episodeSwitch) return;
    var token = state.playToken;
    state.episodeSwitch = true;
    getJson('/Shows/' + encodeURIComponent(item.SeriesId) + '/Episodes?' + uidParam() +
      '&adjacentTo=' + encodeURIComponent(item.Id) + FIELDS,
      function (err, data) {
        state.episodeSwitch = false;
        if (token !== state.playToken || state.stopping || state.view !== 'player') return;
        var list = (!err && data && data.Items) || [];
        var target = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i].Id === item.Id) { target = list[i + dir] || null; break; }
        }
        if (!target) {
          showToast(err ? T('Folge konnte nicht geladen werden') : (dir > 0 ? T('Keine nächste Folge') : T('Keine vorherige Folge')));
          return;
        }
        var pos = curPos();
        try { webapis.avplay.pause(); } catch (e) {}
        stopUiTimer();
        showPlayerLoading();
        reportStopped(pos);
        stopEncoding();
        state.homeDirty = true;
        showToast((episodeCode(target) ? episodeCode(target) + ' ' : '') + (target.Name || ''));
        playItem(target, { chain: true });
      });
  }

  function findNextEpisode(item, cb) {
    getJson('/Shows/' + encodeURIComponent(item.SeriesId) + '/Episodes?' + uidParam() +
      '&startItemId=' + encodeURIComponent(item.Id) + '&limit=2' + FIELDS,
      function (err, data) {
        var list = (!err && data && data.Items) || [];
        var i;
        for (i = 0; i < list.length - 1; i++) {
          if (list[i].Id === item.Id) { cb(list[i + 1]); return; }
        }
        cb(null);
      });
  }

  function startAvplay(url) {
    var p = null;
    try { p = webapis.avplay; } catch (e) { p = null; }
    if (!p) {
      showToast(T('AVPlay nicht verfügbar'));
      stopPlayback();
      return;
    }
    var token = ++state.playToken;
    state.playUrl = url;
    state.bufferingSince = 0;
    clearPrepareTimer();
    stopUiTimer();
    if (state.playerUiHideTimer) { clearTimeout(state.playerUiHideTimer); state.playerUiHideTimer = null; }
    if (state.seekTimer) { clearTimeout(state.seekTimer); state.seekTimer = null; }
    state.seekTarget = null;
    state.seekCount = 0;
    showPlayerLoading();
    playerUi.className = '';
    pauseIcon.className = 'hidden';
    var titles = playerTitles(state.playerItem);
    ptitle.textContent = titles[0];
    psub.textContent = titles[1];
    ptime.textContent = fmtTime(state.playerOffset) + ' / ' + fmtTime(state.playerDuration);
    pend.textContent = '';
    progressFill.style.width = (state.playerDuration ? Math.min(100, state.playerOffset / state.playerDuration * 100) : 0) + '%';
    phint.textContent = T('Wird geladen ...  ·  Zurück: Abbrechen');
    state.playerPaused = false;
    state.prepared = false;
    state.fallbackPending = false;
    state.speed = 1;
    state.view = 'player';
    setChrome(false);
    showPlayerUi();

    resetAvplay(function () {
      if (token !== state.playToken || state.stopping) return;
      try {
        p.open(url);
        p.setDisplayRect(0, 0, 1920, 1080);
        if (state.displayMode) applyDisplayMode(true);
        p.setListener({
          onstreamcompleted: function () {
            onPlaybackEnded(token);
          },
          onbufferingstart: function () {
            if (token !== state.playToken || state.stopping) return;
            state.bufferingSince = now();
            showPlayerLoading();
          },
          onbufferingcomplete: function () {
            if (token !== state.playToken || state.stopping) return;
            state.bufferingSince = 0;
            hidePlayerLoading();
          },
          onerror: function (e) {
            if (token !== state.playToken || state.stopping) return;
            if (recoverPlayback(token)) return;
            if (!state.triedFallback) {
              showToast(T('Direkte Wiedergabe fehlgeschlagen, versuche Transcoding ...'));
              scheduleFallback(token);
            } else {
              showToast(T('AVPlay-Fehler: {0}', e));
              stopPlayback();
            }
          }
        });
        p.prepareAsync(function () {
          if (token !== state.playToken || state.stopping) return;
          state.prepared = true;
          state.offsetCheckUntil = now() + 10000;
          clearPrepareTimer();
          try {
            selectPreferredAudio(token);
            p.play();
            if (state.playMethod !== 'Transcode' && state.startMs > 0) {
              try { p.seekTo(state.startMs); } catch (se) {}
            }
            if (state.aacAudioTrack >= 0) {
              selectPreferredAudio(token);
              setTimeout(function () { selectPreferredAudio(token); }, 250);
              setTimeout(function () { selectPreferredAudio(token); }, 900);
            }
            hidePlayerLoading();
            if (!state.reported) reportStart();
            startUiTimer();
          } catch (e) {
            showToast('play: ' + e);
            if (!state.triedFallback) scheduleFallback(token);
            else stopPlayback();
          }
        }, function (e) {
          if (token !== state.playToken || state.stopping) return;
          clearPrepareTimer();
          if (!state.triedFallback) {
            showToast(T('Direkte Wiedergabe fehlgeschlagen, versuche Transcoding ...'));
            scheduleFallback(token);
          } else {
            showToast('prepare: ' + e);
            stopPlayback();
          }
        });
        if (token === state.playToken && !state.prepared && !state.stopping) {
          state.prepareTimer = setTimeout(function () {
            if (token !== state.playToken || state.stopping || state.prepared) return;
            if (!state.triedFallback) {
              showToast(T('Wiedergabe antwortet nicht, versuche Transcoding ...'));
              scheduleFallback(token);
            } else {
              showToast(T('Wiedergabe-Timeout'));
              stopPlayback();
            }
          }, state.triedFallback ? 40000 : 12000);
        }
      } catch (e) {
        if (token !== state.playToken || state.stopping) return;
        showToast('AVPlay: ' + e);
        stopPlayback();
      }
    });
  }

  /* endPos: position to report (defaults to the current one) */
  function stopPlayback(endPos) {
    if (state.stopping) return;
    state.stopping = true;
    var pos = typeof endPos === 'number' ? endPos : (state.prepared ? curPos() : state.startMs);
    var itemId = state.playerItem ? state.playerItem.Id : null;
    reportStopped(pos, function () {
      /* refresh the resume button once the server has stored the position */
      if (state.view === 'details' && state.current && state.current.Id === itemId) {
        refreshDetails(state.navSeq);
      }
    });
    stopEncoding();
    closeLiveStream();
    state.isLive = false;
    state.playToken++;
    state.playReq++;
    state.playLoading = false;
    clearPrepareTimer();
    state.prepared = false;
    state.fallbackPending = false;
    state.aacAudioTrack = -1;
    stopUiTimer();
    if (state.playerUiHideTimer) { clearTimeout(state.playerUiHideTimer); state.playerUiHideTimer = null; }
    if (state.seekTimer) { clearTimeout(state.seekTimer); state.seekTimer = null; }
    if (state.seekPreviewTimer) { clearTimeout(state.seekPreviewTimer); state.seekPreviewTimer = null; }
    state.seekTarget = null;
    state.seekCount = 0;
    hideSeekPreview();
    hidePlayerLoading();
    hideSkip();
    hideUpNext();
    state.upNext = null;
    state.segments = [];
    closeMenu();
    stopSubtitles();
    subtitleEl.className = '';
    playerUi.className = 'hidden';
    pauseIcon.className = 'hidden';
    state.trickplay = null;
    state.trickplayCache = {};
    state.trickplayLastUrl = '';
    state.trickplayPending = null;
    try { seekImg.style.backgroundImage = 'none'; } catch (e2) {}
    try { webapis.avplay.stop(); } catch (e) {}
    try { webapis.avplay.close(); } catch (e) {}
    state.homeDirty = true;
    state.playerPaused = false;
    state.playerOffset = 0;
    var s = state.playerReturn;
    state.playerReturn = null;
    state.view = 'details';
    state.stopping = false;
    if (s) restoreState(s);
    else goHome();
  }

  /* ---------- keys ---------- */

  function isEditingText() {
    var a = document.activeElement;
    if (!a || !a.tagName) return false;
    var tag = a.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  function isBackKey(k) { return k === 8 || k === 27 || k === 461 || k === 10009; }
  function isPlayKey(k) { return k === K_PLAY || k === K_PLAYPAUSE || k === 179; }

  function handleLoginKey(e, k) {
    var cur = loginEl();
    var input = cur && cur.tagName && cur.tagName.toUpperCase() === 'INPUT' ? cur : null;
    if (state.loginIme && isEditingText()) {
      /* keyboard open: only keys that leave the field, the rest goes to the IME */
      if (k === K_IME_DONE || k === K_ENTER) {
        e.preventDefault();
        closeLoginKeyboard();
        if (input && input.jfDone) input.jfDone();
        else moveLoginRow(1);
      } else if (k === K_DOWN) {
        e.preventDefault();
        closeLoginKeyboard();
        moveLoginRow(1);
      } else if (k === K_IME_CANCEL || isBackKey(k)) {
        e.preventDefault();
        closeLoginKeyboard();
      }
      return;
    }
    if (state.loginIme || isEditingText()) closeLoginKeyboard();  /* keyboard closed behind our back */
    if (k === K_IME_DONE || k === K_IME_CANCEL) { e.preventDefault(); return; }
    if (isBackKey(k)) {
      e.preventDefault();
      if (state.loginBack) state.loginBack();
      else confirmExit();
    } else if (k === K_UP || k === K_DOWN) {
      e.preventDefault();
      moveLoginRow(k === K_UP ? -1 : 1);
    } else if (k === K_LEFT || k === K_RIGHT) {
      e.preventDefault();
      focusLoginAt(state.loginPos.r, state.loginPos.c + (k === K_LEFT ? -1 : 1));
    } else if (k === K_ENTER && cur) {
      e.preventDefault();
      if (input) { openLoginKeyboard(input); return; }
      /* ignore key repeat so buttons don't fire twice */
      if (now() - state.lastActivate < 350) return;
      state.lastActivate = now();
      if (cur.onclick) cur.onclick();
    }
  }

  function handlePlayerKey(e, k) {
    if (menuOpen()) { handleMenuKey(e, k); return; }
    if (state.upNext && state.upNext.shown && handleUpNextKey(e, k)) return;
    if (isBackKey(k) || k === K_STOP || k === 178) {
      e.preventDefault();
      stopPlayback();
      return;
    }
    showPlayerUi();
    if (state.isLive && (k === K_LEFT || k === K_RIGHT || k === K_RW || k === K_FF)) {
      e.preventDefault();
      updatePlayerUi();
      return;
    }
    if (state.isLive && k >= 48 && k <= 57) { e.preventDefault(); channelDigit(k - 48); return; }
    if (state.isLive && k === K_ENTER && channelDigitsPending()) { e.preventDefault(); commitChannelDigits(false); return; }
    if (state.isLive && (k === K_CH_UP || k === K_CH_DOWN)) { e.preventDefault(); switchChannel(k === K_CH_UP ? 1 : -1); return; }
    if (k === K_ENTER && state.skipSeg) {
      e.preventDefault();
      skipSegment();
    } else if (k === K_ENTER || k === K_PLAYPAUSE || k === 179) {
      e.preventDefault();
      togglePause();
    } else if (k === K_PLAY) {
      e.preventDefault();
      togglePause('play');
    } else if (k === K_PAUSE) {
      e.preventDefault();
      togglePause('pause');
    } else if (k === K_LEFT) {
      e.preventDefault();
      seekBy(-1, 10000);
    } else if (k === K_RIGHT) {
      e.preventDefault();
      seekBy(1, 10000);
    } else if (k === K_RW) {
      e.preventDefault();
      seekBy(-1, 30000);
    } else if (k === K_FF) {
      e.preventDefault();
      seekBy(1, 30000);
    } else if (k >= 48 && k <= 57) {
      e.preventDefault();
      var dur = curDuration();
      if (dur > 0) seekTo(dur * (k - 48) / 10);
    } else if (k === K_BLUE || k === K_INFO) {
      e.preventDefault();
      openMenu();
    } else if (k === K_UP || k === K_DOWN) {
      /* only shows the progress bar (showPlayerUi above) */
      e.preventDefault();
      updatePlayerUi();
    } else if (k === K_CH_UP || k === K_CH_DOWN) {
      e.preventDefault();
      switchEpisode(k === K_CH_UP ? 1 : -1);
    }
  }

  function handleKeyDown(e) {
    var k = e.keyCode;
    if (state.overlay === 'menu') { handleMenuOverlayKey(e, k); return; }
    if (state.overlay === 'choice') { handleChoiceKey(e, k); return; }
    if (state.overlay === 'search') { handleSearchBarKey(e, k); return; }
    if (state.view === 'login') { handleLoginKey(e, k); return; }
    if (state.view === 'player') { handlePlayerKey(e, k); return; }
    if (state.view === 'reader') { handleReaderKey(e, k); return; }
    if (state.view === 'music') { handleMusicKey(e, k); return; }
    if (state.playLoading) {
      /* PlaybackInfo is still loading: only allow cancelling */
      e.preventDefault();
      if (isBackKey(k) || k === K_STOP) cancelPlayLoading();
      return;
    }
    if (state.topFocus >= 0) { handleTopKey(e, k); return; }

    if (k === K_BLUE) { e.preventDefault(); openSettingsMenu(); return; }
    if (k === K_RED) { e.preventDefault(); openSearchBar(); return; }

    if (state.view === 'message') {
      e.preventDefault();
      if (k === K_ENTER && state.retryFn) state.retryFn();
      else if (k === K_UP) enterTop();
      else if (isBackKey(k)) {
        if (state.stack.length) goBack();
        else confirmExit();
      }
      return;
    }

    if (state.view === 'album') { handleAlbumKey(e, k); return; }

    if (state.view === 'details' && state.cast && state.detailFocusKey === 'cast') {
      if (k === K_LEFT || k === K_RIGHT) { e.preventDefault(); castMove(k === K_LEFT ? -1 : 1); }
      else if (k === K_UP) { e.preventDefault(); focusDetailButtons(); content.scrollTop = 0; }
      else if (k === K_DOWN) { e.preventDefault(); content.scrollTop += 160; }
      else if (k === K_ENTER) { e.preventDefault(); openPerson(state.cast.items[state.castCol]); }
      else if (isBackKey(k)) { e.preventDefault(); goBack(); }
      return;
    }

    if (state.view === 'details' || state.view === 'seerr') {
      if (k === K_LEFT || k === K_RIGHT) { e.preventDefault(); detailMove(k === K_LEFT ? -1 : 1); }
      else if (k === K_UP) {
        e.preventDefault();
        if (content.scrollTop <= 0) enterTop();
        else content.scrollTop = Math.max(0, content.scrollTop - 160);
      }
      else if (k === K_DOWN && state.view === 'details' && state.cast) {
        e.preventDefault();
        /* scroll through a long overview first, then go into the cast row */
        if (offsetTopIn(state.cast.el, content) + 80 > content.scrollTop + content.clientHeight) {
          content.scrollTop += 160;
        } else {
          state.detailFocusKey = 'cast';
          updateDetailFocus();
        }
      }
      else if (k === K_DOWN) { e.preventDefault(); content.scrollTop += 160; }
      else if (k === K_ENTER) {
        e.preventDefault();
        var b = state.detailButtons[state.detailFocus];
        if (b && b.onclick) b.onclick();
      } else if (isPlayKey(k)) {
        e.preventDefault();
        if (state.view === 'details' && state.detailButtons[0] &&
            (isPlayable(state.current) || (state.current && state.current.Type === 'Book'))) state.detailButtons[0].onclick();
      } else if (isBackKey(k)) { e.preventDefault(); goBack(); }
      return;
    }

    if (state.view === 'home') {
      if (k === K_LEFT) { e.preventDefault(); homeMove(-1, 0); }
      else if (k === K_RIGHT) { e.preventDefault(); homeMove(1, 0); }
      else if (k === K_UP || k === K_CH_UP) { e.preventDefault(); homeMove(0, -1); }
      else if (k === K_DOWN || k === K_CH_DOWN) { e.preventDefault(); homeMove(0, 1); }
      else if (k === K_ENTER) { e.preventDefault(); openItem(homeItem()); }
      else if (isPlayKey(k)) { e.preventDefault(); playOrOpen(homeItem()); }
      else if (isBackKey(k)) { e.preventDefault(); goBack(); }
      return;
    }

    /* grid views: library, series, season, search */
    if (k === K_LEFT) { e.preventDefault(); gridMove(-1, 0); }
    else if (k === K_RIGHT) { e.preventDefault(); gridMove(1, 0); }
    else if (k === K_UP) { e.preventDefault(); gridMove(0, -1); }
    else if (k === K_DOWN) { e.preventDefault(); gridMove(0, 1); }
    else if (k === K_CH_UP) { e.preventDefault(); gridMove(0, -3); }
    else if (k === K_CH_DOWN) { e.preventDefault(); gridMove(0, 3); }
    else if (k === K_ENTER && channelDigitsPending() && state.view === 'library' && isLiveLib(state.lib)) {
      e.preventDefault();
      commitChannelDigits(true);
    }
    else if (k === K_ENTER) {
      e.preventDefault();
      openItem(currentGridItem());
    } else if (isPlayKey(k)) {
      e.preventDefault();
      playOrOpen(currentGridItem());
    } else if (k >= 48 && k <= 57 && state.view === 'library' && isLiveLib(state.lib)) {
      e.preventDefault();
      channelDigit(k - 48);
    } else if (k >= 48 && k <= 57 && canJumpLetters()) {
      e.preventDefault();
      letterKey(k - 48);
    } else if (k === K_YELLOW && state.view === 'library' && !isLiveLib(state.lib)) {
      e.preventDefault();
      state.libSort = (state.libSort + 1) % SORTS.length;
      reloadLibrary();
    } else if (k === K_GREEN && state.view === 'library') {
      e.preventDefault();
      if (isMusicLib(state.lib)) state.libArtists = !state.libArtists;
      else state.libUnplayed = !state.libUnplayed;
      reloadLibrary();
    } else if (isBackKey(k)) {
      e.preventDefault();
      goBack();
    }
  }

  /* ---------- live TV ---------- */

  function isLiveLib(v) { return !!v && v.CollectionType === 'livetv'; }

  var LIVE_FIELDS = '&enableImages=true&addCurrentProgram=true&enableUserData=true&fields=PrimaryImageAspectRatio';

  function channelLabel(ch) {
    return (ch.ChannelNumber || ch.Number ? (ch.ChannelNumber || ch.Number) + '  ' : '') + (ch.Name || '');
  }

  function parseDate(s) {
    var t = s ? Date.parse(s) : NaN;
    return isNaN(t) ? 0 : t;
  }

  /* "20:15 – 21:45  Tatort" */
  function programLine(p) {
    if (!p) return '';
    var a = parseDate(p.StartDate);
    var b = parseDate(p.EndDate);
    return (a ? fmtClock(new Date(a)) + (b ? ' – ' + fmtClock(new Date(b)) : '') + '  ' : '') + (p.Name || '');
  }

  function programPct(p) {
    var a = p ? parseDate(p.StartDate) : 0;
    var b = p ? parseDate(p.EndDate) : 0;
    if (!a || !b || b <= a) return -1;
    return Math.max(0, Math.min(100, (now() - a) / (b - a) * 100));
  }

  /* channel logos come in every shape: show them whole on a 16:9 tile */
  function makeChannelCard(item, opts) {
    var card = el('div', 'card wide channel');
    var poster = el('div', 'poster wide channel');
    var img = document.createElement('img');
    img.onerror = function () { this.style.display = 'none'; };
    var tag = (item.ImageTags && item.ImageTags.Primary) || '';
    if (tag && opts.lazy) img.setAttribute('data-src', imageUrl(item.Id, 'Primary', tag, 160));
    else if (tag) img.src = imageUrl(item.Id, 'Primary', tag, 160);
    else img.style.display = 'none';
    poster.appendChild(img);
    if (!tag) poster.appendChild(el('div', 'channelname', item.Name || ''));
    var pct = programPct(item.CurrentProgram);
    if (pct >= 0) {
      var bar = el('div', 'cardprogress');
      var fill = el('div', 'cardprogressfill');
      fill.style.width = Math.max(3, Math.round(pct)) + '%';
      bar.appendChild(fill);
      poster.appendChild(bar);
    }
    if (item.UserData && item.UserData.IsFavorite) poster.appendChild(el('div', 'badge fav', '★'));
    card.appendChild(poster);
    card.appendChild(el('div', 'cardtitle', channelLabel(item)));
    card.appendChild(el('div', 'cardsub', item.CurrentProgram ? programLine(item.CurrentProgram) : ''));
    card.onclick = function () { playItem(item); };
    return card;
  }

  var LIVE_DIRECT = [{ Container: 'ts,mpegts', Type: 'Video', VideoCodec: 'h264,mpeg2video,hevc', AudioCodec: 'aac,mp3,mp2,ac3' }];

  /* opens the tuner on the server; transcode: H.264/AAC instead of the original stream */
  function liveRequest(item, transcode, cb) {
    var body = {
      UserId: state.userId,
      AutoOpenLiveStream: true,
      IsPlayback: true,
      EnableDirectPlay: false,
      EnableDirectStream: !transcode,
      EnableTranscoding: true,
      AllowVideoStreamCopy: !transcode,
      AllowAudioStreamCopy: !transcode,
      DeviceProfile: {
        MaxStreamingBitrate: transcode ? 8000000 : 60000000,
        DirectPlayProfiles: transcode ? [] : LIVE_DIRECT,
        TranscodingProfiles: [{
          Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac',
          Protocol: 'http', Context: 'Streaming', MaxAudioChannels: '2'
        }],
        CodecProfiles: []
      }
    };
    api('POST', '/Items/' + encodeURIComponent(item.Id) + '/PlaybackInfo?' + uidParam() +
      '&AutoOpenLiveStream=true&IsPlayback=true', body, function (err, txt) {
      if (err) { cb(err); return; }
      var data = null;
      try { data = JSON.parse(txt); } catch (e) { cb('json'); return; }
      if (!data || !data.MediaSources || !data.MediaSources.length) { cb(data && data.ErrorCode ? data.ErrorCode : 'leer'); return; }
      cb(null, data);
    });
  }

  function closeLiveStream() {
    if (!state.liveStreamId) return;
    api('POST', '/LiveTv/LiveStreams/Close?liveStreamId=' + encodeURIComponent(state.liveStreamId), null, null);
    state.liveStreamId = '';
  }

  /* opts.chain: in the running player (channel switch); opts.transcode: no direct stream */
  function playLive(item, opts) {
    opts = opts || {};
    var req = ++state.playReq;
    state.playLoading = true;
    showPlayerLoading();
    if (!opts.chain) showToast(T('Lade {0} ...', item.Name || ''));
    if (!opts.chain && state.view !== 'player') {
      /* the channel list to zap through (CH ▲ ▼, numbers) */
      state.liveChannels = state.view === 'library' && isLiveLib(state.lib) ? state.items : null;
    }
    liveRequest(item, !!opts.transcode, function (err, data) {
      if (req !== state.playReq) return;
      state.playLoading = false;
      if (err) {
        hidePlayerLoading();
        showToast(T('Sender konnte nicht geöffnet werden ({0}).', errText(err)));
        if (opts.chain) stopPlayback();
        return;
      }
      var src = data.MediaSources[0];
      if (!opts.chain) state.playerReturn = snapshot();
      state.isLive = true;
      state.playerItem = item;
      state.playerSource = src;
      state.liveStreamId = src.LiveStreamId || '';
      state.playSessionId = data.PlaySessionId || '';
      state.mediaSourceId = src.Id || item.Id;
      state.startMs = 0;
      state.playerOffset = 0;
      state.playerDuration = 0;
      state.lastGoodPos = 0;
      if (!opts.recover) { state.recoverTries = 0; state.recoverAt = 0; }
      state.pausedAt = 0;
      state.reported = false;
      state.prepared = false;
      state.fallbackPending = false;
      state.triedFallback = !!opts.transcode || !!src.TranscodingUrl;
      state.playMethod = src.TranscodingUrl ? 'Transcode' : 'DirectStream';
      state.trickplay = null;
      state.segments = [];
      state.upNext = null;
      hideSkip();
      hideUpNext();
      initTracks(audioChoice(src));
      state.aacAudioTrack = -1;
      state.liveProgram = item.CurrentProgram || null;
      state.liveNext = null;
      loadLivePrograms(item);
      var url = src.TranscodingUrl ||
        '/Videos/' + encodeURIComponent(item.Id) + '/stream.ts?static=true' +
        '&MediaSourceId=' + encodeURIComponent(state.mediaSourceId) +
        (state.liveStreamId ? '&LiveStreamId=' + encodeURIComponent(state.liveStreamId) : '') +
        '&PlaySessionId=' + encodeURIComponent(state.playSessionId) +
        '&DeviceId=' + encodeURIComponent(DEVICEID);
      startAvplay(absUrl(url));
    });
  }

  /* what runs now and next on the playing channel */
  function loadLivePrograms(item) {
    var req = state.playReq;
    state.liveProgramsAt = now();
    getJson('/LiveTv/Programs?' + uidParam() + '&channelIds=' + encodeURIComponent(item.Id) +
      '&minEndDate=' + encodeURIComponent(new Date().toISOString()) + '&sortBy=StartDate&limit=2&enableImages=false',
      function (err, data) {
        if (req !== state.playReq || err || !data || !data.Items) return;
        state.liveProgram = data.Items[0] || null;
        state.liveNext = data.Items[1] || null;
        updatePlayerUi();
      });
  }

  /* reopen the channel (stream broke off, long pause, direct stream failed) */
  function restartLive(transcode, recover) {
    var item = state.playerItem;
    if (!item) return;
    state.playToken++;
    clearPrepareTimer();
    stopUiTimer();
    state.prepared = false;
    showPlayerLoading();
    try { webapis.avplay.stop(); } catch (e) {}
    reportStopped(0);
    stopEncoding();
    closeLiveStream();
    playLive(item, { chain: true, transcode: transcode, recover: recover });
  }

  function liveChannelList(cb) {
    if (state.liveChannels && state.liveChannels.length) { cb(state.liveChannels); return; }
    getJson('/LiveTv/Channels?' + uidParam() + LIVE_FIELDS, function (err, data) {
      state.liveChannels = (!err && data && data.Items) || [];
      cb(state.liveChannels);
    });
  }

  function tuneChannel(ch) {
    if (!ch || state.stopping) return;
    try { webapis.avplay.pause(); } catch (e) {}
    state.playToken++;
    stopUiTimer();
    showPlayerLoading();
    reportStopped(0);
    stopEncoding();
    closeLiveStream();
    showToast(channelLabel(ch));
    playLive(ch, { chain: true });
  }

  /* CH ▲ / CH ▼ */
  function switchChannel(dir) {
    var cur = state.playerItem;
    liveChannelList(function (list) {
      if (state.view !== 'player' || !state.isLive || state.playerItem !== cur) return;
      for (var i = 0; i < list.length; i++) {
        if (list[i].Id === cur.Id) {
          tuneChannel(list[(i + dir + list.length) % list.length]);
          return;
        }
      }
      if (list.length) tuneChannel(list[0]);
    });
  }

  function channelNumber(ch) {
    return String(ch.ChannelNumber || ch.Number || '').replace(/^\s+|\s+$/g, '');
  }

  /* "7" finds "7", "007" and "7.0"; else the first number starting with the
     digits ("7" -> "7.1"); channels without numbers: the position in the list */
  function findChannelByNumber(list, num) {
    var want = parseFloat(num);
    var numbered = false;
    var i;
    for (i = 0; i < list.length; i++) {
      var n = channelNumber(list[i]);
      if (n) numbered = true;
      if (n === num || (n && /^[\d.]+$/.test(n) && parseFloat(n) === want)) return i;
    }
    for (i = 0; i < list.length; i++) {
      if (channelNumber(list[i]).replace(/^0+(?=\d)/, '').indexOf(String(want)) === 0) return i;
    }
    if (!numbered && want >= 1 && want <= list.length) return want - 1;
    return -1;
  }

  /* number keys: collect digits, tune (player) or focus (channel list) after a moment */
  function channelDigit(d) {
    var cd = state.channelDigits || (state.channelDigits = { text: '', timer: null });
    if (cd.text.length >= 4) cd.text = '';
    cd.text += String(d);
    showToast(T('Sender {0}', cd.text + '_'));
    if (cd.timer) clearTimeout(cd.timer);
    cd.timer = setTimeout(function () { commitChannelDigits(false); }, 1300);
  }

  function channelDigitsPending() {
    return !!(state.channelDigits && state.channelDigits.timer);
  }

  /* the typed number: tune (player) or focus it in the list; play: also start it there (OK) */
  function commitChannelDigits(play) {
    var cd = state.channelDigits;
    if (!cd || !cd.text) return;
    if (cd.timer) clearTimeout(cd.timer);
    var num = cd.text;
    cd.text = '';
    cd.timer = null;
    if (state.view === 'player' && state.isLive) {
      liveChannelList(function (list) {
        var i = findChannelByNumber(list, num);
        if (i < 0) showToast(T('Kein Sender {0}', num));
        else if (list[i].Id !== state.playerItem.Id) tuneChannel(list[i]);
      });
    } else if (state.view === 'library' && isLiveLib(state.lib)) {
      var j = findChannelByNumber(state.items, num);
      if (j < 0) { showToast(T('Kein Sender {0}', num)); return; }
      state.focus = j;
      updateFocus();
      maybeLoadMore();
      if (play) playItem(state.items[j]);
    }
  }

  function updateLiveUi() {
    var p = state.liveProgram;
    if (p && parseDate(p.EndDate) && now() > parseDate(p.EndDate) && now() - state.liveProgramsAt > 20000) {
      loadLivePrograms(state.playerItem);
    }
    /* the next show goes up here: next to the key hints the bottom line would wrap */
    psub.textContent = (p ? p.Name || '' : T('Live')) +
      (state.liveNext ? '   ·   ' + T('Danach: {0}', programLine(state.liveNext)) : '');
    var pct = programPct(p);
    progressFill.style.width = (pct >= 0 ? pct : 100) + '%';
    ptime.textContent = p && parseDate(p.StartDate) ? fmtClock(new Date(parseDate(p.StartDate))) + ' – ' +
      fmtClock(new Date(parseDate(p.EndDate))) : T('Live');
    pend.textContent = '';
  }

  /* ---------- music: albums, artists, playlists, player ---------- */

  function isMusicLib(v) { return !!v && v.CollectionType === 'music'; }

  /* albums and audio playlists open as a track list */
  function isTrackList(item) {
    return !!item && (item.Type === 'MusicAlbum' || (item.Type === 'Playlist' && item.MediaType === 'Audio'));
  }

  var TRACK_FIELDS = '&fields=MediaSources,PrimaryImageAspectRatio&enableImageTypes=Primary&imageTypeLimit=1';

  function fetchTracks(item, cb) {
    var path = '/Items?' + uidParam() + '&parentId=' + encodeURIComponent(item.Id) +
      '&includeItemTypes=Audio&recursive=true&limit=1000' + TRACK_FIELDS +
      /* a playlist keeps its own order */
      (item.Type === 'MusicAlbum' ? '&sortBy=ParentIndexNumber,IndexNumber,SortName&sortOrder=Ascending' : '');
    getJson(path, function (err, data) { cb(err, (!err && data && data.Items) || []); });
  }

  function trackArtists(t) {
    return (t.Artists && t.Artists.length ? t.Artists : (t.AlbumArtist ? [t.AlbumArtist] : [])).join(', ');
  }

  function fmtTrackTime(ticks) {
    return ticks ? fmtTime(Math.round(ticks / TICKS)) : '';
  }

  function musicBackdrop(item) {
    if (itemBackdropUrl(item)) setBackdrop(item);
    else showRandomBackdrop(null);
  }

  function openArtist(artist) {
    if (!artist || !artist.Id) return;
    pushState();
    var nav = enterView('artist', artist.Name || '');
    state.kind = 'items';
    state.bgItem = null;
    showRandomBackdrop(null);
    setHints([]);
    showLoading(T('{0} wird geladen ...', artist.Name || ''));
    var base = '/Items?' + uidParam() + '&includeItemTypes=MusicAlbum&recursive=true' + FIELDS +
      '&sortBy=ProductionYear,SortName&sortOrder=Descending,Ascending';
    function retry() { openArtist(artist); }
    var err = T('Alben konnten nicht geladen werden');
    loadGridPage(nav, base + '&albumArtistIds=' + encodeURIComponent(artist.Id), err, retry, function () {
      /* only guest appearances: albums the artist plays on */
      loadGridPage(nav, base + '&artistIds=' + encodeURIComponent(artist.Id), err, retry);
    });
  }

  /* album or audio playlist: header with buttons, then the tracks */
  function openAlbum(album) {
    pushState();
    state.trackFocus = -1;
    state.detailFocusKey = 'play';
    showAlbum(album);
  }

  function showAlbum(album) {
    var nav = enterView('album', album.Name || '');
    state.current = album;
    state.tracks = null;
    musicBackdrop(album);
    setHints([]);
    showLoading(T('{0} wird geladen ...', album.Name || ''));
    fetchTracks(album, function (err, tracks) {
      if (nav !== state.navSeq) return;
      if (err) { showRetry(T('Titel konnten nicht geladen werden ({0}).', errText(err)), function () { showAlbum(album); }); return; }
      if (!tracks.length) { showError(T('Keine Einträge gefunden.')); return; }
      state.tracks = tracks;
      renderAlbum();
    });
  }

  function renderAlbum() {
    var album = state.current;
    var tracks = state.tracks || [];
    content.innerHTML = '';
    var wrap = el('div', 'detail album');
    var poster = el('div', 'detailposter square');
    var img = document.createElement('img');
    img.onerror = function () { this.style.display = 'none'; };
    img.src = posterUrl(album, 300);
    poster.appendChild(img);
    var info = el('div', 'detailinfo');
    var artist = album.AlbumArtist || (album.Type === 'MusicAlbum' ? trackArtists(album) : '');
    if (artist) info.appendChild(el('div', 'detailseries', artist));
    info.appendChild(el('div', 'detailtitle', album.Name || ''));
    var total = 0;
    for (var i = 0; i < tracks.length; i++) total += tracks[i].RunTimeTicks || 0;
    var meta = [];
    if (album.ProductionYear) meta.push(String(album.ProductionYear));
    meta.push(tracks.length === 1 ? T('1 Titel') : T('{0} Titel', tracks.length));
    if (total) meta.push(fmtRuntime(total));
    info.appendChild(el('div', 'detailmeta', meta.join('  ·  ')));

    var buttons = [];
    var btnRow = el('div', 'btnrow');
    function addBtn(key, label, cls, fn) {
      var b = el('div', 'btn' + (cls ? ' ' + cls : ''), label);
      b.onclick = fn;
      b.setAttribute('data-key', key);
      btnRow.appendChild(b);
      buttons.push(b);
    }
    addBtn('play', T('Abspielen'), 'primary', function () { playMusic(tracks, 0, false); });
    addBtn('shuffle', T('Zufallswiedergabe'), '', function () { playMusic(tracks, 0, true); });
    var aa = album.AlbumArtists && album.AlbumArtists[0];
    if (aa && aa.Id) addBtn('artist', T('Zum Künstler'), '', function () { openArtist(aa); });
    info.appendChild(btnRow);
    wrap.appendChild(poster);
    wrap.appendChild(info);
    content.appendChild(wrap);

    /* disc numbers only when the album has more than one disc */
    var discs = {};
    var nDiscs = 0;
    for (i = 0; i < tracks.length; i++) {
      var d = tracks[i].ParentIndexNumber || 1;
      if (!discs[d]) { discs[d] = true; nDiscs++; }
    }
    var list = el('div', 'tracks');
    state.trackEls = [];
    for (i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var row = el('div', 'track');
      var num = album.Type === 'MusicAlbum' && t.IndexNumber ?
        (nDiscs > 1 ? (t.ParentIndexNumber || 1) + '.' : '') + t.IndexNumber : String(i + 1);
      row.appendChild(el('span', 'tnum', num));
      var name = el('span', 'tname', t.Name || '');
      var by = trackArtists(t);
      if (by && by !== artist) name.appendChild(el('span', 'tartist', '  ·  ' + by));
      row.appendChild(name);
      row.appendChild(el('span', 'ttime', fmtTrackTime(t.RunTimeTicks)));
      (function (idx) { row.onclick = function () { playMusic(tracks, idx, false); }; }(i));
      list.appendChild(row);
      state.trackEls.push(row);
    }
    content.appendChild(list);
    state.detailButtons = buttons;
    state.detailFocus = 0;
    for (i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-key') === state.detailFocusKey) state.detailFocus = i;
    }
    if (!(state.trackFocus < tracks.length)) state.trackFocus = -1;
    updateAlbumFocus();
    setHints([['ok', T('Abspielen')], ['arrows', T('Auswählen')], ['back', T('Zurück')]]);
  }

  /* trackFocus -1: the buttons, else a track */
  function updateAlbumFocus() {
    var b = state.detailButtons;
    var i;
    for (i = 0; i < b.length; i++) setFocused(b[i], state.trackFocus < 0 && i === state.detailFocus);
    if (state.trackFocus < 0 && b[state.detailFocus]) state.detailFocusKey = b[state.detailFocus].getAttribute('data-key');
    var els = state.trackEls || [];
    for (i = 0; i < els.length; i++) setFocused(els[i], i === state.trackFocus);
    if (state.trackFocus >= 0 && els[state.trackFocus]) ensureVisible(els[state.trackFocus]);
  }

  function albumMove(dy) {
    var n = (state.trackEls || []).length;
    var next = state.trackFocus + dy;
    if (state.trackFocus < 0 && dy < 0) { enterTop(); return; }
    if (next < -1) next = -1;
    if (next >= n) next = n - 1;
    if (next === state.trackFocus) return;
    state.trackFocus = next;
    updateAlbumFocus();
    if (next < 0) content.scrollTop = 0;
  }

  function handleAlbumKey(e, k) {
    if (!state.tracks) {
      if (isBackKey(k)) { e.preventDefault(); goBack(); }
      return;
    }
    e.preventDefault();
    if (k === K_UP) albumMove(-1);
    else if (k === K_DOWN) albumMove(1);
    else if (k === K_CH_UP) albumMove(state.trackFocus < 0 ? 0 : -10);
    else if (k === K_CH_DOWN) albumMove(10);
    else if ((k === K_LEFT || k === K_RIGHT) && state.trackFocus < 0) {
      var next = state.detailFocus + (k === K_LEFT ? -1 : 1);
      if (next >= 0 && next < state.detailButtons.length) { state.detailFocus = next; updateAlbumFocus(); }
    } else if (k === K_ENTER) {
      if (state.trackFocus >= 0) playMusic(state.tracks, state.trackFocus, false);
      else if (state.detailButtons[state.detailFocus]) state.detailButtons[state.detailFocus].onclick();
    } else if (isPlayKey(k)) {
      playMusic(state.tracks, Math.max(0, state.trackFocus), false);
    } else if (isBackKey(k)) {
      goBack();
    }
  }

  /* --- music player --- */

  var musicEl = document.getElementById('music');

  function shuffled(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* AVPlay on Tizen 2.3 plays MP3 and AAC; everything else (FLAC, Opus,
     ALAC, ...) is converted to MP3 by the server */
  function audioDirect(t) {
    var src = t.MediaSources && t.MediaSources[0];
    if (!src) return false;
    var container = String(src.Container || t.Container || '').toLowerCase();
    var codec = '';
    var streams = src.MediaStreams || [];
    for (var i = 0; i < streams.length; i++) {
      if (streams[i].Type === 'Audio') { codec = String(streams[i].Codec || '').toLowerCase(); break; }
    }
    if (container === 'mp3') return !codec || codec === 'mp3';
    return /^(m4a|m4b|mp4|aac)$/.test(container) && codec === 'aac';
  }

  function musicUrl(m, t, startMs) {
    var src = t.MediaSources && t.MediaSources[0];
    var msid = encodeURIComponent(src && src.Id ? src.Id : t.Id);
    var id = encodeURIComponent(t.Id);
    if (m.method === 'DirectPlay') return absUrl('/Audio/' + id + '/stream?static=true&MediaSourceId=' + msid);
    return absUrl('/Audio/' + id + '/stream.mp3?AudioCodec=mp3&AudioBitrate=256000&MediaSourceId=' + msid +
      '&PlaySessionId=' + encodeURIComponent(m.sessionId) + '&DeviceId=' + encodeURIComponent(DEVICEID) +
      (startMs > 0 ? '&StartTimeTicks=' + Math.round(startMs * TICKS) : ''));
  }

  function musicTrack() { var m = state.music; return m ? m.queue[m.index] : null; }

  function musicPos() {
    var m = state.music;
    if (!m || !m.prepared) return m ? m.offset : 0;
    var cur = 0;
    try { cur = webapis.avplay.getCurrentTime(); } catch (e) {}
    return (cur || 0) + m.offset;
  }

  function musicDuration() {
    var t = musicTrack();
    if (t && t.RunTimeTicks) return Math.round(t.RunTimeTicks / TICKS);
    var d = 0;
    try { d = webapis.avplay.getDuration(); } catch (e) {}
    return d > 0 ? d : 0;
  }

  function musicReport(kind, posMs, eventName, cb) {
    var m = state.music;
    var t = musicTrack();
    if (!m || !t) { if (cb) cb(); return; }
    var src = t.MediaSources && t.MediaSources[0];
    var body = {
      ItemId: t.Id,
      MediaSourceId: src && src.Id ? src.Id : t.Id,
      PlaySessionId: m.sessionId,
      PositionTicks: Math.max(0, Math.round(posMs * TICKS)),
      IsPaused: m.paused,
      IsMuted: false,
      CanSeek: true,
      PlayMethod: m.method,
      QueueableMediaTypes: ['Audio']
    };
    if (eventName) body.EventName = eventName;
    m.lastReport = now();
    api('POST', '/Sessions/Playing' + kind, body, function () { if (cb) cb(); });
  }

  /* tracks: the queue; shuffle: random order (from the first track) */
  function playMusic(tracks, index, shuffle) {
    if (!tracks || !tracks.length) return;
    var p = null;
    try { p = webapis.avplay; } catch (e) { p = null; }
    if (!p) { showToast(T('AVPlay nicht verfügbar')); return; }
    if (state.music) stopMusicTrack();
    var queue = shuffle ? shuffled(tracks) : tracks.slice();
    state.music = {
      queue: queue, index: shuffle ? 0 : index, token: 0, prepared: false, paused: false,
      method: 'DirectPlay', offset: 0, sessionId: '', reported: false, lastReport: 0,
      triedFallback: false, timer: null, prepareTimer: null, ctrl: 1,
      returnSnap: state.view === 'music' && state.music ? state.music.returnSnap : snapshot()
    };
    if (state.overlay) closeOverlay();
    state.view = 'music';
    setChrome(false);
    musicEl.className = '';
    startMusicTrack(0);
  }

  function startMusicTrack(startMs) {
    var m = state.music;
    var t = musicTrack();
    if (!m || !t) return;
    var token = ++m.token;
    m.prepared = false;
    m.paused = false;
    m.reported = false;
    m.triedFallback = false;
    m.method = audioDirect(t) ? 'DirectPlay' : 'Transcode';
    m.sessionId = 'm' + now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    renderMusic();
    openMusicStream(token, startMs || 0);
  }

  function openMusicStream(token, startMs) {
    var m = state.music;
    var t = musicTrack();
    var p = webapis.avplay;
    m.offset = m.method === 'Transcode' ? startMs : 0;
    if (m.timer) { clearInterval(m.timer); m.timer = null; }
    if (m.prepareTimer) { clearTimeout(m.prepareTimer); m.prepareTimer = null; }
    showPlayerLoading();
    function stale() { return state.music !== m || token !== m.token; }
    function failed(msg) {
      if (stale()) return;
      if (m.prepareTimer) { clearTimeout(m.prepareTimer); m.prepareTimer = null; }
      if (m.method === 'DirectPlay' && !m.triedFallback) {
        /* the TV couldn't play the file itself: let the server convert it */
        m.triedFallback = true;
        m.method = 'Transcode';
        openMusicStream(token, m.prepared ? musicPos() : startMs);
        return;
      }
      hidePlayerLoading();
      showToast(T('Titel konnte nicht abgespielt werden: {0}', t.Name || '') + (msg ? ' (' + msg + ')' : ''));
      if (m.index < m.queue.length - 1) { m.index++; startMusicTrack(0); }
      else stopMusic();
    }
    resetAvplay(function () {
      if (stale()) return;
      try {
        p.open(musicUrl(m, t, startMs));
        p.setListener({
          onstreamcompleted: function () { if (!stale()) musicNext(true); },
          onbufferingstart: function () { if (!stale()) showPlayerLoading(); },
          onbufferingcomplete: function () { if (!stale()) hidePlayerLoading(); },
          onerror: function (e) { failed(String(e)); }
        });
        p.prepareAsync(function () {
          if (stale()) return;
          if (m.prepareTimer) { clearTimeout(m.prepareTimer); m.prepareTimer = null; }
          m.prepared = true;
          try {
            p.play();
            if (m.method === 'DirectPlay' && startMs > 0) { try { p.seekTo(startMs); } catch (se) {} }
          } catch (e) { failed(String(e)); return; }
          hidePlayerLoading();
          if (!m.reported) { m.reported = true; musicReport('', startMs); }
          m.timer = setInterval(musicTick, 500);
          updateMusicUi();
        }, function (e) { failed(String(e)); });
        m.prepareTimer = setTimeout(function () { if (!m.prepared) failed(T('Timeout')); }, m.triedFallback ? 40000 : 15000);
      } catch (e) {
        failed(String(e));
      }
    });
  }

  function musicTick() {
    var m = state.music;
    if (!m) return;
    updateMusicUi();
    if (m.prepared && !m.paused && now() - m.lastReport > 10000) musicReport('/Progress', musicPos(), 'TimeUpdate');
  }

  /* report the current track as stopped and end its transcode */
  function stopMusicTrack(posMs) {
    var m = state.music;
    if (!m) return;
    m.token++;
    if (m.timer) { clearInterval(m.timer); m.timer = null; }
    if (m.prepareTimer) { clearTimeout(m.prepareTimer); m.prepareTimer = null; }
    if (m.reported) {
      m.reported = false;
      musicReport('/Stopped', typeof posMs === 'number' ? posMs : musicPos());
    }
    if (m.method === 'Transcode') {
      api('DELETE', '/Videos/ActiveEncodings?deviceId=' + encodeURIComponent(DEVICEID) +
        '&playSessionId=' + encodeURIComponent(m.sessionId), null, null);
    }
  }

  function stopMusic() {
    var m = state.music;
    if (!m) return;
    stopMusicTrack();
    state.music = null;
    hidePlayerLoading();
    musicEl.className = 'hidden';
    musicEl.innerHTML = '';
    resetAvplay(function () {});
    state.homeDirty = true;
    restoreState(m.returnSnap);
  }

  /* auto: the track ended by itself */
  function musicNext(auto) {
    var m = state.music;
    if (!m) return;
    if (m.index >= m.queue.length - 1) {
      if (auto) { stopMusicTrack(musicDuration()); stopMusic(); }
      else showToast(T('Letzter Titel'));
      return;
    }
    stopMusicTrack(auto ? musicDuration() : undefined);
    m.index++;
    startMusicTrack(0);
  }

  /* like a CD player: back to the start of the track, pressed again within
     3 seconds: the previous track */
  function musicPrev() {
    var m = state.music;
    if (!m) return;
    if (musicPos() > 3000 || m.index === 0) { musicSeek(0); return; }
    stopMusicTrack();
    m.index--;
    startMusicTrack(0);
  }

  function musicSeek(ms) {
    var m = state.music;
    if (!m || !m.prepared) return;
    var dur = musicDuration();
    if (ms < 0) ms = 0;
    if (dur > 0 && ms > dur - 1000) ms = Math.max(0, dur - 1000);
    if (m.method === 'Transcode') {
      /* a converted stream can't seek: restart it at the position */
      musicReport('/Progress', ms, 'TimeUpdate');
      api('DELETE', '/Videos/ActiveEncodings?deviceId=' + encodeURIComponent(DEVICEID) +
        '&playSessionId=' + encodeURIComponent(m.sessionId), null, null);
      m.prepared = false;
      openMusicStream(++m.token, ms);
      return;
    }
    try { webapis.avplay.seekTo(ms); } catch (e) {}
    updateMusicUi();
  }

  function musicTogglePause(mode) {
    var m = state.music;
    if (!m || !m.prepared) return;
    var pause = mode ? mode === 'pause' : !m.paused;
    if (pause === m.paused) return;
    try {
      if (pause) webapis.avplay.pause();
      else webapis.avplay.play();
    } catch (e) {}
    m.paused = pause;
    updateMusicUi();
    musicReport('/Progress', musicPos(), pause ? 'Pause' : 'Unpause');
  }

  function trackCoverUrl(t, height) {
    if (t.ImageTags && t.ImageTags.Primary) return imageUrl(t.Id, 'Primary', t.ImageTags.Primary, height);
    if (t.AlbumId && t.AlbumPrimaryImageTag) return imageUrl(t.AlbumId, 'Primary', t.AlbumPrimaryImageTag, height);
    return t.AlbumId ? imageUrl(t.AlbumId, 'Primary', '', height) : imageUrl(t.Id, 'Primary', '', height);
  }

  function renderMusic() {
    var m = state.music;
    var t = musicTrack();
    if (!m || !t) return;
    var html = '<div id="mcover"><img src="' + esc(trackCoverUrl(t, 480)) + '" onerror="this.style.display=\'none\'"></div>' +
      '<div id="minfo">' +
      '<div id="mtitle">' + esc(t.Name || '') + '</div>' +
      '<div id="martist">' + esc(trackArtists(t)) + '</div>' +
      '<div id="malbum">' + esc(t.Album || '') + '</div>' +
      '<div id="mprogress"><div id="mfill"></div></div>' +
      '<div id="mtime"><span id="mcur"></span><span id="mstate"></span><span id="mpos"></span></div>' +
      '<div id="mctrl"><span class="mbtn mprev"><i class="bar"></i><i class="tri"></i></span>' +
      '<span class="mbtn mplay"><i class="bar"></i><i class="bar"></i><i class="tri"></i></span>' +
      '<span class="mbtn mnext"><i class="tri"></i><i class="bar"></i></span></div>';
    var next = m.queue.slice(m.index + 1, m.index + 6);
    if (next.length) {
      html += '<div id="mqueue"><div class="mqtitle">' + esc(T('Als Nächstes')) + '</div>';
      for (var i = 0; i < next.length; i++) {
        html += '<div class="mqrow"><span class="mqname">' + esc(next[i].Name || '') + '</span>' +
          '<span class="mqartist">' + esc(trackArtists(next[i])) + '</span></div>';
      }
      html += '</div>';
    }
    html += '</div><div id="mhint"></div>';
    musicEl.innerHTML = html;
    updateMusicUi();
    /* at 1280x720 not all five fit: drop rows that would run into the hint line */
    var hint = $('mhint');
    var rows = musicEl.querySelectorAll('.mqrow');
    for (var r = rows.length - 1; r >= 0 && rows[r].getBoundingClientRect().bottom > hint.getBoundingClientRect().top - 12; r--) {
      rows[r].parentNode.removeChild(rows[r]);
    }
    if (r < 0 && $('mqueue')) $('mqueue').parentNode.removeChild($('mqueue'));
  }

  function updateMusicUi() {
    var m = state.music;
    if (!m || !$('mcur')) return;
    var pos = musicPos();
    var dur = musicDuration();
    $('mcur').textContent = fmtTime(pos) + (dur ? ' / ' + fmtTime(dur) : '');
    $('mstate').textContent = m.paused ? T('Pausiert') : '';
    $('mpos').textContent = T('Titel {0} von {1}', m.index + 1, m.queue.length);
    $('mfill').style.width = (dur > 0 ? Math.min(100, pos / dur * 100) : 0) + '%';
    var btns = musicEl.querySelectorAll('.mbtn');
    var names = ['mprev', 'mplay' + (m.paused ? ' paused' : ''), 'mnext'];
    for (var i = 0; i < btns.length; i++) btns[i].className = 'mbtn ' + names[i] + (i === m.ctrl ? ' focused' : '');
    $('mhint').textContent = [T('◀ ▶ OK: Steuerung'), T('CH ▲ ▼: Titel'),
      T('◀◀ ▶▶: Spulen'), T('Zurück: Stopp')].join('  ·  ');
  }

  function handleMusicKey(e, k) {
    e.preventDefault();
    if (isBackKey(k) || k === K_STOP || k === 178) stopMusic();
    else if (k === K_ENTER) {
      if (now() - state.lastActivate < 350) return;  /* key repeat */
      state.lastActivate = now();
      if (state.music.ctrl === 0) musicPrev();
      else if (state.music.ctrl === 2) musicNext(false);
      else musicTogglePause();
    }
    else if (k === K_LEFT || k === K_RIGHT) {
      state.music.ctrl = Math.max(0, Math.min(2, state.music.ctrl + (k === K_LEFT ? -1 : 1)));
      updateMusicUi();
    }
    else if (k === K_PLAYPAUSE || k === 179) musicTogglePause();
    else if (k === K_PLAY) musicTogglePause('play');
    else if (k === K_PAUSE) musicTogglePause('pause');
    else if (k === K_CH_UP) musicNext(false);
    else if (k === K_CH_DOWN) musicPrev();
    else if (k === K_FF) musicSeek(musicPos() + 10000);
    else if (k === K_RW) musicSeek(musicPos() - 10000);
    else if (k >= 48 && k <= 57) musicSeek(musicDuration() * (k - 48) / 10);
  }

  function playOrOpen(item) {
    if (!item) return;
    if (item.Type === 'Audio') { playMusic([item], 0, false); return; }
    if (isTrackList(item)) {
      fetchTracks(item, function (err, tracks) {
        if (err) showToast(T('Titel konnten nicht geladen werden ({0}).', errText(err)));
        else playMusic(tracks, 0, false);
      });
      return;
    }
    if (isPlayable(item)) playItem(item);
    else if (item.Type === 'Book') openBook(item, false);
    else openItem(item);
  }

  document.addEventListener('keydown', function (e) {
    try {
      handleKeyDown(e);
    } catch (err) {
      try { showToast(T('Fehler: {0}', err && err.message ? err.message : err)); } catch (e2) {}
      try {
        state.stack = [];
        goHome();
      } catch (e3) {}
    }
  });

  /* Home/Source pressed during playback: pause and save the position */
  function onVisibility() {
    var hidden = document.hidden || document.webkitHidden;
    if (hidden && state.view === 'player' && state.prepared) togglePause('pause');
    if (hidden && state.view === 'music') musicTogglePause('pause');
  }
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('webkitvisibilitychange', onVisibility);

  /* ---------- start ---------- */

  try {
    if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
      var keyNames = [
        'MediaStop', 'MediaPause', 'MediaPlay', 'MediaPlayPause',
        'MediaFastForward', 'MediaRewind',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        'ChannelUp', 'ChannelDown', 'Info',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ];
      for (var ki = 0; ki < keyNames.length; ki++) {
        try { tizen.tvinputdevice.registerKey(keyNames[ki]); } catch (ke) {}
      }
    }
  } catch (e) {}

  updateClock();
  setInterval(updateClock, 15000);
  loadPrefs();
  loadServer();
  loadAuth();

  /* ---------- native TLS proxy ---------- */

  var proxy = { state: 'starting', info: 'wird aufgebaut', port: PROXY_PORT };

  /* load the NaCl module and start its proxy; done() runs once API is final */
  function startProxy(done) {
    API = directApi();
    var finished = false;
    var tries = 0;
    var seerrTries = 0;
    var timer = null;
    var module = null;
    function finish(ok, info) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      proxy.error = ok ? '' : info;
      if (ok) {
        proxy.state = 'on';
        proxy.info = (server.jf.scheme === 'http' ? 'HTTP' : 'TLS 1.2') + ' (NaCl-Proxy, Port ' + proxy.port + ')';
        API = 'http://127.0.0.1:' + proxy.port + server.jf.path;
        sendSeerr();
        done();
        return;
      }
      useDirect(info, done);
    }
    if (!server.jf) { finish(false, T('kein Server')); return; }
    if (window.JF_NO_NACL) { finish(false, T('deaktiviert')); return; }
    var holder = document.createElement('div');
    holder.style.position = 'absolute';
    holder.style.width = '0';
    holder.style.height = '0';
    holder.style.overflow = 'hidden';
    document.body.appendChild(holder);
    function send() {
      var a = server.jf;
      module.postMessage('proxy ' + proxy.port + ' ' + moduleHost(a) + ' ' + a.port + ' fast' +
        (a.scheme === 'http' ? ' plain' : ''));
    }
    /* second proxy for Seerr (cookie jar + CSRF handled in the module) */
    function sendSeerr() {
      var a = server.seerr;
      if (!a) return;
      seerr.state = 'starting';
      module.postMessage('proxy ' + seerr.port + ' ' + moduleHost(a) + ' ' + a.port + ' fast seerr' +
        (a.scheme === 'http' ? ' plain' : ''));
    }
    holder.addEventListener('message', function (ev) {
      var parts = String(ev.data).split('|');
      var port = parseInt(parts[1], 10);
      if (parts[0] === 'init-ok') send();
      else if (parts[0] === 'init-error') finish(false, parts[1] || 'init');
      else if (parts[0] === 'proxy-ready') {
        if (port === seerr.port) seerrProxyReady(module);
        else finish(true, '');
      } else if (parts[0] === 'proxy-error') {
        /* port taken (e.g. by a previous instance): try the next one */
        if (port === seerr.port) {
          if (++seerrTries < 5) { seerr.port++; sendSeerr(); } else seerr.state = 'unavailable';
        } else if (++tries < 5 && !finished) { proxy.port++; send(); }
        else finish(false, parts[2] || 'proxy');
      } else if (parts[0] === 'cookies' && port === seerr.port) {
        try { localStorage.setItem('jf_seerr_cookies', parts.slice(2).join('|')); } catch (e) {}
      }
    }, true);
    holder.addEventListener('error', function () { finish(false, T('Modul nicht geladen')); }, true);
    holder.addEventListener('crash', function () {
      seerr.state = 'unavailable';
      if (!finished) { finish(false, T('Modul abgestürzt')); return; }
      proxyLost();
    }, true);
    module = document.createElement('embed');
    module.setAttribute('width', '0');
    module.setAttribute('height', '0');
    module.setAttribute('type', 'application/x-nacl');
    module.setAttribute('src', 'native/dist/tlsproxy_arm.nmf');
    holder.appendChild(module);
    timer = setTimeout(function () { finish(false, T('Timeout')); }, 15000);
  }

  /* ---------- Seerr ---------- */

  var seerr = { state: 'off', port: SEERR_PORT, loggedIn: false, waiters: null };
  var SEERR_STATUS = { 2: 'Angefragt', 3: 'In Bearbeitung', 4: 'Teilweise verfügbar', 5: 'Verfügbar' };
  var SEERR_BADGE = { 2: 'Angefragt', 3: 'In Arbeit', 4: 'Teilweise' };

  function seerrProxyReady(module) {
    var saved = '';
    try { saved = localStorage.getItem('jf_seerr_cookies') || ''; } catch (e) {}
    if (saved) module.postMessage('cookies ' + seerr.port + ' ' + saved);
    seerr.state = 'ready';
  }

  function seerrBase() { return 'http://127.0.0.1:' + seerr.port + (server.seerr ? server.seerr.path : ''); }

  function seerrImage(path, size) {
    return path ? seerrBase() + '/imageproxy/tmdb/t/p/' + size + path : '';
  }

  /* JSON request to Seerr's API through the seerr proxy */
  function seerrApi(method, path, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    var timer = setTimeout(function () { finish('timeout', null); try { x.abort(); } catch (e) {} }, REQUEST_TIMEOUT);
    function finish(err, data) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(err, data);
    }
    x.open(method, seerrBase() + '/api/v1' + path, true);
    if (body) x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var data = null;
      try { data = x.responseText ? JSON.parse(x.responseText) : null; } catch (e) {}
      if (x.status >= 200 && x.status < 300) finish(null, data);
      else finish(x.status || 0, data);
    };
    try { x.send(body ? JSON.stringify(body) : null); } catch (e) { finish(0, null); }
  }

  /* Sign in with the Jellyfin account, no password: start Quick Connect in
     Seerr and approve the code ourselves with the Jellyfin session. */
  function seerrLogin(cb) {
    if (seerr.state !== 'ready' || !state.token) { cb('unavailable'); return; }
    if (seerr.loggedIn) { cb(null); return; }
    if (seerr.waiters) { seerr.waiters.push(cb); return; }
    seerr.waiters = [cb];
    function done(err) {
      var w = seerr.waiters;
      seerr.waiters = null;
      seerr.loggedIn = !err;
      for (var i = 0; i < w.length; i++) w[i](err);
    }
    seerrApi('GET', '/auth/me', null, function (err) {
      if (!err) { done(null); return; }
      seerrApi('POST', '/auth/jellyfin/quickconnect/initiate', {}, function (e1, qc) {
        if (e1 || !qc || !qc.code) { done(e1 || 'initiate'); return; }
        api('POST', '/QuickConnect/Authorize?code=' + encodeURIComponent(qc.code) + '&' + uidParam(), null,
          function (e2) {
            if (e2) { done(e2); return; }
            seerrApi('POST', '/auth/jellyfin/quickconnect/authenticate', { secret: qc.secret }, function (e3) {
              done(e3 || null);
            });
          });
      });
    });
  }

  /* API call that signs in first and once more if the session expired */
  function seerrCall(method, path, body, cb) {
    seerrLogin(function (err) {
      if (err) { cb(err); return; }
      seerrApi(method, path, body, function (e, data) {
        if (e !== 401 && e !== 403) { cb(e, data); return; }
        seerr.loggedIn = false;
        seerrLogin(function (e2) {
          if (e2) { cb(e2); return; }
          seerrApi(method, path, body, cb);
        });
      });
    });
  }

  /* Seerr search result -> card data */
  function seerrEntry(r) {
    var status = r.mediaInfo && r.mediaInfo.status;
    var date = r.releaseDate || r.firstAirDate || '';
    return {
      seerr: true,
      mediaType: r.mediaType,
      tmdbId: r.id,
      Id: 'seerr-' + r.mediaType + '-' + r.id,
      Name: r.title || r.name || '',
      year: date.substr(0, 4),
      poster: seerrImage(r.posterPath, 'w300_and_h450_face'),
      backdrop: seerrImage(r.backdropPath, 'w1280'),
      status: status || 0,
      jellyfinId: (r.mediaInfo && r.mediaInfo.jellyfinMediaId) || ''
    };
  }

  function makeSeerrCard(s) {
    var card = el('div', 'card');
    var poster = el('div', 'poster');
    if (s.poster) {
      var img = document.createElement('img');
      img.onerror = function () { this.style.display = 'none'; };
      img.src = s.poster;
      poster.appendChild(img);
    }
    if (s.status === 5) poster.appendChild(el('div', 'badge done', '✓'));
    else if (SEERR_BADGE[s.status]) poster.appendChild(el('div', 'badge seerr', T(SEERR_BADGE[s.status])));
    card.appendChild(poster);
    card.appendChild(el('div', 'cardtitle', s.Name));
    card.appendChild(el('div', 'cardsub', (s.mediaType === 'tv' ? T('Serie') : T('Film')) + (s.year ? '  ·  ' + s.year : '')));
    return card;
  }

  function seerrSearch(term, cb) {
    seerrCall('GET', '/search?query=' + encodeURIComponent(term) + '&page=1&language=de', null, function (err, data) {
      if (err) { cb(err, []); return; }
      var out = [];
      var res = (data && data.results) || [];
      for (var i = 0; i < res.length && out.length < 20; i++) {
        if (res[i].mediaType === 'movie' || res[i].mediaType === 'tv') out.push(seerrEntry(res[i]));
      }
      cb(null, out);
    });
  }

  /* details page for a Seerr title: request it or open it */
  function showSeerrDetails(entry, push) {
    if (push) {
      pushState();
      state.detailFocusKey = 'main';
    }
    var nav = enterView('seerr', entry.Name);
    state.current = entry;
    renderSeerrDetails(entry, null);
    setHints([['ok', T('Auswählen')], ['arrows', T('Scrollen')], ['back', T('Zurück')]]);
    seerrCall('GET', '/' + entry.mediaType + '/' + entry.tmdbId + '?language=de', null, function (err, d) {
      if (nav !== state.navSeq) return;
      if (err || !d) { showToast(T('Seerr: Details nicht geladen ({0}).', errText(err))); return; }
      var fresh = seerrEntry({
        id: d.id, mediaType: entry.mediaType, title: d.title, name: d.name,
        releaseDate: d.releaseDate, firstAirDate: d.firstAirDate,
        posterPath: d.posterPath, backdropPath: d.backdropPath, mediaInfo: d.mediaInfo
      });
      state.current = fresh;
      renderSeerrDetails(fresh, d);
    });
  }

  function renderSeerrDetails(s, d) {
    content.innerHTML = '';
    var wrap = el('div', 'detail');
    var poster = el('div', 'detailposter');
    if (s.poster) {
      var img = document.createElement('img');
      img.onerror = function () { this.style.display = 'none'; };
      img.src = s.poster.replace('w300_and_h450_face', 'w600_and_h900_bestv2');
      poster.appendChild(img);
    }
    var info = el('div', 'detailinfo');
    info.appendChild(el('div', 'detailseries', 'Seerr'));
    info.appendChild(el('div', 'detailtitle', s.Name));
    var meta = [s.mediaType === 'tv' ? T('Serie') : T('Film')];
    if (s.year) meta.push(s.year);
    if (d && d.runtime) meta.push(T('{0} Min.', d.runtime));
    if (d && d.numberOfSeasons) meta.push(d.numberOfSeasons === 1 ? T('1 Staffel') : T('{0} Staffeln', d.numberOfSeasons));
    if (d && d.voteAverage) meta.push('★ ' + (Math.round(d.voteAverage * 10) / 10));
    if (SEERR_STATUS[s.status]) meta.push(T(SEERR_STATUS[s.status]));
    info.appendChild(el('div', 'detailmeta', meta.join('  ·  ')));
    if (d && d.genres && d.genres.length) {
      var g = [];
      for (var i = 0; i < d.genres.length; i++) g.push(d.genres[i].name);
      info.appendChild(el('div', 'detailgenres', g.join(', ')));
    }
    var buttons = [];
    var btnRow = el('div', 'btnrow');
    function addBtn(key, label, cls, fn) {
      var b = el('div', 'btn' + (cls ? ' ' + cls : ''), label);
      b.onclick = fn;
      b.setAttribute('data-key', key);
      btnRow.appendChild(b);
      buttons.push(b);
    }
    if (s.jellyfinId && (s.status === 5 || s.status === 4)) {
      addBtn('main', T('In der Bibliothek öffnen'), 'primary', function () { openJellyfinItem(s.jellyfinId); });
    }
    if (d && (!s.status || s.status === 1 || (s.mediaType === 'tv' && s.status === 4))) {
      addBtn(s.status === 4 ? 'request' : 'main',
        s.mediaType === 'tv' ? (s.status === 4 ? T('Fehlende Staffeln anfragen') : T('Alle Staffeln anfragen')) : T('Anfragen'),
        s.status === 4 ? '' : 'primary', function () { seerrRequest(s); });
    }
    if (!d) info.appendChild(el('div', 'detailmeta', T('Lade Details von Seerr ...')));
    info.appendChild(btnRow);
    info.appendChild(el('div', 'overview', (d && d.overview) || ''));
    wrap.appendChild(poster);
    wrap.appendChild(info);
    content.appendChild(wrap);
    setBackdrop({ __backdrop: s.backdrop });
    state.detailButtons = buttons;
    state.detailFocus = 0;
    for (i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-key') === state.detailFocusKey) state.detailFocus = i;
    }
    updateDetailFocus();
  }

  function seerrRequest(s) {
    var body = { mediaType: s.mediaType, mediaId: s.tmdbId };
    if (s.mediaType === 'tv') body.seasons = 'all';
    seerrCall('POST', '/request', body, function (err, data) {
      if (err) {
        var msg = (data && data.message) || errText(err);
        showToast(err === 409 ? T('Bereits angefragt.') : err === 403 ? T('Keine Berechtigung für Anfragen.') :
          T('Anfrage fehlgeschlagen ({0}).', msg));
        return;
      }
      showToast(T('„{0}“ wurde angefragt.', s.Name));
      if (state.view === 'seerr' && state.current && state.current.tmdbId === s.tmdbId) {
        showSeerrDetails(s, false);
      }
    });
  }

  /* open a Jellyfin item by id (from Seerr's library link) */
  function openJellyfinItem(id) {
    getJsonAlt('/Items/' + encodeURIComponent(id) + '?' + uidParam(),
      '/Users/' + encodeURIComponent(state.userId) + '/Items/' + encodeURIComponent(id),
      function (err, item) {
        if (err || !item) { showToast(T('Nicht in der Bibliothek gefunden ({0}).', errText(err))); return; }
        openItem(item);
      });
  }

  /* Without the module: http:// servers are used directly; for https://
     the TV's own browser is tried once (newer TVs speak TLS 1.2 themselves,
     this one only TLS 1.0, which the server should not offer). */
  function useDirect(info, done) {
    var a = server.jf;
    proxy.info = T('keine (Modul: {0})', info);
    if (!a) { proxy.state = 'failed'; done(); return; }
    if (a.scheme === 'http') {
      proxy.state = 'direct';
      proxy.info = T('HTTP direkt (ohne Modul: {0})', info);
      API = a.url;
      done();
      return;
    }
    probeDirect(a.url, function (ok) {
      if (ok) {
        proxy.state = 'direct';
        proxy.info = T('TLS direkt vom Fernseher (ohne Modul: {0})', info);
        API = a.url;
      } else {
        proxy.state = 'failed';
        API = '';
      }
      done();
    });
  }

  /* can the TV's browser reach the server by itself? */
  function probeDirect(url, cb) {
    var x = new XMLHttpRequest();
    var finished = false;
    function end(ok) {
      if (finished) return;
      finished = true;
      clearTimeout(t);
      cb(ok);
    }
    var t = setTimeout(function () { try { x.abort(); } catch (e) {} end(false); }, 8000);
    try {
      x.open('GET', url + '/System/Info/Public', true);
      x.onreadystatechange = function () { if (x.readyState === 4) end(x.status === 200); };
      x.send(null);
    } catch (e2) { end(false); }
  }

  /* the module died while running: continue directly if possible, else the
     error screen (it can restart the app) */
  function proxyLost() {
    if (proxy.state !== 'on') return;
    if (state.view === 'player') stopPlayback();
    useDirect(T('abgest\u00fcrzt'), function () {
      if (proxy.state === 'failed') showModuleError();
      else showToast(T('TLS-Modul abgest\u00fcrzt \u2013 direkte Verbindung'));
    });
  }

  /* https:// servers can't be reached without the module (the TV itself
     only speaks TLS 1.0) */
  function showModuleError() {
    var box = loginShell(T('Keine sichere Verbindung'),
      T('Das TLS-Modul konnte nicht gestartet werden ({0}), und der Fernseher selbst erreicht den Server nicht (er beherrscht kein aktuelles TLS).', proxy.error || T('unbekannt')), null, null);
    var btns = el('div', 'loginbtns');
    var retry = loginButton(btns, T('Erneut versuchen'), 'primary', function () {
      showLoading(T('Neustart ...'));
      setTimeout(function () { window.location.reload(); }, 200);
    });
    var change = loginButton(btns, T('Server \u00e4ndern'), '', function () { showServerSetup(); });
    box.appendChild(btns);
    setLoginRows([[retry, change]], 0, 0);
  }

  function startup() {
    if (server.jf && proxy.state === 'failed') { showModuleError(); return; }
    if (!state.token) { showLogin(); return; }
    setChrome(true);
    showLoading(T('Verbinde ...'));
    getJson('/Users/Me', function (err, user) {
      if (!state.token) return; /* 401 already handled by sessionExpired */
      if (err) {
        /* keep the login: the server may just be unreachable right now */
        showRetry(T('Server nicht erreichbar ({0}).', errText(err)), startup);
        return;
      }
      state.userId = user.Id;
      state.userName = user.Name;
      state.userImageTag = user.PrimaryImageTag || null;
      saveAuth();
      loadHome();
    });
  }
  /* The TV's menu language (Tizen system info "LOCALE", e.g. "de_DE"), else
     the browser's. German is built in, the other languages come from
     i18n.js; languages without a translation get English. */
  function detectLanguage(done) {
    var finished = false;
    function use(code) {
      if (finished) return;
      finished = true;
      var all = window.JF_I18N || {};
      var l = String(code || navigator.language || 'en').toLowerCase().slice(0, 2);
      LANG = l === 'de' ? 'de' : (all[l] ? l : 'en');
      TR = LANG === 'de' ? null : (all[LANG] || null);
      try { document.documentElement.lang = LANG; } catch (e) {}
      done();
    }
    if (window.JF_LANG) { use(window.JF_LANG); return; }
    try {
      tizen.systeminfo.getPropertyValue('LOCALE', function (loc) { use(loc && loc.language); },
        function () { use(null); });
    } catch (e) { use(null); }
    setTimeout(function () { use(null); }, 1500);
  }

  setChrome(true);
  detectLanguage(function () {
    showLoading(T('Sichere Verbindung wird aufgebaut ...'));
    startProxy(startup);
  });
}());
