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
    void main(){
      vec2 p = vWp.xz * 0.8 + uFlow * uTime * 0.3;
      float e = 0.15; float h0 = hgt(p);
      vec3 N = normalize(vec3((hgt(p+vec2(e,0.0))-h0)*uWaves*0.35, 1.0, (hgt(p+vec2(0.0,e))-h0)*uWaves*0.35));
      vec3 V = normalize(vView);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      float dep = clamp(vDepth * 0.55, 0.0, 1.0);
      vec3 bottom = mix(vec3(0.32, 0.27, 0.18), vec3(0.04, 0.10, 0.09), dep);
      vec3 sky = mix(uSkyHor, uSkyZen, 0.5) * 0.7;
      vec3 col = mix(bottom, sky, clamp(fres*0.55 + 0.04, 0.0, 0.8));
      vec3 H = normalize(V + normalize(uSunDir));
      col += uSunColor * pow(max(dot(N, H), 0.0), 220.0) * 0.9;
      float foam = smoothstep(0.12, 0.0, vDepth) * (0.5 + 0.5*sin(p.x*6.0 + uTime*2.0));
      col = mix(col, vec3(0.85), clamp(foam*0.5, 0.0, 0.5));
      float alpha = mix(0.38, 0.85, clamp(dep + fres*0.35, 0.0, 1.0));
      float fd = length(vView);
      float fogF = 1.0 - exp(-uFogDensity*uFogDensity*fd*fd);
      col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));
      gl_FragColor = vec4(col, alpha);
    }`
  });
}
