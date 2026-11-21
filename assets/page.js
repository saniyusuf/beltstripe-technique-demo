/* Library page wiring: one viewer per step card, full-screen study mode,
 * "play the move" timeline, keyboard shortcuts and tilt-to-turn. */
(function () {
  "use strict";
  var DATA = window.TECHNIQUES;
  var V = window.BSViewer;
  var byStep = {};
  DATA.forEach(function (m) { m.steps.forEach(function (s, i) { byStep[s.id] = { move: m, step: s, index: i }; }); });

  // per-step viewers
  document.querySelectorAll("[data-viewer]").forEach(function (el) {
    var info = byStep[el.dataset.viewer];
    new V.Viewer(el, {
      id: info.step.id, marks: info.step.marks, study: true,
      label: info.move.title + ", step " + (info.index + 1) + ", " + info.step.name + ". Drag or use arrow keys to turn.",
      onStudy: function (v) { openStudy(info.move, info.index, v); }
    });
  });
  V.probe(DATA[0].steps[0].id);

  // numbers toggle
  var marksToggle = document.getElementById("marksToggle");
  marksToggle.addEventListener("click", function () {
    var off = document.body.classList.toggle("marks-off");
    marksToggle.setAttribute("aria-pressed", String(off));
    marksToggle.textContent = off ? "Show numbers" : "Hide numbers";
    V.viewers.forEach(function (v) { v.dirty = true; });
  });

  // ---------- study mode ----------
  var study = document.getElementById("study");
  var sv = null, cur = { move: null, index: 0 }, playing = false, playTimer = null, returnFocus = null;
  var el = function (id) { return document.getElementById(id); };
  var HOLD = 2600;

  function renderNotes() {
    var s = cur.move.steps[cur.index];
    el("studyMove").textContent = cur.move.title + " · Step " + (cur.index + 1) + " of " + cur.move.steps.length;
    el("studyTitle").textContent = s.name;
    el("studyDo").textContent = s.do;
    var ol = el("studyMarks"); ol.innerHTML = "";
    s.marks.forEach(function (m, i) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="num">' + (i + 1) + '</span><span></span>';
      li.lastChild.textContent = m.text; ol.appendChild(li);
    });
    var tl = el("studySteps"); tl.innerHTML = "";
    cur.move.steps.forEach(function (st, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "tl-seg"; b.setAttribute("aria-current", String(i === cur.index));
      if (i < cur.index) b.classList.add("past");
      b.innerHTML = '<span class="tl-fill"></span><span class="tl-n">' + (i + 1) + '</span><span class="tl-name"></span>';
      b.querySelector(".tl-name").textContent = st.name;
      b.addEventListener("click", function () { stopPlay(); go(i); });
      tl.appendChild(b);
    });
  }
  function go(i) {
    cur.index = Math.max(0, Math.min(cur.move.steps.length - 1, i));
    var s = cur.move.steps[cur.index];
    sv.setPose(s.id, s.marks, false);
    renderNotes();
  }
  function openStudy(move, index, from) {
    returnFocus = document.activeElement;
    cur.move = move; cur.index = index;
    study.hidden = false; document.body.classList.add("studying");
    var s = move.steps[index];
    if (!sv) {
      sv = new V.Viewer(el("studyView"), { id: s.id, marks: s.marks, study: false, label: "Study view. Arrow keys turn, number keys change step." });
      sv.visible = true;
    } else sv.setPose(s.id, s.marks, true);
    sv.visible = true; sv.ensureLoading();
    if (from) { sv.setBg(from.bg); sv.setCoach(from.coach); sv.setFull(from.full); sv.pos = from.pos; }
    renderNotes();
    el("studyClose").focus();
  }
  function closeStudy() {
    stopPlay(); stopTilt();
    study.hidden = true; document.body.classList.remove("studying");
    if (sv) sv.visible = false;
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }
  function play() {
    playing = true; el("studyPlay").setAttribute("aria-pressed", "true"); el("studyPlay").lastChild.textContent = "Pause";
    study.classList.add("playing");
    if (cur.index >= cur.move.steps.length - 1) go(0);
    tick();
  }
  function tick() {
    var seg = el("studySteps").children[cur.index];
    if (seg) { seg.classList.add("run"); seg.style.setProperty("--hold", HOLD + "ms"); }
    playTimer = setTimeout(function () {
      if (!playing) return;
      if (cur.index >= cur.move.steps.length - 1) { stopPlay(); return; }
      go(cur.index + 1); tick();
    }, HOLD);
  }
  function stopPlay() {
    playing = false; clearTimeout(playTimer);
    study.classList.remove("playing");
    var b = el("studyPlay"); b.setAttribute("aria-pressed", "false"); b.lastChild.textContent = "Play the move";
    document.querySelectorAll(".tl-seg.run").forEach(function (s) { s.classList.remove("run"); });
  }
  el("studyPlay").addEventListener("click", function () { if (playing) stopPlay(); else play(); });
  el("studyClose").addEventListener("click", closeStudy);
  el("studyPrev").addEventListener("click", function () { stopPlay(); go(cur.index - 1); });
  el("studyNext").addEventListener("click", function () { stopPlay(); go(cur.index + 1); });
  document.addEventListener("keydown", function (e) {
    if (study.hidden) return;
    if (e.key === "Escape") { closeStudy(); }
    else if (e.key === "ArrowLeft") { sv.nudge(-2); e.preventDefault(); }
    else if (e.key === "ArrowRight") { sv.nudge(2); e.preventDefault(); }
    else if (e.key === "ArrowUp") { stopPlay(); go(cur.index - 1); e.preventDefault(); }
    else if (e.key === "ArrowDown") { stopPlay(); go(cur.index + 1); e.preventDefault(); }
    else if (/^[1-9]$/.test(e.key)) { stopPlay(); go(Number(e.key) - 1); }
    else if (e.key === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); if (playing) stopPlay(); else play(); }
    else if (e.key === "Tab") {
      var f = study.querySelectorAll("button:not([disabled]), [tabindex='0']");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  });

  // "Play the move" on each move header opens study mode and plays from step 1
  document.querySelectorAll("[data-play]").forEach(function (b) {
    b.addEventListener("click", function () {
      var m = DATA.filter(function (x) { return x.id === b.dataset.play; })[0];
      openStudy(m, 0, null); play();
    });
  });

  // ---------- tilt to turn (phones) ----------
  var tiltBtn = el("studyTilt"), tilting = false;
  if (!("DeviceOrientationEvent" in window) || !matchMedia("(pointer: coarse)").matches) tiltBtn.hidden = true;
  function onTilt(e) {
    if (!sv || e.gamma === null) return;
    var g = Math.max(-35, Math.min(35, e.gamma));
    sv.target = g / 35 * V.SHARP; sv.lastInteract = performance.now(); sv.vel = 0;
  }
  function startTilt() {
    var go2 = function () { window.addEventListener("deviceorientation", onTilt); tilting = true; tiltBtn.setAttribute("aria-pressed", "true"); };
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then(function (r) { if (r === "granted") go2(); }).catch(function () {});
    } else go2();
  }
  function stopTilt() { window.removeEventListener("deviceorientation", onTilt); tilting = false; tiltBtn.setAttribute("aria-pressed", "false"); }
  tiltBtn.addEventListener("click", function () { if (tilting) stopTilt(); else startTilt(); });
})();
