import { Scene } from './Scene';
import { DesktopBridge, ProjectResource } from '../platform/DesktopBridge';

export interface PreparedScene {
    scene: Scene;
    path: string;
    revision?: string;
}

/**
 * SceneManager - Manages scene lifecycle and file loading
 */
export class SceneManager {
    private static instance: SceneManager;
    private currentScene: Scene | null = null;
    private activeScenePath: string | null = null;
    private activeSceneRevision: string | null | undefined;

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

    public setActiveScene(scene: Scene, path: string | null = null, revision?: string | null) {
        this.currentScene = scene;
        this.activeScenePath = path;
        this.activeSceneRevision = revision;
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

    public async prepareScene(filePath: string): Promise<PreparedScene> {
        const document = await this.desktopBridge.readSceneDocument(filePath);
        const scene = new Scene();
        scene.loadFromJSON(document.text);
        return { scene, path: filePath, revision: document.revision || undefined };
    }

    public activatePreparedScene(prepared: PreparedScene): Scene {
        this.setActiveScene(prepared.scene, prepared.path, prepared.revision);
        console.log(`Scene loaded from: ${prepared.path}`);
        return prepared.scene;
    }

    public async loadScene(filePath: string): Promise<Scene> {
        try {
            return this.activatePreparedScene(await this.prepareScene(filePath));
        } catch (err) {
            console.error(`Failed to load scene: ${err}`);
            throw err;
        }
    }

    public async loadProjectScene(resource: ProjectResource): Promise<Scene> {
        const data = await this.desktopBridge.readProjectText(resource);
        const scene = new Scene();
        scene.loadFromJSON(data);
        this.setActiveScene(scene, resource.path);
        return scene;
    }

    public async saveScene(filePath: string): Promise<void> {
        if (!this.currentScene) return;
        try {
            const json = this.currentScene.toJSON();
            const saved = await this.desktopBridge.writeSceneDocument(filePath, json, this.activeSceneRevision);
            this.activeScenePath = filePath;
            this.activeSceneRevision = saved.revision || undefined;
            console.log(`Scene saved to: ${filePath}`);
        } catch (err) {
            console.error(`Failed to save scene: ${err}`);
            throw err;
        }
    }

    public async saveSceneAs(filePath: string): Promise<void> {
        if (!this.currentScene) return;
        const saved = await this.desktopBridge.writeSceneDocument(filePath, this.currentScene.toJSON());
        this.activeScenePath = filePath;
        this.activeSceneRevision = saved.revision || undefined;
    }

    public async saveProjectScene(resource: ProjectResource): Promise<void> {
        if (!this.currentScene) return;
        await this.desktopBridge.writeProjectText(resource, this.currentScene.toJSON());
        this.activeScenePath = resource.path;
    }
}
