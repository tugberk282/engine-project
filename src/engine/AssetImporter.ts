import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GameObject } from './GameObject';
import { AssetDatabase } from './AssetDatabase';
import { MeshRenderer } from './components/MeshRenderer';
import { Animator } from './components/Animator';
import { BoxCollider } from './components/BoxCollider';
import { DesktopFileSystem } from '../platform/DesktopFileSystem';

/**
 * AssetImporter — Centralized asset import pipeline.
 * Handles GLTF/GLB model loading, texture optimization, and automatic component setup.
 */
export class AssetImporter {
    private static readonly MAX_MODEL_SOURCE_BYTES = 256 * 1024 * 1024;
    private static readonly MAX_TEXTURE_SOURCE_BYTES = 128 * 1024 * 1024;
    private static readonly MAX_AUDIO_SOURCE_BYTES = 64 * 1024 * 1024;
    private static audioBinaryCache: Map<string, ArrayBuffer> = new Map();
    private static audioDecodedCache: Map<string, AudioBuffer> = new Map();
    private static assetRevisionByPath: Map<string, number> = new Map();
    private static desktopFileSystem: DesktopFileSystem = new DesktopFileSystem();

    /**
     * Import a 3D model (GLTF/GLB) and convert it into a hierarchy of GameObjects.
     * Automatically adds MeshFilter, MeshRenderer, and Animator components where appropriate.
     */
    public static async importModel(filePath: string, onComplete: (rootGO: GameObject) => void, onError?: (err: any) => void): Promise<void> {
        const loader = new GLTFLoader();
        const settings = AssetImporter.getImporterSettings(filePath, 'model');
        const normalizedPath = AssetImporter.normalizeAssetPath(filePath);
        try {
            await AssetImporter.assertAssetWithinLimit(normalizedPath, AssetImporter.MAX_MODEL_SOURCE_BYTES, 'Model');
        } catch (error) {
            onError?.(error);
            return;
        }
        const url = AssetImporter.getVersionedAssetUrl(normalizedPath);

        loader.load(url, (gltf) => {
            const modelName = normalizedPath.split(/[\/\\]/).pop()?.replace(/\.(gltf|glb)$/i, '') || 'Model';
            const rootGO = new GameObject(modelName);
            rootGO.sourceAssetPath = normalizedPath;
            rootGO.sourceAssetGuid = AssetDatabase.getInstance().getGuid(normalizedPath) ?? null;
            rootGO.sourceAssetType = 'model';
            const scaleFactor = typeof settings.scaleFactor === 'number' && Number.isFinite(settings.scaleFactor)
                ? settings.scaleFactor
                : 1;

            rootGO.transform.scale.multiplyScalar(scaleFactor);

            // Process the loaded scene
            AssetImporter.processNode(gltf.scene, rootGO, settings);

            // Handle animations
            if (settings.importAnimations !== false && gltf.animations && gltf.animations.length > 0) {
                const animator = rootGO.addComponent(Animator);
                gltf.animations.forEach(clip => {
                    animator.addAnimation(clip.name || 'default', clip);
                });
                animator.modelPath = normalizedPath;
                animator.modelGuid = AssetDatabase.getInstance().getGuid(normalizedPath) ?? null;
                console.log(`Loaded ${gltf.animations.length} animation(s) from ${modelName}`);
            }

            console.log(`Model imported: ${modelName} (${AssetImporter.countMeshes(gltf.scene)} meshes)`);
            onComplete(rootGO);
        }, undefined, (error) => {
            console.error(`Failed to import model: ${normalizedPath}`, error);
            onError?.(error);
        });
    }

