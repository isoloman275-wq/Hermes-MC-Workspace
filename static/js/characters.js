// ============================================================================
// Mission Control v2 — Tipua (guardian Titans) + Toa (agent warriors)
// Māori atua / tipua — carved, godly, sculptural figures (NOT machines).
// Procedural geometry only. No external assets.
// Loaded BEFORE app.js; app.js relies on window.__MC_TIPUA__ keys.
// ============================================================================

import * as THREE from 'three';

// --- Titan (atua) identities: name, color, accent, silhouette kind ---
const TIPUA = {
  m1: { name: "Tāne",        color: 0xf2c14e, accent: 0xffe9a8, kind: "kauri",  blurb: "Operator host (you) — <your-model> · bearer of the sky-sigil" },
  m2: { name: "Tūmatauenga", color: 0xff4d3d, accent: 0xffb38a, kind: "war",    blurb: "War-god core — one flame at a time (single VRAM)" },
  m3: { name: "Tāwhirimātea",color: 0x4fd6ff, accent: 0xb8f0ff, kind: "wind",   blurb: "Wind-swift aux swarm" },
};

// --- Agent (profile) warrior colors ---
const TOA_COLOR = {
  architect: 0xf2c14e, coder: 0x4a9bff, builder: 0x39ff9e, devops: 0xffb000,
  researcher: 0xb478ff, reviewer: 0x2ee6c9, copywriter: 0xff7ad1,
  "ip-guard": 0xff4d4d, "data-analyst": 0x4fd6ff,
};

// Shared "god material" palette — carved stone body + glowing accent + pounamu + gold.
function makeMaterials(color, accent) {
  return {
    // main carved body — dark stone so carvings and glows read against it
    stone: new THREE.MeshStandardMaterial({ color: 0x2a2320, metalness: 0.35, roughness: 0.65 }),
    // identity color — the god's own hue, lightly glowing
    skin: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.28, metalness: 0.55, roughness: 0.45 }),
    // bright accent glow (moko inlay, eyes, sigils)
    glow: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.4 }),
    // pounamu (greenstone) — emerald carved accent
    pounamu: new THREE.MeshStandardMaterial({ color: 0x1f7a4d, emissive: 0x0f5a32, emissiveIntensity: 0.5, metalness: 0.7, roughness: 0.3 }),
    // gold — sacred highlight for hei-tiki / koru edges
    gold: new THREE.MeshStandardMaterial({ color: 0xd9b24a, emissive: 0x4a3a10, emissiveIntensity: 0.4, metalness: 0.9, roughness: 0.25 }),
  };
}

// --- carved detail helpers --------------------------------------------------

// A koru (unfurling spiral) made from a swept tube — placed on shoulders/chest.
function makeKoru(mat, scale = 1) {
  const pts = [];
  const turns = 2.2;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const ang = t * Math.PI * 2 * turns;
    const r = 0.04 + (1 - t) * 0.42 * scale; // spiral inward
    pts.push(new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r * 0.7, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 40, 0.05 * scale, 8, false);
  return new THREE.Mesh(geo, mat);
}

// A single moko (tattoo) inset line — a thin carved slab in accent color.
function makeMokoLine(mat, w, h, d = 0.04) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

// Hei-tiki style head pendant — stylised squat figure with large head & limbs.
function makeHeiTiki(mat) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.3), mat);
  head.position.y = 0.35; g.add(head);
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.32), mat);
  eyes.position.y = 0.42; g.add(eyes);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.45, 0.26), mat);
  body.position.y = -0.05; g.add(body);
  // tiki legs splayed
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.24), mat);
    leg.position.set(s * 0.18, -0.36, 0); leg.rotation.z = s * 0.5; g.add(leg);
  }
  // arms folded
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.22), mat);
    arm.position.set(s * 0.22, 0.02, 0.02); g.add(arm);
  }
  return g;
}

// Carved pedestal / base — stepped pātaka-like plinth the god stands upon.
function makePedestal(mat, ringMat, topR = 1.5) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(topR + 0.5, topR + 0.8, 0.5, 10), mat);
  base.position.y = 0.25; g.add(base);
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(topR + 0.2, topR + 0.5, 0.45, 10), mat);
  mid.position.y = 0.7; g.add(mid);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(topR + 0.15, 0.08, 8, 28), ringMat);
  lip.position.y = 0.95; lip.rotation.x = Math.PI / 2; g.add(lip);
  // glowing inlaid ring on the plinth face
  const face = new THREE.Mesh(new THREE.TorusGeometry(topR * 0.6, 0.05, 8, 28), ringMat);
  face.position.y = 0.5; face.rotation.x = Math.PI / 2; g.add(face);
  return g;
}

