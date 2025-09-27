const qubit = new Qubit();


// ── 2) DOM REFERENCES ─────────────────────────────────────────────────
const simContainer  = document.getElementById('simContainer');
const btnStart      = document.getElementById('btn-start');
const controlsPanel = document.getElementById('controlsPanel');
const infoLink      = document.getElementById('infoLink');
const infoPanel     = document.getElementById('infoPanel');
const infoClose     = document.getElementById('infoClose');

const tabButtons    = document.querySelectorAll('.tab-btn');
const stateButtons  = document.querySelectorAll('.state-btn');
const gateButtons   = document.querySelectorAll('.gate-btn');
const danceSliderEl = document.getElementById('danceAmpRange');
const rAngleInput   = document.getElementById('rAngle');
const rAngleVal     = document.getElementById('rAngleVal');
const btnR          = document.getElementById('btnR');


// ── 3) QUANTUM & PARTICLES ─────────────────────────────────────────────
const N             = 600;
const minR          = 0.6;
const maxR          = 1.4;
let danceAmp        = 0.8;
const idleThreshold = 0.01;
const idleRadius    = 0.15;

// clouds & wave
let data0, data1, cloud0, cloud1;
let wave, isWave = false, waveStart = 0;
const waveDur      = 800;
const waveStartPos = new THREE.Vector3(-4, 4, 0);
const waveEndPos   = new THREE.Vector3(0,  0, 0);

// gate durations
const D1 = 300, D2 = 500, D3 = 300;


// ── 4) SCENE, CAMERA, RENDERER ────────────────────────────────────────
const scene1  = new THREE.Scene();
scene1.rotation.x = -Math.PI / 2;



const camera1 = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
// Position de la caméra pour voir X et Y "vers nous"
camera1.position.set(6, 6, 0); // Vue oblique depuis X/Y
camera1.lookAt(0, 0, 0);
const renderer1 = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer1.setSize(innerWidth, innerHeight);
renderer1.domElement.style.position = 'relative';
renderer1.domElement.style.left     = '-20%';
simContainer.appendChild(renderer1.domElement);


const pivot    = new THREE.Group();

