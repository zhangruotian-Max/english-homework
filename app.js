const SESSION_KEY = "homework-trace-supabase-session-v1";
const levels = [1, 2, 3, 4, 5, 6];
const roleDetails = {
  level1: { label: "一级管理员", canRecord: true, canAddStudents: false, canRemoveStudents: false, canEditStudents: false },
  level2: { label: "二级管理员", canRecord: true, canAddStudents: true, canRemoveStudents: false, canEditStudents: false },
  level3: { label: "三级管理员", canRecord: true, canAddStudents: true, canRemoveStudents: true, canEditStudents: true }
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
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#adminPassword"),
  loginError: document.querySelector("#loginError"),
  loginSubmit: document.querySelector("#loginSubmit"),
  mainContent: document.querySelector(".main-content"),
  pageTrack: document.querySelector("#pageTrack"),
  pageTitle: document.querySelector("#pageTitle"),
  pageTabs: [...document.querySelectorAll(".page-tab")],
  pageArrows: [...document.querySelectorAll(".page-arrow")],
  managementPage: document.querySelector("#managementPage"),
  batchAddForm: document.querySelector("#batchAddForm"),
  batchStudentNames: document.querySelector("#batchStudentNames"),
  selectionCount: document.querySelector("#selectionCount"),
  managementSearchInput: document.querySelector("#managementSearchInput"),
  selectAllStudents: document.querySelector("#selectAllStudents"),
  managementStudentTable: document.querySelector("#managementStudentTable"),
  managementEmptyState: document.querySelector("#managementEmptyState"),
  editStudentDialog: document.querySelector("#editStudentDialog"),
  editStudentForm: document.querySelector("#editStudentForm"),
  editStudentId: document.querySelector("#editStudentId"),
  editStudentName: document.querySelector("#editStudentName"),
  editStudentError: document.querySelector("#editStudentError"),
  editStudentSubmit: document.querySelector("#editStudentSubmit"),
  logoutDialog: document.querySelector("#logoutDialog"),
  cancelLogout: document.querySelector("#cancelLogout"),
  confirmLogout: document.querySelector("#confirmLogout"),
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
  noResults: document.querySelector("#noResults"),
  searchInput: document.querySelector("#searchInput"),
  connectionStatus: document.querySelector("#connectionStatus"),
  toast: document.querySelector("#toast")
};

let students = [];
let activeRole = null;
let signedInDisplayName = "";
let canViewClass = false;
let currentPage = window.location.hash === "#management" ? 2 :
  window.location.hash === "#records-page" ? 1 : 0;
const selectedStudentIds = new Set();
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

