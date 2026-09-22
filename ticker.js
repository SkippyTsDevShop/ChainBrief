/*
 * ChainBrief.news live market ticker.
 *
 * Fetches real, public, no-key data on every page load and on a 60s interval:
 *   - CoinGecko /simple/price  -> BTC / ETH / SOL prices + 24h change, USDT/USDC market cap
 *   - CoinGecko /global        -> BTC dominance, total crypto market cap
 *   - DefiLlama /v2/historicalChainTvl -> total DeFi TVL + implied 24h change
 *
 * Ground rules (per editorial policy — never show a fabricated or misleading price):
 *   - The server-rendered page ships with neutral "···" placeholders only. No number is
 *     ever hard-coded here or in build.py.
 *   - A field that fails to load shows "—", never a stale or made-up figure standing in
 *     for a live one.
 *   - The "Data as of" caption always reflects the timestamp of the last SUCCESSFUL
 *     fetch, not the current time — if a refresh fails, the caption simply stops
 *     advancing and visibly falls behind "now" instead of re-claiming freshness it
 *     doesn't have.
 *   - If the very first fetch fails outright (e.g. blocked by an ad blocker, offline,
 *     or the providers are unreachable), the strip reads "Market data unavailable"
 *     rather than showing any placeholder as if it were real.
 */
