// Shared web UI prefs: theme (light default) + language (English default) + translations.
// Loaded before app.js/builder.js on the dashboard, and standalone on the web TUI.
// Prefs persist in localStorage and are shared across both pages (same origin).

const STORE = { theme: "ab-theme", lang: "ab-lang" };
let theme = localStorage.getItem(STORE.theme) || "light";
let lang = localStorage.getItem(STORE.lang) || "en";

const I18N = {
  en: {
    // dashboard chrome
    app_title: "Agent Button — Automations",
    header_automations: "AUTOMATIONS",
    open_web_tui: "open web TUI",
    connecting: "connecting…",
    recent_runs: "Recent runs",
    daemon_ready: "daemon ready",
    approvals_pending: "· {n} approval(s) pending",
    daemon_offline: "daemon offline — run: bun run daemon",
    // button cards
    run: "Run",
    preview: "Preview",
    preview_title: "Show what would happen, without doing it",
    edit: "Edit",
    new_automation: "+ New automation",
    workflow: "workflow",
    next: "next",
    // runs + statuses
    status_succeeded: "succeeded",
    status_failed: "failed",
    status_cancelled: "cancelled",
    status_running: "running",
    status_waiting_approval: "needs approval",
    status_queued: "queued",
    status_interrupted: "interrupted",
    preview_tag: "[preview]",
    just_now: "just now",
    min_ago: "{n}m ago",
    hour_ago: "{n}h ago",
    day_ago: "{n}d ago",
    // toasts
    run_started: "Run started: {label}",
    preview_started: "Preview started: {label}",
    saved: "Saved: {label}",
    deleted: "Deleted: {label}",
    cancel_requested: "cancel requested",
    decided_approved: "approved",
    decided_rejected: "rejected",
    // run detail
    approve: "Approve",
    reject: "Reject",
    cancel: "Cancel",
    close: "Close",
    no_events: "(no events yet)",
    artifact: "artifact:",
    artifact_open_title: "Open in Finder",
    reasoning: "reasoning",
    // builder
    edit_automation: "Edit automation",
    new_automation_title: "New automation",
    builder_hint: "Describe the task once — then it runs with one click, on a schedule, or both.",
    field_name: "Name",
    name_placeholder: "Weekly Report",
    field_folder: "Folder (grouping)",
    field_desc: "What does it do? (shown on the card)",
    desc_placeholder: "Builds my weekly report from Jira",
    field_assistant: "Assistant",
    field_cwd: "Work in folder",
    field_instructions: "Instructions — write what you would tell a colleague",
    tip_prefix: "Tip:",
    tip_suffix: "inserts an answer from the questions below.",
    questions_label: "Questions to ask before each run",
    add: "+ add",
    q_head_name: "question name",
    q_head_type: "type",
    q_head_choices: "choices",
    q_head_default: "usual answer",
    q_head_required: "must answer",
    type_text: "Text",
    type_choice: "Choice",
    type_number: "Number",
    type_yesno: "Yes / No",
    q_default_ph: "(ask every time)",
    field_when: "When does it run?",
    sched_manual: "Only when I click Run",
    sched_daily: "Every day",
    sched_weekly: "Every week",
    sched_monthly: "Every month",
    sched_custom: "Custom (cron)",
    sched_at_time: "At what time?",
    sched_days_time: "Which days, at what time?",
    sched_dom_time: "Which day of the month, at what time?",
    sched_cron: "Cron expression (minute hour day month weekday)",
    field_timeout: "Time limit (minutes)",
    field_pin: "Pin to dashboard",
    yes: "Yes",
    no: "No",
    field_shortcut: "Keyboard shortcut",
    none: "None",
    delete: "Delete",
    advanced: "Advanced",
    save: "Save",
    err_pick_day: "Pick at least one day of the week.",
    err_need_name: "Give the automation a name.",
    err_need_instructions: "Write the instructions.",
    err_exists: '"{label}" already exists — pick a different name or edit the existing one.',
    confirm_delete: 'Delete "{label}"? Past runs stay in history.',
    workflows_note: "Workflows are edited in the advanced editor for now.",
    adv_title_edit: "Advanced editor — {id}",
    adv_title_new: "Advanced editor — new button",
    adv_editor_title: "Advanced editor",
    adv_editor_hint: "Raw definition (YAML or JSON).",
    demo_adapter: "Demo (no AI, safe test)",
    not_installed: " — not installed",
    // run-time questions
    runmodal_hint: "A couple of questions before this runs.",
    optional: " (optional)",
    // day names
    day_sun: "Sun", day_mon: "Mon", day_tue: "Tue", day_wed: "Wed",
    day_thu: "Thu", day_fri: "Fri", day_sat: "Sat",
    // web TUI
    tui_subtitle: "web TUI — keys go straight to the terminal app",
    dashboard: "dashboard",
    tui_connected: "connected {cols}x{rows}",
    tui_disconnected: "disconnected — reload to reconnect",
  },
  ko: {
    app_title: "에이전트 버튼 — 자동화",
    header_automations: "자동화",
    open_web_tui: "웹 TUI 열기",
    connecting: "연결 중…",
    recent_runs: "최근 실행",
    daemon_ready: "데몬 준비됨",
    approvals_pending: "· 승인 대기 {n}건",
    daemon_offline: "데몬 오프라인 — 실행: bun run daemon",
    run: "실행",
    preview: "미리보기",
    preview_title: "실제 실행 없이 어떤 일이 일어날지 보여줍니다",
    edit: "편집",
    new_automation: "+ 새 자동화",
    workflow: "워크플로우",
    next: "다음",
    status_succeeded: "성공",
    status_failed: "실패",
    status_cancelled: "취소됨",
    status_running: "실행 중",
    status_waiting_approval: "승인 필요",
    status_queued: "대기 중",
    status_interrupted: "중단됨",
    preview_tag: "[미리보기]",
    just_now: "방금 전",
    min_ago: "{n}분 전",
    hour_ago: "{n}시간 전",
    day_ago: "{n}일 전",
    run_started: "실행 시작: {label}",
    preview_started: "미리보기 시작: {label}",
    saved: "저장됨: {label}",
    deleted: "삭제됨: {label}",
    cancel_requested: "취소 요청됨",
    decided_approved: "승인됨",
    decided_rejected: "거부됨",
    approve: "승인",
    reject: "거부",
    cancel: "취소",
    close: "닫기",
    no_events: "(아직 이벤트 없음)",
    artifact: "산출물:",
    artifact_open_title: "Finder에서 열기",
    reasoning: "추론",
    edit_automation: "자동화 편집",
    new_automation_title: "새 자동화",
    builder_hint: "작업을 한 번만 설명하면 클릭 한 번으로, 예약으로, 또는 둘 다로 실행됩니다.",
    field_name: "이름",
    name_placeholder: "주간 보고서",
    field_folder: "폴더 (그룹)",
    field_desc: "무엇을 하나요? (카드에 표시됨)",
    desc_placeholder: "Jira에서 주간 보고서를 만듭니다",
    field_assistant: "어시스턴트",
    field_cwd: "작업 폴더",
    field_instructions: "지침 — 동료에게 말하듯 작성하세요",
    tip_prefix: "팁:",
    tip_suffix: "은(는) 아래 질문의 답변을 삽입합니다.",
    questions_label: "실행 전에 물어볼 질문",
    add: "+ 추가",
    q_head_name: "질문 이름",
    q_head_type: "유형",
    q_head_choices: "선택지",
    q_head_default: "기본 답변",
    q_head_required: "필수",
    type_text: "텍스트",
    type_choice: "선택",
    type_number: "숫자",
    type_yesno: "예 / 아니오",
    q_default_ph: "(매번 질문)",
    field_when: "언제 실행되나요?",
    sched_manual: "실행 버튼을 누를 때만",
    sched_daily: "매일",
    sched_weekly: "매주",
    sched_monthly: "매월",
    sched_custom: "사용자 지정 (cron)",
    sched_at_time: "몇 시에?",
    sched_days_time: "어떤 요일에, 몇 시에?",
    sched_dom_time: "매월 며칠에, 몇 시에?",
    sched_cron: "Cron 표현식 (분 시 일 월 요일)",
    field_timeout: "시간 제한 (분)",
    field_pin: "대시보드에 고정",
    yes: "예",
    no: "아니오",
    field_shortcut: "단축키",
    none: "없음",
    delete: "삭제",
    advanced: "고급",
    save: "저장",
    err_pick_day: "요일을 하나 이상 선택하세요.",
    err_need_name: "자동화 이름을 입력하세요.",
    err_need_instructions: "지침을 작성하세요.",
    err_exists: '"{label}"이(가) 이미 있습니다 — 다른 이름을 쓰거나 기존 항목을 편집하세요.',
    confirm_delete: '"{label}"을(를) 삭제할까요? 과거 실행 기록은 남습니다.',
    workflows_note: "워크플로우는 현재 고급 편집기에서 편집합니다.",
    adv_title_edit: "고급 편집기 — {id}",
    adv_title_new: "고급 편집기 — 새 버튼",
    adv_editor_title: "고급 편집기",
    adv_editor_hint: "원본 정의 (YAML 또는 JSON).",
    demo_adapter: "데모 (AI 없음, 안전한 테스트)",
    not_installed: " — 설치 안 됨",
    runmodal_hint: "실행 전에 몇 가지 질문이 있습니다.",
    optional: " (선택)",
    day_sun: "일", day_mon: "월", day_tue: "화", day_wed: "수",
    day_thu: "목", day_fri: "금", day_sat: "토",
    tui_subtitle: "웹 TUI — 입력이 터미널 앱으로 바로 전달됩니다",
    dashboard: "대시보드",
    tui_connected: "연결됨 {cols}x{rows}",
    tui_disconnected: "연결 끊김 — 새로고침하여 재연결",
  },
};

