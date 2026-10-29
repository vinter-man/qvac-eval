export const CLIENT_SCRIPT = `
(function () {
  var root = document.documentElement;
  var themeButton = document.getElementById('theme');
  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
  }
  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    if (themeButton) themeButton.textContent = theme === 'night' ? 'Paper' : 'Night';
  }
  var stored = null;
  try { stored = localStorage.getItem('qvac-eval-theme'); } catch (error) { stored = null; }
  applyTheme(stored === 'night' || stored === 'paper' ? stored : systemTheme());
  if (themeButton) {
    themeButton.hidden = false;
    themeButton.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'night' ? 'paper' : 'night';
      applyTheme(next);
      try { localStorage.setItem('qvac-eval-theme', next); } catch (error) { return; }
    });
  }

  var filters = document.getElementById('filters');
  var cases = Array.prototype.slice.call(document.querySelectorAll('.case'));
  if (!filters || cases.length === 0) return;
  filters.hidden = false;
  var state = { status: 'all', model: 'all' };
  var note = document.getElementById('filter-note');
  function refresh() {
    var shown = 0;
    cases.forEach(function (row) {
      var visible = (state.status === 'all' || row.getAttribute('data-status') === state.status) &&
        (state.model === 'all' || row.getAttribute('data-model') === state.model);
      row.hidden = !visible;
      if (visible) shown += 1;
    });
    Array.prototype.forEach.call(filters.querySelectorAll('button'), function (button) {
      var kind = button.getAttribute('data-kind');
      button.setAttribute('aria-pressed', String(state[kind] === button.getAttribute('data-value')));
    });
    if (note) note.textContent = shown === cases.length ? '' : 'Showing ' + shown + ' of ' + cases.length + ' cases';
  }
  filters.addEventListener('click', function (event) {
    var button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;
    state[button.getAttribute('data-kind')] = button.getAttribute('data-value');
    refresh();
  });
  refresh();
})();
`;
