import * as CANNON from 'cannon-es';
import { RigidBody } from './components/RigidBody';
import { LayerManager } from './LayerManager';
import { ProjectSettings } from './ProjectSettings';

export class PhysicsSystem {
    public world: CANNON.World;
    private static instance: PhysicsSystem;
    private rigidBodies: RigidBody[] = [];
    private previousContacts: Set<string> = new Set();
    private appliedSettingsKey: string = '';

    private constructor() {
        this.world = new CANNON.World();
        this.world.gravity.set(0, -9.82, 0); // fallback
        // Use NaiveBroadphase for simplicity; SAPBroadphase is faster for many bodies
        this.world.broadphase = new CANNON.NaiveBroadphase();
        this.syncProjectSettings(true);
    }

    public static getInstance(): PhysicsSystem {
        if (!this.instance) {
            this.instance = new PhysicsSystem();
        }
        return this.instance;
    }

    public registerBody(rb: RigidBody) {
        if (rb.body) {
            this.syncProjectSettings();
            // Apply layer-based collision filtering
            this.applyLayerFilter(rb);
            this.rigidBodies.push(rb);
            this.world.addBody(rb.body);

            // Basic Collision Enter (handled by Cannon-es event)
            rb.body.addEventListener('collide', (e: any) => {
                const otherBody = e.body;
                const otherGO = otherBody.userData?.gameObject;
                if (!otherGO) return;

                const collision = {
                    gameObject: otherGO,
                    contact: e.contact,
                    relativeVelocity: e.target.velocity.vsub(otherBody.velocity)
                };

                rb.gameObject.components.forEach(c => {
                    if ((c as any).onCollisionEnter) (c as any).onCollisionEnter(collision);
                });
            });
        }
    }

    public unregisterBody(rb: RigidBody) {
        const index = this.rigidBodies.indexOf(rb);
        if (index > -1) {
            this.rigidBodies.splice(index, 1);
        }
        if (rb.body) {
            this.world.removeBody(rb.body);
        }
    }

    /**
     * Apply cannon-es collision filter groups/masks based on the GameObject's layer.
     * cannon-es uses collisionFilterGroup (which group this body belongs to)
     * and collisionFilterMask (which groups it collides with).
     */
    public applyLayerFilter(rb: RigidBody): void {
        if (!rb.body) return;
        const layer = rb.gameObject.layer;
        const lm = LayerManager.getInstance();
        rb.body.collisionFilterGroup = lm.getLayerBitmask(layer);
        rb.body.collisionFilterMask = lm.getCollisionMask(layer);
    }

    /**
     * Refresh collision filters for all registered bodies.
     * Call this after changing the collision matrix in Project Settings.
     */
    public refreshAllLayerFilters(): void {
        for (const rb of this.rigidBodies) {
            this.applyLayerFilter(rb);
        }
    }

    /**
     * Returns true when a dynamic body has a supporting contact beneath it.
     * The normal test avoids treating walls and ceilings as ground and is more
     * reliable than guessing from vertical velocity at the top of a jump.
     */
    public isGrounded(rb: RigidBody, maxSlopeDegrees: number = 50): boolean {
        if (!rb.body) return false;
        const minimumUp = Math.cos(Math.max(0, Math.min(89, maxSlopeDegrees)) * Math.PI / 180);

        return this.world.contacts.some((contact) => {
            const bodyI = contact.bi as CANNON.Body;
            const bodyJ = contact.bj as CANNON.Body;
            if (bodyI !== rb.body && bodyJ !== rb.body) return false;
            if (!bodyI.collisionResponse || !bodyJ.collisionResponse) return false;

            // Cannon's contact normal points from body i toward body j. For
            // body j it is therefore the supporting normal; body i gets its inverse.
            const supportingY = bodyJ === rb.body ? contact.ni.y : -contact.ni.y;
            return supportingY >= minimumUp;
        });
    }

