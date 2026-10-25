const SESSION_KEY = "homework-trace-supabase-session-v1";
const levels = [1, 2, 3, 4, 5, 6];
const roleDetails = {
  level1: { label: "一级管理员", canRecord: true, canAddStudents: false, canRemoveStudents: false },
  level2: { label: "二级管理员", canRecord: true, canAddStudents: true, canRemoveStudents: false },
  level3: { label: "三级管理员", canRecord: true, canAddStudents: true, canRemoveStudents: true }
};
const config = window.APP_CONFIG;
const supabaseUrl = typeof config?.supabaseUrl === "string" ? config.supabaseUrl.replace(/\/+$/, "") : "";
const supabaseKey = typeof config?.supabaseAnonKey === "string" ? config.supabaseAnonKey.trim() : "";
const isConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl) &&
  supabaseKey.length > 20 && !supabaseKey.includes("YOUR_");

const elements = {
  addButton: document.querySelector("#addStudentButton"),
  addDialog: document.querySelector("#addStudentDialog"),
  addForm: document.querySelector("#addStudentForm"),
  nameInput: document.querySelector("#studentName"),
  formError: document.querySelector("#formError"),
  loginDialog: document.querySelector("#loginDialog"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#adminEmail"),
  loginPassword: document.querySelector("#adminPassword"),
  loginError: document.querySelector("#loginError"),
  loginSubmit: document.querySelector("#loginSubmit"),
  authButton: document.querySelector("#authButton"),
  accountNameButton: document.querySelector("#accountNameButton"),
  accountLabel: document.querySelector("#accountLabel"),
  displayNameDialog: document.querySelector("#displayNameDialog"),
  displayNameForm: document.querySelector("#displayNameForm"),
  displayNameInput: document.querySelector("#displayNameInput"),
  displayNameError: document.querySelector("#displayNameError"),
  displayNameSubmit: document.querySelector("#displayNameSubmit"),
  roleDot: document.querySelector("#roleDot"),
  studentTotal: document.querySelector("#studentTotal"),
  recordTotal: document.querySelector("#recordTotal"),
  attentionTotal: document.querySelector("#attentionTotal"),
  clearTotal: document.querySelector("#clearTotal"),
  rankingList: document.querySelector("#rankingList"),
  levelChart: document.querySelector("#levelChart"),
  studentTable: document.querySelector("#studentTable"),
  emptyState: document.querySelector("#emptyState"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyDescription: document.querySelector("#emptyDescription"),
  emptyAddButton: document.querySelector("#emptyAddButton"),
  noResults: document.querySelector("#noResults"),
  searchInput: document.querySelector("#searchInput"),
  connectionStatus: document.querySelector("#connectionStatus"),
  toast: document.querySelector("#toast")
};

let students = [];
let activeRole = null;
let signedInDisplayName = "";
let canViewClass = false;
let session = loadSession();
let toastTimer;
let refreshPromise = null;

function loadSession() {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    const savedSession = JSON.parse(stored);
    if (typeof savedSession.access_token !== "string" || typeof savedSession.refresh_token !== "string") {
      throw new Error("已保存的登录信息格式无效。");
    }
    return savedSession;
  } catch (error) {
    console.error("无法读取管理员登录状态：", error);
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(nextSession) {
  try {
    if (nextSession) localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    else localStorage.removeItem(SESSION_KEY);
    session = nextSession;
    return true;
  } catch (error) {
    console.error("无法保存管理员登录状态：", error);
    showToast("浏览器无法保存登录状态，请检查隐私设置。", true);
    return false;
  }
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.remove("hidden");
  toastTimer = window.setTimeout(() => elements.toast.classList.add("hidden"), 3500);
}

function setConnectionStatus(message, isError = false) {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.classList.toggle("connection-error", isError);
}

function getErrorMessage(payload, fallback) {
  const message = payload?.msg || payload?.message || payload?.error_description || payload?.error;
  return typeof message === "string" && message ? message : fallback;
}

async function refreshSession() {
  if (!session?.refresh_token) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    saveSession(null);
    activeRole = null;
    canViewClass = false;
    students = [];
    render();
    throw new Error(getErrorMessage(result, "登录已过期，请重新登录。"));
  }
  if (!saveSession(result)) throw new Error("无法保存续期后的登录信息。");
  return result.access_token;
}

async function apiRequest(path, options = {}, canRefresh = true) {
  if (!isConfigured) throw new Error("请先在 config.js 中填写 Supabase 项目 URL 和 publishable/anon key。");

  const headers = new Headers(options.headers || {});
  headers.set("apikey", supabaseKey);
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  else headers.delete("Authorization");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(`${supabaseUrl}${path}`, { ...options, headers });
  if (response.status === 401 && session && canRefresh) {
    await refreshSession();
    return apiRequest(path, options, false);
  }

  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(getErrorMessage(result, `云端请求失败（${response.status}）。`));
  return result;
}

async function refreshRole() {
  if (!session) {
    activeRole = null;
    signedInDisplayName = "";
    canViewClass = false;
    return false;
  }
  const role = await apiRequest("/rest/v1/rpc/get_my_role", {
    method: "POST",
    body: "{}"
  });
  activeRole = Object.hasOwn(roleDetails, role) ? role : null;
  canViewClass = await apiRequest("/rest/v1/rpc/can_view_class", {
    method: "POST",
    body: "{}"
  }) === true;
  if (!canViewClass) {
    signedInDisplayName = "";
    return false;
  }
  try {
    const displayName = await apiRequest("/rest/v1/rpc/get_my_display_name", {
      method: "POST",
      body: "{}"
    });
    signedInDisplayName = typeof displayName === "string" ? displayName.trim() : "";
  } catch (error) {
    console.warn("无法读取账号自定义显示名，将使用默认名称：", error);
    signedInDisplayName = "";
  }
  return canViewClass;
}

function getSortedStudents() {
  return [...students].sort((left, right) =>
    right.count - left.count || left.name.localeCompare(right.name, "zh-CN")
  );
}

function getLevel(count) {
  return count > 0 ? Math.min(count, 6) : 0;
}

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderStats() {
  const recorded = students.filter((student) => student.count > 0).length;
  elements.studentTotal.textContent = students.length;
  elements.recordTotal.textContent = students.reduce((sum, student) => sum + student.count, 0);
  elements.attentionTotal.textContent = recorded;
  elements.clearTotal.textContent = students.length - recorded;
}

function renderRanking(sortedStudents) {
  if (sortedStudents.length === 0) {
    elements.rankingList.innerHTML = '<div class="rank-empty"><span>♧</span>添加同学后，这里会显示班级排行榜</div>';
    return;
  }

  elements.rankingList.innerHTML = sortedStudents.slice(0, 3).map((student, index) => {
    const rank = sortedStudents.findIndex((rankedStudent) => rankedStudent.count === student.count) + 1;
    const width = student.count === 0 ? 0 : Math.max(8, Math.round((student.count / 6) * 100));
    return `<div class="podium-place podium-slot-${index + 1} podium-rank-${rank}">
      <span class="podium-medal" aria-label="第 ${rank} 名">${rank}</span>
      <span class="student-name" title="${escapeHTML(student.name)}">${escapeHTML(student.name)}</span>
      <span class="podium-count"><strong>${student.count}</strong> 次</span>
      <span class="podium-track" aria-label="满分 6 次"><span class="rank-fill" style="width:${width}%"></span></span>
      <div class="podium-stand" aria-hidden="true"><span>${rank}</span></div>
    </div>`;
  }).join("");
}

function renderChart() {
  const counts = levels.map((level) => students.filter((student) => student.count === level).length);
  const maxStudents = Math.max(1, ...counts);
  elements.levelChart.innerHTML = counts.map((count, index) => {
    const height = count === 0 ? 0 : Math.max(7, Math.round((count / maxStudents) * 100));
    return `<div class="chart-column">
      <div class="bar-area"><span class="bar-value">${count}</span><div class="bar${count === 0 ? " zero" : ""}" style="height:${height}%"></div></div>
      <span class="bar-level">等级 ${index + 1}</span>
    </div>`;
  }).join("");
  elements.levelChart.setAttribute("aria-label", `等级人数：${counts.map((count, index) => `等级${index + 1} ${count}人`).join("，")}`);
}

function renderTable(sortedStudents) {
  const query = elements.searchInput.value.trim().toLocaleLowerCase();
  const visibleStudents = sortedStudents.filter((student) => student.name.toLocaleLowerCase().includes(query));
  const permissions = roleDetails[activeRole] || {
    canRecord: false, canAddStudents: false, canRemoveStudents: false
  };

  elements.studentTable.innerHTML = visibleStudents.map((student) => {
    const rank = sortedStudents.findIndex((rankedStudent) => rankedStudent.count === student.count) + 1;
    const level = getLevel(student.count);
    const recordDisabled = !permissions.canRecord || student.count >= 6;
    const undoDisabled = !permissions.canRecord || student.count === 0;
    const removeButton = permissions.canRemoveStudents
      ? `<button class="action-button undo" type="button" data-action="remove" data-id="${escapeHTML(student.id)}" aria-label="移除${escapeHTML(student.name)}">移除</button>`
      : "";
    return `<tr>
      <td><span class="table-rank${rank === 1 ? " top-rank" : ""}">${rank}</span></td>
      <td><span class="name-cell"><span class="avatar">${escapeHTML(student.name.slice(0, 1))}</span>${escapeHTML(student.name)}</span></td>
      <td><span class="count-pill${student.count > 0 ? " has-records" : ""}">${student.count} 次</span></td>
      <td><span class="level-pill${level > 0 ? " has-level" : ""}"><span class="level-dot"></span>${level > 0 ? `等级 ${level}` : "未记录"}</span></td>
      <td><div class="progress-track" role="img" aria-label="等级进度 ${student.count} / 6"><div class="progress-fill" style="width:${(student.count / 6) * 100}%"></div></div></td>
      <td><span class="row-actions"><button class="action-button" type="button" data-action="record" data-id="${escapeHTML(student.id)}" ${recordDisabled ? "disabled" : ""}>＋ 记录</button><button class="action-button undo" type="button" data-action="undo" data-id="${escapeHTML(student.id)}" ${undoDisabled ? "disabled" : ""}>撤销</button>${removeButton}</span></td>
    </tr>`;
  }).join("");

  const noStudents = students.length === 0;
  elements.emptyState.classList.toggle("hidden", !noStudents);
  const canSeeRoster = canViewClass && Boolean(session);
  elements.emptyTitle.textContent = canSeeRoster ? "还没有添加同学" : "请登录后查看班级名单";
  elements.emptyDescription.textContent = canSeeRoster
    ? "添加班级同学后，就可以开始记录英语作业情况啦。"
    : "名单仅对获准的查看账号开放，请使用老师提供的账号登录。";
  elements.emptyAddButton.classList.toggle("hidden", !permissions.canAddStudents);
  elements.noResults.classList.toggle("hidden", noStudents || visibleStudents.length > 0);
  elements.studentTable.classList.toggle("hidden", noStudents || visibleStudents.length === 0);
}

function renderAccount() {
  const defaultDisplayName = typeof config?.adminDisplayName === "string"
    ? config.adminDisplayName.trim()
    : "";
  const accountName = signedInDisplayName || (activeRole
    ? defaultDisplayName || "管理员"
    : "只读查看");
  const canEditDisplayName = Boolean(session && canViewClass);
  elements.accountLabel.textContent = session
    ? canViewClass ? accountName : "未获准查看"
    : "登录查看";
  elements.accountNameButton.textContent = accountName;
  elements.accountNameButton.hidden = !canEditDisplayName;
  elements.accountLabel.hidden = canEditDisplayName;
  elements.roleDot.classList.toggle("signed-in", Boolean(session));
  elements.authButton.textContent = session ? "退出登录" : "登录查看";
  elements.authButton.classList.toggle("sign-out", Boolean(session));
  const role = roleDetails[activeRole];
  elements.addButton.disabled = !role?.canAddStudents;
  elements.addButton.title = role?.canAddStudents ? "" : "请使用二级或三级管理员账号登录";
}

function render() {
  const sortedStudents = getSortedStudents();
  renderStats();
  renderRanking(sortedStudents);
  renderChart();
  renderTable(sortedStudents);
  renderAccount();
}

async function loadCloudData({ quiet = false, force = false } = {}) {
  if (!isConfigured) return false;
  if (refreshPromise) {
    const pendingRefresh = refreshPromise;
    const previousResult = await pendingRefresh;
    if (!force) return previousResult;
  }

  const currentRefresh = (async () => {
    try {
      if (!session) {
        activeRole = null;
        canViewClass = false;
        signedInDisplayName = "";
        students = [];
        render();
        setConnectionStatus("请登录后查看名单");
        return false;
      }
      if (!await refreshRole()) {
        students = [];
        render();
        setConnectionStatus("账号尚未获准查看", true);
        if (!quiet) showToast("此账号没有查看名单的权限，请联系老师。", true);
        return false;
      }
      const [studentRows, recordRows] = await Promise.all([
        apiGetAll("/rest/v1/students?select=id,name,created_at&order=name.asc"),
        apiGetAll("/rest/v1/homework_records?select=id,student_id,action,target_record_id,created_at")
      ]);
      const undoneRecordIds = new Set(
        recordRows.filter((record) => record.action === "undo").map((record) => record.target_record_id)
      );
      const countsByStudent = new Map();
      for (const record of recordRows) {
        if (record.action === "record" && !undoneRecordIds.has(record.id)) {
          countsByStudent.set(record.student_id, (countsByStudent.get(record.student_id) || 0) + 1);
        }
      }
      students = studentRows.map((student) => ({
        id: student.id,
        name: student.name,
        count: countsByStudent.get(student.id) || 0
      }));
      render();
      setConnectionStatus(`云端已同步 · ${new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit", minute: "2-digit"
      }).format(new Date())}`);
      return true;
    } catch (error) {
      console.error("无法同步 Supabase 数据：", error);
      activeRole = null;
      canViewClass = false;
      students = [];
      render();
      setConnectionStatus("云端连接失败", true);
      if (!quiet) showToast(error.message || "无法连接 Supabase，请检查配置和网络。", true);
      return false;
    }
  })();
  refreshPromise = currentRefresh;
  try {
    return await currentRefresh;
  } finally {
    if (refreshPromise === currentRefresh) refreshPromise = null;
  }
}

async function apiGetAll(path) {
  const pageSize = 1000;
  const allRows = [];
  for (let offset = 0; ; offset += pageSize) {
    const rows = await apiRequest(path, {
      headers: { Range: `${offset}-${offset + pageSize - 1}` }
    });
    if (!Array.isArray(rows)) throw new Error("Supabase 返回了无法识别的数据格式。");
    allRows.push(...rows);
    if (rows.length < pageSize) return allRows;
  }
}

async function callRpc(functionName, body) {
  await apiRequest(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  return loadCloudData({ force: true });
}

function openAddDialog() {
  if (!roleDetails[activeRole]?.canAddStudents) {
    showToast("请使用二级或三级管理员账号登录后添加同学。", true);
    return;
  }
  elements.formError.classList.add("hidden");
  elements.nameInput.value = "";
  elements.addDialog.showModal();
  elements.nameInput.focus();
}

async function updateStudent(id, action) {
  const student = students.find((item) => item.id === id);
  if (!student) {
    showToast("没有找到这位同学，请刷新后重试。", true);
    return;
  }
  const functionNames = {
    record: "record_homework",
    undo: "undo_homework_record",
    remove: "archive_student"
  };
  if (!functionNames[action]) return;
  if (action === "remove" && !window.confirm(`确定移除「${student.name}」及其记录吗？历史记录将保留在审计日志中。`)) return;

  try {
    const synced = await callRpc(functionNames[action], { p_student_id: id });
    if (!synced) {
      showToast("操作已提交，但列表刷新失败；请检查网络后重试同步。", true);
      return;
    }
    if (action === "record") showToast(`已记录 ${student.name}。`);
    if (action === "undo") showToast(`已撤销 ${student.name} 最近一次记录。`);
    if (action === "remove") showToast(`已移除 ${student.name}。`);
  } catch (error) {
    console.error(`操作 ${action} 失败：`, error);
    showToast(error.message || "操作失败，请检查管理员权限和网络。", true);
    await loadCloudData({ quiet: true });
  }
}

elements.addButton.addEventListener("click", openAddDialog);
elements.emptyAddButton.addEventListener("click", openAddDialog);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => elements.addDialog.close());
});
document.querySelectorAll("[data-close-login]").forEach((button) => {
  button.addEventListener("click", () => elements.loginDialog.close());
});
document.querySelectorAll("[data-close-display-name]").forEach((button) => {
  button.addEventListener("click", () => elements.displayNameDialog.close());
});

