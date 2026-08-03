/* ==========================================================================
   ЗВЁЗДНОЕ ПОЛЕ — фон всего сайта

   Это ИСХОДНИК. На сайт грузится собранный файл js/scene.js, в который
   вшита библиотека three.js — чтобы страница не зависела от зарубежных
   CDN (unpkg из России открывается не всегда).

   Пересобрать после правок:
       npm install three@0.143.0
       npx esbuild js/scene.src.js --bundle --minify --format=esm \
           --outfile=js/scene.js --legal-comments=none

   Подключается не тегом, а динамическим import() из index.html — так
   телефоны с включённым «уменьшить движение» и экономией трафика вообще
   не скачивают эти килобайты.
   ========================================================================== */
import * as THREE from 'three';
import { EffectComposer }        from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }            from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }            from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass }       from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';
import { CopyShader }            from 'three/examples/jsm/shaders/CopyShader.js';

/* ==========================================================================
   НАСТРОЙКИ

   Палитра — та же, что у сайта: уголь и латунь. Мятно-нефритовый оригинал
   рядом с латунью читался как чужой слайд, поэтому звёзды перекрашены
   в латунь, тёмную латунь и костяной — те же три цвета, что в вёрстке.
   Яркость и плотность заметно ниже исходных: фон не должен спорить
   с текстом, который лежит поверх.
   ========================================================================== */
const CONFIG = {
  bgColor:    '#0D0B08',   // --ink, тот же фон, что у страницы
  flameColor: '#C2A05C',   // --brass
  flameColor2:'#6E4A22',   // тёплый янтарь в углах
  flameAmt:   0.13,
  colorA:     '#C2A05C',   // --brass
  colorB:     '#8C6E36',   // --brass-deep
  colorC:     '#EAE3D6',   // --bone
  opacity:    2.1,
  pointSize:  64,
  brightness: 1.75,
  drift:      1.6,         // ровный ход «тоннеля»
  twinkle:    1,
  spin:       0.02,        // вращение вокруг оси взгляда
  repelRadius:5,
  repelStrength: 0.35,
  scrollPush: 7,           // насколько камера ныряет вперёд за всю страницу
  scrollDrift:2.4,         // ускорение хода при прокрутке
  scrollSpin: 0.05,
  parallax:   0.35,        // сдвиг камеры за курсором
};

/* Плотность звёзд по ширине экрана. На телефоне точек меньше, но ненамного:
   экран узкий, в кадр попадает меньшая часть коробки, и при сильном
   прореживании небо становится пустым. */
const COUNT_WIDE   = 4200;
const COUNT_NARROW = 2900;
const NARROW_AT    = 820;

/* Вуаль: чёрная пелена между сценой и содержимым. На первом экране почти
   прозрачная — звёзды видно во всю силу; ниже густеет, чтобы текст читался. */
const VEIL_TOP    = 0.05;
const VEIL_BODY   = 0.62;
const VEIL_FOOTER = 0.36;