// God-head: broad carved skull with moko cheeks, glowing eyes, koru crown.
function makeGodHead(skin, glow, gold, scale = 1) {
  const g = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.BoxGeometry(1.4 * scale, 1.3 * scale, 1.2 * scale), skin);
  g.add(skull);
  // moko cheek ridges (curved slabs)
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.18 * scale, 0.9 * scale, 0.12 * scale), glow);
    cheek.position.set(s * 0.55 * scale, -0.1 * scale, 0.62 * scale);
    cheek.rotation.z = s * 0.25; g.add(cheek);
  }
  // forehead moko band
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.1 * scale, 0.16 * scale, 0.12 * scale), glow);
  band.position.set(0, 0.55 * scale, 0.62 * scale); g.add(band);
  // glowing eyes
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14 * scale, 10, 10), glow);
    eye.position.set(s * 0.35 * scale, 0.1 * scale, 0.62 * scale); g.add(eye);
  }
  // gold koru crown
  const crown = makeKoru(gold, 0.7 * scale);
  crown.position.set(0, 0.85 * scale, 0); crown.rotation.x = Math.PI / 2; g.add(crown);
  // gold piko (topknot) ridges
  for (const s of [-1, 1]) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.12 * scale, 0.5 * scale, 0.12 * scale), gold);
    ridge.position.set(s * 0.4 * scale, 0.75 * scale, 0); g.add(ridge);
  }
  return g;
}

// Broad carved torso with moko inset lines + pounamu/gold girdle.
function makeGodTorso(stone, skin, glow, pounamu, gold, w = 2.0, h = 2.6) {
  const g = new THREE.Group();
  // main body block (slightly tapered, carved look via beveled shoulders)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.4), skin);
  g.add(torso);
  // chest moko — vertical spiralling inset lines
  for (const x of [-0.55, -0.18, 0.18, 0.55]) {
    const line = makeMokoLine(glow, 0.08, h * 0.7);
    line.position.set(x, 0.1, 0.72); g.add(line);
  }
  // central pounamu whakairo (carved motif) diamond
  const dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), pounamu);
  dia.position.set(0, 0.2, 0.7); dia.scale.set(1, 1.6, 0.4); g.add(dia);
  // shoulder moko curls
  for (const s of [-1, 1]) {
    const curl = makeKoru(glow, 0.6);
    curl.position.set(s * (w / 2 + 0.1), h * 0.42, 0.3);
    curl.rotation.y = s * 0.6; g.add(curl);
  }
  // gold girdle at waist
  const belt = new THREE.Mesh(new THREE.TorusGeometry(w * 0.5 + 0.05, 0.1, 8, 24), gold);
  belt.position.y = -h * 0.42; belt.rotation.x = Math.PI / 2; belt.scale.set(1, 1, 0.9); g.add(belt);
  // pounamu tiki pendant hanging at chest
  const tiki = makeHeiTiki(pounamu);
  tiki.position.set(0, -h * 0.18, 0.75); tiki.scale.setScalar(0.7); g.add(tiki);
  return g;
}

// Carved arm ending in a koru spiral (unfurling) — gives the godly gesture.
function makeKoruArm(stone, skin, glow, side = 1) {
  const g = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.9, 8), skin);
  upper.position.set(side * 0.1, 0.9, 0); upper.rotation.z = -side * 0.5; g.add(upper);
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 1.7, 8), skin);
  fore.position.set(side * 0.9, 0.0, 0.1); fore.rotation.z = side * 0.6; g.add(fore);
  // koru hand spiral
  const hand = makeKoru(glow, 0.9);
  hand.position.set(side * 1.6, -0.4, 0.2); hand.rotation.set(Math.PI / 2, 0, side * 0.4); g.add(hand);
  // carved moko band on upper arm
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.06, 6, 16), glow);
  band.position.set(side * 0.1, 1.4, 0); band.rotation.y = Math.PI / 2; g.add(band);
  return g;
}

// Carved leg (broad, godly stance).
function makeGodLeg(stone, skin, glow, side = 1) {
  const g = new THREE.Group();
  const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.6, 8), skin);
  thigh.position.set(side * 0.45, 0.8, 0); g.add(thigh);
  const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.5, 8), skin);
  shin.position.set(side * 0.55, -0.4, 0.1); shin.rotation.z = -side * 0.08; g.add(shin);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 1.0), stone);
  foot.position.set(side * 0.55, -1.25, 0.25); g.add(foot);
  // moko line down shin
  const line = makeMokoLine(glow, 0.07, 1.2);
  line.position.set(side * 0.55, -0.4, 0.45); g.add(line);
  return g;
}

