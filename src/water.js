import * as THREE from 'three';

export function createWaterMaterial(U) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: U.time, uWaves: { value: .6 }, uFlow: { value: new THREE.Vector2(.2, .1) },
      uSunDir: U.sunDir, uSunColor: U.sunColor, uSkyHor: U.skyHor, uSkyZen: U.skyZen,
      uFogColor: U.fogColor, uFogDensity: U.fogDensity,
      tBottom: { value: null }, tHeight: { value: null }, uBottomUv: { value: 1 / 260 }
    },
    vertexShader: `attribute float aDepth; uniform float uTime, uWaves;
    varying float vDepth; varying vec3 vWp; varying vec3 vView;
    void main(){ vDepth = aDepth; vec4 wp = modelMatrix * vec4(position, 1.0);
      float g = step(0.05, aDepth);
      wp.y += g * uWaves * 0.06 * ( sin(wp.x*0.7+uTime*1.3)*0.5 + sin(wp.z*0.9-uTime*1.1)*0.35 + sin((wp.x+wp.z)*0.45+uTime*0.7)*0.4 );
      vWp = wp.xyz;
      vec4 mv = viewMatrix * wp; vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uWaves, uFogDensity, uBottomUv; uniform vec2 uFlow;
    uniform vec3 uSunDir, uSunColor, uSkyHor, uSkyZen, uFogColor;
    uniform sampler2D tBottom, tHeight;
    varying float vDepth; varying vec3 vWp; varying vec3 vView;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a*vnoise(p); p *= 2.17; a *= 0.5; } return s; }
    vec3 waveNormal(vec2 p, float t, float amp, float det){
      vec2 g = vec2(0.0);
      g += vec2( 0.62, 0.31) * cos(dot(p, vec2( 0.62, 0.31)) * 3.1  + t * 1.9) * 0.45;
      g += vec2(-0.41, 0.55) * cos(dot(p, vec2(-0.41, 0.55)) * 4.7  - t * 1.5) * 0.30;
      g += vec2( 0.18,-0.72) * cos(dot(p, vec2( 0.18,-0.72)) * 7.3  + t * 2.6) * 0.18;
      g += vec2( 0.83,-0.24) * cos(dot(p, vec2( 0.83,-0.24)) * 11.0 - t * 3.4) * 0.10;
      float e = 0.35;
      float n0 = fbm2(p * 2.0 + t * vec2(0.11, 0.07));
      g += vec2(fbm2(p * 2.0 + vec2(e, 0.0) + t * vec2(0.11, 0.07)) - n0,
                fbm2(p * 2.0 + vec2(0.0, e) + t * vec2(0.11, 0.07)) - n0) * (det / e) * 2.2;
      return normalize(vec3(-g.x * amp, 1.0, -g.y * amp));
    }
    void main(){
      vec2 huv = vWp.xz * uBottomUv + 0.5;
      float bed = texture2D(tHeight, huv).r;
      float depth = vWp.y - bed;
      if (depth <= 0.004) discard;
      vec3 V = normalize(vView);
      float dist = length(vView);
      float lod = 1.0 / (1.0 + dist * 0.03);
      vec2 flow = normalize(uFlow + vec2(0.0001));
      vec2 p = vWp.xz * 0.35 + flow * uTime * 0.25;
      vec3 N = waveNormal(p, uTime, uWaves * (0.35 + 0.65 * lod), lod);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      vec3 R = reflect(-V, N);
      vec3 sky = mix(uSkyHor, uSkyZen, pow(clamp(R.y, 0.0, 1.0), 0.55));
      float sd = max(dot(R, normalize(uSunDir)), 0.0);
      sky += uSunColor * (pow(sd, 600.0) * 18.0 + pow(sd, 32.0) * 0.35);
      float dep = clamp(depth * 0.45, 0.0, 1.0);
      vec2 buv = huv + N.xz * (0.35 * (1.0 - dep));
      vec3 bottom = pow(texture2D(tBottom, buv).rgb, vec3(2.2));
      vec3 absorb = exp(-depth * vec3(0.45, 0.22, 0.16));
      vec3 scatter = vec3(0.05, 0.16, 0.17);
      vec3 water = bottom * absorb + scatter * (1.0 - absorb);
      vec3 col = mix(water, sky, clamp(fres, 0.0, 1.0));
      vec3 H = normalize(V + normalize(uSunDir));
      col += uSunColor * pow(max(dot(N, H), 0.0), 350.0) * 2.2;
      float shore = 1.0 - smoothstep(0.03, 0.55, depth);
      float fn = fbm2(vWp.xz * 1.7 + flow * uTime * 0.5);
      float foam = clamp(shore * smoothstep(0.45, 0.85, fn + shore * 0.3), 0.0, 1.0);
      col = mix(col, vec3(0.90, 0.95, 0.96), foam * 0.85);
      float alpha = clamp(smoothstep(0.0, 0.10, depth) * mix(0.6, 0.96, dep) + foam * 0.5, 0.0, 1.0);
      float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
      gl_FragColor = vec4(col, alpha);
    }`
  });
}
