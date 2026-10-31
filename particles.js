// Particle effect under the header. Neon dots gather into a spinning ball and stay there.
// A visitor can type one word: the dots spell it for a few seconds, then go back into the ball.
// The ball acts like a blob of water, and a galaxy bursts out around each word once its letters have formed.
(function(){
  var canvas = document.getElementById('pfx');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var form = document.getElementById('pfx-form');
  var input = document.getElementById('pfx-word');

  var COLORS = ['#b026ff', '#2f7bff', '#ff2ec4'];   // neon purple, blue, pink
  var HOME = 'BVNGER';                               // never spelled on its own now, but every galaxy is sized to fit it
  var FONT = '"Barlow Semi Condensed","Arial Narrow",sans-serif';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MORPH = reduce ? 0.001 : 1.8;                  // seconds for one shape change
  var HOLD_TYPED = 5;                                // seconds a visitor's word stays up before going back into the ball

  // Preview hooks for recording videos of the effect: ?pfxt=<ms> draws one still frame at that time,
  // and ?pfxword=WORD&pfxwordat=<ms> acts as if a visitor typed WORD at that time.
  var q = new URLSearchParams(location.search);
  var freezeAt = q.has('pfxt') ? +q.get('pfxt') / 1000 : null;
  var fakeWord = q.get('pfxword'), fakeAt = q.has('pfxwordat') ? +q.get('pfxwordat') / 1000 : 0;
  var shot = q.has('pfxvp') ? q.get('pfxvp').split('x').map(Number) : null;   // ?pfxvp=1280x800: the still's real size

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
  var RIPPLE = 0.07;                                 // how far ripples lift the ball's surface (share of its radius)
  var rip1, rip2, rip3, shine, coreAmt = 0;          // rip1/2/3 = each orb's spot along the three background waves
  var orbs = [], glows = [], core;

  // The ball acts like a blob of water held up against gravity. Each of these is a spring: gravity holds it off
  // centre (rest), random splashes knock it, and surface tension pulls it back so it wobbles and settles.
  // w = how fast it wobbles, c = how fast the wobble dies down, max = the most it can bend the ball.
  var SAG = {rest: 0.035, w: 5, c: 0.9, max: 0.09};    // squashes and stretches top to bottom
  var PEAR = {rest: 0.02, w: 9.7, c: 1.4, max: 0.05};  // bottom-heavy, like a hanging drop
  var LEAN = {rest: 0, w: 5.5, c: 0.9, max: 0.07};     // slumps to one side
  var BOB = {rest: 0, w: 3, c: 0.7, max: 0.04};        // the whole ball sinks and rises
  var springs = [SAG, PEAR, LEAN, BOB];
  var rings = [], nextSplash = 0, wave1 = 0, wave2 = 0, wave3 = 0;
  var RING_LIFE = 2.6, RING_SPEED = 1.1, RING_WIDTH = 0.3;

  // The galaxy that bursts out of the ball when a word forms. It has its own see-through canvas across the whole
  // window, so it can spill past the panels on the page. It sits behind the page (z-index -1): measured on an iPhone
  // in Safari, any full-window layer in front of the page drops everything to 12 frames a second, even with nothing
  // drawn on it, and the same galaxy behind the page holds 60.
  var gal = document.createElement('canvas');
  gal.setAttribute('aria-hidden', 'true');
  gal.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:none';
  // The galaxy's soft clouds and flashes go on a second layer underneath, drawn at quarter size and stretched to fit
  // by the browser. They're blurry anyway, so nobody can tell, and it's about 16 times less work every frame.
  var cloud = gal.cloneNode();
  document.body.appendChild(cloud);
  document.body.appendChild(gal);
  var gctx = gal.getContext('2d'), cctx = cloud.getContext('2d'), CLOUD_SCALE = 0.25;
  var GAL_OPEN = 1.5, GAL_CLOSE = 1.5;               // seconds to burst out, and to get sucked back into the ball
  var GAL_WIND = 4.2, GAL_TILT = -0.12;            // how tightly the arms curl, and how far the galaxy leans
  // Inner stars orbit faster than outer ones, so the arms wind tighter the longer the stars have been turning.
  // Every galaxy starts as if they've been turning this many seconds, which makes each one look exactly the same.
  var GAL_TURNED = 13.4;
  // Seconds of random head start between stars as the galaxy opens. A little keeps its leading edge soft, but too much
  // breaks up the swirl into loose dust.
  var GAL_SPREAD = 0.25;
  var GAL_CLOUD = 0.2;                             // how strong the galaxy's soft colour clouds are, 0 to 1
  var M = 0, PUFFS = 130, galOn = false, galNext = -1, galStart = 0, galClosing = false, galClose = 0, galPulse = 0, galDrawn = false;
  var gT, gA, gC, gSize, gPh, gLate, gRx, gRy, gX, gY, gL, gList, gApart = 0, gBpart = 0;

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
      gr.addColorStop(0, rgba(hex, 0.65)); gr.addColorStop(0.3, rgba(hex, 0.26)); gr.addColorStop(1, rgba(hex, 0));
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
    // The light inside the ball: a bright pink centre fading out through pink, purple and blue.
    core = document.createElement('canvas'); core.width = core.height = 256;
    var cc = core.getContext('2d'), cg = cc.createRadialGradient(128, 128, 0, 128, 128, 128);
    cg.addColorStop(0, 'rgba(255,130,230,1)'); cg.addColorStop(0.16, rgba(COLORS[2], 0.8));
    cg.addColorStop(0.45, rgba(COLORS[0], 0.45)); cg.addColorStop(0.78, rgba(COLORS[1], 0.14)); cg.addColorStop(1, rgba(COLORS[1], 0));
    cc.fillStyle = cg; cc.fillRect(0, 0, 256, 256);
  }
  makeSprites();

  function setup(){
    var box = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(box.width)); H = Math.max(1, Math.round(box.height));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    N = W < 560 ? 2800 : 5200;
    R = Math.min(H * 0.38, W * 0.22);
    seed = 7;
    px = new Float32Array(N); py = new Float32Array(N); pz = new Float32Array(N);
    fx = new Float32Array(N); fy = new Float32Array(N); fz = new Float32Array(N);
    delay = new Float32Array(N); phase = new Float32Array(N); drift = new Float32Array(N); size = new Float32Array(N);
    FLOAT = reduce ? 0 : (W < 560 ? 1.2 : 1.8);
    ballX = new Float32Array(N); ballY = new Float32Array(N); ballZ = new Float32Array(N);
    rip1 = new Float32Array(N); rip2 = new Float32Array(N); rip3 = new Float32Array(N); shine = new Float32Array(N);
    coreAmt = 0; rings = []; nextSplash = 0;
    springs.forEach(function(m){ m.x = m.now = m.rest; m.v = 0; });
    // Galaxy stars: three curled arms, pink near the middle and blue at the rim. The first few are big soft clouds.
    M = W < 560 ? 1600 : 4200;
    gT = new Float32Array(M); gA = new Float32Array(M); gC = new Uint8Array(M); gSize = new Float32Array(M);
    gPh = new Float32Array(M); gLate = new Float32Array(M); gRx = new Float32Array(M); gRy = new Float32Array(M);
    gX = new Float32Array(M); gY = new Float32Array(M); gL = new Float32Array(M);
    gList = [[], [], []];
    galOn = false; galNext = -1; galClosing = false; galClose = 0; galPulse = 0;
    for (var g = 0; g < M; g++) {
      // Most stars gather along an arm, thicker near the middle. Every eighth star and a third of the clouds fill the
      // gaps between the arms with a soft haze, while the other clouds light up the arms themselves.
      var gt = Math.pow(rnd(), 0.8), arm = Math.floor(rnd() * 3), haze = g < PUFFS ? g % 3 === 0 : g % 8 === 0;
      gT[g] = gt;
      gA[g] = arm * Math.PI * 2 / 3 + (rnd() - 0.5) * (haze ? 6.3 : rnd() * 1.5 * (0.45 + (1 - gt) * 0.55));
      var band = gt + (rnd() - 0.5) * 0.5;
      gC[g] = band < 0.38 ? 2 : band < 0.72 ? 0 : 1;   // COLORS: 2 pink, 0 purple, 1 blue
      if (g >= PUFFS) gList[gC[g]].push(g);
      gSize[g] = g < PUFFS ? (35 + rnd() * 55) * (W < 560 ? 0.6 : 1) : (0.55 + rnd() * 0.55) * (W < 560 ? 0.8 : 1);
      gPh[g] = rnd() * Math.PI * 2;
      gLate[g] = (gPh[g] * 57.3) % 1;   // how late this star sets off, 0 to 1. Made from gPh, so no other random number changes.
    }
    byColor = [[], [], []];
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      // Even spread of points over a sphere (Fibonacci sphere).
      var y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), a = i * golden;
      ballX[i] = Math.cos(a) * r; ballY[i] = y; ballZ[i] = Math.sin(a) * r;
      // Three background waves spread out from three different points on the ball.
      rip1[i] = ballX[i] * 0.5 + y * 0.7 + ballZ[i] * 0.51; rip2[i] = -ballX[i] * 0.6 - y * 0.3 + ballZ[i] * 0.74;
      rip3[i] = ballX[i] * 0.77 - y * 0.55 - ballZ[i] * 0.32;
      delay[i] = rnd(); phase[i] = rnd() * Math.PI * 2; drift[i] = 0.5 + rnd() * 0.6; size[i] = (0.7 + rnd() * 0.4) * (W < 560 ? 0.8 : 1);
      byColor[Math.floor(rnd() * 3)].push(i);
      // Start scattered over the whole strip, then fly in to the ball.
      px[i] = (rnd() - 0.5) * W; py[i] = (rnd() - 0.5) * H; pz[i] = 0;
    }
    shapes = {};
    seg = null;
    clock = 0;
    wordShape(HOME);
    begin('ball', Infinity, false);
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
    var halfW = 0, halfH = 0;
    for (k = 0; k < pts.length; k += 2) { halfW = Math.max(halfW, Math.abs(pts[k])); halfH = Math.max(halfH, Math.abs(pts[k + 1])); }
    return (shapes[word] = {x: sx, y: sy, halfW: halfW, halfH: halfH});
  }

  // Start the galaxy. Every star sits on an oval ring between BVNGER's edge and the galaxy's rim, so BVNGER stays
  // clear while it's fully open. A visitor's word gets this same galaxy, sized from BVNGER and not from their word.
  function startGalaxy(pts){
    if (reduce) return;
    // Sized from the window's width only. Window height can change while the page is open (a phone's address bar
    // sliding away, for one), and the galaxy would snap taller or shorter along with it.
    var rx0 = pts.halfW * 1.08 + 14, ry0 = pts.halfH * 1.3 + 8;
    var Rx = Math.max(window.innerWidth * 0.62, rx0 * 1.6), Ry = Math.max(ry0 * 1.9, Rx * 0.5);
    for (var g = 0; g < M; g++) { gRx[g] = rx0 + (Rx - rx0) * gT[g]; gRy[g] = ry0 + (Ry - ry0) * gT[g]; }
    gApart = Rx; gBpart = Ry;
    galStart = clock;
    galOn = true; galClosing = false; galClose = 0; galPulse = 0;
  }

  function bump(a, b, t){   // a smooth hump: 0 before a, up to 1 halfway, back to 0 by b
    if (t <= a || t >= b) return 0;
    var s = Math.sin(Math.PI * (t - a) / (b - a));
    return s * s;
  }

  function stepGalaxy(dt){
    if (galNext >= 0 && clock >= galNext) { galNext = -1; startGalaxy(shapes[HOME]); }
    if (!galOn) return;
    var a = clock - galStart;
    // It slowly breathes in, then back out a little past where it started, then settles.
    var target = -0.12 * bump(GAL_OPEN + 0.2, GAL_OPEN + 1.8, a) + 0.05 * bump(GAL_OPEN + 1.6, GAL_OPEN + 3.2, a);
    galPulse += (target - galPulse) * Math.min(1, dt * 8);
    galClose += (galClosing ? dt / GAL_CLOSE : -dt / 0.5);
    galClose = galClose < 0 ? 0 : galClose;
    if (galClose >= 1) { galOn = false; galClose = 0; }
  }

  function drawGalaxy(){
    if (!galOn) {
      if (galDrawn) {
        gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.clearRect(0, 0, gal.width, gal.height);
        cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, cloud.width, cloud.height);
        gal.style.display = cloud.style.display = 'none'; galDrawn = false;
      }
      return;
    }
    if (!galDrawn) { gal.style.display = cloud.style.display = 'block'; galDrawn = true; }
    // Size the drawing to the canvas's own box on the page, so the browser never has to stretch it to fit.
    // (A phone's window height and its fixed-position box can differ while the address bar is sliding.)
    var box = canvas.getBoundingClientRect(), gb = gal.getBoundingClientRect(), vw = gb.width, vh = gb.height, shiftX = 0;
    if (shot) {
      // Preview stills: headless Edge reports a shorter window than the picture it takes, so pin the real size.
      vw = shot[0]; vh = shot[1];
      gal.style.width = cloud.style.width = vw + 'px'; gal.style.height = cloud.style.height = vh + 'px';
      shiftX = (vw - window.innerWidth) / 2;
    }
    var d = Math.min(window.devicePixelRatio || 1, 1.5), gw = Math.round(vw * d), gh = Math.round(vh * d);
    if (gal.width !== gw || gal.height !== gh) { gal.width = gw; gal.height = gh; }
    var cw = Math.ceil(vw * CLOUD_SCALE), ch = Math.ceil(vh * CLOUD_SCALE);
    if (cloud.width !== cw || cloud.height !== ch) { cloud.width = cw; cloud.height = ch; }
    gctx.setTransform(d, 0, 0, d, 0, 0);
    gctx.clearRect(0, 0, vw, vh);
    cctx.setTransform(CLOUD_SCALE, 0, 0, CLOUD_SCALE, 0, 0);
    cctx.clearRect(0, 0, vw, vh);
    if (box.bottom < -gBpart || box.top > vh + gBpart) return;   // scrolled far away: nothing to see

    var cx = box.left + box.width / 2 - gb.left + shiftX, cy = box.top + box.height / 2 - gb.top, a = clock - galStart;
    var closeK = ease(galClose > 1 ? 1 : galClose), fade = Math.min(1, a / 0.35) * (1 - closeK * closeK * closeK);
    var ct = Math.cos(GAL_TILT), st = Math.sin(GAL_TILT), turned = GAL_TURNED + a;
    gctx.globalCompositeOperation = cctx.globalCompositeOperation = 'lighter';

    // A wide soft glow that swells and fades as it opens, and a fainter one as it pushes back out.
    var flash = bump(0, 1.6, a) * 0.4, grow = 0.25 + Math.min(1, a / GAL_OPEN) * 0.95;
    if (flash > 0.005) {
      cctx.globalAlpha = flash;
      cctx.drawImage(core, cx - gApart * grow, cy - gBpart * grow, gApart * grow * 2, gBpart * grow * 2);
    }
    var soft = bump(GAL_OPEN + 1.6, GAL_OPEN + 3.2, a) * 0.14 * fade;
    if (soft > 0.005) {
      cctx.globalAlpha = soft;
      cctx.drawImage(core, cx - gApart, cy - gBpart, gApart * 2, gBpart * 2);
    }

    // Work out where everything is first, then draw it: clouds and a few star glows as pictures, then the stars.
    for (var g = 0; g < M; g++) {
        // The whole galaxy opens together, so its arms stay whole and its edge stays as soft as the finished galaxy's.
        // The curve eases in and out, so there's no sudden start or stop.
        var t = gT[g], open = (a - gLate[g] * GAL_SPREAD) / GAL_OPEN;
        open = open <= 0 ? 0 : open >= 1 ? 1 : open * open * (3 - 2 * open);
        // Each star unwinds as it flies out and winds back up as it's sucked in. Inner stars orbit faster, like a real galaxy.
        var ang = gA[g] + t * GAL_WIND + turned * (0.12 + 0.34 * (1 - t)) - (1 - open) * 3 + closeK * 3.6;
        // The breathing mostly moves side to side. Up and down it only moves 40% as much, so it never looks like it's hopping.
        var sc = open * (1 - closeK), breathe = galPulse * (1.15 - t * 0.5);
        var ex = Math.cos(ang) * gRx[g] * sc * (1 + breathe), ey = Math.sin(ang) * gRy[g] * sc * (1 + breathe * 0.4);
        gX[g] = cx + ex * ct - ey * st; gY[g] = cy + ex * st + ey * ct;
        // A star is dark near the middle and brightens as it travels out (and dims again as it's sucked back in),
        // so nothing piles up into a bright dot.
        gL[g] = fade * (1 - t * t * 0.4) * (0.72 + 0.28 * Math.sin(turned * 2 + gPh[g])) * Math.min(1, sc * sc * 6);
    }
    for (g = 0; g < PUFFS; g++) {
      var r = gSize[g];
      cctx.globalAlpha = gL[g] * GAL_CLOUD;
      cctx.drawImage(glows[gC[g]], gX[g] - r, gY[g] - r, r * 2, r * 2);
    }
    for (g = PUFFS; g < M; g += 3) {
      r = gSize[g] * GLOW;
      gctx.globalAlpha = gL[g] * 0.9;
      gctx.drawImage(glows[gC[g]], gX[g] - r, gY[g] - r, r * 2, r * 2);
    }
    // The stars are only a pixel or two across, so a plain dot looks the same as a little orb picture and draws far
    // faster. One colour at a time, so the browser isn't switching colour for every star.
    for (var c = 0; c < 3; c++) {
      gctx.fillStyle = COLORS[c];
      for (var n = 0, list = gList[c]; n < list.length; n++) {
        g = list[n];
        var s = gSize[g];
        gctx.globalAlpha = gL[g];
        gctx.fillRect(gX[g] - s, gY[g] - s, s * 2, s * 2);
      }
    }
    gctx.globalAlpha = 1;
    gctx.globalCompositeOperation = 'source-over';
  }

  // Start moving every dot to a new shape ('ball' or a word). If the old shape had finished forming, the dots
  // leave it while it keeps moving (the ball keeps spinning, a word keeps floating). Only a shape cut off
  // mid-change starts from a frozen copy of where the dots are.
  function begin(shape, hold, typed){
    var live = !!seg && clock - seg.start >= MORPH;
    for (var i = 0; i < N; i++) { fx[i] = px[i]; fy[i] = py[i]; fz[i] = pz[i]; }
    seg = {shape: shape, hold: hold, typed: typed, start: clock, pts: shape === 'ball' ? null : wordShape(shape),
           live: live, fromPts: live ? seg.pts : null};
    galClosing = true;                    // any galaxy that's out gets sucked back in
    galNext = -1;
    if (shape === 'ball') nextSplash = clock + MORPH * 0.7;   // the first splash lands as the ball pulls together
    else galNext = clock + MORPH;                             // a word: the galaxy comes out once its letters have formed
  }

  // A random knock on the water: the blob wobbles, and a ring of ripples spreads from a random spot on the side
  // facing the viewer. The spot is turned back through the ball's spin so the ring stays on the surface as it turns.
  function splash(){
    var g = rnd() - 0.5;
    SAG.v += g * 0.8; BOB.v += g * 0.3;
    PEAR.v += (rnd() - 0.5) * 0.7; LEAN.v += (rnd() - 0.5) * 0.7;
    var fx0 = rnd() * 2 - 1, fy0 = rnd() * 2 - 1, fz0 = -0.3 - rnd() * 0.7;
    var len = Math.sqrt(fx0 * fx0 + fy0 * fy0 + fz0 * fz0);
    fx0 /= len; fy0 /= len; fz0 /= len;
    rings.push({x: fx0 * cs - fz0 * sn, y: fy0, z: fx0 * sn + fz0 * cs, born: clock, amp: 0.5 + rnd() * 0.6, env: 0, front: 0});
    nextSplash = clock + 0.5 + rnd() * 1.1;
  }

  // The ball stays until a visitor types a word, and their word goes back into the ball when its time is up.
  function next(){
    begin('ball', Infinity, false);
  }

  // Where dot i sits right now in a shape: a word (pts) or the spinning ball (pts null). Result in sx, sy, sz.
  var moved = 0, sx = 0, sy = 0, sz = 0, crest = 0, cs = 1, sn = 0, tc = Math.cos(0.35), ts = Math.sin(0.35);
  function shapeAt(pts, i){
    if (pts) {
      crest = 0;
      // Each orb drifts slowly around its spot on two mixed waves, at its own speed, and bobs a little
      // toward and away from the viewer, so the word keeps floating instead of sitting still.
      var sp = drift[i], ph = phase[i];
      sx = pts.x[i] + (Math.sin(clock * sp + ph) + 0.5 * Math.sin(clock * sp * 1.7 + ph * 2)) * FLOAT;
      sy = pts.y[i] + (Math.cos(clock * sp * 0.9 + ph) + 0.5 * Math.cos(clock * sp * 1.4 + ph * 3)) * FLOAT;
      sz = Math.sin(clock * sp * 0.8 + ph) * FLOAT * 4;
    } else {
      // Spin the sphere around its upright axis, tilted a little toward the viewer.
      var bx = ballX[i] * cs + ballZ[i] * sn, bz = -ballX[i] * sn + ballZ[i] * cs, by = ballY[i];
      var wy = by * tc - bz * ts, wz = by * ts + bz * tc;
      // Ripples on the surface: crest is +1 on top of a wave and -1 in the dip between waves.
      crest = 0.34 * Math.sin(rip1[i] * 9 - wave1) + 0.24 * Math.sin(rip2[i] * 7 - wave2) + 0.1 * Math.sin(rip3[i] * 17 - wave3);
      for (var j = 0; j < rings.length; j++) {
        // A splash ring: a short burst of waves travelling away from where it landed.
        var o = rings[j], dot = ballX[i] * o.x + ballY[i] * o.y + ballZ[i] * o.z;
        var d = (Math.acos(dot > 1 ? 1 : dot < -1 ? -1 : dot) - o.front) / RING_WIDTH;
        if (d > -2.2 && d < 2.2) crest += o.env * Math.exp(-d * d) * Math.cos(d * 4);
      }
      crest = crest > 1 ? 1 : crest < -1 ? -1 : crest;
      // Bend the whole blob with the springs. wy is +1 at the bottom of the ball and -1 at the top.
      var rr = R * (1 + crest * RIPPLE + SAG.now * (1.5 * wy * wy - 0.5) + PEAR.now * (2.5 * wy * wy * wy - 1.5 * wy) + LEAN.now * 2 * bx * wy);
      sx = bx * rr; sy = wy * rr + BOB.now * R; sz = wz * rr;
    }
  }

  function step(dt){
    clock += dt;
    var e = clock - seg.start;
    moved = reduce ? 0 : clock;                     // with reduced motion the ball holds still
    var spin = moved * 0.45;
    cs = Math.cos(spin); sn = Math.sin(spin);
    coreAmt += ((seg.shape === 'ball' ? 1 : 0) - coreAmt) * Math.min(1, dt * 2);   // inner light eases in and out with the ball
    // The background waves speed up and slow down at their own uneven rates, so they never fall into a pattern.
    wave1 = moved * 2.4 + 1.6 * Math.sin(moved * 0.41);
    wave2 = moved * 1.8 + 1.3 * Math.sin(moved * 0.29 + 1);
    wave3 = moved * 3.7 + 1.1 * Math.sin(moved * 0.53 + 2);
    if (!reduce && seg.shape === 'ball' && clock >= nextSplash) splash();
    stepGalaxy(dt);
    springs.forEach(function(m){
      m.v += (-m.w * m.w * (m.x - m.rest) - m.c * m.v) * dt;
      m.x += m.v * dt;
      m.now = m.x / (1 + Math.abs(m.x) / m.max);   // a soft limit, so a hard knock can't bend the ball off the canvas
    });
    for (var r = rings.length - 1; r >= 0; r--) {
      var ring = rings[r], age = clock - ring.born, left = 1 - age / RING_LIFE;
      if (left <= 0) { rings.splice(r, 1); continue; }
      ring.front = age * RING_SPEED; ring.env = ring.amp * left * left;
    }
    for (var i = 0; i < N; i++) {
      var k = (e - delay[i] * MORPH * 0.4) / (MORPH * 0.6);
      k = k <= 0 ? 0 : k >= 1 ? 1 : ease(k);
      var ax = fx[i], ay = fy[i], az = fz[i], ac = 0;
      if (seg.live && k < 1) { shapeAt(seg.fromPts, i); ax = sx; ay = sy; az = sz; ac = crest; }   // old shape, still moving
      shapeAt(seg.pts, i);
      px[i] = ax + (sx - ax) * k; py[i] = ay + (sy - ay) * k; pz[i] = az + (sz - az) * k;
      shine[i] = ac + (crest - ac) * k;
    }
    if (e >= MORPH + seg.hold) next();
  }

  function draw(){
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var F = R * 3, cx = W / 2, cy = H / 2;
    // The light inside the ball goes down first, pulsing slowly, so every orb sits in front of it.
    if (coreAmt > 0.005) {
      var pulse = Math.sin(moved * 1.3), rc = R * (1 + 0.06 * pulse), coreY = cy + BOB.now * R;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = coreAmt * (0.66 + 0.22 * pulse);
      ctx.drawImage(core, cx - rc, coreY - rc, rc * 2, rc * 2);
    }
    // Two passes: the glows add up into a soft neon haze, then the round orbs go on top of it.
    for (var pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass ? 'source-over' : 'lighter';
      for (var c = 0; c < 3; c++) {
        var img = pass ? orbs[c] : glows[c], list = byColor[c];
        for (var n = 0; n < list.length; n++) {
          var i = list[n], s = F / (F + pz[i]), x = cx + px[i] * s, y = cy + py[i] * s;
          var a = 0.9 - pz[i] / (R * 2); a = a < 0.3 ? 0.3 : a > 1 ? 1 : a;
          var r = size[i] * s * (pass ? 1 : GLOW);
          // Ripple light: orbs in a dip go dimmer and orbs on a crest glow harder, with the orb size unchanged.
          var w = shine[i], dip = w < 0 ? -w * 0.55 : 0, lit = w > 0 ? w * 0.4 : 0;
          ctx.globalAlpha = pass ? a * (1 - dip) : Math.min(1, a * (0.8 - dip * 0.8 + lit));
          ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawGalaxy();
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
      [].forEach.call(document.querySelectorAll('canvas'), function(el){ if (el !== canvas && el !== gal && el !== cloud) el.style.visibility = 'hidden'; });
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
