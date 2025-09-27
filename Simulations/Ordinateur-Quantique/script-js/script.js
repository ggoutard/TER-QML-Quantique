(() => {
  // ——— Constantes de la simulation ———
  const INITIAL_COUNT   = 0;
  const RADIUS          = 1;
  const DEPTH_BOUND     = 5;
  const MAX_TEMP        = 300;
  const SPARK_DURATION  = 0.3;
  const SPARK_INTENSITY = 2;
  const SPARK_RANGE     = 5;

  // ——— État global ———
  let scene, camera, renderer, clock, raycaster;
  let boundsX = 0, boundsY = 0;
  let temperatureK = 50, noiseAmp = 0.15;
  let started = false;

  // ——— Collections ———
  const particles = [];          // { mesh, wire, mat, wireMat, vel, axis, color }
  const links     = new Map();   // key "i-j" -> { line, posBuf(Float32Array), geom }
  const sparks    = [];          // active sparks
  const overlap   = new Set();   // collision pair keys handled this frame
  let   collided  = new Set();   // indices that collided this frame

  // ——— Géométries et matériaux partagés ———
  const GEO     = new THREE.DodecahedronGeometry(RADIUS, 0);
  const WIRE_G  = new THREE.WireframeGeometry(GEO);
  const LINK_MAT = new THREE.LineDashedMaterial({ color: 0x0000ff, dashSize: 0.5, gapSize: 0.3, linewidth: 2 });

  // ——— Utils temporaires (pas d’allocs en boucle) ———
  const TMP_V1 = new THREE.Vector3();
  const TMP_V2 = new THREE.Vector3();
  const TMP_V3 = new THREE.Vector3();
  const TMP_C1 = new THREE.Color();
  const TMP_C2 = new THREE.Color();

  // ——— Utilitaires ———
  function randomUnit() {
    TMP_V1.set(Math.random()*2 -1, Math.random()*2 -1, Math.random()*2 -1);
    return TMP_V1.normalize().clone();
  }
  function randFloat(a, b) {
    return THREE.MathUtils.lerp(a, b, Math.random());
  }
  function complementaryColor(c) {
    return TMP_C1.setRGB(1 - c.r, 1 - c.g, 1 - c.b).clone();
  }
  function bounce(pos, vel, ax, lim) {
    const m = lim - RADIUS;
    if (pos[ax] >  m) { pos[ax] =  m; vel[ax] *= -0.9; }
    if (pos[ax] < -m) { pos[ax] = -m; vel[ax] *= -0.9; }
  }
  function pairKey(i, j) {
    return i < j ? `${i}-${j}` : `${j}-${i}`;
  }

  // ——— Spatial Hash (grille 3D) ———
  class SpatialHash {
    constructor(cellSize) {
      this.cell = cellSize;
      this.map = new Map();
    }
    clear() { this.map.clear(); }
    cellKey(x, y, z) {
      const c = this.cell;
      return `${Math.floor(x/c)}|${Math.floor(y/c)}|${Math.floor(z/c)}`;
    }
    add(idx, pos) {
      const k = this.cellKey(pos.x, pos.y, pos.z);
      let bucket = this.map.get(k);
      if (!bucket) this.map.set(k, bucket = []);
      bucket.push(idx);
    }
    neighbors(pos) {
      const c = this.cell;
      const i0 = Math.floor(pos.x / c);
      const j0 = Math.floor(pos.y / c);
      const k0 = Math.floor(pos.z / c);
      const out = [];
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        for (let j = j0 - 1; j <= j0 + 1; j++) {
          for (let k = k0 - 1; k <= k0 + 1; k++) {
            const bucket = this.map.get(`${i}|${j}|${k}`);
            if (bucket) out.push(...bucket);
          }
        }
      }
      return out;
    }
  }
  const HASH = new SpatialHash(RADIUS * 2.5);

  // ——— Pool générique ———
  class Pool {
    constructor(createFn, onAcquire = null, onRelease = null) {
      this.create = createFn;
      this.onAcquire = onAcquire;
      this.onRelease = onRelease;
      this.free = [];
    }
    acquire() {
      const obj = this.free.pop() || this.create();
      if (this.onAcquire) this.onAcquire(obj);
      return obj;
    }
    release(obj) {
      if (this.onRelease) this.onRelease(obj);
      this.free.push(obj);
    }
  }

  // ——— Pool Sparks ———
  const sparkPool = new Pool(
    () => {
      const light = new THREE.PointLight(0xffffff, 0, SPARK_RANGE);
      light.visible = false;
      scene && scene.add(light);
      return { light, born: 0, color: new THREE.Color() };
    },
    (s) => { s.light.visible = true; },
    (s) => { s.light.visible = false; }
  );

  function spawnSpark(pos, color) {
    const s = sparkPool.acquire();
    s.born = clock.getElapsedTime();
    s.color.copy(color);
    s.light.color.copy(color);
    s.light.intensity = SPARK_INTENSITY;
    s.light.position.copy(pos);
    sparks.push(s);
  }

  function updateSparks() {
    const now = clock.getElapsedTime();
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      const age = now - s.born;
      if (age > SPARK_DURATION) {
        sparkPool.release(s);
        sparks.splice(i, 1);
      } else {
        s.light.intensity = SPARK_INTENSITY * (1 - age / SPARK_DURATION);
      }
    }
  }

  // ——— Pool Links ———
  const linkPool = new Pool(
    () => {
      const posBuf = new Float32Array(6); // p1(x,y,z), p2(x,y,z)
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
      const line = new THREE.Line(geom, LINK_MAT);
      line.computeLineDistances();
      scene && scene.add(line);
      return { line, posBuf, geom };
    },
    (l) => { l.line.visible = true; },
    (l) => { l.line.visible = false; }
  );

  function attachLink(i, j) {
    const key = pairKey(i, j);
    if (links.has(key)) return;
    const L = linkPool.acquire();
    links.set(key, L);
    updateLinkGeometry(key);
  }

  function detachLink(key) {
    const L = links.get(key);
    if (!L) return;
    linkPool.release(L);
    links.delete(key);
  }

  function updateLinkGeometry(key) {
    const L = links.get(key);
    if (!L) return;
    const [i, j] = key.split('-').map(Number);
    const p1 = particles[i].mesh.position;
    const p2 = particles[j].mesh.position;
    const b = L.posBuf;
    b[0] = p1.x; b[1] = p1.y; b[2] = p1.z;
    b[3] = p2.x; b[4] = p2.y; b[5] = p2.z;
    L.geom.attributes.position.needsUpdate = true;
    L.line.computeLineDistances();
  }

