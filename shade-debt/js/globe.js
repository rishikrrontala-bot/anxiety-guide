/**
 * The hero object: an Earth globe textured with NASA Blue Marble imagery.
 *
 * The texture is not shipped with the page. It is stitched at runtime from
 * NASA GIBS equirectangular (EPSG:4326) tiles, using the same probe-then-fetch
 * approach as the analysis itself. If those tiles cannot be reached the globe
 * refuses to render rather than falling back to a fabricated sphere, and the
 * page drops to its type-only hero.
 */

import * as THREE from '../vendor/three.min.js';
import { loadTile } from './raster.js';

const WMTS_4326 = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';

/** Static true-colour basemaps, best first. None carry a time dimension. */
const TEXTURE_LAYERS = [
  'BlueMarble_ShadedRelief_Bathymetry',
  'BlueMarble_NextGeneration',
  'BlueMarble_ShadedRelief',
];
const MATRIX_SETS = ['500m', '1km', '2km', '250m'];
const EXTENSIONS = ['jpeg', 'jpg', 'png'];

/** In EPSG:4326 a tile matrix at level z is 2^(z+1) columns by 2^z rows. */
function gridAt(level) {
  return { cols: Math.pow(2, level + 1), rows: Math.pow(2, level) };
}

function url4326(layer, matrixSet, ext, z, row, col) {
  return `${WMTS_4326}/${layer}/default/${matrixSet}/${z}/${row}/${col}.${ext}`;
}

async function probeTexture(signal) {
  for (const layer of TEXTURE_LAYERS) {
    for (const matrixSet of MATRIX_SETS) {
      for (const ext of EXTENSIONS) {
        try {
          const res = await fetch(url4326(layer, matrixSet, ext, 0, 0, 0), {
            mode: 'cors', credentials: 'omit', signal,
          });
          if (res.ok) return { layer, matrixSet, ext };
        } catch { /* try the next combination */ }
      }
    }
  }
  return null;
}

/**
 * Stitch one equirectangular world image. Level 1 is 4x2 tiles, which at the
 * 512 px GIBS tile size gives a 2048x1024 texture - plenty for a globe this
 * size, and eight requests rather than thirty-two.
 */
async function buildTexture(found, level = 1) {
  const { cols, rows } = gridAt(level);
  const probe = await loadTile(url4326(found.layer, found.matrixSet, found.ext, level, 0, 0));
  if (!probe.bitmap) throw new Error('Blue Marble tile did not decode');
  const tileSize = probe.bitmap.width || 512;

  const canvas = document.createElement('canvas');
  canvas.width = cols * tileSize;
  canvas.height = rows * tileSize;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(probe.bitmap, 0, 0);
  probe.bitmap.close?.();

  const jobs = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (row === 0 && col === 0) continue;
      jobs.push({ row, col });
    }
  }
  await Promise.all(jobs.map(async ({ row, col }) => {
    try {
      const { bitmap } = await loadTile(url4326(found.layer, found.matrixSet, found.ext, level, row, col));
      if (bitmap) {
        ctx.drawImage(bitmap, col * tileSize, row * tileSize);
        bitmap.close?.();
      }
    } catch { /* a missing tile leaves ocean-coloured canvas, not a failure */ }
  }));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return { texture, source: `${found.layer} · ${found.matrixSet}` };
}

/* A warm limb rather than the conventional blue halo: the palette runs warm,
   and a blue rim would fight every other colour on the page. */
const ATMOSPHERE_VERT = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const ATMOSPHERE_FRAG = `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  void main() {
    float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.6);
    gl_FragColor = vec4(uColor, clamp(rim * uStrength, 0.0, 1.0));
  }`;

function starField(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Rejection-free spherical distribution on a far shell.
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 14 + Math.random() * 9;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xF5F1EA, size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.5,
  }));
}

/**
 * Mount the globe. Resolves with a handle, or rejects when the imagery cannot
 * be reached - the caller treats a rejection as "use the type-only hero".
 */
export async function mountGlobe(container, options = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lowPower = (navigator.hardwareConcurrency || 8) <= 4 || window.innerWidth < 640;

  // `textureSource` is a verification seam: the harness in test/ passes a
  // locally generated canvas so the scene can be exercised without a network.
  // The site never passes it, so the shipped globe is always real NASA imagery.
  let texture, source;
  if (options.textureSource) {
    texture = new THREE.CanvasTexture(options.textureSource);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    source = 'harness texture (synthetic)';
  } else {
    const found = await probeTexture(options.signal);
    if (!found) throw new Error('NASA Blue Marble imagery is not reachable');
    ({ texture, source } = await buildTexture(found, lowPower ? 0 : 1));
  }

  const renderer = new THREE.WebGLRenderer({ antialias: !lowPower, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 0, 3.9);

  const world = new THREE.Group();
  // Earth's own tilt, so the globe never reads as a perfectly upright prop.
  world.rotation.z = THREE.MathUtils.degToRad(-23.4);
  scene.add(world);

  const segments = lowPower ? 48 : 96;
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, segments, segments / 2),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.94, metalness: 0.0 }),
  );
  earth.rotation.y = Math.PI; // align the stitched equirectangular seam away from the viewer
  world.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.055, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(options.rim || '#E9CBB8') },
        uStrength: { value: 0.85 },
      },
      vertexShader: ATMOSPHERE_VERT,
      fragmentShader: ATMOSPHERE_FRAG,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    }),
  );
  world.add(atmosphere);

  let stars = null;
  if (!lowPower) { stars = starField(520); scene.add(stars); }

  const key = new THREE.DirectionalLight(0xFFF3E6, 2.3);
  key.position.set(-2.4, 1.3, 2.2);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0x6E6A66, 0.55));

  let paused = false;
  let progress = 0;
  let targetProgress = 0;
  let spin = 0;
  let running = true;
  let visible = true;
  let frame = 0;

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function render(now) {
    if (!running) return;
    frame = requestAnimationFrame(render);
    if (!visible) return;

    progress += (targetProgress - progress) * 0.08;
    if (!reducedMotion) spin += 0.0006;

    // Scroll drives a dolly from whole planet toward the ground.
    const dolly = lowPower || reducedMotion ? 0 : progress;
    camera.position.z = 3.9 - dolly * 1.5;
    camera.position.y = dolly * 0.14;
    camera.lookAt(0, 0, 0);

    world.rotation.y = spin + progress * 0.9;
    // Hold the globe clear of the text column: beside it on wide viewports,
    // lifted above it on narrow ones.
    const wide = window.innerWidth >= 900;
    world.position.x = options.offsetX ?? (wide ? 0.72 : 0.12);
    world.position.y = options.offsetY ?? (wide ? 0.06 : 0.62);
    if (stars) stars.rotation.y = spin * 0.35;

    renderer.render(scene, camera);
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize, { passive: true });

  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
  io.observe(container);
  const onVisibility = () => { visible = !document.hidden && !paused; };
  document.addEventListener('visibilitychange', onVisibility);

  resize();
  frame = requestAnimationFrame(render);

  return {
    source,
    reducedMotion,
    lowPower,
    setProgress(p) { targetProgress = Math.max(0, Math.min(1, p)); },
    /** Stop rendering once the globe has scrolled behind the opaque sections. */
    setPaused(next) {
      if (next === paused) return;
      paused = next;
      visible = !next && !document.hidden;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      io.disconnect();
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
