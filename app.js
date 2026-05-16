(() => {
  const STORAGE_KEY = "todo-list.v2";

  const STATUS_OPTIONS = ["To Do", "Doing", "Done 🙌", "Routine Task", "BOD Release", "Today List"];
  const PRIORITY_OPTIONS = ["High", "Medium", "Low"];
  const DURATION_OPTIONS = ["Short", "Mid", "Long"];

  const STATUS_COLOR = {
    "To Do": "red",
    "Doing": "yellow",
    "Done 🙌": "green",
    "Routine Task": "blue",
    "BOD Release": "gray",
    "Today List": "default",
  };
  const PRIORITY_COLOR = { High: "red", Medium: "yellow", Low: "green" };
  const DURATION_COLOR = { Long: "purple", Mid: "yellow", Short: "red" };

  const STATUS_RANK = Object.fromEntries(STATUS_OPTIONS.map((s, i) => [s, i]));
  const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
  const DURATION_RANK = { Short: 0, Mid: 1, Long: 2 };

  const state = {
    tasks: load(),
    view: "mine",
    filters: { status: "open", priority: "", duration: "", search: "" },
    sort: "default",
    editingId: null,
  };

  const $ = (id) => document.getElementById(id);
  const rows = $("task-rows");
  const empty = $("empty-state");
  const modal = $("modal");
  const form = $("task-form");
  const helper = $("form-helper");
  const ownersDatalist = $("known-owners");
  const ownerCol = $("col-owner");

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seed();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalize) : seed();
    } catch {
      return seed();
    }
  }

  function normalize(t) {
    return {
      id: t.id || uid(),
      name: String(t.name || t.title || "Untitled"),
      status: STATUS_OPTIONS.includes(t.status) ? t.status : "To Do",
      priority: PRIORITY_OPTIONS.includes(t.priority) ? t.priority : "Medium",
      duration: DURATION_OPTIONS.includes(t.duration) ? t.duration : "Mid",
      date: t.date || null,
      scope: t.scope === "team" ? "team" : "mine",
      owner: String(t.owner || ""),
      createdAt: t.createdAt || Date.now(),
    };
  }

  function todayPlus(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function seed() {
    return [
      { id: uid(), name: "Plan weekly priorities", status: "To Do", priority: "High", duration: "Short", date: todayPlus(0), scope: "mine", owner: "Me", createdAt: Date.now() },
      { id: uid(), name: "Draft sprint demo deck", status: "Doing", priority: "High", duration: "Mid", date: todayPlus(2), scope: "team", owner: "Me", createdAt: Date.now() - 1000 },
      { id: uid(), name: "Review pull requests", status: "Doing", priority: "Medium", duration: "Short", date: todayPlus(1), scope: "team", owner: "Aisha", createdAt: Date.now() - 2000 },
      { id: uid(), name: "Quarterly OKR write-up", status: "To Do", priority: "Medium", duration: "Long", date: todayPlus(7), scope: "team", owner: "Luis", createdAt: Date.now() - 3000 },
      { id: uid(), name: "Doctor appointment booking", status: "To Do", priority: "Low", duration: "Short", date: todayPlus(4), scope: "mine", owner: "Me", createdAt: Date.now() - 4000 },
      { id: uid(), name: "Weekly status report", status: "Routine Task", priority: "Medium", duration: "Short", date: todayPlus(5), scope: "team", owner: "Me", createdAt: Date.now() - 5000 },
      { id: uid(), name: "Onboard new hire", status: "Done 🙌", priority: "High", duration: "Mid", date: todayPlus(-3), scope: "team", owner: "Me", createdAt: Date.now() - 6000 },
    ];
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    ownerCol.style.display = view === "mine" ? "none" : "";
    render();
  }

  function getFiltered() {
    const { search, status, priority, duration } = state.filters;
    const term = search.trim().toLowerCase();
    return state.tasks.filter((t) => {
      if (state.view !== "all" && t.scope !== state.view) return false;
      if (status === "open") {
        if (t.status !== "To Do" && t.status !== "Doing") return false;
      } else if (status && t.status !== status) {
        return false;
      }
      if (priority && t.priority !== priority) return false;
      if (duration && t.duration !== duration) return false;
      if (term && !t.name.toLowerCase().includes(term) && !(t.owner || "").toLowerCase().includes(term)) return false;
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
      copy.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      copy.sort((a, b) => {
        const s = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        if (s !== 0) return s;
        const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (p !== 0) return p;
        return DURATION_RANK[a.duration] - DURATION_RANK[b.duration];
      });
    }
    return copy;
  }

  function formatDate(date) {
    if (!date) return { text: "—", className: "" };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(date + "T00:00:00");
    const diff = Math.round((d - today) / 86400000);
    const fmt = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
    const text = fmt.format(d);
    if (diff < 0) return { text: `${text} (overdue)`, className: "overdue" };
    if (diff === 0) return { text: `${text} · Today`, className: "soon" };
    if (diff === 1) return { text: `${text} · Tomorrow`, className: "soon" };
    if (diff <= 3) return { text: `${text}`, className: "soon" };
    return { text, className: "" };
  }

  function pill(value, color) {
    const span = document.createElement("span");
    span.className = `pill ${color || "default"}`;
    span.textContent = value;
    return span;
  }

  function render() {
    const filtered = sortTasks(getFiltered());
    rows.innerHTML = "";

    if (filtered.length === 0) {
      empty.classList.remove("hidden");
    } else {
      empty.classList.add("hidden");
      for (const t of filtered) rows.appendChild(renderRow(t));
    }

    renderStats();
    renderOwners();
  }

  function renderRow(t) {
    const tr = document.createElement("tr");
    if (t.status === "Done 🙌") tr.classList.add("done");
    tr.dataset.id = t.id;

    const cellCheck = document.createElement("td");
    cellCheck.className = "col-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "task-check";
    cb.checked = t.status === "Done 🙌";
    cb.setAttribute("aria-label", "Mark done");
    cb.addEventListener("change", () => {
      t.status = cb.checked ? "Done 🙌" : "To Do";
      save();
      render();
    });
    cellCheck.appendChild(cb);

    const cellName = document.createElement("td");
    cellName.className = "col-name";
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "task-name";
    nameBtn.textContent = t.name;
    nameBtn.addEventListener("click", () => openModal(t.id));
    cellName.appendChild(nameBtn);

    const cellStatus = document.createElement("td");
    cellStatus.appendChild(pill(t.status, STATUS_COLOR[t.status]));

    const cellPriority = document.createElement("td");
    cellPriority.appendChild(pill(t.priority, PRIORITY_COLOR[t.priority]));

    const cellDuration = document.createElement("td");
    cellDuration.appendChild(pill(t.duration, DURATION_COLOR[t.duration]));

    const cellDate = document.createElement("td");
    const d = formatDate(t.date);
    const dateSpan = document.createElement("span");
    dateSpan.className = `date-text ${d.className}`;
    dateSpan.textContent = d.text;
    cellDate.appendChild(dateSpan);

    const cellOwner = document.createElement("td");
    cellOwner.style.display = state.view === "mine" ? "none" : "";
    const ownerSpan = document.createElement("span");
    ownerSpan.className = "owner-text";
    ownerSpan.textContent = t.owner || "—";
    cellOwner.appendChild(ownerSpan);

    const cellActions = document.createElement("td");
    cellActions.className = "col-actions";
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.type = "button";
    editBtn.title = "Edit";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => openModal(t.id));
    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.type = "button";
    delBtn.title = "Delete";
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", () => removeTask(t.id));
    wrap.append(editBtn, delBtn);
    cellActions.appendChild(wrap);

    tr.append(cellCheck, cellName, cellStatus, cellPriority, cellDuration, cellDate, cellOwner, cellActions);
    return tr;
  }

  function renderStats() {
    const inScope = (t) => state.view === "all" || t.scope === state.view;
    $("stat-todo").textContent = state.tasks.filter((t) => inScope(t) && t.status === "To Do").length;
    $("stat-doing").textContent = state.tasks.filter((t) => inScope(t) && t.status === "Doing").length;
    $("stat-done").textContent = state.tasks.filter((t) => inScope(t) && t.status === "Done 🙌").length;
  }

  function renderOwners() {
    const owners = [...new Set(state.tasks.map((t) => t.owner).filter(Boolean))].sort();
    ownersDatalist.innerHTML = owners
      .map((o) => `<option value="${escapeAttr(o)}"></option>`)
      .join("");
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function removeTask(id) {
    if (!confirm("Delete this task?")) return;
    state.tasks = state.tasks.filter((t) => t.id !== id);
    save();
    render();
  }

  function openModal(id) {
    state.editingId = id || null;
    helper.textContent = "";
    if (id) {
      const t = state.tasks.find((t) => t.id === id);
      if (!t) return;
      $("modal-title").textContent = "Edit task";
      $("task-id").value = t.id;
      $("name").value = t.name;
      $("status").value = t.status;
      $("priority").value = t.priority;
      $("duration").value = t.duration;
      $("date").value = t.date || "";
      $("scope").value = t.scope;
      $("owner").value = t.owner || "";
    } else {
      $("modal-title").textContent = "New task";
      form.reset();
      $("task-id").value = "";
      $("status").value = "To Do";
      $("priority").value = "Medium";
      $("duration").value = "Mid";
      $("scope").value = state.view === "team" ? "team" : "mine";
      $("owner").value = state.view === "team" ? "" : "Me";
    }
    modal.hidden = false;
    setTimeout(() => $("name").focus(), 50);
  }

  function closeModal() {
    modal.hidden = true;
    state.editingId = null;
  }

  modal.addEventListener("click", (e) => {
    if (e.target.matches("[data-close]")) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("name").value.trim();
    if (!name) {
      helper.textContent = "Name is required.";
      return;
    }
    const payload = {
      name,
      status: $("status").value,
      priority: $("priority").value,
      duration: $("duration").value,
      date: $("date").value || null,
      scope: $("scope").value,
      owner: $("owner").value.trim(),
    };

    if (state.editingId) {
      const t = state.tasks.find((t) => t.id === state.editingId);
      if (t) Object.assign(t, payload);
    } else {
      state.tasks.push({ id: uid(), createdAt: Date.now(), ...payload });
    }

    save();
    closeModal();
    render();
  });

  $("new-task").addEventListener("click", () => openModal());

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  $("search").addEventListener("input", (e) => { state.filters.search = e.target.value; render(); });
  $("filter-status").addEventListener("change", (e) => { state.filters.status = e.target.value; render(); });
  $("filter-priority").addEventListener("change", (e) => { state.filters.priority = e.target.value; render(); });
  $("filter-duration").addEventListener("change", (e) => { state.filters.duration = e.target.value; render(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });

  $("clear-all").addEventListener("click", () => {
    if (!confirm("Delete every task?")) return;
    state.tasks = [];
    save();
    render();
  });

  $("export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.tasks, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-todo-list-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("import-btn").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("Invalid");
        state.tasks = data.map(normalize);
        save();
        render();
      } catch {
        alert("Could not import: file is not a valid task export.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  });

  setView("mine");
})();