// Build a distinct tipua silhouette per kind — always a standing god figure
// ~5.5 units tall, grounded at y=0, head near top, on a carved pedestal.
function makeTipua(kind, color, accent) {
  const g = new THREE.Group();
  const m = makeMaterials(color, accent);

  // --- pedestal shared by all Titans ---
  const ped = makePedestal(m.stone, m.glow, 1.5);
  g.add(ped);

  // --- god legs + torso + head + arms scaffolding (shared) ---
  const figure = new THREE.Group();
  figure.position.y = 0.95; // sit on the plinth
  g.add(figure);

  if (kind === "kauri") {            // Tāne — tall kauri atua, sky-bearer
    const legs = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = makeGodLeg(m.stone, m.skin, m.glow, s);
      legs.add(leg);
    }
    legs.position.y = 0.0; figure.add(legs);

    const torso = makeGodTorso(m.stone, m.skin, m.glow, m.pounamu, m.gold, 2.0, 2.4);
    torso.position.y = 1.7; figure.add(torso);

    const head = makeGodHead(m.skin, m.glow, m.gold, 1.0);
    head.position.y = 3.4; figure.add(head);

    // koru arms raised like branches reaching sky
    for (const s of [-1, 1]) {
      const arm = makeKoruArm(m.stone, m.skin, m.glow, s);
      arm.position.set(s * 1.1, 2.6, 0); arm.rotation.z = -s * 0.5; figure.add(arm);
    }
    // extra sky-sigil koru crown ring
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.08, 8, 32), m.gold);
    halo.position.y = 3.4; halo.rotation.x = Math.PI / 2.3; figure.add(halo);

  } else if (kind === "war") {       // Tūmatauenga — war-god, taiaha, fierce moko
    const legs = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = makeGodLeg(m.stone, m.skin, m.glow, s);
      legs.add(leg);
    }
    legs.position.y = 0.0; figure.add(legs);

    const torso = makeGodTorso(m.stone, m.skin, m.glow, m.pounamu, m.gold, 2.3, 2.6);
    torso.position.y = 1.7; figure.add(torso);

    const head = makeGodHead(m.skin, m.glow, m.gold, 1.1);
    head.position.y = 3.5; figure.add(head);

    // broad shoulders + koru arms (war-ready)
    for (const s of [-1, 1]) {
      const arm = makeKoruArm(m.stone, m.skin, m.glow, s);
      arm.position.set(s * 1.25, 2.6, 0); figure.add(arm);
    }
    // taiaha (fighting staff) in right hand — red blade + gold binding
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a1a10, emissive: color, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.4 }));
    staff.position.set(2.1, 2.4, 0.4); staff.rotation.z = 0.18; figure.add(staff);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.0, 8),
      new THREE.MeshStandardMaterial({ color: 0xff4d3d, emissive: 0xff4d3d, emissiveIntensity: 0.8 }));
    blade.position.set(2.35, 4.5, 0.4); blade.rotation.z = 0.18; figure.add(blade);

  } else if (kind === "wind") {      // Tāwhirimātea — wind-swift, swirling koru forms
    // slimmer torso
    const legs = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = makeGodLeg(m.stone, m.skin, m.glow, s);
      leg.scale.setScalar(0.9); legs.add(leg);
    }
    legs.position.y = 0.0; figure.add(legs);

    const torso = makeGodTorso(m.stone, m.skin, m.glow, m.pounamu, m.gold, 1.7, 2.6);
    torso.position.y = 1.7; figure.add(torso);

    const head = makeGodHead(m.skin, m.glow, m.gold, 0.95);
    head.position.y = 3.4; figure.add(head);

    // double koru spiral arms — wind swirls
    for (const s of [-1, 1]) {
      const arm = makeKoruArm(m.stone, m.skin, m.glow, s);
      arm.position.set(s * 1.0, 2.6, 0); arm.rotation.set(0, 0, -s * 0.3); figure.add(arm);
    }
    // wind ring halo (cyan torus)
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.06, 8, 40), m.glow);
    halo.position.y = 2.4; halo.rotation.x = Math.PI / 2; figure.add(halo);
    const halo2 = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 8, 40), m.glow);
    halo2.position.y = 3.0; halo2.rotation.x = Math.PI / 2.3; figure.add(halo2);

  } else {                           // Io — cloud/violet mist (kept for export parity)
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 2),
      new THREE.MeshStandardMaterial({ color, emissive: accent, emissiveIntensity: 0.8, transparent: true, opacity: 0.55, metalness: 0.2, roughness: 0.8 }));
    orb.position.y = 3.0; g.add(orb);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 12, 48),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.4 }));
    ring.position.y = 3.0; ring.rotation.x = Math.PI / 2.4; g.add(ring);
    g.userData.cloud = orb;
  }

  return g;
}

// Override: replace generic robot with tipua when building a Titan.
// app.js calls makeProceduralRobot(color); we intercept via window hook.
window.__MC_TIPUA__ = { TIPUA, TOA_COLOR, makeTipua };

// Build a small "toa" warrior-shard for an agent orbiting its Titan.
function makeToa(profile, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.4 });
  // pickable core — children[0] (app.js sets toa.children[0].userData)
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), mat);
  g.add(core);
  // tiny hei-tiki style figure on the shard + kete (basket) ring
  const tiki = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.4 }));
  tiki.position.y = -0.45; g.add(tiki);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 6, 18),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
  ring.rotation.x = Math.PI / 2; g.add(ring);
  g.userData = { kind: "toa", profile, color, ring, core };
  return g;
}
window.__MC_TIPUA__.makeToa = makeToa;
