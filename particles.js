// Particle wordmark under the header. Neon dots spell BVNGER, fold into a spinning ball, then spell BVNGER again.
// A visitor can type one word: the dots spell it for a few seconds, then go back to BVNGER.
(function(){
  var canvas = document.getElementById('pfx');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var form = document.getElementById('pfx-form');
  var input = document.getElementById('pfx-word');

  var COLORS = ['#b026ff', '#2f7bff', '#ff2ec4'];   // neon purple, blue, pink
  var HOME = 'BVNGER';
  var FONT = '"Barlow Semi Condensed","Arial Narrow",sans-serif';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MORPH = reduce ? 0.001 : 1.8;                  // seconds for one shape change
  var HOLD_HOME = reduce ? Infinity : 3.5, HOLD_BALL = 3, HOLD_TYPED = 4.5;

  // Preview hooks for recording videos of the effect: ?pfxt=<ms> draws one still frame at that time,
  // and ?pfxword=WORD&pfxwordat=<ms> acts as if a visitor typed WORD at that time.
  var q = new URLSearchParams(location.search);
  var freezeAt = q.has('pfxt') ? +q.get('pfxt') / 1000 : null;
  var fakeWord = q.get('pfxword'), fakeAt = q.has('pfxwordat') ? +q.get('pfxwordat') / 1000 : 0;

  // Seeded random numbers, so the dots land the same way on every load and in every preview frame.
  var seed = 7;
  function rnd(){
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function ease(k){ return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

  var W = 0, H = 0, DPR = 1, N = 0, R = 0;
  var px, py, pz, fx, fy, fz, delay, phase, drift, size, byColor;
  var FLOAT = 0;                                     // how far orbs drift around their spot in a word (px)
  var ballX, ballY, ballZ, shapes, seg, clock = 0;
  var GLOW = 4.5;                                    // glow width compared to the orb
  var orbs = [], glows = [];

  // One small picture per colour, drawn once and reused for every dot: a round orb with a bright
  // centre, and a soft glow that sits behind it.
  function rgba(hex, a){
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function makeSprites(){
    var S = 64, h = S / 2;
    COLORS.forEach(function(hex){
      var g = document.createElement('canvas'); g.width = g.height = S;
      var c = g.getContext('2d'), gr = c.createRadialGradient(h, h, 0, h, h, h);
      gr.addColorStop(0, rgba(hex, 0.5)); gr.addColorStop(0.3, rgba(hex, 0.2)); gr.addColorStop(1, rgba(hex, 0));
      c.fillStyle = gr; c.fillRect(0, 0, S, S);
      glows.push(g);
      var o = document.createElement('canvas'); o.width = o.height = S;
      c = o.getContext('2d');
      var og = c.createRadialGradient(h * 0.75, h * 0.75, 0, h, h, h);
      og.addColorStop(0, 'rgba(255,255,255,0.95)'); og.addColorStop(0.35, rgba(hex, 1));
      og.addColorStop(0.85, rgba(hex, 0.9)); og.addColorStop(1, rgba(hex, 0));
      c.fillStyle = og; c.beginPath(); c.arc(h, h, h, 0, Math.PI * 2); c.fill();
      orbs.push(o);
    });
  }
  makeSprites();

  function setup(){
    var box = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(box.width)); H = Math.max(1, Math.round(box.height));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    N = W < 560 ? 2800 : 5200;
    R = Math.min(H * 0.42, W * 0.22);
    seed = 7;
    px = new Float32Array(N); py = new Float32Array(N); pz = new Float32Array(N);
    fx = new Float32Array(N); fy = new Float32Array(N); fz = new Float32Array(N);
    delay = new Float32Array(N); phase = new Float32Array(N); drift = new Float32Array(N); size = new Float32Array(N);
    FLOAT = reduce ? 0 : (W < 560 ? 1.2 : 1.8);
    ballX = new Float32Array(N); ballY = new Float32Array(N); ballZ = new Float32Array(N);
    byColor = [[], [], []];
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      // Even spread of points over a sphere (Fibonacci sphere).
      var y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), a = i * golden;
      ballX[i] = Math.cos(a) * r; ballY[i] = y; ballZ[i] = Math.sin(a) * r;
      delay[i] = rnd(); phase[i] = rnd() * Math.PI * 2; drift[i] = 0.5 + rnd() * 0.6; size[i] = (0.7 + rnd() * 0.4) * (W < 560 ? 0.8 : 1);
      byColor[Math.floor(rnd() * 3)].push(i);
      // Start scattered over the whole strip, then fly in to BVNGER.
      px[i] = (rnd() - 0.5) * W; py[i] = (rnd() - 0.5) * H; pz[i] = 0;
    }
    shapes = {};
    seg = null;
    clock = 0;
    begin(HOME, HOLD_HOME, false);
  }

  // Points that cover the letters of a word, centred on the strip, one per dot.
  function wordShape(word){
    if (shapes[word]) return shapes[word];
    var off = document.createElement('canvas');
    off.width = W; off.height = H;
    var c = off.getContext('2d');
    var fs = H * 0.72;
    c.font = '800 ' + fs + 'px ' + FONT;
    var m = c.measureText(word).width;
    if (m > W * 0.9) { fs *= W * 0.9 / m; c.font = '800 ' + fs + 'px ' + FONT; }
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
    c.fillText(word, W / 2, H / 2 + fs * 0.04);
    var data = c.getImageData(0, 0, W, H).data, filled = 0, x, y;
    for (var p = 3; p < data.length; p += 4) if (data[p] > 128) filled++;
    var step = Math.max(1.5, Math.sqrt(filled / (N * 1.15)));
    var pts = [];
    for (y = step / 2; y < H; y += step) for (x = step / 2; x < W; x += step) {
      if (data[((y | 0) * W + (x | 0)) * 4 + 3] > 128) pts.push(x - W / 2 + (rnd() - 0.5) * step * 0.3, y - H / 2 + (rnd() - 0.5) * step * 0.3);
    }
    var count = pts.length / 2, sx = new Float32Array(N), sy = new Float32Array(N);
    if (!count) { pts.push(0, 0); count = 1; }
    var order = [];
    for (var k = 0; k < count; k++) order.push(k);
    for (k = count - 1; k > 0; k--) { var j = Math.floor(rnd() * (k + 1)), t = order[k]; order[k] = order[j]; order[j] = t; }
    for (var i = 0; i < N; i++) {
      // A short word has fewer spots than dots: extra dots double up on spots with a tiny offset.
      var s = order[i % count];
      sx[i] = pts[s * 2] + (i >= count ? (rnd() - 0.5) * 1.5 : 0);
      sy[i] = pts[s * 2 + 1] + (i >= count ? (rnd() - 0.5) * 1.5 : 0);
    }
    return (shapes[word] = {x: sx, y: sy});
  }

  // Start moving every dot to a new shape ('ball' or a word). If the old shape had finished forming, the dots
  // leave it while it keeps moving (the ball keeps spinning, a word keeps floating). Only a shape cut off
  // mid-change starts from a frozen copy of where the dots are.
  function begin(shape, hold, typed){
    var live = !!seg && clock - seg.start >= MORPH;
    for (var i = 0; i < N; i++) { fx[i] = px[i]; fy[i] = py[i]; fz[i] = pz[i]; }
    seg = {shape: shape, hold: hold, typed: typed, start: clock, pts: shape === 'ball' ? null : wordShape(shape),
           live: live, fromPts: live ? seg.pts : null};
  }

  // The loop: BVNGER -> ball -> BVNGER. A visitor's word also goes back into the ball, then on to BVNGER.
  // With reduced motion there is no spinning ball, so a visitor's word goes straight back to BVNGER.
  function next(){
    if (seg.shape === 'ball' || (seg.typed && reduce)) begin(HOME, HOLD_HOME, false);
    else begin('ball', HOLD_BALL, false);
  }

  // Where dot i sits right now in a shape: a word (pts) or the spinning ball (pts null). Result in sx, sy, sz.
  var sx = 0, sy = 0, sz = 0, cs = 1, sn = 0, tc = Math.cos(0.35), ts = Math.sin(0.35);
  function shapeAt(pts, i){
    if (pts) {
      // Each orb drifts slowly around its spot on two mixed waves, at its own speed, and bobs a little
      // toward and away from the viewer, so the word keeps floating instead of sitting still.
      var sp = drift[i], ph = phase[i];
      sx = pts.x[i] + (Math.sin(clock * sp + ph) + 0.5 * Math.sin(clock * sp * 1.7 + ph * 2)) * FLOAT;
      sy = pts.y[i] + (Math.cos(clock * sp * 0.9 + ph) + 0.5 * Math.cos(clock * sp * 1.4 + ph * 3)) * FLOAT;
      sz = Math.sin(clock * sp * 0.8 + ph) * FLOAT * 4;
    } else {
      // Spin the sphere around its upright axis, tilted a little toward the viewer.
      var bx = ballX[i] * cs + ballZ[i] * sn, bz = -ballX[i] * sn + ballZ[i] * cs, by = ballY[i];
      sx = bx * R; sy = (by * tc - bz * ts) * R; sz = (by * ts + bz * tc) * R;
    }
  }

  function step(dt){
    clock += dt;
    var e = clock - seg.start, spin = clock * 0.45;
    cs = Math.cos(spin); sn = Math.sin(spin);
    for (var i = 0; i < N; i++) {
      var k = (e - delay[i] * MORPH * 0.4) / (MORPH * 0.6);
      k = k <= 0 ? 0 : k >= 1 ? 1 : ease(k);
      var ax = fx[i], ay = fy[i], az = fz[i];
      if (seg.live && k < 1) { shapeAt(seg.fromPts, i); ax = sx; ay = sy; az = sz; }   // old shape, still moving
      shapeAt(seg.pts, i);
      px[i] = ax + (sx - ax) * k; py[i] = ay + (sy - ay) * k; pz[i] = az + (sz - az) * k;
    }
    if (e >= MORPH + seg.hold) next();
  }

  function draw(){
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var F = R * 3, cx = W / 2, cy = H / 2;
    // Two passes: the glows add up into a soft neon haze, then the round orbs go on top of it.
    for (var pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass ? 'source-over' : 'lighter';
      for (var c = 0; c < 3; c++) {
        var img = pass ? orbs[c] : glows[c], list = byColor[c];
        for (var n = 0; n < list.length; n++) {
          var i = list[n], s = F / (F + pz[i]), x = cx + px[i] * s, y = cy + py[i] * s;
          var a = 0.9 - pz[i] / (R * 2); a = a < 0.3 ? 0.3 : a > 1 ? 1 : a;
          var r = size[i] * s * (pass ? 1 : GLOW);
          ctx.globalAlpha = pass ? a : a * 0.8;
          ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function showWord(raw){
    var word = String(raw || '').trim().split(/\s+/)[0].slice(0, 12).toUpperCase();
    if (word) begin(word, HOLD_TYPED, true);
  }

  var last = 0;
  function frame(ts){
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0;
    last = ts;
    step(dt); draw();
    requestAnimationFrame(frame);
  }

  function start(){
    setup();
    if (freezeAt !== null) {
      // Preview still: hide the background rain so frames match, run the clock to the asked time, draw once.
      [].forEach.call(document.querySelectorAll('canvas'), function(el){ if (el !== canvas) el.style.visibility = 'hidden'; });
      var typedDone = false;
      while (clock < freezeAt) {
        if (fakeWord && !typedDone && clock >= fakeAt) { showWord(fakeWord); typedDone = true; }
        step(1 / 60);
      }
      draw();
      return;
    }
    if (form) form.addEventListener('submit', function(e){ e.preventDefault(); showWord(input.value); input.value = ''; });
    var lastW = W;
    window.addEventListener('resize', function(){
      clearTimeout(start.t);
      start.t = setTimeout(function(){ if (Math.round(canvas.getBoundingClientRect().width) !== lastW) { setup(); lastW = W; } }, 200);
    });
    requestAnimationFrame(frame);
  }

  // Wait for the site's display font so the letters are drawn in it, but never longer than 1.5 s.
  var started = false;
  function go(){ if (!started) { started = true; start(); } }
  if (document.fonts && document.fonts.load) document.fonts.load('800 100px "Barlow Semi Condensed"').then(go, go);
  setTimeout(go, 1500);
})();
