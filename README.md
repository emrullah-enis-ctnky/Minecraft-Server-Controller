# 🎮 Minecraft Cross-Play Server Controller (Teknik Mimarisi ve Kullanım Rehberi)

Minecraft Java ve Bedrock (Mobil, Konsol, PC) oyuncularını tek bir sunucuda buluşturan altyapınız için geliştirilmiş; **sıfır bağımlılığa sahip (pure/vanilla JS)**, hafif, performans odaklı ve yüksek güvenlikli web kontrol paneli ve yönetim sistemidir.

---

## 📐 1. Sistem Mimarisi ve Çalışma Prensibi

Sistem, işletim sistemi ile Minecraft sunucu süreçleri arasında köprü görevi gören iki temel katmandan oluşmaktadır:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           İSTEMCİ TARAYICISI                              │
│         (HTML5 / CSS3 Cyberpunk Dark UI / EventSource SSE Client)         │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ HTTP / SSE (Port 8080)
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       BACKEND (Node.js - server.js)                       │
│    ┌──────────────────┬───────────────────┬──────────────────────────┐    │
│    │ SSE Broadcaster  │ Stat Poller (RAM) │ Live Log Stream (Poller) │    │
│    └──────────────────┴───────────────────┴──────────────────────────┘    │
└───────────────┬─────────────────────┬──────────────────────┬──────────────┘
                │                     │                      │
                ▼                     ▼                      ▼
┌───────────────────────────┐ ┌───────────────┐ ┌──────────────────────────┐
│  GNU Screen Session       │ │ Memory (OS)   │ │ Logs File                │
│  (mcsunucu Tunnel)        │ │ /proc/meminfo │ │ ~/mc_server/logs/latest  │
│  └─► Java PaperMC Server  │ └───────────────┘ └──────────────────────────┘
└───────────────────────────┘
```

### 🔹 Arka Plan (Backend - `server.js`)
* **Sıfır Dış Bağımlılık (Zero Dependencies):** `express`, `socket.io` gibi herhangi bir `npm` paketi barındırmaz. Sadece yerleşik Node.js modüllerinden (`http`, `fs`, `path`, `child_process`, `os`, `events`) faydalanır.
* **Canlı Veri Akışı (Server-Sent Events - SSE):** Gerçek zamanlı sunucu durumunu, RAM kullanımını ve konsol loglarını istemciye iletmek için düşük overhead'e sahip `EventSource` (SSE) mimarisini kullanır.
* **İzole Tünel Yönetimi (GNU Screen):** Minecraft sunucu süreci bağımsız bir `screen` tünelinde (`mcsunucu`) çalıştırılır. Bu sayede Java süreci çökse dahi web kontrol servisi ayakta kalır ve müdahale imkanı sunar.
* **Tüm Ağ Arayüzlerini Dinleme (`0.0.0.0`):** Sunucu `0.0.0.0:8080` soketi üzerinden dinleme yapar. Yerel ağ (LAN) veya VPN (Tailscale) üzerinden gelen tüm paketleri kabul eder.
* **Dinamik Ağ IP Tespiti:** Sistemdeki sanal arayüzleri (`docker0`, `vboxnet`, `veth`, `br-*`, `lo`) filtreleyerek gerçek Yerel Ağ IP'sini (`192.168.x.x` / `10.x.x.x`) ve aktifse Tailscale IP'sini (`100.x.x.x`) anlık olarak bulur.
* **Çökme Koruması (Global Crash Safety):** `process.on('uncaughtException')` ve `process.on('unhandledRejection')` yakalayıcıları sayesinde beklenmedik hatalarda servis kesintiye uğramaz.

### 🔹 Ön Yüz (Frontend - Vanilla Stack)
* **Saf Web Teknolojileri:** Framework yükü olmadan `HTML5`, `CSS3 (Flexbox & CSS Variables)` ve `Vanilla ES6+ JS` ile yazılmıştır.
* **Modern Cyberpunk Teması:** Karanlık mod (Dark Mode) odaklı, canlı durum rozetleri (Status Badges), glowing yeşil renk vurguları ve duyarlı (responsive) grid yapısına sahiptir.
* **Dinamik Oyuncu Avatarları:** Oyuna katılan aktif oyuncuların 3D kafa kaplamalarını Minotar API sistemi üzerinden anlık çeker.

---

## 📊 2. RAM ve Sistem Kaynak Optimizasyonu

Sunucunuzun belleğinin aşırı dolup işletim sisteminin kilitlenmesini önlemek amacıyla `server.js`, sistemdeki toplam RAM miktarını dinamik olarak analiz eder ve Java sanal makinesine (JVM) uygun bellek bayraklarını otomatik enjekte eder:

| Toplam Sistem RAM | Başlangıç RAM (`-Xms`) | Maksimum RAM (`-Xmx`) | Kullanılan Garbage Collector / Parametreler |
| :--- | :--- | :--- | :--- |
| **<= 4.5 GB** | `1 GB` | `2 GB` | G1GC + Experimental Options (`G1NewSizePercent=20`, `G1ReservePercent=20`, `MaxGCPauseMillis=50`) |
| **4.5 GB - 8.5 GB** | `2 GB` | `3 GB` | Standard G1GC (`-XX:+UseG1GC`) |
| **> 8.5 GB** | `2 GB` | `4 GB` | Standard G1GC (`-XX:+UseG1GC`) |

> 💡 **Bellek Koruması:** 3.6 GB RAM'e sahip bir sistemde Java'ya maksimum `2 GB` verilerek kalan `1.6 GB` RAM işletim sistemi (CachyOS/Linux), Tailscale ve Web Kontrolcüsü için boşta bırakılır.

---

## 🔒 3. Güvenlik Duvarı (Firewall / UFW) Yapılandırması

Diğer cihazlardan web paneline ve Minecraft sunucusuna erişebilmek için ağ portlarının açılması gerekmektedir:

### Port Listesi
* `8080/tcp` ➔ Web Kontrol Paneli
* `25565/tcp` ➔ Minecraft Java Edition Bağlantı Portu
* `19132/udp` & `19132/tcp` ➔ Minecraft Bedrock (GeyserMC) Bağlantı Portu

### UFW Güvenlik Duvarı (Arch Linux / CachyOS / Ubuntu / Debian)
```bash
# Web Paneli İzni
sudo ufw allow 8080/tcp

