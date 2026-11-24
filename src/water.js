import * as THREE from 'three';

export function createWaterMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.time, uSun: U.sunDir, uSunColor: U.sunColor, uHor: U.skyHor, uZen: U.skyZen,
      uFogColor: U.fogColor, uFogDensity: U.fogDensity,
      uWaves: { value: .6 }, uFlow: { value: new THREE.Vector2(1, .25) },
      uShallow: { value: new THREE.Color('#4b9c86') }, uDeep: { value: new THREE.Color('#0a2c40') }
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute float aDepth;
      varying float vD; varying vec3 vW; varying float vDist;
      void main(){
        vD = aDepth;
        vec4 w = modelMatrix * vec4(position,1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime,uWaves,uFogDensity;
      uniform vec3 uSun,uSunColor,uHor,uZen,uFogColor,uShallow,uDeep;
      uniform vec2 uFlow;
      varying float vD; varying vec3 vW; varying float vDist;
      void main(){
        if(vD <= 0.014) discard;
        vec2 f = uFlow*uTime*0.35;
        float a1 = sin((vW.x*0.55+vW.z*0.31)+uTime*1.25+f.x);
        float a2 = sin((vW.x*-0.37+vW.z*0.72)-uTime*0.95+f.y);
        float a3 = sin((vW.x*1.9+vW.z*1.3)+uTime*2.4);
        float amp = uWaves*(0.05+0.05*smoothstep(0.0,2.0,vD));
        vec3 N = normalize(vec3((a1*0.6+a2*0.4+a3*0.18)*amp*6.0,1.0,(a2*0.6-a1*0.35+a3*0.2)*amp*6.0));
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0-clamp(dot(N,V),0.0,1.0),4.0);
        vec3 sky = mix(uHor,uZen,0.45);
        vec3 col = mix(mix(uShallow,uDeep,smoothstep(0.0,2.6,vD)), sky, fres*0.72);
        vec3 H = normalize(V+normalize(uSun));
        col += uSunColor*pow(max(dot(N,H),0.0),240.0)*3.2;
        col += uSunColor*pow(max(dot(N,H),0.0),24.0)*0.10;
        float shore = smoothstep(0.36,0.02,vD);
        float foam = shore*(0.45+0.55*sin(vW.x*3.1+vW.z*2.7+uTime*2.2));
        col += vec3(0.86,0.93,0.96)*max(0.0,foam)*0.6;
        float alpha = max(mix(0.58,0.94,smoothstep(0.0,1.3,vD)), shore*0.85);
        float fog = 1.0-exp(-pow(vDist*uFogDensity,2.0));
        col = mix(col,uFogColor,clamp(fog,0.0,1.0));
        gl_FragColor = vec4(col,alpha);
      }`
  });
}