function setAuthenticationRequired(required) {
  document.documentElement.classList.toggle("auth-checking", required);
  if (required) {
    if (!elements.loginDialog.open) elements.loginDialog.showModal();
  } else if (elements.loginDialog.open) {
    elements.loginDialog.close();
    window.requestAnimationFrame(() => navigateToPage(currentPage, false));
  } else {
    window.requestAnimationFrame(() => navigateToPage(currentPage, false));
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
    elements.loginError.textContent = "登录已过期，请重新登录。";
    elements.loginError.classList.remove("hidden");
    setAuthenticationRequired(true);
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
  const isAdministrator = Boolean(roleDetails[activeRole] && session && canViewClass);
  const activeStudentIds = new Set(students.map((student) => student.id));
  selectedStudentIds.forEach((id) => {
    if (!activeStudentIds.has(id)) selectedStudentIds.delete(id);
  });
  const query = elements.searchInput.value.trim().toLocaleLowerCase();
  const visibleStudents = sortedStudents.filter((student) => student.name.toLocaleLowerCase().includes(query));
  const permissions = roleDetails[activeRole] || {
    canRecord: false, canAddStudents: false, canRemoveStudents: false
  };

  elements.studentTable.innerHTML = visibleStudents.map((student) => {
    const rank = sortedStudents.findIndex((rankedStudent) => rankedStudent.count === student.count) + 1;
    const level = getLevel(student.count);
    return `<tr>
      <td><span class="table-rank${rank === 1 ? " top-rank" : ""}">${rank}</span></td>
      <td><span class="name-cell"><span class="avatar">${escapeHTML(student.name.slice(0, 1))}</span>${escapeHTML(student.name)}</span></td>
      <td><span class="count-pill${student.count > 0 ? " has-records" : ""}">${student.count} 次</span></td>
      <td><span class="level-pill${level > 0 ? " has-level" : ""}"><span class="level-dot"></span>${level > 0 ? `等级 ${level}` : "未记录"}</span></td>
      <td><div class="progress-track" role="img" aria-label="等级进度 ${student.count} / 6"><div class="progress-fill" style="width:${(student.count / 6) * 100}%"></div></div></td>
    </tr>`;
  }).join("");

  const noStudents = students.length === 0;
  elements.emptyState.classList.toggle("hidden", !noStudents);
  const canSeeRoster = canViewClass && Boolean(session);
  elements.emptyTitle.textContent = canSeeRoster ? "还没有添加同学" : "请登录后查看班级名单";
  elements.emptyDescription.textContent = canSeeRoster
    ? "添加班级同学后，就可以开始记录英语作业情况啦。"
    : "名单仅对获准的查看账号开放，请使用老师提供的账号登录。";
  elements.noResults.classList.toggle("hidden", noStudents || visibleStudents.length > 0);
  elements.studentTable.classList.toggle("hidden", noStudents || visibleStudents.length === 0);

  if (!isAdministrator) {
    elements.managementStudentTable.innerHTML = "";
    elements.managementEmptyState.classList.add("hidden");
    elements.selectionCount.textContent = "已选 0 人";
    elements.selectAllStudents.checked = false;
    elements.selectAllStudents.indeterminate = false;
    return;
  }

  const managementQuery = elements.managementSearchInput.value.trim().toLocaleLowerCase();
  const managementStudents = sortedStudents.filter((student) =>
    student.name.toLocaleLowerCase().includes(managementQuery)
  );
  elements.managementStudentTable.innerHTML = managementStudents.map((student) => {
    const level = getLevel(student.count);
    const checked = selectedStudentIds.has(student.id) ? "checked" : "";
    const actions = [
      `<button class="action-button" type="button" data-action="record" data-id="${escapeHTML(student.id)}" ${!permissions.canRecord || student.count >= 6 ? "disabled" : ""}>＋ 记录</button>`,
      `<button class="action-button undo" type="button" data-action="undo" data-id="${escapeHTML(student.id)}" ${!permissions.canRecord || student.count === 0 ? "disabled" : ""}>撤销</button>`
    ];
    if (permissions.canEditStudents) {
      actions.push(`<button class="action-button" type="button" data-action="edit" data-id="${escapeHTML(student.id)}">改名</button>`);
    }
    if (permissions.canRemoveStudents) {
      actions.push(`<button class="action-button undo" type="button" data-action="remove" data-id="${escapeHTML(student.id)}">移除</button>`);
    }
    return `<tr>
      <td><input type="checkbox" data-select-student="${escapeHTML(student.id)}" aria-label="选择${escapeHTML(student.name)}" ${checked}></td>
      <td><span class="name-cell"><span class="avatar">${escapeHTML(student.name.slice(0, 1))}</span>${escapeHTML(student.name)}</span></td>
      <td><span class="count-pill${student.count > 0 ? " has-records" : ""}">${student.count} 次</span></td>
      <td><span class="level-pill${level > 0 ? " has-level" : ""}"><span class="level-dot"></span>${level > 0 ? `等级 ${level}` : "未记录"}</span></td>
      <td><div class="progress-track" role="img" aria-label="等级进度 ${student.count} / 6"><div class="progress-fill" style="width:${(student.count / 6) * 100}%"></div></div></td>
      <td><span class="row-actions">${actions.join("")}</span></td>
    </tr>`;
  }).join("");
  elements.managementEmptyState.classList.toggle("hidden", managementStudents.length > 0);
  const selectedVisible = managementStudents.filter((student) => selectedStudentIds.has(student.id)).length;
  elements.selectionCount.textContent = `已选 ${selectedStudentIds.size} 人`;
  elements.selectAllStudents.checked = managementStudents.length > 0 &&
    selectedVisible === managementStudents.length;
  elements.selectAllStudents.indeterminate = selectedVisible > 0 &&
    selectedVisible < managementStudents.length;
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
  const isAdministrator = Boolean(role && session && canViewClass);
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", !isAdministrator);
    if (element === elements.managementPage) element.hidden = !isAdministrator;
  });
  document.querySelectorAll(".admin-level2-only").forEach((element) => {
    element.classList.toggle("hidden", !role?.canAddStudents);
  });
  document.querySelectorAll(".admin-level3-only").forEach((element) => {
    element.classList.toggle("hidden", !role?.canRemoveStudents);
  });
  elements.addButton.disabled = !role?.canAddStudents;
  elements.addButton.title = role?.canAddStudents ? "" : "请使用二级或三级管理员账号登录";
}

