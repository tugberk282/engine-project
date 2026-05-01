import { Scene } from './Scene';
import { DesktopBridge } from '../platform/DesktopBridge';

/**
 * SceneManager - Manages scene lifecycle and file loading
 */
export class SceneManager {
    private static instance: SceneManager;
    private currentScene: Scene | null = null;
    private activeScenePath: string | null = null;

    private desktopBridge: DesktopBridge;
    private constructor() {
        this.desktopBridge = new DesktopBridge();
    }

    public static getInstance(): SceneManager {
        if (!SceneManager.instance) {
            SceneManager.instance = new SceneManager();
        }
        return SceneManager.instance;
    }

    public setActiveScene(scene: Scene, path: string | null = null) {
        this.currentScene = scene;
        this.activeScenePath = path;
    }

    public getActiveScene(): Scene | null {
        return this.currentScene;
    }

    public getActiveScenePath(): string | null {
        return this.activeScenePath;
    }

    public newScene(): Scene {
        const scene = new Scene();
        this.setActiveScene(scene, null);
        return scene;
    }

    public loadScene(filePath: string): Promise<Scene> {
        return new Promise(async (resolve, reject) => {
            try {
                const data = await this.desktopBridge.readTextFile(filePath);
                if (data === null) {
                    reject(new Error(`Scene file missing: ${filePath}`));
                    return;
                }
                const scene = new Scene();
                scene.loadFromJSON(data);
                this.setActiveScene(scene, filePath);
                console.log(`Scene loaded from: ${filePath}`);
                resolve(scene);
            } catch (err) {
                console.error(`Failed to load scene: ${err}`);
                reject(err);
            }
        });
    }

    public saveScene(filePath: string): void {
        if (!this.currentScene) return;
        try {
            const json = this.currentScene.toJSON();
            void this.desktopBridge.writeTextFile(filePath, json).then(() => {
                this.activeScenePath = filePath;
                console.log(`Scene saved to: ${filePath}`);
            });
        } catch (err) {
            console.error(`Failed to save scene: ${err}`);
        }
    }
}