    /**
     * Keep runtime world parameters in sync with project-level physics settings.
     * This makes settings changes effective immediately and keeps scene load deterministic.
     */
    public syncProjectSettings(force: boolean = false): void {
        const gravityY = Number.isFinite(ProjectSettings.gravity) ? ProjectSettings.gravity : -9.81;
        const solverIterations = Math.max(1, Math.trunc(
            Number.isFinite(ProjectSettings.defaultSolverIterations) ? ProjectSettings.defaultSolverIterations : 6
        ));
        const solverVelocityIterations = Math.max(1, Math.trunc(
            Number.isFinite(ProjectSettings.defaultSolverVelocityIterations) ? ProjectSettings.defaultSolverVelocityIterations : 1
        ));
        const sleepThreshold = Math.max(0, Number.isFinite(ProjectSettings.sleepThreshold) ? ProjectSettings.sleepThreshold : 0.005);
        const bounceThreshold = Math.max(0, Number.isFinite(ProjectSettings.bounceThreshold) ? ProjectSettings.bounceThreshold : 2);
        const contactOffset = Math.max(0, Number.isFinite(ProjectSettings.defaultContactOffset) ? ProjectSettings.defaultContactOffset : 0.01);

        const settingsKey = `${gravityY}|${solverIterations}|${solverVelocityIterations}|${sleepThreshold}|${bounceThreshold}|${contactOffset}`;
        if (!force && this.appliedSettingsKey === settingsKey) return;

        this.world.gravity.set(0, gravityY, 0);
        const solverAny = this.world.solver as any;
        solverAny.iterations = solverIterations;
        if (typeof solverAny.tolerance === 'number') {
            // Lower tolerance with higher velocity iterations for a more stable solve.
            solverAny.tolerance = 1 / Math.max(1000, solverVelocityIterations * 1000);
        }

        const defaultContactMaterialAny = this.world.defaultContactMaterial as any;
        if (defaultContactMaterialAny) {
            // Best-effort mappings for parity-tuned contact behavior.
            defaultContactMaterialAny.contactEquationRelaxation = Math.max(1, 4 - Math.min(3, solverVelocityIterations - 1));
            defaultContactMaterialAny.frictionEquationRelaxation = Math.max(1, 4 - Math.min(3, solverVelocityIterations - 1));
            defaultContactMaterialAny.contactSkinSize = contactOffset;
            defaultContactMaterialAny.restitutionVelocity = bounceThreshold;
        }

        this.rigidBodies.forEach((rb) => {
            if (!rb.body) return;
            rb.body.sleepSpeedLimit = sleepThreshold;
        });

        this.appliedSettingsKey = settingsKey;
    }

    public update(deltaTime: number, fixedDelta: number = 1 / 60) {
        this.syncProjectSettings();
        const safeFixedDelta = Math.max(0.0001, Number.isFinite(fixedDelta) ? fixedDelta : (1 / 60));
        const gravity = this.world.gravity;
        for (const rb of this.rigidBodies) {
            if (!rb.body) continue;
            const isDynamic = rb.body.type === CANNON.BODY_TYPES.DYNAMIC;
            const isKinematic = rb.body.type === CANNON.BODY_TYPES.KINEMATIC;

            // Enforce position constraints so frozen axes remain locked even with residual velocity.
            if (rb.freezePositionX) {
                rb.body.velocity.x = 0;
                rb.body.force.x = 0;
            }
            if (rb.freezePositionY) {
                rb.body.velocity.y = 0;
                rb.body.force.y = 0;
            }
            if (rb.freezePositionZ) {
                rb.body.velocity.z = 0;
                rb.body.force.z = 0;
            }

            // Enforce rotation constraints similarly for angular motion.
            if (rb.freezeRotationX) {
                rb.body.angularVelocity.x = 0;
                rb.body.torque.x = 0;
            }
            if (rb.freezeRotationY) {
                rb.body.angularVelocity.y = 0;
                rb.body.torque.y = 0;
            }
            if (rb.freezeRotationZ) {
                rb.body.angularVelocity.z = 0;
                rb.body.torque.z = 0;
            }

            if (!isDynamic) {
                // Kinematic bodies are transform-driven; skip gravity handling.
                if (isKinematic) continue;
                continue;
            }

            // Fallback per-body gravity control for engines/builds where gravityScale is unavailable.
            if (!rb.useGravity) {
                rb.body.force.x += -gravity.x * rb.body.mass;
                rb.body.force.y += -gravity.y * rb.body.mass;
                rb.body.force.z += -gravity.z * rb.body.mass;
            }
        }

        // Step the physics world
        this.world.step(safeFixedDelta, deltaTime, 3);

        this.processContacts();

        // Re-apply frozen position anchors after solver integration to avoid residual drift.
        for (const rb of this.rigidBodies) {
            rb.enforceFrozenPosition();
        }

        // Sync visual transforms
        for (const rb of this.rigidBodies) {
            rb.syncTransform(safeFixedDelta);
        }
    }

