# Sistem Mantığı ve Sunucu Mimarisi (system-logic2.md)

## 1. Sunucu ve Ağ Konfigürasyonu (Dual-IP Binding)
*   Uygulama, sunucu üzerinde hem **Yerel Ağ (Local IP)** hem de **Tailscale IP** adresleri üzerinden eşzamanlı olarak hizmet verecektir.
*   İstemcilerin (client) her iki IP adresi üzerinden de sorunsuz bağlantı kurabilmesi için sunucu yazılımı tüm ağ arayüzlerini dinleyecek şekilde (`0.0.0.0` host adresiyle) yapılandırılacaktır.
*   Uygulama önceden tayin edilmiş belirli ve sabit bir port üzerinden ayağa kalkacaktır.

## 2. Systemd Servis Entegrasyonu (Arka Plan Hizmeti)
*   Sistem güvenliği ve sürekliliği için uygulama bir `systemd` servisi (`.service` dosyası) olarak yapılandırılacaktır.
*   Sunucu her başladığında (boot esnasında) bu servis otomatik olarak tetiklenecek ve sistem arka planda kendiliğinden aktif hale gelecektir.
*   Servis dosyası, ağ servislerinin (`network.target`) tamamen hazır olmasını bekleyecek şekilde yapılandırılacaktır.

## 3. Dinamik Durum ve Ağ Göstergeleri (UI Network Panel)
*   Arayüzün görünür bir yerinde, sunucunun anlık olarak dinlediği **Yerel IP**, **Tailscale IP** ve **Aktif Port** bilgileri şık ve estetik bir panel içerisinde listelenecektir.
*   Bu göstergeler dinamik olacak, istemci tarafında bağlantı durumunu net bir şekilde doğrulayacaktır.

## 4. Entegre Canlı Günlük Sistemi (Web Logcat UI)
*   Uygulama içerisindeki tüm arka plan hareketlerini, sunucu loglarını ve sistem olaylarını takip edebilmek adına arayüze entegre bir **Logcat** paneli inşa edilecektir.
*   Bu log arayüzü, terminal estetiğine sahip (monospaced fontlar, dark tema, önem derecesine göre renklendirilmiş satırlar) son derece şık ve modern bir tasarımla sunulacaktır.

## 5. Esnek Tasarım ve Duyarlılık (Responsive UI)
*   Arayüzdeki tüm butonlar, kontrol elemanları ve paneller tamamen **responsive (duyarlı)** olacaktır.
*   Farklı ekran boyutlarında (mobil, tablet, masaüstü) buton boyutları, tıklama alanları ve yerleşim düzeni kullanıcıyı yormayacak ve işlevselliği bozmayacak şekilde esneklik gösterecektir.