import * as THREE from 'three';

/**
 * SceneGizmo — Interactive orientation widget.
 * Displays axes and allows clicking them to snap the camera to specific views.
 */
export class SceneGizmo {
    private renderer: THREE.WebGLRenderer;
    private camera: THREE.OrthographicCamera;
    private scene: THREE.Scene;
    private container: HTMLElement;
    private mainCamera: THREE.PerspectiveCamera;
    private onViewClick: (direction: THREE.Vector3) => void;

    private mouse = new THREE.Vector2();
    private raycaster = new THREE.Raycaster();
    private axes: THREE.Group;

    constructor(parent: HTMLElement, mainCamera: THREE.PerspectiveCamera, onViewClick: (direction: THREE.Vector3) => void) {
        this.container = document.createElement('div');
        this.container.style.cssText = `
            position: absolute; top: 10px; right: 10px;
            width: 100px; height: 100px; pointer-events: auto;
            cursor: pointer; user-select: none;
        `;
        parent.appendChild(this.container);

        this.mainCamera = mainCamera;
        this.onViewClick = onViewClick;

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(100, 100);
        this.renderer.setClearColor(0x000000, 0);
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        // Use Orthographic for the gizmo to avoid perspective distortion on axes
        this.camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 100);
        this.camera.position.z = 5;

        this.axes = new THREE.Group();
        this.scene.add(this.axes);

        // Positive Axes
        this.createAxis(new THREE.Vector3(1, 0, 0), 0xff3b3b, "X"); // Red
        this.createAxis(new THREE.Vector3(0, 1, 0), 0x3bff3b, "Y"); // Green
        this.createAxis(new THREE.Vector3(0, 0, 1), 0x3b3bff, "Z"); // Blue

        // Negative Axes (small grey circles)
        this.createAxis(new THREE.Vector3(-1, 0, 0), 0x888888, "-X", true);
        this.createAxis(new THREE.Vector3(0, -1, 0), 0x888888, "-Y", true);
        this.createAxis(new THREE.Vector3(0, 0, -1), 0x888888, "-Z", true);

        // Add interaction
        this.container.addEventListener('mousedown', (e) => this.handleClick(e));
    }

    private createAxis(dir: THREE.Vector3, color: number, label: string, isNegative = false) {
        const group = new THREE.Group();
        group.name = label;
        (group as any).direction = dir.clone();

        if (!isNegative) {
            // Line
            const lineGeom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                dir.clone().multiplyScalar(1)
            ]);
            const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: color, linewidth: 2 }));
            group.add(line);
        }

        // Handle/Cap
        const capGeom = new THREE.SphereGeometry(isNegative ? 0.08 : 0.15, 16, 16);
        const cap = new THREE.Mesh(capGeom, new THREE.MeshBasicMaterial({ color: color }));
        cap.position.copy(dir.clone().multiplyScalar(1));
        group.add(cap);

        this.axes.add(group);
    }

    private handleClick(e: MouseEvent) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.axes.children, true);

        if (intersects.length > 0) {
            // Find parent group with direction metadata
            let obj = intersects[0].object;
            while (obj.parent && !(obj as any).direction) {
                obj = obj.parent;
            }

            if ((obj as any).direction) {
                this.onViewClick((obj as any).direction);
            }
        }
    }

    public update() {
        // Sync rotation with main camera
        // Note: Gizmo camera lookAt should be inverse of main camera sense
        this.axes.quaternion.copy(this.mainCamera.quaternion).invert();
        this.renderer.render(this.scene, this.camera);
    }

    public onResize() {
        // Size is fixed 100x100
    }
}