function updatePageState(index, updateHistory = false) {
  const maxPage = roleDetails[activeRole] && session && canViewClass ? 2 : 1;
  const pageIndex = Math.max(0, Math.min(maxPage, index));
  const changed = pageIndex !== currentPage;
  currentPage = pageIndex;
  elements.pageTabs.forEach((tab) => {
    const active = Number(tab.dataset.pageIndex) === currentPage;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  elements.pageTitle.textContent = ["班级总览", "每位同学的记录", "管理操作"][currentPage];
  elements.pageArrows.forEach((button) => {
    button.disabled = Number(button.dataset.pageStep) < 0
      ? currentPage === 0
      : currentPage === maxPage;
  });
  const pages = elements.pageTrack.querySelectorAll(".app-page");
  const activePage = elements.pageTrack.querySelector(`.app-page[data-page-index="${currentPage}"]`);
  pages.forEach((page) => {
    const offset = Number(page.dataset.pageIndex) - currentPage;
    page.style.transform = `translateX(${offset * 100}%)`;
  });
  if (activePage) {
    elements.pageTrack.style.height = `${activePage.offsetHeight}px`;
  }
  if (changed && updateHistory) {
    const hash = ["#overview", "#records-page", "#management"][currentPage];
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  }
}

function navigateToPage(index, updateHistory = true) {
  const maxPage = roleDetails[activeRole] && session && canViewClass ? 2 : 1;
  const pageIndex = Math.max(0, Math.min(maxPage, index));
  updatePageState(pageIndex, updateHistory);
}

function render() {
  const sortedStudents = getSortedStudents();
  renderStats();
  renderRanking(sortedStudents);
  renderChart();
  renderTable(sortedStudents);
  renderAccount();
  window.requestAnimationFrame(() => updatePageState(currentPage));
}

async function loadCloudData({ quiet = false, force = false } = {}) {
  if (!isConfigured) return false;
  if (refreshPromise) {
    const pendingRefresh = refreshPromise;
    const previousResult = await pendingRefresh;
    if (!force) return previousResult;
  }

  const currentRefresh = (async () => {
    let accessVerified = false;
    try {
      if (!session) {
        activeRole = null;
        canViewClass = false;
        signedInDisplayName = "";
        students = [];
        setAuthenticationRequired(true);
        render();
        setConnectionStatus("请登录后查看名单");
        return false;
      }
      if (!await refreshRole()) {
        students = [];
        setAuthenticationRequired(true);
        elements.loginError.textContent = "此账号尚未获准查看名单，请联系老师。";
        elements.loginError.classList.remove("hidden");
        render();
        setConnectionStatus("账号尚未获准查看", true);
        return false;
      }
      accessVerified = true;
      setAuthenticationRequired(false);
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
      students = [];
      render();
      setConnectionStatus("云端连接失败", true);
      if (!accessVerified) {
        activeRole = null;
        canViewClass = false;
        setAuthenticationRequired(true);
        elements.loginError.textContent = error.message || "无法验证账号权限，请检查网络后重试。";
        elements.loginError.classList.remove("hidden");
        render();
      }
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
  if (action === "edit") {
    if (!roleDetails[activeRole]?.canEditStudents) {
      showToast("请使用三级管理员账号修改同学姓名。", true);
      return;
    }
    elements.editStudentId.value = student.id;
    elements.editStudentName.value = student.name;
    elements.editStudentError.classList.add("hidden");
    elements.editStudentDialog.showModal();
    elements.editStudentName.focus();
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
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => elements.addDialog.close());
});
document.querySelectorAll("[data-close-edit-dialog]").forEach((button) => {
  button.addEventListener("click", () => elements.editStudentDialog.close());
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

elements.editStudentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!roleDetails[activeRole]?.canEditStudents) {
    showToast("请使用三级管理员账号修改同学姓名。", true);
    return;
  }
  const studentId = elements.editStudentId.value;
  const name = elements.editStudentName.value.trim();
  if (!name || name.length > 20) {
    elements.editStudentError.textContent = "姓名需为 1 至 20 个字符。";
    elements.editStudentError.classList.remove("hidden");
    return;
  }
  elements.editStudentSubmit.disabled = true;
  try {
    await apiRequest("/rest/v1/rpc/rename_student", {
      method: "POST",
      body: JSON.stringify({ p_student_id: studentId, p_name: name })
    });
    elements.editStudentDialog.close();
    if (await loadCloudData({ force: true })) showToast("同学姓名已修改。");
    else showToast("姓名修改已提交，但名单刷新失败，请检查网络。", true);
  } catch (error) {
    console.error("修改同学姓名失败：", error);
    elements.editStudentError.textContent = error.message.includes("students_active_name_unique")
      ? "这个名字已被使用，请换一个名字。"
      : error.message || "修改失败，请检查管理员权限和网络。";
    elements.editStudentError.classList.remove("hidden");
  } finally {
    elements.editStudentSubmit.disabled = false;
  }
});

elements.batchAddForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!roleDetails[activeRole]?.canAddStudents) {
    showToast("请使用二级或三级管理员账号批量添加同学。", true);
    return;
  }
  const names = elements.batchStudentNames.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  if (names.length === 0 || names.length > 100) {
    showToast("请输入 1 至 100 个同学姓名，每行一人。", true);
    return;
  }
  if (!window.confirm(`确定批量添加 ${names.length} 位同学吗？`)) return;
  const submitButton = elements.batchAddForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    await apiRequest("/rest/v1/rpc/batch_add_students", {
      method: "POST",
      body: JSON.stringify({ p_names: names })
    });
    elements.batchStudentNames.value = "";
    if (await loadCloudData({ force: true })) showToast(`已添加 ${names.length} 位同学。`);
    else showToast("批量添加已提交，但名单刷新失败，请检查网络。", true);
  } catch (error) {
    console.error("批量添加同学失败：", error);
    showToast(error.message || "批量添加失败；本批次未完成，请检查姓名是否重复。", true);
  } finally {
    submitButton.disabled = false;
  }
});