// Remplace ton ancienne fonction pour ne spinner que les particules liées à sourceIdx
function spinAllParticles(sourceIdx) {
  const now = clock.getElapsedTime();

  // Parcourt toutes les liaisons existantes
  links.forEach((_, key) => {
    const [i, j] = key.split('-').map(Number);
    let otherIdx;

    // Si la liaison concerne sourceIdx, on récupère l'autre partenaire
    if (i === sourceIdx)      otherIdx = j;
    else if (j === sourceIdx) otherIdx = i;
    else                      return; // pas dans cette liaison

    const p = particles[otherIdx];
    // On throttle le spin pour éviter les trop grandes fréquences
    if (now - p.lastSpinTime >= 0.2) {
      p.lastSpinTime = now;
      p.startSpinAnimation();
    }
  });
}


// ——— Classe Particle ———
class Particle {
  constructor() {
    // Pulsation
    this.pulsePhase   = 0;
    this.pulsing      = false;

    // Couleur et matériau principal
    this.color        = new THREE.Color(0x1565C0);
    this.mat          = new THREE.MeshStandardMaterial({
      color:       this.color,
      emissive:    TMP_C2.copy(this.color).multiplyScalar(0.6),
      roughness:   0.3,
      metalness:   0.6,
      flatShading: true,
      transparent: true,
      opacity:     1
    });
    this.mesh         = new THREE.Mesh(GEO, this.mat);

    // Fil de fer
    this.wireMat      = new THREE.LineBasicMaterial({
      color:       0xffffff,
      transparent: true,
      opacity:     0.6
    });
    this.wire         = new THREE.LineSegments(WIRE_G, this.wireMat);
    this.mesh.add(this.wire);

    // Vitesse, axe de rotation, verrou spin
    this.vel           = randomUnit().multiplyScalar(randFloat(1, 2));
    this.axis          = randomUnit();
    this.lastSpinTime  = 0;
    this.spinPhase     = 0;
    this.spinAnimating = false;

    // Impact (pulse scale)
    this.impactTime    = 0;

    // Ring laser (initialement invisible)
    this.laserMat      = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity:     0,
      side:        THREE.DoubleSide
    });
    this.laserGeo      = new THREE.RingGeometry(0.5, 0.6, 32);
    this.laserMesh     = new THREE.Mesh(this.laserGeo, this.laserMat);
    this.laserMesh.rotation.x = Math.PI / 2;
    this.mesh.add(this.laserMesh);
    this.laserPhase    = 0;
    this.laserActive   = false;

    // Ajout à la scène
    scene.add(this.mesh);
  }

  // Place la particule aléatoirement
  setPosition() {
    this.mesh.position.set(
      THREE.MathUtils.randFloatSpread(boundsX * 1.6),
      THREE.MathUtils.randFloatSpread(boundsY * 1.6),
      THREE.MathUtils.randFloat(-DEPTH_BOUND, DEPTH_BOUND)
    );
  }

  // Déclenche une pulsation de scale
  startPulseAnimation() {
    this.pulsePhase = 0;
    this.pulsing    = true;
  }

  // Déclenche l’animation d’impact (pulse de scale)
  triggerImpactAnim() {
    this.impactTime = clock.getElapsedTime();
  }