elements.accountNameButton.addEventListener("click", () => {
  if (!session || !canViewClass) return;
  elements.displayNameInput.value = signedInDisplayName || (
    activeRole && typeof config?.adminDisplayName === "string"
      ? config.adminDisplayName.trim()
      : ""
  );
  elements.displayNameError.classList.add("hidden");
  elements.displayNameDialog.showModal();
  elements.displayNameInput.focus();
});

elements.displayNameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const displayName = elements.displayNameInput.value.trim();
  if (!displayName || displayName.length > 30) {
    elements.displayNameError.textContent = "请输入 1 至 30 个字符的显示名称。";
    elements.displayNameError.classList.remove("hidden");
    return;
  }
  elements.displayNameSubmit.disabled = true;
  try {
    await apiRequest("/rest/v1/rpc/update_my_display_name", {
      method: "POST",
      body: JSON.stringify({ p_display_name: displayName })
    });
    signedInDisplayName = displayName;
    render();
    elements.displayNameDialog.close();
    showToast("显示名称已更新。");
  } catch (error) {
    console.error("更新账号显示名称失败：", error);
    elements.displayNameError.textContent = error.message || "保存失败，请检查数据库是否已更新。";
    elements.displayNameError.classList.remove("hidden");
  } finally {
    elements.displayNameSubmit.disabled = false;
  }
});

