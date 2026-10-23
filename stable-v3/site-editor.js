/* EVE visual editor: layout and text overrides stored in Supabase. */
(function () {
  "use strict";
  const SUPABASE_URL = "https://hszkloepnewfkzdegfhl.supabase.co";
  const SUPABASE_KEY = "sb_publishable_Avjn-CGtbEdeLaxSWCwQDw_36mgImSu";
  const pagePath = location.pathname.replace(/\/$/, "") || "/index.html";
  const pageKey = pagePath === "/" ? "/index.html" : pagePath;
  const clientReady = () => window.supabase && window.supabase.createClient;
  const css = `
    #eve-editor-bar{position:fixed;z-index:10000;bottom:14px;right:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#09284b;color:#fff;padding:10px 12px;border-radius:12px;box-shadow:0 8px 32px #001a3344;font:600 13px Arial;max-width:calc(100vw - 28px)}
    #eve-editor-bar button{border:0;border-radius:7px;padding:9px 12px;background:#fff;color:#09284b;font-weight:700;cursor:pointer}
    #eve-editor-bar button.primary{background:#56a0df;color:#fff}#eve-editor-status{font-weight:400;font-size:12px}
    .eve-editable{outline:2px dashed #3a8ed0!important;outline-offset:3px;cursor:text}
    [data-eve-drag-item].eve-dragging{opacity:.45;outline:2px dashed #3a8ed0}
    [data-eve-drop-zone].eve-drop-target{outline:2px dashed #3a8ed0;outline-offset:5px}
    .eve-order-controls{display:none;gap:5px;align-items:center;flex-wrap:wrap;margin:0 0 12px;padding:7px;background:#e8f3fc;border:1px solid #9cc9ed;border-radius:7px;position:relative;z-index:2}
    .eve-order-controls button{border:1px solid #8db8dc;border-radius:5px;background:#fff;color:#09284b;padding:5px 9px;font:700 12px Arial;cursor:pointer}
    .eve-order-controls button:disabled{opacity:.35;cursor:not-allowed}
    [data-eve-drag-item].eve-dragging{opacity:.45}
    #eve-editor-hint{position:fixed;z-index:9999;bottom:80px;right:14px;background:#fff;color:#09284b;padding:12px 15px;border-radius:9px;box-shadow:0 4px 24px #001a3322;max-width:320px;font:13px/1.5 Arial}
    @media(max-width:600px){#eve-editor-bar{left:10px;right:10px;bottom:10px;justify-content:center}#eve-editor-status{width:100%;text-align:center}}
  `;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  let supabase, config = { texts: {}, orders: {} }, adminMode = false, dirty = false;
  const $ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const stableId = (prefix, index) => prefix + "-" + index;
  function assignEditorIds() {
    let n = 0;
    $("h1,h2,h3,h4,p,small,li,label,figcaption,blockquote").forEach(el => {
      if (el.closest("#eve-editor-bar,#eve-editor-hint,script,style,nav,footer") || !el.textContent.trim()) return;
      if (el.querySelector("h1,h2,h3,h4,p,li")) return;
      el.dataset.eveTextId = stableId("text", n++);
    });
    let c = 0, i = 0;
    const candidates = $("main, main section, main > div, .tools-grid, .service-grid, .commit-grid, .tool-card, .service-card, .commit-grid article, .contact > div");
    candidates.forEach(el => {
      if (el.closest("#eve-editor-bar,#eve-editor-hint")) return;
      if (el.matches(".tools-grid,.service-grid,.commit-grid,main") || el.matches("main > section, main > div")) {
        if (!el.dataset.eveContainerId) el.dataset.eveContainerId = stableId("container", c++);
        Array.from(el.children).forEach(child => {
          if (child.matches("section,article,.tool-card,.service-card") || child.parentElement === el && el.matches(".tools-grid,.service-grid,.commit-grid")) {
            if (!child.dataset.eveItemId) child.dataset.eveItemId = stableId("block", i++);
            child.dataset.eveDragItem = "true";
          }
        });
      }
    });
  }
  function applyConfig() {
    Object.entries(config.texts || {}).forEach(([id, value]) => {
      const el = document.querySelector('[data-eve-text-id="' + id + '"]');
      if (el && typeof value === "string") el.textContent = value;
    });
    Object.entries(config.orders || {}).forEach(([id, ids]) => {
      const parent = document.querySelector('[data-eve-container-id="' + id + '"]');
      if (!parent || !Array.isArray(ids)) return;
      ids.forEach(itemId => {
        const child = document.querySelector('[data-eve-item-id="' + itemId + '"]');
        if (child && child.parentElement === parent) parent.appendChild(child);
      });
    });
  }
  function snapshot() {
    const texts = {};
    $("[data-eve-text-id]").forEach(el => { texts[el.dataset.eveTextId] = el.textContent; });
    const orders = {};
    $("[data-eve-container-id]").forEach(parent => {
      orders[parent.dataset.eveContainerId] = Array.from(parent.children).filter(el => el.dataset.eveItemId).map(el => el.dataset.eveItemId);
    });
    return { texts, orders };
  }
  function markDirty() { dirty = true; const status = document.getElementById("eve-editor-status"); if(status) status.textContent = "Unsaved changes"; }
  function refreshOrderControls() {
    $("[data-eve-drag-item]").forEach(el => {
      let controls = el.querySelector(":scope > .eve-order-controls");
      if (!controls) {
        controls = document.createElement("div");
        controls.className = "eve-order-controls";
        controls.setAttribute("contenteditable", "false");
        controls.innerHTML = '<button type="button" data-eve-move="earlier" aria-label="Move block earlier">↑ Move earlier</button><button type="button" data-eve-move="later" aria-label="Move block later">↓ Move later</button>';
        el.insertBefore(controls, el.firstChild);
        controls.addEventListener("click", event => {
          const button = event.target.closest("button[data-eve-move]");
          if (!button) return;
          event.preventDefault();
          event.stopPropagation();
          const siblings = Array.from(el.parentElement.children).filter(item => item.hasAttribute("data-eve-drag-item"));
          const index = siblings.indexOf(el);
          if (button.dataset.eveMove === "earlier" && index > 0) {
            el.parentElement.insertBefore(el, siblings[index - 1]);
          } else if (button.dataset.eveMove === "later" && index >= 0 && index < siblings.length - 1) {
            el.parentElement.insertBefore(siblings[index + 1], el);
          }
          markDirty();
          refreshOrderControls();
        });
      }
      controls.style.display = adminMode ? "flex" : "none";
      const siblings = Array.from(el.parentElement.children).filter(item => item.hasAttribute("data-eve-drag-item"));
      const index = siblings.indexOf(el);
      const earlier = controls.querySelector('[data-eve-move="earlier"]');
      const later = controls.querySelector('[data-eve-move="later"]');
      if (earlier) earlier.disabled = index <= 0;
      if (later) later.disabled = index < 0 || index >= siblings.length - 1;
    });
  }
  function setEditable(on) {
    adminMode = on;
    refreshOrderControls();
    $("[data-eve-text-id]").forEach(el => {
      el.contentEditable = on ? "true" : "false";
      el.classList.toggle("eve-editable", on);
      el.oninput = on ? markDirty : null;
      el.title = on ? "Click to edit this text" : "";
    });
    $("[data-eve-drag-item]").forEach(el => {
      el.draggable = on;
      el.style.cursor = on ? "grab" : "";
      el.ondragstart = on ? e => { if (e.target.closest(".eve-order-controls")) { e.preventDefault(); return; } e.dataTransfer.setData("text/plain", el.dataset.eveItemId); e.dataTransfer.effectAllowed = "move"; el.classList.add("eve-dragging"); } : null;
      el.ondragend = on ? () => { el.classList.remove("eve-dragging"); $("[data-eve-drop-zone]").forEach(x=>x.classList.remove("eve-drop-target")); } : null;
      el.ondragover = on ? e => { if(el.parentElement.querySelector("[data-eve-drag-item].eve-dragging")) { e.preventDefault(); el.classList.add("eve-drop-target"); } } : null;
      el.ondragleave = on ? () => el.classList.remove("eve-drop-target") : null;
      el.ondrop = on ? e => {
        e.preventDefault(); el.classList.remove("eve-drop-target");
        const movingId = e.dataTransfer.getData("text/plain");
        const moving = document.querySelector('[data-eve-item-id="' + movingId + '"]');
        if (!moving || moving === el || moving.parentElement !== el.parentElement) return;
        const rect = el.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        el.parentElement.insertBefore(moving, after ? el.nextSibling : el);
        markDirty();
        refreshOrderControls();
      } : null;
    });
  }
  function addBar() {
    const bar = document.createElement("div"); bar.id = "eve-editor-bar";
    bar.innerHTML = '<span><strong>EVE Website Editor</strong></span><span id="eve-editor-status">Ready</span><button id="eve-edit-toggle" class="primary">Edit page</button><button id="eve-save">Save changes</button><button id="eve-discard">Discard</button><button id="eve-logout">Log out</button>';
    document.body.appendChild(bar);
    const hint = document.createElement("div"); hint.id="eve-editor-hint"; hint.textContent="Click highlighted text to edit. Use the Move earlier / Move later buttons on highlighted blocks, or drag blocks to reorder them."; hint.hidden=true; document.body.appendChild(hint);
    document.getElementById("eve-edit-toggle").onclick = () => {
      setEditable(!adminMode); hint.hidden = !adminMode;
      document.getElementById("eve-edit-toggle").textContent = adminMode ? "Finish editing" : "Edit page";
      document.getElementById("eve-editor-status").textContent = adminMode ? "Editing — changes not yet saved" : (dirty ? "Unsaved changes" : "Viewing");
    };
    document.getElementById("eve-save").onclick = async () => {
      if (!adminMode) { alert("Select Edit page before making changes."); return; }
      const result = await supabase.from("website_page_content").upsert({page_path:pageKey,content:snapshot(),updated_by:(await supabase.auth.getUser()).data.user.id,updated_at:new Date().toISOString()});
      if(result.error){document.getElementById("eve-editor-status").textContent="Save failed";alert("Could not save changes: "+result.error.message);return;}
      config=snapshot();dirty=false;document.getElementById("eve-editor-status").textContent="Saved successfully";
    };
    document.getElementById("eve-discard").onclick = () => { if(!confirm("Discard unsaved changes and reload the last saved layout?"))return; location.reload(); };
    document.getElementById("eve-logout").onclick = async () => { await supabase.auth.signOut(); location.href="/stable-v3/admin.html"; };
  }
  async function start() {
    if(!clientReady()) return;
    supabase = window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
    const {data:{session}} = await supabase.auth.getSession();
    if(!session) return;
    const {data:profile,error:profileError}=await supabase.from("profiles").select("role,email").eq("id",session.user.id).maybeSingle();
    if(profileError || !profile || String(profile.role).toLowerCase()!=="admin" || session.user.email.toLowerCase()!=="admin@evedesignandengineering.com") return;
    const {data,error}=await supabase.from("website_page_content").select("content").eq("page_path",pageKey).maybeSingle();
    if(!error && data && data.content) config=data.content;
    assignEditorIds(); applyConfig(); addBar();
  }
  function loadSupabaseAndStart() {
    if (clientReady()) { start(); return; }
    const loader = document.createElement("script");
    loader.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    loader.onload = start;
    loader.onerror = () => console.warn("EVE editor: Supabase client could not be loaded.");
    document.head.appendChild(loader);
  }
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", loadSupabaseAndStart);
  else loadSupabaseAndStart();
})();