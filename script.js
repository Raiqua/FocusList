'use strict';

/* =========================================================
   TaskFlow — application logic
   Single source of truth: `tasks` array.
   Every mutation -> saveTasks() -> render().
   ========================================================= */

const STORAGE_KEY = 'taskflow_tasks_v1';
const THEME_KEY = 'taskflow_theme';

const QUOTES = [
  'Small steps, done daily, beat big plans done never.',
  'Clarity comes from a shorter list, not a longer one.',
  'Start with the task you keep avoiding.',
  'Progress, not perfection.',
  'One task, fully finished, beats five half-done.',
  'Write it down. Free your mind to focus.'
];

/** @type {{id:number, title:string, priority:'high'|'medium'|'low', completed:boolean, createdAt:string}[]} */
let tasks = [];

let state = {
  search: '',
  status: 'all',      // all | active | completed
  priority: 'all',     // all | high | medium | low
  sort: 'newest',      // newest | oldest | priority | alphabetical
};

let pendingDeleteId = null;

/* ---------- DOM refs ---------- */

const el = {
  form: document.getElementById('addTaskForm'),
  input: document.getElementById('taskInput'),
  inputError: document.getElementById('taskInputError'),

  taskList: document.getElementById('taskList'),
  emptyState: document.getElementById('emptyState'),
  emptyStateTitle: document.getElementById('emptyStateTitle'),
  emptyStateBody: document.getElementById('emptyStateBody'),
  resultsCaption: document.getElementById('resultsCaption'),

  statTotal: document.getElementById('statTotal'),
  statCompleted: document.getElementById('statCompleted'),
  statPending: document.getElementById('statPending'),
  progressFill: document.getElementById('progressFill'),
  progressBar: document.getElementById('progressBar'),
  progressCaption: document.getElementById('progressCaption'),
  progressPercent: document.getElementById('progressPercent'),

  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  sortSelect: document.getElementById('sortSelect'),
  resetFilters: document.getElementById('resetFilters'),
  clearCompleted: document.getElementById('clearCompleted'),

  themeToggle: document.getElementById('themeToggle'),
  currentDate: document.getElementById('currentDate'),
  dailyQuote: document.getElementById('dailyQuote'),

  modalOverlay: document.getElementById('modalOverlay'),
  editForm: document.getElementById('editTaskForm'),
  editInput: document.getElementById('editTaskInput'),
  editInputError: document.getElementById('editTaskInputError'),
  cancelEdit: document.getElementById('cancelEdit'),

  deleteOverlay: document.getElementById('deleteOverlay'),
  deleteModalBody: document.getElementById('deleteModalBody'),
  cancelDelete: document.getElementById('cancelDelete'),
  confirmDelete: document.getElementById('confirmDelete'),

  toastStack: document.getElementById('toastStack'),
};

let editingTaskId = null;

/* =========================================================
   Local Storage
   ========================================================= */

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { tasks = []; return; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { tasks = []; return; }

    // Sanitize each entry so corrupted/partial records can't break the UI.
    tasks = parsed
      .filter(t => t && typeof t === 'object')
      .map(t => ({
        id: typeof t.id === 'number' ? t.id : Date.now() + Math.random(),
        title: typeof t.title === 'string' ? t.title.trim() : '',
        priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
        completed: Boolean(t.completed),
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      }))
      .filter(t => t.title.length > 0);
  } catch (err) {
    console.warn('TaskFlow: could not read saved tasks, starting fresh.', err);
    tasks = [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    console.warn('TaskFlow: could not save tasks.', err);
    showToast('Could not save — storage may be full', 'error');
  }
}

/* =========================================================
   Task operations
   ========================================================= */

function addTask(title, priority) {
  const clean = title.trim();
  if (!clean) return false;

  tasks.unshift({
    id: Date.now() + Math.random(),
    title: clean,
    priority,
    completed: false,
    createdAt: new Date().toISOString(),
  });

  saveTasks();
  render();
  return true;
}

function editTask(id, newTitle, newPriority) {
  const task = tasks.find(t => t.id === id);
  if (!task) return false;
  const clean = newTitle.trim();
  if (!clean) return false;

  task.title = clean;
  task.priority = newPriority;
  saveTasks();
  render();
  return true;
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  render();
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  render();
  return task.completed;
}

function clearCompletedTasks() {
  const countBefore = tasks.length;
  tasks = tasks.filter(t => !t.completed);
  if (tasks.length !== countBefore) {
    saveTasks();
    render();
  }
}

/* =========================================================
   Search / filter / sort — pure functions over `tasks`
   ========================================================= */

function searchTasks(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(t => t.title.toLowerCase().includes(q));
}

function filterTasks(list, status, priority) {
  return list.filter(t => {
    const statusOk =
      status === 'all' ||
      (status === 'active' && !t.completed) ||
      (status === 'completed' && t.completed);
    const priorityOk = priority === 'all' || t.priority === priority;
    return statusOk && priorityOk;
  });
}

