import * as THREE from 'three';
import { setToaState, tickToa, stateForTaskStatus } from './behaviors.js';
import { mountApprovalPanel, refreshApprovals } from './approvals.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x05070d, 0.010);

const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 1000);
camera.position.set(0, 16, 38);

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 95;
controls.minDistance = 6;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.5;

// lights
scene.add(new THREE.AmbientLight(0x4060a0, 0.55));
const key = new THREE.DirectionalLight(0x9fd0ff, 1.15); key.position.set(20,40,20);
key.castShadow = true;
key.shadow.mapSize.set(2048,2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 140;
key.shadow.camera.left = -70; key.shadow.camera.right = 70;
key.shadow.camera.top = 70; key.shadow.camera.bottom = -70;
key.shadow.bias = -0.0004;
scene.add(key);
const rim = new THREE.PointLight(0x4488ff, 0.8, 200); rim.position.set(-30,10,-20); scene.add(rim);
// warm pendant hanging over the floor (workshop feel)
const pendant = new THREE.PointLight(0xffd9a0, 0.9, 120, 1.6); pendant.position.set(0, 26, 0); scene.add(pendant);
const pendantBulb = new THREE.Mesh(new THREE.SphereGeometry(0.7,16,16),
  new THREE.MeshBasicMaterial({color:0xffe2b0})); pendantBulb.position.copy(pendant.position); scene.add(pendantBulb);
const pendantCord = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,12,6),
  new THREE.MeshBasicMaterial({color:0x223})); pendantCord.position.set(0,32,0); scene.add(pendantCord);

// starfield
(function stars(){
  const g = new THREE.BufferGeometry();
  const n = 1400, pos = new Float32Array(n*3);
  for(let i=0;i<n*3;i++) pos[i] = (Math.random()-0.5)*400;
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({color:0x335577,size:0.6})));
})();

// drifting nebula (ambient layer)
(function nebula(){
  const g = new THREE.BufferGeometry();
  const n = 60, pos = new Float32Array(n*3);
  for(let i=0;i<n;i++){
    pos[i*3]   = (Math.random()-0.5)*160;
    pos[i*3+1] = Math.random()*30+2;
    pos[i*3+2] = (Math.random()-0.5)*160;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const m = new THREE.PointsMaterial({color:0x3a2f6a, size:4, transparent:true, opacity:.12,
    blending:THREE.AdditiveBlending, depthWrite:false});
  const pts = new THREE.Points(g, m); pts.userData.nebula = true; scene.add(pts);
  scene.userData.nebula = pts;
})();

// ---------- scene ----------
scene.fog = new THREE.FogExp2(0x05070f, 0.012);
// ---------- state ----------
let STATE = { booting:true, machines:[], daemons:[], tasks:[], drones:[], economy:[], errors:[] };
let moon = null;
const pickables = [];
const entityById = {};
let robots = {};
let titans = {};
let economyMills = {};

// Profile -> host machine. MUST match the live /api/profiles assignment
// (verified 2026-07-20). architect runs on m2/<your-large-model>, not <brain>.
const PROFILE_MACHINE = {
  architect:'m2', coder:'m2', researcher:'m2', reviewer:'m2',
  builder:'m1', 'data-analyst':'m1',
  copywriter:'m3', devops:'m3', 'ip-guard':'m3'
};
// human-readable display names for the profile shards / popups
const PROFILE_NAME = {
  architect:'Architect', coder:'Coder', researcher:'Researcher', reviewer:'Reviewer',
  builder:'Builder', 'data-analyst':'Data Analyst',
  copywriter:'Copywriter', devops:'DevOps', 'ip-guard':'IP Guard'
};
const STATUS_COLOR = {
  ready:0x3a6fff, running:0x39ff9e, done:0xbfbfbf, crashed:0xff4d4d, blocked:0xffaa33
};
const TITAN_POS = { m1:[-16,0,-6], m2:[16,0,-6], m3:[0,0,18] };

// view toggles
const VIEW = { filter:'all' };

// ---------- titan builder ----------
function buildTitan(m, x, z){
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.userData.machineId = m.id;   // used by the Titan double-click -> create-profile
  // radial outward unit (from fire at centre to this Titan) + yaw to face the fire
  const outward = new THREE.Vector3(x, 0, z).normalize();
  const yaw = Math.atan2(-x, -z);

  // role label above each Titan
  const ROLE_LABEL = { m1:'Primary Node', m2:'LLM Server', m3:'Worker Node' };
  const label = makeLabel(ROLE_LABEL[m.id] || m.name || m.id, m.cloud?0xc9a6ff:0x9fe0ff);
  label.position.set(0, 8.4, 0); grp.add(label);

  grp.userData.daemonAnchor = new THREE.Group(); grp.userData.daemonAnchor.position.y = 11.0; grp.add(grp.userData.daemonAnchor);

  // --- desk + glowing screen (BIGGER), placed between Titan and the fire ---
  const bench = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 3.6),
    new THREE.MeshStandardMaterial({ color:0x2a3a4f, metalness:0.3, roughness:0.6 }));
  top.position.y = 1.8; top.castShadow = true; top.receiveShadow = true; bench.add(top);
  for(const sx of [-3,3]) for(const sz of [-1.4,1.4]){
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35,1.8,0.35),
      new THREE.MeshStandardMaterial({ color:0x18222e }));
    leg.position.set(sx,0.9,sz); leg.castShadow = true; bench.add(leg);
  }
  const mc = (m.id==='m1')?0xf2c14e : (m.id==='m2')?0xff4d3d : 0x4fd6ff;
  const rig = new THREE.Mesh(new THREE.BoxGeometry(3.0,2.0,0.28),
    new THREE.MeshStandardMaterial({ color:0x081018, emissive:mc, emissiveIntensity:0.9, metalness:0.4, roughness:0.3 }));
  rig.position.set(0, 3.0, 0.25); rig.castShadow = true; bench.add(rig);
  grp.userData.screen = rig; // assignment/selection flare targets this
  rig.userData.baseEmissive = 0.9;
  bench.position.copy(outward.clone().multiplyScalar(-6.5)); // toward the fire
  bench.rotation.y = yaw;
  grp.add(bench);
  grp.userData.bench = bench;

  // tipua guardian (Māori/Pacific-inspired) instead of generic robot
  const tip = window.__MC_TIPUA__;
  const tipuaDef = (tip && tip.TIPUA[m.id]) || { name: m.id, color: m.cloud?0x9a6bff:0x4aa3ff, accent: m.cloud?0xc9a6ff:0x9fe0ff, kind: m.cloud?'cloud':'war' };
  let robot;
  if(tip){
    robot = tip.makeTipua(tipuaDef.kind, tipuaDef.color, tipuaDef.accent);
  } else {
    robot = makeProceduralRobot(m.cloud?0x9a6bff:0x4aa3ff);
    if(!buildTitan._retried){ buildTitan._retried = true; setTimeout(()=>{ try{ rebuildWorld(); }catch(e){} }, 80); }
  }
  robot.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  // stand BEHIND the desk (outer side), facing the fire / screen
  robot.position.copy(outward.clone().multiplyScalar(4.8));
  robot.rotation.y = yaw;
  grp.add(robot);
  grp.userData.robot = robot;
  grp.userData.tipua = tipuaDef;

  // soft contact shadow disc, placed UNDER the Titan (behind the desk) to ground it
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 40),
    new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity:0.34, depthWrite:false }));
  contact.rotation.x = -Math.PI/2; contact.position.copy(outward.clone().multiplyScalar(4.8)); contact.position.y = 0.04; grp.add(contact);
  grp.userData.contact = contact;

  const hb = new THREE.Mesh(new THREE.CylinderGeometry(5,5,8,8),
    new THREE.MeshBasicMaterial({transparent:true, opacity:0, depthWrite:false}));
  hb.position.y = 3; hb.userData.entity = {kind:'machine', id:m.id, name:m.name};
  grp.add(hb); // NOT in pickables: the invisible body sits in front of orbiting shards and would steal their clicks

  return grp;
}

function makeProceduralRobot(color){
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({color, metalness:.6, roughness:.4});
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6,2.2,1), mat); torso.position.y=2.4; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mat); head.position.y=3.9; g.add(head);
  for(const s of [-1,1]){
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5,2,0.5), mat);
    arm.position.set(s*1.1, 2.4, 0); g.add(arm);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6,2,0.6), mat);
    leg.position.set(s*0.5, 0.9, 0); g.add(leg);
  }
  return g;
}

const loader = new GLTFLoader();
loader.load('/RobotExpressive.glb', (gltf)=>{
  const model = gltf.scene;
  model.scale.set(1.6,1.6,1.6);
  for(const id in robots){
    const r = robots[id];
    if(r.userData.robot) r.remove(r.userData.robot);
    const m = model.clone(); m.position.y = 1.0; r.add(m); r.userData.robot = m;
  }
}, undefined, ()=>{ /* procedural fallback */ });

// ---------- in-scene info popup (baked into 3D world) ----------
let infoSpr = null;
function drawTextFit(ctx, text, cx, cy, maxW, basePx, color, weight){
  let px = basePx;
  do { ctx.font = (weight||'bold')+' '+px+'px ui-monospace, monospace'; px--; }
  while(ctx.measureText(text).width > maxW && px > 8);
  ctx.fillStyle = color; ctx.fillText(text, cx, cy);
}
function makeInfoSprite(text, sub, color, small){
  const hex = '#'+color.toString(16).padStart(6,'0');
  // wrap the sub note into lines that fit the canvas width
  const maxW = 484;
  const subLines = [];
  if(sub){
    const words = sub.split(' '); let line = '';
    for(const w of words){
      const test = line ? line+' '+w : w;
      if(test.length > 34 && line){ subLines.push(line); line = w; }
      else line = test;
    }
    if(line) subLines.push(line);
  }
  const c = document.createElement('canvas'); c.width = 512; c.height = subLines.length ? 80 + subLines.length*32 : (small?60:80);
  const x = c.getContext('2d');
  x.textAlign='center'; x.textBaseline='middle';
  drawTextFit(x, text, 256, small?36:(subLines.length?44:48), 484, small?32:46, hex, 'bold');
  subLines.forEach((ln,i)=> drawTextFit(x, ln, 256, 60 + i*26, 484, 22, '#ffd24d', 'normal'));
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false}));
  const h = c.height/100;
  spr.scale.set(small?8:16, small?2.2:h*1.2, 1); spr.renderOrder = 999;
  return spr;
}
let infoHideT = null;
function showInfo(ent, persist, worldPos){
  if(!ent) return;
  const isToa = ent.kind==='toa' || ent.kind==='profile';
  const isTask = ent.kind==='task';
  const m = (ent.kind==='machine') ? (STATE.machines.find(x=>x.id===ent.id)||{}) : {};
  const name = ent.name || ent.title || (m.name||'');
  const note = (ent.kind==='machine') ? (m.note||'')
             : (isTask ? ('status: '+(ent.status||'?')+'   ·   @'+(ent.assignee||'?')) : '');
  const color = isToa ? (ent.color || 0x9fe0ff)
             : (isTask ? (STATUS_COLOR[ent.status] || 0xbfe6ff) : (m.cloud?0xc9a6ff:0x9fe0ff));
  if(!infoSpr){ infoSpr = makeInfoSprite(name, note, color, isToa); scene.add(infoSpr); }
  else {
    const ns = makeInfoSprite(name, note, color, isToa);
    infoSpr.material.map.dispose();
    infoSpr.material.map = ns.material.map; infoSpr.material.needsUpdate = true;
    infoSpr.scale.copy(ns.scale);
  }
  // position: explicit world pos (shards) > Titan anchor > origin
  if(worldPos){ infoSpr.position.set(worldPos.x, worldPos.y + 1.6, worldPos.z); }
  else {
    const anchor = (ent.kind==='machine' && titans[ent.id]) ? titans[ent.id] : null;
    if(anchor){ infoSpr.position.set(anchor.position.x, 9.2, anchor.position.z); }
  }
  infoSpr.visible = true;
  clearTimeout(infoHideT);
  infoHideT = setTimeout(()=>{ if(infoSpr) infoSpr.visible = false; }, persist?4000:1500);
}
function hideInfo(){ if(infoSpr) infoSpr.visible = false; clearTimeout(infoHideT); }

