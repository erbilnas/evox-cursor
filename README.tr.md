# evoX için Cursor

[English](README.md) · [Türkçe](README.tr.md)

[evoX](https://evoxapp.com) deck üzerinde agent durumu, onay/red, izole profiller ve kalan kullanım kotası.

Bu bir **trusted-node** eklentisidir: kendi Node sürecinde çalışır ve makineye tam erişimi vardır. Yalnızca güvendiğiniz kaynağı yükleyin.

LCD hücreleri keypad tuşlarıdır. Her biri kısa bir etiket gösterir: `Idle`, `Working`, bir komut, profil adı veya kalan kullanım yüzdesi.

## Gereksinimler

- [evoX](https://evoxapp.com) **0.2.0** veya üzeri
- [Node.js](https://nodejs.org/) 18+ (`npm install` / `npm run check` için)
- Hook’ları açık [Cursor](https://cursor.com)
- `PATH` üzerinde `sqlite3` CLI (yalnızca kullanım kotası için yerel Cursor state okunur)
- Stop / New chat odaklama için macOS Accessibility (evoX’un hotkey izniyle aynı)

## Kurulum

```bash
git clone https://github.com/<you>/evox-cursor.git
cd evox-cursor
npm install
npm run check
```

### 1. evoX Developer ile eklentiyi yükleyin

1. **evoX** uygulamasını açın.
2. **Plugins → Developer** bölümüne gidin.
3. Bu proje klasörünü seçin / ekleyin (`manifest.json` içeren klasör).
4. Güven uyarısını okuyun ve eklentiyi **başlatın**.
5. Kod değişince Developer penceresinden **Reload** yapın.

### 2. Cursor hook’larını bağlayın

Cursor’ın bu klasördeki `cursor-hook.mjs` dosyasını çalıştırması gerekir. [`hooks.example.json`](hooks.example.json) dosyasını `~/.cursor/hooks.json` konumuna kopyalayın (veya mevcut dosyaya birleştirin). Her `/ABSOLUTE/PATH/TO/evox-cursor` ifadesini klonladığınız klasörün gerçek mutlak yoluyla değiştirin.

Örnek komut:

```text
node "/Users/you/code/evox-cursor/cursor-hook.mjs"
```

`hooks.json` değiştikten sonra Cursor’ı yeniden başlatın (veya hook’ları yenileyin).

evoX eklentiyi açık tuttuğunda shell, MCP ve diğer araç çağrıları deck’te yaklaşık **20 saniye** bekler. Allow tuşu **Run**, **Approve** veya **Allow** olarak değişir. Deny engeller. Basılmazsa veya evoX çalışmıyorsa `ask` döner; Cursor’ın kendi onay kartı görünür. Dosya okuma ve arama beklemez. Aynı anda bir istem: ikincisi tuş etiketini değiştirir.

### 3. Deck tuşlarını atayın

1. evoX’ta **Keys** ekranını açın.
2. **Status**, **Allow**, **Deny**, **Stop**, **Usage**, **Project**, **Model**, **Last file**, **New chat** ve **Profile** eylemlerini keypad tuşlarına sürükleyin.
3. **Profiles** eylemini bir knob / dial üzerine koyun.
4. Her **Profile** tuşunda:
   - **User data directory** — Cursor’ın `--user-data-dir` olarak kullanacağı mutlak klasör (ayrı hesap)
   - **Name** — isteğe bağlı etiket (boşsa klasör adı)
   - **Workspace** — isteğe bağlı proje klasörü
5. Status, Allow, Deny, Stop, Usage, Project, Model, Last file ve New chat’te yolu boş bırakırsanız bu makinenin varsayılan Cursor hesabı kullanılır; başka bir user-data dizini de verebilirsiniz.

İsteğe bağlı: `cursor` CLI `PATH`’te değilse `CURSOR_BIN` ortam değişkenini ayarlayın (macOS yedek yolu: `/usr/local/bin/cursor`).

## Tuşlar ne yapar?

| Eylem | Kontrol | Sonuç |
| --- | --- | --- |
| Status | LCD tuş | `Idle`, `Thinking`, `Reading`, `Editing`, `Running`, `Answer` veya bekleyen komut. Basınca ilgili Cursor penceresi öne gelir. |
| Allow / Deny | LCD tuş | Allow bekleyen istem için Run / Allow / Approve gösterir. Deny engeller. |
| Profile | LCD tuş | `cursor --new-window --user-data-dir "<path>"` açar (+ workspace varsa). |
| Usage | LCD tuş | O hesap için kalan plan yüzdesi. Giriş yoksa `Sign in`. Basınca yeniler. |
| Stop | LCD tuş | Pencereyi öne alır ve Escape gönderir (macOS + Accessibility). |
| Project | LCD tuş | Son hook’taki klasör. Basınca pencereyi öne alır. |
| Model | LCD tuş | Son hook’taki model. Basınca listedeki sıradaki modele geçer ve `cursor/lastSingleModelPreference` yazar. |
| Last file | LCD tuş | Agent’ın son düzenlediği dosya. Basınca `cursor --reuse-window` ile açar. |
| New chat | LCD tuş | Pencereyi odaklar, sonra kısayolu gönderir (boşsa `cmd+n`). |
| Profiles | Knob | Deck’teki Profile tuşları arasında döner. Basınca seçileni açar. |

Bekleyen istem ses çalabilir. Status tuşunda **Waiting sound**: Off, Once veya Ring. Ring, yanıt veya zaman aşımına kadar tekrarlar. Eklenti heartbeat vermiyorsa veya ~20 saniye dolunca onay yine Cursor’ın kendi kartına düşer.

## Kullanım kotası

Usage, ilgili profilin yerel `state.vscdb` dosyasından `cursorAuth/accessToken` okur ve Cursor kullanım uçlarına istek atar. Token bu makinede kalır: repoya, deck ayarlarına, loglara veya profil altındaki `evox-deck` JSON dosyalarına **yazılmaz**. Bu uçlar herkese açık API değildir; değişirse tuş `Usage ?` gösterir.

`npm run check` yüzde hesabı, başlık kısaltma, bayat heartbeat ve karar eşleşmesini doğrular.

## Güvenlik notları (GitHub’a koymadan önce)

- **Trusted-node**: bu klasörü düzenleyebilen herkes eklenti başlayınca istediği Node kodunu yürütebilir. Yalnızca güvendiğiniz repodan kurun; Reload öncesi farkları okuyun.
- **Git’te sır olmasın**: Cursor oturum token’ı, profil export’u veya kimlik bilgisi içeren yollar asla commit edilmemeli.
- **Yerel köprü dosyaları** `{userDataDir}/evox-deck/` altında `0600` ile yazılır. Bunları commit etmeyin.
- **Hook’lar**: `~/.cursor/hooks.json` yerel komut çalıştırır. Yol herkese yazılabilir bir klasöre değil, *sizin* klonunuza işaret etmeli.
- `.env`, evoX ayar export’ları ve `.cursor/` IDE durumunu commit etmeyin.

## Market / paketleme

`evox-plugin validate`, `build` ve `pack` sandbox eklentileri içindir; bu trusted-node proje için değil. Genel yükleme açılana kadar **Plugins → Developer** ile kurun.
