"use client";
import { useRef, useEffect, useState } from "react";
export default function ExecutionScene({ steps, selected, onSelect }) {
  const mount = useRef(null),
    engine = useRef(null),
    callback = useRef(onSelect);
  callback.current = onSelect;
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let disposed = false,
      cleanup = () => {};
    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } =
          await import("three/addons/controls/OrbitControls.js");
        if (disposed) return;
        const host = mount.current,
          scene = new THREE.Scene();
        scene.background = new THREE.Color("#edf2fa");
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
        });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        host.appendChild(renderer.domElement);
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
        camera.position.set(3.6, 5, 8.8);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 0, 0.8);
        controls.enablePan = false;
        controls.minDistance = 6;
        controls.maxDistance = 22;
        controls.maxPolarAngle = Math.PI * 0.74;
        scene.add(new THREE.HemisphereLight(0xffffff, 0x596e8f, 2.7));
        const light = new THREE.DirectionalLight(0xffffff, 3);
        light.position.set(4, 7, 5);
        scene.add(light);
        const grid = new THREE.GridHelper(24, 24, 0xc1ccdf, 0xe0e6f0);
        grid.position.y = -1.35;
        scene.add(grid);
        const group = new THREE.Group();
        scene.add(group);
        const raycaster = new THREE.Raycaster(),
          pointer = new THREE.Vector2();
        const click = (e) => {
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            (-(e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycaster.setFromCamera(pointer, camera);
          const hits = raycaster.intersectObjects(group.children, true);
          const hit = hits.find((h) => h.object.userData.step);
          if (hit) callback.current(hit.object.userData.step);
        };
        renderer.domElement.addEventListener("click", click);
        const observer = new ResizeObserver(() => {
          const w = host.clientWidth,
            h = host.clientHeight;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        });
        observer.observe(host);
        let frame;
        function draw() {
          frame = requestAnimationFrame(draw);
          controls.update();
          renderer.render(scene, camera);
        }
        draw();
        engine.current = { THREE, group, camera, controls };
        cleanup = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          controls.dispose();
          group.traverse((o) => {
            o.geometry?.dispose();
            if (o.material) {
              o.material.map?.dispose();
              o.material.dispose();
            }
          });
          renderer.dispose();
          renderer.domElement.remove();
          engine.current = null;
        };
      } catch {
        setAvailable(false);
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  useEffect(() => {
    if (!available) return;
    let frame;
    const sync = () => {
      const e = engine.current;
      if (!e) {
        frame = requestAnimationFrame(sync);
        return;
      }
      const { THREE, group } = e;
      while (group.children.length) {
        const child = group.children[0];
        child.traverse((o) => {
          o.geometry?.dispose();
          o.material?.map?.dispose();
          o.material?.dispose();
        });
        group.remove(child);
      }
      const visible = steps.slice(-16);
      const positions = visible.map(
        (s, i) =>
          new THREE.Vector3(
            ((i % 4) - 1.5) * 2.05,
            Math.sin(i * 0.8) * 0.45,
            Math.floor(i / 4) * 2 - 2,
          ),
      );
      visible.forEach((s, i) => {
        const color =
          s.status === "rejected"
            ? 0xa35b64
            : s.status === "running"
              ? 0x2c83bf
              : 0x42658f;
        const node = new THREE.Mesh(
          new THREE.IcosahedronGeometry(s.id === selected ? 0.54 : 0.44, 1),
          new THREE.MeshStandardMaterial({
            color,
            metalness: 0.32,
            roughness: 0.3,
            emissive: s.status === "running" ? 0x123c64 : 0x000000,
          }),
        );
        node.position.copy(positions[i]);
        node.userData.step = s.id;
        group.add(node);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.58, 0.015, 8, 48),
          new THREE.MeshBasicMaterial({
            color: s.id === selected ? 0x203e67 : 0xb8c7dd,
          }),
        );
        ring.position.copy(positions[i]);
        ring.rotation.x = -Math.PI / 2;
        group.add(ring);
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 64;
        const context = canvas.getContext("2d");
        context.fillStyle = "#263d5b";
        context.font = "600 44px sans-serif";
        context.textAlign = "center";
        context.fillText(String(steps.indexOf(s) + 1).padStart(2, "0"), 64, 49);
        const texture = new THREE.CanvasTexture(canvas);
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: texture, depthTest: false }),
        );
        label.userData.step = s.id;
        label.scale.set(1.1, 0.55, 1);
        label.position.copy(positions[i]).add(new THREE.Vector3(0, 1, 0));
        group.add(label);
        if (i) {
          const from = positions[i - 1],
            to = positions[i],
            direction = new THREE.Vector3().subVectors(to, from);
          const line = new THREE.Mesh(
            new THREE.CylinderGeometry(0.017, 0.017, direction.length(), 8),
            new THREE.MeshBasicMaterial({ color: 0xa8bad3 }),
          );
          line.position.copy(from).add(to).multiplyScalar(0.5);
          line.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.normalize(),
          );
          group.add(line);
        }
      });
    };
    sync();
    return () => cancelAnimationFrame(frame);
  }, [steps, selected, available]);
  return (
    <div className="execution-scene">
      <div
        className="scene-canvas"
        ref={mount}
        aria-label="Interactive 3D view of actual backend steps"
        role="img"
      />
      {!available && (
        <p className="scene-fallback">
          3D rendering is unavailable on this device. Every real event remains
          available below.
        </p>
      )}
      {!steps.length && (
        <div className="scene-empty">Waiting for server events</div>
      )}
      <span className="scene-help">
        Drag to orbit · Scroll to zoom · Select a node
      </span>
    </div>
  );
}
