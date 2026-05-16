/* ==========================================================
   My To-do List — multi-user portal backed by Supabase.
   ========================================================== */
(() => {
  const CONFIG_KEY = "todo.supabase.config.v1";

  const STATUS_OPTIONS = ["To Do", "Doing", "Done 🙌", "Routine Task", "BOD Release", "Today List", "Pending Approval"];
  const PRIORITY_OPTIONS = ["High", "Medium", "Low"];
  const DURATION_OPTIONS = ["Short", "Mid", "Long"];

  const STATUS_COLOR = {
    "To Do": "red",
    "Doing": "yellow",
    "Done 🙌": "green",
    "Routine Task": "blue",
    "BOD Release": "gray",
    "Today List": "default",
    "Pending Approval": "orange",
  };
  const PRIORITY_COLOR = { High: "red", Medium: "yellow", Low: "green" };
  const DURATION_COLOR = { Long: "purple", Mid: "yellow", Short: "red" };

  const STATUS_RANK = { "To Do": 0, "Doing": 1, "Pending Approval": 2, "Today List": 3, "Routine Task": 4, "BOD Release": 5, "Done 🙌": 6 };
  const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
  const DURATION_RANK = { Short: 0, Mid: 1, Long: 2 };

  // ---------------------- DOM helpers ----------------------
  const $ = (id) => document.getElementById(id);
  const show = (el) => { el.hidden = false; };
  const hide = (el) => { el.hidden = true; };
  const escapeAttr = (s) => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");

  // ---------------------- App state ----------------------
  const state = {
    sb: null,
    session: null,
    me: null,                 // profile row
    profiles: new Map(),      // id -> profile
    tasks: [],
    view: "mine",
    filters: { status: "open", priority: "", duration: "", search: "" },
    sort: "default",
    currentTaskId: null,
    detailTab: "timeline",
    events: [],
    comments: [],
    realtimeChannel: null,
  };

  // ---------------------- Config (Supabase URL + key) ----------------------
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch { return null; }
  }
  function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
  function clearConfig() { localStorage.removeItem(CONFIG_KEY); }

  function showConfigScreen(msg) {
    hide($("auth-screen")); hide($("app-screen")); show($("config-screen"));
    if (msg) $("cfg-helper").textContent = msg;
  }
  function showAuthScreen() {
    hide($("config-screen")); hide($("app-screen")); show($("auth-screen"));
  }
  function showAppScreen() {
    hide($("config-screen")); hide($("auth-screen")); show($("app-screen"));
  }

  $("config-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("cfg-url").value.trim();
    const key = $("cfg-key").value.trim();
    if (!url || !key) return;
    saveConfig({ url, key });
    initSupabase(url, key);
  });

  $("reset-config").addEventListener("click", () => { clearConfig(); showConfigScreen(); });
  $("reset-config-app").addEventListener("click", () => {
    if (!confirm("Disconnect from this Supabase project? You'll need to sign in again.")) return;
    cleanupRealtime();
    clearConfig();
    location.reload();
  });

  // ---------------------- Supabase init ----------------------
  function initSupabase(url, key) {
    try {
      state.sb = window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: `sb-${new URL(url).host}` },
      });
    } catch (e) {
      showConfigScreen("Could not connect. Check the URL.");
      return;
    }
    const dom = (() => { try { return new URL(url).host; } catch { return "Supabase"; } })();
    $("cfg-domain").textContent = dom;

    state.sb.auth.onAuthStateChange((_event, session) => {
      state.session = session || null;
      handleAuthChange();
    });
    state.sb.auth.getSession().then(({ data }) => {
      state.session = data?.session || null;
      handleAuthChange();
    });
  }

  async function handleAuthChange() {
    if (!state.session) {
      cleanupRealtime();
      showAuthScreen();
      return;
    }
    await bootstrapApp();
  }

  async function bootstrapApp() {
    try {
      await loadProfile();
      await loadProfiles();
      await loadTasks();
      subscribeRealtime();
      paintMe();
      render();
      showAppScreen();
    } catch (e) {
      console.error(e);
      alert("Failed to load data: " + (e.message || e));
    }
  }

  // ---------------------- Auth UI ----------------------
  let authMode = "signin";
  document.querySelectorAll(".auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      authMode = btn.dataset.mode;
      document.querySelectorAll(".auth-tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".auth-signup-only").forEach((el) => { el.hidden = authMode !== "signup"; });
      $("auth-submit").textContent = authMode === "signup" ? "Create account" : "Sign in";
      $("auth-helper").textContent = "";
    });
  });

  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const displayName = $("auth-name").value.trim();
    const helper = $("auth-helper");
    helper.textContent = "";
    helper.style.color = "";
    try {
      if (authMode === "signup") {
        const { data, error } = await state.sb.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName || email.split("@")[0] } },
        });
        if (error) throw error;
        if (!data.session) {
          helper.style.color = "var(--muted)";
          helper.textContent = "Account created. Check your inbox to confirm, then sign in.";
        }
      } else {
        const { error } = await state.sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      helper.textContent = err.message || String(err);
    }
  });

  $("logout").addEventListener("click", async () => {
    cleanupRealtime();
    await state.sb.auth.signOut();
  });

  // ---------------------- Data loading ----------------------
  async function loadProfile() {
    const uid = state.session.user.id;
    let { data, error } = await state.sb.from("profiles").select("*").eq("id", uid).maybeSingle();
    if (error) throw error;
    if (!data) {
      // Fallback in case the signup trigger didn't run yet.
      const { error: insErr } = await state.sb.from("profiles").insert({
        id: uid,
        email: state.session.user.email,
        display_name: state.session.user.user_metadata?.display_name || state.session.user.email.split("@")[0],
      });
      if (insErr) throw insErr;
      ({ data } = await state.sb.from("profiles").select("*").eq("id", uid).maybeSingle());
    }
    state.me = data;
  }

  async function loadProfiles() {
    const { data, error } = await state.sb.from("profiles").select("id, email, display_name, role");
    if (error) throw error;
    state.profiles.clear();
    for (const p of data || []) state.profiles.set(p.id, p);
  }

  async function loadTasks() {
    const { data, error } = await state.sb.from("tasks").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    state.tasks = data || [];
  }

  async function loadEvents(taskId) {
    const { data, error } = await state.sb
      .from("task_events")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    state.events = data || [];
  }

  async function loadComments(taskId) {
    const { data, error } = await state.sb
      .from("task_comments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    state.comments = data || [];
  }

  // ---------------------- Realtime ----------------------
  function subscribeRealtime() {
    cleanupRealtime();
    const ch = state.sb
      .channel("todo-portal")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadTasks().then(render))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_events" }, (payload) => {
        if (state.currentTaskId && payload.new && payload.new.task_id === state.currentTaskId) {
          loadEvents(state.currentTaskId).then(renderTimeline);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, (payload) => {
        const tid = (payload.new || payload.old || {}).task_id;
        if (state.currentTaskId && tid === state.currentTaskId) {
          loadComments(state.currentTaskId).then(renderComments);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadProfiles().then(render));
    ch.subscribe();
    state.realtimeChannel = ch;
  }

  function cleanupRealtime() {
    if (state.realtimeChannel) {
      try { state.sb.removeChannel(state.realtimeChannel); } catch {}
      state.realtimeChannel = null;
    }
  }

  // ---------------------- Permissions ----------------------
  const isManager = () => state.me?.role === "manager";
  const myId = () => state.me?.id;
  const canEditTask = (t) => !!t && (isManager() || t.owner_id === myId() || t.created_by === myId());
  const canDeleteTask = (t) => !!t && (isManager() || t.created_by === myId());

  // ---------------------- Render: main app ----------------------
  function paintMe() {
    $("user-name").textContent = state.me.display_name || state.me.email || "—";
    const roleEl = $("user-role");
    roleEl.textContent = isManager() ? "Manager" : "Member";
    roleEl.className = `pill ${isManager() ? "blue" : "default"}`;
    document.querySelectorAll(".manager-only").forEach((el) => { el.hidden = !isManager(); });
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    $("col-owner").style.display = view === "mine" ? "none" : "";
    render();
  }

  function getFiltered() {
    const { search, status, priority, duration } = state.filters;
    const term = search.trim().toLowerCase();
    return state.tasks.filter((t) => {
      if (state.view === "approvals") {
        if (t.status !== "Pending Approval") return false;
      } else if (state.view === "mine") {
        if (t.owner_id !== myId() && t.created_by !== myId()) return false;
      } else if (state.view === "team") {
        if (t.scope !== "team") return false;
      }
      // status filter
      if (state.view !== "approvals") {
        if (status === "open") {
          if (t.status !== "To Do" && t.status !== "Doing") return false;
        } else if (status && t.status !== status) {
          return false;
        }
      }
      if (priority && t.priority !== priority) return false;
      if (duration && t.duration !== duration) return false;
      if (term) {
        const ownerName = (state.profiles.get(t.owner_id)?.display_name || "").toLowerCase();
        if (!t.name.toLowerCase().includes(term) && !ownerName.includes(term)) return false;
      }
      return true;
    });
  }

  function sortTasks(tasks) {
    const copy = [...tasks];
    if (state.sort === "date") {
      copy.sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31"));
    } else if (state.sort === "name") {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (state.sort === "created") {
      copy.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    } else {
      copy.sort((a, b) => {
        const sa = STATUS_RANK[a.status] ?? 99;
        const sb = STATUS_RANK[b.status] ?? 99;
        if (sa !== sb) return sa - sb;
        const pa = PRIORITY_RANK[a.priority] ?? 99;
        const pb = PRIORITY_RANK[b.priority] ?? 99;
        if (pa !== pb) return pa - pb;
        return (DURATION_RANK[a.duration] ?? 99) - (DURATION_RANK[b.duration] ?? 99);
      });
    }
    return copy;
  }

  function formatDate(date) {
    if (!date) return { text: "—", className: "" };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(date + "T00:00:00");
    const diff = Math.round((d - today) / 86400000);
    const fmt = new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric",
      year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
    const text = fmt.format(d);
    if (diff < 0) return { text: `${text} (overdue)`, className: "overdue" };
    if (diff === 0) return { text: `${text} · Today`, className: "soon" };
    if (diff === 1) return { text: `${text} · Tomorrow`, className: "soon" };
    if (diff <= 3) return { text, className: "soon" };
    return { text, className: "" };
  }

  function pill(value, color) {
    const span = document.createElement("span");
    span.className = `pill ${color || "default"}`;
    span.textContent = value;
    return span;
  }

  function ownerName(id) {
    return state.profiles.get(id)?.display_name || state.profiles.get(id)?.email || "—";
  }

  function render() {
    const filtered = sortTasks(getFiltered());
    const rows = $("task-rows");
    rows.innerHTML = "";
    if (filtered.length === 0) {
      $("empty-state").classList.remove("hidden");
    } else {
      $("empty-state").classList.add("hidden");
      for (const t of filtered) rows.appendChild(renderRow(t));
    }
    renderStats();
    renderApprovalBadge();
  }

  function renderRow(t) {
    const tr = document.createElement("tr");
    if (t.status === "Done 🙌") tr.classList.add("done");
    tr.dataset.id = t.id;

    const cellCheck = document.createElement("td");
    cellCheck.className = "col-check";
    if (canEditTask(t)) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "task-check";
      cb.checked = t.status === "Done 🙌";
      cb.title = isManager() ? "Toggle done" : "Mark complete (requests manager approval)";
      cb.addEventListener("change", async () => {
        if (cb.checked) {
          if (isManager()) await directlyClose(t);
          else await requestClose(t);
        } else {
          await reopenTask(t);
        }
      });
      cellCheck.appendChild(cb);
    }

    const cellName = document.createElement("td");
    cellName.className = "col-name";
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "task-name";
    nameBtn.textContent = t.name;
    nameBtn.addEventListener("click", () => openDetail(t.id));
    cellName.appendChild(nameBtn);

    const cellStatus = document.createElement("td");
    cellStatus.appendChild(pill(t.status, STATUS_COLOR[t.status]));

    const cellPriority = document.createElement("td");
    cellPriority.appendChild(pill(t.priority, PRIORITY_COLOR[t.priority]));

    const cellDuration = document.createElement("td");
    cellDuration.appendChild(pill(t.duration, DURATION_COLOR[t.duration]));

    const cellDate = document.createElement("td");
    const d = formatDate(t.date);
    const ds = document.createElement("span");
    ds.className = `date-text ${d.className}`;
    ds.textContent = d.text;
    cellDate.appendChild(ds);

    const cellOwner = document.createElement("td");
    cellOwner.style.display = state.view === "mine" ? "none" : "";
    const os = document.createElement("span");
    os.className = "owner-text";
    os.textContent = ownerName(t.owner_id);
    cellOwner.appendChild(os);

    const cellActions = document.createElement("td");
    cellActions.className = "col-actions";
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    if (canEditTask(t)) {
      const editBtn = document.createElement("button");
      editBtn.className = "icon-btn"; editBtn.type = "button"; editBtn.title = "Edit";
      editBtn.textContent = "✏️";
      editBtn.addEventListener("click", () => openForm(t.id));
      wrap.appendChild(editBtn);
    }
    if (canDeleteTask(t)) {
      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn"; delBtn.type = "button"; delBtn.title = "Delete";
      delBtn.textContent = "🗑";
      delBtn.addEventListener("click", () => removeTask(t.id));
      wrap.appendChild(delBtn);
    }
    cellActions.appendChild(wrap);

    tr.append(cellCheck, cellName, cellStatus, cellPriority, cellDuration, cellDate, cellOwner, cellActions);
    return tr;
  }

  function renderStats() {
    const inScope = (t) => {
      if (state.view === "all") return true;
      if (state.view === "approvals") return t.status === "Pending Approval";
      if (state.view === "team") return t.scope === "team";
      return t.owner_id === myId() || t.created_by === myId();
    };
    $("stat-todo").textContent = state.tasks.filter((t) => inScope(t) && t.status === "To Do").length;
    $("stat-doing").textContent = state.tasks.filter((t) => inScope(t) && t.status === "Doing").length;
    $("stat-done").textContent = state.tasks.filter((t) => inScope(t) && t.status === "Done 🙌").length;
  }

  function renderApprovalBadge() {
    if (!isManager()) return;
    const n = state.tasks.filter((t) => t.status === "Pending Approval").length;
    const badge = $("approval-badge");
    if (n > 0) { badge.textContent = n; badge.hidden = false; }
    else { badge.hidden = true; }
  }

  // ---------------------- New / edit form ----------------------
  function populateOwnerOptions(selectedId) {
    const sel = $("f-owner");
    sel.innerHTML = "";
    const profs = [...state.profiles.values()].sort((a, b) =>
      (a.display_name || "").localeCompare(b.display_name || "")
    );
    for (const p of profs) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.display_name || p.email}${p.id === myId() ? " (me)" : ""}`;
      if (p.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function openForm(id) {
    state.editingId = id || null;
    $("form-helper").textContent = "";
    if (id) {
      const t = state.tasks.find((t) => t.id === id);
      if (!t) return;
      $("form-title").textContent = "Edit task";
      $("task-id").value = t.id;
      $("f-name").value = t.name;
      $("f-status").value = t.status === "Pending Approval" ? "Doing" : t.status;
      $("f-priority").value = t.priority;
      $("f-duration").value = t.duration;
      $("f-date").value = t.date || "";
      $("f-scope").value = t.scope;
      populateOwnerOptions(t.owner_id || myId());
    } else {
      $("form-title").textContent = "New task";
      $("task-form").reset();
      $("task-id").value = "";
      $("f-status").value = "To Do";
      $("f-priority").value = "Medium";
      $("f-duration").value = "Mid";
      $("f-scope").value = state.view === "mine" ? "mine" : "team";
      populateOwnerOptions(myId());
    }
    show($("form-modal"));
    setTimeout(() => $("f-name").focus(), 50);
  }

  function closeForm() {
    hide($("form-modal"));
    state.editingId = null;
  }

  $("form-modal").addEventListener("click", (e) => {
    if (e.target.matches("[data-close]")) closeForm();
  });

  $("new-task").addEventListener("click", () => openForm());

  $("task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const helper = $("form-helper");
    helper.textContent = "";
    const name = $("f-name").value.trim();
    if (!name) { helper.textContent = "Name is required."; return; }
    const payload = {
      name,
      status: $("f-status").value,
      priority: $("f-priority").value,
      duration: $("f-duration").value,
      date: $("f-date").value || null,
      scope: $("f-scope").value,
      owner_id: $("f-owner").value || myId(),
    };
    try {
      if (state.editingId) {
        const before = state.tasks.find((t) => t.id === state.editingId);
        const { error } = await state.sb.from("tasks").update(payload).eq("id", state.editingId);
        if (error) throw error;
        if (before && before.status !== payload.status) {
          await logEvent(state.editingId, "status_changed", before.status, payload.status);
        }
      } else {
        const { data, error } = await state.sb.from("tasks")
          .insert({ ...payload, created_by: myId() })
          .select()
          .single();
        if (error) throw error;
        await logEvent(data.id, "created", null, payload.status, null);
      }
      closeForm();
      await loadTasks();
      render();
    } catch (err) {
      helper.textContent = err.message || String(err);
    }
  });

  // ---------------------- Task actions ----------------------
  async function logEvent(taskId, type, from, to, note) {
    const { error } = await state.sb.from("task_events").insert({
      task_id: taskId, author_id: myId(), type, from_value: from, to_value: to, note: note || null,
    });
    if (error) throw error;
  }

  async function requestClose(task) {
    if (!confirm(`Request to close "${task.name}"? It will go to the manager for approval.`)) {
      render();
      return;
    }
    try {
      const { error } = await state.sb.from("tasks")
        .update({ status: "Pending Approval" })
        .eq("id", task.id);
      if (error) throw error;
      await logEvent(task.id, "close_requested", task.status, "Pending Approval");
      await loadTasks();
      if (state.currentTaskId === task.id) await refreshDetail();
      render();
    } catch (err) {
      alert("Could not request close: " + err.message);
      render();
    }
  }

  async function directlyClose(task) {
    try {
      const { error } = await state.sb.from("tasks")
        .update({ status: "Done 🙌", closed_at: new Date().toISOString() })
        .eq("id", task.id);
      if (error) throw error;
      await logEvent(task.id, "status_changed", task.status, "Done 🙌");
      await loadTasks();
      render();
    } catch (err) {
      alert("Could not close: " + err.message);
    }
  }

  async function reopenTask(task) {
    try {
      const { error } = await state.sb.from("tasks")
        .update({ status: "Doing", closed_at: null })
        .eq("id", task.id);
      if (error) throw error;
      await logEvent(task.id, "reopened", task.status, "Doing");
      await loadTasks();
      render();
    } catch (err) {
      alert("Could not reopen: " + err.message);
    }
  }

  async function approveTask(task) {
    const note = prompt("Approve and close. Add a note (optional):") || "";
    try {
      const { error } = await state.sb.from("tasks")
        .update({ status: "Done 🙌", closed_at: new Date().toISOString() })
        .eq("id", task.id);
      if (error) throw error;
      await logEvent(task.id, "approved", "Pending Approval", "Done 🙌", note);
      await loadTasks();
      if (state.currentTaskId === task.id) await refreshDetail();
      render();
    } catch (err) {
      alert("Could not approve: " + err.message);
    }
  }

  async function rejectTask(task) {
    const note = prompt("Reject close request. Add a reason:") || "";
    try {
      const { error } = await state.sb.from("tasks")
        .update({ status: "Doing" })
        .eq("id", task.id);
      if (error) throw error;
      await logEvent(task.id, "rejected", "Pending Approval", "Doing", note);
      await loadTasks();
      if (state.currentTaskId === task.id) await refreshDetail();
      render();
    } catch (err) {
      alert("Could not reject: " + err.message);
    }
  }

  async function removeTask(id) {
    if (!confirm("Delete this task and its history?")) return;
    const { error } = await state.sb.from("tasks").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    if (state.currentTaskId === id) closeDetail();
    await loadTasks();
    render();
  }

  // ---------------------- Detail panel ----------------------
  async function openDetail(taskId) {
    state.currentTaskId = taskId;
    state.detailTab = "timeline";
    show($("detail-modal"));
    setDetailTab("timeline");
    await refreshDetail();
  }

  function closeDetail() {
    hide($("detail-modal"));
    state.currentTaskId = null;
    state.events = [];
    state.comments = [];
  }

  $("detail-modal").addEventListener("click", (e) => {
    if (e.target.matches("[data-close]")) closeDetail();
  });

  document.querySelectorAll(".detail-tab").forEach((btn) => {
    btn.addEventListener("click", () => setDetailTab(btn.dataset.tab));
  });

  function setDetailTab(tab) {
    state.detailTab = tab;
    document.querySelectorAll(".detail-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("pane-timeline").hidden = tab !== "timeline";
    $("pane-comments").hidden = tab !== "comments";
  }

  async function refreshDetail() {
    const t = state.tasks.find((x) => x.id === state.currentTaskId);
    if (!t) { closeDetail(); return; }
    $("detail-title").textContent = t.name;
    renderDetailProps(t);
    renderDetailActions(t);
    await Promise.all([loadEvents(t.id).then(renderTimeline), loadComments(t.id).then(renderComments)]);
  }

  function renderDetailProps(t) {
    const wrap = $("detail-props");
    wrap.innerHTML = "";
    const items = [
      ["🏷️ Status", pill(t.status, STATUS_COLOR[t.status])],
      ["🚩 Priority", pill(t.priority, PRIORITY_COLOR[t.priority])],
      ["⏱ Task Duration", pill(t.duration, DURATION_COLOR[t.duration])],
      ["📅 Date", textNode(formatDate(t.date).text)],
      ["👤 Owner", textNode(ownerName(t.owner_id))],
      ["👥 Scope", pill(t.scope === "team" ? "Team" : "Personal", t.scope === "team" ? "green" : "blue")],
      ["📝 Created by", textNode(ownerName(t.created_by))],
    ];
    for (const [label, val] of items) {
      const cell = document.createElement("div");
      cell.className = "detail-prop";
      const lab = document.createElement("span"); lab.className = "prop-name"; lab.textContent = label;
      const v = document.createElement("span"); v.className = "prop-val"; v.appendChild(val);
      cell.append(lab, v);
      wrap.appendChild(cell);
    }
  }

  function textNode(text) { const s = document.createElement("span"); s.textContent = text; return s; }

  function renderDetailActions(t) {
    const wrap = $("detail-actions");
    wrap.innerHTML = "";

    if (t.status === "Pending Approval" && isManager()) {
      const a = btn("Approve & close", "success-btn", () => approveTask(t));
      const r = btn("Reject", "danger-btn", () => rejectTask(t));
      wrap.append(a, r);
    }

    if (canEditTask(t)) {
      wrap.append(btn("Edit properties", "ghost", () => openForm(t.id)));
    }

    if (t.status !== "Done 🙌" && t.status !== "Pending Approval" && canEditTask(t)) {
      if (isManager()) {
        wrap.append(btn("Mark done", "primary", () => directlyClose(t)));
      } else {
        wrap.append(btn("Request to close", "primary", () => requestClose(t)));
      }
    }

    if (t.status === "Done 🙌" && canEditTask(t)) {
      wrap.append(btn("Reopen", "ghost", () => reopenTask(t)));
    }

    if (!canEditTask(t)) {
      const msg = document.createElement("div");
      msg.className = "locked-msg";
      msg.textContent = "You can read this task and comment, but only the owner or a manager can edit it.";
      wrap.appendChild(msg);
    }
  }

  function btn(label, cls, onClick) {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---------------------- Timeline ----------------------
  function renderTimeline() {
    const list = $("timeline-list");
    list.innerHTML = "";
    const t = state.tasks.find((x) => x.id === state.currentTaskId);
    if (!t) return;
    $("progress-form").style.display = canEditTask(t) ? "" : "none";

    for (const e of state.events) list.appendChild(renderEvent(e));
    if (state.events.length === 0) {
      const li = document.createElement("li");
      li.style.color = "var(--muted)";
      li.style.fontStyle = "italic";
      li.textContent = "No history yet.";
      list.appendChild(li);
    }
  }

  function renderEvent(e) {
    const li = document.createElement("li");
    const cls = e.type === "created" ? "evt-created"
      : e.type === "status_changed" ? "evt-status"
      : e.type === "progress" ? "evt-progress"
      : e.type === "close_requested" ? "evt-close"
      : e.type === "approved" ? "evt-approved"
      : e.type === "rejected" ? "evt-rejected"
      : e.type === "reopened" ? "evt-reopened" : "evt-progress";
    li.className = cls;

    const head = document.createElement("div");
    head.className = "evt-head";
    const author = document.createElement("span");
    author.className = "evt-author";
    author.textContent = ownerName(e.author_id);
    const action = document.createElement("span");
    action.textContent = " " + describeEvent(e);
    const time = document.createElement("span");
    time.className = "evt-time";
    time.textContent = " · " + formatTime(e.created_at);
    head.append(author, action, time);
    li.appendChild(head);

    if (e.note) {
      const note = document.createElement("p");
      note.className = "evt-note";
      note.textContent = e.note;
      li.appendChild(note);
    }
    return li;
  }

  function describeEvent(e) {
    switch (e.type) {
      case "created": return `created this task as “${e.to_value}”`;
      case "status_changed": return `changed status: ${e.from_value || "?"} → ${e.to_value || "?"}`;
      case "progress": return `posted a progress update`;
      case "close_requested": return `requested to close the task`;
      case "approved": return `approved and closed the task`;
      case "rejected": return `rejected the close request`;
      case "reopened": return `reopened the task`;
      default: return e.type;
    }
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric",
      year: sameYear ? undefined : "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(d);
  }

  $("progress-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("progress-input").value.trim();
    if (!text || !state.currentTaskId) return;
    try {
      await logEvent(state.currentTaskId, "progress", null, null, text);
      $("progress-input").value = "";
      await loadEvents(state.currentTaskId);
      renderTimeline();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------------------- Comments ----------------------
  function renderComments() {
    const list = $("comments-list");
    list.innerHTML = "";
    for (const c of state.comments) list.appendChild(renderComment(c));
    if (state.comments.length === 0) {
      const li = document.createElement("li");
      li.style.color = "var(--muted)";
      li.style.fontStyle = "italic";
      li.textContent = "No comments yet.";
      list.appendChild(li);
    }
  }

  function renderComment(c) {
    const li = document.createElement("li");
    li.className = "comment";
    const head = document.createElement("div");
    head.className = "comment-head";
    const author = document.createElement("span");
    author.className = "comment-author";
    author.textContent = ownerName(c.author_id);
    const meta = document.createElement("span");
    meta.textContent = formatTime(c.created_at);
    head.append(author, meta);

    const body = document.createElement("div");
    body.className = "comment-body";
    body.textContent = c.body;

    li.append(head, body);

    if (c.author_id === myId() || isManager()) {
      const del = document.createElement("button");
      del.className = "comment-delete";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        if (!confirm("Delete this comment?")) return;
        const { error } = await state.sb.from("task_comments").delete().eq("id", c.id);
        if (error) { alert(error.message); return; }
        await loadComments(state.currentTaskId);
        renderComments();
      });
      li.appendChild(del);
    }
    return li;
  }

  $("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("comment-input").value.trim();
    if (!body || !state.currentTaskId) return;
    const { error } = await state.sb.from("task_comments").insert({
      task_id: state.currentTaskId, author_id: myId(), body,
    });
    if (error) { alert(error.message); return; }
    $("comment-input").value = "";
    await loadComments(state.currentTaskId);
    renderComments();
  });

  // ---------------------- Toolbar wiring ----------------------
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
  $("search").addEventListener("input", (e) => { state.filters.search = e.target.value; render(); });
  $("filter-status").addEventListener("change", (e) => { state.filters.status = e.target.value; render(); });
  $("filter-priority").addEventListener("change", (e) => { state.filters.priority = e.target.value; render(); });
  $("filter-duration").addEventListener("change", (e) => { state.filters.duration = e.target.value; render(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("detail-modal").hidden) closeDetail();
    else if (!$("form-modal").hidden) closeForm();
  });

  // ---------------------- Boot ----------------------
  const cfg = loadConfig();
  if (!cfg) {
    showConfigScreen();
  } else if (!window.supabase) {
    showConfigScreen("Supabase JS library failed to load. Check your network.");
  } else {
    initSupabase(cfg.url, cfg.key);
  }
})();