async function runBatchAction(action) {
  const studentIds = [...selectedStudentIds];
  if (studentIds.length === 0) {
    showToast("请先选择至少一位同学。", true);
    return;
  }
  const role = roleDetails[activeRole];
  const permissions = {
    record: role?.canRecord,
    undo: role?.canRecord,
    remove: role?.canRemoveStudents
  };
  if (!permissions[action]) {
    showToast(action === "remove"
      ? "请使用三级管理员账号批量移除同学。"
      : "请使用管理员账号执行批量记录或撤销。", true);
    return;
  }
  const actionLabels = {
    record: `给所选 ${studentIds.length} 位同学各记录 1 次`,
    undo: `撤销所选 ${studentIds.length} 位同学各最近 1 次记录`,
    remove: `移除所选 ${studentIds.length} 位同学`
  };
  if (!window.confirm(`确定${actionLabels[action]}吗？${action === "remove" ? "移除后同学不再显示，历史记录会保留。" : "若任一同学不符合条件，整批操作将不会执行。"}`)) return;

  const functionNames = {
    record: "batch_record_homework",
    undo: "batch_undo_homework_record",
    remove: "batch_archive_students"
  };
  try {
    await apiRequest(`/rest/v1/rpc/${functionNames[action]}`, {
      method: "POST",
      body: JSON.stringify({ p_student_ids: studentIds })
    });
    selectedStudentIds.clear();
    if (await loadCloudData({ force: true })) showToast("批量操作已完成。");
    else showToast("批量操作已提交，但名单刷新失败，请检查网络。", true);
  } catch (error) {
    console.error(`批量操作 ${action} 失败：`, error);
    showToast(error.message || "批量操作失败；本批次未执行，请检查所选同学状态。", true);
    await loadCloudData({ quiet: true });
  }
}