const LAYERS = { NONE: 0, TORUS_SCENE: 1, BLOOM_SCENE: 2, ENTIRE_SCENE: 3 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp  = (a, b, t) => a + (b - a) * t;

function hexToVec3(hex) {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/* ==========================================================================
   РЕНДЕРЕР, СЦЕНА, КАМЕРА
   ========================================================================== */
const canvas = document.getElementById('scene');
const veil   = document.querySelector('.veil');
const hero   = document.getElementById('hero');

/* Плотность пикселей: на ретине рисовать в полное разрешение при трёх
   проходах свечения — верный способ посадить телефон. */
const dpr = () => Math.min(window.devicePixelRatio || 1,
                           window.innerWidth <= NARROW_AT ? 1.25 : 1.5);

const renderer = new THREE.WebGL1Renderer({ canvas, antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(dpr());
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 0, 15);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 80);
camera.position.set(0, 0, 5);
camera.layers.enable(LAYERS.TORUS_SCENE);
camera.layers.enable(LAYERS.BLOOM_SCENE);
camera.layers.enable(LAYERS.ENTIRE_SCENE);
scene.add(camera);

/* ==========================================================================
   ЗВЁЗДЫ — точки в коробке 24 × 16 × 30
   ========================================================================== */
const count = window.innerWidth <= NARROW_AT ? COUNT_NARROW : COUNT_WIDE;
const depth = 30;

const positions = new Float32Array(count * 3);
const scales    = new Float32Array(count);
const phases    = new Float32Array(count);
const palette   = new Float32Array(count);
const bright    = new Float32Array(count);

for (let i = 0; i < count; i++) {
  const i3 = i * 3;
  positions[i3]     = (Math.random() - 0.5) * 24;
  positions[i3 + 1] = (Math.random() - 0.5) * 16;
  positions[i3 + 2] = (Math.random() - 0.5) * depth;   // ровно depth — чтобы шов не был виден
  palette[i] = Math.floor(Math.random() * 3);
  bright[i]  = 0.7 + Math.random() * 0.6;
  scales[i]  = 0.5 + Math.pow(Math.random(), 1.4) * 2.5;
  phases[i]  = Math.random();
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geometry.setAttribute('aScale',   new THREE.Float32BufferAttribute(scales, 1));
geometry.setAttribute('aPhase',   new THREE.Float32BufferAttribute(phases, 1));
geometry.setAttribute('aPalette', new THREE.Float32BufferAttribute(palette, 1));
geometry.setAttribute('aBright',  new THREE.Float32BufferAttribute(bright, 1));

const material = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime:          { value: 0 },
    uSize:          { value: CONFIG.pointSize },
    uPixelRatio:    { value: dpr() },
    uOpacity:       { value: 0 },
    uDrift:         { value: 0 },
    uDepth:         { value: depth },
    uTwinkle:       { value: CONFIG.twinkle },
    uCursor:        { value: new THREE.Vector3() },
    uRepelRadius:   { value: CONFIG.repelRadius },
    uRepelStrength: { value: CONFIG.repelStrength },
    uActivity:      { value: 0 },
    uColorA:        { value: hexToVec3(CONFIG.colorA) },
    uColorB:        { value: hexToVec3(CONFIG.colorB) },
    uColorC:        { value: hexToVec3(CONFIG.colorC) },
    uBrightness:    { value: CONFIG.brightness },
  },
  vertexShader: /* glsl */`
uniform float uTime; uniform float uSize; uniform float uPixelRatio; uniform float uDrift; uniform float uDepth; uniform float uTwinkle;
uniform vec3 uCursor; uniform float uRepelRadius; uniform float uRepelStrength; uniform float uActivity;
uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorC;
attribute float aScale; attribute float aPhase; attribute float aPalette; attribute float aBright;
varying vec3 vColor; varying float vTwinkle;
void main() {
  vec3 pos = position;
  // Бесконечный ход к +Z с заворотом по модулю.
  pos.z = mod(pos.z + uDrift + (uDepth * 0.5), uDepth) - (uDepth * 0.5);

  float tw = sin(uTime * 1.6 + aPhase * 6.2831);
  vTwinkle = (1.0 - uTwinkle) + uTwinkle * (0.55 + 0.45 * tw);

  vec4 modelPosition = modelMatrix * vec4(pos, 1.0);

  vec3 toParticle = modelPosition.xyz - uCursor;
  float dist = length(toParticle);
  float falloff = smoothstep(uRepelRadius, 0.0, dist);
  modelPosition.xyz += normalize(toParticle + vec3(0.0001)) * falloff * uRepelStrength * uActivity;

  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
  // Размер точки задаётся в пикселях устройства. Без множителя на плотность
  // экрана звёзды на ретине выходят во столько же раз мельче — из-за этого
  // на телефоне их почти не было видно.
  gl_PointSize = uSize * aScale * uPixelRatio;
  gl_PointSize *= (1.0 / -viewPosition.z);

  vec3 base = aPalette < 0.5 ? uColorA : (aPalette < 1.5 ? uColorB : uColorC);
  vColor = base * aBright;
}
  `,
  fragmentShader: /* glsl */`
uniform float uOpacity; uniform float uBrightness;
varying vec3 vColor; varying float vTwinkle;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float strength = pow(1.0 - d * 2.0, 4.0);
  vec3 color = mix(vec3(0.0), vColor, strength);
  gl_FragColor = vec4(color * uBrightness, strength * uOpacity * vTwinkle);
}
  `,
});

