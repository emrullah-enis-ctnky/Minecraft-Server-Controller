# 🛠️ DEVELOPER & AI SYSTEM REFERENCE GUIDE: Minecraft Cross-Play Server Architecture
Bu belge, CachyOS (Arch Linux tabanlı) işletim sistemi üzerinde çalışan, Bedrock ve Java oyuncularını birleştiren optimize edilmiş bir Minecraft sunucusunun teknik altyapısını ve yönetim komutlarını içermektedir. Geliştirilecek olan uygulama (GUI, Web Panel, Discord Bot veya CLI aracı) bu yapıya ve bu komutlara tam sadık kalarak inşa edilmelidir.
## 1. SISTEM VE ORTAM DEĞİŞKENLERİ (Environment Variables)
 * **İşletim Sistemi:** CachyOS (Arch Linux)
 * **Kullanılan Kabuk (Shell):** fish (Komutlar bash uyumlu da olsa fish shell üzerinde çalıştırıldığı varsayılmalıdır).
 * **Sunucu Kök Dizini:** ~/mc_server
 * **Çekirdek Dosyası:** server.jar (PaperMC)
 * **RAM Ataması:** 3GB (-Xmx3G -Xms3G)
 * **Sanallaştırma / Tünel:** screen (Tünel Adı: mcsunucu)
 * **Ağ Katmanı:** Tailscale VPN (tailscaled servisi aktif)
## 2. MİMARİ VE EKLENTİ (Plugin) YAPISI
Geliştirilecek uygulama, aşağıdaki mimarinin varlığını bilmelidir:
 1. **PaperMC:** Ana sunucu çekirdeğidir.
 2. **Geyser-Spigot:** Bedrock (Mobil/Konsol) oyuncularının Java sunucusuna girmesini sağlayan köprüdür. (Varsayılan Port: 19132)
 3. **Floodgate:** Bedrock oyuncuları için Java lisans doğrulamasını atlayan (bypass) sistemdir.
 4. **ViaVersion:** Sunucu ve istemci arasındaki sürüm farklılıklarını çözer.
## 3. UYGULAMA İÇİN KESİN ÇALIŞAN ÇEKİRDEK KOMUTLAR (Core Commands)
Uygulamanın arkaplan işlemleri (backend) aşağıdaki komutları kullanmalıdır. **DİKKAT:** Uygulama asla screen -r ile etkileşimli kabuğa girmemeli, tüm işlemleri dışarıdan screen -X veya dosya okuma yöntemleriyle yapmalıdır.
**A. Sunucuyu Başlatmak (Start Server):**
Sunucuyu arkaplanda başlatmak için kullanılacak yegane komut dizilimi:
```bash
cd ~/mc_server && screen -dmS mcsunucu java -Xmx4G -Xms4G -jar server.jar nogui

```
**B. Sunucuya Komut Göndermek / Güvenli Kapatmak (Send Command / Stop):**
Uygulama üzerinden sunucuya komut göndermek (örneğin op vermek, saat değiştirmek veya stop ile kapatmak) için screen -X stuff kullanılmalıdır:
```bash
# Sunucuyu güvenle kapatmak için:
screen -S mcsunucu -X stuff "stop\n"

# Sunucuya herhangi bir komut (örn: zamanı gündüz yap) göndermek için:
screen -S mcsunucu -X stuff "time set day\n"

```
**C. Sunucu Durumunu Kontrol Etmek (Status Check):**
Sunucunun arkaplanda çalışıp çalışmadığını anlamak için screen listesi kontrol edilmelidir.
```bash
screen -ls | grep mcsunucu

```
*(Eğer çıktı varsa sunucu açıktır, çıktı boşsa kapalıdır.)*
**D. Canlı Konsol Verisini (Log) Uygulamaya Çekmek:**
Geliştirilecek uygulamanın arayüzünde "Canlı Konsol" göstermek için, screen içine girmek yerine doğrudan log dosyası okunmalıdır.
```bash
# Sadece son 50 satırı okumak için:
tail -n 50 ~/mc_server/logs/latest.log

# Arayüze canlı veri akışı sağlamak için (Stream/WebSocket altyapısı için):
tail -f ~/mc_server/logs/latest.log

```
## 4. HATA YÖNETİMİ VE ACİL DURUM (Error Handling & Edge Cases)
Uygulama, sunucunun kilitlendiği veya çöktüğü durumlarda "Force Kill (Zorla Kapatma)" veya "Kurtarma" butonu içermelidir. Bu butonun çalıştıracağı acil durum protokolü şu şekildedir:
**A. Tam Temizlik (Zorla Kapatma ve Screen Hayaletlerini Silme):**
Eğer java donarsa, process'i sonlandırıp hayalet screen tünellerini temizleyen komut zinciri:
```bash
killall -9 java && screen -wipe

```
*Not: Eğer belirli bir screen hayaleti kalırsa screen -X -S <id>.mcsunucu quit komutu ile temizlenmelidir.*
**B. Kilitli Harita Dosyası (World Session Lock) Çözümü:**
Sunucu aniden kapandığında world/session.lock dosyası sunucunun yeniden açılmasını engeller. Başlatma scriptinde hata yakalanırsa şu komutla kilit temizlenmelidir:
```bash
rm -f ~/mc_server/world/session.lock

```
## 5. AĞ VE ERİŞİM (Network & VPN)
Uygulamanın "Sunucu İp Adresi" bölümünde oyunculara gösterilecek IP adresi, makinenin Tailscale IP'si olmalıdır. Uygulama bu IP'yi otomatik çekmek için şu komutu kullanabilir:
```bash
tailscale ip -4

```
*Oyuncular için Port bilgisi daima 19132 (Geyser Portu) olarak gösterilmelidir.*