function sortTasks(list, sort) {
  const priorityRank = { high: 0, medium: 1, low: 2 };
  const copy = [...list];
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    case 'priority':
      return copy.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
    case 'alphabetical':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'newest':
    default:
      return copy.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

function getVisibleTasks() {
  let list = tasks;
  list = searchTasks(list, state.search);
  list = filterTasks(list, state.status, state.priority);
  list = sortTasks(list, state.sort);
  return list;
}

/* =========================================================
   Rendering
   ========================================================= */

function updateStatistics() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pending = total - completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  el.statTotal.textContent = total;
  el.statCompleted.textContent = completed;
  el.statPending.textContent = pending;

  el.progressFill.style.width = percent + '%';
  el.progressPercent.textContent = percent + '%';
  el.progressCaption.textContent = `${completed} of ${total} task${total === 1 ? '' : 's'} completed`;
  el.progressBar.setAttribute('aria-valuenow', String(percent));
}

function formatDate(iso) {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return 'Created today';
  if (isYesterday) return 'Created yesterday';

  return 'Created ' + date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function priorityLabel(p) {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function buildTaskCard(task) {
  const li = document.createElement('li');
  li.className = 'task-card' + (task.completed ? ' is-complete' : '');
  li.dataset.priority = task.priority;
  li.dataset.id = task.id;

  li.innerHTML = `
    <span class="task-card__priority-bar" aria-hidden="true"></span>
    <button type="button" class="task-card__checkbox" aria-label="${task.completed ? 'Mark as active' : 'Mark as completed'}" aria-pressed="${task.completed}">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L4.8 8.8L10 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="task-card__body">
      <p class="task-card__title">${escapeHtml(task.title)}</p>
      <div class="task-card__meta">
        <span class="priority-badge priority-badge--${task.priority}">
          <span class="priority-dot" aria-hidden="true"></span>${priorityLabel(task.priority)}
        </span>
        <span class="task-card__date">${formatDate(task.createdAt)}</span>
      </div>
    </div>
    <div class="task-card__actions">
      <button type="button" class="icon-btn icon-btn--edit" aria-label="Edit task: ${escapeHtml(task.title)}">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M11.3 2.3a1.5 1.5 0 0 1 2.1 2.1L5.5 12.3l-2.9.7.7-2.9L11.3 2.3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </button>
      <button type="button" class="icon-btn icon-btn--delete" aria-label="Delete task: ${escapeHtml(task.title)}">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 4.5H13M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M6.7 7.5v3.5M9.3 7.5v3.5M4 4.5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `;

  li.querySelector('.task-card__checkbox').addEventListener('click', () => {
    const nowComplete = toggleTask(task.id);
    showToast(nowComplete ? 'Task marked as completed' : 'Task marked as active');
  });
  li.querySelector('.icon-btn--edit').addEventListener('click', () => openEditModal(task.id));
  li.querySelector('.icon-btn--delete').addEventListener('click', () => openDeleteModal(task.id));

  return li;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderResultsCaption(visibleCount) {
  const filtersActive = state.search || state.status !== 'all' || state.priority !== 'all';
  el.resetFilters.hidden = !filtersActive;

  if (!filtersActive) {
    el.resultsCaption.textContent = tasks.length === 0
      ? ''
      : `Showing all ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
    return;
  }
  el.resultsCaption.textContent = `Showing ${visibleCount} of ${tasks.length} tasks`;
}

function renderTasks() {
  const visible = getVisibleTasks();

  el.taskList.innerHTML = '';

  if (tasks.length === 0) {
    el.emptyState.hidden = false;
    el.taskList.hidden = true;
    el.emptyStateTitle.textContent = 'No tasks yet';
    el.emptyStateBody.textContent = 'Add your first task and start getting things done.';
  } else if (visible.length === 0) {
    el.emptyState.hidden = false;
    el.taskList.hidden = true;
    el.emptyStateTitle.textContent = 'No matching tasks';
    el.emptyStateBody.textContent = 'Try changing your search or filters.';
  } else {
    el.emptyState.hidden = true;
    el.taskList.hidden = false;
    const fragment = document.createDocumentFragment();
    visible.forEach(task => fragment.appendChild(buildTaskCard(task)));
    el.taskList.appendChild(fragment);
  }

  renderResultsCaption(visible.length);
  el.clearCompleted.disabled = tasks.every(t => !t.completed);
  el.clearCompleted.style.opacity = el.clearCompleted.disabled ? '0.4' : '1';
  el.clearCompleted.style.cursor = el.clearCompleted.disabled ? 'default' : 'pointer';
}

function render() {
  renderTasks();
  updateStatistics();
}

/* =========================================================
   Toasts
   ========================================================= */

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = '✓ ' + message;
  el.toastStack.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 2200);
}

/* =========================================================
   Add task form
   ========================================================= */

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = el.input.value;
  const priority = el.form.querySelector('input[name="priority"]:checked').value;

  if (!title.trim()) {
    el.input.classList.add('has-error');
    el.inputError.hidden = false;
    el.input.focus();
    return;
  }

  addTask(title, priority);
  el.input.value = '';
  el.input.classList.remove('has-error');
  el.inputError.hidden = true;
  el.input.focus();
  showToast('Task added successfully');
});

el.input.addEventListener('input', () => {
  if (el.input.value.trim()) {
    el.input.classList.remove('has-error');
    el.inputError.hidden = true;
  }
});

/* =========================================================
   Search
   ========================================================= */

let searchDebounce = null;
el.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const value = el.searchInput.value;
  el.clearSearch.hidden = !value;
  searchDebounce = setTimeout(() => {
    state.search = value;
    renderTasks();
  }, 120);
});

el.clearSearch.addEventListener('click', () => {
  el.searchInput.value = '';
  el.clearSearch.hidden = true;
  state.search = '';
  renderTasks();
  el.searchInput.focus();
});

/* =========================================================
   Filters + sort
   ========================================================= */

document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const type = chip.dataset.filterType;
    const value = chip.dataset.value;

    document.querySelectorAll(`.filter-chip[data-filter-type="${type}"]`)
      .forEach(c => c.classList.toggle('is-active', c === chip));

    state[type] = value;
    renderTasks();
  });
});

el.sortSelect.addEventListener('change', () => {
  state.sort = el.sortSelect.value;
  renderTasks();
});

el.resetFilters.addEventListener('click', () => {
  state = { ...state, search: '', status: 'all', priority: 'all' };
  el.searchInput.value = '';
  el.clearSearch.hidden = true;
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('is-active', c.dataset.value === 'all');
  });
  renderTasks();
});

el.clearCompleted.addEventListener('click', () => {
  if (el.clearCompleted.disabled) return;
  const count = tasks.filter(t => t.completed).length;
  if (count === 0) return;
  clearCompletedTasks();
  showToast('Cleared completed tasks');
});

/* =========================================================
   Edit modal
   ========================================================= */

function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;

  el.editInput.value = task.title;
  el.editInputError.hidden = true;
  el.editInput.classList.remove('has-error');
  document.getElementById('editPriority' + priorityLabel(task.priority)).checked = true;

  el.modalOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => el.editInput.focus(), 30);
}

function closeEditModal() {
  el.modalOverlay.hidden = true;
  document.body.style.overflow = '';
  editingTaskId = null;
}

el.editForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (editingTaskId === null) return;

  const title = el.editInput.value;
  if (!title.trim()) {
    el.editInput.classList.add('has-error');
    el.editInputError.hidden = false;
    el.editInput.focus();
    return;
  }
  const priority = el.editForm.querySelector('input[name="editPriority"]:checked').value;
  editTask(editingTaskId, title, priority);
  closeEditModal();
  showToast('Task updated');
});

el.cancelEdit.addEventListener('click', closeEditModal);
el.modalOverlay.addEventListener('click', (e) => {
  if (e.target === el.modalOverlay) closeEditModal();
});

/* =========================================================
   Delete confirmation modal
   ========================================================= */

function openDeleteModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  pendingDeleteId = id;
  el.deleteModalBody.textContent = `"${task.title}" will be permanently deleted.`;
  el.deleteOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => el.confirmDelete.focus(), 30);
}

function closeDeleteModal() {
  el.deleteOverlay.hidden = true;
  document.body.style.overflow = '';
  pendingDeleteId = null;
}

el.cancelDelete.addEventListener('click', closeDeleteModal);
el.deleteOverlay.addEventListener('click', (e) => {
  if (e.target === el.deleteOverlay) closeDeleteModal();
});
el.confirmDelete.addEventListener('click', () => {
  if (pendingDeleteId === null) return;
  const id = pendingDeleteId;
  const card = el.taskList.querySelector(`[data-id="${id}"]`);
  closeDeleteModal();

  if (card) {
    card.classList.add('is-removing');
    card.addEventListener('animationend', () => {
      deleteTask(id);
      showToast('Task deleted');
    }, { once: true });
  } else {
    deleteTask(id);
    showToast('Task deleted');
  }
});

/* =========================================================
   Keyboard shortcuts
   ========================================================= */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!el.modalOverlay.hidden) closeEditModal();
    if (!el.deleteOverlay.hidden) closeDeleteModal();
  }
});

/* =========================================================
   Theme
   ========================================================= */

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    el.themeToggle.setAttribute('aria-pressed', 'true');
    el.themeToggle.setAttribute('aria-label', 'Switch to light theme');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    el.themeToggle.setAttribute('aria-pressed', 'false');
    el.themeToggle.setAttribute('aria-label', 'Switch to dark theme');
  }
}

function loadTheme() {
  let theme = 'light';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
      theme = saved;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark';
    }
  } catch (err) { /* ignore, default to light */ }
  applyTheme(theme);
}

el.themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* ignore */ }
});

/* =========================================================
   Header widgets: date + quote
   ========================================================= */

function renderHeaderWidgets() {
  el.currentDate.textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  el.dailyQuote.textContent = '"' + QUOTES[Math.floor(Math.random() * QUOTES.length)] + '"';
}

/* =========================================================
   Init
   ========================================================= */

function init() {
  loadTheme();
  loadTasks();
  renderHeaderWidgets();
  render();
}

init();