const points = new THREE.Points(geometry, material);
points.layers.enable(LAYERS.ENTIRE_SCENE);

const group = new THREE.Group();
group.add(points);
scene.add(group);

/* ==========================================================================
   ФИНАЛЬНЫЙ ПРОХОД — фон, тёплые всполохи по углам, сложение слоёв
   ========================================================================== */
const FinalPass = {
  uniforms: {
    iTime:        { value: 0 },
    tDiffuse:     { value: null },
    torusTexture: { value: null },
    bloomTexture: { value: null },
    haloTexture:  { value: null },
    uBg:       { value: hexToVec3(CONFIG.bgColor) },
    uFlameA:   { value: hexToVec3(CONFIG.flameColor) },
    uFlameB:   { value: hexToVec3(CONFIG.flameColor2) },
    uFlameAmt: { value: CONFIG.flameAmt },
  },
  vertexShader: /* glsl */`
varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
uniform float iTime; uniform sampler2D tDiffuse; uniform sampler2D bloomTexture; uniform sampler2D torusTexture; uniform sampler2D haloTexture;
uniform vec3 uBg; uniform vec3 uFlameA; uniform vec3 uFlameB; uniform float uFlameAmt;
varying vec2 vUv;
vec3 warp3d(vec3 pos, float t){ float curv=.8,a=1.9,b=0.7; pos*=2.;
  pos.x+=curv*sin(t+a*pos.y)+t*b; pos.y+=curv*cos(t+a*pos.x);
  pos.y+=curv*sin(t+a*pos.z)+t*b; pos.z+=curv*cos(t+a*pos.y);
  pos.z+=curv*sin(t+a*pos.x)+t*b; pos.x+=curv*cos(t+a*pos.z);
  return 0.5+0.5*cos(pos.xyz+vec3(1,2,4)); }
void main(){
  vec2 uv = 2.*vUv - 1.;
  vec3 w = pow(warp3d(vec3(uv.x, sin(uv.y), uv.y), iTime*1.5), vec3(1.5));
  vec3 flame = 1.5*uFlameA*w.x; flame*=w.y; flame += uFlameB*w.z;
  flame *= smoothstep(0.25, 1., abs(uv.y));
  float md = smoothstep(-0.7, 1., -uv.y*uv.x); flame *= md*md;
  vec3 bg = uBg * (1.0 - 0.4 * length(uv));
  vec3 halo = texture2D(haloTexture, vUv).xyz;
  gl_FragColor = vec4(bg + flame*uFlameAmt + texture2D(bloomTexture, vUv).xyz + texture2D(torusTexture, vUv).xyz + texture2D(tDiffuse, vUv).xyz + halo, 1.);
}
  `,
};

/* ==========================================================================
   ТРИ КОМПОЗЕРА НА ОДНОМ RenderPass
   ========================================================================== */
const renderScene = new RenderPass(scene, camera);

const torusComposer = new EffectComposer(renderer);
torusComposer.renderToScreen = false;
torusComposer.addPass(renderScene);
torusComposer.addPass(new ShaderPass(GammaCorrectionShader));
torusComposer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.2, 0));
torusComposer.addPass(new ShaderPass(CopyShader));

const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderScene);
bloomComposer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.55, 0));
bloomComposer.addPass(new ShaderPass(GammaCorrectionShader));

const finalPass = new ShaderPass(FinalPass);
finalPass.uniforms.bloomTexture.value = bloomComposer.renderTarget1.texture;
finalPass.uniforms.torusTexture.value = torusComposer.renderTarget1.texture;

