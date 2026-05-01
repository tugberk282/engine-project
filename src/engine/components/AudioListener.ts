import { Component } from '../Component';
import * as THREE from 'three';

export class AudioListener extends Component {
    private listener: THREE.AudioListener | null = null;

    public awake(): void {
        this.listener = new THREE.AudioListener();
        this.gameObject.object3D.add(this.listener);

        // Expose global reference for AudioSources
        // @ts-ignore
        window.AudioListenerInstance = this.listener;
    }

    public update(): void {
        // AudioListener's position is automatically updated by being child of GameObject's object3D
    }

    public onDestroy(): void {
        if (this.listener) {
            this.gameObject.object3D.remove(this.listener);
            // @ts-ignore
            if (window.AudioListenerInstance === this.listener) {
                // @ts-ignore
                window.AudioListenerInstance = null;
            }
        }
    }
}