(function () {
  "use strict";

  var REFRESH_MS = 60000;
  var strip = document.querySelector(".ticker-strip");
  var asof = document.getElementById("ticker-asof");
  if (!strip || !asof) return;

  var lastGoodAt = null; // Date of the last successful update to ANY field.

  function setFields(map) {
    // map: { fieldKey: { px: "62,180", chg: "+1.8%", dir: "up" | "down" | null } }
    Object.keys(map).forEach(function (key) {
      var val = map[key];
      var nodes = strip.querySelectorAll('[data-field="' + key + '"]');
      nodes.forEach(function (node) {
        var pxEl = node.querySelector(".px");
        var chgEl = node.querySelector(".chg");
        if (!pxEl || !chgEl) return;
        pxEl.textContent = val.px;
        if (val.dir) {
          chgEl.textContent = (val.dir === "up" ? "▲ " : "▼ ") + val.chg;
          chgEl.className = "chg " + val.dir;
        } else {
          chgEl.textContent = "";
          chgEl.className = "chg";
        }
      });
    });
  }

  function markUnavailable(keys) {
    var map = {};
    keys.forEach(function (k) {
      map[k] = { px: "—", chg: "", dir: null };
    });
    setFields(map);
  }

  function fmtUsd(n, opts) {
    opts = opts || {};
    if (typeof n !== "number" || !isFinite(n)) return null;
    if (opts.compact) {
      var abs = Math.abs(n);
      if (abs >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
      if (abs >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
      if (abs >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    }
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });
  }

  function fmtPlain(n, decimals) {
    if (typeof n !== "number" || !isFinite(n)) return null;
    return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function dir(change) {
    if (typeof change !== "number" || !isFinite(change)) return null;
    return change >= 0 ? "up" : "down";
  }

  function pct(change) {
    if (typeof change !== "number" || !isFinite(change)) return null;
    return Math.abs(change).toFixed(1) + "%";
  }

  function fetchCoinGeckoPrices() {
    var url =
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,tether,usd-coin" +
      "&vs_currencies=usd&include_24hr_change=true&include_market_cap=true";
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("coingecko simple/price " + r.status);
        return r.json();
      })
      .then(function (data) {
        var out = {};
        var btc = data.bitcoin, eth = data.ethereum, sol = data.solana,
            usdt = data.tether, usdc = data["usd-coin"];
        if (btc && typeof btc.usd === "number") {
          out.btc = { px: fmtPlain(btc.usd, 0), chg: pct(btc.usd_24h_change), dir: dir(btc.usd_24h_change) };
        }
        if (eth && typeof eth.usd === "number") {
          out.eth = { px: fmtPlain(eth.usd, 0), chg: pct(eth.usd_24h_change), dir: dir(eth.usd_24h_change) };
        }
        if (sol && typeof sol.usd === "number") {
          out.sol = { px: fmtPlain(sol.usd, 2), chg: pct(sol.usd_24h_change), dir: dir(sol.usd_24h_change) };
        }
        if (usdt && typeof usdt.usd_market_cap === "number") {
          out["usdt-mcap"] = { px: fmtUsd(usdt.usd_market_cap, { compact: true }), chg: pct(usdt.usd_24h_change), dir: dir(usdt.usd_24h_change) };
        }
        if (usdc && typeof usdc.usd_market_cap === "number") {
          out["usdc-mcap"] = { px: fmtUsd(usdc.usd_market_cap, { compact: true }), chg: pct(usdc.usd_24h_change), dir: dir(usdc.usd_24h_change) };
        }
        return out;
      });
  }

  function fetchCoinGeckoGlobal() {
    return fetch("https://api.coingecko.com/api/v3/global", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("coingecko global " + r.status);
        return r.json();
      })
      .then(function (json) {
        var d = json && json.data;
        var out = {};
        if (d && d.market_cap_percentage && typeof d.market_cap_percentage.btc === "number") {
          out["btc-dom"] = { px: d.market_cap_percentage.btc.toFixed(1) + "%", chg: null, dir: null };
        }
        if (d && d.total_market_cap && typeof d.total_market_cap.usd === "number") {
          out["total-mcap"] = {
            px: fmtUsd(d.total_market_cap.usd, { compact: true }),
            chg: pct(d.market_cap_change_percentage_24h_usd),
            dir: dir(d.market_cap_change_percentage_24h_usd),
          };
        }
        return out;
      });
  }

  function fetchDefiLlamaTvl() {
    return fetch("https://api.llama.fi/v2/historicalChainTvl", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("defillama historicalChainTvl " + r.status);
        return r.json();
      })
      .then(function (series) {
        var out = {};
        if (Array.isArray(series) && series.length >= 2) {
          var last = series[series.length - 1];
          var prev = series[series.length - 2];
          if (last && typeof last.tvl === "number") {
            var change = prev && typeof prev.tvl === "number" && prev.tvl !== 0
              ? ((last.tvl - prev.tvl) / prev.tvl) * 100
              : null;
            out["defi-tvl"] = { px: fmtUsd(last.tvl, { compact: true }), chg: pct(change), dir: dir(change) };
          }
        }
        return out;
      });
  }

  function updateAsOf(anySuccess) {
    if (anySuccess) lastGoodAt = new Date();
    if (!lastGoodAt) {
      asof.textContent = "Market data unavailable";
      strip.setAttribute("data-state", "unavailable");
      return;
    }
    var timeStr;
    try {
      timeStr = lastGoodAt.toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
    } catch (e) {
      timeStr = lastGoodAt.toLocaleTimeString();
    }
    var dateStr = lastGoodAt.toLocaleDateString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric",
    });
    asof.textContent = "Data as of " + dateStr + ", " + timeStr + " · via CoinGecko & DefiLlama";
    strip.setAttribute("data-state", anySuccess ? "live" : "degraded");
  }

  var ALL_KEYS = ["btc", "eth", "sol", "usdt-mcap", "usdc-mcap", "btc-dom", "total-mcap", "defi-tvl"];

  function refresh() {
    var settled = [fetchCoinGeckoPrices(), fetchCoinGeckoGlobal(), fetchDefiLlamaTvl()];
    Promise.allSettled(settled).then(function (results) {
      var merged = {};
      var anySuccess = false;
      results.forEach(function (r) {
        if (r.status === "fulfilled" && r.value) {
          Object.assign(merged, r.value);
          if (Object.keys(r.value).length) anySuccess = true;
        }
      });
      var gotKeys = Object.keys(merged);
      if (gotKeys.length) setFields(merged);
      var missing = ALL_KEYS.filter(function (k) { return gotKeys.indexOf(k) === -1; });
      if (missing.length && !lastGoodAt) {
        // Nothing has ever loaded for these fields — show "—", not a placeholder guess.
        markUnavailable(missing);
      }
      updateAsOf(anySuccess);
    });
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
