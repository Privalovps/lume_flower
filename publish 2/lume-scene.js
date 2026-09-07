/* LUME — 3D-сцена: букет из GLB-модели в hero + лента, которая развязывается
   с самого банта и тянется вниз по странице вслед за скроллом.

   Регистрирует <lume-stage anchor="#hero-3d" stop="#contacts">:
   фиксированный на весь вьюпорт canvas за контентом. Букет привязан к DOM-якорю
   (скроллится вместе с hero), лента строится в координатах документа, поэтому
   её путь 1:1 совпадает со страницей. */
(function () {
  if (window.__lumeStage) return;
  window.__lumeStage = true;

  var THREE_URL = 'https://unpkg.com/three@0.160.0/build/three.module.js';
  var LOADER_URL = 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
  var MODEL_URL = './assets/rose-bouquet-v2.glb';
  var FOV = 30, CAM_Z = 10;

  var reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var conn = navigator.connection || {};
  var weak = (navigator.hardwareConcurrency || 8) <= 2 ||
             /(^|[-_])2g$/.test(conn.effectiveType || '') || conn.saveData === true;

  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var easeIO = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* --- offline-режим (standalone-сборка): meta[name="ext-resource-dependency"]
         + window.__resources отдают blob-URL для CDN-модулей и GLB-модели --- */
  function resolveUrl(orig) {
    var res = window.__resources;
    if (!res) return orig;
    var metas = document.querySelectorAll('meta[name="ext-resource-dependency"]');
    for (var i = 0; i < metas.length; i++) {
      if (metas[i].getAttribute('content') !== orig) continue;
      var id = metas[i].getAttribute('data-resource-id');
      if (id && res[id]) return res[id];
    }
    return orig;
  }

  /* --- рекурсивно переписываем импорты аддонов three под blob-модули:
         bare 'three' → блоб самого three, относительные пути → пропатченные блобы.
         Относительные спецификаторы разрешаются от ИСХОДНОГО URL, поэтому
         работает и когда сам модуль пришёл из blob'а. --- */
  var modCache = {};
  var threeBlob = null;
  function patchModule(origin) {
    if (modCache[origin]) return modCache[origin];
    modCache[origin] = fetch(resolveUrl(origin)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + origin);
      return r.text();
    }).then(function (src) {
      var re = /from\s*(['"])([^'"]+)\1/g, m, rel = [];
      while ((m = re.exec(src))) {
        if (m[2].charAt(0) === '.' && rel.indexOf(m[2]) < 0) rel.push(m[2]);
      }
      return Promise.all(rel.map(function (spec) {
        return patchModule(new URL(spec, origin).href).then(function (b) { return [spec, b]; });
      })).then(function (pairs) {
        var out = threeBlob ? src.replace(/from\s*(['"])three\1/g, "from '" + threeBlob + "'") : src;
        pairs.forEach(function (pr) {
          out = out.split("'" + pr[0] + "'").join("'" + pr[1] + "'")
                   .split('"' + pr[0] + '"').join('"' + pr[1] + '"');
        });
        return URL.createObjectURL(new Blob([out], { type: 'text/javascript' }));
      });
    });
    return modCache[origin];
  }

  function loadThree() {
    if (window.THREE) {
      return Promise.resolve({ THREE: window.THREE, GLTFLoader: window.GLTFLoader });
    }
    return patchModule(THREE_URL).then(function (u) {
      threeBlob = u;
      return Promise.all([import(u), patchModule(LOADER_URL).then(function (l) { return import(l); })]);
    }).then(function (res) {
      return { THREE: res[0], GLTFLoader: res[1].GLTFLoader };
    });
  }

  /* мягкое студийное окружение: тёплый верх → розовый низ */
  function makeEnv(THREE) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    var g = c.getContext('2d').createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#fff7ec');
    g.addColorStop(0.5, '#ffeadf');
    g.addColorStop(1, '#f2d6d8');
    var ctx = c.getContext('2d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 64);
    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  var Stage = (function () {
    function El() { return Reflect.construct(HTMLElement, [], El); }
    El.prototype = Object.create(HTMLElement.prototype);
    Object.setPrototypeOf(El, HTMLElement);

    El.prototype.connectedCallback = function () {
      var self = this;
      this.setAttribute('aria-hidden', 'true');
      this.style.cssText = 'position:fixed;inset:0;display:block;pointer-events:none;z-index:0';
      this.anchorSel = this.getAttribute('anchor') || '#hero-3d';
      this.stopSel = this.getAttribute('stop') || '';
      if (weak) { this.markReady(); return; }
      var boot = function () { self.boot(); };
      if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 1500 });
      else setTimeout(boot, 300);
    };

    El.prototype.disconnectedCallback = function () {
      this.dead = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._pm) window.removeEventListener('pointermove', this._pm);
      if (this._ro) this._ro.disconnect();
      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
      }
    };

    /* скелетон внутри якоря убираем, когда модель готова (или когда 3D недоступно) */
    El.prototype.markReady = function () {
      var a = document.querySelector(this.anchorSel);
      if (!a) return;
      a.setAttribute('data-lume-3d', weak || !this.renderer ? 'static' : 'live');
      var sk = a.querySelector('[data-lume-skeleton]');
      if (sk) sk.style.opacity = weak || !this.renderer ? '1' : '0';
    };

    El.prototype.boot = function () {
      var self = this;
      loadThree().then(function (lib) {
        if (self.dead) return;
        return self.init(lib);
      }).catch(function (err) {
        try { console.warn('LUME 3D unavailable:', err && err.message); } catch (e) {}
        self.markReady();
      });
    };

    El.prototype.init = function (lib) {
      var self = this, THREE = lib.THREE;

      var renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
      renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      this.appendChild(renderer.domElement);

      var scene = this.scene = new THREE.Scene();
      var camera = this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
      camera.position.set(0, 0, CAM_Z);

      var key = new THREE.DirectionalLight(0xfff1de, 2.7); key.position.set(-3.4, 4.4, 4.2); scene.add(key);
      var fill = new THREE.DirectionalLight(0xffdfd2, 0.6); fill.position.set(3.4, -2.2, 2.6); scene.add(fill);
      var rim = new THREE.DirectionalLight(0xffe6c4, 0.75); rim.position.set(1.4, 1.6, -4); scene.add(rim);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xF3D4D6, 0.8));
      scene.environment = makeEnv(THREE);

      var bouquetGroup = this.bouquetGroup = new THREE.Group();
      var tilt = this.tilt = new THREE.Group();
      bouquetGroup.add(tilt);
      scene.add(bouquetGroup);

      this.resize();
      try {
        this._ro = new ResizeObserver(function () { self.resize(); });
        this._ro.observe(document.documentElement);
      } catch (e) {}
      window.addEventListener('resize', function () { self.resize(); });

      var fine = true;
      try { fine = matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}
      this.tgt = { x: 0, y: 0 }; this.cur = { x: 0, y: 0 };
      if (fine && !reduced) {
        this._pm = function (ev) {
          self.tgt.y = (ev.clientX / window.innerWidth - 0.5) * 0.30;
          self.tgt.x = (ev.clientY / window.innerHeight - 0.5) * 0.18;
        };
        window.addEventListener('pointermove', this._pm, { passive: true });
      }

      if (!window.LUME_BOUQUET) throw new Error('lume-bouquet-model.js не загружен');
      this.setupModel(THREE, window.LUME_BOUQUET.build(THREE));
      this.markReady();
      this.loop();
      return null;
    };

    El.prototype.setupModel = function (THREE, model) {
      var self = this;
      this.THREE = THREE;

      model.traverse(function (o) {
        if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; }
      });

      // нормализуем: высота модели = 1 юнит, центр букета в начале координат
      var bounds = model.userData && model.userData.bounds;
      var size, center;
      if (bounds) {
        size = bounds.size.clone();
        center = bounds.center.clone();
      } else {
        var box = new THREE.Box3().setFromObject(model);
        size = new THREE.Vector3(); box.getSize(size);
        center = new THREE.Vector3(); box.getCenter(center);
      }
      var norm = 1 / Math.max(0.0001, size.y);
      model.scale.setScalar(norm);
      model.position.set(-center.x * norm, -center.y * norm, -center.z * norm);
      this.modelAspect = size.x / size.y;
      this.tilt.add(model);
      this.model = model;

      var byName = {};
      model.traverse(function (o) { if (o.name && !byName[o.name]) byName[o.name] = o; });
      this.knot = byName['bow_knot'] || byName['bow'] || byName['ribbon'] || model;
      this.bow = byName['bow'] || null;

      // части банта, которые развязываются: сохраняем исходные трансформы.
      // в модели могут быть отдельные петли/хвосты, иначе разматываем бант целиком.
      var partNames = ['bow_loop_left', 'bow_loop_right', 'bow_tail_left', 'bow_tail_right']
        .filter(function (n) { return byName[n]; });
      if (!partNames.length && byName['bow']) {
        this.setupWholeBow(THREE, byName['bow']);
        partNames = [];
      }
      this.parts = partNames.map(function (n, i) {
        var o = byName[n];
        // материал банта общий с лентой — клонируем, чтобы гасить только бант
        o.traverse(function (m) { if (m.isMesh && m.material) m.material = m.material.clone(); });
        return {
          obj: o, i: i,
          side: n.indexOf('right') > -1 ? 1 : -1,
          loop: n.indexOf('tail') < 0,
          whole: n === 'bow',
          pos: o.position.clone(),
          quat: o.quaternion.clone(),
          scale: o.scale.clone()
        };
      });

      // материал ленты для хвоста — тот же сатин, что в модели
      var satin = null;
      model.traverse(function (o) {
        if (satin || !o.isMesh) return;
        var m = o.material;
        if (m && /satin|ribbon/i.test(m.name || '')) satin = m;
      });
      this.buildTrail(THREE, satin);
    };

    /* Бант — единый меш: развязываем повершинно. Петли раскрываются наружу,
       вытягиваются вниз и соскальзывают с узла; кончики уходят первыми. */
    El.prototype.setupWholeBow = function (THREE, bow) {
      var meshes = [];
      bow.traverse(function (m) {
        if (!m.isMesh) return;
        m.material = m.material.clone();
        var pos = m.geometry.attributes.position;
        var orig = new Float32Array(pos.array);
        var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (var i = 0; i < orig.length; i += 3) {
          if (orig[i] < minX) minX = orig[i];
          if (orig[i] > maxX) maxX = orig[i];
          if (orig[i + 1] < minY) minY = orig[i + 1];
          if (orig[i + 1] > maxY) maxY = orig[i + 1];
        }
        meshes.push({
          mesh: m, pos: pos, orig: orig,
          cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
          halfW: Math.max(1e-4, (maxX - minX) / 2),
          h: Math.max(1e-4, maxY - minY)
        });
      });
      this.bowMeshes = meshes;
    };

    El.prototype.untieBow = function (u, time) {
      var list = this.bowMeshes;
      if (!list) return;
      var eased = easeIO(u);
      for (var m = 0; m < list.length; m++) {
        var b = list[m], a = b.orig, arr = b.pos.array;
        for (var i = 0; i < a.length; i += 3) {
          var x = a[i], y = a[i + 1], z = a[i + 2];
          var dx = x - b.cx;
          var side = dx < 0 ? -1 : 1;
          var reach = Math.min(1, Math.abs(dx) / b.halfW);       // кончик петли ↔ узел
          var t = clamp01((u - 0.06 * (1 - reach)) / 0.9) * reach; // кончики уходят первыми
          var te = easeIO(t);

          // петля раскрывается: поворот вокруг узла в плоскости XY
          var ang = te * 1.15 * side;
          var ca = Math.cos(ang), sa = Math.sin(ang);
          var rx = dx * ca - (y - b.cy) * sa;
          var ry = dx * sa + (y - b.cy) * ca;

          // затем распрямляется и провисает вниз под своим весом
          var slip = te * te;
          var nx = b.cx + rx * (1 - slip * 0.55) + side * slip * b.halfW * 0.5;
          var ny = b.cy + ry * (1 - slip * 0.35) - slip * b.h * 1.5 * reach;
          var nz = z + Math.sin(reach * 3.1 + time * 0.7) * 0.004 * te;

          arr[i] = nx;
          arr[i + 1] = ny;
          arr[i + 2] = nz;
        }
        b.pos.needsUpdate = true;
        b.mesh.geometry.computeVertexNormals();
        b.mesh.geometry.computeBoundingSphere();
        var op = 1 - easeIO(clamp01((eased - 0.72) / 0.28));
        b.mesh.material.transparent = op < 0.995;
        b.mesh.material.opacity = op;
        b.mesh.visible = op > 0.02;
      }
    };

    El.prototype.buildTrail = function (THREE, satin) {
      var SEG = this.SEG = this.narrow ? 140 : 300;
      var g = this.trailGeo = new THREE.BufferGeometry();
      var vc = (SEG + 1) * 2;
      this.tPos = new Float32Array(vc * 3);
      this.tUv = new Float32Array(vc * 2);
      var idx = [];
      for (var s = 0; s < SEG; s++) { var o = s * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      g.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(this.tUv, 2));
      g.setIndex(idx);

      var mat;
      if (satin) {
        mat = satin.clone();
        mat.side = THREE.DoubleSide;
        mat.vertexColors = false;   // в геометрии хвоста нет вершинных цветов
        mat.metalness = 0.06;
        mat.roughness = 0.42;
        mat.envMapIntensity = 0.75;
        if ('sheen' in mat) { mat.sheen = 0.8; mat.sheenRoughness = 0.4; }
      } else {
        mat = new THREE.MeshPhysicalMaterial({
          color: 0xC9A96E, roughness: 0.26, metalness: 0.3, side: THREE.DoubleSide,
          clearcoat: 0.5, clearcoatRoughness: 0.35
        });
      }
      var trail = this.trail = new THREE.Mesh(g, mat);
      trail.frustumCulled = false;
      trail.visible = false;
      this.scene.add(trail);

      this.curve = new THREE.CatmullRomCurve3(
        new Array(11).fill(0).map(function () { return new THREE.Vector3(); }),
        false, 'catmullrom', 0.5
      );
    };

    El.prototype.resize = function () {
      if (!this.renderer) return;
      var w = window.innerWidth, h = window.innerHeight;
      if (!w || !h) return;
      this.vw = w; this.vh = h;
      this.narrow = w <= 1060;
      this._m = null;
      this.renderer.setPixelRatio(Math.min(this.narrow ? 1.5 : 2, window.devicePixelRatio || 1));
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      // мир↔пиксели на плоскости z = 0
      this.upp = (2 * Math.tan((FOV * Math.PI / 180) / 2) * CAM_Z) / h;
    };

    /* Замеры вёрстки (позиция якоря, конец ленты, высота страницы).
       На узких экранах кешируются: чтение layout в каждом кадре — главная
       причина рывков при скролле на телефоне. */
    El.prototype.metrics = function (now) {
      var period = this.narrow ? 500 : 0;
      if (!this._m || now - this._mT > period) {
        var a = document.querySelector(this.anchorSel);
        if (!a) return this._m || null;
        var r = a.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return this._m || null;
        var de = document.documentElement;
        var stopEl = this.stopSel ? document.querySelector(this.stopSel) : null;
        this._m = {
          left: r.left, width: r.width, height: r.height,
          docY: r.top + window.scrollY,
          endDocY: stopEl ? stopEl.getBoundingClientRect().top + window.scrollY + 110 : de.scrollHeight - 80,
          maxScroll: Math.max(1, de.scrollHeight - this.vh)
        };
        this._mT = now;
      }
      return this._m;
    };

    // точка документа (px) → мир (z = 0)
    El.prototype.toWorld = function (docX, docY, out) {
      out.set((docX - this.vw / 2) * this.upp,
              -((docY - window.scrollY) - this.vh / 2) * this.upp,
              0);
      return out;
    };

    El.prototype.loop = function () {
      var self = this, THREE = this.THREE;
      var knotWorld = new THREE.Vector3();
      var p0 = new THREE.Vector3(), pt = new THREE.Vector3(), tan = new THREE.Vector3();
      var nrm = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1), tmp = new THREE.Vector3();
      var t0 = performance.now(), tPrev = t0;
      var qTmp = new THREE.Quaternion(), eTmp = new THREE.Euler();
      var dt = 0.016;
      var damp = function (rate) { return 1 - Math.exp(-rate * dt); };

      var step = function (now) {
        if (self.dead) return;
        self._raf = requestAnimationFrame(step);

        var time = (now - t0) / 1000;
        dt = Math.min(0.05, Math.max(0.001, (now - tPrev) / 1000));
        tPrev = now;
        if (!self.vh) return;
        var m = self.metrics(now);
        if (!m) return;
        var ar = { left: m.left, width: m.width, height: m.height, top: m.docY - window.scrollY };
        var p = clamp01(window.scrollY / m.maxScroll);
        var heroVisible = ar.top < self.vh + 40 && ar.top + ar.height > -40;
        // ниже hero остаётся только хвост ленты — сам букет не рисуем
        self.bouquetGroup.visible = heroVisible;

        // --- букет: привязан к якорю в hero, уезжает вместе со страницей ---
        var fit = Math.min(ar.height * 0.98, (ar.width * 0.98) / Math.max(0.35, self.modelAspect));
        var scale = fit * self.upp;
        self.bouquetGroup.scale.setScalar(scale);
        var cx = ar.left + ar.width / 2;
        var cy = ar.top + ar.height / 2 + ((reduced || self.narrow) ? 0 : Math.sin(time * (Math.PI * 2 / 7)) * 5);
        self.bouquetGroup.position.set((cx - self.vw / 2) * self.upp, -(cy - self.vh / 2) * self.upp, 0);

        self.cur.x += (self.tgt.x - self.cur.x) * 0.07;
        self.cur.y += (self.tgt.y - self.cur.y) * 0.07;
        self.tilt.rotation.x = self.cur.x;
        self.tilt.rotation.y = self.cur.y + (reduced ? 0 : Math.sin(time * 0.3) * 0.04);

        // --- бант развязывается: медленно, за первые ~35% высоты первого экрана ---
        var untieRaw = clamp01((window.scrollY - 40) / (self.vh * 0.75));
        self.untie = self.untie == null ? untieRaw
          : self.untie + (untieRaw - self.untie) * damp(2.4);
        var u = easeIO(self.untie);
        if (self.untie < 0.999 || !self._bowDone) {
          self.untieBow(self.untie, time);
          self._bowDone = self.untie >= 0.999;
        }
        self.parts.forEach(function (pr) {
          var st = easeIO(clamp01((self.untie - pr.i * 0.10) / 0.72));
          var k = pr.whole ? 0.42 : (pr.loop ? 1 : 0.55);
          eTmp.set(st * 0.42 * k, st * 0.8 * pr.side * k, st * 1.35 * pr.side * k);
          pr.obj.quaternion.copy(pr.quat).multiply(qTmp.setFromEuler(eTmp));
          var sc = pr.whole ? 1 - st * 0.82 : (pr.loop ? 1 - st * 0.96 : 1 - st * 0.9);
          pr.obj.scale.set(pr.scale.x * sc, pr.scale.y * sc, pr.scale.z * Math.max(0.06, sc));
          pr.obj.position.set(
            pr.pos.x + st * 0.09 * pr.side,
            pr.pos.y - st * 0.14,
            pr.pos.z + st * 0.04
          );
          var op = 1 - easeIO(clamp01((st - 0.55) / 0.45));
          pr.obj.traverse(function (m) {
            if (!m.isMesh || !m.material) return;
            m.material.transparent = op < 0.995;
            m.material.opacity = op;
            m.visible = op > 0.02;
          });
        });

        // --- хвост ленты: путь в координатах документа, старт строго в узле ---
        self.bouquetGroup.updateMatrixWorld(true);
        self.knot.getWorldPosition(knotWorld);
        var knotDocX = knotWorld.x / self.upp + self.vw / 2;
        var knotDocY = -knotWorld.y / self.upp + self.vh / 2 + window.scrollY;

        var span = Math.max(200, m.endDocY - knotDocY);

        var pts = self.curve.points, n = pts.length - 1;
        var amp = Math.min(self.vw * 0.20, 250);
        for (var i = 0; i <= n; i++) {
          var t = i / n;
          var docY = knotDocY + t * span;
          var sway = Math.sin(t * Math.PI * 2.35 + 0.5) * amp * Math.min(1, t * 3.2);
          var docX = i === 0 ? knotDocX : lerp(knotDocX, self.vw * 0.5, Math.min(1, t * 2.6)) + sway;
          self.toWorld(docX, docY, pts[i]);
          if (i > 0) pts[i].z += Math.sin(t * Math.PI * 3 + time * 0.25) * 0.16;
          else pts[i].z = knotWorld.z;
        }
        self.curve.updateArcLengths();

        // лента следует за пользователем: цель — чуть ниже кромки вьюпорта,
        // сама длина догоняет цель с задержкой, поэтому лента «тянется», а не улетает
        var gate = easeIO(clamp01(self.untie / 0.55));
        var lead = (window.scrollY + self.vh * 1.12 - knotDocY) / span;
        var targetReveal = clamp01(lead) * gate;
        self.reveal = self.reveal == null ? targetReveal
          : self.reveal + (targetReveal - self.reveal) * damp(reduced ? 12 : 1.7);
        var reveal = clamp01(self.reveal);
        var tipDocY = knotDocY + span * reveal;
        var onScreen = tipDocY > window.scrollY - 40 && knotDocY < window.scrollY + self.vh + 40;
        self.trail.visible = reveal > 0.004 && onScreen;
        if (!heroVisible && !self.trail.visible) return;

        if (self.trail.visible) {
          var frames = self.curve.computeFrenetFrames(self.SEG, false);
          var halfW = fit * 0.03 * self.upp; // полуширина ≈ ширина ленты самой модели
          var twist = 2.1 + p * 3.4;
          for (var k = 0; k <= self.SEG; k++) {
            var tt = (k / self.SEG) * reveal;
            self.curve.getPoint(tt, pt);
            tan.copy(frames.tangents[Math.min(self.SEG, Math.round(tt * self.SEG))]);
            nrm.crossVectors(tan, up);
            if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0); else nrm.normalize();
            nrm.applyAxisAngle(tan, tt * twist + Math.sin(time * 0.5 + tt * 4) * 0.12);
            // чуть сужается у узла и к кончику
            var rel = tt / reveal;
            var taper = Math.min(1, 0.45 + rel * 9) * Math.min(1, 0.35 + (1 - rel) * 6);
            var half = halfW * taper;
            var o2 = k * 2;
            tmp.copy(pt).addScaledVector(nrm, -half);
            self.tPos[o2 * 3] = tmp.x; self.tPos[o2 * 3 + 1] = tmp.y; self.tPos[o2 * 3 + 2] = tmp.z;
            tmp.copy(pt).addScaledVector(nrm, half);
            self.tPos[o2 * 3 + 3] = tmp.x; self.tPos[o2 * 3 + 4] = tmp.y; self.tPos[o2 * 3 + 5] = tmp.z;
            self.tUv[o2 * 2] = tt * 8; self.tUv[o2 * 2 + 1] = 0;
            self.tUv[o2 * 2 + 2] = tt * 8; self.tUv[o2 * 2 + 3] = 1;
          }
          self.trailGeo.attributes.position.needsUpdate = true;
          self.trailGeo.attributes.uv.needsUpdate = true;
          self.trailGeo.computeVertexNormals();
          var na = self.trailGeo.attributes.normal.array;
          for (var q = 0; q < na.length; q += 3) {
            if (na[q + 2] < 0) { na[q] = -na[q]; na[q + 1] = -na[q + 1]; na[q + 2] = -na[q + 2]; }
          }
          self.trailGeo.attributes.normal.needsUpdate = true;
        }

        self.renderer.render(self.scene, self.camera);
      };
      this._raf = requestAnimationFrame(step);
    };

    return El;
  })();

  if (!customElements.get('lume-stage')) customElements.define('lume-stage', Stage);
})();
