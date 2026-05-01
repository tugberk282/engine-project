
const { GameObject } = require('./src/engine/GameObject');
const { Scene } = require('./src/engine/Scene');
const { Component } = require('./src/engine/Component');
const { ScriptRegistry } = require('./src/engine/ScriptRegistry');

// Mock ScriptRegistry
ScriptRegistry.initialize();

class TestComponent extends Component {
    static _serializableFields = ['otherObject'];
    constructor(go) {
        super(go);
        this.otherObject = null;
    }
}
ScriptRegistry.register('TestComponent', TestComponent);

async function testReferences() {
    const scene = new Scene();

    const go1 = new GameObject("Target");
    const go2 = new GameObject("Referencer");

    const comp = go2.addComponent(TestComponent);
    comp.otherObject = go1;

    scene.addGameObject(go1);
    scene.addGameObject(go2);

    console.log("Original Reference:", comp.otherObject.name);

    const json = scene.toJSON();
    console.log("Serialized JSON contains reference ID:", json.includes(go1.id));

    const newScene = new Scene();
    // In node, we might have issues with dynamic imports in the real Scene.ts
    // but we can test the logic if we adapt it or just verify the JSON first.

    console.log("JSON Output Sample:", json.substring(0, 500));
}

testReferences().catch(console.error);