elements.addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!roleDetails[activeRole]?.canAddStudents) {
    showToast("请使用二级或三级管理员账号登录后添加同学。", true);
    return;
  }
  const name = elements.nameInput.value.trim();
  if (!name) {
    elements.formError.textContent = "请输入同学姓名。";
    elements.formError.classList.remove("hidden");
    return;
  }
  const submitButton = elements.addForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    await apiRequest("/rest/v1/rpc/add_student", {
      method: "POST",
      body: JSON.stringify({ p_name: name })
    });
    elements.addDialog.close();
    if (await loadCloudData({ force: true })) showToast(`已添加 ${name}。`);
    else showToast(`已添加 ${name}，但云端列表刷新失败，请检查网络。`, true);
  } catch (error) {
    console.error("添加同学失败：", error);
    elements.formError.textContent = error.message.includes("students_active_name_unique")
      ? "这个名字已经添加过了，请检查后再试。"
      : error.message || "添加失败，请检查管理员权限和网络。";
    elements.formError.classList.remove("hidden");
  } finally {
    submitButton.disabled = false;
  }
});

elements.studentTable.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  updateStudent(button.dataset.id, button.dataset.action);
});

elements.authButton.addEventListener("click", async () => {
  if (!session) {
    elements.loginError.classList.add("hidden");
    elements.loginForm.reset();
    elements.loginDialog.showModal();
    elements.loginEmail.focus();
    return;
  }
  const currentSession = session;
  saveSession(null);
  activeRole = null;
  canViewClass = false;
  signedInDisplayName = "";
  students = [];
  render();
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${currentSession.access_token}` }
    });
    if (!response.ok) throw new Error(`注销请求失败（${response.status}）。`);
    showToast("已退出管理员账号。");
  } catch (error) {
    console.error("Supabase 退出请求失败：", error);
    showToast("已在本设备退出；服务器注销请求未完成。", true);
  }
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isConfigured) {
    elements.loginError.textContent = "请先在 config.js 中填写 Supabase 项目 URL 和 publishable/anon key。";
    elements.loginError.classList.remove("hidden");
    return;
  }
  elements.loginSubmit.disabled = true;
  elements.loginError.classList.add("hidden");
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: elements.loginEmail.value.trim(),
        password: elements.loginPassword.value
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getErrorMessage(result, "登录失败，请检查邮箱和密码。"));
    if (!saveSession(result)) throw new Error("无法保存登录状态，请检查浏览器设置。");
    elements.loginDialog.close();
    const synced = await loadCloudData({ force: true });
    if (!synced) {
      showToast(canViewClass
        ? "登录成功，但云端数据同步失败，请检查连接状态。"
        : "此账号尚未获准查看名单，请联系老师。", true);
    } else {
      showToast(activeRole
        ? `已登录：${roleDetails[activeRole].label}。`
        : "已登录只读查看账号。");
    }
  } catch (error) {
    console.error("管理员登录失败：", error);
    elements.loginError.textContent = error.message || "登录失败，请检查网络和账号设置。";
    elements.loginError.classList.remove("hidden");
  } finally {
    elements.loginSubmit.disabled = false;
  }
});

elements.searchInput.addEventListener("input", render);
elements.addDialog.addEventListener("click", (event) => {
  if (event.target === elements.addDialog) elements.addDialog.close();
});
elements.loginDialog.addEventListener("click", (event) => {
  if (event.target === elements.loginDialog) elements.loginDialog.close();
});
elements.displayNameDialog.addEventListener("click", (event) => {
  if (event.target === elements.displayNameDialog) elements.displayNameDialog.close();
});

document.querySelector("#today").textContent = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", weekday: "long"
}).format(new Date());

render();
if (isConfigured) {
  loadCloudData();
  window.setInterval(() => loadCloudData({ quiet: true }), 20000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadCloudData({ quiet: true });
  });
} else {
  setConnectionStatus("请配置 Supabase", true);
  showToast("网页已就绪，请先按 README 配置 Supabase 后才能共享数据。", true);
}