// Dans ta classe Particle, remplace triggerLaserEffect par ceci :
// À mettre dans ta classe Particle, à la place de l’ancien triggerLaserEffect
// À placer dans ta classe Particle
triggerLaserEffect() {
    const gate = document.querySelector('input[name="gate"]:checked').value;
    let laserHex, qubitColor;

    switch (gate) {
      case 'random':
        laserHex   = 0x00ff00;
       qubitColor = TMP_C2.set(0x1565C0)
            .lerp(TMP_C1.set(0xFF4081), Math.random())
            .clone();
        break;

      case 'ground':
        laserHex   = 0x0000ff;
        qubitColor = TMP_C2.set(0x1565C0).clone(); 
        break;

      case 'excite':
      default:
        laserHex   = 0xff0000;
qubitColor = new THREE.Color("#e03aff");
    }

    // Ring laser
    this.laserMat.color.setHex(laserHex);
    this.laserPhase      = 0;
    this.laserActive     = true;
    this.laserMat.opacity = 1;
    this.laserMesh.scale.set(1, 1, 1);

    // Recoloration du qubit
    this.setColor(qubitColor);

    // Rotation immédiate + propagation
    this.mesh.rotateOnAxis(this.axis, Math.PI / 2);
    spinAllParticles(particles.indexOf(this));
  }
  // Démarre une animation globale de spin
  startSpinAnimation() {
    this.spinPhase      = 0;
    this.spinAnimating  = true;
    const col = TMP_C2.set(0x1565C0)
            .lerp(TMP_C1.set(0xFF4081), Math.random())
            .clone();
          this.setColor(col)
  }

  // Sur impact : rotation instantanée + propagation du spin
  spinOnImpact() {
    const now = clock.getElapsedTime();
    if (now - this.lastSpinTime < 0.2) return;
    this.lastSpinTime = now;

    this.startSpinAnimation() 
    // rotation immédiate
    this.mesh.rotateOnAxis(this.axis, Math.PI / 2);

    // propagation aux autres
    spinAllParticles(particles.indexOf(this));
    const col = TMP_C2.set(0x1565C0)
            .lerp(TMP_C1.set(0xFF4081), Math.random())
            .clone();
    this.setColor(col)
  }

  // Change la couleur du mesh et du wireframe
  setColor(col) {
    this.color.copy(col);
    this.mat.color.copy(col);
    this.mat.emissive.copy(col).multiplyScalar(0.6);
    TMP_C1.setRGB(1 - col.r, 1 - col.g, 1 - col.b);
    this.wireMat.color.copy(TMP_C1);
  }

  // Mise à jour frame
  update(dt, moveF) {
    // Bruit sur la vélocité
    this.vel.x += (Math.random() - 0.5) * noiseAmp * dt * 2000;
    this.vel.y += (Math.random() - 0.5) * noiseAmp * dt * 2000;
    this.vel.z += (Math.random() - 0.5) * noiseAmp * dt * 2000;

    // Clamp de vitesse
    const maxS = 20000 * moveF;
    if (this.vel.lengthSq() > maxS * maxS) {
      this.vel.setLength(maxS);
    }

    // Déplacement + rebonds
    this.mesh.position.addScaledVector(this.vel, dt * moveF);
    bounce(this.mesh.position, this.vel, 'x', boundsX);
    bounce(this.mesh.position, this.vel, 'y', boundsY);
    bounce(this.mesh.position, this.vel, 'z', DEPTH_BOUND);

    // Impact scale pulse
    if (this.impactTime > 0) {
      const e = clock.getElapsedTime() - this.impactTime;
      if (e < 0.2) {
        const s = 1 + Math.sin((e / 0.2) * Math.PI) * 0.3;
        this.mesh.scale.set(s, s, s);
      } else {
        this.mesh.scale.set(1, 1, 1);
        this.impactTime = 0;
      }
    }

    // Pulsation périodique
    if (this.pulsing) {
      this.pulsePhase += dt * 10;
      const s = 1 + Math.sin(this.pulsePhase) * 0.2;
      this.mesh.scale.set(s, s, s);
      if (this.pulsePhase > Math.PI * 2) {
        this.mesh.scale.set(1, 1, 1);
        this.pulsing = false;
      }
    }

    // Animation ring laser
    if (this.laserActive) {
      this.laserPhase += dt * 5;
      const s = 1 + this.laserPhase * 2;
      this.laserMesh.scale.set(s, s, s);
      this.laserMat.opacity = 1 - this.laserPhase * 0.8;
      if (this.laserPhase > 1.2) {
        this.laserActive     = false;
        this.laserMat.opacity = 0;
      }
    }

    // Spin global animé
    if (this.spinAnimating) {
      const spinSpeed = Math.PI * 2; // tour/s
      this.spinPhase  += dt * spinSpeed;
      this.mesh.rotateOnAxis(this.axis, dt * spinSpeed);
      if (this.spinPhase >= Math.PI * 2) {
        this.spinAnimating = false;
        this.spinPhase     = 0;
      }
    }
  }
}


  // ——— Init scène ———
  function init() {
    scene    = new THREE.Scene();
    camera   = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 1000);
    camera.position.z = 30;

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    document.querySelector('.hero-simulation').appendChild(renderer.domElement);

    clock     = new THREE.Clock();
    raycaster = new THREE.Raycaster();

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 7, 6);
    scene.add(dir);

    updateBounds();
    for (let i = 0; i < INITIAL_COUNT; i++) addParticle();
    updateCountLabel();

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ——— Gestion UI ———
  const btnStart    = document.getElementById('btn-start');
  const controls    = document.getElementById('controlsPanel');
  const tempSlider  = document.getElementById('tempSlider');
  const noiseSlider = document.getElementById('noiseSlider');
  const btnAdd      = document.getElementById('btn-add');
  const btnRemove   = document.getElementById('btn-remove');

  btnStart.addEventListener('click', () => {
    if (started) return;
    started = true;
    document.getElementById('heroContent').classList.add('hidden');
    controls.classList.add('visible');
    controls.setAttribute('aria-hidden','false');
    init();
    animate();
  });

  tempSlider .addEventListener('input', e => {
    temperatureK = +e.target.value;
    document.getElementById('lblTemp').textContent = `${temperatureK}K`;
  });
  noiseSlider.addEventListener('input', e => {
    noiseAmp = +e.target.value;
    document.getElementById('lblNoise').textContent = Number(noiseAmp).toFixed(2);
  });
  btnAdd   .addEventListener('click', () => started && addParticle());
  btnRemove.addEventListener('click', () => started && removeParticle());

  // ——— Particules ———
  function addParticle() {
    const p = new Particle();
    p.setPosition();
    particles.push(p);
    updateCountLabel();
  }

  function removeParticle() {
    if (!particles.length) return;
    const idx = particles.length - 1;
    // supprimer liens attachés
    const toDelete = [];
    links.forEach((_, key) => {
      const [i, j] = key.split('-').map(Number);
      if (i === idx || j === idx) toDelete.push(key);
    });
    toDelete.forEach(detachLink);

    const p = particles.pop();
    scene.remove(p.mesh);
    updateCountLabel();
  }

  function updateCountLabel() {
    document.getElementById('lblCount').textContent = particles.length;
  }

