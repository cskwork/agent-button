// Dashboard: buttons grid, recent runs, run detail, approvals.
// Non-developers never see YAML here — creation/editing goes through builder.js.

const $ = (id) => document.getElementById(id);
const state = { buttons: [], runs: [], approvals: [], adapters: {}, openRun: null };

async function api(path, opts) {
  const res = await fetch("/api" + path, opts && {
    method: opts.method || "POST",
    headers: { "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const e = data.error;
    throw new Error(e ? `${e.message}${e.details ? "\n" + JSON.stringify(e.details, null, 2) : ""}` : res.status);
  }
  return data;
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 3500);
}

const GLYPHS = {
  succeeded: ["✓", "ok"], failed: ["✗", "bad"], cancelled: ["—", ""],
  running: ["●", "accent"], waiting_approval: ["◐", "warn"], queued: ["○", ""], interrupted: ["!", ""],
};

const statusLabel = (s) => t("status_" + s);

// "codex · gpt-5.6-sol · reasoning: high" — only fields the daemon actually
// resolved (button or native config); unknown fields are simply absent.
function agentInfoLine(run) {
  const a = run.agent;
  if (!a) return "";
  const parts = [a.adapter, a.model, a.reasoning ? `${t("reasoning")}: ${a.reasoning}` : null].filter(Boolean);
  return `<div class="sub">${parts.join(" · ")}</div>`;
}

function relTime(iso) {
  const d = Date.now() - Date.parse(iso);
  if (d < 60e3) return t("just_now");
  if (d < 3600e3) return t("min_ago", { n: Math.round(d / 60e3) });
  if (d < 86400e3) return t("hour_ago", { n: Math.round(d / 3600e3) });
  return t("day_ago", { n: Math.round(d / 86400e3) });
}

function inputDecls(btn) {
  return btn.kind === "agent-button" ? (btn.inputs?.properties || {}) : (btn.inputs || {});
}

// --- running a button -------------------------------------------------------

async function runButton(btn, dryRun) {
  const decls = Object.entries(inputDecls(btn));
  const needsAsk = decls.some(([, d]) => d.default === undefined);
  let inputs = {};
  if (needsAsk) {
    inputs = await askRunInputs(btn, decls); // builder.js modal
    if (inputs === null) return;
  }
  try {
    const { run } = await api("/runs", { body: { buttonId: btn.id, inputs, dryRun } });
    state.openRun = run.id;
    toast(t(dryRun ? "preview_started" : "run_started", { label: btn.label }));
    refresh();
  } catch (err) { toast(String(err.message || err)); }
}

// --- rendering --------------------------------------------------------------

function renderButtons() {
  $("grid").innerHTML = "";
  state.buttons.forEach((btn, i) => {
    const el = document.createElement("div");
    el.className = "card";
    const digit = i < 9 ? `[${i + 1}] ` : i === 9 ? "[0] " : "";
    const kind = btn.kind === "workflow" ? `${t("workflow")} · ${btn.risk || ""}` : (btn.agent?.adapter || "agent");
    const sched = btn.schedule?.next_run_at ? ` · ${t("next")} ${relTime(btn.schedule.next_run_at).replace(/ ago$| 전$/, "")}` : "";
    el.innerHTML = `<b>${digit}${btn.label}</b><div class="sub">${kind}${sched}</div>
      <div class="actions">
        <button class="primary">${t("run")}</button>
        <button title="${t("preview_title")}">${t("preview")}</button>
        <button class="ghost">${t("edit")}</button>
      </div>`;
    const [runBtn, dryBtn, editBtn] = el.querySelectorAll("button");
    runBtn.onclick = () => runButton(btn, false);
    dryBtn.onclick = () => runButton(btn, true);
    editBtn.onclick = () => openBuilder(btn.id); // builder.js
    $("grid").appendChild(el);
  });
  const add = document.createElement("div");
  add.className = "card add";
  add.textContent = t("new_automation");
  add.onclick = () => openBuilder(null);
  $("grid").appendChild(add);
}

function renderRuns() {
  $("runs").innerHTML = "";
  for (const run of state.runs) {
    const [glyph, cls] = GLYPHS[run.status] || [" ", ""];
    const el = document.createElement("div");
    el.className = "run-row";
    el.innerHTML = `<span class="glyph ${cls}">${glyph}</span>
      <span class="label">${run.buttonLabel}${run.dryRun ? ` <span class='accent'>${t("preview_tag")}</span>` : ""}</span>
      <span class="status">${statusLabel(run.status)}</span>
      <span class="when">${relTime(run.startedAt)}</span>`;
    el.onclick = () => { state.openRun = run.id; renderDetail(); };
    $("runs").appendChild(el);
  }
}

function formatEvent(ev) {
  const e = ev.event;
  switch (e.type) {
    case "message.delta": return e.text.replace(/\n$/, "");
    case "tool.started": return "> " + e.name;
    case "step.started": return `── step ${e.stepId} (${e.stepType})`;
    case "step.output": return e.text.replace(/\n$/, "");
    case "step.completed": return `   step ${e.stepId} ok`;
    case "step.failed": return `   step ${e.stepId} FAILED [${e.error.code}] ${e.error.message}`;
    case "step.skipped": return `   step ${e.stepId} skipped: ${e.reason}`;
    case "run.failed": return `FAILED [${e.error.code}] ${e.error.message}`;
    case "run.completed": return e.result.text ? "result: " + e.result.text : "run completed";
    case "artifact.created": return "artifact: " + e.artifact.path;
    case "approval.requested": return "APPROVAL REQUIRED: " + e.request.title;
    case "log": return e.text;
    default: return null;
  }
}

async function renderDetail() {
  const panel = $("detail");
  if (!state.openRun) { panel.classList.remove("show"); return; }
  let data;
  try { data = await api(`/runs/${state.openRun}`); } catch { return; }
  const { events } = await api(`/runs/${state.openRun}/events`);
  const run = data.run;
  const lines = events.map(formatEvent).filter(Boolean).join("\n");
  const approvalsHtml = data.approvals.map((a) => `
    <div class="approval"><b>${a.request.title}</b>
      <table>${Object.entries(a.request.fields).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
      <button class="primary" onclick="decide('${a.request.id}','approved')">${t("approve")}</button>
      <button class="danger" onclick="decide('${a.request.id}','rejected')">${t("reject")}</button>
    </div>`).join("");
  const artifacts = (run.artifacts || []).map((a) => `<div class="sub">${t("artifact")} ${a.path}</div>`).join("");
  const active = ["running", "waiting_approval", "queued"].includes(run.status);
  panel.innerHTML = `
    <div style="display:flex;gap:12px;align-items:baseline">
      <b style="font-size:16px">${run.buttonLabel}</b>
      <span class="${(GLYPHS[run.status] || [])[1] || ''}">${statusLabel(run.status)}</span>
      <span style="margin-left:auto"></span>
      ${active ? `<button class="danger" onclick="cancelRun('${run.id}')">${t("cancel")}</button>` : ""}
      <button onclick="state.openRun=null;renderDetail()">${t("close")}</button>
    </div>
    <div class="sub">${run.id}</div>
    ${agentInfoLine(run)}
    ${approvalsHtml}
    <pre>${lines || t("no_events")}</pre>
    ${artifacts}`;
  panel.classList.add("show");
}

window.decide = async (id, decision) => {
  try { await api(`/approvals/${id}`, { body: { decision } }); toast(t("decided_" + decision)); refresh(); }
  catch (err) { toast(String(err.message || err)); }
};
window.cancelRun = async (id) => {
  try { await api(`/runs/${id}/cancel`, { body: {} }); toast(t("cancel_requested")); refresh(); }
  catch (err) { toast(String(err.message || err)); }
};

// --- refresh loop -----------------------------------------------------------

let adaptersLoaded = false;
async function refresh() {
  try {
    const [b, r, a] = await Promise.all([api("/buttons"), api("/runs?limit=12"), api("/approvals")]);
    state.buttons = b.buttons; state.runs = r.runs; state.approvals = a.approvals;
    $("daemon").textContent = t("daemon_ready") + (a.approvals.length ? " " + t("approvals_pending", { n: a.approvals.length }) : "");
    renderButtons(); renderRuns();
    if (state.openRun) renderDetail();
    if (!adaptersLoaded) {
      adaptersLoaded = true;
      api("/adapters").then((d) => { state.adapters = d.adapters; }).catch(() => { adaptersLoaded = false; });
    }
  } catch {
    $("daemon").textContent = t("daemon_offline");
  }
}

document.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (/^[0-9]$/.test(e.key)) {
    const idx = e.key === "0" ? 9 : Number(e.key) - 1;
    if (state.buttons[idx]) runButton(state.buttons[idx], false);
  }
  if (e.key === "Escape") {
    if ($("builder").classList.contains("show") || $("runmodal").classList.contains("show") || $("editor").classList.contains("show")) {
      $("builder").classList.remove("show");
      $("runmodal").classList.remove("show");
      $("editor").classList.remove("show");
    } else {
      state.openRun = null;
      renderDetail();
    }
  }
});

refresh();
setInterval(() => {
  // Pause polling re-renders while a form is open so typing is never clobbered.
  if ($("builder").classList.contains("show") || $("runmodal").classList.contains("show")) return;
  refresh();
}, 1500);
