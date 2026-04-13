/* global MQSS_DATA */

(function () {
  const state = {
    raw: Array.isArray(window.MQSS_DATA) ? window.MQSS_DATA : [],
    records: [],
    filtered: [],
    view: "timeline",
    search: "",
    filters: {
      project: "ALL",
      status: "ALL",
      priority: "ALL",
      state: "ALL",
      startDateFrom: "",
      endDateTo: "",
      assignee: "ALL",
    },
    sort: "startAsc",
    projectSort: "nameAsc",
    page: 1,
    pageSize: 120,
    selectedId: null,
    collapsedProjects: {},
  };

  const el = {
    content: document.getElementById("content"),
    stats: document.getElementById("stats"),
    searchInput: document.getElementById("searchInput"),
    sortSelect: document.getElementById("sortSelect"),
    projectFilter: document.getElementById("projectFilter"),
    statusFilter: document.getElementById("statusFilter"),
    priorityFilter: document.getElementById("priorityFilter"),
    stateFilter: document.getElementById("stateFilter"),
    resetFilters: document.getElementById("resetFilters"),
    timelineBtn: document.getElementById("timelineBtn"),
    tableBtn: document.getElementById("tableBtn"),
    detailPanel: document.getElementById("detailPanel"),
    detailBody: document.getElementById("detailBody"),
    closeDetail: document.getElementById("closeDetail"),
    ghToken: document.getElementById("ghToken"),
    refreshBtn: document.getElementById("refreshBtn"),
    refreshStatus: document.getElementById("refreshStatus"),
    saveDataBtn: document.getElementById("saveDataBtn"),
    projectSortSelect: document.getElementById("projectSortSelect"),
    startDateFrom: document.getElementById("startDateFrom"),
    endDateTo: document.getElementById("endDateTo"),
    assigneeFilter: document.getElementById("assigneeFilter"),
    skipClosedProjects: document.getElementById("skipClosedProjects"),
    skipClosedIssues: document.getElementById("skipClosedIssues"),
  };

  const sortOptions = [
    { value: "startAsc", label: "Start date: earliest" },
    { value: "endAsc", label: "End date: earliest" },
    { value: "updatedDesc", label: "Recently updated" },
    { value: "priorityDesc", label: "Priority: high to low" },
    { value: "titleAsc", label: "Title: A to Z" },
  ];

  const projectSortOptions = [
    { value: "nameAsc",   label: "Name: A → Z" },
    { value: "nameDesc",  label: "Name: Z → A" },
    { value: "startAsc",  label: "Start: earliest" },
    { value: "startDesc", label: "Start: latest" },
    { value: "endAsc",    label: "End: earliest" },
    { value: "endDesc",   label: "End: latest" },
    { value: "countDesc", label: "Most items first" },
  ];

  const priorityRank = {
    "High-priority": 3,
    "Medium-priority": 2,
    "Low-priority": 1,
    "Not set": 0,
  };

  function safeDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function isoDate(d) {
    if (!d) return "No date";
    return d.toISOString().slice(0, 10);
  }

  function normalize(row) {
    const fields = row.fields || {};
    const status = fields.Status || "Not set";
    const priority = fields.Priority || "Not set";
    const title = row.title || fields.Title || "Untitled item";

    return {
      id: row.item_id,
      projectTitle: row.project_title || "Unknown project",
      projectNumber: row.project_number || 0,
      projectUrl: row.project_url || "",
      contentType: row.content_type || "DraftIssueOrRedacted",
      repo: row.repo || "No repo",
      number: row.number,
      title,
      state: row.state || "UNKNOWN",
      url: row.url || "",
      status,
      priority,
      startDate: safeDate(fields["Start date"]),
      endDate: safeDate(fields["End date"]),
      updatedAt: safeDate(row.item_updatedAt),
      createdAt: safeDate(row.item_createdAt),
      assignees: Array.isArray(row.assignees) ? row.assignees : [],
      fields,
      raw: row,
    };
  }

  function bySort(a, b) {
    if (state.sort === "startAsc") return (a.startDate?.getTime() || Infinity) - (b.startDate?.getTime() || Infinity);
    if (state.sort === "endAsc") return (a.endDate?.getTime() || Infinity) - (b.endDate?.getTime() || Infinity);
    if (state.sort === "updatedDesc") return (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0);
    if (state.sort === "priorityDesc") return (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0);
    return a.title.localeCompare(b.title);
  }

  function uniqueValues(list, key) {
    return ["ALL"].concat(
      Array.from(new Set(list.map((x) => x[key]).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)))
    );
  }

  function projectValues(list) {
    return ["ALL"].concat(
      Array.from(new Set(list.map((x) => x.projectTitle).filter(Boolean))).sort((a, b) => a.localeCompare(b))
    );
  }

  function optionHTML(value) {
    return '<option value="' + value + '">' + value + '</option>';
  }

  function setupFilters() {
    el.projectFilter.innerHTML = projectValues(state.records).map(optionHTML).join("");
    el.statusFilter.innerHTML = uniqueValues(state.records, "status").map(optionHTML).join("");
    el.priorityFilter.innerHTML = uniqueValues(state.records, "priority").map(optionHTML).join("");
    el.stateFilter.innerHTML = uniqueValues(state.records, "state").map(optionHTML).join("");
    const allLogins = ["ALL", "Unassigned"].concat(
      Array.from(new Set(state.records.flatMap((r) => r.assignees))).sort((a, b) => a.localeCompare(b))
    );
    el.assigneeFilter.innerHTML = allLogins.map(optionHTML).join("");
  }

  function setupSort() {
    el.sortSelect.innerHTML = sortOptions.map((s) => '<option value="' + s.value + '">' + s.label + '</option>').join("");
    el.sortSelect.value = state.sort;
  }

  function applyFilters() {
    const q = state.search.trim().toLowerCase();

    state.filtered = state.records
      .filter((r) => {
        if (state.filters.project !== "ALL" && r.projectTitle !== state.filters.project) return false;
        if (state.filters.status !== "ALL" && r.status !== state.filters.status) return false;
        if (state.filters.priority !== "ALL" && r.priority !== state.filters.priority) return false;
        if (state.filters.state !== "ALL" && r.state !== state.filters.state) return false;
        if (state.filters.assignee !== "ALL") {
          if (state.filters.assignee === "Unassigned") {
            if (r.assignees.length > 0) return false;
          } else if (!r.assignees.includes(state.filters.assignee)) {
            return false;
          }
        }
        if (state.filters.startDateFrom) {
          const from = new Date(state.filters.startDateFrom);
          if (!r.startDate || r.startDate < from) return false;
        }
        if (state.filters.endDateTo) {
          const to = new Date(state.filters.endDateTo);
          if (!r.endDate || r.endDate > to) return false;
        }

        if (!q) return true;
        return [r.title, r.projectTitle, r.repo, r.status, r.priority].join(" ").toLowerCase().includes(q);
      })
      .sort(bySort);

    state.page = 1;
    updateStats();
    renderContent();
    persistState();
  }

  function pageSlice() {
    const start = (state.page - 1) * state.pageSize;
    return state.filtered.slice(start, start + state.pageSize);
  }

  function groupedByProject(rows) {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.projectTitle)) map.set(row.projectTitle, []);
      map.get(row.projectTitle).push(row);
    }
    return map;
  }

  function setupProjectSort() {
    el.projectSortSelect.innerHTML = projectSortOptions
      .map((o) => '<option value="' + o.value + '">' + o.label + '</option>')
      .join("");
    el.projectSortSelect.value = state.projectSort;
  }

  function sortedGroupEntries(map) {
    const entries = Array.from(map.entries());
    const s = state.projectSort;
    entries.sort(([aName, aItems], [bName, bItems]) => {
      if (s === "nameAsc")  return aName.localeCompare(bName);
      if (s === "nameDesc") return bName.localeCompare(aName);
      if (s === "countDesc") return bItems.length - aItems.length;
      const aw = getProjectWindow(aItems);
      const bw = getProjectWindow(bItems);
      if (s === "startAsc")  return (aw?.min?.getTime() ?? Infinity) - (bw?.min?.getTime() ?? Infinity);
      if (s === "startDesc") return (bw?.min?.getTime() ?? 0) - (aw?.min?.getTime() ?? 0);
      if (s === "endAsc")    return (aw?.max?.getTime() ?? Infinity) - (bw?.max?.getTime() ?? Infinity);
      if (s === "endDesc")   return (bw?.max?.getTime() ?? 0) - (aw?.max?.getTime() ?? 0);
      return 0;
    });
    return entries;
  }

  function getProjectWindow(items) {
    let min = null;
    let max = null;

    for (const item of items) {
      if (item.startDate) min = !min || item.startDate < min ? item.startDate : min;
      if (item.endDate) max = !max || item.endDate > max ? item.endDate : max;
      if (item.startDate && !max) max = item.startDate;
      if (item.endDate && !min) min = item.endDate;
    }

    if (!min && !max) return null;
    if (!min) min = max;
    if (!max) max = min;

    return {
      min,
      max,
      rangeMs: Math.max(1, max.getTime() - min.getTime()),
    };
  }

  function formatWindow(windowObj) {
    if (!windowObj) return "No schedule dates";
    return isoDate(windowObj.min) + " to " + isoDate(windowObj.max);
  }

  function getScheduleMetrics(item, windowObj) {
    if (!windowObj) return null;

    const hasStart = Boolean(item.startDate);
    const hasEnd = Boolean(item.endDate);
    if (!hasStart && !hasEnd) return null;

    let start = hasStart ? item.startDate.getTime() : item.endDate.getTime();
    let end = hasEnd ? item.endDate.getTime() : item.startDate.getTime();
    if (end < start) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    const minMs = windowObj.min.getTime();
    const maxMs = windowObj.max.getTime();
    start = Math.max(minMs, Math.min(maxMs, start));
    end = Math.max(minMs, Math.min(maxMs, end));

    const left = ((start - minMs) / windowObj.rangeMs) * 100;
    const width = ((end - start) / windowObj.rangeMs) * 100;
    const statusClass = String(item.status || "Not set").replace(/[^A-Za-z0-9]+/g, "_");

    return {
      left: Math.max(0, Math.min(100, left)),
      width: Math.max(1, width),
      overdue: Boolean(item.endDate && item.endDate.getTime() < Date.now() && item.state !== "CLOSED"),
      statusClass,
    };
  }

  function startOfMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  function addMonths(date, months) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  }

  function monthLabel(date) {
    return date.toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
  }

  function startOfQuarter(date) {
    const qMonth = Math.floor(date.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(date.getUTCFullYear(), qMonth, 1));
  }

  function addQuarters(date, quarters) {
    return addMonths(date, quarters * 3);
  }

  function quarterLabel(date) {
    const q = Math.floor(date.getUTCMonth() / 3) + 1;
    return "Q" + q + " " + date.getUTCFullYear();
  }

  function getGlobalWindow(items) {
    if (!items || !items.length) return null;
    const today = new Date();
    const min = startOfQuarter(addMonths(startOfMonth(today), -6));
    const max = addMonths(startOfMonth(today), 12);
    return {
      min,
      max,
      rangeMs: Math.max(1, max.getTime() - min.getTime()),
    };
  }

  function getQuarterSegments(windowObj) {
    if (!windowObj) return [];
    const segments = [];
    let cursor = startOfQuarter(windowObj.min);
    while (cursor < windowObj.max) {
      const next = addQuarters(cursor, 1);
      const left = ((cursor.getTime() - windowObj.min.getTime()) / windowObj.rangeMs) * 100;
      const width = ((next.getTime() - cursor.getTime()) / windowObj.rangeMs) * 100;
      const q = Math.floor(cursor.getUTCMonth() / 3) + 1;
      segments.push({
        label: 'Q' + q,
        left: Math.max(0, left),
        width: Math.max(0.5, width),
      });
      cursor = next;
    }
    return segments;
  }

  function getYearSegments(windowObj) {
    if (!windowObj) return [];
    const segments = [];
    let cursor = new Date(Date.UTC(windowObj.min.getUTCFullYear(), 0, 1));
    while (cursor < windowObj.max) {
      const next = new Date(Date.UTC(cursor.getUTCFullYear() + 1, 0, 1));
      const segStart = Math.max(cursor.getTime(), windowObj.min.getTime());
      const segEnd = Math.min(next.getTime(), windowObj.max.getTime());
      const left = ((segStart - windowObj.min.getTime()) / windowObj.rangeMs) * 100;
      const width = ((segEnd - segStart) / windowObj.rangeMs) * 100;
      segments.push({
        label: String(cursor.getUTCFullYear()),
        left: Math.max(0, left),
        width: Math.max(0.5, width),
      });
      cursor = next;
    }
    return segments;
  }

  function getTodayOffset(windowObj) {
    if (!windowObj) return null;
    const now = Date.now();
    if (now < windowObj.min.getTime() || now > windowObj.max.getTime()) return null;
    return ((now - windowObj.min.getTime()) / windowObj.rangeMs) * 100;
  }

  function renderTimeline() {
    const allGroups = groupedByProject(state.filtered);
    const allEntries = sortedGroupEntries(allGroups);

    if (!allEntries.length) {
      el.content.innerHTML = '<div class="empty">No results match current filters.</div>';
      return;
    }

    const start = (state.page - 1) * state.pageSize;
    const pageEntries = allEntries.slice(start, start + state.pageSize);

    const globalWindow = getGlobalWindow(state.filtered);
    const quarterSegments = getQuarterSegments(globalWindow);
    const yearSegments = getYearSegments(globalWindow);
    const todayOffset = getTodayOffset(globalWindow);
    const out = [];

    out.push('<section class="gantt-board">');
    out.push('<div class="gantt-header">');
    const anyExpanded = pageEntries.some(([p]) => !state.collapsedProjects[p]);
    out.push('<div class="gantt-header-left"><button id="collapseAllBtn" class="collapse-all-btn" title="' + (anyExpanded ? 'Collapse all' : 'Expand all') + '">' + (anyExpanded ? '&#8863;' : '&#8862;') + '</button><span>Task</span></div>');
    out.push('<div class="gantt-header-right">');
    for (const seg of yearSegments) {
      out.push('<div class="gantt-year" style="left:' + seg.left.toFixed(4) + '%;width:' + seg.width.toFixed(4) + '%;"><span>' + escapeHtml(seg.label) + '</span></div>');
    }
    for (const seg of quarterSegments) {
      out.push('<div class="gantt-quarter" style="left:' + seg.left.toFixed(4) + '%;width:' + seg.width.toFixed(4) + '%;"><span>' + escapeHtml(seg.label) + '</span></div>');
    }
    if (todayOffset !== null) {
      out.push('<div class="gantt-today-line" style="left:' + todayOffset.toFixed(4) + '%;"><span>Today</span></div>');
    }
    out.push('</div>');
    out.push('</div>');

    for (const [project, items] of pageEntries) {
      const projectWindow = getProjectWindow(items) || globalWindow;
      const projectSchedule = getScheduleMetrics({ startDate: projectWindow?.min || null, endDate: projectWindow?.max || null, state: "OPEN", status: "IN_PROGRESS" }, globalWindow);
      const key = encodeURIComponent(project);
      const collapsed = Boolean(state.collapsedProjects[project]);

      out.push('<article class="project-group gantt-project">');
      out.push('<header class="gantt-project-header">' +
        '<div class="gantt-left">' +
        '<button class="project-toggle" data-project="' + key + '">' + (collapsed ? '&#9658;' : '&#9662;') + '</button>' +
        '<span class="gantt-project-title">' + escapeHtml(project) + '</span>' +
        '<span class="pill">' + items.length + ' items</span>' +
        '</div>' +
        '<div class="gantt-right gantt-track project-track">');
      if (projectSchedule) {
        out.push('<div class="schedule-bar status-IN_PROGRESS" style="left:' + projectSchedule.left.toFixed(2) + '%;width:' + projectSchedule.width.toFixed(2) + '%;"></div>');
      }
      if (todayOffset !== null) {
        out.push('<div class="gantt-today-line" style="left:' + todayOffset.toFixed(4) + '%;"></div>');
      }
      out.push('</div>');
      out.push('<div class="timeline-date-col"><strong>Start</strong>' + isoDate(projectWindow?.min || null) + '</div>');
      out.push('<div class="timeline-date-col"><strong>End</strong>' + isoDate(projectWindow?.max || null) + '</div>');
      out.push('<div></div>');
      out.push('</header>');

      if (collapsed) {
        out.push('</article>');
        continue;
      }

      for (const item of items) {
        const statusCls = item.status.replace(/[^A-Za-z0-9]+/g, "_");
        const schedule = getScheduleMetrics(item, globalWindow);
        out.push('<div class="gantt-row">');
        out.push('<div class="gantt-left timeline-main">');
        out.push('<p class="item-title">' + escapeHtml(item.title) + '</p>');
        out.push('<div class="item-meta">');
        out.push('<span class="pill status-' + statusCls + '">' + escapeHtml(item.status) + '</span>');
        out.push('<span class="pill priority-' + item.priority + '">' + escapeHtml(item.priority) + '</span>');
        out.push('<span class="pill">' + escapeHtml(item.state) + '</span>');
        out.push('<span class="pill">' + escapeHtml(item.contentType) + '</span>');
        out.push('</div>');
        out.push('</div>');

        out.push('<div class="gantt-right gantt-track">');
        if (schedule) {
          out.push('<div class="schedule-bar status-' + schedule.statusClass + ' ' + (schedule.overdue ? 'overdue' : '') + '" style="left:' + schedule.left.toFixed(2) + '%;width:' + schedule.width.toFixed(2) + '%;"></div>');
        }
        if (todayOffset !== null) {
          out.push('<div class="gantt-today-line" style="left:' + todayOffset.toFixed(4) + '%;"></div>');
        }
        out.push('</div>');

        out.push('<div class="timeline-date-col"><strong>Start</strong>' + isoDate(item.startDate) + '</div>');
        out.push('<div class="timeline-date-col"><strong>End</strong>' + isoDate(item.endDate) + '</div>');
        out.push('<div class="item-actions"><button data-id="' + item.id + '" class="detail-btn">Details</button></div>');
        out.push('</div>');
      }
      out.push('</article>');
    }

    out.push('</section>');
    out.push(renderPager(allEntries.length));
    el.content.innerHTML = out.join("");
  }

  function renderTable() {
    const rows = pageSlice();
    if (!rows.length) {
      el.content.innerHTML = '<div class="empty">No results match current filters.</div>';
      return;
    }

    const out = [];
    out.push('<div class="table-wrap"><table><thead><tr>');
    out.push('<th>Project</th><th>Title</th><th>Status</th><th>Priority</th><th>State</th><th>Start</th><th>End</th><th>Updated</th><th></th>');
    out.push('</tr></thead><tbody>');

    for (const item of rows) {
      out.push('<tr>');
      out.push('<td>' + escapeHtml(item.projectTitle) + '</td>');
      out.push('<td class="row-title" title="' + escapeHtml(item.title) + '">' + escapeHtml(item.title) + '</td>');
      out.push('<td>' + escapeHtml(item.status) + '</td>');
      out.push('<td>' + escapeHtml(item.priority) + '</td>');
      out.push('<td>' + escapeHtml(item.state) + '</td>');
      out.push('<td>' + isoDate(item.startDate) + '</td>');
      out.push('<td>' + isoDate(item.endDate) + '</td>');
      out.push('<td>' + isoDate(item.updatedAt) + '</td>');
      out.push('<td><button data-id="' + item.id + '" class="detail-btn">Details</button></td>');
      out.push('</tr>');
    }

    out.push('</tbody></table></div>');
    out.push(renderPager());
    el.content.innerHTML = out.join("");
  }

  function renderPager(total) {
    if (total === undefined) total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    const disablePrev = state.page <= 1 ? "disabled" : "";
    const disableNext = state.page >= pages ? "disabled" : "";
    return '<div style="display:flex;justify-content:flex-end;gap:.5rem;padding:.6rem;">' +
      '<button id="prevPage" ' + disablePrev + '>Prev</button>' +
      '<span class="pill">Page ' + state.page + ' / ' + pages + '</span>' +
      '<button id="nextPage" ' + disableNext + '>Next</button>' +
      '</div>';
  }

  function renderContent() {
    if (state.view === "timeline") renderTimeline();
    else renderTable();
  }

  function updateStats() {
    const total = state.records.length;
    const shown = state.filtered.length;
    const open = state.filtered.filter((x) => x.state === "OPEN").length;
    const closed = state.filtered.filter((x) => x.state === "CLOSED").length;
    el.stats.innerHTML =
      '<div>Total records: <strong>' + total + '</strong></div>' +
      '<div>Matching now: <strong>' + shown + '</strong></div>' +
      '<div>Open: <strong>' + open + '</strong> Closed: <strong>' + closed + '</strong></div>';
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function openDetail(id) {
    const item = state.records.find((r) => r.id === id);
    if (!item) return;
    state.selectedId = id;

    const fieldsRows = Object.entries(item.fields)
      .map(([k, v]) => '<dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd>')
      .join("");

    const repoLink = item.url
      ? '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer">Open on GitHub</a>'
      : '<span class="pill">No GitHub URL</span>';

    el.detailBody.innerHTML =
      '<h3>' + escapeHtml(item.title) + '</h3>' +
      '<p>' + repoLink + '</p>' +
      '<dl>' +
      '<dt>Project</dt><dd>' + escapeHtml(item.projectTitle) + '</dd>' +
      '<dt>Repo</dt><dd>' + escapeHtml(item.repo) + '</dd>' +
      '<dt>Status</dt><dd>' + escapeHtml(item.status) + '</dd>' +
      '<dt>Priority</dt><dd>' + escapeHtml(item.priority) + '</dd>' +
      '<dt>State</dt><dd>' + escapeHtml(item.state) + '</dd>' +
      '<dt>Start date</dt><dd>' + isoDate(item.startDate) + '</dd>' +
      '<dt>End date</dt><dd>' + isoDate(item.endDate) + '</dd>' +
      '<dt>Updated</dt><dd>' + isoDate(item.updatedAt) + '</dd>' +
      fieldsRows +
      '</dl>';

    el.detailPanel.classList.add("open");
    el.detailPanel.setAttribute("aria-hidden", "false");
    persistState();
  }

  function closeDetail() {
    state.selectedId = null;
    el.detailPanel.classList.remove("open");
    el.detailPanel.setAttribute("aria-hidden", "true");
    persistState();
  }

  // ── GitHub live-fetch ──────────────────────────────────────────────────────

  const GH_API = "https://api.github.com/graphql";
  const GH_ORG = "MQSS-management";

  async function ghGql(token, query, variables) {
    const res = await fetch(GH_API, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error("GitHub API returned HTTP " + res.status);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));
    return json.data;
  }

  async function ghListProjects(token, org) {
    const query = `
      query($org: String!, $after: String) {
        organization(login: $org) {
          projectsV2(first: 50, after: $after) {
            nodes { id number title closed url updatedAt }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;
    let after = null;
    const out = [];
    while (true) {
      const data = await ghGql(token, query, { org, after });
      const page = data.organization.projectsV2;
      out.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    return out;
  }

  async function ghListProjectItems(token, projectId) {
    const query = `
      query($projectId: ID!, $after: String) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              nodes {
                id createdAt updatedAt
                content {
                  __typename
                  ... on Issue { id number title state url repository { nameWithOwner } assignees(first: 10) { nodes { login } } }
                  ... on PullRequest { id number title state url repository { nameWithOwner } assignees(first: 10) { nodes { login } } }
                }
                fieldValues(first: 50) {
                  nodes {
                    __typename
                    ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
                    ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `;
    let after = null;
    const items = [];
    while (true) {
      const data = await ghGql(token, query, { projectId, after });
      const page = data.node.items;
      items.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    return items;
  }

  function ghNormalizeFields(fieldValues) {
    const obj = {};
    for (const fv of fieldValues?.nodes ?? []) {
      const fieldName = fv?.field?.name;
      if (!fieldName) continue;
      if (fv.__typename === "ProjectV2ItemFieldTextValue") obj[fieldName] = fv.text;
      else if (fv.__typename === "ProjectV2ItemFieldNumberValue") obj[fieldName] = fv.number;
      else if (fv.__typename === "ProjectV2ItemFieldDateValue") obj[fieldName] = fv.date;
      else if (fv.__typename === "ProjectV2ItemFieldSingleSelectValue") obj[fieldName] = fv.name;
      else if (fv.__typename === "ProjectV2ItemFieldIterationValue") obj[fieldName] = fv.title;
    }
    return obj;
  }

  function setStatus(msg, cls) {
    el.refreshStatus.textContent = msg;
    el.refreshStatus.className = "gh-status" + (cls ? " " + cls : "");
  }

  async function loadFromGitHub() {
    const token = el.ghToken.value.trim();
    if (!token) { setStatus("Please enter a GitHub token.", "gh-status--error"); return; }

    el.refreshBtn.disabled = true;
    el.saveDataBtn.hidden = true;
    setStatus("Fetching projects…");

    try {
      const allProjects = await ghListProjects(token, GH_ORG);
      const projects = el.skipClosedProjects.checked
        ? allProjects.filter((p) => !p.closed)
        : allProjects;
      const consolidated = [];

      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        setStatus("Project " + (i + 1) + " / " + projects.length + ": " + p.title);
        const rawItems = await ghListProjectItems(token, p.id);
        const items = el.skipClosedIssues.checked
          ? rawItems.filter((it) => it.content?.state !== "CLOSED")
          : rawItems;
        for (const it of items) {
          consolidated.push({
            org: GH_ORG,
            project_number: p.number,
            project_title: p.title,
            project_url: p.url,
            project_closed: p.closed,
            item_id: it.id,
            item_createdAt: it.createdAt,
            item_updatedAt: it.updatedAt,
            content_type: it.content?.__typename ?? "DraftIssueOrRedacted",
            repo: it.content?.repository?.nameWithOwner ?? null,
            number: it.content?.number ?? null,
            title: it.content?.title ?? null,
            state: it.content?.state ?? null,
            url: it.content?.url ?? null,
            assignees: it.content?.assignees?.nodes?.map((a) => a.login) ?? [],
            fields: ghNormalizeFields(it.fieldValues),
          });
        }
      }

      // Reload UI with fresh data
      state.raw = consolidated;
      state.records = consolidated.map(normalize);
      state.page = 1;
      setupFilters();
      applyFilters();

      // Build download link
      const dataJs = "window.MQSS_DATA = " + JSON.stringify(consolidated, null, 2) + ";\n";

      const blobJs = new Blob([dataJs], { type: "text/javascript" });
      el.saveDataBtn.href = URL.createObjectURL(blobJs);
      el.saveDataBtn.textContent = "\u2193 Save data.js (" + consolidated.length + " items)";
      el.saveDataBtn.hidden = false;

      setStatus("Loaded " + consolidated.length + " items from " + projects.length + " projects.", "gh-status--success");
    } catch (err) {
      setStatus("Error: " + err.message, "gh-status--error");
    } finally {
      el.refreshBtn.disabled = false;
    }
  }

  // ── End GitHub live-fetch ───────────────────────────────────────────────────

  function bindEvents() {
    el.searchInput.addEventListener("input", (ev) => {
      state.search = ev.target.value;
      applyFilters();
    });

    el.sortSelect.addEventListener("change", (ev) => {
      state.sort = ev.target.value;
      applyFilters();
    });

    el.projectFilter.addEventListener("change", (ev) => {
      state.filters.project = ev.target.value;
      applyFilters();
    });

    el.statusFilter.addEventListener("change", (ev) => {
      state.filters.status = ev.target.value;
      applyFilters();
    });

    el.priorityFilter.addEventListener("change", (ev) => {
      state.filters.priority = ev.target.value;
      applyFilters();
    });

    el.stateFilter.addEventListener("change", (ev) => {
      state.filters.state = ev.target.value;
      applyFilters();
    });

    el.startDateFrom.addEventListener("change", (ev) => {
      state.filters.startDateFrom = ev.target.value;
      applyFilters();
    });

    el.endDateTo.addEventListener("change", (ev) => {
      state.filters.endDateTo = ev.target.value;
      applyFilters();
    });

    el.assigneeFilter.addEventListener("change", (ev) => {
      state.filters.assignee = ev.target.value;
      applyFilters();
    });

    el.resetFilters.addEventListener("click", () => {
      state.search = "";
      state.filters.project = "ALL";
      state.filters.status = "ALL";
      state.filters.priority = "ALL";
      state.filters.state = "ALL";
      state.filters.startDateFrom = "";
      state.filters.endDateTo = "";
      state.filters.assignee = "ALL";
      state.sort = "startAsc";
      state.page = 1;
      el.searchInput.value = "";
      el.projectFilter.value = "ALL";
      el.statusFilter.value = "ALL";
      el.priorityFilter.value = "ALL";
      el.stateFilter.value = "ALL";
      el.startDateFrom.value = "";
      el.endDateTo.value = "";
      el.assigneeFilter.value = "ALL";
      el.sortSelect.value = state.sort;
      applyFilters();
    });

    el.timelineBtn.addEventListener("click", () => {
      state.view = "timeline";
      el.timelineBtn.classList.add("active");
      el.tableBtn.classList.remove("active");
      renderContent();
      persistState();
    });

    el.tableBtn.addEventListener("click", () => {
      state.view = "table";
      el.tableBtn.classList.add("active");
      el.timelineBtn.classList.remove("active");
      renderContent();
      persistState();
    });

    el.content.addEventListener("click", (ev) => {
      const collapseAllBtn = ev.target.closest("#collapseAllBtn");
      if (collapseAllBtn) {
        const keys = Array.from(groupedByProject(state.filtered).keys());
        const anyExp = keys.some((p) => !state.collapsedProjects[p]);
        for (const k of keys) state.collapsedProjects[k] = anyExp;
        renderContent();
        persistState();
        return;
      }

      const toggleBtn = ev.target.closest(".project-toggle");
      if (toggleBtn) {
        const key = decodeURIComponent(toggleBtn.getAttribute("data-project") || "");
        if (key) {
          state.collapsedProjects[key] = !state.collapsedProjects[key];
          renderContent();
          persistState();
        }
        return;
      }

      const detailBtn = ev.target.closest(".detail-btn");
      if (detailBtn) {
        openDetail(detailBtn.getAttribute("data-id"));
        return;
      }

      const prev = ev.target.closest("#prevPage");
      if (prev && state.page > 1) {
        state.page -= 1;
        renderContent();
        persistState();
      }

      const next = ev.target.closest("#nextPage");
      const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
      if (next && state.page < pages) {
        state.page += 1;
        renderContent();
        persistState();
      }
    });

    el.closeDetail.addEventListener("click", closeDetail);
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeDetail();
    });

    el.refreshBtn.addEventListener("click", () => { loadFromGitHub(); });

    el.projectSortSelect.addEventListener("change", (ev) => {
      state.projectSort = ev.target.value;
      renderContent();
      persistState();
    });
  }

  function persistState() {
    const payload = {
      view: state.view,
      search: state.search,
      filters: state.filters,
      sort: state.sort,
      projectSort: state.projectSort,
      page: state.page,
      selectedId: state.selectedId,
      collapsedProjects: state.collapsedProjects,
    };
    localStorage.setItem("mqss_ui_state", JSON.stringify(payload));
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem("mqss_ui_state");
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;
      state.view = saved.view || state.view;
      state.search = saved.search || "";
      state.filters = Object.assign({}, state.filters, saved.filters || {});
      state.sort = saved.sort || state.sort;
      state.projectSort = saved.projectSort || state.projectSort;
      state.page = Number(saved.page) > 0 ? Number(saved.page) : 1;
      state.selectedId = saved.selectedId || null;
      state.collapsedProjects = Object.assign({}, saved.collapsedProjects || {});
    } catch (_) {
      // ignore malformed storage
    }
  }

  function applyRestoredControls() {
    el.searchInput.value = state.search;
    el.sortSelect.value = state.sort;
    el.projectSortSelect.value = state.projectSort;
    el.projectFilter.value = state.filters.project;
    el.statusFilter.value = state.filters.status;
    el.priorityFilter.value = state.filters.priority;
    el.stateFilter.value = state.filters.state;
    el.assigneeFilter.value = state.filters.assignee;
    el.startDateFrom.value = state.filters.startDateFrom || "";
    el.endDateTo.value = state.filters.endDateTo || "";

    if (state.view === "table") {
      el.tableBtn.classList.add("active");
      el.timelineBtn.classList.remove("active");
    } else {
      el.timelineBtn.classList.add("active");
      el.tableBtn.classList.remove("active");
    }
  }

  function init() {
    state.records = state.raw.map(normalize);

    setupSort();
    setupFilters();
    setupProjectSort();
    restoreState();
    applyRestoredControls();
    bindEvents();
    applyFilters();

    if (state.selectedId) openDetail(state.selectedId);
  }

  init();
})();