function makeLabel(text, color, sub){
  const hex = '#'+color.toString(16).padStart(6,'0');
  const c = document.createElement('canvas'); c.width=512; c.height= sub? 128 : 80;
  const x = c.getContext('2d');
  // fully transparent — floating text only, no box
  x.textAlign='center'; x.textBaseline='middle';
  drawTextFit(x, text, 256, sub?40:40, 480, 34, hex, 'bold');
  if(sub){
    drawTextFit(x, sub, 256, 92, 480, 20, '#ffd24d', 'normal');
  }
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true}));
  spr.scale.set(sub?12:11, sub?2.6:1.7, 1); return spr;
}

// ---------- daemon core ----------
function buildDaemon(d, anchor, idx, total){
  const ang = (idx/total)*Math.PI*2;
  const rad = 3.2;
  const yBase = d.loaded ? 2.2 : 0.6; // active brain sits slightly higher in its orbit
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 1),
    new THREE.MeshStandardMaterial({color: d.loaded?0xffd24d:0x445, emissive: d.loaded?0xffb000:0x111, emissiveIntensity: d.loaded?1.4:0.2}));
  core.position.set(Math.cos(ang)*rad, yBase + Math.sin(ang*1.3)*1.3, Math.sin(ang)*rad);
  core.userData.entity = {kind:'daemon', id:d.id, name:d.name, loaded:d.loaded, ctx:d.ctx_cap};
  anchor.add(core); pickables.push(core);
  // floating LLM-name label above the planet (like the profile-orb + titan labels)
  const dlab = makeLabel(d.name || 'LLM', 0x9fffd0, d.loaded ? 'loaded' : 'idle');
  dlab.position.set(core.position.x, core.position.y + 1.15, core.position.z);
  anchor.add(dlab);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.9,1.05,24),
    new THREE.MeshBasicMaterial({color: d.loaded?0xffd24d:0x334, transparent:true, opacity:.5, side:THREE.DoubleSide}));
  halo.position.copy(core.position); core.userData.halo = halo; anchor.add(halo);
  return core;
}

// ---------- task shard ----------
const shardById = {};
function buildTaskShard(t, anchor, idx, total){
  if(shardById[t.id]) return shardById[t.id];
  const color = STATUS_COLOR[t.status] || 0x3a6fff;
  const geo = new THREE.OctahedronGeometry(0.55, 0);
  const mat = new THREE.MeshStandardMaterial({color, emissive:color, emissiveIntensity:.7, metalness:.3, roughness:.4});
  const shard = new THREE.Mesh(geo, mat);
  const ang = (idx/total)*Math.PI*2;
  shard.userData = { kind:'task', id:t.id, title:t.title, assignee:t.assignee, status:t.status,
                     ang, rad:2.4, spin:Math.random()*0.04+0.01 };
  shard.position.set(Math.cos(ang)*2.4, 3 + Math.sin(ang*2)*0.3, Math.sin(ang)*2.4);
  anchor.add(shard); pickables.push(shard);
  shardById[t.id] = shard;
  return shard;
}

// ---------- world layout ----------
const world = new THREE.Group(); scene.add(world);

// tukutuku lattice side frames (procedural Māori/Pacific weave panels)
// ============ PĀ SITE (Māori fortified village) ============
// Palisade posts, carved gateway, earthwork bank — old-school pā vibe, not a tukutuku room.
function buildPa(){
  const grp = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color:0x3a2a18, metalness:0.1, roughness:0.9 });
  const gold = new THREE.MeshStandardMaterial({ color:0xf2c14e, emissive:0xf2c14e, emissiveIntensity:0.45, metalness:0.6, roughness:0.4 });
  const red = new THREE.MeshStandardMaterial({ color:0x8a1a10, emissive:0xff4d3d, emissiveIntensity:0.4, metalness:0.3, roughness:0.6 });
  const R = 56, POSTS = 60;
  // ring of palisade posts (pointed tops) around the site
  for(let i=0;i<POSTS;i++){
    const a = (i/POSTS)*Math.PI*2;
    const x = Math.cos(a)*R, z = Math.sin(a)*R;
    const h = 6 + (i%3)*1.2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.7,h,7), postMat);
    post.position.set(x, h/2, z); post.castShadow = true; post.receiveShadow = true;
    grp.add(post);
    // carved top knot (gold)
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.6,8,8), gold);
    knot.position.set(x, h+0.3, z); grp.add(knot);
  }
  // carved gateway (two big posts + lintel) at the front (towards +z camera approach)
  for(const sx of [-5,5]){
    const gp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.4), postMat);
    gp.position.set(sx, 5, R-2); gp.castShadow = true; grp.add(gp);
    const tp = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.2, 7), red);
    tp.position.set(sx, 11, R-2); grp.add(tp);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(13, 1.6, 1.6), postMat);
  lintel.position.set(0, 10.5, R-2); lintel.castShadow = true; grp.add(lintel);
  // koru carving on lintel
  const koru = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.35, 8, 20, Math.PI*1.4), gold);
  koru.position.set(0, 11.6, R-1); koru.rotation.x = Math.PI/2; grp.add(koru);
  // earthwork bank (low torus ring) at the base of the palisade
  const bank = new THREE.Mesh(new THREE.TorusGeometry(R-1.5, 1.4, 8, 64),
    new THREE.MeshStandardMaterial({ color:0x223018, roughness:1 }));
  bank.rotation.x = Math.PI/2; bank.position.y = 0.4; bank.receiveShadow = true; grp.add(bank);
  return grp;
}
world.add(buildPa());

// ============ CENTRAL BONFIRE ============
// Huge fire at the centre of the pā. Starts small/floundering; grows with
// economy activity + running workers (our growing influence/power).
let bonfire = null;
function buildBonfire(){
  const grp = new THREE.Group();
  // stone ring hearth
  const hearth = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.5, 8, 32),
    new THREE.MeshStandardMaterial({ color:0x2a2218, roughness:1 }));
  hearth.rotation.x = Math.PI/2; hearth.position.y = 0.3; grp.add(hearth);
  // logs
  for(let i=0;i<5;i++){
    const a = (i/5)*Math.PI*2;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,3,6),
      new THREE.MeshStandardMaterial({ color:0x3a2410, roughness:1 }));
    log.position.set(Math.cos(a)*1.2, 0.6, Math.sin(a)*1.2); log.rotation.z = Math.PI/2;
    log.rotation.y = a; grp.add(log);
  }
  // flame core (emissive, scaled by activity)
  const flame = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 16, 1, true),
    new THREE.MeshBasicMaterial({ color:0xff7b1a, transparent:true, opacity:0.85, side:THREE.DoubleSide, blending:THREE.AdditiveBlending }));
  flame.position.y = 3.2; grp.add(flame); grp.userData.flame = flame;
  const innerFlame = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4, 12, 1, true),
    new THREE.MeshBasicMaterial({ color:0xffd24d, transparent:true, opacity:0.9, side:THREE.DoubleSide, blending:THREE.AdditiveBlending }));
  innerFlame.position.y = 2.4; grp.add(innerFlame); grp.userData.innerFlame = innerFlame;
  // point light from the fire
  const fireLight = new THREE.PointLight(0xff8430, 2.2, 90, 1.5);
  fireLight.position.y = 3; grp.add(fireLight); grp.userData.fireLight = fireLight;
  // ember particles
  const N = 60, pos = new Float32Array(N*3);
  for(let i=0;i<N;i++){ pos[i*3+1] = Math.random()*8; }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ color:0xffb24d, size:0.25, transparent:true, opacity:0.9, blending:THREE.AdditiveBlending, depthWrite:false }));
  grp.add(embers); grp.userData.embers = eg; grp.userData.emberBase = pos.slice();
  grp.userData.level = 0.06;        // current flame size (lerps toward levelTarget in updateBonfire)
  grp.userData.levelTarget = 0.06;  // 0..1 activity — grows with streams + running work
  scene.add(grp);
  bonfire = grp;
}
buildBonfire();

function updateBonfire(dt, t){
  if(!bonfire) return;
  const ud = bonfire.userData;
  // smoothly grow/shrink toward the activity target so the fire visibly breathes & surges
  const tgt = (ud.levelTarget != null) ? ud.levelTarget : 0.06;
  ud.level += (tgt - ud.level) * Math.min(1, dt*0.7);
  const lvl = ud.level;
  const flame = ud.flame, inner = ud.innerFlame, fl = ud.fireLight;
  const flick = 1 + Math.sin(t*9)*0.08 + Math.sin(t*13+1)*0.05 + Math.sin(t*23)*0.03;
  const breathe = Math.sin(t*0.9)*0.10;              // slow, obvious alive-breathing
  const scale = (0.3 + lvl*3.2 + breathe) * flick;   // bigger base flame + stronger response to activity
  flame.scale.set(scale, scale*(0.9+0.2*flick), scale);
  inner.scale.set(scale*0.9, scale*0.95, scale*0.9);
  flame.material.opacity = 0.3 + Math.min(0.6, lvl*0.6);
  fl.intensity = 0.8 + lvl*7.0 + breathe*3;          // light swells with the breath too
  // embers rise faster with activity
  const pos = ud.embers.attributes.position.array, base = ud.emberBase;
  for(let i=0;i<pos.length/3;i++){
    pos[i*3+1] += dt*(1.5 + lvl*4);
    if(pos[i*3+1] > 9){ pos[i*3+1] = 0.4; pos[i*3] = (Math.random()-0.5)*3; pos[i*3+2] = (Math.random()-0.5)*3; }
    pos[i*3] = base[i*3] + Math.sin(t+i)*0.4;
  }
  ud.embers.attributes.position.needsUpdate = true;
}

// ============ WORKSHOP ENVIRONMENT ============
// A 3D animated version of our workshop: circular polished floor, tukutuku-walled
// back room, pendant-lit, with per-machine workbenches + scattered props. Titans
// stand ON the floor and cast shadows so the scene reads as a room, not a void.
function buildWorkshop(){
  const grp = new THREE.Group();

  // --- circular polished floor slab (receives shadows) ---
  const floorMat = new THREE.MeshStandardMaterial({ color:0x0c1726, metalness:0.45, roughness:0.55 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(58, 72), floorMat);
  floor.rotation.x = -Math.PI/2; floor.position.y = 0; floor.receiveShadow = true;
  grp.add(floor);
  // inlaid glowing ring (workshop "stage")
  const stage = new THREE.Mesh(new THREE.RingGeometry(46, 47.4, 72),
    new THREE.MeshBasicMaterial({ color:0x3fa9ff, transparent:true, opacity:0.35, side:THREE.DoubleSide }));
  stage.rotation.x = -Math.PI/2; stage.position.y = 0.02; grp.add(stage);
  grp.userData.stage = stage;
  // radial floor inlay lines
  for(let i=0;i<12;i++){
    const a = (i/12)*Math.PI*2;
    const line = new THREE.Mesh(new THREE.BoxGeometry(46,0.04,0.12),
      new THREE.MeshBasicMaterial({color:0x123048, transparent:true, opacity:0.5}));
    line.position.set(Math.cos(a)*23, 0.03, Math.sin(a)*23);
    line.rotation.y = -a; grp.add(line);
  }

  // --- tukutuku-walled back room (3/4 enclosure behind the stage) ---
  const wallMat = new THREE.MeshStandardMaterial({ color:0x122033, metalness:0.2, roughness:0.85 });
  const goldMat = new THREE.MeshStandardMaterial({ color:0xf2c14e, emissive:0xf2c14e, emissiveIntensity:0.45, metalness:0.6, roughness:0.4 });
  const R = 56;
  for(let i=0;i<10;i++){
    const a = Math.PI*0.62 + (i/9)*Math.PI*0.76; // arc behind
    const wx = Math.cos(a)*R, wz = Math.sin(a)*R;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(13, 18, 1.2), wallMat);
    wall.position.set(wx, 9, wz); wall.rotation.y = -a + Math.PI/2;
    wall.receiveShadow = true; grp.add(wall);
    // tukutuku cross-hatch panels on the wall face
    for(let r=0;r<3;r++) for(let c=0;c<4;c++){
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4,2.4,0.3),
        new THREE.MeshStandardMaterial({ color:0x1a3a2a, emissive:0x0a2018, emissiveIntensity:0.4, roughness:0.8 }));
      const off = ((r+c)%2)? 0.25 : -0.25;
      panel.position.set(wx + Math.cos(-a+Math.PI/2)*off, 4 + r*4, wz + Math.sin(-a+Math.PI/2)*off);
      panel.rotation.y = -a + Math.PI/2; grp.add(panel);
      const dia = new THREE.Mesh(new THREE.BoxGeometry(0.18,3.2,0.18), goldMat);
      dia.position.copy(panel.position); dia.rotation.y = -a + Math.PI/2 + Math.PI/4; grp.add(dia);
    }
  }
  // back glowing lintel beam
  const beam = new THREE.Mesh(new THREE.TorusGeometry(R-1, 0.6, 8, 48, Math.PI*0.9), goldMat);
  beam.position.y = 18; beam.rotation.z = Math.PI*0.05; grp.add(beam);

  // --- scattered workshop props (crates, cable reels, tool rack) ---
  const crateMat = new THREE.MeshStandardMaterial({ color:0x3a2c1a, metalness:0.1, roughness:0.9 });
  const propPositions = [[-30,0,20],[34,0,14],[-38,0,-18],[28,0,-30],[12,0,40],[-14,0,42]];
  propPositions.forEach(([px,,pz], i)=>{
    const s = 2 + (i%3)*0.6;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s,s,s), crateMat);
    crate.position.set(px, s/2, pz); crate.rotation.y = (i*1.3); crate.castShadow = true; crate.receiveShadow = true;
    grp.add(crate);
    // gold corner bindings
    const bind = new THREE.Mesh(new THREE.BoxGeometry(s*1.02,0.18,0.18), goldMat);
    bind.position.set(px, s*0.92, pz); grp.add(bind);
  });
  // cable reels near the back
  for(let i=0;i<3;i++){
    const reel = new THREE.Mesh(new THREE.TorusGeometry(1.6,0.5,8,20),
      new THREE.MeshStandardMaterial({ color:0x223a2a, metalness:0.3, roughness:0.7 }));
    reel.position.set(-40 + i*6, 1.6, -42); reel.rotation.x = Math.PI/2; reel.castShadow = true; grp.add(reel);
  }

  return grp;
}