    /**
     * Recursively process a Three.js node and convert it into GameObjects with components.
     */
    private static processNode(
        threeNode: THREE.Object3D,
        parentGO: GameObject,
        settings: Record<string, string | number | boolean>
    ): void {
        threeNode.children.forEach(child => {
            const childGO = new GameObject(child.name || 'Node');

            // Copy transform
            childGO.transform.position.copy(child.position);
            childGO.transform.rotation.copy(child.rotation);
            childGO.transform.scale.copy(child.scale);

            // Handle meshes
            if (child instanceof THREE.Mesh) {
                const mr = childGO.addComponent(MeshRenderer);

                // Clone geometry
                mr.mesh.geometry = child.geometry.clone();
                AssetImporter.applyGeometryImportSettings(mr.mesh.geometry, settings);

                // Clone material
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        // Multi-material: use first one
                        mr.mesh.material = child.material[0].clone();
                    } else {
                        mr.mesh.material = child.material.clone();
                    }
                }

                // Shadow support
                mr.mesh.castShadow = true;
                mr.mesh.receiveShadow = true;

                if (settings.generateColliders === true) {
                    AssetImporter.addGeneratedBoxCollider(childGO, mr.mesh.geometry);
                }
            }

            // Set parent
            childGO.transform.setParent(parentGO.transform);

            // Process children recursively
            AssetImporter.processNode(child, childGO, settings);
        });

        // Handle direct mesh on root node
        if (threeNode instanceof THREE.Mesh) {
            const mr = parentGO.addComponent(MeshRenderer);
            mr.mesh.geometry = threeNode.geometry.clone();
            AssetImporter.applyGeometryImportSettings(mr.mesh.geometry, settings);
            if (threeNode.material) {
                if (Array.isArray(threeNode.material)) {
                    mr.mesh.material = threeNode.material[0].clone();
                } else {
                    mr.mesh.material = threeNode.material.clone();
                }
            }
            mr.mesh.castShadow = true;
            mr.mesh.receiveShadow = true;

            if (settings.generateColliders === true) {
                AssetImporter.addGeneratedBoxCollider(parentGO, mr.mesh.geometry);
            }
        }
    }

    /**
     * Import a texture file and return a Three.js Texture.
     */
    public static async importTexture(filePath: string, onComplete: (texture: THREE.Texture) => void, onError?: (error: unknown) => void): Promise<void> {
        const normalizedPath = AssetImporter.normalizeAssetPath(filePath);
        try {
            await AssetImporter.assertAssetWithinLimit(normalizedPath, AssetImporter.MAX_TEXTURE_SOURCE_BYTES, 'Texture');
        } catch (error) {
            onError?.(error);
            return;
        }
        const loader = new THREE.TextureLoader();
        const url = AssetImporter.getVersionedAssetUrl(normalizedPath);
        const settings = AssetImporter.getImporterSettings(normalizedPath, 'texture');

        loader.load(url, (texture) => {
            texture.name = normalizedPath.split(/[\/\\]/).pop() || 'Texture';
            texture.userData.assetPath = normalizedPath;
            texture.userData.assetGuid = AssetDatabase.getInstance().getGuid(normalizedPath) ?? null;

            AssetImporter.applyTextureImportSettings(texture, settings);

            console.log(`Texture imported: ${texture.name}`);
            onComplete(texture);
        }, undefined, onError);
    }

    public static invalidateTextureCache(filePath?: string): void {
        AssetImporter.bumpAssetRevision(filePath);
    }

    public static invalidateModelCache(filePath?: string): void {
        AssetImporter.bumpAssetRevision(filePath);
    }

    public static shouldImportModelAnimations(filePath: string): boolean {
        const normalizedPath = AssetImporter.normalizeAssetPath(filePath);
        const settings = AssetImporter.getImporterSettings(normalizedPath, 'model');
        return settings.importAnimations !== false;
    }

    /**
     * Import an audio file and return an AudioBuffer.
     */
    public static async importAudio(filePath: string, onComplete: (buffer: AudioBuffer) => void): Promise<void> {
        const normalizedPath = AssetImporter.normalizeAssetPath(filePath);
        const settings = AssetImporter.normalizeAudioImportSettings(
            AssetImporter.getImporterSettings(normalizedPath, 'audio')
        );
        const decodeKey = `${normalizedPath}|mono:${settings.forceToMono ? '1' : '0'}`;

        if (settings.loadType === 'decompressOnLoad' && settings.preloadAudioData) {
            const cachedDecoded = AssetImporter.audioDecodedCache.get(decodeKey);
            if (cachedDecoded) {
                AssetImporter.attachAudioBufferUserData(cachedDecoded, normalizedPath, settings);
                onComplete(cachedDecoded);
                return;
            }
        }

        void await AssetImporter.readAudioBinary(normalizedPath, settings).then( async(binary) => {
            await AssetImporter.decodeAudioBinary(binary).then((decodedBuffer) => {
                const finalBuffer = settings.forceToMono
                    ? AssetImporter.convertAudioBufferToMono(decodedBuffer)
                    : decodedBuffer;

                if (settings.loadType === 'decompressOnLoad' && settings.preloadAudioData) {
                    AssetImporter.audioDecodedCache.set(decodeKey, finalBuffer);
                }

                AssetImporter.attachAudioBufferUserData(finalBuffer, normalizedPath, settings);
                console.log(`Audio imported: ${normalizedPath.split(/[\/\\]/).pop()}`);
                onComplete(finalBuffer);
            }).catch((error) => {
                console.error(`Failed to decode audio: ${normalizedPath}`, error);
            });
        }).catch((error) => {
            console.error(`Failed to import audio: ${normalizedPath}`, error);
        });
    }

    public static invalidateAudioCache(filePath?: string): void {
        if (!filePath) {
            AssetImporter.audioBinaryCache.clear();
            AssetImporter.audioDecodedCache.clear();
            AssetImporter.bumpAssetRevision();
            return;
        }

        const normalizedPath = AssetImporter.normalizeAssetPath(filePath);
        AssetImporter.bumpAssetRevision(normalizedPath);
        AssetImporter.audioBinaryCache.delete(normalizedPath);
        const keysToDelete = Array.from(AssetImporter.audioDecodedCache.keys())
            .filter((key) => key.startsWith(`${normalizedPath}|mono:`));
        keysToDelete.forEach((key) => AssetImporter.audioDecodedCache.delete(key));
    }

    public static getVersionedAssetUrl(filePath: string): string {
        const normalizedPath = AssetImporter.normalizeAssetPath(filePath);
        const baseUrl = normalizedPath.startsWith('file://')
            ? normalizedPath
            : `file://${normalizedPath.replace(/\\/g, '/')}`;
        const revision = AssetImporter.assetRevisionByPath.get(normalizedPath) ?? 0;
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}rev=${revision}`;
    }

    private static getImporterSettings(
        filePath: string,
        expectedType: 'texture' | 'model' | 'audio'
    ): Record<string, string | number | boolean> {
        const meta = AssetDatabase.getInstance().getMeta(filePath);
        if (!meta || meta.assetType !== expectedType) {
            return {};
        }

        return meta.importer.settings ?? {};
    }

    private static applyGeometryImportSettings(
        geometry: THREE.BufferGeometry,
        settings: Record<string, string | number | boolean>
    ): void {
        geometry.userData.readWriteEnabled = settings.readWriteEnabled === true;
        geometry.computeBoundingBox();
    }

    private static addGeneratedBoxCollider(gameObject: GameObject, geometry: THREE.BufferGeometry): void {
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds || gameObject.getComponent(BoxCollider)) return;

        const collider = gameObject.addComponent(BoxCollider);
        collider.size.copy(bounds.getSize(new THREE.Vector3()));
        collider.center.copy(bounds.getCenter(new THREE.Vector3()));
        collider.updateCollider();
    }

    private static applyTextureImportSettings(
        texture: THREE.Texture,
        settings: Record<string, string | number | boolean>
    ): void {
        const wrapMode = typeof settings.wrapMode === 'string' ? settings.wrapMode.toLowerCase() : 'repeat';
        const filterMode = typeof settings.filterMode === 'string' ? settings.filterMode.toLowerCase() : 'bilinear';
        const maxSize = typeof settings.maxSize === 'number' && Number.isFinite(settings.maxSize)
            ? Math.max(1, Math.round(settings.maxSize))
            : 2048;

        const wrapping = AssetImporter.getWrappingMode(wrapMode);
        texture.wrapS = wrapping;
        texture.wrapT = wrapping;

        AssetImporter.applyTextureMaxSize(texture, maxSize);
        AssetImporter.applyTextureFilterMode(texture, filterMode);

        texture.colorSpace = settings.sRGB === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        texture.userData.importSettings = {
            ...settings,
            maxSize,
            alphaIsTransparency: settings.alphaIsTransparency !== false
        };

        AssetImporter.normalizeTextureForImageDimensions(texture);
        texture.needsUpdate = true;
    }

    private static getWrappingMode(wrapMode: string): THREE.Wrapping {
        switch (wrapMode) {
            case 'clamp':
            case 'clamptoedge':
            case 'clamp-to-edge':
                return THREE.ClampToEdgeWrapping;
            case 'mirror':
            case 'mirrored':
            case 'mirroredrepeat':
                return THREE.MirroredRepeatWrapping;
            default:
                return THREE.RepeatWrapping;
        }
    }

    private static applyTextureFilterMode(texture: THREE.Texture, filterMode: string): void {
        switch (filterMode) {
            case 'point':
            case 'nearest':
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestMipmapNearestFilter;
                texture.anisotropy = 1;
                break;
            case 'trilinear':
                texture.magFilter = THREE.LinearFilter;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.anisotropy = 4;
                break;
            default:
                texture.magFilter = THREE.LinearFilter;
                texture.minFilter = THREE.LinearMipmapNearestFilter;
                texture.anisotropy = 1;
                break;
        }
    }

    private static applyTextureMaxSize(texture: THREE.Texture, maxSize: number): void {
        const image = texture.image as { width?: number; height?: number } | undefined;
        const width = image?.width ?? 0;
        const height = image?.height ?? 0;
        if (!width || !height || Math.max(width, height) <= maxSize) return;

        const scale = maxSize / Math.max(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));

        const context = canvas.getContext('2d');
        if (!context) return;

        context.drawImage(texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
        texture.image = canvas;
    }

    private static normalizeTextureForImageDimensions(texture: THREE.Texture): void {
        const image = texture.image as { width?: number; height?: number } | undefined;
        const width = image?.width ?? 0;
        const height = image?.height ?? 0;
        if (!width || !height) return;

        const isPowerOfTwo = THREE.MathUtils.isPowerOfTwo(width) && THREE.MathUtils.isPowerOfTwo(height);
        if (isPowerOfTwo) return;

        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        if (texture.magFilter === THREE.NearestFilter) {
            texture.minFilter = THREE.NearestFilter;
        } else {
            texture.minFilter = THREE.LinearFilter;
        }
    }

    private static normalizeAudioImportSettings(settings: Record<string, string | number | boolean>): {
        loadType: 'decompressOnLoad' | 'compressedInMemory' | 'streaming';
        preloadAudioData: boolean;
        forceToMono: boolean;
    } {
        const rawLoadType = typeof settings.loadType === 'string'
            ? settings.loadType.toLowerCase()
            : 'decompressonload';
        const loadType = rawLoadType === 'streaming'
            ? 'streaming'
            : rawLoadType === 'compressedinmemory'
                ? 'compressedInMemory'
                : 'decompressOnLoad';
        const preloadAudioData = settings.preloadAudioData !== false;
        const forceToMono = settings.forceToMono === true;

        return {
            loadType,
            preloadAudioData,
            forceToMono
        };
    }

    private static bumpAssetRevision(filePath?: string): void {
        if (!filePath) {
            AssetImporter.assetRevisionByPath.clear();
            return;
        }

        const normalizedPath = AssetImporter.normalizeAssetPath(filePath);
        const currentRevision = AssetImporter.assetRevisionByPath.get(normalizedPath) ?? 0;
        AssetImporter.assetRevisionByPath.set(normalizedPath, currentRevision + 1);
    }

    private static async readAudioBinary(
        filePath: string,
        settings: { loadType: 'decompressOnLoad' | 'compressedInMemory' | 'streaming'; preloadAudioData: boolean; forceToMono: boolean }
    ): Promise<ArrayBuffer> {
        const canUseBinaryCache = settings.loadType !== 'streaming';
        if (canUseBinaryCache) {
            const cached = AssetImporter.audioBinaryCache.get(filePath);
            if (cached) {
                return await Promise.resolve(cached.slice(0));
            }
        }

        return await AssetImporter.readAudioBinaryFromFile(filePath).then((binary) => {
            if (canUseBinaryCache && (settings.loadType === 'compressedInMemory' || settings.preloadAudioData)) {
                AssetImporter.audioBinaryCache.set(filePath, binary.slice(0));
            } else if (!canUseBinaryCache) {
                AssetImporter.audioBinaryCache.delete(filePath);
            }
            return binary;
        });
    }

    private static async readAudioBinaryFromFile(filePath: string): Promise<ArrayBuffer> {
        if (await this.desktopFileSystem.exists(filePath)) {
            await AssetImporter.assertAssetWithinLimit(filePath, AssetImporter.MAX_AUDIO_SOURCE_BYTES, 'Audio');
            const buffer = await this.desktopFileSystem.readFile(filePath) as Uint8Array;
            const bytes = new Uint8Array(buffer.byteLength);
            bytes.set(buffer);
            return await Promise.resolve(bytes.buffer);
        }

        const url = filePath.startsWith('file://') ? filePath : `file://${filePath.replace(/\\/g, '/')}`;
        return await fetch(url)
            .then( async(response) => await response.arrayBuffer());
    }

    private static async decodeAudioBinary(binary: ArrayBuffer): Promise<AudioBuffer> {
        const audioContext = THREE.AudioContext.getContext();
        return await audioContext.decodeAudioData(binary.slice(0));
    }

    private static convertAudioBufferToMono(source: AudioBuffer): AudioBuffer {
        if (source.numberOfChannels <= 1) return source;

        const audioContext = THREE.AudioContext.getContext();
        const monoBuffer = audioContext.createBuffer(1, source.length, source.sampleRate);
        const mono = monoBuffer.getChannelData(0);

        for (let ch = 0; ch < source.numberOfChannels; ch += 1) {
            const channel = source.getChannelData(ch);
            for (let i = 0; i < source.length; i += 1) {
                mono[i] += channel[i] / source.numberOfChannels;
            }
        }

        return monoBuffer;
    }

    private static attachAudioBufferUserData(
        buffer: AudioBuffer,
        filePath: string,
        settings: { loadType: 'decompressOnLoad' | 'compressedInMemory' | 'streaming'; preloadAudioData: boolean; forceToMono: boolean }
    ): void {
        (buffer as AudioBuffer & { userData?: Record<string, unknown> }).userData = {
            assetPath: filePath,
            assetGuid: AssetDatabase.getInstance().getGuid(filePath) ?? null,
            loadType: settings.loadType,
            preloadAudioData: settings.preloadAudioData,
            forceToMono: settings.forceToMono
        };
    }

    private static normalizeAssetPath(assetPath: string): string {
        if (!assetPath.startsWith('file://')) return assetPath;

        try {
            return decodeURIComponent(assetPath.replace(/^file:\/\//, ''));
        } catch {
            return assetPath.replace(/^file:\/\//, '');
        }
    }

    private static async assertAssetWithinLimit(filePath: string, maxBytes: number, assetKind: string): Promise<void> {
        const stat = await AssetImporter.desktopFileSystem.stat(filePath);
        if (!stat || !stat.isFile()) {
            throw new Error(`${assetKind} asset is unavailable or is not a file: ${filePath}`);
        }
        if (stat.size > maxBytes) {
            throw new Error(`${assetKind} asset exceeds the ${maxBytes}-byte import limit: ${filePath}`);
        }
    }

    /**
     * Count meshes in a Three.js scene graph.
     */
    private static countMeshes(node: THREE.Object3D): number {
        let count = node instanceof THREE.Mesh ? 1 : 0;
        node.children.forEach(child => {
            count += AssetImporter.countMeshes(child);
        });
        return count;
    }

    /**
     * Get supported model file extensions.
     */
    public static getModelExtensions(): string[] {
        return ['gltf', 'glb'];
    }

    /**
     * Get supported texture file extensions.
     */
    public static getTextureExtensions(): string[] {
        return ['png', 'jpg', 'jpeg', 'tga', 'bmp', 'webp'];
    }

    /**
     * Get supported audio file extensions.
     */
    public static getAudioExtensions(): string[] {
        return ['mp3', 'wav', 'ogg', 'flac'];
    }

    /**
     * Check if a file extension is a supported model format.
     */
    public static isModelFile(filename: string): boolean {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        return this.getModelExtensions().includes(ext);
    }

    /**
     * Check if a file extension is a supported texture format.
     */
    public static isTextureFile(filename: string): boolean {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        return this.getTextureExtensions().includes(ext);
    }

    /**
     * Check if a file extension is a supported audio format.
     */
    public static isAudioFile(filename: string): boolean {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        return this.getAudioExtensions().includes(ext);
    }
}