pivot.scale.set(0.8, 0.8, 0.8);
scene1.add(pivot);
// 2. Fonction utilitaire qui ne dessine que le texte
function createTextSprite(message, options = {}) {
  const fontface = options.fontface   || 'Arial';
  const fontsize = 20;
  const textColor = options.textColor || { r: 0, g: 0, b: 0, a: 1.0 };
  const scale     = options.scale      || 0.01;

  // 1) Création du canvas et réglage de la police
  const canvas  = document.createElement('canvas');
  const ctx     = canvas.getContext('2d');
  ctx.font      = `${fontsize}px ${fontface}`;

  // 2) Mesure du texte
  const metrics   = ctx.measureText(message);
  const textWidth = metrics.width;
  const textHeight = fontsize; 

  // 3) Ajustement du canvas à la taille du texte
  canvas.width  = textWidth;
  canvas.height = textHeight;

  // 4) Reconfigurer la police après redimensionnement du canvas
  ctx.font         = `${fontsize}px ${fontface}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle    = `rgba(${textColor.r},${textColor.g},${textColor.b},${textColor.a})`;

  // 5) Dessiner uniquement le texte
  ctx.fillText(message, 0, 0);

  // 6) Créer la texture et le sprite
  const texture       = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  const mat           = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite        = new THREE.Sprite(mat);

  // 7) Mettre à l’échelle en fonction du canvas
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);

  return sprite;
}


const axes     = new THREE.AxesHelper(4);
axes.scale.set(0.8, 0.8, 0.8);
pivot.add(axes);
const rawLength   = 4;
const scaleHelper = 0.8;
const axisLength  = rawLength * scaleHelper; // = 3.2



// 3. Crée les labels et place-les un tout petit peu au-delà de la pointe
const labelX = createTextSprite('X', {
  textColor:    { r:255, g:0,   b:0,   a:1 },
});
labelX.position.set(axisLength * 1.05, 0, 0);
pivot.add(labelX);

const labelY = createTextSprite('Y', {
  textColor:    { r:0,   g:128, b:0,   a:1 },
});
labelY.position.set(0, axisLength * 1.05, 0);
pivot.add(labelY);

const labelZ = createTextSprite('Z', {
  textColor:    { r:0,   g:0,   b:255, a:1 },
});
labelZ.position.set(0, 0, axisLength * 1.05);
pivot.add(labelZ);
const pole0    = new THREE.ArrowHelper(new THREE.Vector3(0,0,1),  0, 1.5, 0x00ff00);
const pole1    = new THREE.ArrowHelper(new THREE.Vector3(0,0,-1), 0, 1.5, 0xff0000);
const arrowPsi = new THREE.ArrowHelper(new THREE.Vector3(0,0,1),  0, 2,   0xffff00);
pivot.add(pole0, pole1);

const mat0 = new THREE.PointsMaterial({ color: 0x00aaff, size: 0.06, transparent: true });
const mat1 = new THREE.PointsMaterial({ color: 0xffaa00, size: 0.06, transparent: true });

scene1.add(new THREE.AmbientLight(0x222222));
const keyLight = new THREE.PointLight(0xffffff, 0, 10);
scene1.add(keyLight);


// ── Ajout de la flèche “Up” pour repérer la direction du qubit ─────────
const arrowUp = new THREE.ArrowHelper(
  // vecteur “up” dans vos axes : ici +Y
  new THREE.Vector3(0, 1, 0),  
  // origine de la flèche (centre du pivot / du Bloch)
  new THREE.Vector3(0, 0, 0),
  // longueur de la flèche
  2.5,
  // couleur (blanc ici, vous pouvez choisir ce que vous voulez)
  0xffffff
);
pivot.add(arrowUp);
const qubitVisual = new THREE.Group();
pivot.add(qubitVisual);

// … plus bas, dans votre handler btnStart (ou juste après initCloud) …
btnStart.addEventListener('click', () => {
  // … votre code d'affichage …

  data0  = initCloud(N);
  data1  = initCloud(N);
  
  // N’OUBLIEZ PAS : on ajoute dans qubitVisual
  qubitVisual.add(cloud0, cloud1,arrowPsi);
console.log(scene1);

  animate(performance.now());
});

// ── 5) HELPERS ────────────────────────────────────────────────────────
function ease(x) {
  return x < 0.5
    ? 4*x*x*x
    : 1 - Math.pow(-2*x+2, 3)/2;
}

function initCloud(N) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N*3),
        th  = new Float32Array(N),
        ph  = new Float32Array(N),
        sp  = new Float32Array(N),
        pc  = new Float32Array(N);
  for (let i=0;i<N;i++){
    th[i]=Math.random()*2*Math.PI;
    ph[i]=Math.acos(2*Math.random()-1);
    sp[i]=1+Math.random()*2;
    pc[i]=Math.random()*Math.PI*2;
    const r0=Math.random()*maxR;
    pos[3*i  ]=r0*Math.sin(ph[i])*Math.cos(th[i]);
    pos[3*i+1]=r0*Math.sin(ph[i])*Math.sin(th[i]);
    pos[3*i+2]=r0*Math.cos(ph[i]);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('theta',    new THREE.BufferAttribute(th,1));
  geo.setAttribute('phi',      new THREE.BufferAttribute(ph,1));
  geo.setAttribute('speed',    new THREE.BufferAttribute(sp,1));
  geo.setAttribute('phase',    new THREE.BufferAttribute(pc,1));
  return { geo, theta:th, phi:ph, speed:sp, phase:pc };
}

function updateDance(data, points, amp, t) {
  try{
    const arr = points.geometry.attributes.position.array;
    const base = amp>idleThreshold ? amp : idleThreshold;
    const Rb   = amp>idleThreshold ? minR+(maxR-minR)*amp : idleRadius;
    for (let i=0;i<data.phase.length;i++){
      const osc = Math.sin(t*0.001*data.speed[i]+data.phase[i]);
      const off = danceAmp*base*Math.abs(osc);
      const r   = Rb + off;
      const th  = data.theta[i], ph = data.phi[i];
      arr[3*i]   = r*Math.sin(ph)*Math.cos(th);
      arr[3*i+1] = r*Math.sin(ph)*Math.sin(th);
      arr[3*i+2] = r*Math.cos(ph);
    }
    points.geometry.attributes.position.needsUpdate=true;
}
catch{}
    
  }

function updateGatePhase(data, points, amp, t, pAmp) {
  const arr = points.geometry.attributes.position.array;
  const base = amp>idleThreshold ? amp : idleThreshold;
  const Rb   = amp>idleThreshold ? minR+(maxR-minR)*amp : idleRadius;
  for (let i=0;i<data.phase.length;i++){
    const osc = Math.sin(t*0.001*data.speed[i]+data.phase[i]);
    const off = danceAmp*base*Math.abs(osc)*pAmp;
    const r   = Rb + off;
    const th  = data.theta[i], ph = data.phi[i];
    arr[3*i]   = r*Math.sin(ph)*Math.cos(th);
    arr[3*i+1] = r*Math.sin(ph)*Math.sin(th);
    arr[3*i+2] = r*Math.cos(ph);
  }
  points.geometry.attributes.position.needsUpdate=true;
}

function spawnWave() {
  const geo = new THREE.RingGeometry(0.1,0.12,64);
  const mat = new THREE.MeshBasicMaterial({
    color:0x00ffcc, transparent:true, opacity:1, side:THREE.DoubleSide
  });
  wave = new THREE.Mesh(geo, mat);
  wave.position.copy(waveStartPos);
  scene1.add(wave);
  isWave    = true;
  waveStart = performance.now();
}


// ── animate() ────────────────────────────────────────────────────────────
/**
 * Boucle principale : 
 *  - met à jour l’onde (ring wave) 
 *  - anime la transition de porte ou la “dance” des nuages 
 *  - oriente la flèche et tout le nuage selon les angles du qubit 
 *  - rend la scène
 */
//
// 1) Mise à jour de l’orientation du qubit (unique et sans setDirection)
function updateQubitOrientation() {
  // 1) on récupère θ et φ de votre qubit
  let { theta, phi } = qubit.getBlochAngles();
  const blochDir = new THREE.Vector3(
    Math.sin(theta) * Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
    Math.cos(theta)
  ).normalize();

  // 2) on oriente la flèche jaune vers ce vecteur
  arrowPsi.setDirection(blochDir);

  // 3) on fait tourner tout le groupe nuages & axes
  const q = new THREE.Quaternion()
    .setFromUnitVectors(new THREE.Vector3(0, 0, 1), blochDir);
  qubitVisual.setRotationFromQuaternion(q);

  // 4) (optionnel) ré‐aligner aussi votre flèche « Up »
  arrowUp.setDirection(blochDir);
}


function animate(now) {
  requestAnimationFrame(animate);

  // 1) Ring wave
  if (isWave) {
    const dt = now - waveStart;
    const t  = dt / waveDur;
    if (t < 1) {
      wave.position.lerpVectors(waveStartPos, waveEndPos, t);
      const s = 1 + t * 10;
      wave.scale.set(s, s, s);
      wave.material.opacity = 1 - t;
    } else {
      scene1.remove(wave);
      wave.geometry.dispose();
      wave.material.dispose();
      isWave = false;
    }
  }

  // 2) Gate animation ou dance
  if (qubit.isGate) {
    const dt    = now - qubit.gateStart;
    const total = D1 + D2 + D3;
    const norm  = Math.min(dt / total, 1);
    keyLight.intensity = Math.sin(norm * Math.PI) * 3;

    if (dt < D1) {
      const f = ease(dt / D1);
      updateGatePhase(data0, cloud0, qubit.from.a.abs(), now, 1 - f);
      updateGatePhase(data1, cloud1, qubit.from.b.abs(), now, 1 - f);

    } else if (dt < D1 + D2) {
      const f = ease((dt - D1) / D2);
      const { a: a0, b: b0 } = qubit.from;
      const { a: a1, b: b1 } = qubit.to;

      qubit.alpha = a0.mul(new Complex(1 - f, 0)).add(a1.mul(new Complex(f, 0)));
      qubit.beta  = b0.mul(new Complex(1 - f, 0)).add(b1.mul(new Complex(f, 0)));

      updateDance(data0, cloud0, qubit.alpha.abs(), now);
      updateDance(data1, cloud1, qubit.beta.abs(),  now);

    } else {
      const f = ease((dt - D1 - D2) / D3);
      updateGatePhase(data0, cloud0, qubit.to.a.abs(), now, f);
      updateGatePhase(data1, cloud1, qubit.to.b.abs(), now, f);
    }

    if (dt >= total) {
      qubit.isGate       = false;
      keyLight.intensity = 0;
    }

  } else {
    updateDance(data0, cloud0, qubit.alpha.abs(), now);
    updateDance(data1, cloud1, qubit.beta.abs(),  now);
  }

  

  // 3) On oriente désormais **tout** le groupe qubitVisual
  updateQubitOrientation();





  // 4) rendu
  // 4) Rendu
  renderer1.render(scene1, camera1);
}


// ── 7) INIT & UI ──────────────────────────────────────────────────────
btnStart.addEventListener('click',()=>{
  document.getElementById('heroContent').classList.add('hidden');
  controlsPanel.setAttribute('aria-hidden','false');
  controlsPanel.classList.add('visible');

  data0  = initCloud(N);
  data1  = initCloud(N);
  cloud0 = new THREE.Points(data0.geo, mat0);
  cloud1 = new THREE.Points(data1.geo, mat1);
  qubitVisual.add(cloud0, cloud1);

  animate(performance.now());
});

tabButtons.forEach(b=>{
  b.addEventListener('click',()=>{
    tabButtons.forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.tab-content')
      .forEach(c=>c.classList.remove('active'));
    b.classList.add('active');
    document.getElementById(b.dataset.tab)
      .classList.add('active');
  });
});

// |0〉 & |1〉
stateButtons.forEach(btn=>{
  btn.addEventListener('click',()=>{
    btn.dataset.state==='0' ? qubit.zero() : qubit.one();
  });
});

// elemental gates
gateButtons.forEach(btn=>{
  btn.addEventListener('click',()=>{
    switch(btn.dataset.gate){
      case 'X': qubit.X(); break;
      case 'Y': qubit.Y(); break;
      case 'Z': qubit.Z(); break;
      case 'H': qubit.H(); break;
    }
  });
});

const rotationButtons   = document.querySelectorAll('.rotation-btn');
let selectedRotation    = 'RX';

// 2) Permet de basculer l’état "active" et mémoriser l’axe choisi
rotationButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    rotationButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedRotation = btn.dataset.gate;
    document.querySelector("#btnR").textContent = "Appliquer " + selectedRotation
  
  });
});

// 3) Mise à jour de l’affichage de l’angle au survol du slider
rAngleInput.addEventListener('input', e => {
  rAngleVal.textContent = parseFloat(e.target.value).toFixed(2);
});

// 4) Application de la rotation sur l’axe sélectionné
btnR.addEventListener('click', () => {
  const θ = parseFloat(rAngleInput.value);
  switch (selectedRotation) {
    case 'RX': qubit.RX(θ); break;
    case 'RY': qubit.RY(θ); break;
    case 'RZ': qubit.RZ(θ); break;
  }
});

// dance amplitude
danceSliderEl?.addEventListener('input', e=>{
  danceAmp = parseFloat(e.target.value);
});

// R(θ)
rAngleInput?.addEventListener('input', e=>{
  rAngleVal.textContent = parseFloat(e.target.value).toFixed(2);
});
btnR?.addEventListener('click',()=>{
  const θ = parseFloat(rAngleInput.value);
  qubit.R(θ);
});

// info panel
infoLink.addEventListener('click', e=>{
  e.preventDefault();
  const open = infoPanel.classList.toggle('visible');
  infoPanel.setAttribute('aria-hidden', open ? 'false':'true');
});
infoClose.addEventListener('click',()=>{
  infoPanel.classList.remove('visible');
  infoPanel.setAttribute('aria-hidden','true');
});

// drag to rotate
let dragging=false, sx=0, sy=0;
window.addEventListener('mousedown',e=>{
  if(e.target.closest('button'))return;
  dragging=true; sx=e.clientX; sy=e.clientY;
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;

  const dx = e.clientX - sx;
  const dy = e.clientY - sy;

  // Si Z est le haut, on tourne autour de Y (horizontal) et Z (vertical)
  pivot.rotation.y += dy * 0.005;  // rotation horizontale
  pivot.rotation.z += dx * 0.005; // rotation verticale (Z est le haut)

  sx = e.clientX;
  sy = e.clientY;
});

window.addEventListener('mouseup',()=>dragging=false);

// resize
window.addEventListener('resize',()=>{
  camera1.aspect=innerWidth/innerHeight;
  camera1.updateProjectionMatrix();
  renderer1.setSize(innerWidth,innerHeight);
});