// ---------- environment: grass / dirt ground + scattered detail ----------
function buildEnvironment(){
  const grp = new THREE.Group();
  const groundMat = new THREE.MeshStandardMaterial({ color:0x2f4a26, roughness:0.95, metalness:0.0 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(150, 80), groundMat);
  ground.rotation.x = -Math.PI/2; ground.position.y = -0.06; ground.receiveShadow = true;
  grp.add(ground);
  const dirtMat = new THREE.MeshStandardMaterial({ color:0x4a3a22, roughness:1.0, metalness:0.0 });
  const dirt = new THREE.Mesh(new THREE.RingGeometry(56, 78, 80), dirtMat);
  dirt.rotation.x = -Math.PI/2; dirt.position.y = -0.04; dirt.receiveShadow = true;
  grp.add(dirt);
  // instanced grass tufts outside the stage
  const tuftGeo = new THREE.ConeGeometry(0.18, 1.1, 4); tuftGeo.translate(0, 0.55, 0);
  const tuftMat = new THREE.MeshStandardMaterial({ color:0x3f6b2e, roughness:1.0 });
  const TUFTS = 220; const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, TUFTS);
  const dummy = new THREE.Object3D(); let placed = 0;
  while(placed < TUFTS){
    const a = Math.random()*Math.PI*2, r = 62 + Math.random()*78;
    if(r > 146) continue;
    dummy.position.set(Math.cos(a)*r, 0, Math.sin(a)*r);
    dummy.rotation.y = Math.random()*Math.PI;
    const s = 0.6 + Math.random()*0.9;
    dummy.scale.set(s, s*(0.8+Math.random()*0.6), s);
    dummy.updateMatrix(); tufts.setMatrixAt(placed, dummy.matrix); placed++;
  }
  tufts.instanceMatrix.needsUpdate = true; tufts.receiveShadow = true; grp.add(tufts);
  const rockMat = new THREE.MeshStandardMaterial({ color:0x5b5b5b, roughness:0.9 });
  for(let i=0;i<14;i++){
    const a = Math.random()*Math.PI*2, r = 64 + Math.random()*68, s = 0.5 + Math.random()*1.4;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
    rock.position.set(Math.cos(a)*r, s*0.4, Math.sin(a)*r);
    rock.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    rock.castShadow = true; rock.receiveShadow = true; grp.add(rock);
  }
  return grp;
}

// ---------- memory moon: grows as the holographic memory (fact count) grows ----------
function memoryMoonScale(n){
  const frac = Math.min(n || 0, 140) / 140;   // ~140 facts = "full" moon
  return 0.6 + frac * 2.0;                     // 0.6x (empty) -> 2.6x (full)
}
function buildMoon(){
  const grp = new THREE.Group();
  grp.position.set(0, 52, -32);
  const R = 6;
  const mat = new THREE.MeshStandardMaterial({ color:0xdfe7ff, emissive:0x9fb4ff, emissiveIntensity:0.9, roughness:0.9, metalness:0.0, fog:false });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 48), mat);
  grp.add(sphere);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(R*1.3, 32, 32),
    new THREE.MeshBasicMaterial({ color:0x9fb4ff, transparent:true, opacity:0.12, side:THREE.BackSide, fog:false }));
  grp.add(halo);
  const maria = new THREE.MeshStandardMaterial({ color:0x8a93b8, roughness:1.0, fog:false });
  for(let i=0;i<5;i++){
    const m = new THREE.Mesh(new THREE.CircleGeometry(R*0.26, 24), maria);
    const a = Math.random()*Math.PI*2, b = (Math.random()-0.5)*1.2;
    m.position.set(Math.sin(b)*Math.cos(a)*R*0.82, Math.sin(b)*R*0.82, Math.cos(b)*Math.cos(a)*R*0.82);
    m.lookAt(m.position.clone().multiplyScalar(2)); sphere.add(m);
  }
  grp.userData.sphere = sphere;
  grp.userData.level = 1.0; grp.userData.moonTarget = 1.0;
  grp.add(new THREE.PointLight(0x8aa0ff, 0.35, 280));
  return grp;
}
function updateMoon(dt, t){
  if(!moon) return;
  const ud = moon.userData;
  ud.level += (ud.moonTarget - ud.level) * Math.min(1, dt*0.5);
  moon.scale.setScalar(ud.level);
  if(ud.sphere) ud.sphere.rotation.y += dt * 0.03;
  moon.position.y = 52 + Math.sin(t*0.25)*1.2;
}

world.add(buildWorkshop());
world.add(buildEnvironment());
moon = buildMoon(); scene.add(moon);
// keep a handle for animation
const workshop = world.children[world.children.length-1];

function rebuildWorld(){
  Object.values(titans).forEach(t=>world.remove(t));
  pickables.length = 0; for(const k in entityById) delete entityById[k];
  for(const k in shardById) delete shardById[k];
  titans = {};

  STATE.machines.forEach(m=>{
    if(m.titan === false) return; // non-titan entries skipped
    const [x,y,z] = TITAN_POS[m.id] || [0,0,0];
    const t = buildTitan(m, x, z);
    world.add(t); titans[m.id] = t; robots[m.id] = t;
    entityById[m.id] = {kind:'machine', name:m.name};
    const shield = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent:true, opacity:0, side:THREE.BackSide }));
    t.add(shield); t.userData.shield = shield; t.userData.shieldPulse = 0;
  });

  // --- Toa (agent warriors): one per profile, orbiting its Titan ---
  const tip = window.__MC_TIPUA__;
  if (tip) {
    // build reverse map machine->profiles from the explicit PROFILE_MACHINE map
    const machineProfiles = {};
    for (const [prof, mid] of Object.entries(PROFILE_MACHINE)) {
      (machineProfiles[mid] = machineProfiles[mid] || []).push(prof);
    }
    for (const mid in machineProfiles) {
      const t = titans[mid]; if (!t) continue;
      const profs = [...new Set(machineProfiles[mid])];
      profs.forEach((prof, i) => {
        const color = tip.TOA_COLOR[prof] || 0x4a9bff;
        const toa = tip.makeToa(prof, color);
        const ang = (i / profs.length) * Math.PI * 2;
        toa.position.set(Math.cos(ang) * 4.6, 4.4 + Math.sin(ang * 2) * 0.4, Math.sin(ang) * 4.6);
        toa.userData.ang = ang; toa.userData.mid = mid;
        t.add(toa);
        t.userData.toa = t.userData.toa || [];
        t.userData.toa.push(toa);
        toa.children[0].userData = { kind: 'toa', profile: prof, name: PROFILE_NAME[prof] || prof, color };
        // visible profile name label under the shard (so it reads without hovering)
        const nlab = makeLabel(PROFILE_NAME[prof] || prof, color); nlab.position.y = -1.0; toa.add(nlab);
        pickables.push(toa.children[0]);
      });
    }
  }

  STATE.daemons.forEach(d=>{
    const t = titans[d.host]; if(!t) return;
    const anchor = t.userData.daemonAnchor;
    const existing = anchor.children.filter(c=>c.userData.entity && c.userData.entity.kind==='daemon').length;
    buildDaemon(d, anchor, existing, existing+1);
  });

  const byMachine = {};
  STATE.tasks.forEach(t=>{
    const mid = PROFILE_MACHINE[t.assignee] || 'm1';
    (byMachine[mid] = byMachine[mid] || []).push(t);
  });
  for(const mid in byMachine){
    const t = titans[mid]; if(!t) continue;
    byMachine[mid].forEach((task, i)=> buildTaskShard(task, t, i, byMachine[mid].length));
  }

  STATE.economy.forEach((name, i)=>{
    const ang = (i/STATE.economy.length)*Math.PI*2;
    const r = 40;
    // mill = revenue stream (spinning wheel of work)
    const mill = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.8,1.2,12),
      new THREE.MeshStandardMaterial({color:0x2a1d4a, metalness:.5, roughness:.5}));
    base.position.y = 0.6; mill.add(base);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.6,0.3,8,20),
      new THREE.MeshStandardMaterial({color:0x6a4bd0, emissive:0x4a2f9a, emissiveIntensity:.6, metalness:.3, roughness:.4}));
    wheel.position.y = 2.0; wheel.rotation.x = Math.PI/2; mill.add(wheel);
    const hub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5,0),
      new THREE.MeshStandardMaterial({color:0xf2c14e, emissive:0xf2c14e, emissiveIntensity:.8}));
    hub.position.y = 2.0; mill.add(hub);
    const lbl = makeLabel('💰 '+name, 0xf2c14e); lbl.position.y = 3.6; mill.add(lbl);
    mill.position.set(Math.cos(ang)*r, 0, Math.sin(ang)*r);
    mill.userData = { kind:'economy', name, wheel, hub, base };
    mill.children[0].userData = { kind:'economy', name };
    world.add(mill); pickables.push(mill.children[0]);
    economyMills[name] = mill;
  });

  applyFilter();
}

// ---------- camera fly-to ----------
let flyTarget = null; // {pos, look}
function flyTo(machineId){
  const m = STATE.machines.find(x=>x.id===machineId);
  if(!m || m.titan === false) return; // skip non-titan entries
  const [x,,z] = TITAN_POS[machineId] || [0,0,0];
  const dist = 22;
  flyTarget = {
    camPos: new THREE.Vector3(x, 12, z + dist),
    lookAt: new THREE.Vector3(x, 4, z),
    fromPos: camera.position.clone(),
    fromLook: controls.target.clone(),
    t: 0
  };
}
function flyReset(){
  flyTarget = {
    camPos: new THREE.Vector3(0, 16, 38),
    lookAt: new THREE.Vector3(0, 3, 0),
    fromPos: camera.position.clone(),
    fromLook: controls.target.clone(),
    t: 0
  };
}
function updateFly(dt){
  if(!flyTarget) return;
  flyTarget.t = Math.min(1, flyTarget.t + dt*1.8);
  const e = 1-Math.pow(1-flyTarget.t, 3); // ease-out cubic
  camera.position.lerpVectors(flyTarget.fromPos, flyTarget.camPos, e);
  controls.target.lerpVectors(flyTarget.fromLook, flyTarget.lookAt, e);
  if(flyTarget.t >= 1) flyTarget = null;
}

