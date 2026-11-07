# Engine Project

Engine Project is a full-scale game engine and runtime built as an Electron-based desktop application, designed to reproduce Unity's editor workflows and core engine capabilities with one-to-one behavioral parity. It is not a demo, prototype, or interface mockup; its goal is to become a complete, production-ready engine for creating, editing, running, and building real games.

## Durum

- Faz 9 aktif: Desktop App Productization
- Usable-core durumu: editor authoring, runtime gameplay, persistence ve Windows export cekirdegi testlerle dogrulaniyor
- `npm test`: 92/92 test basarili
- Paketli smoke: 43/43 kontrol basarili

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

Ana test suite:

```bash
npm test
```

Editor workflow ve Scene View:

```bash
npm run test:editor-workflow
npm run test:scene-view
npm run test:input-focus
```

Runtime ve guvenlik:

```bash
npm run test:runtime
npm run test:security
npm run test:diagnostics
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

Windows paket ve installer dogrulamasi:

```bash
npm run electron:build:dir
npm run test:packaged-smoke -- release/win-unpacked
npm run electron:build:installer
npm run test:installer -- release
```

Kanonik ornek proje, paketli smoke adimlari ve bilinen parity bosluklari
`docs/vertical-slice-build.md` dosyasinda belgelenmistir.

## Not

Bu repo desktop app odaklidir. Renderer tarafinda dogrudan Node/Electron bagimliligi acmak yerine `electron/preload.js`, `electron/main.js`, `src/platform/DesktopBridge.ts` ve `src/platform/DesktopFileSystem.ts` uzerinden ilerlenmelidir.

