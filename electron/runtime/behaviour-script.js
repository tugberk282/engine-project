'use strict';

(function exposeBehaviourScriptRuntime(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TugberkBehaviourScript = api;
})(typeof globalThis === 'object' ? globalThis : null, () => {
    const MAX_SOURCE_LENGTH = 64 * 1024;
    const MAX_ACTIONS_PER_EVENT = 256;
    const MAX_EXPRESSION_DEPTH = 16;

    function validateActionList(actions, eventName, state, depth = 0) {
        if (!Array.isArray(actions)) return `${eventName} must be an action array.`;
        if (depth > MAX_EXPRESSION_DEPTH) return `${eventName} exceeds the nested action depth limit.`;
        for (const action of actions) {
            state.count += 1;
            if (state.count > MAX_ACTIONS_PER_EVENT) return `${eventName} exceeds ${MAX_ACTIONS_PER_EVENT} nested actions.`;
            if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.op !== 'string') {
                return `${eventName} contains an action without an op string.`;
            }
            if (action.op !== 'if') continue;
            for (const branch of ['then', 'else']) {
                if (action[branch] === undefined) continue;
                const error = validateActionList(action[branch], eventName, state, depth + 1);
                if (error) return error;
            }
        }
        return null;
    }

    function finite(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function componentData(component) {
        return component?.data && typeof component.data === 'object' ? component.data : component || {};
    }

    function cloneRuntimePrefab(prefabData, idPrefix) {
        if (!prefabData || typeof prefabData !== 'object' || Array.isArray(prefabData)) {
            throw new Error('Prefab data must be an object.');
        }
        if (typeof idPrefix !== 'string' || !idPrefix || idPrefix.length > 128) {
            throw new Error('Prefab clone ID prefix is invalid.');
        }
        const clone = structuredClone(prefabData);
        const idMap = new Map();
        let nodeCount = 0;
        const assignIds = (node) => {
            if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Prefab contains an invalid node.');
            nodeCount += 1;
            if (nodeCount > 256) throw new Error('Prefab exceeds the runtime node limit.');
            const previousId = typeof node.id === 'string' ? node.id : '';
            const nextId = `${idPrefix}-${nodeCount}`;
            if (previousId) idMap.set(previousId, nextId);
            node.id = nextId;
            if (!Array.isArray(node.children)) node.children = [];
            if (!Array.isArray(node.components)) node.components = [];
            if (node.components.length > 128) throw new Error('Prefab node exceeds the runtime component limit.');
            for (const child of node.children) assignIds(child);
        };
        assignIds(clone);
        const rewriteReferences = (value, depth = 0) => {
            if (depth > 64) throw new Error('Prefab reference graph exceeds the runtime depth limit.');
            if (Array.isArray(value)) {
                for (let index = 0; index < value.length; index += 1) value[index] = rewriteReferences(value[index], depth + 1);
                return value;
            }
            if (!value || typeof value !== 'object') return value;
            if (typeof value.__ref === 'string' && idMap.has(value.__ref)) value.__ref = idMap.get(value.__ref);
            for (const key of Object.keys(value)) value[key] = rewriteReferences(value[key], depth + 1);
            return value;
        };
        rewriteReferences(clone);
        clone.name = `${String(clone.name || 'GameObject')} (Clone)`;
        clone.transform ||= {};
        clone.transform.position = [0, 0, 0];
        clone.transform.rotation = [0, 0, 0];
        clone.transform.scale = Array.isArray(clone.transform.scale) ? clone.transform.scale.slice(0, 3) : [1, 1, 1];
        return clone;
    }

    function compileBehaviourProgram(source) {
        if (typeof source !== 'string') return { ok: false, error: 'Program must be JSON text.' };
        if (source.length > MAX_SOURCE_LENGTH) return { ok: false, error: `Program exceeds ${MAX_SOURCE_LENGTH} characters.` };
        let value;
        try {
            value = JSON.parse(source || '{}');
        } catch (error) {
            return { ok: false, error: `Invalid JSON: ${error.message}` };
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Program root must be an object.' };
        if (value.version !== undefined && value.version !== 1) return { ok: false, error: 'Only BehaviourScript version 1 is supported.' };
        const events = value.events && typeof value.events === 'object' && !Array.isArray(value.events) ? value.events : {};
        const lists = { start: value.start, update: value.update, fixedUpdate: value.fixedUpdate, ...events };
        for (const [name, actions] of Object.entries(lists)) {
            if (actions === undefined) continue;
            const error = validateActionList(actions, name, { count: 0 });
            if (error) return { ok: false, error };
        }
        return {
            ok: true,
            program: {
                start: Array.isArray(value.start) ? value.start : [],
                update: Array.isArray(value.update) ? value.update : [],
                fixedUpdate: Array.isArray(value.fixedUpdate) ? value.fixedUpdate : [],
                events,
                variables: value.variables && typeof value.variables === 'object' && !Array.isArray(value.variables)
                    ? structuredClone(value.variables) : {}
            }
        };
    }

    function createBehaviourRuntime(objects, options = {}) {
        const allObjects = Array.isArray(objects) ? objects : [];
        const diagnostics = [];
        const instances = [];
        const registeredOwners = new WeakSet();
        const maxOperations = Math.max(16, Math.min(2048, Math.trunc(finite(options.maxOperations, 512))));

        const objectActive = (object) => object?.destroyed !== true
            && object?._runtimeDestroyed !== true
            && object?.active !== false
            && object?.enabled !== false;
        const componentEnabled = (component) => component?.enabled !== false && componentData(component).enabled !== false;
        const findObject = (owner, selector, allowInactiveId = false) => {
            if (!selector || selector === 'self') return objectActive(owner) ? owner : null;
            if (typeof selector !== 'string') return null;
            if (allowInactiveId) {
                const referenced = allObjects.find((entry) => entry?.id === selector && entry?.destroyed !== true && entry?._runtimeDestroyed !== true);
                if (referenced) return referenced;
            }
            if (selector.startsWith('tag:')) return allObjects.find((entry) => objectActive(entry) && entry.tag === selector.slice(4)) || null;
            return allObjects.find((entry) => objectActive(entry) && (entry.id === selector || entry.name === selector)) || null;
        };
        const findPooledObject = (selector) => {
            if (typeof selector !== 'string' || !selector) return null;
            return allObjects.find((entry) => {
                if (!entry || entry.destroyed === true || entry._runtimeDestroyed === true || objectActive(entry)) return false;
                return selector.startsWith('tag:')
                    ? entry.tag === selector.slice(4)
                    : entry.id === selector || entry.name === selector;
            }) || null;
        };
        const findComponent = (object, type) => (object?.components || []).find((entry) => entry?.type === type) || null;
        const axisIndex = (axis) => ({ x: 0, y: 1, z: 2 }[axis]);
        const readObjectProperty = (owner, descriptor) => {
            if (!descriptor || typeof descriptor !== 'object') throw new Error('objectProperty requires a descriptor.');
            const target = findObject(owner, descriptor.target, true);
            if (!target) throw new Error(`Target not found: ${String(descriptor.target)}`);
            const property = descriptor.property;
            if (property === 'name') return target.name || '';
            if (property === 'tag') return target.tag || '';
            if (property === 'active') return objectActive(target);
            const [group, axis, extra] = typeof property === 'string' ? property.split('.') : [];
            const index = axisIndex(axis);
            if (extra === undefined && index !== undefined && ['position', 'rotation', 'scale'].includes(group)) {
                const fallback = group === 'scale' ? 1 : 0;
                return finite(target.transform?.[group]?.[index], fallback);
            }
            if (extra === undefined && group === 'velocity' && index !== undefined) {
                const body = findComponent(target, 'RigidBody');
                return finite(componentData(body).velocity?.[index], 0);
            }
            throw new Error(`Unsupported object property: ${String(property)}`);
        };
        const report = (instance, phase, message) => {
            if (diagnostics.length >= 64) return;
            diagnostics.push({ objectId: String(instance.owner?.id || ''), phase, message: String(message).slice(0, 512) });
        };

        const registerOwner = (owner) => {
            if (!owner || typeof owner !== 'object' || registeredOwners.has(owner)) return;
            registeredOwners.add(owner);
            for (const component of owner?.components || []) {
                if (component?.type !== 'BehaviourScript') continue;
                const compiled = compileBehaviourProgram(componentData(component).program || '{}');
                const instance = { owner, component, program: compiled.program || null, variables: {}, started: false };
                if (compiled.ok) instance.variables = structuredClone(compiled.program.variables);
                else report(instance, 'compile', compiled.error);
                instances.push(instance);
            }
        };
        const registerHierarchy = (roots) => {
            const visit = (owner) => {
                registerOwner(owner);
                for (const child of owner?.children || []) visit(child);
            };
            for (const root of roots || []) visit(root);
        };
        registerHierarchy(allObjects);

        function evaluate(expression, context, depth = 0) {
            if (depth > MAX_EXPRESSION_DEPTH) throw new Error('Expression depth limit exceeded.');
            if (expression === null || typeof expression !== 'object') return expression;
            if (Array.isArray(expression)) return expression.map((entry) => evaluate(entry, context, depth + 1));
            if (typeof expression.input === 'string') return finite(context.input?.[expression.input], 0);
            if (typeof expression.button === 'string') return context.input?.[expression.button] === true;
            if (typeof expression.buttonDown === 'string') return context.input?.[`__buttonDown:${expression.buttonDown}`] === true;
            if (typeof expression.buttonUp === 'string') return context.input?.[`__buttonUp:${expression.buttonUp}`] === true;
            if (typeof expression.variable === 'string') return context.instance.variables[expression.variable] ?? 0;
            if (expression.deltaTime === true) return context.deltaTime;
            if (expression.eventValue === true) return context.eventValue;
            if (typeof expression.eventField === 'string') {
                return context.eventValue && typeof context.eventValue === 'object'
                    ? context.eventValue[expression.eventField]
                    : undefined;
            }
            if (expression.objectProperty && typeof expression.objectProperty === 'object') {
                return readObjectProperty(context.instance.owner, expression.objectProperty);
            }
            if (typeof expression.distanceTo === 'string') {
                const target = findObject(context.instance.owner, expression.distanceTo);
                if (!target) throw new Error(`Target not found: ${expression.distanceTo}`);
                const origin = Array.isArray(context.instance.owner?.transform?.position) ? context.instance.owner.transform.position : [0, 0, 0];
                const destination = Array.isArray(target.transform?.position) ? target.transform.position : [0, 0, 0];
                return Math.hypot(...origin.slice(0, 3).map((value, index) => finite(destination[index]) - finite(value)));
            }
            if (Array.isArray(expression.add)) return expression.add.reduce((sum, entry) => sum + finite(evaluate(entry, context, depth + 1)), 0);
            if (Array.isArray(expression.multiply)) return expression.multiply.reduce((product, entry) => product * finite(evaluate(entry, context, depth + 1), 1), 1);
            if (Array.isArray(expression.subtract) && expression.subtract.length === 2) return finite(evaluate(expression.subtract[0], context, depth + 1)) - finite(evaluate(expression.subtract[1], context, depth + 1));
            if (Array.isArray(expression.divide) && expression.divide.length === 2) {
                const divisor = finite(evaluate(expression.divide[1], context, depth + 1));
                if (divisor === 0) throw new Error('Division by zero.');
                return finite(evaluate(expression.divide[0], context, depth + 1)) / divisor;
            }
            if (Array.isArray(expression.modulo) && expression.modulo.length === 2) {
                const divisor = finite(evaluate(expression.modulo[1], context, depth + 1));
                if (divisor === 0) throw new Error('Modulo by zero.');
                return finite(evaluate(expression.modulo[0], context, depth + 1)) % divisor;
            }
            if (Array.isArray(expression.min) && expression.min.length > 0) return Math.min(...expression.min.map((entry) => finite(evaluate(entry, context, depth + 1))));
            if (Array.isArray(expression.max) && expression.max.length > 0) return Math.max(...expression.max.map((entry) => finite(evaluate(entry, context, depth + 1))));
            if ('abs' in expression) return Math.abs(finite(evaluate(expression.abs, context, depth + 1)));
            if (Array.isArray(expression.concat)) return expression.concat.map((entry) => String(evaluate(entry, context, depth + 1) ?? '')).join('');
            if ('negate' in expression) return -finite(evaluate(expression.negate, context, depth + 1));
            if (Array.isArray(expression.clamp) && expression.clamp.length === 3) {
                const value = finite(evaluate(expression.clamp[0], context, depth + 1));
                return Math.max(finite(evaluate(expression.clamp[1], context, depth + 1)), Math.min(finite(evaluate(expression.clamp[2], context, depth + 1)), value));
            }
            if (Array.isArray(expression.equals) && expression.equals.length === 2) return evaluate(expression.equals[0], context, depth + 1) === evaluate(expression.equals[1], context, depth + 1);
            if (Array.isArray(expression.greaterThan) && expression.greaterThan.length === 2) return finite(evaluate(expression.greaterThan[0], context, depth + 1)) > finite(evaluate(expression.greaterThan[1], context, depth + 1));
            if (Array.isArray(expression.lessThan) && expression.lessThan.length === 2) return finite(evaluate(expression.lessThan[0], context, depth + 1)) < finite(evaluate(expression.lessThan[1], context, depth + 1));
            if (Array.isArray(expression.greaterOrEqual) && expression.greaterOrEqual.length === 2) return finite(evaluate(expression.greaterOrEqual[0], context, depth + 1)) >= finite(evaluate(expression.greaterOrEqual[1], context, depth + 1));
            if (Array.isArray(expression.lessOrEqual) && expression.lessOrEqual.length === 2) return finite(evaluate(expression.lessOrEqual[0], context, depth + 1)) <= finite(evaluate(expression.lessOrEqual[1], context, depth + 1));
            if ('not' in expression) return !evaluate(expression.not, context, depth + 1);
            if (Array.isArray(expression.and)) return expression.and.every((entry) => Boolean(evaluate(entry, context, depth + 1)));
            if (Array.isArray(expression.or)) return expression.or.some((entry) => Boolean(evaluate(entry, context, depth + 1)));
            throw new Error('Unsupported expression.');
        }

        function vector(value, context, fallback) {
            const result = evaluate(value, context);
            if (!Array.isArray(result) || result.length < 3) throw new Error('Action value must resolve to a three-number vector.');
            return [finite(result[0], fallback[0]), finite(result[1], fallback[1]), finite(result[2], fallback[2])];
        }

        function selector(value, context) {
            if (typeof value === 'string') return value;
            if (value === undefined || value === null) return value;
            const resolved = evaluate(value, context);
            return typeof resolved === 'string' ? resolved : String(resolved ?? '');
        }

        function setObjectActive(target, active) {
            if (target?.destroyed === true || target?._runtimeDestroyed === true) return;
            if ('selfActive' in target) target.selfActive = active;
            if ('_runtimeSelfEnabled' in target) target._runtimeSelfEnabled = active;
            if ('active' in target) target.active = active;
            if ('enabled' in target) target.enabled = active;
            options.refreshActiveState?.();
        }

        function destroyObject(target) {
            const visit = (object) => {
                if (!object || typeof object !== 'object') return;
                object.destroyed = true;
                object._runtimeDestroyed = true;
                if ('selfActive' in object) object.selfActive = false;
                if ('_runtimeSelfEnabled' in object) object._runtimeSelfEnabled = false;
                if ('active' in object) object.active = false;
                if ('enabled' in object) object.enabled = false;
                for (const child of object.children || []) visit(child);
            };
            visit(target);
            options.refreshActiveState?.();
        }

        function executeActions(actions, context, budget) {
            for (const action of actions || []) {
                if (--budget.remaining < 0) throw new Error(`Operation budget of ${maxOperations} exceeded.`);
                if (!action || typeof action !== 'object' || typeof action.op !== 'string') throw new Error('Each action requires an op string.');
                if (action.op === 'if') {
                    const branch = evaluate(action.condition, context) ? action.then : action.else;
                    if (branch !== undefined && !Array.isArray(branch)) throw new Error('if branches must be action arrays.');
                    executeActions(branch || [], context, budget);
                    continue;
                }
                if (action.op === 'setVariable' || action.op === 'addVariable') {
                    if (typeof action.name !== 'string' || !action.name) throw new Error('Variable action requires a name.');
                    const value = evaluate(action.value, context);
                    context.instance.variables[action.name] = action.op === 'addVariable'
                        ? finite(context.instance.variables[action.name]) + finite(value) : value;
                    continue;
                }
                if (action.op === 'sendEvent') {
                    if (typeof action.name !== 'string' || !action.name) throw new Error('sendEvent requires a name.');
                    const targetSelector = selector(action.target, context);
                    const target = findObject(context.instance.owner, targetSelector);
                    if (!target) throw new Error(`Target not found: ${String(targetSelector)}`);
                    const value = action.value === undefined ? null : evaluate(action.value, context);
                    for (const instance of instances) {
                        if (instance.owner !== target) continue;
                        ensureStarted(instance, context.input, budget);
                        invoke(instance, `event:${action.name}`, instance.program?.events?.[action.name], 0, context.input, value, budget);
                    }
                    continue;
                }
                if (action.op === 'playAudio' || action.op === 'stopAudio') {
                    const targetSelector = selector(action.target, context);
                    const target = findObject(context.instance.owner, targetSelector, true);
                    if (!target) throw new Error(`Target not found: ${String(targetSelector)}`);
                    if (!findComponent(target, 'AudioSource')) throw new Error(`${action.op} target requires AudioSource.`);
                    options.audioCommand?.({
                        objectId: String(target.id || ''),
                        command: action.op === 'playAudio' ? 'play' : 'stop'
                    });
                    continue;
                }
                if (action.op === 'playParticles' || action.op === 'stopParticles') {
                    const targetSelector = selector(action.target, context);
                    const target = findObject(context.instance.owner, targetSelector, true);
                    if (!target) throw new Error(`Target not found: ${String(targetSelector)}`);
                    if (!findComponent(target, 'ParticleSystem')) throw new Error(`${action.op} target requires ParticleSystem.`);
                    options.particleCommand?.({
                        objectId: String(target.id || ''),
                        command: action.op === 'playParticles' ? 'play' : 'stop'
                    });
                    continue;
                }
                if (action.op === 'playAnimation' || action.op === 'stopAnimation') {
                    const targetSelector = selector(action.target, context);
                    const target = findObject(context.instance.owner, targetSelector, true);
                    if (!target) throw new Error(`Target not found: ${String(targetSelector)}`);
                    if (!findComponent(target, 'Animator')) throw new Error(`${action.op} target requires Animator.`);
                    const clip = action.op === 'playAnimation' && action.clip !== undefined
                        ? String(evaluate(action.clip, context) ?? '') : null;
                    options.animationCommand?.({
                        objectId: String(target.id || ''),
                        command: action.op === 'playAnimation' ? 'play' : 'stop',
                        ...(clip ? { clip } : {})
                    });
                    continue;
                }
                if (action.op === 'spawnPooled') {
                    const poolSelector = selector(action.pool, context);
                    const target = findPooledObject(poolSelector);
                    if (!target) throw new Error(`No inactive pooled object found: ${String(poolSelector)}`);
                    target.transform ||= { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
                    const ownerPosition = Array.isArray(context.instance.owner?.transform?.position)
                        ? context.instance.owner.transform.position : [0, 0, 0];
                    const ownerRotation = Array.isArray(context.instance.owner?.transform?.rotation)
                        ? context.instance.owner.transform.rotation : [0, 0, 0];
                    target.transform.position = action.position === undefined
                        ? ownerPosition.slice(0, 3).map((entry) => finite(entry))
                        : vector(action.position, context, [0, 0, 0]);
                    target.transform.rotation = action.rotation === undefined
                        ? ownerRotation.slice(0, 3).map((entry) => finite(entry))
                        : vector(action.rotation, context, [0, 0, 0]);
                    const body = findComponent(target, 'RigidBody');
                    if (body && action.resetVelocity !== false) {
                        componentData(body).velocity = [0, 0, 0];
                        componentData(body).angularVelocity = [0, 0, 0];
                    }
                    setObjectActive(target, true);
                    if (typeof action.store === 'string' && action.store) {
                        context.instance.variables[action.store] = String(target.id || '');
                    }
                    continue;
                }
                if (action.op === 'instantiatePrefab') {
                    if (!action.prefabData || typeof action.prefabData !== 'object' || Array.isArray(action.prefabData)) {
                        throw new Error('instantiatePrefab requires resolved prefabData.');
                    }
                    const position = action.position === undefined
                        ? (context.instance.owner?.transform?.position || [0, 0, 0]).slice(0, 3).map((entry) => finite(entry))
                        : vector(action.position, context, [0, 0, 0]);
                    const rotation = action.rotation === undefined
                        ? (context.instance.owner?.transform?.rotation || [0, 0, 0]).slice(0, 3).map((entry) => finite(entry))
                        : vector(action.rotation, context, [0, 0, 0]);
                    const instantiated = options.instantiatePrefab?.({
                        prefabData: structuredClone(action.prefabData), position, rotation
                    });
                    if (!instantiated || typeof instantiated !== 'object') {
                        throw new Error('instantiatePrefab is unavailable in this runtime.');
                    }
                    registerHierarchy([instantiated]);
                    if (typeof action.store === 'string' && action.store) {
                        context.instance.variables[action.store] = String(instantiated.id || '');
                    }
                    continue;
                }
                const targetSelector = selector(action.target, context);
                const target = findObject(context.instance.owner, targetSelector, true);
                if (!target) throw new Error(`Target not found: ${String(targetSelector)}`);
                target.transform ||= { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
                if (!Array.isArray(target.transform.position)) target.transform.position = [0, 0, 0];
                if (!Array.isArray(target.transform.rotation)) target.transform.rotation = [0, 0, 0];
                if (!Array.isArray(target.transform.scale)) target.transform.scale = [1, 1, 1];
                if (action.op === 'translate') {
                    const amount = vector(action.value, context, [0, 0, 0]);
                    target.transform.position = target.transform.position.map((entry, index) => finite(entry) + amount[index]);
                } else if (action.op === 'moveTowards') {
                    const destinationSelector = selector(action.destination, context);
                    const destination = findObject(context.instance.owner, destinationSelector);
                    if (!destination) throw new Error(`Target not found: ${String(destinationSelector)}`);
                    const destinationPosition = Array.isArray(destination.transform?.position) ? destination.transform.position : [0, 0, 0];
                    const offset = target.transform.position.map((entry, index) => finite(destinationPosition[index]) - finite(entry));
                    const distance = Math.hypot(...offset);
                    const step = Math.max(0, finite(evaluate(action.speed, context))) * Math.max(0, context.deltaTime);
                    if (distance > 0 && step > 0) {
                        const ratio = Math.min(1, step / distance);
                        target.transform.position = target.transform.position.map((entry, index) => finite(entry) + offset[index] * ratio);
                    }
                } else if (action.op === 'setPosition') {
                    target.transform.position = vector(action.value, context, [0, 0, 0]);
                } else if (action.op === 'addRotation') {
                    const amount = vector(action.value, context, [0, 0, 0]);
                    target.transform.rotation = target.transform.rotation.map((entry, index) => finite(entry) + amount[index]);
                } else if (action.op === 'setRotation') {
                    target.transform.rotation = vector(action.value, context, [0, 0, 0]);
                } else if (action.op === 'setScale') {
                    target.transform.scale = vector(action.value, context, [1, 1, 1]);
                } else if (action.op === 'setVelocity' || action.op === 'addVelocity' || action.op === 'addForce') {
                    const body = findComponent(target, 'RigidBody');
                    if (!body) throw new Error(`${action.op} target requires RigidBody.`);
                    const data = componentData(body);
                    const amount = vector(action.value, context, [0, 0, 0]);
                    if (action.op === 'addForce') {
                        if (data.isKinematic === true || finite(data.mass, 1) <= 0) continue;
                        const mode = ['Force', 'Acceleration', 'Impulse', 'VelocityChange'].includes(action.mode)
                            ? action.mode : 'Force';
                        const mass = Math.max(0.000001, finite(data.mass, 1));
                        const timeFactor = mode === 'Force' || mode === 'Acceleration' ? Math.max(0, context.deltaTime) : 1;
                        const massFactor = mode === 'Force' || mode === 'Impulse' ? 1 / mass : 1;
                        const velocity = Array.isArray(data.velocity) ? data.velocity : [0, 0, 0];
                        data.velocity = velocity.map((entry, index) => finite(entry) + amount[index] * timeFactor * massFactor);
                    } else {
                        data.velocity = action.op === 'addVelocity'
                            ? (Array.isArray(data.velocity) ? data.velocity : [0, 0, 0]).map((entry, index) => finite(entry) + amount[index])
                            : amount;
                    }
                } else if (action.op === 'setActive') {
                    setObjectActive(target, Boolean(evaluate(action.value, context)));
                } else if (action.op === 'toggleActive') {
                    setObjectActive(target, !objectActive(target));
                } else if (action.op === 'destroy') {
                    destroyObject(target);
                } else if (action.op === 'setText') {
                    const value = String(evaluate(action.value, context) ?? '');
                    for (const component of target.components || []) {
                        if (component.type === 'UIText' || component.type === 'UIInputField') componentData(component).text = value;
                    }
                } else {
                    throw new Error(`Unsupported action: ${action.op}`);
                }
            }
        }

        function invoke(instance, phase, actions, deltaTime, input, eventValue, budget = { remaining: maxOperations }) {
            if (!instance.program || !objectActive(instance.owner) || !componentEnabled(instance.component)) return;
            try {
                executeActions(actions, { instance, deltaTime, input: input || {}, eventValue }, budget);
            } catch (error) {
                report(instance, phase, error?.message || String(error));
            }
        }

        function ensureStarted(instance, input, budget = { remaining: maxOperations }) {
            if (instance.started || !instance.program || !objectActive(instance.owner) || !componentEnabled(instance.component)) return;
            instance.started = true;
            invoke(instance, 'start', instance.program.start, 0, input, null, budget);
        }

        return {
            start(input = {}) {
                for (const instance of instances) ensureStarted(instance, input);
            },
            update(deltaTime, input = {}) {
                for (const instance of instances) {
                    ensureStarted(instance, input);
                    invoke(instance, 'update', instance.program?.update, deltaTime, input, null);
                }
            },
            fixedUpdate(deltaTime, input = {}) {
                for (const instance of instances) {
                    ensureStarted(instance, input);
                    invoke(instance, 'fixedUpdate', instance.program?.fixedUpdate, deltaTime, input, null);
                }
            },
            event(name, value, input = {}) {
                for (const instance of instances) {
                    ensureStarted(instance, input);
                    invoke(instance, `event:${name}`, instance.program?.events?.[name], 0, input, value);
                }
            },
            eventForObject(objectId, name, value, input = {}) {
                for (const instance of instances) {
                    if (instance.owner?.id !== objectId) continue;
                    ensureStarted(instance, input);
                    invoke(instance, `event:${name}`, instance.program?.events?.[name], 0, input, value);
                }
            },
            diagnostics() { return diagnostics.map((entry) => ({ ...entry })); },
            get instanceCount() { return instances.filter((entry) => entry.program).length; }
        };
    }

    return { cloneRuntimePrefab, compileBehaviourProgram, createBehaviourRuntime };
});