// ---------- selection highlight ----------
let selected = null;
function setSelected(ent){
  // reset old
  if(selected && selected.obj){ selected.obj.scale.setScalar(1); }
  selected = ent;
  if(ent){ ent.obj.userData._sel = true; }
}

// ---------- raycast (click + hover) ----------
const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
let downXY = null;
let hovered = null; // { robot, base }

renderer.domElement.addEventListener('pointerdown', e=> downXY=[e.clientX,e.clientY]);
renderer.domElement.addEventListener('pointerup', e=>{
  if(!downXY) return;
  const moved = Math.hypot(e.clientX-downXY[0], e.clientY-downXY[1]);
  downXY=null; if(moved>6) return;
  mouse.x = (e.clientX/innerWidth)*2-1; mouse.y = -(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(pickables, false);
  if(hits.length){
    const ent = pickEntity(hits[0].object);
    if(!ent || !ent.kind) return;
    setSelected({ent, obj:hits[0].object});
    if(ent.kind==='toa' || ent.kind==='profile'){
      // clicked a specific profile orb -> open worker terminal addressed to THAT profile
      openWorkerTerminal(ent.profile);
    } else if(ent.kind==='machine'){
      flyTo(ent.id);
      const who = MACHINE_PRIMARY[ent.id] || null;
      openWorkerTerminal(who);
    }
  }
});
// double-click a Titan (any part of it) -> create-profile modal for that machine.
// The machine hitbox is deliberately NOT in `pickables` (it would steal toa
// clicks), so raycast the Titan GROUP recursively and walk up to machineId.
renderer.domElement.addEventListener('dblclick', e=>{
  mouse.x = (e.clientX/innerWidth)*2-1; mouse.y = -(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(Object.values(titans), true);
  for(const h of hits){
    let o = h.object;
    while(o){ if(o.userData && o.userData.machineId){ openCreateProfileModal(o.userData.machineId); return; } o = o.parent; }
  }
});

renderer.domElement.addEventListener('pointermove', e=>{
  mouse.x = (e.clientX/innerWidth)*2-1; mouse.y = -(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(pickables, false);
  if(hits.length){
    const ent = pickEntity(hits[0].object);
    if(ent){
      // track hovered Titan robot for wave/glow
      const t = (ent.kind==='machine') ? titans[ent.id] : null;
      hovered = t && t.userData.robot ? { robot:t.userData.robot } : null;
      // hover popup removed (unreadable / off-aesthetic) — click still shows info
      renderer.domElement.style.cursor = 'pointer';
    } else {
      hideInfo();
      hovered = null;
      renderer.domElement.style.cursor = 'grab';
    }
  } else {
    hideInfo();
    hovered = null;
    renderer.domElement.style.cursor = 'grab';
  }
});
// force-hide popup when the pointer leaves the canvas entirely
renderer.domElement.addEventListener('pointerleave', ()=>{
  hideInfo(); hovered = null;
});

// ---------- AUDIO removed (modes group retired) ----------
// entities are stored two ways: directly on obj.userData (toa / task / economy)
// or wrapped at obj.userData.entity (machine hitbox / daemon core). normalise.
function pickEntity(obj){ const ud = obj && obj.userData; return ud ? (ud.entity || ud) : null; }
function applyFilter(){
  const f = VIEW.filter;
  for(const id in shardById){
    const s = shardById[id];
    const show = (f==='all') || (s.userData.status===f);
    s.visible = show;
    s.material.opacity = show ? 1 : 0.15;
    s.material.transparent = !show;
  }
}

// ---------- api helper (used by chat UI later) ----------
function apiPost(path, data){
  return fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})
    .then(r=>r.json()).catch(e=>({ok:false, detail:String(e)}));
}

// ---------- keydown: camera reset (baked-in, no HTML box) ----------
addEventListener('keydown', e=>{
  if(document.activeElement && document.activeElement.id === 'chat-input') return; // don't hijack chat typing
  if(e.key==='0') flyReset();
});

// ---------- Hermes workstation: HTML overlay (left panel) — kanban + chat ----------
// The terminal/chat UI is a high-opacity HTML overlay on the left (~30% width),
// inset from the screen borders. The 3D scene keeps its baked popups/labels; only
// the text-heavy terminal lives as an overlay (operator decision 2026-07-21).
// ---------- War Log + toa behavior-state sync ----------
const prevTaskStatus = {};
let warlogPrimed = false;
function pushWarLog(text, cls){
  const log = document.getElementById('warlog-list');
  if(!log) return;
  const div = document.createElement('div');
  div.className = 'wlline ' + (cls||'');
  div.innerHTML = '<span class="wl-time"></span> <span class="wl-text"></span>';
  div.querySelector('.wl-time').textContent = new Date().toLocaleTimeString();
  div.querySelector('.wl-text').textContent = text;
  log.insertBefore(div, log.firstChild);
  while(log.children.length > 80) log.removeChild(log.lastChild);
}
const STATE_RANK = { idle:0, done:1, thinking:2, reviewing:3, working:4, blocked:5 };
function bestState(a, b){
  if(!a) return b; if(!b) return a;
  return (STATE_RANK[b] ?? 0) > (STATE_RANK[a] ?? 0) ? b : a;
}
function updateToaStates(tasks){
  const byProf = {};
  (tasks||[]).forEach(t=>{ byProf[t.assignee] = bestState(byProf[t.assignee], stateForTaskStatus(t.status)); });
  for(const mid in titans){
    const arr = titans[mid].userData.toa;
    if(!arr) continue;
    arr.forEach(toa=> setToaState(toa, byProf[toa.userData.profile] || 'idle'));
  }
}

function renderKanbanHTML(tasks){
  const list = document.getElementById('kanban-list');
  const arr = (tasks||[]).slice(0, 40);
  // --- War Log: diff task statuses vs previous render ---
  if(warlogPrimed){
    const curIds = new Set(arr.map(t=>t.id));
    arr.forEach(t=>{
      const prev = prevTaskStatus[t.id];
      if(prev===undefined) pushWarLog('✦ created #'+(t.id||'?')+' '+(t.title||'')+' @'+(t.assignee||'?'), 'created');
      else if(prev!==t.status) pushWarLog('▶ '+t.status+' #'+(t.id||'?')+' '+(t.title||'')+' @'+(t.assignee||'?'), t.status);
      prevTaskStatus[t.id]=t.status;
    });
    for(const id in prevTaskStatus){ if(!curIds.has(id)){ pushWarLog('✕ ended #'+id, 'done'); delete prevTaskStatus[id]; } }
  } else {
    arr.forEach(t=> prevTaskStatus[t.id]=t.status);
    warlogPrimed = true;
    pushWarLog('▸ Mission Control online — watching '+arr.length+' tasks', 'model');
  }
  // --- update 3D toa behavior states from task activity ---
  updateToaStates(arr);
  if(!list) return;
  if(!arr.length){ list.innerHTML = '<div class="kmeta" style="padding:8px;opacity:.6">no tasks</div>'; return; }
  list.innerHTML = '';
  arr.forEach(t=>{
    const div = document.createElement('div');
    div.className = 'kcard ' + (t.status||'ready');
    const safe = (s)=> (s||'').replace(/[<>&]/g,'');
    div.innerHTML = '<button class="kdel" title="delete task" data-id="'+safe(t.id)+'">✕</button>'+
                    '<div class="ktitle">'+safe(t.title||'(untitled)')+'</div>'+
                    '<div class="kmeta">#'+(t.id||'?')+' · '+(t.status||'?')+' · @'+(t.assignee||'?')+'</div>';
    div.addEventListener('click', ()=> inspectTask(t));
    const del = div.querySelector('.kdel');
    del.addEventListener('click', (e)=>{ e.stopPropagation(); deleteTask(t.id, div); });
    list.appendChild(div);
  });
}
function inspectTask(task){
  showInfo({kind:'task', id:task.id, title:task.title, status:task.status, assignee:task.assignee}, true);
  const mid = PROFILE_MACHINE[task.assignee];
  if(mid && titans[mid]) flyTo(mid);
  openTerminal(task, true);
}
function apiDeleteTask(id){
  return fetch('/api/task/delete', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ids:[id]})}).then(r=>r.json());
}
function deleteTask(id, el){
  if(!confirm('Delete task #'+id+'?')) return;
  apiDeleteTask(id).then(d=>{
    if(d && d.ok){
      if(el && el.parentNode) el.parentNode.removeChild(el);
      if(STATE.tasks) STATE.tasks = STATE.tasks.filter(t=>t.id!==id);
      delete prevTaskStatus[id];
      pushWarLog('✕ deleted #'+id, 'done');
    } else {
      alert('Delete failed: '+(d && d.purged || d && d.archived || 'unknown error'));
    }
  }).catch(e=>{ console.error('DELETE_ERR', e); alert('Delete error'); });
}
function pushChatHTML(line){
  const log = document.getElementById('chat-log');
  if(!log) return;
  const div = document.createElement('div');
  let cls = 'ln ';
  if(line.startsWith('you>')) cls += 'you';
  else if(line.startsWith('✗')) cls += 'err';
  else if(line.startsWith('✓') || line.startsWith('→') || line.startsWith('Hermes')) cls += 'sys';
  div.className = cls;
  div.textContent = line;
  log.appendChild(div);
  while(log.children.length > 80) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
  if(_speakOn && line.startsWith('Hermes')) speakIfEnabled(line.replace(/^Hermes\W*/, ''));
}
let _chatBusy = false;
let _lastHermesReply = '';
let chatModel='<brain-model>', chatProvider='openrouter';
async function submitChatHTML(){
  const inp = document.getElementById('chat-input');
  let txt = (inp.value||'').trim();
  txt = txt.replace(/^(Hermes>\s*|you>\s*|\u2717\s*|\u23f3\s*)+/g, '').trim();
  if(!txt) return;
  if(/hermes call failed|hermes error|operator call failed/.test(txt)) return;
  if(txt === _lastHermesReply) return;
  if(_chatBusy){ pushChatHTML('\u23f3 Hermes is thinking\u2026 (wait for the current reply)'); return; }
  _chatBusy = true;
  inp.value = '';
  pushChatHTML('you> '+txt);
  if(txt.startsWith('!task')){
    const m = txt.match(/^!task\s+(.+?)(?:\s+@(\S+))?$/);
    const title = m ? m[1].trim() : txt.replace('!task','').trim();
    const assignee = m && m[2] ? m[2] : '';
    try {
      const r = await apiPost('/api/task/create', { title, assignee });
      const j = await r.json();
      pushChatHTML(j.ok ? '✓ task created'+(assignee?(' → @'+assignee):'') : '✗ '+(j.error||j.detail||'create failed'));
      if(j.ok){ pinnedTitles.add(title); openTerminal({id:'pending:'+title, title, status:'ready', assignee}, true); }
    } catch(e){ pushChatHTML('✗ network error'); }
  } else {
    pushChatHTML('⏳ Hermes is thinking…');
    try {
      const j = await apiPost('/api/operator/message', { message: txt, model: chatModel, provider: chatProvider });
      const log = document.getElementById('chat-log');
      if(log && log.lastChild && log.lastChild.textContent.startsWith('⏳')) log.removeChild(log.lastChild);
      if(j && j.reply){ _lastHermesReply = j.reply; pushChatHTML('Hermes> ' + j.reply); }
      else if(j && j.ok) pushChatHTML('Hermes> (no reply)');
      else pushChatHTML('✗ ' + ((j && (j.detail||j.error)) || 'operator call failed'));
    } catch(e){ pushChatHTML('✗ network error'); }
  }
  _chatBusy = false;
}

