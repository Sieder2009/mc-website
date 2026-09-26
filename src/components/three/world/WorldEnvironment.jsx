import { useMemo } from "react";
import * as THREE from "three";

// Shared look of the whole 3D world — sky, fog and light. Every asset is tuned
// against this one environment, so it stays the single source of truth.
// The palette leans on the site's "washi paper" cream so
// distance dissolves into the page instead of into a foreign sky colour.
export const WORLD = {
  paper: "#efe9db", // same as --c-bg
  fog: "#efe4d5",
  skyTop: "#cddbea",
  skyHorizon: "#f5ebdf",
  skyGround: "#e8dccb",
  sun: "#fff0d6",
  hemiSky: "#dbe7f3",
  hemiGround: "#b7a48c",
  fogDensity: 0.017,
  // the world's axes: the path runs down -Z from the gate at the origin
  sunDir: [-0.55, 0.62, 0.56],
};

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, -1.0, 1.0);
    vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.7, h));
    c = mix(c, uGround, smoothstep(0.0, -0.3, h));
    float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    c += uSun * (pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function SkyDome() {
  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color(WORLD.skyTop) },
      uHorizon: { value: new THREE.Color(WORLD.skyHorizon) },
      uGround: { value: new THREE.Color(WORLD.skyGround) },
      uSun: { value: new THREE.Color(WORLD.sun) },
      uSunDir: { value: new THREE.Vector3(...WORLD.sunDir) },
    }),
    []
  );

  return (
    <mesh renderOrder={-10} frustumCulled={false} scale={[1, 1, 1]}>
      <sphereGeometry args={[400, 32, 16]} />
      <shaderMaterial
        vertexShader={skyVertex}
        fragmentShader={skyFragment}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

export default function WorldEnvironment({ fogDensity = WORLD.fogDensity }) {
  return (
    <>
      <fogExp2 attach="fog" args={[WORLD.fog, fogDensity]} />
      <SkyDome />
      <hemisphereLight args={[WORLD.hemiSky, WORLD.hemiGround, 1.05]} />
      <directionalLight
        position={[WORLD.sunDir[0] * 20, WORLD.sunDir[1] * 20, WORLD.sunDir[2] * 20]}
        intensity={2.2}
        color={WORLD.sun}
      />
    </>
  );
}
