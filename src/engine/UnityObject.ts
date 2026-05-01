import { GameObject } from './GameObject';
import { Scene } from './Scene';
import { Prefab } from './Prefab';

/**
 * Unity-style Object class with static utility methods
 */
export class UnityObject {
    /**
     * Instantiate a GameObject (clone)
     */
    public static Instantiate(original: GameObject, scene: Scene): GameObject {
        const data = original.serialize();
        const referenceMap = new Map<string, GameObject>();
        scene.gameObjects.forEach((go) => referenceMap.set(go.id, go));
        const clone = Prefab.instantiateData(data, { externalIdMap: referenceMap });
        clone.name = `${data.name} (Clone)`;
        scene.addGameObject(clone);
        return clone;
    }

    /**
     * Destroy a GameObject
     */
    public static Destroy(gameObject: GameObject): void {
        if (gameObject.scene) {
            gameObject.scene.removeGameObject(gameObject);
        }
    }

    /**
     * Find GameObject by name
     */
    public static Find(name: string, scene: Scene): GameObject | null {
        return scene.gameObjects.find(go => go.name === name) || null;
    }

    /**
     * Find a GameObject by tag
     */
    public static FindWithTag(tag: string, scene: Scene): GameObject | null {
        return scene.gameObjects.find(go => go.tag === tag) || null;
    }

    /**
     * Find all GameObjects with a specific tag
     */
    public static FindGameObjectsWithTag(tag: string, scene: Scene): GameObject[] {
        return scene.gameObjects.filter(go => go.tag === tag);
    }
}
