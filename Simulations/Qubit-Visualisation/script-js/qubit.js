// 1) Complex minimal sans changement
class Complex {
  constructor(re = 0, im = 0) {
    this.re = re;
    this.im = im;
  }
  add(o)   { return new Complex(this.re + o.re, this.im + o.im); }
  sub(o)   { return new Complex(this.re - o.re, this.im - o.im); }
  mul(o)   {
    return new Complex(
      this.re*o.re - this.im*o.im,
      this.re*o.im + this.im*o.re
    );
  }
  scale(s)    { return new Complex(this.re*s,   this.im*s); }
  abs2()      { return this.re*this.re + this.im*this.im; }
  abs()       { return Math.sqrt(this.abs2()); }
  divScalar(s){ return new Complex(this.re/s,     this.im/s); }
}


// 2) Qubit sans normalisation automatique
class Qubit {
  constructor() {
    // état initial |0〉 = (1 + 0i, 0 + 0i)
    this.alpha     = new Complex(1,0);
    this.beta      = new Complex(0,0);

    // flags pour votre animation
    this.isGate    = false;
    this.gateStart = 0;
    this.from      = { a: this.alpha, b: this.beta };
    this.to        = { a: this.alpha, b: this.beta };
  }

  // multiplication 2×2 U × (α,β)
  applyMatrix(U) {
    if (this.isGate) return;
    const newA = U[0][0].mul(this.alpha).add(U[0][1].mul(this.beta));
    const newB = U[1][0].mul(this.alpha).add(U[1][1].mul(this.beta));

    // on prépare l’animation entre from→to
    this.from      = { a: this.alpha, b: this.beta };
    this.to        = { a: newA,       b: newB };
    this.gateStart = performance.now();
    this.isGate    = true;
    console.log(this.alpha,this.beta)
    spawnWave();    // reste votre fonction d’onde
  }

  // passe explicitement en |0〉
  zero() {
    if (this.isGate) return;
    this.from      = { a: this.alpha, b: this.beta };
    this.to        = { a: new Complex(1,0), b: new Complex(0,0) };
    this.gateStart = performance.now();
    this.isGate    = true;
    console.log(this.alpha,this.beta)
    spawnWave();
  }

  // passe explicitement en |1〉
  one() {
    if (this.isGate) return;
    this.from      = { a: this.alpha, b: this.beta };
    this.to        = { a: new Complex(0,0), b: new Complex(1,0) };
    this.gateStart = performance.now();
    this.isGate    = true;
    console.log(this.alpha,this.beta)

    spawnWave();
  }

  // Portes élémentaires
  X() { this.applyMatrix(Qubit.PauliX); }
  Y() { this.applyMatrix(Qubit.PauliY); }
  Z() { this.applyMatrix(Qubit.PauliZ); }
  H() { this.applyMatrix(Qubit.Hadamard); }

  // Rotation Rx(θ) (exacte)
  R(theta) {
    // Rx(θ) = exp(-i θ X/2) = [[cos(θ/2), -i sin(θ/2)],[-i sin(θ/2), cos(θ/2)]]
    const c = Math.cos(theta/2), s = Math.sin(theta/2);
    const Rx = [
      [ new Complex( c, 0), new Complex(0, -s) ],
      [ new Complex(0, -s), new Complex( c, 0) ]
    ];
    this.applyMatrix(Rx);
  }

  RX(theta) {
    const c = Math.cos(theta/2), s = Math.sin(theta/2);
    const Rx = [
      [ new Complex(c, 0), new Complex(0, -s) ],
      [ new Complex(0, -s), new Complex(c, 0) ]
    ];
    this.applyMatrix(Rx);
  }

  RY(theta) {
    const c = Math.cos(theta/2), s = Math.sin(theta/2);
    // exp(-i θ Y/2) = cos(θ/2)·I - i sin(θ/2)·Y = [[c, -s], [s, c]]
    const Ry = [
      [ new Complex(c, 0), new Complex(-s, 0) ],
      [ new Complex(s, 0), new Complex(c, 0) ]
    ];
    this.applyMatrix(Ry);
  }

  RZ(theta) {
    const half = theta/2;
    // exp(-i θ Z/2) = diag(e^{-iθ/2}, e^{+iθ/2})
    const eMinus = new Complex(Math.cos(-half), Math.sin(-half));
    const ePlus  = new Complex(Math.cos( half), Math.sin( half));
    const Rz = [
      [ eMinus,           new Complex(0, 0) ],
      [ new Complex(0, 0), ePlus           ]
    ];
    this.applyMatrix(Rz);
  }

  getBlochAngles() {
    // 1) Normalisation temporaire
    const norm2 = this.alpha.abs2() + this.beta.abs2();
    const inv   = 1 / Math.sqrt(norm2);
    const a     = this.alpha.divScalar(1 / inv);  // a = α / ||ψ||
    const b     = this.beta.divScalar(1 / inv);   // b = β / ||ψ||

    // 2) Extraire la phase globale δ = arg(a)
    const delta = Math.atan2(a.im, a.re);

    // 3) Déphaser : multiplier par e^{-iδ}
    const eMinusDelta = new Complex(Math.cos(-delta), Math.sin(-delta));
    const a0 = a.mul(eMinusDelta);  // devrait être réel positif = cos(θ/2)
    const b0 = b.mul(eMinusDelta);

    // 4) Calculer θ et φ
    const theta = 2 * Math.acos(a0.abs());             // [0, π]
    const phi   = Math.atan2(b0.im, b0.re);            // [−π, π]

    return { globalPhase: delta, theta, phi };
  }
}

// 3) Définition statique des matrices
Qubit.PauliX   = [
  [ new Complex(0,0), new Complex(1,0) ],
  [ new Complex(1,0), new Complex(0,0) ]
];
Qubit.PauliY   = [
  [ new Complex(0,0), new Complex(0,-1) ],
  [ new Complex(0,1), new Complex(0, 0) ]
];
Qubit.PauliZ   = [
  [ new Complex(1,0), new Complex(0,0) ],
  [ new Complex(0,0), new Complex(-1,0) ]
];
Qubit.Hadamard = [
  [ new Complex( 1/Math.SQRT2, 0), new Complex( 1/Math.SQRT2, 0) ],
  [ new Complex( 1/Math.SQRT2, 0), new Complex(-1/Math.SQRT2, 0) ]
];
