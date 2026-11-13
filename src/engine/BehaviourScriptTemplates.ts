export type BehaviourScriptTemplateId = 'empty' | 'input-movement' | 'rotator' | 'trigger-deactivator';

export interface BehaviourScriptTemplateOption {
    id: BehaviourScriptTemplateId;
    label: string;
    description: string;
}

export const BEHAVIOUR_SCRIPT_TEMPLATES: readonly BehaviourScriptTemplateOption[] = [
    { id: 'empty', label: 'Empty', description: 'Blank lifecycle and event sections.' },
    { id: 'input-movement', label: 'Input Movement', description: 'Moves on the Horizontal and Vertical input axes.' },
    { id: 'rotator', label: 'Rotator', description: 'Rotates continuously around the Y axis.' },
    { id: 'trigger-deactivator', label: 'Trigger Deactivator', description: 'Deactivates the other object when a trigger is entered.' }
];

export function createBehaviourScriptTemplate(id: BehaviourScriptTemplateId): string {
    const empty = () => ({ version: 1, variables: {}, start: [], update: [], fixedUpdate: [], events: {} });
    let program: Record<string, unknown> = empty();
    if (id === 'input-movement') {
        program = {
            ...empty(),
            variables: { speed: 3 },
            update: [{
                op: 'translate',
                value: [
                    { multiply: [{ input: 'Horizontal' }, { variable: 'speed' }, { deltaTime: true }] },
                    0,
                    { multiply: [{ input: 'Vertical' }, { variable: 'speed' }, { deltaTime: true }] }
                ]
            }]
        };
    } else if (id === 'rotator') {
        program = {
            ...empty(),
            variables: { degreesPerSecond: 90 },
            update: [{
                op: 'addRotation',
                value: [0, { multiply: [{ variable: 'degreesPerSecond' }, { deltaTime: true }] }, 0]
            }]
        };
    } else if (id === 'trigger-deactivator') {
        program = {
            ...empty(),
            events: {
                triggerEnter: [{ op: 'setActive', target: { eventField: 'otherId' }, value: false }]
            }
        };
    }
    return JSON.stringify(program, null, 2);
}
