# 🎮 Minecraft Cross-Play Server Controller

Minecraft Java ve Bedrock (Mobil/Konsol) oyuncularını birleştiren sunucunuzu web üzerinden kolayca ve estetik bir arayüzle yönetmenizi sağlayan, sıfır bağımlılığa sahip (pure/vanilla) bir web kontrol panelidir.

---

## 🛠️ 1. Çalışma Mantığı ve Mimarisi

Sistem, güvenlik ve performans odaklı iki ana katmandan oluşur:

### Backend (Arka Plan - `server.js`)
* **Hafif ve Bağımsız:** Herhangi bir dış kütüphane veya npm paketi (`express`, `socket.io` vb.) kullanmaz. Sadece yerleşik Node.js modülleri (`http`, `fs`, `child_process`, `os`) ile çalışır.
* **Canlı Veri Akışı (SSE):** Sunucu loglarını ve performans verilerini tarayıcıya sıfır gecikmeyle aktarmak için **Server-Sent Events (SSE)** teknolojisini kullanır.
* **Güvenli Screen Entegrasyonu:** Minecraft sunucusu arka planda bağımsız bir `screen` tünelinde (`mcsunucu`) çalışır. Kontrol paneli bu tünele dışarıdan komut gönderir (`screen -X stuff`), böylece java çökse bile panel çalışmaya devam eder.
* **Akıllı IP Tespiti:** Sistemdeki Docker veya sanal makinelerin yarattığı sanal ağları es geçerek gerçek **Yerel Ağ IP**'sini ve aktifse **Tailscale VPN IP**'sini otomatik olarak bulur.
* **Simülatör Modu:** Eğer sunucuda Minecraft dosyaları henüz kurulu değilse, panel otomatik olarak bir simülasyon başlatır. Bu sayede tüm arayüzü, log ekranını ve oyuncu yönetimini kurmadan önce test edebilirsiniz.

### Frontend (Ön Yüz - Vanilla Stack)
* **Saf Web Teknolojileri:** Framework kullanılmadan sadece **HTML5**, **CSS3 (Modern Grid & Variables)** ve **Modern JavaScript** kullanılarak yazılmıştır.
* **Cyberpunk Teması:** Tamamen duyarlı (responsive), göz yormayan, karanlık mod odaklı, neon detaylara ve yumuşak animasyonlara sahip premium bir arayüz sunar.
* **Oyuncu Kafaları:** Oyundaki aktif oyuncuların 3D kafalarını Minotar API'si üzerinden dinamik olarak yükler.

---

## 🚀 2. Kurulum ve Çalıştırma

Kontrol panelinin dosyaları, sunucunuzdaki Minecraft klasörünün altında açılacak bağımsız bir `controller` klasöründe (`~/mc_server/controller/`) yer alır. Böylece sunucu dosyalarınız ile panel dosyaları birbirine karışmaz.

### Yöntem A: Otomatik Kurulum (Önerilen)
Sunucunuzda kontrol panelinin bulunduğu klasörde terminali açın ve şu tek satırlık komutu çalıştırın:
```bash
chmod +x install.sh && ./install.sh
```
*Bu betik; kullanıcı adınızı ve ev dizininizi otomatik tespit eder, dosyaları `~/mc_server/controller/` klasörüne kopyalar ve arka planda 7/24 çalışacak Systemd servisini kurup başlatır.*

### Yöntem B: Manuel Kurulum
1. `~/mc_server/` dizini altında `controller` adında bir klasör oluşturun ve tüm proje dosyalarını (`server.js`, `index.html`, `css/`, `js/`) bu klasörün içine kopyalayın.
2. Aşağıdaki komutla paneli doğrudan başlatabilirsiniz:
   ```bash
   cd ~/mc_server/controller
   node server.js
   ```
3. Tarayıcınızdan şu adrese girerek panele erişin:
   * **Yerel Ağ:** `http://<sunucu-yerel-ip>:8080`
   * **Tailscale:** `http://<sunucu-tailscale-ip>:8080`

---

## ⚙️ 3. Systemd Servis Entegrasyonu (7/24 Çalışma)

Kontrol panelinin sunucu her açıldığında arka planda otomatik olarak başlamasını istiyorsanız:

1. `mcs-controller.service` dosyasını sistem servis dizinine kopyalayın:
   ```bash
   sudo cp ~/mc_server/controller/mcs-controller.service /etc/systemd/system/mcs-controller.service
   ```
2. Servisleri güncelleyip aktifleştirin:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable mcs-controller.service
   sudo systemctl start mcs-controller.service
   ```
3. Servisin durumunu kontrol etmek için:
   ```bash
   sudo systemctl status mcs-controller.service
   ```

---

## 📝 4. Kullanılan Temel Sunucu Komutları

Panel arka planda Minecraft sunucusu ile etkileşime girerken aşağıdaki komutları kullanır:

* **Sunucuyu Başlatma:** Detached screen modunda PaperMC başlatılır.
  ```bash
  cd ~/mc_server && screen -dmS mcsunucu java -Xmx4G -Xms4G -jar server.jar nogui
  ```
* **Konsola Komut Gönderme:** Stuff özelliği ile tünel içerisine komut yazdırılır.
  ```bash
  screen -S mcsunucu -X stuff "stop\n"
  ```
* **Tailscale IP Alma:** IPv4 Tailscale adresi sorgulanır.
  ```bash
  tailscale ip -4
  ```
* **Zorla Kapatma (Force Kill):** Sunucu donarsa java işlemi sonlandırılır ve screen temizlenir.
  ```bash
  killall -9 java && screen -wipe
  ```
* **Harita Kilidi Çözme:** Sunucu ani kapandığında kilitlenen dünya kilidi kaldırılır.
  ```bash
  rm -f ~/mc_server/world/session.lock
  ```