// ---------- per-task log terminals (top-right, auto-close on done) ----------
const TT = new Map();            // taskId -> { el, body, title, assignee, status, pinned }
const pinnedTitles = new Set();
async function fetchLog(prof){
  if(!prof) return [];
  try { const r = await fetch('/api/logs/'+encodeURIComponent(prof)); const j = await r.json(); return j.lines || []; }
  catch(e){ return []; }
}
function closeTerminal(id, fade){
  const t = TT.get(id); if(!t) return;
  const el = t.el; TT.delete(id);
  if(fade){ el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(), 300); }
  else el.remove();
}
function floatLayer(){
  let fl = document.getElementById('float-layer');
  if(!fl){
    fl = document.createElement('div');
    fl.id = 'float-layer';
    fl.style.cssText = 'position:fixed; inset:0; pointer-events:none;';
    (document.getElementById('ui-root') || document.body).appendChild(fl);
  }
  return fl;
}
function makeDraggable(el, handle){
  let sx=0, sy=0, ox=0, oy=0, dragging=false;
  handle.addEventListener('pointerdown', e=>{
    if(e.target.closest('button')) return;            // ignore × / collapse clicks
    dragging=true;
    try{ handle.setPointerCapture(e.pointerId); }catch(_){}
    if(!el.classList.contains('float')){
      const r=el.getBoundingClientRect();             // viewport coords (no transformed ancestor now)
      el.classList.add('float'); el._floating=true;
      el.style.left=r.left+'px'; el.style.top=r.top+'px';
      el.style.width=r.width+'px'; el.style.height=r.height+'px'; el.style.margin='0';
    }
    sx=e.clientX; sy=e.clientY;
    const r=el.getBoundingClientRect(); ox=parseFloat(el.style.left)||r.left; oy=parseFloat(el.style.top)||r.top;
    e.preventDefault();
  });
  addEventListener('pointermove', e=>{
    if(!dragging) return;
    let nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
    nx=Math.max(2, Math.min(innerWidth-40, nx)); ny=Math.max(2, Math.min(innerHeight-30, ny));
    el.style.left=nx+'px'; el.style.top=ny+'px';
  });
  addEventListener('pointerup', e=>{ dragging=false; try{ handle.releasePointerCapture(e.pointerId); }catch(_){} });
}
function makeResizeable(el, handle){
  let sx=0, sy=0, sw=0, sh=0, resizing=false;
  handle.addEventListener('pointerdown', e=>{
    resizing=true; try{ handle.setPointerCapture(e.pointerId); }catch(_){}
    sx=e.clientX; sy=e.clientY;
    const r=el.getBoundingClientRect(); sw=r.width; sh=r.height;
    e.preventDefault(); e.stopPropagation();
  });
  addEventListener('pointermove', e=>{
    if(!resizing) return;
    const nw=Math.max(220, Math.min(innerWidth-20, sw+(e.clientX-sx)));
    const nh=Math.max(90, Math.min(innerHeight-20, sh+(e.clientY-sy)));
    el.style.width=nw+'px'; el.style.height=nh+'px';
  });
  addEventListener('pointerup', e=>{ resizing=false; try{ handle.releasePointerCapture(e.pointerId); }catch(_){} });
}
function buildTerminalEl(task){
  const c = document.getElementById('task-terminals'); if(!c) return null;
  const el = document.createElement('div'); el.className = 'tt ' + (task.status||'ready');
  const head = document.createElement('div'); head.className='tt-head';
  const clps = document.createElement('button'); clps.className='tt-clps'; clps.textContent='▾'; clps.title='collapse / expand';
  const title = document.createElement('span'); title.className='tt-title'; title.textContent = task.title||'(untitled)';
  const x = document.createElement('button'); x.className='tt-x'; x.textContent='×'; x.title='close';
  x.addEventListener('click', ()=>{ pinnedTitles.delete(task.title); closeTerminal(task.id); });
  clps.addEventListener('click', ()=>{ el.classList.toggle('collapsed'); const t=TT.get(task.id); if(t) t.collapsed=el.classList.contains('collapsed'); });
  head.appendChild(clps); head.appendChild(title); head.appendChild(x);
  const body = document.createElement('div'); body.className='tt-body';
  const rz = document.createElement('button'); rz.className='tt-resize'; rz.title='resize';
  el.appendChild(head); el.appendChild(body); el.appendChild(rz); c.appendChild(el);
  makeDraggable(el, head); makeResizeable(el, rz);
  return { el, body };
}
// ---- Stage 2: dedicated worker-dispatch terminal ----
function openWorkerTerminal(assignee){
  let t = TT.get('worker');
  if(!t){
    const c = document.getElementById('task-terminals'); if(!c) return;
    const el = document.createElement('div'); el.className = 'tt running prompt-line';
    const head = document.createElement('div'); head.className='tt-head';
    const title = document.createElement('span'); title.className='tt-title'; title.textContent='⚒ WORKER DISPATCH';
    const x = document.createElement('button'); x.className='tt-x'; x.textContent='×'; x.title='close';
    head.appendChild(title); head.appendChild(x);
    const body = document.createElement('div'); body.className='tt-body';
    body.textContent = 'Worker dispatch console.\nType:  !<title> @<assignee>\nExample: !ship the API @coder\n';
    const foot = document.createElement('div'); foot.className='tt-foot';
    const ps = document.createElement('span'); ps.className='ps'; ps.textContent='›';
    const inp = document.createElement('input'); inp.type='text'; inp.placeholder='!<title> @assignee'; inp.autocomplete='off';
    foot.appendChild(ps); foot.appendChild(inp);
    const rz = document.createElement('button'); rz.className='tt-resize'; rz.title='resize';
    el.appendChild(head); el.appendChild(body); el.appendChild(foot); el.appendChild(rz); c.appendChild(el);
    makeDraggable(el, head); makeResizeable(el, rz);
    const id='worker';
    const close = ()=>{ TT.delete(id); el.remove(); };
    x.addEventListener('click', close);
    inp.addEventListener('keydown', e=>{ e.stopPropagation(); if(e.key==='Enter'){ dispatchWorker(inp.value); inp.value=''; } });
    t = { el, body, input:inp };
    TT.set(id, t);
  }
  t.el.classList.remove('collapsed');
  if(!t.el._floating){ t.el.classList.add('float'); t.el._floating=true; }
  // (re)position every open so it's always fully on-screen, clear of edges + control cluster
  {
    const W = 340, H = 320;
    let left = Math.round(innerWidth*0.5 - W/2);
    let top  = Math.round(innerHeight*0.5 - H/2);
    left = Math.max(16, Math.min(left, innerWidth  - W - 16));
    top  = Math.max(64, Math.min(top,  innerHeight - H - 64));
    t.el.style.left = left+'px'; t.el.style.top = top+'px';
    t.el.style.width = W+'px'; t.el.style.height = H+'px';
  }
  raiseBox(t.el);
  if(assignee && t.input){ t.input.value = '! @'+assignee; t.input.setSelectionRange(2, 2); }
  if(t.input) t.input.focus();
}
// machine (titan) -> a profile that lives on it, used to pre-fill the worker terminal
const MACHINE_PRIMARY = {};
Object.entries(PROFILE_MACHINE).forEach(([prof, mid])=>{ if(!MACHINE_PRIMARY[mid]) MACHINE_PRIMARY[mid]=prof; });
// ---- Create-profile modal (spawned from a titan double-click or the control button) ----
function openCreateProfileModal(machine){
  const modal = document.getElementById('profile-modal');
  if(!modal) return;
  modal.classList.add('show');
  const sel = modal.querySelector('#pp-machine'); if(sel && machine) sel.value = machine;
  const name = modal.querySelector('#pp-name'); if(name) name.value='';
  const desc = modal.querySelector('#pp-desc'); if(desc) desc.value='';
  const st = modal.querySelector('#pp-status'); if(st) st.textContent='';
  if(name) name.focus();
}
function submitCreateProfile(){
  const modal = document.getElementById('profile-modal'); if(!modal) return;
  const name = modal.querySelector('#pp-name').value.trim().toLowerCase();
  const machine = modal.querySelector('#pp-machine').value;
  const desc = modal.querySelector('#pp-desc').value.trim();
  const st = modal.querySelector('#pp-status');
  if(!/^[a-z0-9][a-z0-9_\-]*$/.test(name)){ st.textContent='✗ need a lowercase name (a-z0-9_-).'; return; }
  st.textContent='creating…';
  fetch('/api/profile/create', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({name, machine, description:desc})})
    .then(r=>r.json()).then(d=>{
      if(d && d.ok){ st.textContent='✓ profile "'+name+'" created (cloned from '+d.clone_from+')';
        pushWarLog('✚ profile '+name+' created', 'created');
        setTimeout(()=>modal.classList.remove('show'), 1200);
      } else { st.textContent='✗ '+(d && d.detail || 'create failed'); }
    }).catch(e=>{ st.textContent='✗ '+e; });
}
(function initProfileModal(){
  const modal = document.getElementById('profile-modal');
  if(!modal) return;
  const cancel = modal.querySelector('#pp-cancel');
  const create = modal.querySelector('#pp-create');
  if(cancel) cancel.addEventListener('click', ()=> modal.classList.remove('show'));
  if(create) create.addEventListener('click', submitCreateProfile);
  modal.addEventListener('click', e=>{ if(e.target===modal) modal.classList.remove('show'); });
})();
function dispatchWorker(raw){
  const t = TT.get('worker'); if(!t) return;
  const txt = (raw||'').trim();
  const m = txt.match(/^!\s*(.+?)\s*@\s*([a-z0-9_\-]+)\s*$/i);
  const log = (s)=>{ t.body.textContent += s + '\n'; t.body.scrollTop = t.body.scrollHeight; };
  if(!m){ log('✗ usage: !<title> @<assignee>'); return; }
  const title = m[1].trim(), who = m[2].toLowerCase();
  log('› ' + txt);
  fetch('/api/task/create', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({title, assignee:who})})
    .then(r=>r.json()).then(d=>{
      if(!d || !d.ok){ log('✗ create failed: '+(d&&d.detail||'unknown')); return; }
      log('✓ created · dispatching to @'+who+' …');
      return fetch('/api/dispatch', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({max:1})}).then(r=>r.json()).then(dd=>{
          if(dd && dd.ok) log('✓ dispatched @'+who+' → '+title);
          else log('✗ dispatch failed: '+(dd&&dd.detail||'unknown'));
        });
    }).catch(e=>{ log('✗ error: '+e); });
}
async function openTerminal(task, pinned){
  let t = TT.get(task.id);
  const parts = t ? null : buildTerminalEl(task);
  if(!t && parts){ t = { el:parts.el, body:parts.body, title:task.title, assignee:task.assignee, status:task.status, pinned:!!pinned }; TT.set(task.id, t); raiseBox(parts.el);}
  if(!t) return;
  t.title = task.title; t.assignee = task.assignee; t.status = task.status; if(pinned) t.pinned = true;
  t.el.className = 'tt ' + (task.status||'ready');
  if(t.el._floating) t.el.classList.add('float');
  if(t.collapsed) t.el.classList.add('collapsed');
  const head = (task.status==='ready') ? 'QUEUED' : (task.status||'').toUpperCase();
  const lines = (task.status==='ready') ? ['(queued · waiting for worker)'] : await fetchLog(task.assignee);
  t.body.textContent = '['+head+'] @'+(task.assignee||'?')+'\n\n' + (lines.length ? lines.slice(-14).join('\n') : '— no log yet —');
}
function syncTerminals(tasks){
  if(!tasks) return;
  const byId = {}; tasks.forEach(t=> byId[t.id]=t);
  TT.forEach((t, id)=>{ if(id.startsWith('pending:')){ const real = tasks.find(x=>x.title===t.title); if(real){ openTerminal(real, true); closeTerminal(id); } } });
  tasks.forEach(t=>{
    const isOpen = TT.has(t.id);
    const pinned = pinnedTitles.has(t.title);
    const open = (t.status==='running') || isOpen || pinned;
    // only (re)open when not already open, or when running (live log), or pinned —
    // stops a queued task's terminal from re-rendering/refocusing every refresh (the "loop")
    if(open && (!isOpen || t.status==='running' || pinned)) openTerminal(t, pinned);
    if(t.status==='done' && isOpen) closeTerminal(t.id, true);
  });
  TT.forEach((t, id)=>{ if(!id.startsWith('pending:') && !byId[id] && !pinnedTitles.has(t.title) && id!=='worker') closeTerminal(id); });
}