// ——— Animation ———

function animate() {
  requestAnimationFrame(animate);

  const dt    = Math.min(clock.getDelta(), 0.033);
  const normT = Math.min(temperatureK / MAX_TEMP, 1);
  const moveF = THREE.MathUtils.lerp(0.2, 5.0, normT);

  overlap.clear();
  collided.clear();
  HASH.clear();

  // update + hash
  particles.forEach((p, i) => {
    p.update(dt, moveF);
    HASH.add(i, p.mesh.position);
  });

  // collisions (sans ring laser)
  const minDist  = RADIUS * 2;
  const minDist2 = minDist * minDist;
  for (let i = 0; i < particles.length; i++) {
    const A     = particles[i];
    const neigh = HASH.neighbors(A.mesh.position);
    neigh.forEach(j => {
      if (j <= i) return;
      const B = particles[j];
      TMP_V1.copy(A.mesh.position).sub(B.mesh.position);
      if (TMP_V1.lengthSq() < minDist2) {
        const key = pairKey(i, j);
        if (!overlap.has(key)) {
          overlap.add(key);
          // spin + impact anim
          A.spinOnImpact();
          B.spinOnImpact();
          A.triggerImpactAnim();
          B.triggerImpactAnim();
          // recolor + link toggle
          const col = TMP_C2.set(0x1565C0)
            .lerp(TMP_C1.set(0xFF4081), Math.random())
            .clone();
          A.setColor(col);
          B.setColor(col);
          if (links.has(key)) detachLink(key);
          else if (Math.random() < 1/3) attachLink(i, j);
          // spark
          TMP_V2.copy(A.mesh.position)
            .add(B.mesh.position)
            .multiplyScalar(0.5);
          spawnSpark(TMP_V2, col);
        }
      }
    });
  }

  // mise à jour liens et sparks
  links.forEach((_, key) => updateLinkGeometry(key));
  updateSparks();

  renderer.render(scene, camera);
}


