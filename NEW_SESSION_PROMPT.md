# New Codex Session Prompt

Start a new Codex conversation with the repository folder open, then send this prompt:

```text
C:\Users\tugbe\OneDrive\Desktop\Tugberk Engine klasorundeki Tugberk Engine projesinde calis.

Once yalnizca AGENT_HANDOFF.md, AGENTS.md ve git status ciktisini oku. UNITY_PARITY_ROADMAP.md dosyasini bastan sona okuma; yalnizca aktif gorev icin gerekli belirli bolumu ac. Mevcut dirty degisiklikleri koru ve bana ait degisiklikleri geri alma.

AGENT_HANDOFF.md icindeki Unverified Work In Progress bolumunden devam et. Ilk olarak yarim kalan runtime-prefab kamera/render-pass degisikligini odak test ve TypeScript ile dogrula, sorun varsa duzelt. Sonra Highest-Value Remaining Work listesini sirayla gelistir.

Token tasarrufu uygula: Graphify mevcutsa genis dosya taramasi oncesi scoped query kullan, sadece ilgili satirlari oku, gelistirme sirasinda test:fast calistir, tam test/build/smoke islemlerini tamamlanmis ozellik dilimlerinde toplu calistir ve basarili komutlarin uzun ciktilarini sohbete tasima. Coklu ajan kullanma. Ben istemedikce commit/push yapma.

Hedef: kucuk 3D oyunlarin editorde hazirlanabildigi, Play Mode'da calistigi ve Windows player olarak export edilebildigi guvenilir bir masaustu oyun motoru. Bir plan anlatip durma; incele, uygula ve test ederek ilerle.
```

When a session becomes large again, update `AGENT_HANDOFF.md`, end it, and start another session with the same prompt.
