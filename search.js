(function () {
  "use strict";

  // Lightweight client-side site search. No dependency: fetches /search-index.json
  // (generated at build time by build.py's write_search_index()) once, on first
  // open, and does a plain substring/token match across title, description,
  // category, and a body-text excerpt entirely in the browser. Nothing is sent
  // to a server and no third-party script is loaded.

  var trigger = document.getElementById("search-trigger");
  var overlay = document.getElementById("search-overlay");
  var closeBtn = document.getElementById("search-close");
  var input = document.getElementById("search-input");
  var resultsEl = document.getElementById("search-results");
  var statusEl = document.getElementById("search-status");

  if (!trigger || !overlay || !input || !resultsEl) return;

  var INDEX_URL = "/search-index.json";
  var MAX_RESULTS = 12;
  var index = null; // null = not yet loaded, [] = loaded (possibly empty)
  var loadFailed = false;
  var lastQuery = "";
  var debounceTimer = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function highlight(text, terms) {
    var out = escapeHtml(text);
    terms.forEach(function (t) {
      if (!t) return;
      var re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      out = out.replace(re, "<mark>$1</mark>");
    });
    return out;
  }

  function loadIndex(cb) {
    if (index !== null) return cb();
    fetch(INDEX_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("bad status " + r.status);
        return r.json();
      })
      .then(function (data) {
        index = Array.isArray(data) ? data : [];
        cb();
      })
      .catch(function () {
        loadFailed = true;
        index = [];
        cb();
      });
  }

  function score(item, terms) {
    var hay = {
      title: (item.title || "").toLowerCase(),
      description: (item.description || "").toLowerCase(),
      kicker: (item.kicker || "").toLowerCase(),
      section: (item.section || "").toLowerCase(),
      excerpt: (item.excerpt || "").toLowerCase(),
    };
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (!t) continue;
      var hit = 0;
      if (hay.title.indexOf(t) !== -1) hit += 5;
      if (hay.kicker.indexOf(t) !== -1) hit += 3;
      if (hay.section.indexOf(t) !== -1) hit += 3;
      if (hay.description.indexOf(t) !== -1) hit += 2;
      if (hay.excerpt.indexOf(t) !== -1) hit += 1;
      if (hit === 0) return 0; // require every term to match somewhere (AND search)
      total += hit;
    }
    return total;
  }

  function render(query) {
    var q = query.trim();
    if (!q) {
      resultsEl.innerHTML = "";
      statusEl.textContent = loadFailed
        ? "Search is temporarily unavailable."
        : "Start typing to search headlines, topics, and categories.";
      return;
    }
    if (loadFailed) {
      resultsEl.innerHTML = "";
      statusEl.textContent = "Search is temporarily unavailable.";
      return;
    }
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var scored = index
      .map(function (item) { return { item: item, s: score(item, terms) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, MAX_RESULTS);

    if (scored.length === 0) {
      resultsEl.innerHTML = "";
      statusEl.textContent = 'No articles matched "' + escapeHtml(q) + '".';
      return;
    }

    statusEl.textContent = scored.length + " result" + (scored.length === 1 ? "" : "s");
    resultsEl.innerHTML = scored
      .map(function (r) {
        var a = r.item;
        return (
          '<a class="search-result" href="' + a.url + '">' +
          '<span class="search-result-kicker">' + escapeHtml(a.kicker || "") + "</span>" +
          "<h3>" + highlight(a.title, terms) + "</h3>" +
          '<p>' + highlight(a.description, terms) + "</p>" +
          '<span class="search-result-date">' + escapeHtml(a.date || "") + "</span>" +
          "</a>"
        );
      })
      .join("");
  }

  function openOverlay() {
    overlay.hidden = false;
    document.body.classList.add("search-open");
    loadIndex(function () {
      render(input.value);
    });
    setTimeout(function () { input.focus(); }, 10);
  }

  function closeOverlay() {
    overlay.hidden = true;
    document.body.classList.remove("search-open");
    trigger.focus();
  }

  trigger.addEventListener("click", openOverlay);
  closeBtn.addEventListener("click", closeOverlay);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeOverlay();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.hidden) closeOverlay();
    if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) &&
        overlay.hidden && document.activeElement !== input &&
        document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault();
      openOverlay();
    }
  });
  input.addEventListener("input", function () {
    var q = input.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      lastQuery = q;
      render(q);
    }, 90);
  });

  // Supports a stable, crawlable query URL (https://chainbrief.news/?q=...): on
  // load, if a ?q= parameter is present, open the overlay, pre-fill the input,
  // and run the search immediately. This is what makes the WebSite SearchAction
  // in the homepage's structured data a real, working query template rather
  // than a dead link.
  try {
    var params = new URLSearchParams(window.location.search);
    var initialQ = params.get("q");
    if (initialQ) {
      input.value = initialQ;
      openOverlay();
    }
  } catch (e) {
    // URLSearchParams unsupported or malformed query string — no-op, search
    // still works normally via the overlay trigger.
  }
})();
