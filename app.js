(() => {
  const STORAGE_KEY = "task-hub.tasks.v1";

  const state = {
    tasks: load(),
    view: "mine",
    filters: { status: "", priority: "", search: "" },
    sort: "due",
    editingId: null,
  };

  const $ = (id) => document.getElementById(id);
  const form = $("task-form");
  const list = $("task-list");
  const empty = $("empty-state");
  const listTitle = $("list-title");
  const submitBtn = $("submit-btn");
  const cancelEditBtn = $("cancel-edit");
  const formTitle = $("form-title");
  const helper = $("form-helper");
  const ownersDatalist = $("known-owners");

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seed();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : seed();
    } catch {
      return seed();
    }
  }

  function seed() {
    return [
      {
        id: uid(),
        title: "Plan personal week",
        owner: "Me",
        scope: "mine",
        priority: "medium",
        status: "open",
        due: todayPlus(1),
        notes: "Block focus time and review goals.",
        createdAt: Date.now(),
      },
      {
        id: uid(),
        title: "Ship sprint demo",
        owner: "Team",
        scope: "team",
        priority: "high",
        status: "in-progress",
        due: todayPlus(3),
        notes: "Coordinate with engineering and design.",
        createdAt: Date.now() - 1000,
      },
    ];
  }

  function todayPlus(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
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
    listTitle.textContent =
      view === "mine" ? "My Tasks" : view === "team" ? "Team Tasks" : "All Tasks";
    if (!state.editingId) $("scope").value = view === "team" ? "team" : "mine";
    render();
  }

  function getFiltered() {
    const { search, status, priority } = state.filters;
    const term = search.trim().toLowerCase();
    return state.tasks
      .filter((t) => state.view === "all" || t.scope === state.view)
      .filter((t) => !status || t.status === status)
      .filter((t) => !priority || t.priority === priority)
      .filter((t) => {
        if (!term) return true;
        return (
          t.title.toLowerCase().includes(term) ||
          (t.owner || "").toLowerCase().includes(term) ||
          (t.notes || "").toLowerCase().includes(term)
        );
      });
  }

  function sortTasks(tasks) {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    const copy = [...tasks];
    if (state.sort === "priority") {
      copy.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
    } else if (state.sort === "created") {
      copy.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      copy.sort((a, b) => {
        const ad = a.due || "9999-12-31";
        const bd = b.due || "9999-12-31";
        return ad.localeCompare(bd);
      });
    }
    copy.sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
    return copy;
  }

  function formatDue(due) {
    if (!due) return { text: "No due date", className: "" };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(due + "T00:00:00");
    const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
    const date = formatter.format(d);
    if (diff < 0) return { text: `Overdue · ${date}`, className: "overdue" };
    if (diff === 0) return { text: `Today · ${date}`, className: "soon" };
    if (diff === 1) return { text: `Tomorrow · ${date}`, className: "soon" };
    if (diff <= 3) return { text: `In ${diff} days · ${date}`, className: "soon" };
    return { text: date, className: "" };
  }

  function statusLabel(s) {
    return s === "in-progress" ? "In Progress" : s.charAt(0).toUpperCase() + s.slice(1);
  }

  function render() {
    const filtered = sortTasks(getFiltered());
    list.innerHTML = "";

    if (filtered.length === 0) {
      empty.classList.remove("hidden");
      empty.textContent =
        state.tasks.length === 0
          ? "No tasks yet. Add one to get started."
          : "No tasks match your filters.";
    } else {
      empty.classList.add("hidden");
      for (const t of filtered) list.appendChild(renderTask(t));
    }

    renderStats();
    renderOwners();
  }

  function renderTask(t) {
    const li = document.createElement("li");
    li.className = `task${t.status === "done" ? " done" : ""}`;
    li.dataset.id = t.id;

    const due = formatDue(t.due);
    const notesHtml = t.notes
      ? `<p class="task-notes">${escapeHtml(t.notes)}</p>`
      : "";

    li.innerHTML = `
      <input type="checkbox" class="task-checkbox" ${t.status === "done" ? "checked" : ""} aria-label="Mark complete" />
      <div class="task-main">
        <p class="task-title">${escapeHtml(t.title)}</p>
        <div class="task-meta">
          <span class="pill scope-${t.scope}">${t.scope === "mine" ? "Personal" : "Team"}</span>
          <span class="pill priority-${t.priority}">${t.priority}</span>
          <span class="pill status-${t.status}">${statusLabel(t.status)}</span>
          <span>· ${escapeHtml(t.owner || "Unassigned")}</span>
          <span class="due ${due.className}">· ${due.text}</span>
        </div>
        ${notesHtml}
      </div>
      <div class="task-actions">
        <button class="ghost edit" type="button">Edit</button>
        <button class="ghost delete" type="button">Delete</button>
      </div>
    `;

    li.querySelector(".task-checkbox").addEventListener("change", (e) => {
      toggleDone(t.id, e.target.checked);
    });
    li.querySelector(".edit").addEventListener("click", () => beginEdit(t.id));
    li.querySelector(".delete").addEventListener("click", () => removeTask(t.id));

    return li;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function renderStats() {
    const scope = (t) => state.view === "all" || t.scope === state.view;
    const open = state.tasks.filter((t) => scope(t) && t.status === "open").length;
    const prog = state.tasks.filter((t) => scope(t) && t.status === "in-progress").length;
    const done = state.tasks.filter((t) => scope(t) && t.status === "done").length;
    $("stat-open").textContent = open;
    $("stat-progress").textContent = prog;
    $("stat-done").textContent = done;
  }

  function renderOwners() {
    const owners = [...new Set(state.tasks.map((t) => t.owner).filter(Boolean))].sort();
    ownersDatalist.innerHTML = owners
      .map((o) => `<option value="${escapeHtml(o)}"></option>`)
      .join("");
  }

  function toggleDone(id, done) {
    const t = state.tasks.find((t) => t.id === id);
    if (!t) return;
    t.status = done ? "done" : "open";
    save();
    render();
  }

  function removeTask(id) {
    if (!confirm("Delete this task?")) return;
    state.tasks = state.tasks.filter((t) => t.id !== id);
    if (state.editingId === id) resetForm();
    save();
    render();
  }

  function beginEdit(id) {
    const t = state.tasks.find((t) => t.id === id);
    if (!t) return;
    state.editingId = id;
    $("task-id").value = t.id;
    $("title").value = t.title;
    $("owner").value = t.owner || "";
    $("scope").value = t.scope;
    $("priority").value = t.priority;
    $("status").value = t.status;
    $("due").value = t.due || "";
    $("notes").value = t.notes || "";
    formTitle.textContent = "Edit Task";
    submitBtn.textContent = "Save Changes";
    cancelEditBtn.hidden = false;
    helper.textContent = "";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetForm() {
    state.editingId = null;
    form.reset();
    $("task-id").value = "";
    $("scope").value = state.view === "team" ? "team" : "mine";
    $("priority").value = "medium";
    $("status").value = "open";
    formTitle.textContent = "Add a Task";
    submitBtn.textContent = "Add Task";
    cancelEditBtn.hidden = true;
    helper.textContent = "";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("title").value.trim();
    const owner = $("owner").value.trim();
    if (!title || !owner) {
      helper.textContent = "Title and owner are required.";
      return;
    }
    const payload = {
      title,
      owner,
      scope: $("scope").value,
      priority: $("priority").value,
      status: $("status").value,
      due: $("due").value || null,
      notes: $("notes").value.trim(),
    };

    if (state.editingId) {
      const t = state.tasks.find((t) => t.id === state.editingId);
      if (t) Object.assign(t, payload);
    } else {
      state.tasks.push({ id: uid(), createdAt: Date.now(), ...payload });
    }

    save();
    resetForm();
    render();
  });

  cancelEditBtn.addEventListener("click", resetForm);

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  $("search").addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    render();
  });
  $("filter-status").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    render();
  });
  $("filter-priority").addEventListener("change", (e) => {
    state.filters.priority = e.target.value;
    render();
  });
  $("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });

  $("clear-all").addEventListener("click", () => {
    if (!confirm("This will delete every task. Continue?")) return;
    state.tasks = [];
    save();
    resetForm();
    render();
  });

  $("export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.tasks, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `task-hub-${new Date().toISOString().slice(0, 10)}.json`;
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
        if (!Array.isArray(data)) throw new Error("Invalid format");
        state.tasks = data.map((t) => ({
          id: t.id || uid(),
          title: String(t.title || "Untitled"),
          owner: String(t.owner || "Unassigned"),
          scope: t.scope === "team" ? "team" : "mine",
          priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : "medium",
          status: ["open", "in-progress", "done"].includes(t.status) ? t.status : "open",
          due: t.due || null,
          notes: String(t.notes || ""),
          createdAt: t.createdAt || Date.now(),
        }));
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

  resetForm();
  setView("mine");
})();
