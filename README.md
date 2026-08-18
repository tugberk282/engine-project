# Engine Project

Engine Project is a full-scale game engine and runtime built as an Electron-based desktop application, designed to reproduce Unity's editor workflows and core engine capabilities with one-to-one behavioral parity. It is not a demo, prototype, or interface mockup; its goal is to become a complete, production-ready engine for creating, editing, running, and building real games.

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
npm run bootstrap
```

Bu kanonik temiz-kopya komutu once kilit dosyasiyla `npm ci` calistirir,
ardindan projede sabitlenmis Electron 43 paketinin resmi `install-electron`
istege bagli indirme komutunu kullanir. Yalniz Electron ikilisini yeniden
hazirlamak icin `npm run bootstrap:electron` kullanilabilir.

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

Ilk buildable vertical slice:

```bash
npm run verify:vertical-slice
```

Kanonik ornek proje, paketli smoke adimlari ve bilinen parity bosluklari
`docs/vertical-slice-build.md` dosyasinda belgelenmistir.

## Not

Bu repo desktop app odaklidir. Renderer tarafinda dogrudan Node/Electron bagimliligi acmak yerine `electron/preload.js`, `electron/main.js`, `src/platform/DesktopBridge.ts` ve `src/platform/DesktopFileSystem.ts` uzerinden ilerlenmelidir.