# Minecraft Java Portu
sudo ufw allow 25565/tcp

# Minecraft Bedrock / Geyser Portları
sudo ufw allow 19132/udp
sudo ufw allow 19132/tcp

# Güvenlik Duvarını Yenile
sudo ufw reload
```

### Firewalld Kullanıyorsanız (Fedora / RHEL / AlmaLinux)
```bash
sudo firewall-cmd --add-port=8080/tcp --permanent
sudo firewall-cmd --add-port=25565/tcp --permanent
sudo firewall-cmd --add-port=19132/udp --permanent
sudo firewall-cmd --add-port=19132/tcp --permanent
sudo firewall-cmd --reload
```

---

## 🚀 4. Kurulum ve Çalıştırma

Kontrol paneli, sunucunuzdaki Minecraft dizininin altındaki `controller` klasöründe (`~/mc_server/controller/`) konumlanır.

### ⚡ Otomatik Kurulum (Önerilen)
Proje kök dizininde bulunan kurulum betiğini çalıştırın:
```bash
cd ~/Minecraft-Server-Controller
chmod +x install.sh
./install.sh
```

**Betiğin Gerçekleştirdiği Otomasyon:**
1. Aktif kullanıcıyı (`$USER`) ve ev dizinini (`$HOME`) tespit eder.
2. Dosyaları `~/mc_server/controller/` klasörüne kopyalar.
3. Kaçak veya yetim kalmış eski servis süreçlerini temizler.
4. `/etc/systemd/system/mcs-controller.service` dosyasını oluşturur.
5. Systemd daemon'unu yenileyip servisi 7/24 çalışacak şekilde aktifleştirir.

---

## 🌐 5. Kontrol Paneline Erişim

Kurulum tamamlandıktan sonra ağınızdaki herhangi bir cihazın tarayıcısından bağlanabilirsiniz:

* **Yerel Ağ (LAN) Erişimi:** `http://192.168.x.x:8080`
* **Tailscale VPN Erişimi:** `http://100.x.x.x:8080`
* **Sunucu İçi (Localhost):** `http://localhost:8080`

---

## 🖥️ 6. Oturum ve Tünel Yönetimi (Screen & Kill Protocols)

Sunucu `screen -dmS mcsunucu` tünelinde çalışmaktadır. Web kontrol paneli üzerinden veya terminalden şu işlemler gerçekleştirilebilir:

### 🎮 Terminal Üzerinden Canlı Konsola Bağlanma
Sunucu konsoluna doğrudan girmek için:
```bash
screen -r mcsunucu
```
*Konsoldan ayrılmak için (Sunucuyu kapatmadan çıkış):* `Ctrl + A` ardından `D` tuşlarına basın.

### ⛔ Zorla Kapatma (Force Kill Protocol)
Eğer sunucu kilitlenirse web panelindeki **Force Kill** butonu şu sırayı izler:
1. `screen -X -S mcsunucu quit` ➔ Screen tüneline çıkış sinyali gönderir.
2. `pkill -9 -f java` ➔ Java sürecini sonlandırır.
3. `pkill -9 -f "mcsunucu"` ➔ Tünel sürecini öldürür.
4. `find ~/.screen /tmp /run/screen -name "*mcsunucu*" -exec rm -rf {} +` ➔ Disk üzerindeki ölü soket dosyalarını temizler.
5. `screen -wipe` ➔ Kalan ölü kayıtları siler.

---

## ⚙️ 7. Systemd Servis Yönetimi

Kontrol paneli servisini yönetmek için aşağıdaki komutları kullanabilirsiniz:

```bash
# Servis Durumunu Kontrol Etme
sudo systemctl status mcs-controller.service

# Servisi Yeniden Başlatma
sudo systemctl restart mcs-controller.service

# Servisi Durdurma
sudo systemctl stop mcs-controller.service

# Canlı Servis Loglarını İzleme
sudo journalctl -u mcs-controller.service -f --no-pager
```

---

## 📡 8. RESTful API ve SSE Dokümantasyonu

Backend servisi tarafından sağlanan uç noktalar (Endpoints):

### 🔹 `GET /api/server/status`
Sunucunun güncel durumunu, RAM kullanımını, IP adreslerini ve aktif oyuncuları döndürür.
* **Yanıt Formatı:**
  ```json
  {
    "status": "running",
    "simulatorMode": false,
    "localIp": "192.168.1.110",
    "tailscaleIp": "100.82.140.45",
    "port": 19132,
    "ram": 1.41,
    "totalRam": 3.6,
    "activePlayers": ["Steve", "Alex"]
  }
  ```

### 🔹 `POST /api/server/start`
Minecraft sunucusunu başlatır (`screen -dmS mcsunucu java ...`).

### 🔹 `POST /api/server/stop`
Minecraft sunucusuna güvenli durdurma komutu yollar (`screen -X stuff "stop\n"`).

### 🔹 `POST /api/server/kill`
Sunucu ve tünel süreçlerini zorla sonlandırır, soketleri temizler.

### 🔹 `POST /api/server/clearlock`
Haritadaki `world/session.lock` kilit dosyasını siler.

### 🔹 `POST /api/server/command`
Sunucu konsoluna özel Minecraft komutu gönderir.
* **İstek Gövdesi:** `{"command": "op Username"}`

### 🔹 `GET /api/logs/history`
Son 80 log satırını JSON formatında getirir.

### 🔹 `GET /api/stream`
Canlı SSE (Server-Sent Events) veri akışı kanalıdır. `stats`, `log` ve `status_change` olaylarını yayınlar.

---

## 🔍 9. Sorun Giderme (Troubleshooting)

### ❓ 1. Web Paneline Bağlanılamıyor (`EADDRINUSE` veya Bağlantı Reddedildi)
* **Sebep:** Port 8080 başka bir süreç tarafından kullanılıyor olabilir veya servis çökmüştür.
* **Çözüm:**
  ```bash
  sudo systemctl restart mcs-controller.service
  sudo journalctl -u mcs-controller.service -n 30 --no-pager
  ```

### ❓ 2. Sunucu Başlatıldı Diyor Ama Açılmıyor
* **Sebep:** `world/session.lock` dosyası kalmış olabilir veya Java sürümü uyuşmuyordur.
* **Çözüm:** Web panelinden **Clear Lock** butonuna basın veya terminalden silin:
  ```bash
  rm -f ~/mc_server/world/session.lock
  ```

### ❓ 3. Terminalde `(Remote or dead)` Ekran Oturumu Kalması
* **Çözüm:** Soket dosyasını doğrudan silin:
  ```bash
  rm -rf ~/.screen/*mcsunucu*
  screen -wipe
  ```

---

## 📜 Lisans ve Katkı
Bu proje açık kaynaklıdır. Geliştirmeler ve hata bildirimleri için Pull Request açabilirsiniz.
