/* Beltstripe technique viewer.
 * One spin engine shared by every step card and by study mode:
 * canvas rendering, progressive frame loading, momentum drag, idle sway in the
 * sharp front arc, angle compass, optional cut-out "stage" backdrop and a
 * tracked "coach view" skeleton with joint angles and markers that follow joints.
 */
(function () {
  "use strict";

  var NUM = 96;                    // frames per full turn
  var SHARP = 13;                  // frames each side of the front that stay sharp (~50 deg)
  var IDLE_AMP = 8;                // idle sway amplitude in frames (~30 deg)
  var IDLE_DELAY = 3500;           // ms of stillness before idle sway
  var PX_PER_FRAME = 6;            // drag sensitivity
  var MARK_VIEW = { w: 1400, h: 940 }; // coordinate space the step markers were authored in
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DPR = Math.min(2, window.devicePixelRatio || 1);

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function wrap(i) { return ((Math.round(i) % NUM) + NUM) % NUM; }
  function signed(p) { var m = ((p % NUM) + NUM) % NUM; return m > NUM / 2 ? m - NUM : m; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------- shared image cache with a small download queue ----------
  var cache = {};       // url -> {img, ok, done, cbs}
  var queue = [], active = 0, MAX_ACTIVE = 8;
  function pump() {
    while (active < MAX_ACTIVE && queue.length) {
      var job = queue.shift();
      if (job.entry.started) continue;
      start(job.entry, job.url);
    }
  }
  function start(entry, url) {
    entry.started = true; active++;
    var img = new Image();
    img.decoding = "async";
    var finish = function (ok) {
      active--; entry.done = true; entry.ok = ok; entry.img = img;
      var cbs = entry.cbs; entry.cbs = [];
      cbs.forEach(function (cb) { cb(entry); });
      pump();
    };
    img.onload = function () {
      if (img.decode) img.decode().then(function () { finish(true); }, function () { finish(true); });
      else finish(true);
    };
    img.onerror = function () { finish(false); };
    img.src = url;
  }
  function request(url, cb, urgent) {
    var e = cache[url];
    if (!e) { e = cache[url] = { cbs: [], done: false, ok: false, started: false }; }
    if (e.done) { if (cb) cb(e); return e; }
    if (cb) e.cbs.push(cb);
    if (!e.started) {
      if (urgent) queue.unshift({ url: url, entry: e }); else queue.push({ url: url, entry: e });
      pump();
    }
    return e;
  }
  function loaded(url) { var e = cache[url]; return e && e.done && e.ok ? e.img : null; }

  // progressive order: front first, then the sharp arc, then coarse-to-fine round the back
  function loadOrder(full) {
    var seen = {}, out = [];
    function add(i) { i = wrap(i); if (!seen[i]) { seen[i] = 1; out.push(i); } }
    add(0);
    for (var s = 8; s >= 1; s = s / 2) for (var k = -SHARP; k <= SHARP; k++) if (k % s === 0) add(k);
    if (full) for (var st = 8; st >= 1; st = st / 2) for (var j = 0; j < NUM; j += st) add(j);
    return out;
  }

  // ---------- pose data (coach view) ----------
  var ALIASES = {
    nose: ["nose", "head", "head_joint"],
    neck: ["neck", "neck_1_joint"],
    lsh: ["left_shoulder", "left_shoulder_1_joint", "leftShoulder"],
    rsh: ["right_shoulder", "right_shoulder_1_joint", "rightShoulder"],
    lel: ["left_elbow", "left_forearm_joint", "leftElbow"],
    rel: ["right_elbow", "right_forearm_joint", "rightElbow"],
    lwr: ["left_wrist", "left_hand_joint", "leftWrist"],
    rwr: ["right_wrist", "right_hand_joint", "rightWrist"],
    root: ["root", "root_joint"],
    lhip: ["left_hip", "left_upLeg_joint", "left_upleg_joint", "leftHip"],
    rhip: ["right_hip", "right_upLeg_joint", "right_upleg_joint", "rightHip"],
    lkn: ["left_knee", "left_leg_joint", "leftKnee"],
    rkn: ["right_knee", "right_leg_joint", "rightKnee"],
    lan: ["left_ankle", "left_foot_joint", "leftAnkle"],
    ran: ["right_ankle", "right_foot_joint", "rightAnkle"]
  };
  var BONES = [["nose", "neck"], ["neck", "lsh"], ["neck", "rsh"], ["lsh", "lel"], ["lel", "lwr"], ["rsh", "rel"], ["rel", "rwr"],
    ["lsh", "lhip"], ["rsh", "rhip"], ["lhip", "rhip"], ["lhip", "lkn"], ["lkn", "lan"], ["rhip", "rkn"], ["rkn", "ran"]];
  var ANGLES = [["lhip", "lkn", "lan", "Knee"], ["rhip", "rkn", "ran", "Knee"], ["lsh", "lhip", "lkn", "Hip"], ["rsh", "rhip", "rkn", "Hip"]];
  var MIN_CONF = 0.3;

  function normPerson(p) {
    var src = p.joints || p, out = {};
    Object.keys(ALIASES).forEach(function (k) {
      for (var i = 0; i < ALIASES[k].length; i++) {
        var v = src[ALIASES[k][i]];
        if (v && v.length >= 2) { out[k] = [v[0], v[1], v.length > 2 ? v[2] : 1]; return; }
      }
    });
    if (!out.neck && out.lsh && out.rsh) out.neck = [(out.lsh[0] + out.rsh[0]) / 2, (out.lsh[1] + out.rsh[1]) / 2, Math.min(out.lsh[2], out.rsh[2])];
    return out;
  }
  function centroid(p) {
    var x = 0, y = 0, n = 0;
    Object.keys(p).forEach(function (k) { if (p[k][2] >= MIN_CONF) { x += p[k][0]; y += p[k][1]; n++; } });
    return n ? [x / n, y / n] : null;
  }
  // give each detected person a stable track id (0 or 1) by walking out from the front frame
  function track(frames) {
    var tracked = new Array(NUM);
    var f0 = (frames[0] || []).map(normPerson).filter(function (p) { return centroid(p); });
    f0.sort(function (a, b) { return centroid(a)[0] - centroid(b)[0]; });
    tracked[0] = f0.map(function (p, i) { return { id: i, j: p }; });
    function walk(dir) {
      var prev = tracked[0];
      for (var s = 1; s <= NUM / 2; s++) {
        var i = wrap(s * dir);
        if (dir < 0 && i === NUM / 2) break;
        var people = (frames[i] || []).map(normPerson).filter(function (p) { return centroid(p); });
        var used = {}, res = [];
        people.forEach(function (p) {
          var c = centroid(p), best = -1, bd = 1e9;
          prev.forEach(function (q) {
            if (used[q.id]) return;
            var d = Math.hypot(c[0] - q.c[0], c[1] - q.c[1]);
            if (d < bd) { bd = d; best = q.id; }
          });
          if (best < 0) best = used[0] ? 1 : 0;
          used[best] = 1; res.push({ id: best, j: p });
        });
        res.forEach(function (r) { r.c = centroid(r.j); });
        tracked[i] = res;
        if (res.length) prev = res.length >= prev.length ? res : prev.map(function (q) { return res.filter(function (r) { return r.id === q.id; })[0] || q; });
      }
    }
    tracked[0].forEach(function (r) { r.c = centroid(r.j); });
    walk(1); walk(-1);
    return tracked;
  }
  var poseCache = {};
  function loadPose(id, cb) {
    if (poseCache[id] !== undefined) { if (poseCache[id] && poseCache[id].then) poseCache[id].then(cb); else cb(poseCache[id]); return; }
    poseCache[id] = fetch("pose/" + id + ".json").then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { var w = d.w || 1152, h = d.h || 768; var t = { w: w, h: h, frames: track(d.frames || []) }; poseCache[id] = t; return t; })
      .catch(function () { poseCache[id] = null; return null; });
    poseCache[id].then(cb);
  }

  // ---------- stage backdrop ----------
  function paintStage(ctx, W, H) {
    var g = ctx.createRadialGradient(W * 0.5, H * 0.42, H * 0.05, W * 0.5, H * 0.5, W * 0.75);
    g.addColorStop(0, "#1C2B44"); g.addColorStop(1, "#070B14");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var hz = H * 0.5;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, hz, W, H - hz); ctx.clip();
    var fg = ctx.createLinearGradient(0, hz, 0, H);
    fg.addColorStop(0, "rgba(86,190,255,0)"); fg.addColorStop(1, "rgba(86,190,255,0.5)");
    ctx.strokeStyle = fg; ctx.lineWidth = Math.max(1, W / 1200);
    for (var i = -24; i <= 24; i++) {
      ctx.beginPath(); ctx.moveTo(W / 2 + i * W * 0.03, hz); ctx.lineTo(W / 2 + i * W * 0.16, H); ctx.stroke();
    }
    for (var j = 1; j <= 16; j++) {
      var y = hz + (H - hz) * Math.pow(j / 16, 2.1);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
    var hl = ctx.createLinearGradient(0, 0, W, 0);
    hl.addColorStop(0, "rgba(198,28,24,0)"); hl.addColorStop(0.5, "rgba(255,90,80,0.75)"); hl.addColorStop(1, "rgba(198,28,24,0)");
    ctx.fillStyle = hl; ctx.fillRect(0, hz - 1, W, 2);
  }
  // bounding box of a cut-out's opaque pixels (normalised), cached per image
  var bboxCanvas = document.createElement("canvas"); bboxCanvas.width = 96; bboxCanvas.height = 64;
  var bboxCtx = bboxCanvas.getContext("2d", { willReadFrequently: true });
  function bbox(img) {
    if (img._bb) return img._bb;
    try {
      bboxCtx.clearRect(0, 0, 96, 64); bboxCtx.drawImage(img, 0, 0, 96, 64);
      var d = bboxCtx.getImageData(0, 0, 96, 64).data, x0 = 96, x1 = 0, y1 = 0;
      for (var y = 0; y < 64; y++) for (var x = 0; x < 96; x++) if (d[(y * 96 + x) * 4 + 3] > 80) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      img._bb = x1 > x0 ? { x0: x0 / 96, x1: x1 / 96, y1: y1 / 64 } : { x0: 0.3, x1: 0.7, y1: 0.9 };
    } catch (e) { img._bb = { x0: 0.3, x1: 0.7, y1: 0.9 }; }
    return img._bb;
  }

  // ---------- the viewer ----------
  var viewers = [];
  var assets = { cutouts: null };   // null = unknown, true/false once probed

  function Viewer(root, opts) {
    this.root = root;
    this.opts = opts;
    this.pos = 0; this.vel = 0; this.target = null;
    this.dragging = false; this.lastInteract = 0; this.idlePhase = 0;
    this.full = false; this.bg = "gym"; this.coach = false; this.spinning = false; this.spinDir = 1;
    this.visible = false; this.dirty = true; this.lastDrawn = null;
    this.fade = null; // {from: canvas, t0, dur}
    this.build();
    this.setPose(opts.id, opts.marks || [], true);
    viewers.push(this);
    var self = this;
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { self.visible = e.isIntersecting; if (self.visible) self.ensureLoading(); });
      }, { rootMargin: "500px 0px" }).observe(root);
    } else { this.visible = true; this.ensureLoading(); }
  }

  Viewer.prototype.build = function () {
    var r = this.root, self = this;
    r.classList.add("bsv");
    r.innerHTML =
      '<div class="bsv-stage" tabindex="0" role="img">' +
        '<canvas class="bsv-canvas"></canvas>' +
        '<div class="bsv-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
        '<div class="bsv-hud-top" aria-hidden="true"><span class="bsv-chip bsv-mode">GYM</span><span class="bsv-chip bsv-qual">SHARP</span></div>' +
        '<div class="bsv-compass" aria-hidden="true"><svg viewBox="0 0 64 64">' +
          '<circle cx="32" cy="32" r="26" class="bsv-ring"/>' +
          '<path class="bsv-arc-sharp" d=""/>' +
          '<line x1="32" y1="32" x2="32" y2="9" class="bsv-needle"/>' +
          '<circle cx="32" cy="32" r="3" class="bsv-hub"/></svg>' +
          '<span class="bsv-deg">000°</span></div>' +
        '<div class="bsv-load" aria-hidden="true"><span></span></div>' +
        '<div class="bsv-hint">Drag to turn</div>' +
      '</div>' +
      '<div class="bsv-bar">' +
        '<button type="button" class="bsv-btn bsv-spin" aria-pressed="false">' + icon("play") + '<span>Rotate</span></button>' +
        '<div class="bsv-seg" role="group" aria-label="Background">' +
          '<button type="button" class="bsv-bg" data-bg="gym" aria-pressed="true">Gym</button>' +
          '<button type="button" class="bsv-bg" data-bg="stage" aria-pressed="false">Stage</button></div>' +
        '<button type="button" class="bsv-btn bsv-coach" aria-pressed="false">' + icon("skeleton") + '<span>Coach view</span></button>' +
        '<button type="button" class="bsv-btn bsv-full" aria-pressed="false">' + icon("orbit") + '<span>Full 360°</span></button>' +
        (this.opts.study ? '<button type="button" class="bsv-btn bsv-open" aria-label="Open in study mode">' + icon("expand") + '<span>Study</span></button>' : '') +
      '</div>';
    this.stage = r.querySelector(".bsv-stage");
    this.canvas = r.querySelector(".bsv-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.needle = r.querySelector(".bsv-needle");
    this.degEl = r.querySelector(".bsv-deg");
    this.qualEl = r.querySelector(".bsv-qual");
    this.modeEl = r.querySelector(".bsv-mode");
    this.loadEl = r.querySelector(".bsv-load span");
    this.loadWrap = r.querySelector(".bsv-load");
    this.hint = r.querySelector(".bsv-hint");
    // sharp arc on the compass (-50..+50 deg)
    var a = SHARP / NUM * 2 * Math.PI, R = 26;
    r.querySelector(".bsv-arc-sharp").setAttribute("d",
      "M " + (32 + R * Math.sin(-a)) + " " + (32 - R * Math.cos(-a)) + " A " + R + " " + R + " 0 0 1 " + (32 + R * Math.sin(a)) + " " + (32 - R * Math.cos(a)));

    this.stage.setAttribute("aria-label", this.opts.label || "Rotatable view");
    this.btnSpin = r.querySelector(".bsv-spin");
    this.btnCoach = r.querySelector(".bsv-coach");
    this.btnFull = r.querySelector(".bsv-full");
    this.btnSpin.addEventListener("click", function () { self.toggleSpin(); });
    this.btnCoach.addEventListener("click", function () { self.setCoach(!self.coach); });
    this.btnFull.addEventListener("click", function () { self.setFull(!self.full); });
    r.querySelectorAll(".bsv-bg").forEach(function (b) { b.addEventListener("click", function () { self.setBg(b.dataset.bg); }); });
    var open = r.querySelector(".bsv-open");
    if (open) open.addEventListener("click", function () { if (self.opts.onStudy) self.opts.onStudy(self); });

    // pointer drag with momentum
    var lastX = 0, lastT = 0;
    this.stage.addEventListener("pointerdown", function (e) {
      self.stopSpin(); self.dragging = true; lastX = e.clientX; lastT = performance.now(); self.vel = 0; self.touch();
      self.stage.classList.add("grabbing"); self.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener("pointermove", function (e) {
      if (!self.dragging) return;
      var now = performance.now(), dx = e.clientX - lastX;
      if (!dx) return;
      var df = dx / PX_PER_FRAME * (900 / Math.max(320, self.stage.clientWidth));
      self.pos -= df;
      if (!self.full) self.pos = self.rubber(self.pos);
      self.vel = -df * (16 / Math.max(16, now - lastT));
      lastX = e.clientX; lastT = now; self.touch(); self.hint.classList.add("off");
    });
    var up = function () { if (!self.dragging) return; self.dragging = false; self.stage.classList.remove("grabbing"); self.vel = REDUCED ? 0 : clamp(self.vel, -3, 3); self.touch(); };
    this.stage.addEventListener("pointerup", up);
    this.stage.addEventListener("pointercancel", up);
    this.stage.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { self.nudge(-2); e.preventDefault(); }
      else if (e.key === "ArrowRight") { self.nudge(2); e.preventDefault(); }
    });
  };

  function icon(n) {
    var p = {
      play: '<path d="M7 5l12 7-12 7z"/>',
      pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
      skeleton: '<circle cx="12" cy="4.5" r="2.2"/><path d="M12 7v7M7 9.5l5 1.5 5-1.5M12 14l-3.5 6M12 14l3.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      orbit: '<ellipse cx="12" cy="12" rx="9.5" ry="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6"/>',
      expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    }[n];
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">' + p + '</svg>';
  }

  Viewer.prototype.touch = function () { this.lastInteract = performance.now(); this.target = null; };
  Viewer.prototype.nudge = function (d) { this.stopSpin(); this.touch(); this.vel = 0; this.pos += d; if (!this.full) this.pos = clamp(signed(this.pos), -SHARP, SHARP); };
  Viewer.prototype.rubber = function (p) {
    var s = signed(p);
    if (s > SHARP) return SHARP + (s - SHARP) * 0.25;
    if (s < -SHARP) return -SHARP + (s + SHARP) * 0.25;
    return s;
  };

  Viewer.prototype.frameURL = function (i) { return "frames-webp/" + this.id + "/" + pad(i) + ".webp"; };
  Viewer.prototype.cutURL = function (i) { return "cutouts/" + this.id + "/" + pad(i) + ".webp"; };

  Viewer.prototype.setPose = function (id, marks, initial) {
    var self = this;
    if (!initial && this.lastDrawn) {
      // keep a snapshot so the change can dissolve
      var snap = document.createElement("canvas"); snap.width = this.canvas.width; snap.height = this.canvas.height;
      snap.getContext("2d").drawImage(this.canvas, 0, 0);
      this.fade = { from: snap, t0: performance.now(), dur: REDUCED ? 1 : 650 };
    }
    this.id = id; this.marks = marks || []; this.pose = null; this.anchors = null;
    this.loadingStarted = false; this.dirty = true; this.lastDrawn = null;
    if (this.visible || !initial) this.ensureLoading();
    if (this.coach) this.fetchPose();
  };

  Viewer.prototype.ensureLoading = function () {
    if (this.loadingStarted) return;
    this.loadingStarted = true;
    var self = this, id = this.id, order = loadOrder(true), total = order.length, got = 0;
    this.loadWrap.classList.remove("done");
    order.forEach(function (i, n) {
      request(self.frameURL(i), function () {
        if (self.id !== id) return;
        got++; self.dirty = true;
        self.loadEl.style.width = (got / total * 100) + "%";
        if (got === total) self.loadWrap.classList.add("done");
      }, n < 3);
    });
    if (this.bg === "stage") this.loadCutouts();
  };

  Viewer.prototype.loadCutouts = function () {
    var self = this, id = this.id;
    if (this.cutLoading === id) return;
    this.cutLoading = id;
    loadOrder(true).forEach(function (i, n) { request(self.cutURL(i), function () { if (self.id === id) self.dirty = true; }, n < 3); });
  };

  Viewer.prototype.fetchPose = function () {
    var self = this, id = this.id;
    loadPose(id, function (p) {
      if (self.id !== id) return;
      self.pose = p; self.anchors = p ? anchorMarks(self.marks, p) : null; self.dirty = true;
      if (!p) { self.btnCoach.disabled = true; self.btnCoach.title = "Body tracking for this step is not ready yet"; }
    });
  };

  // attach each coaching marker to the nearest tracked joint on the front frame
  function anchorMarks(marks, pose) {
    var f0 = pose.frames[0] || [];
    return marks.map(function (m) {
      var mx = m.x / MARK_VIEW.w * pose.w, my = m.y / MARK_VIEW.h * pose.h, best = null, bd = pose.w * 0.09;
      f0.forEach(function (p) {
        Object.keys(p.j).forEach(function (k) {
          var v = p.j[k]; if (v[2] < MIN_CONF) return;
          var d = Math.hypot(v[0] - mx, v[1] - my);
          if (d < bd) { bd = d; best = { id: p.id, k: k, dx: mx - v[0], dy: my - v[1] }; }
        });
      });
      return best;
    });
  }

  Viewer.prototype.setBg = function (bg) {
    if (bg === "stage" && assets.cutouts === false) return;
    this.bg = bg; this.dirty = true;
    this.root.querySelectorAll(".bsv-bg").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.bg === bg)); });
    this.modeEl.textContent = bg === "stage" ? "STAGE" : "GYM";
    this.root.classList.toggle("is-stage", bg === "stage");
    if (bg === "stage") this.loadCutouts();
  };
  Viewer.prototype.setCoach = function (on) {
    this.coach = on; this.dirty = true;
    this.btnCoach.setAttribute("aria-pressed", String(on));
    this.root.classList.toggle("is-coach", on);
    if (on && !this.pose) this.fetchPose();
  };
  Viewer.prototype.setFull = function (on) {
    this.full = on; this.dirty = true;
    this.btnFull.setAttribute("aria-pressed", String(on));
    this.root.classList.toggle("is-full", on);
    if (!on) { this.target = clamp(signed(this.pos), -SHARP, SHARP); }
  };
  Viewer.prototype.toggleSpin = function () { if (this.spinning) this.stopSpin(); else this.startSpin(); };
  Viewer.prototype.startSpin = function () {
    this.spinning = true; this.btnSpin.setAttribute("aria-pressed", "true");
    this.btnSpin.innerHTML = icon("pause") + "<span>Stop</span>"; this.hint.classList.add("off");
  };
  Viewer.prototype.stopSpin = function () {
    if (!this.spinning) return;
    this.spinning = false; this.btnSpin.setAttribute("aria-pressed", "false");
    this.btnSpin.innerHTML = icon("play") + "<span>Rotate</span>"; this.touch();
  };

  Viewer.prototype.step = function (now, dt) {
    var k = dt / 16.67;
    if (this.dragging) { /* pos set by pointer */ }
    else if (this.spinning) {
      var sp = (REDUCED ? 0.12 : 0.3) * k;
      if (this.full) this.pos += sp * this.spinDir;
      else {
        var s = signed(this.pos) + sp * this.spinDir;
        if (s > SHARP) { s = SHARP; this.spinDir = -1; } else if (s < -SHARP) { s = -SHARP; this.spinDir = 1; }
        this.pos = s;
      }
    } else if (this.target !== null) {
      var d = this.target - this.pos; this.pos += d * Math.min(1, 0.15 * k);
      if (Math.abs(d) < 0.05) { this.pos = this.target; this.target = null; }
    } else if (Math.abs(this.vel) > 0.02) {
      this.pos += this.vel * k; this.vel *= Math.pow(0.93, k);
      if (!this.full) {
        var w = signed(this.pos);
        if (Math.abs(w) > SHARP) { this.vel = 0; this.target = clamp(w, -SHARP, SHARP); this.pos = w; }
      }
    } else if (!this.full && Math.abs(signed(this.pos)) > SHARP + 0.01) {
      this.target = clamp(signed(this.pos), -SHARP, SHARP); this.pos = signed(this.pos);
    } else if (!REDUCED && this.opts.idle !== false && now - this.lastInteract > IDLE_DELAY) {
      this.idlePhase += 0.0105 * k;
      var goal = IDLE_AMP * Math.sin(this.idlePhase);
      var cur = signed(this.pos);
      this.pos = cur + (goal - cur) * Math.min(1, 0.06 * k);
    }
    var idx = wrap(this.pos);
    if (idx !== this.lastIdx) { this.lastIdx = idx; this.dirty = true; }
    if (this.fade) this.dirty = true;
  };

  Viewer.prototype.nearestLoaded = function (urlFn, idx) {
    for (var r = 0; r <= NUM / 2; r++) {
      var a = loaded(urlFn.call(this, wrap(idx + r))); if (a) return a;
      var b = loaded(urlFn.call(this, wrap(idx - r))); if (b) return b;
    }
    return null;
  };

  Viewer.prototype.resize = function () {
    var w = Math.round(this.stage.clientWidth * DPR), h = Math.round(this.stage.clientHeight * DPR);
    if (w && h && (w !== this.canvas.width || h !== this.canvas.height)) {
      this.canvas.width = w; this.canvas.height = h; this.stageBg = null; this.dirty = true;
    }
  };

  Viewer.prototype.draw = function () {
    if (!this.dirty) return;
    this.dirty = false;
    var ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, idx = wrap(this.pos);
    if (!W) return;
    var ang = Math.round(idx / NUM * 360);
    this.needle.setAttribute("transform", "rotate(" + ang + " 32 32)");
    this.degEl.textContent = (ang < 10 ? "00" : ang < 100 ? "0" : "") + ang + "°";
    var sharp = Math.abs(signed(idx)) <= SHARP;
    this.qualEl.textContent = sharp ? "SHARP" : "BETA";
    this.qualEl.classList.toggle("warn", !sharp);

    var useStage = this.bg === "stage", drewSomething = false;
    if (useStage) {
      if (!this.stageBg) { this.stageBg = document.createElement("canvas"); this.stageBg.width = W; this.stageBg.height = H; paintStage(this.stageBg.getContext("2d"), W, H); }
      ctx.drawImage(this.stageBg, 0, 0);
      var cut = loaded(this.cutURL(idx)) || this.nearestLoaded(this.cutURL, idx);
      if (cut) {
        var bb = bbox(cut);
        ctx.save();
        var cx = (bb.x0 + bb.x1) / 2 * W, rw = (bb.x1 - bb.x0) * W * 0.62, cy = bb.y1 * H;
        var sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rw);
        sg.addColorStop(0, "rgba(0,0,0,0.55)"); sg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.translate(cx, cy); ctx.scale(1, 0.12); ctx.translate(-cx, -cy);
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, rw, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.shadowColor = "rgba(110,200,255,0.85)"; ctx.shadowBlur = 14 * DPR;
        ctx.drawImage(cut, 0, 0, W, H);
        ctx.restore();
        drewSomething = true;
      }
    } else {
      var img = loaded(this.frameURL(idx)) || this.nearestLoaded(this.frameURL, idx);
      if (img) { ctx.drawImage(img, 0, 0, W, H); drewSomething = true; }
      else { ctx.fillStyle = "#0B111C"; ctx.fillRect(0, 0, W, H); }
    }

    if (this.coach && this.pose) this.drawSkeleton(ctx, W, H, idx);
    this.drawMarks(ctx, W, H, idx);

    if (this.fade) {
      var t = (performance.now() - this.fade.t0) / this.fade.dur;
      if (t >= 1) this.fade = null;
      else { ctx.save(); ctx.globalAlpha = 1 - t * t * (3 - 2 * t); ctx.drawImage(this.fade.from, 0, 0, W, H); ctx.restore(); }
    }
    if (drewSomething) this.lastDrawn = idx;
  };

  Viewer.prototype.drawSkeleton = function (ctx, W, H, idx) {
    var people = this.pose.frames[idx];
    if (!people || !people.length) return;
    var sx = W / this.pose.w, sy = H / this.pose.h, cols = ["#FF5A4E", "#4FD1FF"];
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    people.forEach(function (p) {
      var c = cols[p.id % 2], j = p.j;
      ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 12 * DPR; ctx.lineWidth = 3.2 * DPR;
      BONES.forEach(function (b) {
        var a = j[b[0]], z = j[b[1]];
        if (a && z && a[2] >= MIN_CONF && z[2] >= MIN_CONF) { ctx.beginPath(); ctx.moveTo(a[0] * sx, a[1] * sy); ctx.lineTo(z[0] * sx, z[1] * sy); ctx.stroke(); }
      });
      ctx.fillStyle = "#fff";
      Object.keys(j).forEach(function (k) { var v = j[k]; if (v[2] >= MIN_CONF) { ctx.beginPath(); ctx.arc(v[0] * sx, v[1] * sy, 3.4 * DPR, 0, 7); ctx.fill(); } });
    });
    ctx.shadowBlur = 0;
    ctx.font = "600 " + Math.round(11 * DPR) + "px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    people.forEach(function (p) {
      var j = p.j;
      // one knee and one hip label per side would collide on a side view; keep the most confident of each kind
      var pick = {};
      ANGLES.forEach(function (A) {
        var a = j[A[0]], b = j[A[1]], c = j[A[2]];
        if (!(a && b && c)) return;
        var conf = Math.min(a[2], b[2], c[2]);
        if (conf < 0.45) return;
        if (A[3] === "Hip") { if (!pick.hip || conf > pick.hip.conf) pick.hip = { A: A, conf: conf }; }
        else (pick.knees = pick.knees || []).push({ A: A, conf: conf });
      });
      var chosen = (pick.knees || []).concat(pick.hip ? [pick.hip] : []);
      chosen.forEach(function (o) {
        var A = o.A, a = j[A[0]], b = j[A[1]], c = j[A[2]];
        var v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
        var cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
        var deg = Math.round(Math.acos(clamp(cos, -1, 1)) * 180 / Math.PI);
        var t = A[3].toUpperCase() + " " + deg + "°", x = b[0] * sx + 10 * DPR, y = b[1] * sy - 10 * DPR;
        var tw = ctx.measureText(t).width;
        ctx.fillStyle = "rgba(7,11,20,0.78)"; ctx.fillRect(x - 5 * DPR, y - 9 * DPR, tw + 10 * DPR, 18 * DPR);
        ctx.fillStyle = "#E8F6FF"; ctx.fillText(t, x, y);
      });
    });
    ctx.restore();
  };

  Viewer.prototype.drawMarks = function (ctx, W, H, idx) {
    if (!this.marks.length || document.body.classList.contains("marks-off")) return;
    var near = Math.abs(signed(idx)) <= 1, pts = [];
    var self = this;
    this.marks.forEach(function (m, n) {
      var x = null, y = null;
      var an = self.anchors && self.anchors[n];
      if (an && self.pose) {
        var people = self.pose.frames[idx] || [], p = people.filter(function (q) { return q.id === an.id; })[0];
        var v = p && p.j[an.k];
        if (v && v[2] >= MIN_CONF && Math.abs(signed(idx)) <= SHARP + 2) { x = (v[0] + an.dx) / self.pose.w * W; y = (v[1] + an.dy) / self.pose.h * H; }
      } else if (near && !(an && self.pose && Math.abs(signed(idx)) > 1)) { x = m.x / MARK_VIEW.w * W; y = m.y / MARK_VIEW.h * H; }
      if (x !== null) pts.push([x, y, n + 1]);
    });
    ctx.save();
    var r = 12 * DPR;
    ctx.font = "700 " + Math.round(12 * DPR) + "px Barlow, Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    pts.forEach(function (p) {
      ctx.beginPath(); ctx.arc(p[0], p[1], r + 5 * DPR, 0, 7); ctx.fillStyle = "rgba(198,28,24,0.25)"; ctx.fill();
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fillStyle = "#C61C18"; ctx.fill();
      ctx.lineWidth = 2 * DPR; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillText(p[2], p[0], p[1] + 0.5 * DPR);
    });
    ctx.restore();
  };

  // ---------- one animation loop for every viewer ----------
  var lastT = performance.now();
  function loop(now) {
    var dt = Math.min(64, now - lastT); lastT = now;
    for (var i = 0; i < viewers.length; i++) {
      var v = viewers[i];
      if (!v.visible) continue;
      v.resize(); v.step(now, dt); v.draw();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.addEventListener("resize", function () { viewers.forEach(function (v) { v.dirty = true; }); });

  // probe once whether cut-outs have been published
  function probeAssets(firstId) {
    var img = new Image();
    img.onload = function () { assets.cutouts = true; document.documentElement.classList.add("has-cutouts"); };
    img.onerror = function () {
      assets.cutouts = false; document.documentElement.classList.add("no-cutouts");
      viewers.forEach(function (v) { v.root.querySelector('[data-bg="stage"]').disabled = true; v.root.querySelector('[data-bg="stage"]').title = "Stage view is not ready yet"; });
    };
    img.src = "cutouts/" + firstId + "/00.webp";
  }

  window.BSViewer = { Viewer: Viewer, viewers: viewers, probe: probeAssets, NUM: NUM, SHARP: SHARP, signed: signed };
})();
