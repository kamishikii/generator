import * as THREE from 'three';

export function createWaterMaterial(U) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: U.time, uWaves: { value: .6 }, uFlow: { value: new THREE.Vector2(.2, .1) },
      uSunDir: U.sunDir, uSunColor: U.sunColor, uSkyHor: U.skyHor, uSkyZen: U.skyZen,
      uFogColor: U.fogColor, uFogDensity: U.fogDensity
    },
    vertexShader: `attribute float aDepth; varying float vDepth; varying vec3 vWp; varying vec3 vView;
    void main(){ vDepth = aDepth; vec4 wp = modelMatrix * vec4(position, 1.0); vWp = wp.xyz;
      vec4 mv = viewMatrix * wp; vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uWaves, uFogDensity; uniform vec2 uFlow;
    uniform vec3 uSunDir, uSunColor, uSkyHor, uSkyZen, uFogColor;
    varying float vDepth; varying vec3 vWp; varying vec3 vView;
    float hgt(vec2 p){ return sin(p.x*1.7+uTime*1.1)*.5 + sin(p.y*2.3-uTime*.9)*.35 + sin((p.x+p.y)*3.1+uTime*1.7)*.25; }
    float streak(vec2 p){
      float s = sin(p.x*2.2 + uTime*1.6)*.5 + sin(p.y*5.5 - uTime*2.2)*.3 + sin((p.x*0.7+p.y)*8.0 + uTime*2.6)*.2;
      return smoothstep(0.45, 0.85, s*0.5+0.5);
    }
    void main(){
      vec2 flow = normalize(uFlow + vec2(0.001));
      vec2 p = vWp.xz * 0.8 + flow * uTime * 0.6;
      float e = 0.12; float h0 = hgt(p);
      vec3 N = normalize(vec3((hgt(p+vec2(e,0.0))-h0)*uWaves*0.5, 1.0, (hgt(p+vec2(0.0,e))-h0)*uWaves*0.5));
      vec3 V = normalize(vView);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      float dep = clamp(vDepth * 0.5, 0.0, 1.0);
      vec3 bottom = mix(vec3(0.30, 0.26, 0.18), vec3(0.03, 0.09, 0.10), dep);
      vec3 body = mix(vec3(0.05, 0.16, 0.18), vec3(0.02, 0.10, 0.14), dep);
      vec3 sky = mix(uSkyHor, uSkyZen, 0.5) * 0.8;
      vec3 col = mix(mix(bottom, body, 0.65), sky, clamp(fres*0.6 + 0.05, 0.0, 0.85));
      vec3 H = normalize(V + normalize(uSunDir));
      float spark = pow(max(dot(N, H), 0.0), 300.0);
      col += uSunColor * spark * 1.6;
      float st = streak(p * 1.4) * (0.25 + 0.5*dep);
      float shore = smoothstep(0.18, 0.0, vDepth);
      float foam = clamp(st*0.5 + shore*0.8, 0.0, 1.0);
      col = mix(col, vec3(0.88, 0.92, 0.94), foam*0.7);
      float alpha = mix(0.45, 0.9, clamp(dep + fres*0.35 + foam*0.3, 0.0, 1.0));
      float fd = length(vView);
      float fogF = 1.0 - exp(-uFogDensity*uFogDensity*fd*fd);
      col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
      gl_FragColor = vec4(col, alpha);
    }`
  });
}
