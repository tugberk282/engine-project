import { Component } from '../Component';
import * as THREE from 'three';
import { serialize } from '../Decorators';
import { AssetImporter } from '../AssetImporter';
import { AssetDatabase } from '../AssetDatabase';

export class AudioSource extends Component {
    @serialize public clipPath: string | null = null;
    @serialize public clipGuid: string | null = null;
    @serialize public volume: number = 1.0;
    @serialize public pitch: number = 1.0;
    @serialize public loop: boolean = false;
    @serialize public playOnAwake: boolean = true;
    @serialize public spatial: boolean = true;

    private audio: any = null;
    private buffer: AudioBuffer | null = null;

    public async awake(): Promise<void> {
        const resolvedClipPath = this.resolveClipReference();
        if (resolvedClipPath) {
            await this.loadClip(resolvedClipPath);
        }
    }

    public async loadClip(path: string): Promise<void> {
        const normalizedPath = this.normalizeClipPath(path);
        this.clipPath = normalizedPath;
        this.clipGuid = AssetDatabase.getInstance().getGuid(normalizedPath) ?? this.clipGuid ?? null;
        await AssetImporter.importAudio(normalizedPath, (buffer) => {
            this.buffer = buffer;
            this.setupAudio();
            if (this.playOnAwake) this.play();
        });
    }

    private setupAudio(): void {
        if (!this.buffer) return;

        // Try to find listener in scene
        // @ts-ignore
        const listener = window.AudioListenerInstance;
        if (!listener) {
            console.warn("No AudioListener found in the scene. AudioSource might not play.");
            return;
        }

        if (this.audio) {
            this.stop();
            this.gameObject.object3D.remove(this.audio);
            this.audio = null;
        }

        if (this.spatial) {
            this.audio = new THREE.PositionalAudio(listener);
        } else {
            this.audio = new THREE.Audio(listener);
        }

        this.audio.setBuffer(this.buffer);
        this.audio.setLoop(this.loop);
        this.audio.setVolume(this.volume);

        if (this.audio instanceof THREE.PositionalAudio) {
            this.audio.setRefDistance(1);
        }

        this.gameObject.object3D.add(this.audio);
    }

    public play(): void {
        if (this.audio) {
            if (this.audio.buffer && !this.audio.isPlaying) {
                this.audio.play();
            }
        }
    }

    public pause(): void {
        if (this.audio && this.audio.isPlaying) {
            this.audio.pause();
        }
    }

    public stop(): void {
        if (this.audio && this.audio.isPlaying) {
            this.audio.stop();
        }
    }

    public updateVisuals(): void {
        if (this.audio) {
            this.audio.setVolume(this.volume);
            this.audio.setLoop(this.loop);
            if ('setPlaybackRate' in this.audio) {
                this.audio.setPlaybackRate(this.pitch);
            }
        }
    }

    public async deserialize(data: any): Promise<void> {
        super.deserialize(data);
        const resolvedClipPath = this.resolveClipReference();
        if (resolvedClipPath) {
            await this.loadClip(resolvedClipPath);
        }
    }

    public onDestroy(): void {
        this.stop();
        if (this.audio) {
            this.gameObject.object3D.remove(this.audio);
        }
    }

    private normalizeClipPath(path: string): string {
        if (!path.startsWith('file://')) return path;

        try {
            return decodeURIComponent(path.replace(/^file:\/\//, ''));
        } catch {
            return path.replace(/^file:\/\//, '');
        }
    }

    private resolveClipReference(): string | null {
        if (this.clipGuid) {
            const guidPath = AssetDatabase.getInstance().getPath(this.clipGuid);
            if (guidPath) {
                this.clipPath = guidPath;
                return guidPath;
            }
        }

        return this.clipPath ? this.normalizeClipPath(this.clipPath) : null;
    }
}
