import * as THREE from 'three';
import { clamp, lerp } from './noise.js';

const WIND = `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec3 wP = ( modelMatrix * mvPosition ).xyz;
float baseY = __BASE__;
float hRef = __H__;
float hN = clamp( ( wP.y - baseY ) / hRef, 0.0, 1.5 );
float bend = pow( hN, 1.6 ) * uWind;
float gust = 0.55 + 0.45 * sin( uTime * 0.31 + wP.x * 0.045 + wP.z * 0.03 );
float ph = uTime * 1.15 + wP.x * 0.22 + wP.z * 0.19;
vec3 wDir = normalize( vec3( 1.0, 0.05, 0.34 ) );
mvPosition.xyz += wDir * bend * gust * ( 0.42 * sin( ph ) + 0.16 * sin( ph * 2.7 ) );
mvPosition.xyz += vec3( sin( uTime * 6.7 + wP.y * 3.1 + wP.x * 4.3 ), 0.5 * sin( uTime * 5.3 + wP.z * 3.9 ), cos( uTime * 7.1 + wP.x * 3.3 ) ) * uFlutter * ( 0.25 + hN );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

export function windify(mat, U, o = {}) {
  const opt = Object.assign({ key: 'w', flutter: 0, grow: true, backlight: false, base: 'object', height: 'ref', ref: 12 }, o);
  const uF = { value: opt.flutter }, uRef = { value: opt.ref };
  const baseExpr = opt.base === 'instance' ? 'aBase' : 'modelMatrix[3].y';
  const hExpr = opt.height === 'attr' ? 'max( aH, 0.02 )' : 'uRef';
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time; sh.uniforms.uWind = U.wind;
    sh.uniforms.uFlutter = uF; sh.uniforms.uRef = uRef;
    if (opt.grow) { sh.uniforms.uGrow = U.grow; sh.uniforms.uGrowColor = U.growColor; }
    if (opt.backlight) { sh.uniforms.uSunView = U.sunView; sh.uniforms.uBacklight = U.backlight; }
    let decl = 'varying float vGrowH;uniform float uTime;uniform float uWind;uniform float uFlutter;uniform float uRef;';
    if (opt.base === 'instance') decl += 'attribute float aBase;';
    if (opt.height === 'attr') decl += 'attribute float aH;';
    if (opt.grow) decl += 'attribute float aGrow;';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + decl)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrowH = ' + (opt.grow ? 'aGrow' : '1.0') + ';')
      .replace('#include <project_vertex>', WIND.replace('__BASE__', baseExpr).replace('__H__', hExpr));
    let fd = 'varying float vGrowH;', disc = '', em = '';
    if (opt.grow) {
      fd += 'uniform float uGrow;uniform vec3 uGrowColor;';
      disc = '\nif( vGrowH > uGrow ) discard;';
      em += '\nfloat gE = smoothstep( uGrow - 0.04, uGrow, vGrowH ) * step( 0.002, uGrow ) * ( 1.0 - step( 0.998, uGrow ) );\ntotalEmissiveRadiance += uGrowColor * gE * 3.0;';
    }
    if (opt.backlight) {
      fd += 'uniform vec3 uSunView;uniform float uBacklight;';
      em += '\nfloat bl = pow( clamp( dot( -normalize( normal ), normalize( uSunView ) ), 0.0, 1.0 ), 2.0 );\ntotalEmissiveRadiance += diffuseColor.rgb * bl * uBacklight;';
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + fd)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + disc)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + em);
  };
  mat.customProgramCacheKey = () => 'w_' + opt.key + opt.base + opt.height + (opt.grow ? 'g' : '') + (opt.backlight ? 'l' : '');
  mat.userData.uF = uF; mat.userData.uRef = uRef;
  return mat;
}

const STOPS = [
  { t: 0, hor: '#14343f', zen: '#04080e', sun: '#7fb0ff', key: '#6f92cc', ki: .75, hi: .26, si: .55 },
  { t: .28, hor: '#ff8a3d', zen: '#123c4e', sun: '#ffd39a', key: '#ffb066', ki: 3.2, hi: .50, si: 1 },
  { t: .62, hor: '#cfe6ea', zen: '#1f6f9e', sun: '#fff3d6', key: '#fff0d0', ki: 3.55, hi: .78, si: .85 },
  { t: 1, hor: '#eaf6f2', zen: '#2a86b8', sun: '#ffffff', key: '#ffffff', ki: 3.85, hi: .98, si: .70 }
];

export function createEngine(canvas, stage, U, opts) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  const webgl2 = renderer.capabilities.isWebGL2;
  const hdr = webgl2 && renderer.extensions.has('EXT_color_buffer_float');
  const TYPE = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const maxSamples = webgl2 ? (renderer.capabilities.maxSamples || 0) : 0;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color('#16323a'), .022);
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 4000);
  U.fogColor = { value: scene.fog.color };
  U.fogDensity = { value: .022 };

  const skyU = { uHor: { value: new THREE.Color('#ff8a3d') }, uZen: { value: new THREE.Color('#123c4e') }, uSunC: { value: new THREE.Color('#ffd39a') }, uSunDir: U.sunDir, uSunI: { value: 1 } };
  U.skyHor = skyU.uHor; U.skyZen = skyU.uZen; U.sunColor = skyU.uSunC;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 20), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform vec3 uHor,uZen,uSunC,uSunDir;uniform float uSunI;varying vec3 vDir;
    void main(){vec3 d=normalize(vDir);vec3 col=mix(uHor,uZen,pow(clamp(d.y,0.0,1.0),0.55));
    col=mix(col*0.42,col,smoothstep(-0.30,0.05,d.y));
    float sd=max(dot(d,normalize(uSunDir)),0.0);
    col+=uSunC*uSunI*(pow(sd,900.0)*26.0+pow(sd,26.0)*0.55+pow(sd,5.0)*0.13);
    col+=(fract(sin(dot(d.xy,vec2(12.9898,78.233)))*43758.5453)-0.5)*0.004;
    gl_FragColor=vec4(col,1.0);}`
  }));
  sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

  const keyTarget = new THREE.Object3D(); scene.add(keyTarget);
  const key = new THREE.DirectionalLight(0xffb066, 3.2);
  key.castShadow = true; key.target = keyTarget;
  key.shadow.camera.near = 1; key.shadow.camera.far = 600;
  key.shadow.bias = -.0006; key.shadow.normalBias = .05;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x38e6ff, .95); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffc98a, .32); scene.add(fill);
  const hemi = new THREE.HemisphereLight(0x2a6f8a, 0x1d2a1c, .5); scene.add(hemi);
  const amb = new THREE.AmbientLight(0x30443c, .18); scene.add(amb);

  const cA = new THREE.Color(), cB = new THREE.Color();
  const mix = (a, b, t, out) => { cA.set(a); cB.set(b); out.copy(cA).lerp(cB, t); return out; };
  const sunDir = U.sunDir.value;

  function applySky(P, focusY, span) {
    const t = P.sunEl;
    let i = 0; while (i < STOPS.length - 2 && t > STOPS[i + 1].t) i++;
    const s0 = STOPS[i], s1 = STOPS[i + 1], k = clamp((t - s0.t) / (s1.t - s0.t), 0, 1);
    mix(s0.hor, s1.hor, k, skyU.uHor.value); mix(s0.zen, s1.zen, k, skyU.uZen.value);
    mix(s0.sun, s1.sun, k, skyU.uSunC.value); mix(s0.key, s1.key, k, key.color);
    skyU.uSunI.value = lerp(s0.si, s1.si, k);
    const el = lerp(.035, 1.30, t), az = P.sunAz * Math.PI / 180;
    sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    const ext = clamp(span, 24, 260);
    keyTarget.position.set(0, focusY + P.height * .3, 0);
    key.position.copy(sunDir).multiplyScalar(ext * 2.4 + 80).add(keyTarget.position);
    const sc = key.shadow.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.far = ext * 6 + 200; sc.updateProjectionMatrix();
    key.intensity = lerp(s0.ki, s1.ki, k) * P.lightInt;
    hemi.intensity = lerp(s0.hi, s1.hi, k) * P.lightInt;
    hemi.color.copy(skyU.uZen.value).lerp(new THREE.Color(0xffffff), .25);
    rim.position.set(-sunDir.x * 90, focusY + 40, -sunDir.z * 90); rim.intensity = .95 * P.lightInt;
    fill.position.set(-sunDir.z * 60, focusY + 14, sunDir.x * 60); fill.intensity = .32 * P.lightInt;
    amb.intensity = .18 * P.lightInt;
    scene.fog.color.copy(skyU.uHor.value).lerp(skyU.uZen.value, .55).multiplyScalar(.8);
    scene.fog.density = P.fog; U.fogDensity.value = P.fog;
    renderer.shadowMap.needsUpdate = true;
  }

  function motes(count, range, color, size, speed, inten) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), seed = new Float32Array(count), sz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * range * .6;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * range; pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random(); sz[i] = size * (.5 + Math.random());
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(sz, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uPR: { value: 1 }, uRange: { value: range }, uSpeed: { value: speed }, uSway: { value: .9 }, uColor: { value: new THREE.Color(color) }, uInt: { value: inten }, uBase: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aSeed;attribute float aSize;uniform float uTime,uPR,uRange,uSpeed,uSway,uBase;varying float vB;
      void main(){vec3 p=position;float t=uTime*uSpeed+aSeed*37.0;p.y=uBase+mod(p.y+t*0.35,uRange);
      p.x+=sin(t*0.6+aSeed*6.28)*uSway;p.z+=cos(t*0.47+aSeed*4.1)*uSway;
      vec4 mv=modelViewMatrix*vec4(p,1.0);gl_PointSize=aSize*uPR*(260.0/max(0.001,-mv.z));
      gl_Position=projectionMatrix*mv;vB=0.35+0.65*pow(max(0.0,sin(uTime*2.1+aSeed*24.0)),2.0);}`,
      fragmentShader: `uniform vec3 uColor;uniform float uInt;varying float vB;
      void main(){float d=length(gl_PointCoord-0.5);float a=smoothstep(0.5,0.0,d);gl_FragColor=vec4(uColor*a*vB*uInt,a);}`
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts); return pts;
  }
  const pollen = motes(1500, 26, '#ffe9b8', 2.6, .5, 1.1);
  const flies = motes(140, 14, '#ffb020', 5, .16, 2.6);
  flies.material.uniforms.uSway.value = 1.6;

  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  quad.frustumCulled = false; postScene.add(quad);
  const VS = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
  const mkRT = s => new THREE.WebGLRenderTarget(2, 2, { type: TYPE, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: s > 0, samples: Math.min(s, maxSamples) });
  let Q = opts.quality;
  let sceneRT = mkRT(Q.msaa || 1), brightA = mkRT(0), brightB = mkRT(0), raysRT = mkRT(0);
  const brightMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uTh: { value: hdr ? .72 : .62 } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc;uniform float uTh;varying vec2 vUv;
    void main(){vec3 c=texture2D(tSrc,vUv).rgb;float l=dot(c,vec3(0.2126,0.7152,0.0722));float k=max(0.0,l-uTh)/max(l,1e-4);gl_FragColor=vec4(c*k*smoothstep(0.0,0.4,l),1.0);}` });
  const blurMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc;uniform vec2 uDir;varying vec2 vUv;
    void main(){vec3 s=texture2D(tSrc,vUv).rgb*0.227027;
    s+=texture2D(tSrc,vUv+uDir*1.3846).rgb*0.316216;s+=texture2D(tSrc,vUv-uDir*1.3846).rgb*0.316216;
    s+=texture2D(tSrc,vUv+uDir*3.2307).rgb*0.070270;s+=texture2D(tSrc,vUv-uDir*3.2307).rgb*0.070270;gl_FragColor=vec4(s,1.0);}` });
  const raysMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uSun: { value: new THREE.Vector2(.5, .5) }, uDensity: { value: .62 }, uDecay: { value: .94 }, uWeight: { value: .055 } }, vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc;uniform vec2 uSun;uniform float uDensity,uDecay,uWeight;varying vec2 vUv;
    void main(){vec2 uv=vUv;vec2 st=(uv-uSun)*(uDensity/24.0);vec3 s=vec3(0.0);float il=1.0;
    for(int i=0;i<24;i++){uv-=st;s+=texture2D(tSrc,clamp(uv,0.0,1.0)).rgb*il*uWeight;il*=uDecay;}gl_FragColor=vec4(s,1.0);}` });
  const compMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, uBloom: { value: .6 }, uRays: { value: .6 }, uSunVis: { value: 1 }, uExposure: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uGrain: { value: opts.grain }, uVig: { value: .42 }, uAspect: { value: 1 } },
    vertexShader: VS, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tScene,tBloom,tRays;uniform float uBloom,uRays,uSunVis,uExposure,uTime,uGrain,uVig,uAspect;uniform vec2 uRes;varying vec2 vUv;
    vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
    vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,step(0.0031308,c));}
    void main(){vec2 d=vUv-0.5;float r=length(d);vec2 ca=d*r*0.0035;vec3 base;
    base.r=texture2D(tScene,vUv+ca).r;base.g=texture2D(tScene,vUv).g;base.b=texture2D(tScene,vUv-ca).b;
    base+=texture2D(tBloom,vUv).rgb*uBloom;base+=texture2D(tRays,vUv).rgb*uRays*uSunVis;
    base=aces(base*uExposure);
    float v=smoothstep(1.18,0.34,length(d*vec2(uAspect,1.0)));base*=mix(1.0,v,uVig);
    float g=fract(sin(dot(vUv*uRes+uTime*60.0,vec2(12.9898,78.233)))*43758.5453);base+=(g-0.5)*uGrain;
    gl_FragColor=vec4(srgb(clamp(base,0.0,1.0)),1.0);}` });
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.clear(); renderer.render(postScene, postCam); }
  const sunW = new THREE.Vector3(), sunN = new THREE.Vector3();

  const HOME = { theta: .9, phi: 1.10 };
  const cam = { theta: HOME.theta, phi: HOME.phi, radius: 34, tTheta: HOME.theta, tPhi: HOME.phi, tRadius: 34, target: new THREE.Vector3(0, 6, 0), tTarget: new THREE.Vector3(0, 6, 0) };
  const pointers = new Map();
  let dragging = false, pinch = 0, lastInteract = performance.now();
  const hooks = { interact: () => {}, zoom: () => {} };
  const mark = () => { lastInteract = performance.now(); hooks.interact(); };
  canvas.addEventListener('pointerdown', e => {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true; canvas.classList.add('drag'); mark();
    if (pointers.size === 2) { const p = [...pointers.values()]; pinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
  });
  canvas.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId); if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); mark();
    if (pointers.size >= 2) {
      const p = [...pointers.values()], d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinch > 0 && d > 0) { cam.tRadius = clamp(cam.tRadius * (pinch / d), 3, 700); hooks.zoom(cam.tRadius); }
      pinch = d;
    } else { cam.tTheta -= dx * .006; cam.tPhi = clamp(cam.tPhi - dy * .005, .06, 1.53); }
  });
  const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; if (!pointers.size) { dragging = false; canvas.classList.remove('drag'); } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('pointerleave', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); mark(); cam.tRadius = clamp(cam.tRadius * Math.exp(clamp(e.deltaY, -160, 160) * .0011), 3, 700); hooks.zoom(cam.tRadius); }, { passive: false });

  function resetCamera() { cam.tTheta = HOME.theta; cam.tPhi = HOME.phi; mark(); }
  function updateCamera(dt, now, P, focusY, reduce) {
    if (P.autoRotate && !dragging && now - lastInteract > 2200) cam.tTheta += dt * .055;
    const k = Math.min(1, dt * 8);
    cam.theta += (cam.tTheta - cam.theta) * k; cam.phi += (cam.tPhi - cam.phi) * k; cam.radius += (cam.tRadius - cam.radius) * k;
    cam.tTarget.set(P.focusX || 0, focusY + P.height * .45, P.focusZ || 0);
    cam.target.lerp(cam.tTarget, Math.min(1, dt * 4));
    const breathe = reduce || dragging ? 0 : Math.sin(now * .00013) * .12, r = cam.radius + breathe;
    camera.position.set(cam.target.x + r * Math.sin(cam.phi) * Math.cos(cam.theta),
      Math.max(focusY + .4, cam.target.y + r * Math.cos(cam.phi)),
      cam.target.z + r * Math.sin(cam.phi) * Math.sin(cam.theta));
    camera.lookAt(cam.target);
    if (camera.fov !== P.fov) { camera.fov = P.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    U.sunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  }
  const rayO = new THREE.Vector3(), rayD = new THREE.Vector3(), ndc = new THREE.Vector3();
  function pointerRay(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, .5);
    ndc.unproject(camera);
    rayO.copy(camera.position); rayD.copy(ndc).sub(camera.position).normalize();
    return { o: rayO, d: rayD };
  }
  function resize() {
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    const pr = Math.min(devicePixelRatio || 1, Q.pr, opts.mobile ? 1.6 : 2);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const bw = Math.max(2, Math.floor(w * pr)), bh = Math.max(2, Math.floor(h * pr));
    sceneRT.setSize(bw, bh);
    brightA.setSize(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
    brightB.setSize(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
    raysRT.setSize(Math.max(2, bw >> 2), Math.max(2, bh >> 2));
    compMat.uniforms.uRes.value.set(bw, bh); compMat.uniforms.uAspect.value = w / h;
    pollen.material.uniforms.uPR.value = pr; flies.material.uniforms.uPR.value = pr;
  }
  function setQuality(q) {
    Q = q; key.shadow.mapSize.set(q.shadow, q.shadow);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    sceneRT.dispose(); sceneRT = mkRT(q.msaa || 1); resize(); renderer.shadowMap.needsUpdate = true;
  }
  function render(now, P) {
    renderer.info.reset();
    sky.position.copy(camera.position);
    renderer.setRenderTarget(sceneRT); renderer.clear(); renderer.render(scene, camera);
    if (P.bloom > .004 || P.rays) {
      brightMat.uniforms.tSrc.value = sceneRT.texture; pass(brightMat, brightA);
      const w = brightA.width, h = brightA.height;
      for (let i = 0; i < Q.blur; i++) {
        const s = 1 + i * 1.6;
        blurMat.uniforms.tSrc.value = brightA.texture; blurMat.uniforms.uDir.value.set(s / w, 0); pass(blurMat, brightB);
        blurMat.uniforms.tSrc.value = brightB.texture; blurMat.uniforms.uDir.value.set(0, s / h); pass(blurMat, brightA);
      }
      if (P.rays) {
        sunW.copy(camera.position).addScaledVector(sunDir, 900); sunN.copy(sunW).project(camera);
        raysMat.uniforms.tSrc.value = brightA.texture;
        raysMat.uniforms.uSun.value.set(sunN.x * .5 + .5, sunN.y * .5 + .5);
        pass(raysMat, raysRT);
        compMat.uniforms.uSunVis.value = (sunN.z < 1 ? 1 : 0) * clamp(1.2 - Math.hypot(sunN.x, sunN.y) * .45, 0, 1);
      } else compMat.uniforms.uSunVis.value = 0;
    }
    compMat.uniforms.tScene.value = sceneRT.texture; compMat.uniforms.tBloom.value = brightA.texture; compMat.uniforms.tRays.value = raysRT.texture;
    compMat.uniforms.uBloom.value = P.bloom; compMat.uniforms.uRays.value = P.rays ? .6 : 0; compMat.uniforms.uTime.value = now * .001;
    quad.material = compMat; renderer.setRenderTarget(null); renderer.clear(); renderer.render(postScene, postCam);
  }
  return {
    THREE, renderer, scene, camera, cam, key, pollen, flies, hooks, skyU,
    applySky, resize, setQuality, render, updateCamera, resetCamera, pointerRay,
    markShadows() { renderer.shadowMap.needsUpdate = true; },
    setParticles(n, base) { pollen.geometry.setDrawRange(0, Math.round(n)); pollen.material.uniforms.uBase.value = base; flies.material.uniforms.uBase.value = base; }
  };
}
