"""Build index.html from tools/content.json.

Run from the repo root:  python3 tools/build_index.py
Content (moves, steps, coaching notes, marker positions) lives in tools/content.json.
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
moves = json.loads((ROOT / "tools" / "content.json").read_text())
e = html.escape


def step_card(move, i, step):
    n = len(move["steps"])
    marks = "".join(
        f'<li><span class="num">{k + 1}</span><span>{e(m["text"])}</span></li>' for k, m in enumerate(step["marks"])
    )
    return f"""
<section class="step" id="{step['id']}">
  <div class="viewer" data-viewer="{step['id']}"></div>
  <div class="notes">
    <div class="eyebrow">{e(move['title'])} · Step {i + 1} of {n}</div>
    <h3>{e(step['name'])}</h3>
    <p class="do">{e(step['do'])}</p>
    <ol class="marks">{marks}</ol>
    <p class="marks-note">Numbers follow the body as you turn when Coach view data is available.</p>
  </div>
</section>"""


def move_section(move):
    thumbs = "".join(
        f'<a class="thumb" href="#{s["id"]}"><img src="thumbs/{s["id"]}.webp" alt="" width="480" height="320" loading="lazy"><span><b>{i + 1}</b> {e(s["name"])}</span></a>'
        for i, s in enumerate(move["steps"])
    )
    cards = "".join(step_card(move, i, s) for i, s in enumerate(move["steps"]))
    return f"""
<section class="move" id="{move['id']}">
  <div class="move-head">
    <div><div class="eyebrow">{e(move['eyebrow'])}</div><h2>{e(move['title'])}</h2><p>{e(move['lede'])}</p></div>
    <button type="button" class="play-move" data-play="{move['id']}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>Play the move</button>
  </div>
  <nav class="strip" aria-label="{e(move['title'])} steps">{thumbs}</nav>
  {cards}
</section>"""


n_steps = sum(len(m["steps"]) for m in moves)
data_js = json.dumps(moves, ensure_ascii=False).replace("</", "<\\/")

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Beltstripe Technique Demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap">
<link rel="stylesheet" href="assets/viewer.css">
<link rel="stylesheet" href="assets/page.css">
<link rel="preload" as="image" href="frames-webp/{moves[0]['steps'][0]['id']}/00.webp">
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="eyebrow">Beltstripe · Technique library</div>
    <h1>See every move from every side</h1>
    <p class="lede">Each step of the move, captured all the way round. Drag to turn, switch on Coach view to see the joints and angles, or put the fighters on the stage to study the shape without the gym.</p>
    <dl class="facts">
      <div><dt>Moves</dt><dd>{len(moves)}</dd></div>
      <div><dt>Positions</dt><dd>{n_steps}</dd></div>
      <div><dt>Angles each</dt><dd>96</dd></div>
      <div><dt>Frames</dt><dd>{n_steps * 96}</dd></div>
    </dl>
    <div class="toolbar">
      {''.join(f'<a href="#{m["id"]}">{e(m["title"])}</a>' for m in moves)}
      <button type="button" class="toggle" id="marksToggle" aria-pressed="false">Hide numbers</button>
    </div>
  </header>
  {''.join(move_section(m) for m in moves)}
  <section class="panel">
    <h2>How it would work for students</h2>
    <div class="cols">
      <div><h3>Their own library</h3><ul>
        <li>Every technique taught in class, broken into clear steps.</li>
        <li>A full 360° view of each step, so nothing is hidden behind the camera angle.</li>
      </ul></div>
      <div><h3>Starring the student</h3><ul>
        <li>A student uploads a few photos and appears as the partner in every move.</li>
        <li>Their partner can match their size, so the move looks like it will on the mat.</li>
      </ul></div>
      <div><h3>Approved by the coach</h3><ul>
        <li>The coach signs off each move once before students see it.</li>
        <li>Key details for each step come straight from the coach's teaching.</li>
      </ul></div>
    </div>
    <p><a class="ar-link" href="ar/">Place a move on your own mat in AR →</a></p>
  </section>
  <p class="foot">All photos on this page are generated from photos of Sani. The training partner is not a real person. The sharp arc on the compass marks the angles closest to the original photos. Angles outside it are marked Beta.</p>
</div>

<div class="study" id="study" hidden role="dialog" aria-modal="true" aria-labelledby="studyTitle">
  <div class="study-top">
    <div><div class="eyebrow" id="studyMove"></div><h2 id="studyTitle"></h2></div>
    <div class="study-actions">
      <button type="button" class="s-btn" id="studyTilt" aria-pressed="false">Tilt to turn</button>
      <button type="button" class="s-btn" id="studyClose" aria-label="Close study mode">Close <kbd>Esc</kbd></button>
    </div>
  </div>
  <div class="study-body">
    <div class="study-view"><div id="studyView"></div></div>
    <aside class="study-notes">
      <p id="studyDo"></p>
      <ol class="marks" id="studyMarks"></ol>
      <p class="keys"><kbd>←</kbd><kbd>→</kbd> turn · <kbd>↑</kbd><kbd>↓</kbd> or <kbd>1</kbd>–<kbd>5</kbd> step · <kbd>Space</kbd> play</p>
    </aside>
  </div>
  <div class="study-timeline">
    <button type="button" class="s-btn" id="studyPrev" aria-label="Previous step">‹</button>
    <button type="button" class="s-btn s-play" id="studyPlay" aria-pressed="false"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg><span>Play the move</span></button>
    <div class="tl" id="studySteps"></div>
    <button type="button" class="s-btn" id="studyNext" aria-label="Next step">›</button>
  </div>
</div>

<script>window.TECHNIQUES = {data_js};</script>
<script src="assets/viewer.js"></script>
<script src="assets/page.js"></script>
</body>
</html>
"""
(ROOT / "index.html").write_text(page)
print("index.html", len(page), "bytes")
