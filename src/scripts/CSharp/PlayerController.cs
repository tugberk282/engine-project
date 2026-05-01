// Example C# Player Controller for TugberkEngine
// Save this file and it will auto-compile!

using System;
using TugberkEngine;

public class PlayerController : Component
{
    // Public fields (editable in Inspector)
    public float speed = 5.0f;
    public float jumpForce = 10.0f;
    
    // Private fields
    private float verticalVelocity = 0f;
    
    public override void Start()
    {
        Console.WriteLine("PlayerController started!");
    }
    
    public override void Update(float deltaTime)
    {
        // Get input
        float horizontal = Input.GetAxis("Horizontal");
        float vertical = Input.GetAxis("Vertical");
        
        // Move player
        transform.position.x += horizontal * speed * deltaTime;
        transform.position.z += vertical * speed * deltaTime;
        
        // Jump
        if (Input.GetKeyDown("Space"))
        {
            verticalVelocity = jumpForce;
        }
        
        // Apply gravity
        verticalVelocity -= 9.81f * deltaTime;
        transform.position.y += verticalVelocity * deltaTime;
        
        // Ground check
        if (transform.position.y < 0f)
        {
            transform.position.y = 0f;
            verticalVelocity = 0f;
        }
    }
}
