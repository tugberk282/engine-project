# TugberkEngine - C# Scripting Guide 🎮

## Kurulum

1. **Dependencies yükle:**
```bash
npm install
```

2. **C# Watcher'ı başlat:**
```bash
npm run watch:csharp
```

3. **Dev server'ı başlat (başka terminal):**
```bash
npm run dev
```

## C# Script Yazma

### 1. Yeni Script Oluştur
`src/scripts/CSharp/MyScript.cs`:

```csharp
using TugberkEngine;

public class MyScript : Component
{
    public float speed = 5.0f;
    
    public override void Update(float deltaTime)
    {
        // Your code here
    }
}
```

### 2. Kaydet (Ctrl+S)
- Otomatik compile olur
- Console'da göreceksiniz: `✅ Compiled successfully`
- Hot reload ile oyun güncellenir

### 3. Unity API

```csharp
// Transform
transform.position.x += 1.0f;
transform.rotation.y = 45.0f;

// Input
float h = Input.GetAxis("Horizontal");
bool jump = Input.GetKeyDown("Space");

// GameObject
GameObject player = GameObject.Find("Player");
player.SetActive(false);

// Components
Rigidbody rb = GetComponent<Rigidbody>();
AudioSource audio = AddComponent<AudioSource>();
```

## VS Code Entegrasyonu

### Otomatik Başlatma
`Terminal > Run Task > Start Dev Server + C# Watcher`

### IntelliSense
- OmniSharp otomatik yüklenir
- C# autocomplete çalışır
- Syntax highlighting aktif

## Örnek: PlayerController.cs

```csharp
public class PlayerController : Component
{
    public float speed = 5.0f;
    
    public override void Update(float deltaTime)
    {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");
        
        transform.position.x += h * speed * deltaTime;
        transform.position.z += v * speed * deltaTime;
    }
}
```

**Kaydet → Otomatik compile → Oyunda çalışır!** 🚀

## Not
İleride bu standalone application'a dönüştürülecek.
