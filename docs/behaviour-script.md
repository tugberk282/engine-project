# BehaviourScript v1

`BehaviourScript` is the bounded gameplay scripting contract shared by editor Play Mode and exported Windows players. Add it from **Add Component > Scripting**, then edit its JSON program in the Inspector.

Programs may remain inline or be shared through a project asset. Create a JSON file such as `Assets/Scripts/PlayerMove.behaviour.json`, then set the component's **Asset Path** to that project-relative path. Play Mode and Windows Build read the latest file before starting, while the edit-scene cache remains unchanged. Missing, malformed, oversized, absolute, traversal and symlink-escaping asset references are rejected with typed errors instead of silently running stale code.

While Play Mode is running, edit an external `.behaviour.json` file and return focus to the editor to trigger a bounded domain reload. All changed behaviour assets are resolved together and the runtime restarts once with frame time and script state reset. A missing or invalid source cancels the reload and leaves the current runtime session running; the edit-scene snapshot is never replaced.

```json
{
  "version": 1,
  "variables": { "speed": 4 },
  "start": [
    { "op": "setPosition", "value": [0, 1, 0] }
  ],
  "update": [
    {
      "op": "translate",
      "value": [
        { "multiply": [{ "input": "Horizontal" }, { "variable": "speed" }, { "deltaTime": true] },
        0,
        { "multiply": [{ "input": "Vertical" }, { "variable": "speed" }, { "deltaTime": true] }
      ]
    }
  ],
  "fixedUpdate": [],
  "events": {
    "ShowMessage": [
      { "op": "setText", "target": "tag:Hud", "value": { "eventValue": true } }
    ]
  }
}
```

## Actions

- Transform: `translate`, `setPosition`, `addRotation`, `setRotation`, `setScale`
- Physics: `setVelocity`, `addVelocity` on a target with `RigidBody`
- Object/UI: `setActive`, `toggleActive`, `destroy`, `setText`
- State and flow: `setVariable`, `addVariable`, `if`

Targets are `self` (the default), a GameObject ID/name, or `tag:TagName`.

`destroy` removes the target and its descendants from scripts, physics, rendering, UI, audio and particles for the rest of the current runtime session. It cannot be reversed with `setActive`; stopping or restarting Play Mode reconstructs the authored scene snapshot.

Expressions support `input`, `button`, `buttonDown`, `buttonUp`, `variable`, `deltaTime`, `eventValue`, `eventField`, `add`, `multiply`, `negate`, `clamp`, `equals`, `greaterThan`, `not`, `and`, and `or`. For example, `{ "buttonDown": "Fire" }` is true only on the press frame, while `{ "button": "Fire" }` remains true while the authored action is held. The runtime rejects malformed programs, limits source size, expression depth and operations per event, and reports diagnostics without evaluating arbitrary JavaScript.

Physics callbacks use the named events `collisionEnter`, `collisionStay`, `collisionExit`, `triggerEnter`, `triggerStay`, and `triggerExit`. Their event value contains `otherId`, `otherName`, `otherTag`, and `isTrigger`; for example `{ "eventField": "otherTag" }` reads the other object's tag.

This is a deliberately scoped V1 gameplay language, not C# or Unity API compatibility. External behaviour assets support safe domain reload, while project-local TypeScript/C# compilation remains separate roadmap work.
