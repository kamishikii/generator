import * as THREE from 'three';

const FRAG = `
uniform float uTime, uWaves, uFogDensity; uniform vec2 uFlow;
uniform vec3 uSunDir, uSunColor, uSkyHor, uSkyZen, uFogColor;
varying float vDepth; varying vec3 vWp; varying vec3 vView;
float hgt(vec2 p){ return sin(p.x*1.7+uTime*1.1)*.5 + sin(p.y*2.3-uTime*.9)*.35 + sin((p.x+p.y)*3.1+uTime*1.7)*.25; }
void main(){
  if (vDepth < 0.004) discard;
  vec2 flow = normalize(uFlow + vec2(0.001));
  vec2 p = vWp.xz * 0.8 + flow * uTime * 0.6;
  float e = 0.12, h0 = hgt(p);
  vec3 N = normalize(vec3((hgt(p+vec2(e,0.))-h0)*uWaves*.5, 1.0, (hgt(p+vec2(0.,e))-h0)*uWaves*.5));
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vView);
  float fres = pow(1.0 - max(dot(N,V),0.0), 5.0);
  float dep = clamp(vDepth / 2.5, 0.0, 1.0);
  vec3 shallow = vec3(0.13, 0.30, 0.26);
  vec3 deep    = vec3(0.02, 0.10, 0.14);
  vec3 body = mix(shallow, deep, dep);
  vec3 sky = mix(uSkyHor, uSkyZen, 0.5);
  vec3 col = mix(body, sky, clamp(fres*0.7, 0.0, 0.85));
  vec3 H = normalize(V + normalize(uSunDir));
  float crest = smoothstep(0.15, 0.75, h0*0.5+0.5);
  float spark = pow(max(dot(N,H),0.0), 240.0) * crest;
  col += uSunColor * spark * 1.8;
  float shore = smoothstep(0.12, 0.0, vDepth);
  col = mix(col, vec3(0.85,0.90,0.92), shore*0.35);
  float alpha = clamp(mix(0.35, 0.92, dep) + fres*0.2 + shore*0.2, 0.0, 0.95);
  float fd = length(vView);
  float fogF = 1.0 - exp(-uFogDensity*uFogDensity*fd*fd*0.5);
  col = mix(col, uFogColor, clamp(fogF,0.0,1.0));
  gl_FragColor = vec4(col, alpha);
}`;

export function createWaterMaterial(U) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: U.time, uWaves: { value: .6 }, uFlow: { value: new THREE.Vector2(.2, .1) },
      uSunDir: U.sunDir, uSunColor: U.sunColor, uSkyHor: U.skyHor, uSkyZen: U.skyZen,
      uFogColor: U.fogColor, uFogDensity: U.fogDensity
    },
    vertexShader: `
      attribute float aDepth; varying float vDepth; varying vec3 vWp; varying vec3 vView;
      void main(){ vDepth = aDepth; vec4 wp = modelMatrix * vec4(position,1.0); vWp = wp.xyz;
        vec4 mv = viewMatrix * wp; vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: FRAG
  });
}

// Вариант для просмотрщика: глубина приходит в COLOR_0 (vColor), а не в aDepth.
export function createWaterMaterialViewer(U) {
  const m = createWaterMaterial(U);
  m.vertexColors = true;
  m.vertexShader = `
    varying float vDepth; varying vec3 vWp; varying vec3 vView; varying vec3 vColor;
    void main(){ vColor = color; vDepth = color.r * 2.5;
      vec4 wp = modelMatrix * vec4(position,1.0); vWp = wp.xyz;
      vec4 mv = viewMatrix * wp; vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
  return m;
}
