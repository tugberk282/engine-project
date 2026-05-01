import { Component } from '../engine/Component';
import { serialize } from '../engine/Decorators';

export default class AutoRotate extends Component {
    @serialize
    public rotationSpeed: number = 2.0;

    start() {
        console.log("AutoRotate started with speed:", this.rotationSpeed);
    }

    update(deltaTime: number) {
        this.gameObject.transform.rotation.y += this.rotationSpeed * deltaTime;
    }
}
