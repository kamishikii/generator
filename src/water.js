import * as THREE from 'three';

export function createWater(U) {
  const uniforms = {
    uTime: U.time, uSun: U.sunDir, uSunColor: U.sunColor, uHor: U.skyHor, uZen: U.skyZen,
    uFogColor: U.fogColor, uFogDensity: U.fogDensity,
    uHeight: { value: null }, uSize: { value: 200 }, uHMin: { value: -10 }, uHMax: { value: 10 },
    uWaterY: { value: 0 }, uWaves: { value: .6 }, uFlow: { value: new THREE.Vector2(1, 0) },
    uShallow: { value: new THREE.Color('#3f8f7a') }, uDeep: { value: new THREE.Color('#0b2f43') }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW;varying float vDist;
    void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;
    vec4 mv=viewMatrix*w;vDist=-mv.z;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `
    uniform float uTime,uSize,uHMin,uHMax,uWaterY,uWaves,uFogDensity;
    uniform sampler2D uHeight;uniform vec3 uSun,uSunColor,uHor,uZen,uFogColor,uShallow,uDeep;uniform vec2 uFlow;
    varying vec3 vW;varying float vDist;
    void main(){
      vec2 uv=vW.xz/uSize+0.5;
      if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) discard;
      float th=mix(uHMin,uHMax,texture2D(uHeight,uv).r);
      float depth=uWaterY-th;
      if(depth<=0.008) discard;
      vec2 f=uFlow*uTime*0.35;
      float a1=sin((vW.x*0.55+vW.z*0.31)+uTime*1.25+f.x);
      float a2=sin((vW.x*-0.37+vW.z*0.72)-uTime*0.95+f.y);
      float a3=sin((vW.x*1.9+vW.z*1.3)+uTime*2.4);
      float amp=uWaves*(0.055+0.05*smoothstep(0.0,2.0,depth));
      vec3 N=normalize(vec3((a1*0.6+a2*0.4+a3*0.18)*amp*6.0,1.0,(a2*0.6-a1*0.35+a3*0.2)*amp*6.0));
      vec3 V=normalize(cameraPosition-vW);
      float fres=pow(1.0-clamp(dot(N,V),0.0,1.0),4.0);
      vec3 sky=mix(uHor,uZen,0.45);
      vec3 base=mix(uShallow,uDeep,smoothstep(0.0,2.6,depth));
      vec3 col=mix(base,sky,fres*0.72);
      vec3 H=normalize(V+normalize(uSun));
      col+=uSunColor*pow(max(dot(N,H),0.0),240.0)*3.2;
      col+=uSunColor*pow(max(dot(N,H),0.0),24.0)*0.10;
      float shore=smoothstep(0.34,0.02,depth);
      float foam=shore*(0.45+0.55*sin(vW.x*3.1+vW.z*2.7+uTime*2.2));
      col+=vec3(0.85,0.92,0.95)*max(0.0,foam)*0.55;
      float alpha=mix(0.58,0.94,smoothstep(0.0,1.3,depth));
      alpha=max(alpha,shore*0.85);
      float fog=1.0-exp(-pow(vDist*uFogDensity,2.0));
      col=mix(col,uFogColor,clamp(fog,0.0,1.0));
      gl_FragColor=vec4(col,alpha);
    }`
  });
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false;
  function update(P, heightTex, hMin, hMax) {
    mesh.visible = P.water;
    uniforms.uHeight.value = heightTex;
    uniforms.uSize.value = P.tsize;
    uniforms.uHMin.value = hMin; uniforms.uHMax.value = hMax;
    uniforms.uWaterY.value = P.waterLevel;
    uniforms.uWaves.value = P.waves;
    uniforms.uFlow.value.set(P.river ? 1 : .2, P.river ? .25 : .1);
    mesh.scale.set(P.tsize, 1, P.tsize);
    mesh.position.y = P.waterLevel;
  }
  return { mesh, uniforms, update, material: mat };
}
