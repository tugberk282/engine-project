// C# Component Base Class for TugberkEngine
// This is the base class for all C# game scripts

using System;

namespace TugberkEngine
{
    public abstract class Component
    {
        // Reference to the GameObject this component is attached to
        public GameObject gameObject;
        
        // Shortcut to transform
        public Transform transform => gameObject.transform;
        
        // Lifecycle methods (override these in your scripts)
        public virtual void Awake() { }
        public virtual void Start() { }
        public virtual void Update(float deltaTime) { }
        public virtual void OnEnable() { }
        public virtual void OnDisable() { }
        public virtual void OnDestroy() { }
        
        // Helper methods
        public T GetComponent<T>() where T : Component
        {
            return gameObject.GetComponent<T>();
        }
        
        public T AddComponent<T>() where T : Component
        {
            return gameObject.AddComponent<T>();
        }
    }
    
    // GameObject stub (will be mapped to JS GameObject)
    public class GameObject
    {
        public string name;
        public Transform transform;
        public bool activeSelf;
        
        public T GetComponent<T>() where T : Component
        {
            // Implemented in JS
            return default(T);
        }
        
        public T AddComponent<T>() where T : Component
        {
            // Implemented in JS
            return default(T);
        }
        
        public void SetActive(bool active)
        {
            // Implemented in JS
        }
    }
    
    // Transform stub
    public class Transform
    {
        public Vector3 position;
        public Vector3 rotation;
        public Vector3 scale;
        public Transform parent;
    }
    
    // Vector3 stub
    public struct Vector3
    {
        public float x, y, z;
        
        public Vector3(float x, float y, float z)
        {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        
        public static Vector3 operator +(Vector3 a, Vector3 b)
        {
            return new Vector3(a.x + b.x, a.y + b.y, a.z + b.z);
        }
        
        public static Vector3 operator *(Vector3 a, float d)
        {
            return new Vector3(a.x * d, a.y * d, a.z * d);
        }
    }
    
    // Input stub
    public static class Input
    {
        public static float GetAxis(string axisName)
        {
            // Implemented in JS
            return 0f;
        }
        
        public static bool GetKey(string key)
        {
            // Implemented in JS
            return false;
        }
        
        public static bool GetKeyDown(string key)
        {
            // Implemented in JS
            return false;
        }
        
        public static bool GetMouseButton(int button)
        {
            // Implemented in JS
            return false;
        }
    }
}
