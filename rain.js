/* Digital rain background, ported from Bastion's DigitalRainControl.
   Same glyphs, palette, trail lengths and opacities as the app. Runs at the
   display's refresh rate, pauses while the tab is hidden, and stays off when
   the visitor prefers reduced motion. */
(function(){
  if (!window.requestAnimationFrame || !document.createElement("canvas").getContext) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce && reduce.matches) return;

  var ROW = 21;                 // vertical spacing between glyphs, px
  var COLUMN = 50;              // horizontal spacing between streams at the app's default 70% density
  var GLYPHS = "01<>/{}[]#*+アカサタナハマヤラワ".split("");
  var PALETTE = [[24,240,229],[136,104,255],[240,91,231]];
  var LEVELS = 8;               // trail opacity steps, matching the app
  var FONT = '"JetBrains Mono","Cascadia Mono",Consolas,monospace';

  var canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block";
  var ctx = canvas.getContext("2d");
  var dpr = 1, width = 0, height = 0, streams = [], sprites = null, spriteSize = 0;
  var rafId = 0, last = 0;

  function opacity(level){ return level === 0 ? 0.32 : Math.max(0.04, 0.18 * (1 - level / LEVELS)); }

  // Pre-render every glyph in every color and opacity once, so each frame is just image copies.
  function buildSprites(){
    spriteSize = Math.ceil(18 * dpr);
    sprites = [];
    for (var c = 0; c < PALETTE.length; c++) {
      sprites[c] = [];
      for (var l = 0; l < LEVELS; l++) {
        sprites[c][l] = [];
        var rgb = PALETTE[c];
        for (var g = 0; g < GLYPHS.length; g++) {
          var s = document.createElement("canvas");
          s.width = s.height = spriteSize;
          var sc = s.getContext("2d");
          sc.font = (l === 0 ? 13 : 12) * dpr + "px " + FONT;
          sc.textBaseline = "top";
          sc.fillStyle = "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + opacity(l) + ")";
          sc.fillText(GLYPHS[g], 1, 1);
          sprites[c][l][g] = s;
        }
      }
    }
  }

  function rand(min, max){ return min + Math.random() * (max - min); }
  function randInt(min, max){ return Math.floor(rand(min, max)); }

  function resetStreams(){
    streams = [];
    var columns = Math.max(1, Math.floor(width / COLUMN));
    for (var i = 0; i < columns; i++) {
      streams.push({
        x: i * COLUMN + Math.random() * 8,
        y: Math.random() * Math.max(height, 400) - 260,
        speed: randInt(35, 75),
        trail: randInt(3, 6),
        color: i % PALETTE.length,
        glyph: randInt(0, GLYPHS.length)
      });
    }
  }

  function resize(){
    var newDpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    if (w === width && h === height && newDpr === dpr && sprites) return;
    var rebuild = newDpr !== dpr || !sprites;
    var widthChanged = w !== width;
    dpr = newDpr; width = w; height = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (rebuild) buildSprites();
    // Mobile browsers change height as the address bar hides; only reseed columns when the width changes.
    if (widthChanged || !streams.length) resetStreams();
    draw();
  }

  function draw(){
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      for (var t = 0; t < s.trail; t++) {
        var y = s.y - t * ROW;
        if (y < -ROW || y > height + ROW) continue;
        var img = sprites[s.color][Math.min(t, LEVELS - 1)][(s.glyph + t) % GLYPHS.length];
        // x stays on whole pixels for crisp glyphs; y stays fractional so slow streams glide instead of stepping.
        ctx.drawImage(img, Math.round(s.x * dpr), y * dpr);
      }
    }
  }

  function advance(seconds){
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      s.y += s.speed * seconds;
      if (s.y - s.trail * ROW > height) {
        s.y = -randInt(40, 300);
        s.speed = randInt(35, 75);
        s.glyph = randInt(0, GLYPHS.length);
      }
    }
  }

  function frame(now){
    // Cap a single step at 0.1s so a stalled frame doesn't make streams jump.
    var seconds = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    advance(seconds);
    draw();
    rafId = requestAnimationFrame(frame);
  }

  function start(){ if (!rafId) { last = 0; rafId = requestAnimationFrame(frame); } }
  function stop(){ if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

  function init(){
    document.body.insertBefore(canvas, document.body.firstChild);
    resize();
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", function(){ document.hidden ? stop() : start(); });
    if (reduce && reduce.addEventListener) {
      reduce.addEventListener("change", function(e){
        if (e.matches) { stop(); canvas.remove(); }
      });
    }
  }

  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