// ——— Clic souris pour ring laser ———
const mouse     = new THREE.Vector2();

window.addEventListener('click', event => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(
    particles.map(p => p.mesh), true
  );
  if (hits.length > 0) {
    const hit = hits[0].object;
    const p   = particles.find(p => p.mesh === hit || p.mesh.children.includes(hit));
    if (p) {
      p.spinOnImpact();
      p.triggerImpactAnim();
      p.triggerLaserEffect(p.color);
    }
  }
});

  // ——— Interaction souris ———
  function onMouse(e) {
    if (!started) return;
    const mv = new THREE.Vector2(
      (e.clientX / innerWidth) * 2 - 1,
      -(e.clientY / innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mv, camera);
    const hit = raycaster.intersectObjects(particles.map(p => p.mesh), false)[0];
    if (!hit) return;
    const idx = particles.findIndex(p => p.mesh === hit.object || p.mesh === hit.object.parent);
    if (idx === -1) return;

    if (e.button === 0) {
      // coup de pied
      const kick = randomUnit().multiplyScalar(5);
      particles[idx].vel.add(kick);
    } else if (e.button === 2 && collided.has(idx)) {
      // supprime un lien attaché à cette particule
      const cands = [];
      links.forEach((_, key) => {
        const [i, j] = key.split('-').map(Number);
        if (i === idx || j === idx) cands.push(key);
      });
      if (cands.length) {
        const choice = cands[(Math.random() * cands.length) | 0];
        detachLink(choice);
      }
    }
  }

  // ——— Resize et bornes ———
  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    updateBounds();
  }
  function updateBounds() {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const h    = Math.tan(vFov / 2) * camera.position.z * 2;
    boundsY    = h / 2 - RADIUS * 1.2;
    boundsX    = (h * innerWidth / innerHeight) / 2 - RADIUS * 1.2;
  }
  
})();
// --- Toggle volet Informations ---
const infoLink = document.querySelector('nav a[href="#informations"]');
const infoPanel = document.getElementById('infoPanel');
const infoClose = document.getElementById('infoClose');

function openInfo() {
  infoPanel.classList.add('visible');
  infoPanel.setAttribute('aria-hidden', 'false');
}

function closeInfo() {
  infoPanel.classList.remove('visible');
  infoPanel.setAttribute('aria-hidden', 'true');
}

// Clic sur le lien “Informations”
infoLink.addEventListener('click', e => {
  e.preventDefault();
  // si déjà ouvert, on ferme
  if (infoPanel.classList.contains('visible')) closeInfo();
  else openInfo();
});

// Clic sur la croix de fermeture
infoClose.addEventListener('click', closeInfo);

// Échap pour fermer le volet
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && infoPanel.classList.contains('visible')) {
    closeInfo();
  }
});