const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderScene);
finalComposer.addPass(finalPass);

for (const composer of [torusComposer, bloomComposer, finalComposer]) composer.setPixelRatio(dpr());

/* ==========================================================================
   КУРСОР — «пустота», которая расталкивает звёзды
   ========================================================================== */
const POINTER = {
  ndc: new THREE.Vector2(0, 0),
  world: new THREE.Vector3(0, 0, 0),
  active: false,
  activity: 0,
  lastMove: performance.now(),
};

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();

window.addEventListener('mousemove', (e) => {
  POINTER.ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  POINTER.ndc.y = -((e.clientY / window.innerHeight) * 2 - 1);
  POINTER.active = true;
  POINTER.lastMove = performance.now();
}, { passive: true });

window.addEventListener('mouseout', () => { POINTER.active = false; });

function updatePointer() {
  _target.set(0, 0, 0);

  if (POINTER.active) {
    _v.set(POINTER.ndc.x, POINTER.ndc.y, 0.5).unproject(camera);
    _dir.copy(_v).sub(camera.position).normalize();
    const t = -camera.position.z / _dir.z;
    if (Math.abs(_dir.z) > 1e-4 && t > 0 && Number.isFinite(t)) {
      _target.copy(camera.position).addScaledVector(_dir, t);
    }
  }

  POINTER.world.lerp(_target, 0.12);

  const idle = (performance.now() - POINTER.lastMove) / 1000;
  const want = (POINTER.active && idle < 3) ? 1 : 0;
  POINTER.activity += (want - POINTER.activity) * 0.06;

  material.uniforms.uCursor.value.copy(POINTER.world);
  material.uniforms.uActivity.value = POINTER.activity;
}

/* ==========================================================================
   ПРОКРУТКА — двойное сглаживание

   Полёт камеры привязан к прокрутке самой страницы: отдельной «беговой
   дорожки» на 300vh здесь нет, её роль играет весь сайт.
   ========================================================================== */
let scrollTarget = 0;
let scrollSmooth = 0;
let scrollCurrent = 0;
let veilTarget = VEIL_TOP;
let veilShown = -1;
const mouseSmooth = { x: 0, y: 0 };

function readScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  scrollTarget = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;

  /* Пелена: пока виден первый экран — звёзды во всю силу, дальше густеет,
     у самого низа снова расступается, чтобы подвал стоял в звёздах. */
  const heroEnd = hero ? Math.max(1, hero.offsetTop + hero.offsetHeight - window.innerHeight * 0.35) : 1;
  const enter = clamp(window.scrollY / heroEnd, 0, 1);
  const tail  = max > 0 ? clamp((window.scrollY - (max - window.innerHeight * 0.9)) / (window.innerHeight * 0.9), 0, 1) : 0;
  veilTarget = lerp(lerp(VEIL_TOP, VEIL_BODY, enter), VEIL_FOOTER, tail);
}
window.addEventListener('scroll', readScroll, { passive: true });
window.addEventListener('resize', readScroll, { passive: true });
readScroll();

/* ==========================================================================
   ОБНОВЛЕНИЕ СЦЕНЫ
   ========================================================================== */
const appearStart = performance.now();
let t0 = performance.now() / 1000;

function updateScene() {
  const scroll = scrollCurrent;
  const m = mouseSmooth;

  const t = performance.now() / 1000;
  const dt = Math.min(0.05, t - t0);
  t0 = t;

  material.uniforms.uTime.value = t;
  material.uniforms.uDrift.value += dt * (CONFIG.drift + scroll * CONFIG.scrollDrift);

  camera.position.set(m.x * CONFIG.parallax, m.y * CONFIG.parallax, 5 - scroll * CONFIG.scrollPush);
  camera.lookAt(m.x * CONFIG.parallax, m.y * CONFIG.parallax, -10);

  // Проявление после загрузки
  const elapsed = performance.now() - appearStart;
  const fade = clamp((elapsed - 300) / 1400, 0, 1);
  material.uniforms.uOpacity.value = fade * CONFIG.opacity;

  group.rotation.z += dt * (CONFIG.spin + scroll * CONFIG.scrollSpin);

  if (veil) {
    const next = Math.round(veilTarget * 100) / 100;
    if (next !== veilShown) { veil.style.opacity = String(next); veilShown = next; }
  }
}