function initWorkstation(){
  const inp = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const newBtn = document.getElementById('kanban-new');
  if(send) send.addEventListener('click', submitChatHTML);
  if(inp) inp.addEventListener('keydown', e=>{ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); submitChatHTML(); } });
  if(newBtn) newBtn.addEventListener('click', ()=>{ if(inp){ inp.value='!task '; inp.focus(); } });
  initVoiceFeatures(inp);
  initModelRouting();
  initPanelsFront();
  pushChatHTML('Hermes online. Type !task <title> @assignee to create, or just chat.');
  // syncTerminals is driven by refresh() (every 4s) — a second interval here just caused churn/looping
}

function initModelRouting(){
  const bar = document.getElementById('chat-route');
  if(!bar) return;
  const btns = bar.querySelectorAll('.cr-btn');
  btns.forEach(b=>{
    b.addEventListener('click', ()=>{
      if(b.disabled) return;
      btns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      chatModel = b.dataset.model || '';
      chatProvider = b.dataset.provider || '';
    });
  });
}

// ---------- Voice: push-to-talk (browser STT) + Hermes TTS ----------
let _speakOn = false; let _rec = null; let _recFinal = '';
function initVoiceFeatures(inp){
  const pttBtn = document.getElementById('chat-ptt');
  const speakBtn = document.getElementById('chat-speak');
  // --- TTS toggle (Hermes speaks replies) ---
  if(speakBtn){
    if(!('speechSynthesis' in window)){ speakBtn.disabled = true; speakBtn.title = 'Voice output not supported in this browser'; }
    speakBtn.addEventListener('click', ()=>{ _speakOn = !_speakOn; speakBtn.classList.toggle('active', _speakOn); speakBtn.title = _speakOn ? 'Hermes voice: ON' : 'Hermes voice: OFF'; if(!_speakOn && 'speechSynthesis' in window) speechSynthesis.cancel(); });
  }
  // --- PTT (user speaks -> transcribed into chat) ---
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const startPTT = ()=>{
    if(!SR) return; if(_rec && _rec.state==='recording') return;
    _rec = new SR(); _rec.lang='en-NZ'; _rec.interimResults=true; _rec.continuous=false; _recFinal='';
    _rec.onresult = e=>{ if(_speaking) return; let t=''; for(let i=0;i<e.results.length;i++) t+=e.results[i][0].transcript; _recFinal=t; if(inp) inp.value=t; };
    _rec.onerror = ()=>{ if(pttBtn) pttBtn.classList.remove('active'); };
    _rec.onend = ()=>{ if(pttBtn) pttBtn.classList.remove('active'); if(_speaking){ _recFinal=''; return; } if(inp && _recFinal.trim()){ const t=_recFinal.trim(); _recFinal=''; if(t!==_lastHermesReply && !/hermes call failed|hermes error/i.test(t)){ inp.value=t; submitChatHTML(); } } };
    try{ _rec.start(); if(pttBtn) pttBtn.classList.add('active'); }catch(e){}
  };
  const stopPTT = ()=>{ if(_rec && _rec.state==='recording'){ try{ _rec.stop(); }catch(e){} } };
  if(pttBtn){
    if(!SR){ pttBtn.disabled = true; pttBtn.title = 'Mic/voice not supported in this browser'; }
    pttBtn.addEventListener('pointerdown', e=>{ e.preventDefault(); startPTT(); });
    pttBtn.addEventListener('pointerup', stopPTT);
    pttBtn.addEventListener('pointerleave', stopPTT);
  }
  // expose for the control-panel PTT button
  window.__mcPTT = { start: startPTT, stop: stopPTT };
}
let _speaking = false;
function speakIfEnabled(text){
  if(!_speakOn || !('speechSynthesis' in window)) return;
  if(/\u2717|call failed|hermes error/i.test(text)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02; u.pitch = 0.95;
  u.onend = ()=>{ _speaking = false; };
  u.onerror = ()=>{ _speaking = false; };
  _speaking = true;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ---------- ComfyUI GEN + PREVIEW (Hermes wrapper) ----------
const DEFAULT_GEN_PARAMS = [
  {key:"prompt", label:"Prompt", kind:"textarea"},
  {key:"seed", label:"Seed (-1 random)", kind:"number", default:-1},
  {key:"steps", label:"Steps", kind:"number", default:20},
];
let GEN_WORKFLOWS = [];

function genParamsFor(wid){
  const wf = GEN_WORKFLOWS.find(w=>w.id===wid) || {};
  return (wf.params && wf.params.length) ? wf.params : DEFAULT_GEN_PARAMS;
}
function renderGenParams(params){
  const box = document.getElementById('gen-params');
  if(!box) return;
  box.innerHTML = '';
  (params||[]).forEach(p=>{
    const lab = document.createElement('label');
    lab.className = 'gen-field';
    lab.textContent = p.label || p.key;
    let inp;
    if(p.kind==='textarea' || p.key==='prompt'){ inp = document.createElement('textarea'); }
    else if(p.kind==='number'){ inp = document.createElement('input'); inp.type='number'; }
    else if(p.kind==='select'){ inp = document.createElement('select'); (p.options||[]).forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; inp.appendChild(op); }); }
    else { inp = document.createElement('input'); inp.type='text'; }
    inp.id = 'genp-'+p.key;
    if(p.default!=null) inp.value = p.default;
    if(p.placeholder) inp.placeholder = p.placeholder;
    lab.appendChild(inp);
    box.appendChild(lab);
  });
}
function initGen(){
  const sel = document.getElementById('gen-workflow');
  const go = document.getElementById('gen-go');
  if(!sel || !go) return;
  fetch('/api/comfy/workflows').then(r=>r.json()).then(d=>{
    GEN_WORKFLOWS = d.workflows || [];
    if(!GEN_WORKFLOWS.length){
      sel.innerHTML = '<option value="">— no workflows —</option>';
      return;
    }
    sel.innerHTML = '';
    GEN_WORKFLOWS.forEach(w=>{
      const o = document.createElement('option'); o.value=w.id;
      o.textContent = w.label + (w.type==='video' ? '  [video]' : '');
      sel.appendChild(o);
    });
    renderGenParams(genParamsFor(GEN_WORKFLOWS[0].id));
  }).catch(()=>{ sel.innerHTML='<option value="">— comfy unreachable —</option>'; });
  sel.addEventListener('change', ()=> renderGenParams(genParamsFor(sel.value)));
  go.addEventListener('click', submitGen);
  const freeBtn = document.getElementById('free-m2');
  if(freeBtn){
    freeBtn.addEventListener('click', async ()=>{
      const st = document.getElementById('gen-status');
      if(!confirm('Unload M2 agent models (<your-coder-model>, <your-large-model>)? M2 workers pause until models reload.')) return;
      freeBtn.disabled = true;
      if(st) st.textContent = 'unloading M2 VRAM…';
      try {
        const r = await apiPost('/api/comfy/free_m2', {});
        if(st) st.textContent = (r && r.ok) ? '✓ M2 VRAM freed' : '✗ '+(r && (r.error||r.detail) || 'unload failed');
      } catch(e){ if(st) st.textContent = '✗ network error (is M2 online?)'; }
      setTimeout(()=>{ freeBtn.disabled = false; refreshM2Vram(); if(st) st.textContent = ''; }, 1600);
    });
  }
  refreshPreview();
  refreshM2Vram();
  initPreviewTabs();
  initTerminalsFront();
}
// click/drag ANY html box -> raise it above all others. every interactive box
// (HUD panels, task terminals, world-control) lives inside #ui-root, so a
// single monotonically-increasing counter makes "the box you last touched" the topmost.
let _z = 100;
function raiseBox(el){
  if(!el) return;
  if(_z < 8000) _z++;                 // cap below the modal/lightbox (z 9000+)
  el.style.zIndex = _z;
  document.querySelectorAll('.on-top').forEach(o=>{ if(o!==el) o.classList.remove('on-top'); });
  el.classList.add('on-top');
}
function initTerminalsFront(){
  const c = document.getElementById('task-terminals');
  if(!c) return;
  c.addEventListener('mousedown', e=>{
    const el = e.target.closest('.tt');
    if(el) raiseBox(el);
  });
}
function initPanelsFront(){
  const ui = document.getElementById('hermes-ui');
  if(!ui) return;
  ui.addEventListener('mousedown', e=>{
    const el = e.target.closest('section');
    if(el) raiseBox(el);
  });
}
function initPreviewTabs(){
  const preview = document.getElementById('hud-preview');
  if(!preview) return;
  const tabs = preview.querySelectorAll('.pv-tab');
  const body = document.getElementById('preview-body');
  const devWrap = document.getElementById('preview-device');
  const webWrap = document.getElementById('preview-web');
  const webBar = document.getElementById('pv-web-bar');
  const devBar = document.getElementById('pv-dev-bar');
  const urlIn = document.getElementById('pv-url');
  const go = document.getElementById('pv-go');
  const devSel = document.getElementById('pv-device');
  const devUrl = document.getElementById('pv-dev-url');
  const devGo = document.getElementById('pv-dev-go');
  function show(tab){
    tabs.forEach(t=> t.classList.toggle('active', t.dataset.tab===tab));
    const isGallery = tab==='gallery', isWeb = tab==='web', isDev = tab==='device';
    if(webBar) webBar.hidden = !isWeb;
    if(devBar) devBar.hidden = !isDev;
    if(body) body.hidden = !isGallery;
    if(devWrap) devWrap.hidden = !isDev;
    if(webWrap) webWrap.hidden = !isWeb;
    if(isGallery) refreshPreview();
    currentPreviewTab = tab;
  }
  tabs.forEach(t=> t.addEventListener('click', ()=> show(t.dataset.tab)));
  if(go) go.addEventListener('click', ()=>{ if(urlIn) loadWeb(urlIn.value); });
  if(urlIn) urlIn.addEventListener('keydown', e=>{ if(e.key==='Enter') loadWeb(urlIn.value); });
  if(devGo) devGo.addEventListener('click', ()=>{ if(devUrl) renderDevice(devSel.value, devUrl.value); });
  if(devUrl) devUrl.addEventListener('keydown', e=>{ if(e.key==='Enter') renderDevice(devSel.value, devUrl.value); });
  if(devSel) devSel.addEventListener('change', ()=>{ if(devUrl && devUrl.value) renderDevice(devSel.value, devUrl.value); });
  function loadWeb(raw){
    const u = cleanUrl(raw);
    if(!u){ if(webWrap) webWrap.innerHTML='<div class="preview-empty">enter a URL</div>'; return; }
    if(webWrap) webWrap.innerHTML = '<iframe class="pv-iframe" src="'+mcEsc(u)+'" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>';
  }
}
let currentPreviewTab = 'gallery';
function cleanUrl(raw){
  let u = (raw||'').trim();
  if(!u) return '';
  if(!/^https?:\/\//i.test(u)) u = 'https://'+u;
  return u;
}
function renderDevice(kind, raw){
  const wrap = document.getElementById('preview-device');
  if(!wrap) return;
  const u = cleanUrl(raw);
  if(!u){ wrap.innerHTML='<div class="preview-empty">enter a URL to load inside the '+kind+'</div>'; return; }
  const screen = '<iframe class="dev-screen" src="'+mcEsc(u)+'" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>';
  let bezel = '';
  if(kind==='iphone') bezel = '<div class="dev dev-iphone"><div class="dev-notch"></div>'+screen+'<div class="dev-home"></div></div>';
  else if(kind==='android') bezel = '<div class="dev dev-android"><div class="dev-hole"></div>'+screen+'</div>';
  else if(kind==='tablet') bezel = '<div class="dev dev-tablet"><div class="dev-cam"></div>'+screen+'</div>';
  else bezel = '<div class="dev dev-laptop">'+screen+'<div class="dev-base"></div></div>';
  wrap.innerHTML = bezel;
}
async function submitGen(){
  const sel = document.getElementById('gen-workflow');
  const go = document.getElementById('gen-go');
  const status = document.getElementById('gen-status');
  const wid = sel && sel.value;
  if(!wid || wid===''){ if(status) status.textContent='pick a workflow'; return; }
  const params = genParamsFor(wid);
  const args = {};
  params.forEach(p=>{
    const el = document.getElementById('genp-'+p.key);
    if(!el) return;
    let v = el.value;
    if(p.kind==='number'){ v = (v===''||v==null)?null:Number(v); }
    if(v!=='' && v!=null) args[p.key]=v;
  });
  let input_image = null;
  const fileEl = document.getElementById('gen-image');
  if(fileEl && fileEl.files && fileEl.files[0]){
    try {
      input_image = await new Promise((res,rej)=>{
        const fr = new FileReader();
        fr.onload = ()=>res(fr.result);
        fr.onerror = ()=>rej(new Error('read fail'));
        fr.readAsDataURL(fileEl.files[0]);
      });
    } catch(e){ if(status) status.textContent='image read failed'; return; }
  }
  if(go) go.disabled = true;
  if(status) status.textContent = 'submitting…';
  try {
    const r = await apiPost('/api/comfy/generate', { workflow_id: wid, args, input_image });
    if(!r.ok){ if(status) status.textContent='error: '+(r.error||'submit failed'); if(go) go.disabled=false; return; }
    if(status) status.textContent = 'queued · polling…';
    pollGenJob(r.prompt_id, status, go);
  } catch(e){ if(status) status.textContent='network error'; if(go) go.disabled=false; }
}
function pollGenJob(pid, status, go){
  const tick = async ()=>{
    try {
      const r = await fetch('/api/comfy/job/'+encodeURIComponent(pid));
      const j = await r.json();
      if(j.status==='running'){ if(status) status.textContent='running…'; setTimeout(tick, 2500); }
      else if(j.status==='error'){ if(status) status.textContent='error'; if(go) go.disabled=false; }
      else { const n=(j.outputs||[]).length; if(status) status.textContent='done · '+n+' output'+(n===1?'':'s'); if(go) go.disabled=false; refreshPreview(); }
    } catch(e){ if(status) status.textContent='poll error'; if(go) go.disabled=false; }
  };
  tick();
}
function refreshM2Vram(){
  const el = document.getElementById('m2-vram');
  if(!el) return;
  fetch('/api/comfy/m2_vram').then(r=>r.json()).then(d=>{
    if(!d.online){ el.textContent = 'M2 Ollama: offline'; el.className = 'gen-status'; return; }
    if(d.busy){
      el.textContent = 'M2 VRAM BUSY · ' + (d.m2_models || []).join(', ');
      el.className = 'gen-status vram-busy';
    } else {
      const extra = (d.loaded && d.loaded.length) ? (' (other: ' + d.loaded.join(', ') + ')') : '';
      el.textContent = 'M2 VRAM: free' + extra;
      el.className = 'gen-status vram-free';
    }
  }).catch(()=>{ el.textContent = 'M2 VRAM: ?'; el.className = 'gen-status'; });
}

function refreshPreview(){
  if(currentPreviewTab && currentPreviewTab!=='gallery') return;
  const body = document.getElementById('preview-body');
  if(!body) return;
  fetch('/api/comfy/gallery').then(r=>r.json()).then(d=>{
    const g = (d.gallery||[]);
    if(!g.length){ body.innerHTML = '<div class="preview-empty">no renders yet</div>'; return; }
    let html = '';
    g.forEach(e=>{
      const outs = e.outputs||[];
      if(!outs.length){
        html += '<div class="thumb"><div class="cap">'+mcEsc(e.prompt||e.label||'')+'</div>'+
                '<div class="badge">'+(e.status==='running'?'running':'—')+'</div></div>';
        return;
      }
      outs.forEach(o=>{
        const url = '/api/comfy/output?filename='+encodeURIComponent(o.filename)+
                    '&subfolder='+encodeURIComponent(o.subfolder||'')+
                    '&type='+encodeURIComponent(o.type_field||'output');
        const isVid = o.type==='video';
        const media = isVid ? '<video src="'+url+'" muted autoplay loop playsinline preload="metadata"></video>'
                            : '<img loading="lazy" src="'+url+'" />';
        html += '<div class="thumb'+(isVid?' video':'')+'" data-url="'+mcEsc(url)+'" data-cap="'+mcEsc((e.prompt||e.label||'')+' · '+(o.type||''))+'">'+
                media + '<div class="badge">'+(isVid?'VIDEO':(e.type==='video'?'FRAME':'IMG'))+'</div>'+
                '<div class="cap">'+mcEsc(e.prompt||e.label||'')+'</div></div>';
      });
    });
    body.innerHTML = html;
    body.querySelectorAll('.thumb').forEach(t=>{
      t.addEventListener('click', ()=> openLightbox(t.getAttribute('data-url'), t.getAttribute('data-cap')));
    });
  }).catch(()=>{});
}
function openLightbox(url, cap){
  let lb = document.getElementById('lb-back');
  if(!lb){
    lb = document.createElement('div'); lb.id='lb-back';
    lb.innerHTML = '<button id="lb-x">×</button><div id="lb-cap"></div>';
    (document.getElementById('ui-root') || document.body).appendChild(lb);
    lb.addEventListener('click', (e)=>{ if(e.target===lb || e.target.id==='lb-x') lb.classList.remove('show'); });
  }
  const ext = (url.split('?')[0].split('.').pop()||'').toLowerCase();
  const isVid = ['mp4','webm','mov','mkv'].includes(ext);
  const old = lb.querySelector('img,video'); if(old) old.remove();
  lb.insertAdjacentHTML('afterbegin', isVid ? '<video src="'+url+'" controls autoplay muted playsinline></video>' : '<img src="'+url+'" />');
  lb.querySelector('#lb-cap').textContent = cap||'';
  lb.classList.add('show');
}

// ---------- MCv3 S3: Fleet metrics + Cron manager (frontend) ----------
function mcEsc(s){ return String(s==null?'':s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function mcBar(pct){
  pct = Math.max(0, Math.min(100, pct|0));
  const fill = pct>85?'bad':(pct>60?'warn':'ok');
  return '<i class="bar '+fill+'" style="width:'+pct+'%"></i>';
}
function metBlock(label, pct, sub){
  if(pct==null || pct===undefined) return '<div class="met-line"><span class="met-k">'+label+'</span><span class="met-v">LAN</span><span class="met-sub"></span></div>';
  return '<div class="met-line"><span class="met-k">'+label+'</span>'
    + '<span class="met-bar">'+mcBar(pct)+'<b>'+pct+'%</b></span>'
    + '<span class="met-sub">'+(sub||'')+'</span></div>';
}
function refreshMetrics(){
  const body = document.getElementById('hud-metrics-body');
  if(!body) return;
  fetch('/api/metrics').then(r=>r.json()).then(d=>{
    let html = '';
    (d.machines||[]).forEach(m=>{
      const src = m.sys_source||'';
      const tag = src==='local'?'<i class="met-tag ok">local</i>'
                : src==='ssh'?'<i class="met-tag ok">ssh</i>'
                : src==='lan'?'<i class="met-tag warn">LAN·rstr</i>'
                : src==='cloud'?'<i class="met-tag">cloud</i>'
                : '<i class="met-tag bad">off</i>';
      const models = (m.models_loaded||[]).map(x=>mcEsc(x.name.split(':')[0])).join(', ') || (m.online?'—':'offline');
      const ramSub = (m.ram_used_gb!=null)? mcEsc(m.ram_used_gb)+'/'+mcEsc(m.ram_total_gb)+'G' : '';
      const cpuSub = (m.cpu_pct!=null && m.cpu_cores!=null)? mcEsc(m.cpu_cores)+'c · ld '+mcEsc(m.load1) : '';
      const diskSub = (m.disk_used_gb!=null)? mcEsc(m.disk_used_gb)+'/'+mcEsc(m.disk_total_gb)+'G' : '';
      const vrSub = (m.vram_used_gb!=null)? mcEsc(m.vram_used_gb)+'/'+mcEsc(m.vram_total_gb)+'G' : '';
      html += '<div class="met-node '+(m.online?'on':'off')+'">'
        + '<div class="met-head"><span class="met-name">'+mcEsc(m.name)+'</span>'+tag+'</div>'
        + metBlock('RAM', m.ram_pct, ramSub)
        + metBlock('CPU', m.cpu_pct, cpuSub)
        + metBlock('DSK', m.disk_pct, diskSub)
        + metBlock('VRAM', m.vram_pct, vrSub)
        + '<div class="met-models">'+models+'</div>'
        + '</div>';
    });
    const t = d.throughput||{};
    const gw = d.gateway==='running' ? '<b class="ok">running</b>' : '<b class="bad">'+mcEsc(d.gateway||'down')+'</b>';
    html += '<div class="met-sys">Gateway '+gw+' · Up '+(d.uptime_s||0)+'s · Tasks '+(t.tasks_done||0)+'/'+(t.tasks_total||0)+' ('+(t.completed_last_hour||0)+'/hr)</div>';
    body.innerHTML = html;
  }).catch(()=>{});
}
function refreshCron(){
  const body = document.getElementById('hud-cron-body');
  if(!body) return;
  fetch('/api/cron').then(r=>r.json()).then(d=>{
    const jobs = d.jobs||[];
    if(!jobs.length){ body.innerHTML = '<div class="cron-empty">no cron jobs</div>'; return; }
    let html = '';
    jobs.forEach(j=>{
      const on = !!j.enabled;
      let next = '—';
      try { if(j.next_run_at) next = new Date(j.next_run_at).toLocaleString(); } catch(_){}
      html += '<div class="cron-row '+(on?'on':'off')+'">'
        + '<span class="cron-toggle">'+(on?'☑':'☐')+'</span>'
        + '<span class="cron-name">'+mcEsc(j.name)+'</span>'
        + '<span class="cron-acts">'
        + '<button class="cron-btn" data-act="'+(on?'pause':'resume')+'" data-id="'+mcEsc(j.id)+'">'+(on?'pause':'resume')+'</button>'
        + '<button class="cron-btn" data-act="run" data-id="'+mcEsc(j.id)+'">run</button>'
        + '</span>'
        + '<span class="cron-sched">'+mcEsc(j.schedule||'')+' · next '+mcEsc(next)+'</span>'
        + '</div>';
    });
    body.innerHTML = html;
    body.querySelectorAll('.cron-btn').forEach(b=>{
      b.addEventListener('click', ()=>{
        const act = b.getAttribute('data-act'); const id = b.getAttribute('data-id');
        apiPost('/api/cron/'+act, {id:id}).then(()=>{ refreshCron(); pushWarLog('⏰ cron '+act+' '+id, 'cron'); }).catch(()=>{});
      });
    });
  }).catch(()=>{});
}
initWorkstation();
function refresh(){
  refreshMetrics(); refreshCron(); refreshPreview(); refreshM2Vram();
  fetch('/api/state').then(r=>r.json()).then(s=>{
    const sig = JSON.stringify([s.machines.map(m=>m.online), s.daemons.map(d=>d.loaded),
      s.tasks.map(t=>t.id+t.status), s.economy.length]);
    if(sig !== refresh._last){
      refresh._last = sig; STATE = s;
      rebuildWorld();
      refreshMillActivity();
      renderKanbanHTML(STATE.tasks);
      syncTerminals(STATE.tasks);
      // bonfire grows with our activity: running tasks + active economy streams
      const running = s.tasks.filter(t=>t.status==='running').length;
      const done = s.tasks.filter(t=>t.status==='done').length;
      const target = Math.min(1, 0.04 + running*0.2 + Math.min(s.economy.length,9)*0.02 + done*0.005);
      if(bonfire) bonfire.userData.levelTarget = target;   // updateBonfire() lerps the flame toward this so it visibly grows
    }
    // memory-moon tracks the holographic memory size even when other state is unchanged
    if(moon) moon.userData.moonTarget = memoryMoonScale(s.memory_facts || 0);
  }).catch(e=>{ console.error('REFRESH_ERR', e); });
  fetch('/api/profiles').then(r=>r.json()).then(d=>{
    window.__MC_PROFILES__ = d.profiles || [];
  }).catch(()=>{});
}
refresh(); setInterval(refresh, 4000);
try { mountApprovalPanel(); } catch(e){ console.error('APPROVALS_MOUNT', e); }
try { initGen(); } catch(e){ console.error('GEN_MOUNT', e); }

try {
  const es = new EventSource('/api/events');
  es.onmessage = (e)=>{
    let d=null; try{ d = JSON.parse(e.data); }catch(_){}
    if(d && d.type === 'state') return;   // state is polled every 4s by setInterval(refresh) — skip to avoid refresh churn
    refresh();
    try {
      if(d && d.type === 'kanban') ringCronBell();
      if(d && d.type === 'approval'){ refreshApprovals(); pulseShieldForApproval(d); pushWarLog('⚠ greenlight '+d.status+' · '+(d.action||'?')+' @'+(d.requester||'?'), 'blocked'); }
      if(d && d.type === 'cron') pushWarLog('⏰ cron schedule fired', 'cron');
      else if(d && d.type === 'model') pushWarLog('⬡ model '+(d.model||d.name||'state changed'), 'model');
      else if(d && d.type && d.type !== 'kanban' && d.type !== 'approval') pushWarLog(d.message || ('event: '+d.type), d.type);
    } catch(_){}
  };
} catch(e){}

// ---------- cron bell (shift-bell animation on task/cron events) ----------
let cronBell = null;
function ringCronBell(){
  if(cronBell && cronBell.active) return;
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(2, 2.4, 64),
    new THREE.MeshBasicMaterial({color:0xf2c14e, transparent:true, opacity:0.5, side:THREE.DoubleSide}));
  mesh.rotation.x = -Math.PI/2; mesh.position.y = 0.1;
  scene.add(mesh);
  cronBell = { mesh, t:0, active:true };
}
// mark a mill active when its stream has running tasks (best-effort by name match)
function refreshMillActivity(){
  for(const name in economyMills){
    const m = economyMills[name];
    const active = STATE.tasks.some(tk => (tk.title||'').toLowerCase().includes(name.toLowerCase().slice(0,6)) && tk.status==='running');
    m.userData.active = active;
  }
}

// ---------- animate ----------
const clock = new THREE.Clock();
// briefly flare a Titan's selection ring (visual confirmation of assignment)
function pingTitan(mid){
  const t = titans[mid]; if(!t || !t.userData.screen) return;
  t.userData.ping = 1.0;
}
function pulseShield(mid){
  const t = titans[mid]; if(t) t.userData.shieldPulse = 1.0;
}
function pulseShieldForApproval(d){
  if(!d) return;
  const mid = (typeof PROFILE_MACHINE !== 'undefined') && PROFILE_MACHINE[d.requester];
  if(mid) pulseShield(mid);
}

function animate(){
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  // ---- scene root ----
  world.rotation.y += dt * 0.015;

  // ---- toa behavior pulse (state-driven breathing) ----
  for(const k in titans){
    const arr = titans[k].userData.toa;
    if(arr) arr.forEach(toa=> tickToa(toa, dt));
  }
  // ---- Titan shield pulse (greenlight alerts) ----
  for(const k in titans){
    const tk = titans[k];
    if(tk.userData.shield && tk.userData.shieldPulse > 0){
      tk.userData.shieldPulse = Math.max(0, tk.userData.shieldPulse - dt*1.6);
      tk.userData.shield.material.opacity = tk.userData.shieldPulse * 0.35;
    }
  }

  for(const k in titans){
    const tk = titans[k];
    if(tk.userData.daemonAnchor){
      tk.userData.daemonAnchor.rotation.y += dt*0.1; // brains orbit (slowed ~3x for clickability)
      // daemons visibly breathe/glow so they never look "asleep" — loaded = bright, idle = dim pulse
      tk.userData.daemonAnchor.children.forEach(c=>{
        if(c.userData && c.userData.entity && c.userData.entity.kind==='daemon'){
          const loaded = !!c.userData.entity.loaded;
          const base = loaded ? 1.5 : 0.28;
          c.material.emissiveIntensity = base + Math.sin(t*3 + c.position.x*5)*(loaded?0.55:0.12);
          c.scale.setScalar(1 + Math.sin(t*2 + c.position.y*3)*0.07);
        }
      });
    }
    if(tk.userData.robot){
      tk.userData.robot.rotation.y = Math.sin(t*0.5 + tk.position.x)*0.25;
      // idle breathing + ground bob so the Titan feels alive and planted
      const breathe = 1 + Math.sin(t*1.4 + tk.position.z)*0.018;
      tk.userData.robot.scale.setScalar(breathe);
      tk.userData.robot.position.y = (tk.userData.tipua?.kind==='cloud') ? Math.sin(t*0.6)*0.5 : Math.abs(Math.sin(t*1.1))*0.12;
    }
    // contact shadow tracks Titan's vertical bob faintly
    if(tk.userData.contact){
      const by = tk.userData.robot ? tk.userData.robot.position.y : 0;
      tk.userData.contact.material.opacity = 0.34 - by*0.05;
      tk.userData.contact.scale.setScalar(1 + by*0.04);
    }
    if(tk.userData.robot){
      const isHover = hovered && hovered.robot === tk.userData.robot;
      const target = isHover ? 1.06 : 1.0;
      const cur = tk.userData.robot.scale.x;
      tk.userData.robot.scale.setScalar(cur + (target - cur)*Math.min(1, dt*6));
      if(isHover) tk.userData.robot.rotation.y += dt*1.2; // little wave/spin when hovered
    }
    if(tk.userData.screen){
      const s = tk.userData.screen, base = s.userData.baseEmissive || 0.9;
      let ei = base + Math.sin(t*2 + k.length)*0.15;
      if(tk.userData.ping > 0){ ei += tk.userData.ping; tk.userData.ping = Math.max(0, tk.userData.ping - dt*1.6); }
      s.material.emissiveIntensity = Math.min(2.2, ei);
    }
    // toa orbit
    if(tk.userData.toa){
      tk.userData.toa.forEach((toa, i)=>{
        const a = (toa.userData.ang||0) + t*0.15; // slowed profile orbit ~2.7x for easier clicking
        const r = 4.6;
        toa.position.set(Math.cos(a)*r, 4.4 + Math.sin(t*1.2 + i)*0.4, Math.sin(a)*r);
        if(toa.children[0]) toa.children[0].rotation.y += dt*1.5;
        if(toa.children[1]) toa.children[1].rotation.z += dt*0.8;
      });
    }
  }
  for(const id in shardById){
    const s = shardById[id];
    const pulse = 0.7 + Math.sin(t*4)*0.3;
    if(s.userData.status==='running') s.material.emissiveIntensity = pulse+0.6;
    else if(s.userData.status==='crashed') s.material.emissiveIntensity = 0.4+Math.sin(t*8)*0.3;
  }
  if(scene.userData.nebula) scene.userData.nebula.rotation.y += dt*0.01;
  // cron bell pulse (expanding ring across floor)
  if(cronBell && cronBell.active){
    cronBell.t += dt;
    const s = 1 + cronBell.t*30;
    cronBell.mesh.scale.set(s, s, s);
    cronBell.mesh.material.opacity = Math.max(0, 0.5 - cronBell.t*0.4);
    if(cronBell.t > 1.2){ scene.remove(cronBell.mesh); cronBell.active = false; }
  }
  updateBonfire(dt, t);
  updateMoon(dt, t);
  updateFly(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- collapsible HUD panels (operator cosmetics 2026-07-21) ----------
// HUD panels: draggable across the screen AND collapse to compact form.
// A quick click (no movement) toggles collapse; a click-and-drag moves the panel.
// Aux panels start collapsed (class="collapsed" in markup) so chat gets the full column.
(function initPanels(){
  const ui = document.getElementById('hermes-ui');
  if(!ui) return;
  ui.querySelectorAll('section').forEach(sec=>{
    const head = sec.querySelector('.hud-head');
    if(!head) return;
    // resize grip (reuses same handle + makeResizeable as per-task terminals)
    const rz = document.createElement('button');
    rz.className = 'tt-resize'; rz.title = 'resize';
    sec.appendChild(rz);
    makeResizeable(sec, rz);
    let sx=0, sy=0, ox=0, oy=0, moved=false, active=false;
    const TH=4; // px movement before it counts as a drag (vs a collapse click)
    head.addEventListener('pointerdown', e=>{
      if(e.target.closest('button')) return;      // let +task etc. work
      active=true; moved=false; sx=e.clientX; sy=e.clientY;
      try{ head.setPointerCapture(e.pointerId); }catch(_){}
    });
    head.addEventListener('pointermove', e=>{
      if(!active) return;
      if(!moved && Math.hypot(e.clientX-sx, e.clientY-sy) > TH){
        moved=true;
        if(!sec.classList.contains('hud-float')){   // pop out of the docked flex column
          const r=sec.getBoundingClientRect();
          sec.classList.add('hud-float');
          sec.style.left=r.left+'px'; sec.style.top=r.top+'px';
          sec.style.width=r.width+'px'; sec.style.margin='0';
          // drop down further when opened: give it a tall default height
          const h = Math.max(420, Math.min(innerHeight*0.9, Math.round(innerHeight*0.7)));
          sec.style.height = h+'px';
        }
        ox=parseFloat(sec.style.left)||0; oy=parseFloat(sec.style.top)||0;
        sx=e.clientX; sy=e.clientY;                  // rebase so movement is smooth
      }
      if(moved){
        let nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
        nx=Math.max(2, Math.min(innerWidth-60, nx));
        ny=Math.max(2, Math.min(innerHeight-40, ny));
        sec.style.left=nx+'px'; sec.style.top=ny+'px';
      }
    });
    head.addEventListener('pointerup', e=>{
      if(!active) return;
      active=false;
      try{ head.releasePointerCapture(e.pointerId); }catch(_){}
      if(!moved){
        // it was a click -> collapse/expand
        if(sec.classList.contains('collapsed')){
          sec.classList.remove('collapsed');
          if(sec.classList.contains('hud-float')){
            // restore a tall default so it drops down again
            const h = Math.max(420, Math.min(innerHeight*0.9, Math.round(innerHeight*0.7)));
            sec.style.height = h+'px';
          }
        } else {
          sec.classList.add('collapsed');
          sec.style.height = '';   // let .collapsed shrink it to the header
        }
      }
    });
  });
})();

// Bottom-right 3D world control cluster
(function initWorldControl(){
  const bar = document.getElementById('world-control');
  if(!bar) return;
  bar.addEventListener('pointerdown', ()=> raiseBox(bar));
  const CAM_HOME = new THREE.Vector3(0, 16, 38);
  bar.querySelectorAll('.wc-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const act = btn.getAttribute('data-act');
      if(act === 'reset'){
        camera.position.copy(CAM_HOME);
        if(controls){ controls.target.set(0,0,0); controls.update(); }
        // "resync": force a full board/world/metrics refresh (was the Reload button)
        if(typeof refresh === 'function'){ refresh._last = null; refresh(); }
        pushWarLog('⤢ view reset · resynced', 'model');
      } else if(act === 'resetlayout'){
        // snap every HUD panel back to the docked column AND collapse it
        document.querySelectorAll('#hermes-ui section').forEach(s=>{
          s.classList.remove('hud-float');
          s.classList.add('collapsed');
          s.style.left=s.style.top=s.style.width=s.style.height=s.style.margin='';
        });
        // also un-float any free-floating task terminals back to the docked strip
        document.querySelectorAll('#task-terminals .tt.float').forEach(t=>{
          t.classList.remove('float');
          t.style.left=t.style.top=t.style.width=t.style.height='';
        });
        pushWarLog('▤ layout reset — all collapsed', 'model');
      } else if(act === 'worker'){
        if(typeof openWorkerTerminal === 'function') openWorkerTerminal();
      } else if(act === 'createprofile'){
        if(typeof openCreateProfileModal === 'function') openCreateProfileModal();
      } else if(act === 'ptt'){
        // hold-to-talk: pointerdown starts STT, pointerup stops + sends
        const mc = window.__mcPTT;
        if(mc){ btn.addEventListener('pointerdown', e=>{ e.preventDefault(); mc.start(); }); btn.addEventListener('pointerup', ()=>mc.stop()); btn.addEventListener('pointerleave', ()=>mc.stop()); }
      }
    });
  });
})();
