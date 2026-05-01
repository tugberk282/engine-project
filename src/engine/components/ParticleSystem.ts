import { Component } from '../Component';
import * as THREE from 'three';
import { serialize } from '../Decorators';

interface Particle {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
    size: number;
}

/**
 * ParticleSystem - Unity-style particle effects
 */
export class ParticleSystem extends Component {
    @serialize public emissionRate: number = 10; // particles per second
    @serialize public startLifetime: number = 2.0;
    @serialize public startSize: number = 0.1;
    @serialize public startSpeed: number = 1.0;
    @serialize public gravity: THREE.Vector3 = new THREE.Vector3(0, -9.81, 0);
    @serialize public startColor: THREE.Color = new THREE.Color(1, 1, 1);
    @serialize public endColor: THREE.Color = new THREE.Color(1, 1, 1);
    @serialize public texturePath: string | null = null;
    @serialize public maxParticles: number = 100;
    @serialize public loop: boolean = true;
    @serialize public playOnAwake: boolean = true;

    private particles: Particle[] = [];
    private particleGeometry!: THREE.BufferGeometry;
    private particleMaterial!: THREE.PointsMaterial;
    private particleSystem!: THREE.Points;
    private emissionTimer: number = 0;
    private isPlaying: boolean = false;

    public awake(): void {
        // Create particle system
        this.particleGeometry = new THREE.BufferGeometry();
        this.particleMaterial = new THREE.PointsMaterial({
            size: this.startSize,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            depthWrite: false, // Better for particles
            blending: THREE.AdditiveBlending // Glow effect
        });

        if (this.texturePath) {
            const loader = new THREE.TextureLoader();
            loader.load(this.texturePath, (texture) => {
                this.particleMaterial.map = texture;
                this.particleMaterial.needsUpdate = true;
            });
        }

        this.particleSystem = new THREE.Points(this.particleGeometry, this.particleMaterial);
        this.gameObject.object3D.add(this.particleSystem);

        if (this.playOnAwake) {
            this.play();
        }
    }

    public play(): void {
        this.isPlaying = true;
    }

    public pause(): void {
        this.isPlaying = false;
    }

    public stop(): void {
        this.isPlaying = false;
        this.particles = [];
        this.updateParticleGeometry();
    }

    public update(deltaTime: number): void {
        if (!this.isPlaying) return;

        // Emit new particles
        this.emissionTimer += deltaTime;
        const emitCount = Math.floor(this.emissionTimer * this.emissionRate);

        if (emitCount > 0) {
            this.emissionTimer = 0;
            for (let i = 0; i < emitCount && this.particles.length < this.maxParticles; i++) {
                this.emitParticle();
            }
        }

        // Update existing particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];

            // Update lifetime
            particle.life -= deltaTime;
            if (particle.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            // Update physics
            particle.velocity.add(this.gravity.clone().multiplyScalar(deltaTime));
            particle.position.add(particle.velocity.clone().multiplyScalar(deltaTime));
        }

        // Update geometry
        this.updateParticleGeometry();

        // Loop or stop
        if (!this.loop && this.particles.length === 0) {
            this.isPlaying = false;
        }
    }

    private emitParticle(): void {
        const particle: Particle = {
            position: this.gameObject.transform.position.clone(),
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * this.startSpeed,
                Math.random() * this.startSpeed,
                (Math.random() - 0.5) * this.startSpeed
            ),
            life: this.startLifetime,
            maxLife: this.startLifetime,
            size: this.startSize
        };
        this.particles.push(particle);
    }

    private updateParticleGeometry(): void {
        const positions: number[] = [];
        const colors: number[] = [];

        this.particles.forEach(particle => {
            positions.push(particle.position.x, particle.position.y, particle.position.z);

            // Interpolate color based on lifetime
            const t = 1 - (particle.life / particle.maxLife);
            const color = this.startColor.clone().lerp(this.endColor, t);
            colors.push(color.r, color.g, color.b);
        });

        this.particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.particleGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }

    public serialize(): any {
        return {
            type: 'ParticleSystem',
            data: {
                emissionRate: this.emissionRate,
                startLifetime: this.startLifetime,
                startSize: this.startSize,
                startSpeed: this.startSpeed,
                gravity: this.gravity.toArray(),
                startColor: this.startColor.toArray(),
                endColor: this.endColor.toArray(),
                texturePath: this.texturePath,
                maxParticles: this.maxParticles,
                loop: this.loop,
                playOnAwake: this.playOnAwake
            }
        };
    }

    public deserialize(data: any): void {
        super.deserialize(data);
        if (data.gravity && Array.isArray(data.gravity)) {
            this.gravity.fromArray(data.gravity);
        }
        if (data.startColor && Array.isArray(data.startColor)) this.startColor.fromArray(data.startColor);
        if (data.endColor && Array.isArray(data.endColor)) this.endColor.fromArray(data.endColor);
        this.texturePath = data.texturePath ?? this.texturePath;

        if (this.texturePath) {
            const loader = new THREE.TextureLoader();
            loader.load(this.texturePath, (texture) => {
                this.particleMaterial.map = texture;
                this.particleMaterial.needsUpdate = true;
            });
        }

        // Ensure play state is respected after deserialization
        if (this.playOnAwake) this.play();
    }

    public onDestroy(): void {
        if (this.particleSystem) {
            this.gameObject.object3D.remove(this.particleSystem);
            this.particleGeometry.dispose();
            this.particleMaterial.dispose();
        }
    }
}