/* ==========================================================================
   ЦИКЛ ОТРИСОВКИ

   Кадры считаются только когда вкладка на виду. Если устройство не тянет,
   сцена уступает по шагам: сначала чёткость, потом плотность звёзд, и лишь
   в последнюю очередь выключается совсем — сайт важнее фона. Гасить сразу
   нельзя: фон тут — основа оформления, а первые секунды тормозит почти
   любой телефон, пока раскладывает страницу.
   ========================================================================== */
let running = true;
let frames = 0;
let checkFrom = performance.now();
let stage = -1;              // -1 — прогрев, дальше по шагам уступок, 3 — хватит проверять

function stop() {
  running = false;
  canvas.classList.remove('is-on');
  if (veil) veil.style.opacity = '0';
  setTimeout(() => {
    renderer.dispose();
    geometry.dispose();
    material.dispose();
    canvas.remove();
  }, 1300);
}

function setRatio(r) {
  renderer.setPixelRatio(r);
  for (const c of [torusComposer, bloomComposer, finalComposer]) c.setPixelRatio(r);
  material.uniforms.uPixelRatio.value = r;   // иначе звёзды поменяют размер
}

function watchdog(now) {
  if (stage > 2) return;

  /* Первые две секунды не в счёт: страница ещё раскладывает картинки
     и шрифты, кадры в это время проседают у кого угодно. */
  if (stage === -1) {
    if (now - checkFrom > 2000) { stage = 0; frames = 0; checkFrom = now; }
    return;
  }

  frames++;
  const span = now - checkFrom;
  if (span < 3500) return;

  const fps = frames * 1000 / span;
  frames = 0;
  checkFrom = now;

  if (fps >= 26) { stage = 3; return; }      // тянет — больше не мешаем

  if (stage === 0) {
    setRatio(1);                             // шаг 1: чёткость
  } else if (stage === 1) {
    geometry.setDrawRange(0, Math.round(count * 0.6));   // шаг 2: плотность
  } else if (fps < 20) {
    stop();                                  // шаг 3: сдаёмся
  }
  stage++;
}

function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  if (document.hidden) return;

  const now = performance.now();
  finalPass.uniforms.iTime.value = now / 1000;

  scrollSmooth  = lerp(scrollSmooth, scrollTarget, 0.10);
  scrollCurrent = lerp(scrollCurrent, scrollSmooth, 0.06);
  mouseSmooth.x = lerp(mouseSmooth.x, POINTER.ndc.x, 0.06);
  mouseSmooth.y = lerp(mouseSmooth.y, POINTER.ndc.y, 0.06);

  updatePointer();
  updateScene();

  camera.layers.set(LAYERS.TORUS_SCENE);
  torusComposer.render();

  camera.layers.set(LAYERS.BLOOM_SCENE);
  bloomComposer.render();

  camera.layers.set(LAYERS.ENTIRE_SCENE);
  finalComposer.render();

  watchdog(now);
}

canvas.classList.add('is-on');
animate();

/* Пока вкладка была в фоне, кадры не считались — иначе после возврата
   сторож решил бы, что устройство не тянет. */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { frames = 0; checkFrom = performance.now(); t0 = performance.now() / 1000; }
});

/* ==========================================================================
   ИЗМЕНЕНИЕ РАЗМЕРА
   ========================================================================== */
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const r = stage <= 0 ? dpr() : Math.min(dpr(), renderer.getPixelRatio());

    setRatio(r);
    renderer.setSize(w, h, false);

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    for (const composer of [torusComposer, bloomComposer, finalComposer]) composer.setSize(w, h);

    readScroll();
  }, 150);
}, { passive: true });
