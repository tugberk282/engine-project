# Engine Project

Engine Project, Unity benzeri editor deneyimini Electron tabanli bir desktop uygulama olarak kurmayi hedefleyen bir oyun editoru ve runtime projesidir.

## Durum

- Faz 1-8 tamamlandi
- Faz 9 aktif: Desktop App Productization
- Guncel parity durumu: `593/593`

## Teknoloji

- TypeScript
- Electron
- Vite
- Three.js
- cannon-es

## Gelistirme

Kurulum:

```bash
npm install
```

Canli gelistirme:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Parity testleri:

```bash
npm run test:parity
```

Faz 8 testleri:

```bash
npm run test:phase8
```

Faz 9 testleri:

```bash
npm run test:phase9
```

## Mimari ve Handoff

Projeyi devralacak kisi icin ana dokuman:

- `UNITY_PARITY_ROADMAP.md`

Bu dosya:

- aktif fazi
- mimari katmanlari
- klasor haritasini
- editor/engine veri akislarini
- teknik borclari
- bir sonraki gelistirici icin ilerleme sirasini

tek yerde toplar.

## Paketleme

Electron build:

```bash
npm run electron:build
```

## Not

Bu repo desktop app odaklidir. Renderer tarafinda dogrudan Node/Electron bagimliligi acmak yerine `electron/preload.js`, `electron/main.js`, `src/platform/DesktopBridge.ts` ve `src/platform/DesktopFileSystem.ts` uzerinden ilerlenmelidir.