// Translate a key, substituting {name} placeholders. Falls back to English, then the key.
function t(key, params) {
  let s = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
  if (params) for (const k in params) s = s.replaceAll("{" + k + "}", params[k]);
  return s;
}

function currentTheme() { return theme; }
function currentLang() { return lang; }

// Translate static markup: [data-i18n] sets textContent, [data-i18n-title] sets title.
function applyStaticI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.documentElement.lang = lang;
  const titleKey = document.querySelector("title")?.dataset.i18n;
  if (titleKey) document.title = t(titleKey);
}

function applyTheme() { document.documentElement.dataset.theme = theme; }

// Refresh the toggle labels to show the target state (no emojis, per repo rules).
function renderControls() {
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) themeBtn.textContent = theme === "light" ? "Dark" : "Light";
  const langBtn = document.getElementById("lang-toggle");
  if (langBtn) langBtn.textContent = lang === "en" ? "한국어" : "English";
}

function setLang(next) {
  lang = next;
  localStorage.setItem(STORE.lang, next);
  applyStaticI18n();
  renderControls();
  if (window.onLangChange) window.onLangChange();
}

function setTheme(next) {
  theme = next;
  localStorage.setItem(STORE.theme, next);
  applyTheme();
  renderControls();
  if (window.onThemeChange) window.onThemeChange();
}

function toggleLang() { setLang(lang === "en" ? "ko" : "en"); }
function toggleTheme() { setTheme(theme === "light" ? "dark" : "light"); }

// Scripts load at end of <body>, so the DOM is ready here.
applyTheme();
applyStaticI18n();
renderControls();
