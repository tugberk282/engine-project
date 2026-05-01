export function serialize(target: any, propertyKey: string) {
    if (!target.constructor.hasOwnProperty('_serializableFields')) {
        // Clone parent fields if any, or start fresh
        target.constructor._serializableFields = [...(target.constructor._serializableFields || [])];
    }
    target.constructor._serializableFields.push(propertyKey);
}
