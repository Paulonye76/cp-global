(function () {
  var input = document.querySelector('[data-check]');
  var msg = document.getElementById('uMsg');
  if (!input || !msg) return;
  var timer;
  function run() {
    var u = input.value.trim().toLowerCase();
    if (!u) { msg.textContent = ''; msg.className = ''; return; }
    fetch('/api/username?u=' + encodeURIComponent(u))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        msg.textContent = d.msg;
        msg.className = d.ok ? 'good' : 'bad';
      })
      .catch(function () {});
  }
  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 300); });
  if (input.value) run();
})();
