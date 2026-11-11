import { Component } from '../Component';
import { serialize } from '../Decorators';

const DEFAULT_PROGRAM = JSON.stringify({
    version: 1,
    variables: { speed: 3 },
    start: [],
    update: [{
        op: 'translate',
        value: [
            { multiply: [{ input: 'Horizontal' }, { variable: 'speed' }, { deltaTime: true }] },
            0,
            { multiply: [{ input: 'Vertical' }, { variable: 'speed' }, { deltaTime: true }] }
        ]
    }],
    fixedUpdate: [],
    events: {}
}, null, 2);

/** A bounded, data-driven gameplay script executed identically in Play Mode and exported players. */
export class BehaviourScript extends Component {
    @serialize public assetPath: string = '';
    @serialize public program: string = DEFAULT_PROGRAM;
}
