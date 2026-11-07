import { Component } from '../Component';
import * as THREE from 'three';

export class AudioListener extends Component {
    private static activeComponent: AudioListener | null = null;
    private listener: THREE.AudioListener | null = null;

    public awake(): void {
        if (AudioListener.activeComponent && AudioListener.activeComponent !== this) {
            console.warn('Only one active AudioListener is supported. This listener will remain inactive.');
            return;
        }
        this.listener = new THREE.AudioListener();
        this.gameObject.object3D.add(this.listener);
        AudioListener.activeComponent = this;

        // Expose global reference for AudioSources
        // @ts-ignore
        if (typeof window !== 'undefined') window.AudioListenerInstance = this.listener;
    }

    public update(): void {
        // AudioListener's position is automatically updated by being child of GameObject's object3D
    }

    public onDestroy(): void {
        if (AudioListener.activeComponent === this) AudioListener.activeComponent = null;
        if (this.listener) {
            this.gameObject.object3D.remove(this.listener);
            // @ts-ignore
            if (typeof window !== 'undefined' && window.AudioListenerInstance === this.listener) {
                // @ts-ignore
                window.AudioListenerInstance = null;
            }
        }
    }
}
