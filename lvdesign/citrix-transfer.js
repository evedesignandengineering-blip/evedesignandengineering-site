/* LVDesign Web: Citrix transfer.
   In a Citrix session, "Send to desktop" stores the chosen .net and .lvd files under the signed-in account for 24 hours.
   On the desktop, "Import from Citrix" downloads them straight away. Files are private to the account and deleted after 24 hours.
   The loader (/lvdesign/index.html) adds this script to the app. window.LVDHandoff lets the app's own File menu call it. */
(function () {
  if (window.LVDHandoff) return;
  var SB_URL = 'https://hszkloepnewfkzdegfhl.supabase.co', SB_KEY = 'sb_publishable_Avjn-CGtbEdeLaxSWCwQDw_36mgImSu';
  var MAX_TOTAL = 20 * 1024 * 1024, sb = null, sbReady = null;

  function client() {
    if (sb) return Promise.resolve(sb);
    if (sbReady) return sbReady;
    sbReady = new Promise(function (ok, bad) {
      function make() { sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true } }); ok(sb); }
      if (window.supabase && window.supabase.createClient) return make();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
      s.onload = make; s.onerror = function () { sbReady = null; bad(new Error('Could not load the sign-in library.')); };
      document.head.appendChild(s);
    });
    return sbReady;
  }
  function extOf(n) { var m = /\.([^.]+)$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; }
  function kb(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function when(t) { var d = new Date(t); return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
  function toB64(file) {
    return new Promise(function (ok, bad) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); ok(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { bad(r.error || new Error('Could not read ' + file.name)); };
      r.readAsDataURL(file);
    });
  }
  function fromB64(b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function save(name, bytes) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    var a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function errMsg(e) { return (e && (e.message || e.error_description)) || String(e); }

  async function send(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) throw new Error('Choose the .net and .lvd files first.');
    var bad = files.filter(function (f) { var x = extOf(f.name); return x !== 'net' && x !== 'lvd'; });
    if (bad.length) throw new Error('Only .net and .lvd files can be sent. Remove ' + bad.map(function (f) { return f.name; }).join(', ') + '.');
    var total = files.reduce(function (a, f) { return a + f.size; }, 0);
    if (total > MAX_TOTAL) throw new Error('These files are ' + kb(total) + '. The limit is 20 MB in total.');
    var payload = [];
    for (var i = 0; i < files.length; i++) payload.push({ name: files[i].name, ext: extOf(files[i].name), size: files[i].size, b64: await toB64(files[i]) });
    var c = await client(), r = await c.rpc('lvd_handoff_put', { p_files: payload });
    if (r.error) throw new Error(r.error.message);
    return { count: files.length, expires: r.data };
  }
  async function list() {
    var c = await client(), r = await c.rpc('lvd_handoff_list');
    if (r.error) throw new Error(r.error.message);
    return r.data || [];
  }
  async function importFiles() {
    var c = await client(), r = await c.rpc('lvd_handoff_get');
    if (r.error) throw new Error(r.error.message);
    var rows = r.data || [];
    rows.forEach(function (f, i) { setTimeout(function () { save(f.name, fromB64(f.content_b64)); }, i * 400); });
    return rows.map(function (f) { return { name: f.name, ext: f.ext, size: f.size_bytes, bytes: fromB64(f.content_b64), expires: f.expires_at }; });
  }
  async function clear() {
    var c = await client(), r = await c.rpc('lvd_handoff_clear');
    if (r.error) throw new Error(r.error.message);
  }

  /* Panel, kept in a shadow root so it neither inherits nor disturbs the app's styles. */
  var host, root, els = {};
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:"DM Sans",system-ui,sans-serif}',
    '[hidden]{display:none!important}',
    '.fab{position:fixed;left:14px;bottom:14px;z-index:2147483000;display:flex;align-items:center;gap:7px;border:1px solid #cbd6e1;background:#fff;color:#09284b;border-radius:999px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px #09284b22}',
    '.fab:hover{border-color:#2f6ea4}',
    '.dot{min-width:18px;height:18px;border-radius:9px;background:#2f6ea4;color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px}',
    '.panel{position:fixed;left:14px;bottom:62px;z-index:2147483001;width:min(360px,calc(100vw - 28px));background:#fff;color:#14212b;border:1px solid #d8e0e8;border-radius:12px;box-shadow:0 16px 40px #09284b2e;padding:16px;font-size:13.5px;line-height:1.5}',
    'h2{margin:0 0 2px;font:800 16px Manrope,"DM Sans",sans-serif;color:#09284b}',
    '.sub{color:#566473;font-size:12.5px;margin:0 0 12px}',
    '.sec{border-top:1px solid #e3e9ef;padding-top:12px;margin-top:12px}',
    '.sec b{display:block;color:#09284b;margin-bottom:4px}',
    'button.act{width:100%;border:0;border-radius:7px;background:#2f6ea4;color:#fff;padding:9px 12px;font-size:13.5px;font-weight:700;cursor:pointer;margin-top:8px}',
    'button.act:hover{background:#265d8b}button.act:disabled{opacity:.55;cursor:default}',
    'button.link{border:0;background:none;color:#2f6ea4;font-size:12.5px;font-weight:600;cursor:pointer;padding:4px 0;margin-top:6px}',
    'button.x{position:absolute;right:10px;top:8px;border:0;background:none;font-size:18px;color:#566473;cursor:pointer;line-height:1}',
    'ul{list-style:none;margin:6px 0 0;padding:0}li{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:12.5px}li span:last-child{color:#566473;white-space:nowrap}',
    '.msg{margin-top:10px;font-size:12.5px;min-height:1em}.msg.bad{color:#b42318}.msg.ok{color:#1f7a45}',
    '.muted{color:#566473;font-size:12.5px}',
    'button:focus-visible{outline:3px solid #2f6ea455;outline-offset:2px}'
  ].join('');

  function build() {
    host = document.createElement('div'); host.id = 'lvd-citrix-transfer';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>' +
      '<button class="fab" id="fab" type="button" aria-expanded="false" title="Move .net and .lvd files between Citrix and your desktop">\u21c4 Citrix transfer <span class="dot" id="dot" hidden></span></button>' +
      '<div class="panel" id="panel" role="dialog" aria-label="Citrix transfer" hidden>' +
      '<button class="x" id="close" type="button" aria-label="Close">\u00d7</button>' +
      '<h2>Citrix transfer</h2><p class="sub">Files are kept for 24 hours under your account only, then deleted.</p>' +
      '<div><b style="color:#09284b">In Citrix: send to desktop</b><div class="muted">After LVDesign has the ADMD data, save the .net and .lvd files, then choose them here.</div>' +
      '<input id="pick" type="file" accept=".net,.lvd" multiple hidden>' +
      '<button class="act" id="send" type="button">Choose .net and .lvd files\u2026</button></div>' +
      '<div class="sec"><b>On desktop: import from Citrix</b><div id="waiting" class="muted">Checking\u2026</div><ul id="list"></ul>' +
      '<button class="act" id="imp" type="button" disabled>Import from Citrix</button>' +
      '<button class="link" id="del" type="button" hidden>Delete the stored files now</button></div>' +
      '<div class="msg" id="msg" role="status"></div></div>';
    ['fab', 'dot', 'panel', 'close', 'pick', 'send', 'waiting', 'list', 'imp', 'del', 'msg'].forEach(function (k) { els[k] = root.getElementById(k); });
    document.body.appendChild(host);

    els.fab.onclick = function () { toggle(els.panel.hidden); };
    els.close.onclick = function () { toggle(false); };
    els.send.onclick = function () { els.pick.value = ''; els.pick.click(); };
    els.pick.onchange = async function () {
      var fs = els.pick.files; if (!fs || !fs.length) return;
      busy(els.send, 'Sending\u2026'); say('');
      try {
        var r = await send(fs);
        say(r.count + ' file' + (r.count > 1 ? 's' : '') + ' sent. Open LVDesign Web on your desktop and choose Import from Citrix before ' + when(r.expires) + '.', 'ok');
        await refresh();
      } catch (e) { say(errMsg(e), 'bad'); }
      idle(els.send, 'Choose .net and .lvd files\u2026');
    };
    els.imp.onclick = async function () {
      busy(els.imp, 'Downloading\u2026'); say('');
      try {
        var got = await importFiles();
        say(got.length ? 'Downloaded ' + got.map(function (f) { return f.name; }).join(' and ') + '. Open them from your Downloads folder.' : 'Nothing is waiting from Citrix.', got.length ? 'ok' : 'bad');
        try { window.dispatchEvent(new CustomEvent('lvd-citrix-import', { detail: got })); } catch (_) {}
      } catch (e) { say(errMsg(e), 'bad'); }
      idle(els.imp, 'Import from Citrix'); refresh();
    };
    els.del.onclick = async function () {
      try { await clear(); say('Stored files deleted.', 'ok'); } catch (e) { say(errMsg(e), 'bad'); }
      refresh();
    };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !els.panel.hidden) toggle(false); });
  }
  function toggle(open) { els.panel.hidden = !open; els.fab.setAttribute('aria-expanded', String(open)); if (open) refresh(); }
  function busy(b, t) { b.disabled = true; b.textContent = t; }
  function idle(b, t) { b.disabled = false; b.textContent = t; }
  function say(t, cls) { els.msg.textContent = t; els.msg.className = 'msg' + (cls ? ' ' + cls : ''); }

  async function refresh() {
    try {
      var rows = await list();
      els.list.innerHTML = '';
      rows.forEach(function (f) {
        var li = document.createElement('li'), a = document.createElement('span'), b = document.createElement('span');
        a.textContent = f.name; b.textContent = kb(f.size_bytes); li.appendChild(a); li.appendChild(b); els.list.appendChild(li);
      });
      els.waiting.textContent = rows.length ? 'Waiting from Citrix, kept until ' + when(rows[0].expires_at) + ':' : 'Nothing is waiting from Citrix.';
      els.imp.disabled = !rows.length; els.del.hidden = !rows.length;
      els.dot.hidden = !rows.length; els.dot.textContent = rows.length;
    } catch (e) { els.waiting.textContent = errMsg(e); els.imp.disabled = true; }
  }

  window.LVDHandoff = { send: send, list: list, importFiles: importFiles, clear: clear, open: function () { toggle(true); } };
  function boot() { build(); refresh(); setInterval(function () { if (!document.hidden) refresh(); }, 120000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
