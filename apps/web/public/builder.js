// Form-based automation builder: non-developers fill in name, instructions,
// questions, and a schedule. YAML never appears unless "Advanced" is clicked.

// Product names stay as-is; "fake" is translated via t("demo_adapter").
const ADAPTER_LABELS = {
  "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode", pi: "Pi", fake: "Demo",
};
const DAY_KEYS = ["day_sun", "day_mon", "day_tue", "day_wed", "day_thu", "day_fri", "day_sat"];

let editingId = null;

function slugify(text, fallbackPrefix) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallbackPrefix + "-" + Math.random().toString(36).slice(2, 6);
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

// --- open / render ----------------------------------------------------------

window.openBuilder = async (buttonId) => {
  const btn = buttonId ? state.buttons.find((b) => b.id === buttonId) : null;
  if (btn && btn.kind === "workflow") {
    // Workflows have a step editor on the roadmap; today they open in Advanced.
    return openAdvanced(buttonId, t("workflows_note"));
  }
  editingId = btn ? btn.id : null;
  renderBuilder(btn);
  $("builder").classList.add("show");
};

function adapterOptions(selected) {
  const ids = Object.keys(state.adapters).length ? Object.keys(state.adapters) : Object.keys(ADAPTER_LABELS);
  return ids.map((id) => {
    const info = state.adapters[id];
    const status = info ? (info.installed ? "" : t("not_installed")) : "";
    const label = (id === "fake" ? t("demo_adapter") : ADAPTER_LABELS[id] || id) + status;
    return `<option value="${id}" ${id === selected ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function scheduleFromDef(btn) {
  const t = btn?.trigger;
  if (!t || t.type !== "schedule" || !t.cron) return { kind: "manual" };
  const m = t.cron.trim().split(/\s+/);
  if (m.length === 5) {
    const [min, hour, dom, mon, dow] = m;
    const time = /^\d+$/.test(min) && /^\d+$/.test(hour)
      ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : null;
    if (time && dom === "*" && mon === "*" && dow === "*") return { kind: "daily", time };
    if (time && dom === "*" && mon === "*" && /^[0-6](,[0-6])*$/.test(dow)) {
      return { kind: "weekly", time, days: dow.split(",").map(Number) };
    }
    if (time && /^\d+$/.test(dom) && mon === "*" && dow === "*") return { kind: "monthly", time, dom: Number(dom) };
  }
  return { kind: "custom", cron: t.cron };
}

function renderBuilder(btn) {
  const decls = btn ? Object.entries(inputDecls(btn)) : [];
  const sched = scheduleFromDef(btn);
  const groups = [...new Set(state.buttons.map((b) => b.group).filter(Boolean))];

  const schedLabels = {
    manual: t("sched_manual"), daily: t("sched_daily"), weekly: t("sched_weekly"),
    monthly: t("sched_monthly"), custom: t("sched_custom"),
  };
  $("builder-box").innerHTML = `
    <h3>${btn ? t("edit_automation") : t("new_automation_title")}</h3>
    <p class="hint">${t("builder_hint")}</p>

    <div class="field-row">
      <div class="field"><label>${t("field_name")}</label><input type="text" id="b-label" value="${esc(btn?.label)}" placeholder="${t("name_placeholder")}"></div>
      <div class="field"><label>${t("field_folder")}</label>
        <input type="text" id="b-group" list="b-groups" value="${esc(btn?.group || "Custom")}">
        <datalist id="b-groups">${groups.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
      </div>
    </div>
    <div class="field"><label>${t("field_desc")}</label>
      <input type="text" id="b-desc" value="${esc(btn?.description)}" placeholder="${t("desc_placeholder")}"></div>

    <div class="field-row">
      <div class="field"><label>${t("field_assistant")}</label><select id="b-agent">${adapterOptions(btn?.agent?.adapter || "claude-code")}</select></div>
      <div class="field"><label>${t("field_cwd")}</label><input type="text" id="b-cwd" value="${esc(btn?.workspace?.cwd || "~")}"></div>
    </div>

    <div class="field"><label>${t("field_instructions")}</label>
      <textarea id="b-prompt" placeholder="Prepare my weekly report for {{report_week}}. Retrieve my Jira work, summarize it, and save a DOCX to ~/Documents/Weekly Reports/.">${esc(btn?.prompt?.template)}</textarea>
      <p class="hint" style="margin-top:6px">${t("tip_prefix")} <code>{{question_name}}</code> ${t("tip_suffix")}</p>
    </div>

    <div class="field">
      <label>${t("questions_label")} <button class="ghost" onclick="addQuestion()">${t("add")}</button></label>
      <div class="q-head"><span>${t("q_head_name")}</span><span>${t("q_head_type")}</span><span>${t("q_head_choices")}</span><span>${t("q_head_default")}</span><span>${t("q_head_required")}</span><span></span></div>
      <div id="b-questions"></div>
    </div>

    <div class="field-row">
      <div class="field"><label>${t("field_when")}</label>
        <select id="b-sched-kind" onchange="renderSchedule()">
          ${["manual", "daily", "weekly", "monthly", "custom"].map((k) =>
            `<option value="${k}" ${sched.kind === k ? "selected" : ""}>${schedLabels[k]}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>${t("field_timeout")}</label>
        <input type="number" id="b-timeout" min="1" value="${btn ? Math.round((btn.execution?.timeout_seconds || 1800) / 60) : 30}"></div>
    </div>
    <div class="field" id="b-sched-detail"></div>

    <div class="field-row">
      <div class="field"><label>${t("field_pin")}</label>
        <select id="b-pin"><option value="no" ${btn?.pinned ? "" : "selected"}>${t("no")}</option><option value="yes" ${btn?.pinned ? "selected" : ""}>${t("yes")}</option></select></div>
      <div class="field"><label>${t("field_shortcut")}</label>
        <select id="b-shortcut"><option value="">${t("none")}</option>${"1234567890".split("").map((d) =>
          `<option value="${d}" ${btn?.shortcut === d ? "selected" : ""}>${d}</option>`).join("")}</select></div>
    </div>

    <div class="footer">
      <span class="err" id="b-err"></span>
      ${btn ? `<button class="danger" onclick="deleteAutomation()">${t("delete")}</button>` : ""}
      <button class="ghost" onclick="openAdvancedFromBuilder()">${t("advanced")}</button>
      <button onclick="$('builder').classList.remove('show')">${t("cancel")}</button>
      <button class="primary" onclick="saveBuilder()">${t("save")}</button>
    </div>`;

  window._builderSched = sched;
  renderSchedule();
  for (const [name, decl] of decls) addQuestion(name, decl);
}

// --- questions --------------------------------------------------------------

window.addQuestion = (name, decl) => {
  const row = document.createElement("div");
  row.className = "q-row";
  const type = decl ? (decl.type === "enum" ? "choice" : decl.type === "boolean" ? "yesno" : decl.type) : "string";
  row.innerHTML = `
    <input class="q-name" placeholder="report_week" value="${esc(name || "")}">
    <select class="q-type">
      <option value="string" ${type === "string" ? "selected" : ""}>${t("type_text")}</option>
      <option value="choice" ${type === "choice" ? "selected" : ""}>${t("type_choice")}</option>
      <option value="number" ${type === "number" ? "selected" : ""}>${t("type_number")}</option>
      <option value="yesno" ${type === "yesno" ? "selected" : ""}>${t("type_yesno")}</option>
    </select>
    <input class="q-choices" placeholder="a, b, c" value="${esc(decl?.values?.join(", ") || "")}">
    <input class="q-default" placeholder="${t("q_default_ph")}" value="${esc(decl?.default ?? "")}">
    <input class="q-required" type="checkbox" ${decl?.required ? "checked" : ""}>
    <button class="ghost" onclick="this.parentElement.remove()">✕</button>`;
  const nameInput = row.querySelector(".q-name");
  nameInput.addEventListener("blur", () => { nameInput.value = slugify(nameInput.value, "q").replaceAll("-", "_"); });
  $("b-questions").appendChild(row);
};

function collectQuestions() {
  const properties = {};
  for (const row of document.querySelectorAll("#b-questions .q-row")) {
    const name = row.querySelector(".q-name").value.trim();
    if (!name) continue;
    const kind = row.querySelector(".q-type").value;
    const choices = row.querySelector(".q-choices").value.split(",").map((s) => s.trim()).filter(Boolean);
    const rawDefault = row.querySelector(".q-default").value.trim();
    const decl = {
      type: kind === "choice" ? "enum" : kind === "yesno" ? "boolean" : kind,
      required: row.querySelector(".q-required").checked,
    };
    if (decl.type === "enum") decl.values = choices;
    if (rawDefault !== "") {
      decl.default = decl.type === "number" ? Number(rawDefault)
        : decl.type === "boolean" ? /^(yes|true|y)$/i.test(rawDefault) : rawDefault;
    }
    properties[name] = decl;
  }
  return properties;
}

// --- schedule ---------------------------------------------------------------

window.renderSchedule = () => {
  const kind = $("b-sched-kind").value;
  const sched = window._builderSched || {};
  const time = sched.time || "09:00";
  const detail = $("b-sched-detail");
  if (kind === "manual") { detail.innerHTML = ""; return; }
  if (kind === "daily") {
    detail.innerHTML = `<label>${t("sched_at_time")}</label><input type="time" id="b-time" value="${time}">`;
  } else if (kind === "weekly") {
    const days = sched.days || [5];
    detail.innerHTML = `<label>${t("sched_days_time")}</label>
      <div class="days">${DAY_KEYS.map((k, i) =>
        `<label><input type="checkbox" class="b-day" value="${i}" ${days.includes(i) ? "checked" : ""}>${t(k)}</label>`).join("")}
      </div><div style="margin-top:8px"><input type="time" id="b-time" value="${time}"></div>`;
  } else if (kind === "monthly") {
    detail.innerHTML = `<label>${t("sched_dom_time")}</label>
      <div class="field-row"><input type="number" id="b-dom" min="1" max="31" value="${sched.dom || 1}">
      <input type="time" id="b-time" value="${time}"></div>`;
  } else {
    detail.innerHTML = `<label>${t("sched_cron")}</label>
      <input type="text" id="b-cron" value="${esc(sched.cron || "0 9 * * 1-5")}">`;
  }
};

function collectTrigger() {
  const kind = $("b-sched-kind").value;
  if (kind === "manual") return { type: "manual" };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (kind === "custom") return { type: "schedule", cron: $("b-cron").value.trim(), timezone };
  const [hour, minute] = ($("b-time")?.value || "09:00").split(":").map(Number);
  let cron;
  if (kind === "daily") cron = `${minute} ${hour} * * *`;
  else if (kind === "monthly") cron = `${minute} ${hour} ${$("b-dom").value || 1} * *`;
  else {
    const days = [...document.querySelectorAll(".b-day:checked")].map((el) => el.value);
    if (days.length === 0) throw new Error(t("err_pick_day"));
    cron = `${minute} ${hour} * * ${days.join(",")}`;
  }
  return { type: "schedule", cron, timezone, overlap_policy: "reject", missed_run_policy: "skip" };
}

// --- save / delete ----------------------------------------------------------

window.saveBuilder = async () => {
  const err = $("b-err");
  err.textContent = "";
  try {
    const label = $("b-label").value.trim();
    const prompt = $("b-prompt").value.trim();
    if (!label) throw new Error(t("err_need_name"));
    if (!prompt) throw new Error(t("err_need_instructions"));

    const existing = editingId ? state.buttons.find((b) => b.id === editingId) : null;
    const id = existing ? existing.id : slugify(label, "button");
    if (!existing && state.buttons.some((b) => b.id === id)) {
      throw new Error(t("err_exists", { label }));
    }

    // Preserve advanced fields (permissions, outputs, success, capabilities)
    // that the simple form does not surface.
    const { schedule: _s, ...base } = existing || {};
    const def = {
      version: 1, kind: "agent-button", ...base, id, label,
      description: $("b-desc").value.trim(),
      group: $("b-group").value.trim() || "Custom",
      pinned: $("b-pin").value === "yes",
      agent: { ...(existing?.agent || {}), adapter: $("b-agent").value },
      workspace: { ...(existing?.workspace || {}), cwd: $("b-cwd").value.trim() || "~" },
      prompt: { template: prompt },
      inputs: { type: "object", properties: collectQuestions() },
      execution: { ...(existing?.execution || {}), timeout_seconds: Math.max(60, Number($("b-timeout").value || 30) * 60) },
      trigger: collectTrigger(),
    };
    const shortcut = $("b-shortcut").value;
    if (shortcut) def.shortcut = shortcut; else delete def.shortcut;

    await api("/buttons", { body: def });
    $("builder").classList.remove("show");
    toast(t("saved", { label }));
    refresh();
  } catch (e) { err.textContent = String(e.message || e); }
};

window.deleteAutomation = async () => {
  const btn = state.buttons.find((b) => b.id === editingId);
  if (!btn || !confirm(t("confirm_delete", { label: btn.label }))) return;
  try {
    await api(`/buttons/${btn.id}`, { method: "DELETE" });
    $("builder").classList.remove("show");
    toast(t("deleted", { label: btn.label }));
    refresh();
  } catch (e) { $("b-err").textContent = String(e.message || e); }
};

// --- advanced (developer) editor -------------------------------------------

async function openAdvanced(buttonId, note) {
  $("editor-err").textContent = note || "";
  if (buttonId) {
    const res = await fetch(`/api/buttons/${buttonId}/raw`);
    $("editor-text").value = res.ok ? await res.text() : "";
    $("editor-title").textContent = t("adv_title_edit", { id: buttonId });
  } else {
    $("editor-title").textContent = t("adv_title_new");
  }
  $("editor").classList.add("show");
}

window.openAdvancedFromBuilder = () => {
  $("builder").classList.remove("show");
  openAdvanced(editingId);
};
window.closeEditor = () => $("editor").classList.remove("show");
window.saveButtonYaml = async () => {
  try {
    const res = await fetch("/api/buttons", { method: "POST", body: $("editor-text").value });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ? data.error.message + (data.error.details ? "\n" + JSON.stringify(data.error.details) : "") : res.status);
    closeEditor();
    toast(t("saved", { label: data.button.label }));
    refresh();
  } catch (err) { $("editor-err").textContent = String(err.message || err); }
};

// --- run-time questions modal ----------------------------------------------

window.askRunInputs = (btn, decls) => {
  return new Promise((resolve) => {
    const fields = decls.map(([name, decl]) => {
      const label = `${name.replaceAll("_", " ")}${decl.required ? "" : t("optional")}`;
      const desc = decl.description ? `<p class="hint">${esc(decl.description)}</p>` : "";
      let control;
      if (decl.type === "enum") {
        control = `<select data-name="${name}">${(decl.values || []).map((v) =>
          `<option ${v === decl.default ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
      } else if (decl.type === "boolean") {
        control = `<select data-name="${name}"><option value="false" ${decl.default ? "" : "selected"}>No</option><option value="true" ${decl.default ? "selected" : ""}>Yes</option></select>`;
      } else {
        control = `<input type="${decl.type === "number" ? "number" : "text"}" data-name="${name}" value="${esc(decl.default ?? "")}">`;
      }
      return `<div class="field"><label>${esc(label)}</label>${control}${desc}</div>`;
    }).join("");

    $("runmodal-box").innerHTML = `
      <h3>${esc(btn.label)}</h3>
      <p class="hint">${t("runmodal_hint")}</p>
      ${fields}
      <div class="footer">
        <button id="rm-cancel">${t("cancel")}</button>
        <button class="primary" id="rm-run">${t("run")}</button>
      </div>`;
    $("runmodal").classList.add("show");

    $("rm-cancel").onclick = () => { $("runmodal").classList.remove("show"); resolve(null); };
    $("rm-run").onclick = () => {
      const inputs = {};
      for (const el of $("runmodal-box").querySelectorAll("[data-name]")) {
        if (el.value !== "") inputs[el.dataset.name] = el.value;
      }
      $("runmodal").classList.remove("show");
      resolve(inputs);
    };
    const first = $("runmodal-box").querySelector("input, select");
    if (first) first.focus();
  });
};

// Re-render dynamic (JS-built) content when the language switches. ui.js already
// retranslated static [data-i18n] markup and calls this hook afterwards.
window.onLangChange = () => {
  refresh();
  if ($("builder").classList.contains("show")) {
    renderBuilder(editingId ? state.buttons.find((b) => b.id === editingId) : null);
  }
};
