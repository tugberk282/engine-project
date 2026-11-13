const finite = (value, fallback, minimum = Number.NEGATIVE_INFINITY) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
};

const vector3 = (value, fallback) => Array.isArray(value)
    ? [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])]
    : fallback;

export function collectPlayerParticleSystems(scene) {
    const systems = [];
    const visit = (object, parentActive = true, parentPath = []) => {
        const active = parentActive && object?.enabled !== false;
        const activePath = object?.id ? [...parentPath, object.id] : parentPath;
        for (const component of object?.components || []) {
            if (component?.type !== 'ParticleSystem' || component.enabled === false) continue;
            const data = component.data && typeof component.data === 'object' ? component.data : {};
            systems.push({
                objectId: object.id, active, activePath,
                emissionRate: finite(data.emissionRate, 10, 0),
                duration: finite(data.duration, 5, 0),
                startLifetime: finite(data.startLifetime, 2, 0.001),
                startSize: finite(data.startSize, 0.1, 0.001),
                startSpeed: finite(data.startSpeed, 1, 0),
                gravity: vector3(data.gravity, [0, -9.81, 0]),
                startColor: vector3(data.startColor, [1, 1, 1]),
                endColor: vector3(data.endColor, [1, 1, 1]),
                texturePath: typeof data.texturePath === 'string' ? data.texturePath.replaceAll('\\', '/') : null,
                maxParticles: Math.max(0, Math.trunc(finite(data.maxParticles, 100, 0))),
                loop: data.loop !== false,
                playOnAwake: data.playOnAwake !== false
            });
        }
        for (const child of object?.children || []) visit(child, active, activePath);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return systems;
}

function seedFrom(value) {
    let seed = 2166136261;
    for (const character of String(value || 'particles')) {
        seed ^= character.charCodeAt(0);
        seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
}

export class PlayerParticleSimulation {
    constructor(settings) {
        this.settings = settings;
        this.particles = [];
        this.elapsed = 0;
        this.emission = 0;
        this.playing = settings.playOnAwake;
        this.seed = seedFrom(settings.objectId);
    }

    random() {
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        return this.seed / 0x100000000;
    }

    play() {
        if (!this.settings.loop && this.elapsed >= this.settings.duration) {
            this.elapsed = 0;
            this.emission = 0;
        }
        this.playing = true;
    }

    stop() {
        this.playing = false;
        this.particles = [];
        this.elapsed = 0;
        this.emission = 0;
    }

    update(deltaTime, active = true) {
        const dt = Math.max(0, Math.min(0.1, finite(deltaTime, 0, 0)));
        if (!active || !this.playing || dt === 0) return this.particles;
        const canEmit = this.settings.loop || this.elapsed < this.settings.duration;
        if (canEmit) {
            const remaining = this.settings.loop ? dt : Math.min(dt, Math.max(0, this.settings.duration - this.elapsed));
            this.emission += remaining * this.settings.emissionRate;
            const count = Math.min(Math.floor(this.emission), Math.max(0, this.settings.maxParticles - this.particles.length));
            this.emission -= count;
            for (let index = 0; index < count; index += 1) {
                this.particles.push({
                    position: [0, 0, 0],
                    velocity: [(this.random() - 0.5) * this.settings.startSpeed, this.random() * this.settings.startSpeed, (this.random() - 0.5) * this.settings.startSpeed],
                    life: this.settings.startLifetime,
                    maxLife: this.settings.startLifetime
                });
            }
        }
        this.elapsed += dt;
        for (let index = this.particles.length - 1; index >= 0; index -= 1) {
            const particle = this.particles[index];
            particle.life -= dt;
            if (particle.life <= 0) {
                this.particles.splice(index, 1);
                continue;
            }
            for (let axis = 0; axis < 3; axis += 1) {
                particle.velocity[axis] += this.settings.gravity[axis] * dt;
                particle.position[axis] += particle.velocity[axis] * dt;
            }
        }
        if (!this.settings.loop && this.elapsed >= this.settings.duration && this.particles.length === 0) this.playing = false;
        return this.particles;
    }
}

export function createPlayerParticleEmitter(THREE, descriptor, object) {
    const simulation = new PlayerParticleSimulation(descriptor);
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
        size: descriptor.startSize, vertexColors: true, transparent: true,
        opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geometry, material);
    object.add(points);
    return {
        descriptor, simulation, material,
        command(command) {
            if (command === 'play') simulation.play();
            if (command === 'stop') simulation.stop();
        },
        update(deltaTime, active) {
            const particles = simulation.update(deltaTime, active);
            const positions = [];
            const colors = [];
            for (const particle of particles) {
                positions.push(...particle.position);
                const age = 1 - particle.life / particle.maxLife;
                for (let axis = 0; axis < 3; axis += 1) {
                    colors.push(descriptor.startColor[axis] + (descriptor.endColor[axis] - descriptor.startColor[axis]) * age);
                }
            }
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        },
        dispose() { geometry.dispose(); material.map?.dispose?.(); material.dispose(); object.remove(points); }
    };
}

export function consumePlayerParticleCommands(commands, lastSequence, emitters) {
    let consumedSequence = Number.isInteger(lastSequence) ? lastSequence : 0;
    for (const command of commands || []) {
        if (!Number.isInteger(command?.sequence) || command.sequence <= consumedSequence) continue;
        if (command.command === 'play' || command.command === 'stop') {
            for (const emitter of emitters || []) {
                if (emitter?.descriptor?.objectId === command.objectId) emitter.command?.(command.command);
            }
        }
        consumedSequence = Math.max(consumedSequence, command.sequence);
    }
    return consumedSequence;
}
