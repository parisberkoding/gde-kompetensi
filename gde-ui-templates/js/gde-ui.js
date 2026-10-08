/* ==========================================================================
   GDE UI TEMPLATES — 06. gde-ui.js
   Perilaku komponen ber-prefiks `gde-` (dropdown, modal, tab, salin, reveal).
   TANPA dependensi. Tidak menimpa perilaku Bootstrap/NiceAdmin yang sudah ada
   (sidebar toggle & back-to-top tetap ditangani DashboardTemplates/assets/js/main.js).
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------- 1. DROPDOWN gde ---------- */
  function initDropdown() {
    $$('.gde-dropdown').forEach(function (dd) {
      var trigger = dd.querySelector('[data-gde-dropdown]') || dd.firstElementChild;
      if (!trigger) return;
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var wasOpen = dd.classList.contains('is-open');
        $$('.gde-dropdown.is-open').forEach(function (o) { o.classList.remove('is-open'); });
        dd.classList.toggle('is-open', !wasOpen);
      });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.gde-dropdown')) {
        $$('.gde-dropdown.is-open').forEach(function (o) { o.classList.remove('is-open'); });
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $$('.gde-dropdown.is-open').forEach(function (o) { o.classList.remove('is-open'); });
    });
  }

  /* ---------- 2. MODAL gde ---------- */
  function openModal(sel) {
    var m = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!m) return;
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(m) {
    if (!m) return;
    m.classList.remove('is-open');
    m.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function initModal() {
    $$('[data-gde-modal]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); openModal(btn.getAttribute('data-gde-modal')); });
    });
    $$('.gde-modal').forEach(function (m) {
      m.addEventListener('click', function (e) {
        if (e.target.classList.contains('gde-modal__scrim') ||
            e.target.classList.contains('gde-modal__close') ||
            e.target.hasAttribute('data-gde-close')) closeModal(m);
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $$('.gde-modal.is-open').forEach(closeModal);
    });
  }

  /* ---------- 3. TAB gde ---------- */
  function initTabs() {
    $$('[data-gde-tabs]').forEach(function (group) {
      var tabs = $$('.gde-tab', group);
      var panels = $$('[data-gde-panel]', group);
      tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () {
          tabs.forEach(function (t) { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
          panels.forEach(function (p) { p.hidden = true; });
          tab.classList.add('is-active');
          tab.setAttribute('aria-selected', 'true');
          if (panels[i]) panels[i].hidden = false;
        });
      });
    });
  }

  /* ---------- 4. SALIN KE PAPAN KLIP ---------- */
  function initCopy() {
    $$('[data-gde-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var src = document.querySelector(btn.getAttribute('data-gde-copy'));
        if (!src) return;
        var text = src.innerText;
        var done = function () {
          var old = btn.innerHTML;
          btn.innerHTML = '<i class="bi bi-check2"></i> Tersalin';
          setTimeout(function () { btn.innerHTML = old; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
        } else { legacyCopy(text, done); }
      });
    });
  }
  function legacyCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* abaikan */ }
    document.body.removeChild(ta);
  }

  /* ---------- 5. REVEAL SAAT DIPANDANG ---------- */
  function initReveal() {
    var els = $$('.gde-fade-up');
    if (!els.length || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en, i) {
        if (!en.isIntersecting) return;
        setTimeout(function () { en.target.classList.add('is-in'); }, i * 90);
        io.unobserve(en.target);
      });
    }, { threshold: .06, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 6. SIDEBAR MOBILE (fallback bila main.js tidak memuat) ---------- */
  function initSidebarFallback() {
    var btn = $('.toggle-sidebar-btn');
    if (!btn || btn.dataset.gdeBound === '1') return;
    btn.dataset.gdeBound = '1';
    btn.addEventListener('click', function () {
      // main.js NiceAdmin sudah menangani ini; fallback hanya bila body tidak berubah
      setTimeout(function () {
        var open = document.body.classList.contains('toggle-sidebar');
        var scrim = $('.sidebar-scrim');
        if (window.innerWidth < 1200) {
          if (!scrim) {
            scrim = document.createElement('div');
            scrim.className = 'sidebar-scrim';
            scrim.style.cssText = 'position:fixed;inset:0;background:rgba(9,20,35,.45);z-index:995;';
            document.body.appendChild(scrim);
            scrim.addEventListener('click', function () {
              document.body.classList.remove('toggle-sidebar');
              scrim.remove();
            });
          }
          if (!open) scrim.remove();
        }
      }, 30);
    });
  }

  /* ---------- 7. ISI TAHUN OTOMATIS ---------- */
  function initYear() {
    $$('[data-gde-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    initDropdown(); initModal(); initTabs(); initCopy(); initReveal(); initSidebarFallback(); initYear();
  });

  window.GDE = { openModal: openModal, closeModal: closeModal };
})();