elements.managementStudentTable.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  updateStudent(button.dataset.id, button.dataset.action);
});
elements.managementStudentTable.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[data-select-student]");
  if (checkbox) {
    if (checkbox.checked) selectedStudentIds.add(checkbox.dataset.selectStudent);
    else selectedStudentIds.delete(checkbox.dataset.selectStudent);
    render();
  }
});
elements.selectAllStudents.addEventListener("change", () => {
  const query = elements.managementSearchInput.value.trim().toLocaleLowerCase();
  const visibleStudents = getSortedStudents().filter((student) =>
    student.name.toLocaleLowerCase().includes(query)
  );
  visibleStudents.forEach((student) => {
    if (elements.selectAllStudents.checked) selectedStudentIds.add(student.id);
    else selectedStudentIds.delete(student.id);
  });
  render();
});
document.querySelectorAll("[data-batch-action]").forEach((button) => {
  button.addEventListener("click", () => runBatchAction(button.dataset.batchAction));
});

elements.authButton.addEventListener("click", async () => {
  if (!session) {
    elements.loginError.classList.add("hidden");
    elements.loginForm.reset();
    setAuthenticationRequired(true);
    elements.loginUsername.focus();
    return;
  }
  elements.logoutDialog.showModal();
});

async function signOut() {
  elements.logoutDialog.close();
  const currentSession = session;
  if (!saveSession(null)) return;
  activeRole = null;
  canViewClass = false;
  signedInDisplayName = "";
  students = [];
  elements.loginError.classList.add("hidden");
  setAuthenticationRequired(true);
  render();
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${currentSession.access_token}` }
    });
    if (!response.ok) throw new Error(`注销请求失败（${response.status}）。`);
    elements.loginError.classList.add("hidden");
  } catch (error) {
    console.error("Supabase 退出请求失败：", error);
    elements.loginError.textContent = "已在此设备退出，但服务器注销请求未完成。";
    elements.loginError.classList.remove("hidden");
  }
}

elements.cancelLogout.addEventListener("click", () => elements.logoutDialog.close());
elements.confirmLogout.addEventListener("click", signOut);

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
    const response = await fetch(`${supabaseUrl}/functions/v1/username-login`, {
      method: "POST",
      headers: { apikey: supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: elements.loginUsername.value.trim(),
        password: elements.loginPassword.value
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getErrorMessage(result, "登录失败，请检查用户名和密码。"));
    if (!saveSession(result)) throw new Error("无法保存登录状态，请检查浏览器设置。");
    const synced = await loadCloudData({ force: true });
    if (!synced && !canViewClass) {
      elements.loginError.textContent = "此账号尚未获准查看名单，请联系老师。";
      elements.loginError.classList.remove("hidden");
    } else {
      elements.loginError.classList.add("hidden");
      if (synced) {
        showToast(activeRole
          ? `已登录：${roleDetails[activeRole].label}。`
          : "已登录只读查看账号。");
      }
    }
  } catch (error) {
    console.error("账号登录失败：", error);
    elements.loginError.textContent = error.message || "登录失败，请检查网络和账号设置。";
    elements.loginError.classList.remove("hidden");
  } finally {
    elements.loginSubmit.disabled = false;
  }
});

elements.searchInput.addEventListener("input", render);
elements.managementSearchInput.addEventListener("input", render);
elements.pageTabs.forEach((tab) => {
  tab.addEventListener("click", () => navigateToPage(Number(tab.dataset.pageIndex)));
});
elements.pageArrows.forEach((button) => {
  button.addEventListener("click", () => {
    navigateToPage(currentPage + Number(button.dataset.pageStep));
  });
});
let swipeStart = null;
function beginSwipe(target, pointerId, x, y) {
  swipeStart = null;
  if (target.closest("button, input, textarea, select, label, a")) return;
  swipeStart = { pointerId, x, y };
}
function finishSwipe(pointerId, x, y) {
  if (!swipeStart || pointerId !== swipeStart.pointerId) return;
  const deltaX = x - swipeStart.x;
  const deltaY = y - swipeStart.y;
  const swipeThreshold = Math.max(48, elements.pageTrack.clientWidth * 0.08);
  if (Math.abs(deltaX) >= swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
    navigateToPage(currentPage + (deltaX < 0 ? 1 : -1));
  }
  swipeStart = null;
}
elements.pageTrack.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.pointerType === "touch") return;
  if (event.button !== 0) return;
  beginSwipe(event.target, event.pointerId, event.clientX, event.clientY);
});
window.addEventListener("pointerup", (event) => {
  if (event.pointerType === "touch") return;
  finishSwipe(event.pointerId, event.clientX, event.clientY);
});
window.addEventListener("pointercancel", (event) => {
  if (event.pointerType === "touch") return;
  if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
  swipeStart = null;
});
elements.pageTrack.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 1) {
    swipeStart = null;
    return;
  }
  const touch = event.changedTouches[0];
  beginSwipe(event.target, touch.identifier, touch.clientX, touch.clientY);
}, { passive: true });
window.addEventListener("touchend", (event) => {
  if (!swipeStart) return;
  const touch = [...event.changedTouches].find(({ identifier }) => identifier === swipeStart.pointerId);
  if (touch) finishSwipe(touch.identifier, touch.clientX, touch.clientY);
}, { passive: true });
window.addEventListener("touchcancel", () => {
  swipeStart = null;
}, { passive: true });
let horizontalWheelDelta = 0;
let wheelGestureNavigated = false;
let wheelGestureTimer = 0;
elements.mainContent.addEventListener("wheel", (event) => {
  const deltaX = event.deltaX || (event.shiftKey ? event.deltaY : 0);
  if (!deltaX) return;
  const scrollableTable = event.target.closest(".table-wrap");
  if (scrollableTable && scrollableTable.scrollWidth > scrollableTable.clientWidth) {
    const canScroll = deltaX < 0
      ? scrollableTable.scrollLeft > 0
      : scrollableTable.scrollLeft + scrollableTable.clientWidth < scrollableTable.scrollWidth - 1;
    if (canScroll) return;
  }
  event.preventDefault();
  if (!wheelGestureNavigated) {
    horizontalWheelDelta += deltaX;
    const wheelThreshold = Math.max(48, elements.pageTrack.clientWidth * 0.08);
    if (Math.abs(horizontalWheelDelta) >= wheelThreshold) {
      navigateToPage(currentPage + (horizontalWheelDelta > 0 ? 1 : -1));
      horizontalWheelDelta = 0;
      wheelGestureNavigated = true;
    }
  }
  window.clearTimeout(wheelGestureTimer);
  wheelGestureTimer = window.setTimeout(() => {
    horizontalWheelDelta = 0;
    wheelGestureNavigated = false;
  }, 180);
}, { passive: false });
window.addEventListener("blur", () => {
  swipeStart = null;
});
window.addEventListener("resize", () => {
  updatePageState(currentPage);
});
window.addEventListener("popstate", () => {
  const pageIndex = window.location.hash === "#management" ? 2 :
    window.location.hash === "#records-page" ? 1 : 0;
  navigateToPage(pageIndex, false);
});
elements.addDialog.addEventListener("click", (event) => {
  if (event.target === elements.addDialog) elements.addDialog.close();
});
elements.editStudentDialog.addEventListener("click", (event) => {
  if (event.target === elements.editStudentDialog) elements.editStudentDialog.close();
});
elements.loginDialog.addEventListener("click", (event) => {
  if (event.target === elements.loginDialog) event.preventDefault();
});
elements.loginDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
});
elements.displayNameDialog.addEventListener("click", (event) => {
  if (event.target === elements.displayNameDialog) elements.displayNameDialog.close();
});

document.querySelector("#today").textContent = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "long", day: "numeric", weekday: "long"
}).format(new Date());

setAuthenticationRequired(true);
render();
if (isConfigured) {
  loadCloudData();
  window.setInterval(() => loadCloudData({ quiet: true }), 20000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadCloudData({ quiet: true });
  });
} else {
  setConnectionStatus("请配置 Supabase", true);
  elements.loginError.textContent = "请先按 README 配置 Supabase，之后才能登录查看。";
  elements.loginError.classList.remove("hidden");
}
