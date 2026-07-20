# 🎮 Minecraft Cross-Play Server Controller

Minecraft Java ve Bedrock (Mobil/Konsol) oyuncularını birleştiren sunucunuzu web üzerinden kolayca ve estetik bir arayüzle yönetmenizi sağlayan, sıfır bağımlılığa sahip (pure/vanilla) bir web kontrol panelidir.

---

## 🛠️ 1. Çalışma Mantığı ve Mimarisi

Sistem, güvenlik ve performans odaklı iki ana katmandan oluşur:

### Backend (Arka Plan - `server.js`)
* **Hafif ve Bağımsız:** Herhangi bir dış kütüphane veya npm paketi (`express`, `socket.io` vb.) kullanmaz. Sadece yerleşik Node.js modülleri (`http`, `fs`, `child_process`, `os`) ile çalışır.
* **Canlı Veri Akışı (SSE):** Sunucu loglarını ve performans verilerini tarayıcıya sıfır gecikmeyle aktarmak için **Server-Sent Events (SSE)** teknolojisini kullanır.
* **Güvenli Screen Entegrasyonu:** Minecraft sunucusu arka planda bağımsız bir `screen` tünelinde (`mcsunucu`) çalışır. Kontrol paneli bu tünele dışarıdan komut gönderir (`screen -X stuff`), böylece java çökse bile panel çalışmaya devam eder.
* **Tüm Ağ Arayüzlerini Dinleme (`0.0.0.0`):** Web sunucusu `0.0.0.0:8080` portundan yayın yapar. Bu sayede hem yerel ağ (LAN) hem de Tailscale VPN IP'leri üzerinden gelen bağlantıları kabul eder.
* **Akıllı IP Tespiti:** Sistemdeki Docker veya sanal makinelerin yarattığı sanal ağları es geçerek gerçek **Yerel Ağ IP**'sini (`192.168.x.x`) ve aktifse **Tailscale VPN IP**'sini (`100.x.x.x`) otomatik olarak bulur.
* **Simülatör Modu:** Eğer sunucuda Minecraft dosyaları henüz kurulu değilse, panel otomatik olarak bir simülasyon başlatır. Bu sayede tüm arayüzü, log ekranını ve oyuncu yönetimini kurmadan önce test edebilirsiniz.

### Frontend (Ön Yüz - Vanilla Stack)
* **Saf Web Teknolojileri:** Framework kullanılmadan sadece **HTML5**, **CSS3 (Modern Grid & Variables)** ve **Modern JavaScript** kullanılarak yazılmıştır.
* **Cyberpunk Teması:** Tamamen duyarlı (responsive), göz yormayan, karanlık mod odaklı, neon detaylara ve yumuşak animasyonlara sahip premium bir arayüz sunar.
* **Oyuncu Kafaları:** Oyundaki aktif oyuncuların 3D kafalarını Minotar API'si üzerinden dinamik olarak yükler.

---

## 🔒 2. ÖNEMLİ: Güvenlik Duvarı (Firewall / UFW) İzinleri

CachyOS / Arch Linux veya Ubuntu gibi sistemlerde güvenlik duvarı dışarıdan gelen bağlantıları engeller. Kontrol paneline diğer cihazlarınızdan erişebilmek için gerekli portlara izin vermeniz gerekir.

### **UFW Kullanıyorsanız (Önerilen):**
Sunucunuzda terminali açıp şu komutları sırasıyla çalıştırın:
```bash
# Web Kontrol Paneli Portu (TCP)
sudo ufw allow 8080/tcp

# Bedrock / Geyser Minecraft Portları (UDP ve TCP)
sudo ufw allow 19132/udp
sudo ufw allow 19132/tcp

# Güvenlik duvarını yenileyin
sudo ufw reload
```

### **Firewalld Kullanıyorsanız:**
```bash
sudo firewall-cmd --add-port=8080/tcp --permanent
sudo firewall-cmd --add-port=19132/udp --permanent
sudo firewall-cmd --add-port=19132/tcp --permanent
sudo firewall-cmd --reload
```

---

## 🚀 3. Kurulum ve Çalıştırma

Kontrol panelinin dosyaları, sunucunuzdaki Minecraft klasörünün altında açılacak bağımsız bir `controller` klasöründe (`~/mc_server/controller/`) yer alır. Böylece sunucu dosyalarınız ile panel dosyaları birbirine karışmaz.

### Yöntem A: Otomatik Kurulum (Önerilen)
Sunucunuzda kontrol panelinin bulunduğu klasörde terminali açın ve şu tek satırlık komutu çalıştırın:
```bash
chmod +x install.sh && ./install.sh
```
*Bu betik; kullanıcı adınızı ve ev dizininizi otomatik tespit eder, dosyaları `~/mc_server/controller/` klasörüne kopyalar ve arka planda 7/24 çalışacak Systemd servisini kurup başlatır.*

### Yöntem B: Manuel Kurulum
1. `~/mc_server/` dizini altında `controller` adında bir klasör oluşturun ve tüm proje dosyalarını (`server.js`, `index.html`, `css/`, `js/`) bu klasörün içine kopyalayın.
2. Paneli doğrudan çalıştırmak için:
   ```bash
   cd ~/mc_server/controller
   node server.js
   ```

---

## 🌐 4. Kontrol Paneline Erişim

Kurulum tamamlandıktan ve güvenlik duvarı izni verildikten sonra diğer cihazlarınızın (telefon, bilgisayar, tablet) tarayıcısından panele girebilirsiniz:

* **Yerel Ağ (LAN) Üzerinden:** `http://<SUNUCU_YEREL_IP>:8080` (Örn: `http://192.168.1.50:8080`)
* **Tailscale VPN Üzerinden:** `http://<TAILSCALE_IP>:8080` (Örn: `http://100.82.140.45:8080`)

> Sunucunuzun IP adreslerini öğrenmek için terminalde `hostname -I` (Yerel IP) veya `tailscale ip -4` (VPN IP) komutlarını kullanabilirsiniz.

---

## ⚙️ 5. Systemd Servis Yönetimi (7/24 Çalışma)

Kontrol paneli arka planda bir Systemd servisi olarak çalışır. Servisi yönetmek için şu komutları kullanabilirsiniz:

* **Servis Durumunu Kontrol Etme:**
  ```bash
  sudo systemctl status mcs-controller.service
  ```
* **Servisi Yeniden Başlatma:**
  ```bash
  sudo systemctl restart mcs-controller.service
  ```
* **Servis Loglarını Canlı İzleme:**
  ```bash
  journalctl -u mcs-controller.service -f
  ```

---

## 🔍 6. Sorun Giderme (Troubleshooting)

Eğer başka bir cihazdan arayüze bağlanamıyorsanız:

1. **Servisin Çalıştığını Doğrulayın:**
   `sudo systemctl status mcs-controller.service` komutuyla servisin `active (running)` durumda olduğunu kontrol edin.
2. **Portun Dinlendiğini Doğrulayın:**
   `ss -tulpn | grep 8080` çıktısında `0.0.0.0:8080` veya `*:8080` ibaresini görün.
3. **Güvenlik Duvarını Geçici Olarak Kapatıp Test Edin:**
   Erişim engeli devam ediyorsa `sudo ufw disable` yaparak sorunun güvenlik duvarından kaynaklanıp kaynaklanmadığını teyit edin.
