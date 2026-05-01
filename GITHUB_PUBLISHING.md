# GitHub Publishing Rehberi

Bu dosya, Engine Project reposunu ilk kez GitHub'a yuklemek icin kisa ama net bir rehberdir.

## Repo Hazirlik Durumu

Bu projede su hazirliklar yapildi:

- `.gitignore` eklendi
- `.gitattributes` eklendi
- `README.md` eklendi
- `UNITY_PARITY_ROADMAP.md` icindeki yerel makine path'leri relative/path-friendly hale getirildi
- git repo `main` branch ile baslatildi

## Push Oncesi Kontrol

Asagidaki komutlari proje klasorunde calistir:

```bash
git status
npm run test:parity
npm run build
```

Beklenen durum:

- `git status` sadece bilincli olarak eklemek istedigin dosyalari gostermeli
- parity testleri gecmeli
- build basarili olmali

## Ilk Commit

Tum dosyalari ekle:

```bash
git add .
```

Ilk commit'i at:

```bash
git commit -m "Initial commit: Engine Project parity and desktop app foundation"
```

## GitHub'da Repo Acma

GitHub uzerinde yeni bir bos repo olustur.

Onerilen repo adi:

```text
engine-project
```

Repo olustururken:

- `README` otomatik olusturma kapali olabilir
- `.gitignore` secme, cunku repo icinde zaten var
- `license` istersen sonra eklenebilir

## Remote Baglama

Kendi GitHub kullanici adinla su komutu uyarlayip calistir:

```bash
git remote add origin https://github.com/tugberk282/engine-project.git
```

Remote'u kontrol et:

```bash
git remote -v
```

## Ilk Push

```bash
git push -u origin main
```

Bu komut:

- lokal `main` branch'ini GitHub'a yollar
- sonraki push/pull komutlari icin upstream bagini kurar

## Sonraki Guncellemeler

Degisikliklerden sonra standart akis:

```bash
git status
git add .
git commit -m "Kisa ve anlamli commit mesaji"
git push
```

## Onerilen Commit Tarzi

Kisa, eylem odakli commit mesajlari kullan:

- `Add desktop bridge filesystem IPC`
- `Refine phase 9 roadmap handoff documentation`
- `Stabilize prefab persistence flow`
- `Tighten Electron preload migration`

## GitHub Aciklama Onerisi

Repo description icin onerilen metin:

```text
Unity-like editor and runtime built with TypeScript, Three.js and Electron, focused on desktop app parity and productization.
```

## README Icinde Vurgulanacaklar

GitHub ana sayfasinda en faydali gorunen basliklar:

- projenin ne oldugu
- aktif faz
- teknoloji yiginÄ±
- nasil calistirilacagi
- parity testleri
- handoff/mimari dokumani linki

Bu alanlar `README.md` icinde zaten eklendi.

## Dikkat Edilecekler

- `node_modules/` pushlama
- `dist/` pushlama
- `desktop.ini` pushlama
- editor icinden dogrudan Electron/Node bagimliligi acma

## Faz 9 Ozel Not

GitHub'a cikarken proje teknik olarak calisabilir durumda, ama Electron shell hardening tamamlanmis degil. Bu nedenle README ve roadmap'te aktif faz olarak Faz 9'un acikca belirtilmesi dogrudur.