    private processContacts() {
        const currentContacts: Set<string> = new Set();

        // Iterate through all contacts in the world
        for (let i = 0; i < this.world.contacts.length; i++) {
            const contact = this.world.contacts[i];
            const bi = contact.bi as any;
            const bj = contact.bj as any;

            if (!bi.userData || !bj.userData) continue;

            const goI = bi.userData.gameObject;
            const goJ = bj.userData.gameObject;

            const isTriggerI = !bi.collisionResponse;
            const isTriggerJ = !bj.collisionResponse;

            // Create unique ID for this pair
            const pairId = bi.id < bj.id ? `${bi.id}-${bj.id}` : `${bj.id}-${bi.id}`;
            currentContacts.add(pairId);

            const isNewContact = !this.previousContacts.has(pairId);

            // Trigger events
            if (isTriggerI || isTriggerJ) {
                this.dispatchPhysicsEvent(goI, isNewContact ? 'onTriggerEnter' : 'onTriggerStay', goJ);
                this.dispatchPhysicsEvent(goJ, isNewContact ? 'onTriggerEnter' : 'onTriggerStay', goI);
            } else {
                // Collision events
                this.dispatchPhysicsEvent(goI, 'onCollisionStay', { gameObject: goJ });
                this.dispatchPhysicsEvent(goJ, 'onCollisionStay', { gameObject: goI });
            }
        }

        // Detect Exit events
        for (const oldPair of this.previousContacts) {
            if (!currentContacts.has(oldPair)) {
                // Find bodies by ID (simplification, ideally we store refs in a map)
                const ids = oldPair.split('-').map(Number);
                const bi = this.world.getBodyById(ids[0]) as any;
                const bj = this.world.getBodyById(ids[1]) as any;

                if (bi && bj && bi.userData && bj.userData) {
                    const goI = bi.userData.gameObject;
                    const goJ = bj.userData.gameObject;
                    const isTrigger = !bi.collisionResponse || !bj.collisionResponse;

                    if (isTrigger) {
                        this.dispatchPhysicsEvent(goI, 'onTriggerExit', goJ);
                        this.dispatchPhysicsEvent(goJ, 'onTriggerExit', goI);
                    } else {
                        this.dispatchPhysicsEvent(goI, 'onCollisionExit', { gameObject: goJ });
                        this.dispatchPhysicsEvent(goJ, 'onCollisionExit', { gameObject: goI });
                    }
                }
            }
        }

        this.previousContacts = currentContacts;
    }

    private dispatchPhysicsEvent(gameObject: any, methodName: string, arg: any) {
        if (!gameObject || !gameObject.components) return;
        gameObject.components.forEach((c: any) => {
            if (c[methodName]) c[methodName](arg);
        });
    }
}
