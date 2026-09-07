/* LUME — процедурная модель букета красных роз (three.js, classic script).
   Строится в коде, без внешних файлов модели: работает и на сервере, и при
   открытии HTML прямо с диска. Публикуется как window.LUME_BOUQUET.

   Композиция повторяет референс: плотный купол роз, венок листьев под ним,
   красная атласная лента с бантом на перевязи и веер длинных стеблей. */
(function () {
  window.LUME_BOUQUET = { build: build, buildRose: buildRose };

  var TAU = Math.PI * 2, GOLDEN = 2.399963;

  /* ---------- сборка меша из параметрических лепестков ---------- */
  function newSink() { return { pos: [], uv: [], col: [], idx: [] }; }

  function sinkToGeometry(THREE, s) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3));
    g.setIndex(s.idx);
    g.computeVertexNormals();
    return g;
  }

  /* Лепесток розы: параметрическая поверхность. Узкий у основания, широкий
     сверху, свёрнут «чашей» к оси цветка, верхний край отогнут наружу. */
  function addPetal(THREE, sink, m, o) {
    var NU = 8, NV = 7, v = new THREE.Vector3();
    var base = sink.pos.length / 3;
    for (var j = 0; j <= NV; j++) {
      var t = j / NV;
      var wp = 0.34 + 0.66 * Math.pow(t, 0.55);
      var halfW = o.w * 0.5 * wp;
      var curlA = o.curl * (0.5 + 0.5 * t);
      var R = halfW / Math.max(0.18, curlA);
      var roll = Math.max(0, t - 0.72) / 0.28;
      for (var i = 0; i <= NU; i++) {
        var u = (i / NU) * 2 - 1;
        var th = u * curlA;
        var y = t * o.h * (1 - 0.20 * u * u);
        var x = R * Math.sin(th);
        var z = -R * (1 - Math.cos(th));
        z += roll * roll * 0.07 * o.h * (0.35 + 0.65 * Math.abs(u));  // отогнутый край
        z -= 0.09 * o.h * t * t;                                       // общий прогиб
        v.set(x, y, z).applyMatrix4(m);
        sink.pos.push(v.x, v.y, v.z);
        sink.uv.push((u + 1) / 2, t);
        var sh = 0.20 + 0.80 * Math.pow(t, 0.66);       // тень в глубине цветка
        sink.col.push(sh, sh * 0.90, sh * 0.92);
      }
    }
    for (var jj = 0; jj < NV; jj++) {
      for (var ii = 0; ii < NU; ii++) {
        var a = base + jj * (NU + 1) + ii, b = a + 1, c = a + NU + 1, d = c + 1;
        sink.idx.push(a, c, b, b, c, d);
      }
    }
  }

  /* Голова розы: 6 венцов лепестков, от скрученного центра к раскрытым краям */
  function roseGeometry(THREE) {
    var whorls = [
      { n: 2, lean: 0.03, h: 0.30, w: 0.24, curl: 2.85, r: 0.008, y: 0.150 },
      { n: 3, lean: 0.18, h: 0.36, w: 0.34, curl: 2.30, r: 0.032, y: 0.120 },
      { n: 5, lean: 0.36, h: 0.46, w: 0.46, curl: 1.85, r: 0.062, y: 0.098 },
      { n: 7, lean: 0.58, h: 0.52, w: 0.54, curl: 1.55, r: 0.094, y: 0.066 },
      { n: 8, lean: 0.80, h: 0.56, w: 0.60, curl: 1.30, r: 0.124, y: 0.034 },
      { n: 8, lean: 1.02, h: 0.58, w: 0.62, curl: 1.10, r: 0.152, y: 0.000 }
    ];
    var sink = newSink();
    var m = new THREE.Matrix4(), rotY = new THREE.Matrix4(), tr = new THREE.Matrix4(), rotX = new THREE.Matrix4();
    var k = 0;
    whorls.forEach(function (wl, wi) {
      for (var i = 0; i < wl.n; i++) {
        var az = i * (TAU / wl.n) + wi * 0.62 + (k % 3) * 0.06;
        var lean = wl.lean + ((k % 5) - 2) * 0.035;
        rotY.makeRotationY(az);
        tr.makeTranslation(0, wl.y, wl.r);
        rotX.makeRotationX(lean);
        m.copy(rotY).multiply(tr).multiply(rotX);
        addPetal(THREE, sink, m, { h: wl.h * (1 + ((k % 4) - 1.5) * 0.03), w: wl.w, curl: wl.curl });
        k++;
      }
    });
    return sinkToGeometry(THREE, sink);
  }

  /* Лист розы: заострённый овал со складкой по центральной жилке */
  function leafGeometry(THREE) {
    var NU = 5, NV = 8, sink = newSink(), len = 0.58, wid = 0.26;
    for (var j = 0; j <= NV; j++) {
      var t = j / NV;
      var wp = Math.sin(Math.PI * Math.pow(t, 0.72));
      for (var i = 0; i <= NU; i++) {
        var u = (i / NU) * 2 - 1;
        var au = Math.abs(u);
        var x = u * wid * 0.5 * wp;
        var y = t * len;
        var z = 0.055 * len * (1 - au) - 0.30 * len * t * t;  // складка + провис
        sink.pos.push(x, y, z);
        sink.uv.push((u + 1) / 2, t);
        var sh = 0.62 + 0.38 * (1 - au * 0.7) * (0.55 + 0.45 * t);
        sink.col.push(sh * 0.94, sh, sh * 0.86);
      }
    }
    for (var jj = 0; jj < NV; jj++) {
      for (var ii = 0; ii < NU; ii++) {
        var a = jj * (NU + 1) + ii, b = a + 1, c = a + NU + 1, d = c + 1;
        sink.idx.push(a, c, b, b, c, d);
      }
    }
    return sinkToGeometry(THREE, sink);
  }

  /* Плоская атласная полоса вдоль кривой — для банта и хвостов */
  function stripGeometry(THREE, pts, halfWidth, twist, taperEnd) {
    var curve = new THREE.CatmullRomCurve3(pts.map(function (p) {
      return new THREE.Vector3(p[0], p[1], p[2]);
    }), false, 'catmullrom', 0.5);
    var SEG = 46, frames = curve.computeFrenetFrames(SEG, false);
    var pos = [], uv = [], col = [], idx = [];
    var p = new THREE.Vector3(), n = new THREE.Vector3(), tv = new THREE.Vector3(), tmp = new THREE.Vector3();
    for (var i = 0; i <= SEG; i++) {
      var t = i / SEG;
      curve.getPoint(t, p);
      n.copy(frames.binormals[i]);
      tv.copy(frames.tangents[i]);
      n.applyAxisAngle(tv, t * twist);
      var taper = taperEnd ? Math.min(1, 0.55 + t * 3) * (1 - 0.45 * t * t) : Math.min(1, 0.5 + t * 4) * Math.min(1, 0.5 + (1 - t) * 4);
      var hw = halfWidth * taper;
      tmp.copy(p).addScaledVector(n, -hw);
      pos.push(tmp.x, tmp.y, tmp.z);
      tmp.copy(p).addScaledVector(n, hw);
      pos.push(tmp.x, tmp.y, tmp.z);
      uv.push(t, 0, t, 1);
      var sh = 0.80 + 0.20 * Math.abs(Math.cos(t * twist));
      col.push(sh, sh, sh * 0.99, sh * 0.90, sh * 0.90, sh * 0.89);
    }
    for (var s = 0; s < SEG; s++) {
      var o = s * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    return sinkToGeometry(THREE, { pos: pos, uv: uv, col: col, idx: idx });
  }

  function mirrorX(pts) {
    return pts.map(function (p) { return [-p[0], p[1], p[2]]; });
  }

  /* одна голова розы — для отладки формы цветка */
  function buildRose(THREE) {
    var mat = new THREE.MeshPhysicalMaterial({
      name: 'rose_petal', color: 0xA00E18, vertexColors: true, side: THREE.DoubleSide,
      roughness: 0.58, metalness: 0, sheen: 0.55, sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xE0616E), clearcoat: 0.08, clearcoatRoughness: 0.8
    });
    return new THREE.Mesh(roseGeometry(THREE), mat);
  }

  /* ---------- сам букет ---------- */
  function build(THREE) {
    var group = new THREE.Group();
    group.name = 'rose_bouquet';

    var bind = { y: -0.24, z: 0.0, r: 0.075 };
    var box = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9 };
    function bump(x, y, z, r) {
      if (x - r < box.minX) box.minX = x - r;
      if (x + r > box.maxX) box.maxX = x + r;
      if (y - r < box.minY) box.minY = y - r;
      if (y + r > box.maxY) box.maxY = y + r;
      if (z - r < box.minZ) box.minZ = z - r;
      if (z + r > box.maxZ) box.maxZ = z + r;
    }

    var petalMat = new THREE.MeshPhysicalMaterial({
      name: 'rose_petal', color: 0xffffff, vertexColors: true, side: THREE.DoubleSide,
      roughness: 0.58, metalness: 0, sheen: 0.55, sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xE0616E), clearcoat: 0.08, clearcoatRoughness: 0.8
    });
    var leafMat = new THREE.MeshPhysicalMaterial({
      name: 'foliage', color: 0x2C4A26, vertexColors: true, side: THREE.DoubleSide,
      roughness: 0.52, metalness: 0, sheen: 0.7, sheenColor: new THREE.Color(0x9BC17A),
      clearcoat: 0.2, clearcoatRoughness: 0.6
    });
    var stemMat = new THREE.MeshStandardMaterial({ name: 'stem_green', color: 0x6B7C3C, roughness: 0.70, metalness: 0 });
    var ribbonMat = new THREE.MeshPhysicalMaterial({
      name: 'ribbon_satin_white', color: 0xFBF8F3, vertexColors: true, side: THREE.DoubleSide,
      roughness: 0.22, metalness: 0.03, clearcoat: 0.8, clearcoatRoughness: 0.2,
      sheen: 1, sheenRoughness: 0.32, sheenColor: new THREE.Color(0xFFFFFF)
    });

    /* --- купол роз --- */
    var N = 42, Rx = 0.88, Ry = 0.50, domeY = 0.50;
    var roses = new THREE.InstancedMesh(roseGeometry(THREE), petalMat, N);
    roses.name = 'rose_heads';
    var reds = [0xA00E18, 0x8A0812, 0xB4141F, 0x760610, 0x9A0C16];
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), spin = new THREE.Quaternion();
    var up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), sc = new THREE.Vector3();
    var col = new THREE.Color();
    var seats = [];
    for (var k = 0; k < N; k++) {
      var y0 = 1 - (k + 0.45) / N;
      var rr = Math.sqrt(Math.max(0, 1 - y0 * y0));
      var phi = k * GOLDEN;
      var px = Math.cos(phi) * rr * Rx;
      var pz = Math.sin(phi) * rr * Rx * 0.92;
      var py = domeY + y0 * Ry;
      dir.set(px / Rx, (y0 * Ry) / Ry * 0.95 + 0.55, pz / Rx).normalize();
      q.setFromUnitVectors(up, dir);
      spin.setFromAxisAngle(dir, k * 1.37);
      q.premultiply(spin);
      var s = 0.50 + ((k * 7) % 5) * 0.020;
      sc.set(s, s, s);
      m4.compose(new THREE.Vector3(px, py, pz), q, sc);
      roses.setMatrixAt(k, m4);
      roses.setColorAt(k, col.setHex(reds[k % reds.length]));
      // точка крепления стебля: чуть ниже основания бутона, по его оси
      seats.push(new THREE.Vector3(px, py, pz).addScaledVector(dir, -0.13 * s / 0.5));
      bump(px, py, pz, 0.30 * s + 0.10);
    }
    roses.instanceMatrix.needsUpdate = true;
    group.add(roses);

    /* --- венок листьев под куполом --- */
    var LN = 16;
    var leaves = new THREE.InstancedMesh(leafGeometry(THREE), leafMat, LN);
    leaves.name = 'leaves';
    for (var l = 0; l < LN; l++) {
      var az = l * (TAU / LN) + 0.3;
      var tilt = 1.50 + ((l % 3) - 1) * 0.18;
      var rad = 0.44 + ((l % 4) - 1.5) * 0.06;
      var ly = 0.10 + ((l % 5) - 2) * 0.03;
      dir.set(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt)).normalize();
      q.setFromUnitVectors(up, dir);
      spin.setFromAxisAngle(dir, (l % 3) * 0.5);
      q.premultiply(spin);
      var ls = 1.30 + ((l % 4) - 1.5) * 0.16;
      sc.set(ls, ls, ls);
      m4.compose(new THREE.Vector3(Math.cos(az) * rad, ly, Math.sin(az) * rad), q, sc);
      leaves.setMatrixAt(l, m4);
      bump(Math.cos(az) * (rad + 0.55 * ls), ly - 0.2, Math.sin(az) * (rad + 0.55 * ls), 0.08);
    }
    leaves.instanceMatrix.needsUpdate = true;
    group.add(leaves);

    /* --- стебли: под каждым бутоном свой, все сходятся к перевязи --- */
    var SN = 58;
    var stemGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
    var stems = new THREE.InstancedMesh(stemGeo, stemMat, N + SN);
    stems.name = 'stems';
    var a1 = new THREE.Vector3(), b1 = new THREE.Vector3(), mid = new THREE.Vector3(), axis = new THREE.Vector3();
    function placeStem(idx, from, to, rad) {
      axis.subVectors(to, from);
      var len = axis.length();
      mid.copy(from).addScaledVector(axis, 0.5);
      q.setFromUnitVectors(up, axis.clone().normalize());
      sc.set(rad, len, rad);
      m4.compose(mid, q, sc);
      stems.setMatrixAt(idx, m4);
      bump(to.x, to.y, to.z, rad * 2);
    }
    for (var sd = 0; sd < N; sd++) {
      var seat = seats[sd];
      var sr = 0.0100 + ((sd % 3) * 0.0014);
      var ba = Math.atan2(seat.z, seat.x);
      b1.set(Math.cos(ba) * bind.r * 0.8, bind.y + 0.06, Math.sin(ba) * bind.r * 0.8);
      placeStem(sd, seat, b1, sr);
    }
    for (var st = 0; st < SN; st++) {
      var sa = st * GOLDEN;
      var botR = 0.22 + ((st * 5) % 9) * 0.036;
      var rad2 = 0.0105 + ((st % 3) * 0.0018);
      a1.set(Math.cos(sa) * bind.r * 0.7, bind.y + 0.02, Math.sin(sa) * bind.r * 0.7);
      b1.set(Math.cos(sa + 0.16) * botR, -1.34 - ((st % 5) * 0.045), Math.sin(sa + 0.16) * botR);
      placeStem(N + st, a1, b1, rad2 * 0.96);
    }
    stems.instanceMatrix.needsUpdate = true;
    group.add(stems);

    /* --- перевязь --- */
    var band = new THREE.Mesh(
      new THREE.CylinderGeometry(bind.r * 1.30, bind.r * 1.16, 0.15, 26, 1, true),
      ribbonMat
    );
    band.name = 'ribbon_band';
    band.position.set(0, bind.y, 0);
    group.add(band);
    bump(0, bind.y, 0, bind.r * 1.4);

    /* --- бант: две петли, два хвоста, узел --- */
    var bow = new THREE.Group();
    bow.name = 'bow';
    var knotPos = new THREE.Vector3(0, bind.y - 0.01, bind.r * 1.22);

    var knot = new THREE.Mesh(new THREE.SphereGeometry(0.030, 14, 10), ribbonMat);
    knot.name = 'bow_knot';
    knot.scale.set(1.5, 1.05, 0.9);
    knot.position.copy(knotPos);
    bow.add(knot);

    var loopPts = [
      [0, 0, 0.01], [-0.100, 0.084, 0.048], [-0.212, 0.094, 0.036],
      [-0.272, 0.014, 0.012], [-0.198, -0.062, 0.030], [-0.072, -0.038, 0.046], [0.005, 0.005, 0.014]
    ];
    var tailPts = [
      [0, -0.006, 0.012], [-0.040, -0.085, 0.036], [-0.092, -0.170, 0.020],
      [-0.070, -0.250, 0.034], [-0.104, -0.318, 0.018]
    ];
    [
      { n: 'bow_loop_left', pts: loopPts, w: 0.062, tw: 1.5, taper: false },
      { n: 'bow_loop_right', pts: mirrorX(loopPts), w: 0.062, tw: -1.5, taper: false },
      { n: 'bow_tail_left', pts: tailPts, w: 0.046, tw: 2.1, taper: true },
      { n: 'bow_tail_right', pts: mirrorX(tailPts), w: 0.046, tw: -2.1, taper: true }
    ].forEach(function (part) {
      var mesh = new THREE.Mesh(stripGeometry(THREE, part.pts, part.w, part.tw, part.taper), ribbonMat);
      mesh.name = part.n;
      mesh.position.copy(knotPos);
      bow.add(mesh);
    });
    group.add(bow);
    bump(0, bind.y - 0.36, knotPos.z + 0.05, 0.24);

    group.userData.bounds = {
      size: new THREE.Vector3(box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ),
      center: new THREE.Vector3((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2)
    };
    return group;
  }
})();
