import { Component } from '../Component';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { serialize } from '../Decorators';
import { AssetDatabase } from '../AssetDatabase';
import { AssetImporter } from '../AssetImporter';

/**
 * Animator - Unity-style animation component
 */
export class Animator extends Component {
    @serialize public speed: number = 1.0;
    @serialize public loop: boolean = true;
    @serialize public playOnAwake: boolean = true;
    @serialize public currentAnimation: string | null = null;
    @serialize public modelPath: string | null = null; // Path to GLB/GLTF for clips
    @serialize public modelGuid: string | null = null;

    public animations: Map<string, THREE.AnimationClip> = new Map();
    private mixer: THREE.AnimationMixer | null = null;
    private currentAction: THREE.AnimationAction | null = null;

    public awake(): void {
        this.setupMixer();
        const resolvedModelPath = this.resolveModelReference();
        if (resolvedModelPath) {
            this.loadModelClips(resolvedModelPath);
        }
    }

    private setupMixer(): void {
        if (this.gameObject.object3D && !this.mixer) {
            this.mixer = new THREE.AnimationMixer(this.gameObject.object3D);
        }
    }

    public clearAnimations(resetCurrentAnimation: boolean = false): void {
        this.stop();
        this.animations.clear();
        if (resetCurrentAnimation) {
            this.currentAnimation = null;
        }
    }

    public loadModelClips(path: string): void {
        this.modelPath = path;
        this.modelGuid = AssetDatabase.getInstance().getGuid(path) ?? this.modelGuid ?? null;
        this.clearAnimations(false);

        if (!AssetImporter.shouldImportModelAnimations(path)) {
            return;
        }

        const loader = new GLTFLoader();
        loader.load(AssetImporter.getVersionedAssetUrl(path), (gltf) => {
            gltf.animations.forEach(clip => {
                this.addAnimation(clip.name, clip);
            });
            console.log(`Loaded ${gltf.animations.length} animations from ${path}`);

            if (this.playOnAwake && this.currentAnimation) {
                this.play(this.currentAnimation);
            } else if (this.playOnAwake && gltf.animations.length > 0) {
                this.play(gltf.animations[0].name);
            }
        });
    }

    public addAnimation(name: string, clip: THREE.AnimationClip): void {
        this.animations.set(name, clip);
    }

    public play(name: string): void {
        if (!this.mixer) return;

        const clip = this.animations.get(name);
        if (!clip) {
            console.warn(`Animation "${name}" not found`);
            return;
        }

        // Stop current animation
        if (this.currentAction) {
            this.currentAction.stop();
        }

        // Play new animation
        this.currentAction = this.mixer.clipAction(clip);
        this.currentAction.setLoop(this.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        this.currentAction.timeScale = this.speed;
        this.currentAction.play();
        this.currentAnimation = name;
    }

    public stop(): void {
        if (this.currentAction) {
            this.currentAction.stop();
            this.currentAction = null;
            this.currentAnimation = null;
        }
    }

    public pause(): void {
        if (this.currentAction) {
            this.currentAction.paused = true;
        }
    }

    public resume(): void {
        if (this.currentAction) {
            this.currentAction.paused = false;
        }
    }

    public setSpeed(speed: number): void {
        this.speed = speed;
        if (this.currentAction) {
            this.currentAction.timeScale = speed;
        }
    }

    public update(deltaTime: number): void {
        if (this.mixer) {
            this.mixer.update(deltaTime);
        }
    }

    public serialize(): any {
        return {
            type: 'Animator',
            data: {
                speed: this.speed,
                loop: this.loop,
                playOnAwake: this.playOnAwake,
                currentAnimation: this.currentAnimation,
                modelPath: this.modelPath,
                modelGuid: this.modelGuid
            }
        };
    }

    public deserialize(data: any): void {
        this.speed = data.speed ?? 1.0;
        this.loop = data.loop !== undefined ? data.loop : true;
        this.playOnAwake = data.playOnAwake !== undefined ? data.playOnAwake : true;
        this.currentAnimation = data.currentAnimation ?? null;
        this.modelPath = data.modelPath ?? null;
        this.modelGuid = data.modelGuid ?? null;
        const resolvedModelPath = this.resolveModelReference();
        if (resolvedModelPath) {
            this.loadModelClips(resolvedModelPath);
        }
    }

    public onDestroy(): void {
        this.stop();
        this.mixer = null;
    }

    private resolveModelReference(): string | null {
        if (this.modelGuid) {
            const guidPath = AssetDatabase.getInstance().getPath(this.modelGuid);
            if (guidPath) {
                this.modelPath = guidPath;
                return guidPath;
            }
        }

        return this.modelPath;
    }
}
