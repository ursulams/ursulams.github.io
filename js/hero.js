/*
 * Animated hero background: a canvas map of New York City's five boroughs
 * where points flash in year by year, then settle into a faint trail.
 * Visual homage to the "nyc auto smash-and-grabs" d3 piece.
 * Plain canvas, no dependencies. Points are decorative, not real data.
 */
(function () {
  "use strict";

  var hero = document.querySelector("header.masthead");
  if (!hero || !window.HTMLCanvasElement) return;

  var canvas = document.createElement("canvas");
  canvas.className = "hero-canvas";
  canvas.setAttribute("aria-hidden", "true");
  hero.insertBefore(canvas, hero.firstChild);
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var COLORS = {
    land: "rgba(200, 213, 220, 0.07)",
    coast: "rgba(51, 179, 179, 0.35)",
    flash: [249, 152, 29], // amber
    trail: [0, 153, 153], // teal
    trailAlt: [131, 108, 201], // violet, lightened for dark backgrounds
    label: "rgba(200, 213, 220, 0.55)"
  };
  var YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  var YEAR_MS = 2000;
  var FLASH_MS = 900;
  var HOLD_MS = 1800;
  var FADE_MS = 1400;
  var CYCLE_MS = YEARS.length * YEAR_MS + HOLD_MS + FADE_MS;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var MAP_W = 1000; // map-space units
  var mapH = 0;
  var landPath = null;
  var coastPath = null;
  var dots = [];
  var view = { w: 0, h: 0, dpr: 1, scale: 1, ox: 0, oy: 0, timeline: true };
  var mapLayer = document.createElement("canvas");
  var running = true;
  var visible = true;
  var startTime = 0;
  var rafId = 0;

  // Small seeded PRNG so the composition is the same on every visit
  var seed = 20190401;
  function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function gauss() {
    return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
  }

  function buildGeometry(geo) {
    var k = Math.cos((40.7 * Math.PI) / 180);
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    var rings = [];
    geo.features.forEach(function (f) {
      f.geometry.coordinates.forEach(function (poly) {
        poly.forEach(function (ring) {
          var pts = ring.map(function (c) {
            var x = c[0] * k, y = -c[1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            return [x, y];
          });
          rings.push(pts);
        });
      });
    });
    var s = MAP_W / (maxX - minX);
    mapH = (maxY - minY) * s;
    landPath = new Path2D();
    rings.forEach(function (pts) {
      pts.forEach(function (p, i) {
        var x = (p[0] - minX) * s, y = (p[1] - minY) * s;
        if (i === 0) landPath.moveTo(x, y);
        else landPath.lineTo(x, y);
      });
      landPath.closePath();
    });
    coastPath = landPath;
  }

  function inLand(x, y) {
    return ctx.isPointInPath(landPath, x, y, "evenodd");
  }

  function buildDots() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var target = window.innerWidth < 768 ? 1300 : 2600;
    var hotspots = [];
    var guard = 0;
    while (hotspots.length < 26 && guard++ < 5000) {
      var hx = rand() * MAP_W, hy = rand() * mapH;
      if (inLand(hx, hy)) hotspots.push([hx, hy, 8 + rand() * 30]);
    }
    guard = 0;
    while (dots.length < target && guard++ < target * 40) {
      var x, y;
      if (rand() < 0.62) {
        var h = hotspots[(rand() * hotspots.length) | 0];
        x = h[0] + gauss() * h[2];
        y = h[1] + gauss() * h[2];
      } else {
        x = rand() * MAP_W;
        y = rand() * mapH;
      }
      if (!inLand(x, y)) continue;
      dots.push({
        x: x,
        y: y,
        m: (rand() * YEARS.length) | 0,
        d: rand(), // when within its year the dot appears
        r: 0.9 + rand() * 1.1,
        alt: rand() < 0.35
      });
    }
    dots.sort(function (a, b) { return a.m - b.m || a.d - b.d; });
  }

  function layout() {
    var rect = hero.getBoundingClientRect();
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.timeline = view.w >= 576;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);

    var pad = view.timeline ? 70 : 24;
    var availW = view.w * (view.w >= 992 ? 0.9 : 1.15);
    var availH = view.h - pad * 2;
    view.scale = Math.min(availW / MAP_W, availH / mapH);
    if (view.w < 576) view.scale = Math.max(view.scale, (view.w * 1.1) / MAP_W);
    view.ox = (view.w - MAP_W * view.scale) / 2;
    view.oy = (view.h - mapH * view.scale) / 2 - (view.timeline ? 12 : 0);

    // Cache the static land layer
    mapLayer.width = canvas.width;
    mapLayer.height = canvas.height;
    var m = mapLayer.getContext("2d");
    m.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.ox, view.dpr * view.oy);
    m.fillStyle = COLORS.land;
    m.fill(landPath, "evenodd");
    m.lineJoin = "round";
    m.lineWidth = 1 / view.scale;
    m.strokeStyle = COLORS.coast;
    m.stroke(coastPath);
  }

  function rgba(c, a) {
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")";
  }

  function drawTimeline(progress, globalAlpha) {
    if (!view.timeline) return;
    var x0 = view.w * 0.2, x1 = view.w * 0.8, y = view.h - 30;
    var cur = Math.min(YEARS.length - 1, Math.floor(progress * YEARS.length));
    ctx.save();
    ctx.globalAlpha = globalAlpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (var i = 0; i < YEARS.length; i++) {
      var tx = x0 + ((x1 - x0) * (i + 0.5)) / YEARS.length;
      if (i === cur) {
        ctx.font = "500 20px Dosis, Roboto, sans-serif";
        ctx.fillStyle = "rgba(249, 152, 29, 0.95)";
      } else {
        ctx.font = "400 14px Dosis, Roboto, sans-serif";
        ctx.fillStyle = i < cur ? "rgba(51, 179, 179, 0.8)" : COLORS.label;
      }
      ctx.fillText(String(YEARS[i]), tx, y);
    }
    ctx.restore();
  }

  function draw(elapsed) {
    var t = elapsed % CYCLE_MS;
    var animT = Math.min(t, YEARS.length * YEAR_MS);
    var fade = t > CYCLE_MS - FADE_MS ? 1 - (t - (CYCLE_MS - FADE_MS)) / FADE_MS : 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mapLayer, 0, 0);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    var s = view.scale, ox = view.ox, oy = view.oy;
    var rScale = Math.max(0.8, Math.min(1.6, s * 1.4));
    var TAU = Math.PI * 2;

    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      var born = (d.m + d.d * 0.85) * YEAR_MS;
      if (born > animT) break; // dots are sorted by appearance time
      var age = t - born;
      var x = ox + d.x * s, y = oy + d.y * s;
      var r = d.r * rScale;

      if (age < FLASH_MS) {
        var p = age / FLASH_MS;
        // expanding ring
        ctx.strokeStyle = rgba(COLORS.flash, (1 - p) * 0.7 * fade);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r + p * 10 * rScale, 0, TAU);
        ctx.stroke();
        // bright core easing into the trail colour
        ctx.fillStyle = rgba(COLORS.flash, (1 - p * 0.5) * fade);
        ctx.beginPath();
        ctx.arc(x, y, r * (1.8 - p * 0.8), 0, TAU);
        ctx.fill();
      } else {
        var c = d.alt ? COLORS.trailAlt : COLORS.trail;
        ctx.fillStyle = rgba(c, 0.55 * fade);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    }

    drawTimeline(animT / (YEARS.length * YEAR_MS), fade);
  }

  function frame(now) {
    rafId = 0;
    if (!running || !visible) return;
    if (!startTime) startTime = now;
    draw(now - startTime);
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (reduceMotion) {
      // Static final frame: the full year's trail, nothing flashing
      draw(YEARS.length * YEAR_MS + FLASH_MS);
      return;
    }
    if (!rafId && running && visible) rafId = requestAnimationFrame(frame);
  }

  var pausedAt = 0;
  function pause() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (!pausedAt) pausedAt = performance.now();
  }
  function resume() {
    if (pausedAt && startTime) startTime += performance.now() - pausedAt;
    pausedAt = 0;
    start();
  }

  function init(geo) {
    buildGeometry(geo);
    buildDots();
    layout();
    start();

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        layout();
        if (reduceMotion) draw(YEARS.length * YEAR_MS + FLASH_MS);
      }, 150);
    });

    document.addEventListener("visibilitychange", function () {
      running = !document.hidden;
      if (running) resume();
      else pause();
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) resume();
        else pause();
      }).observe(hero);
    }
  }

  fetch("assets/data/nyc-boroughs.json")
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(init)
    .catch(function () {
      canvas.remove(); // fall back to the plain gradient background
    });
})();
