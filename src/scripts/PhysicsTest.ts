import { GameObject } from "../engine/GameObject";
import { BoxCollider } from "../engine/components/BoxCollider";
import { RigidBody } from "../engine/components/RigidBody";
import { Component } from "../engine/Component";

export class PhysicsTest extends Component {
    private ground!: GameObject;
    private cube!: GameObject;

    public start(): void {
        console.log("--- Physics Test Started ---");

        // 1. Create Ground (Static)
        this.ground = new GameObject("Ground");
        this.ground.transform.position.set(0, 0, 0);
        this.ground.transform.scale.set(10, 0.1, 10);
        const groundRb = this.ground.addComponent(RigidBody);
        groundRb.setMass(0); // Static
        const groundCol = this.ground.addComponent(BoxCollider);
        groundCol.size.set(10, 0.1, 10);

        // 2. Create Falling Cube
        this.cube = new GameObject("FallingCube");
        this.cube.transform.position.set(0, 5, 0);
        this.cube.addComponent(RigidBody);
        this.cube.addComponent(BoxCollider);

        // 3. Add Logger Component to Cube
        this.cube.addComponent(PhysicsLogger);

        console.log("Physics setup complete. Cube should fall and collide with ground.");
    }
}

class PhysicsLogger extends Component {
    public onCollisionEnter(collision: any) {
        console.log(`Collision Enter: ${this.gameObject.name} hit ${collision.gameObject.name}`);
    }

    public onCollisionStay(_collision: any) {
        // console.log("Collision Stay...");
    }

    public onCollisionExit(collision: any) {
        console.log(`Collision Exit: ${this.gameObject.name} stopped hitting ${collision.gameObject.name}`);
    }

    public onTriggerEnter(other: GameObject) {
        console.log(`Trigger Enter: ${this.gameObject.name} entered ${other.name}`);
    }

    public onTriggerExit(other: GameObject) {
        console.log(`Trigger Exit: ${this.gameObject.name} exited ${other.name}`);
    }
}
