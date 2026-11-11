'use strict';

(function exposeBehaviourScriptRuntime(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TugberkBehaviourScript = api;
})(typeof globalThis === 'object' ? globalThis : null, () => {
    const MAX_SOURCE_LENGTH = 64 * 1024;
    const MAX_ACTIONS_PER_EVENT = 256;
    const MAX_EXPRESSION_DEPTH = 16;

    function finite(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function componentData(component) {
        return component?.data && typeof component.data === 'object' ? component.data : component || {};
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
            if (!Array.isArray(actions)) return { ok: false, error: `${name} must be an action array.` };
            if (actions.length > MAX_ACTIONS_PER_EVENT) return { ok: false, error: `${name} exceeds ${MAX_ACTIONS_PER_EVENT} actions.` };
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
        const maxOperations = Math.max(16, Math.min(2048, Math.trunc(finite(options.maxOperations, 512))));

        const objectActive = (object) => object?.destroyed !== true
            && object?._runtimeDestroyed !== true
            && object?.active !== false
            && object?.enabled !== false;
        const componentEnabled = (component) => component?.enabled !== false && componentData(component).enabled !== false;
        const findObject = (owner, selector) => {
            if (!selector || selector === 'self') return objectActive(owner) ? owner : null;
            if (typeof selector !== 'string') return null;
            if (selector.startsWith('tag:')) return allObjects.find((entry) => objectActive(entry) && entry.tag === selector.slice(4)) || null;
            return allObjects.find((entry) => objectActive(entry) && (entry.id === selector || entry.name === selector)) || null;
        };
        const findComponent = (object, type) => (object?.components || []).find((entry) => entry?.type === type) || null;
        const report = (instance, phase, message) => {
            if (diagnostics.length >= 64) return;
            diagnostics.push({ objectId: String(instance.owner?.id || ''), phase, message: String(message).slice(0, 512) });
        };

        for (const owner of allObjects) {
            for (const component of owner?.components || []) {
                if (component?.type !== 'BehaviourScript') continue;
                const compiled = compileBehaviourProgram(componentData(component).program || '{}');
                const instance = { owner, component, program: compiled.program || null, variables: {}, started: false };
                if (compiled.ok) instance.variables = structuredClone(compiled.program.variables);
                else report(instance, 'compile', compiled.error);
                instances.push(instance);
            }
        }

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
            if (Array.isArray(expression.add)) return expression.add.reduce((sum, entry) => sum + finite(evaluate(entry, context, depth + 1)), 0);
            if (Array.isArray(expression.multiply)) return expression.multiply.reduce((product, entry) => product * finite(evaluate(entry, context, depth + 1), 1), 1);
            if ('negate' in expression) return -finite(evaluate(expression.negate, context, depth + 1));
            if (Array.isArray(expression.clamp) && expression.clamp.length === 3) {
                const value = finite(evaluate(expression.clamp[0], context, depth + 1));
                return Math.max(finite(evaluate(expression.clamp[1], context, depth + 1)), Math.min(finite(evaluate(expression.clamp[2], context, depth + 1)), value));
            }
            if (Array.isArray(expression.equals) && expression.equals.length === 2) return evaluate(expression.equals[0], context, depth + 1) === evaluate(expression.equals[1], context, depth + 1);
            if (Array.isArray(expression.greaterThan) && expression.greaterThan.length === 2) return finite(evaluate(expression.greaterThan[0], context, depth + 1)) > finite(evaluate(expression.greaterThan[1], context, depth + 1));
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
                const target = findObject(context.instance.owner, action.target);
                if (!target) throw new Error(`Target not found: ${String(action.target)}`);
                target.transform ||= { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
                if (action.op === 'translate') {
                    const amount = vector(action.value, context, [0, 0, 0]);
                    target.transform.position = target.transform.position.map((entry, index) => finite(entry) + amount[index]);
                } else if (action.op === 'setPosition') {
                    target.transform.position = vector(action.value, context, [0, 0, 0]);
                } else if (action.op === 'addRotation') {
                    const amount = vector(action.value, context, [0, 0, 0]);
                    target.transform.rotation = target.transform.rotation.map((entry, index) => finite(entry) + amount[index]);
                } else if (action.op === 'setRotation') {
                    target.transform.rotation = vector(action.value, context, [0, 0, 0]);
                } else if (action.op === 'setScale') {
                    target.transform.scale = vector(action.value, context, [1, 1, 1]);
                } else if (action.op === 'setVelocity' || action.op === 'addVelocity') {
                    const body = findComponent(target, 'RigidBody');
                    if (!body) throw new Error('Velocity action target requires RigidBody.');
                    const data = componentData(body);
                    const amount = vector(action.value, context, [0, 0, 0]);
                    data.velocity = action.op === 'addVelocity'
                        ? (Array.isArray(data.velocity) ? data.velocity : [0, 0, 0]).map((entry, index) => finite(entry) + amount[index])
                        : amount;
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

        function invoke(instance, phase, actions, deltaTime, input, eventValue) {
            if (!instance.program || !objectActive(instance.owner) || !componentEnabled(instance.component)) return;
            try {
                executeActions(actions, { instance, deltaTime, input: input || {}, eventValue }, { remaining: maxOperations });
            } catch (error) {
                report(instance, phase, error?.message || String(error));
            }
        }

        return {
            start(input = {}) {
                for (const instance of instances) {
                    if (instance.started) continue;
                    instance.started = true;
                    invoke(instance, 'start', instance.program?.start, 0, input, null);
                }
            },
            update(deltaTime, input = {}) {
                for (const instance of instances) invoke(instance, 'update', instance.program?.update, deltaTime, input, null);
            },
            fixedUpdate(deltaTime, input = {}) {
                for (const instance of instances) invoke(instance, 'fixedUpdate', instance.program?.fixedUpdate, deltaTime, input, null);
            },
            event(name, value, input = {}) {
                for (const instance of instances) invoke(instance, `event:${name}`, instance.program?.events?.[name], 0, input, value);
            },
            eventForObject(objectId, name, value, input = {}) {
                for (const instance of instances) {
                    if (instance.owner?.id === objectId) invoke(instance, `event:${name}`, instance.program?.events?.[name], 0, input, value);
                }
            },
            diagnostics() { return diagnostics.map((entry) => ({ ...entry })); },
            instanceCount: instances.filter((entry) => entry.program).length
        };
    }

    return { compileBehaviourProgram, createBehaviourRuntime };
});
