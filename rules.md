# Proje Yönetim ve Geliştirme Kuralları

## 1. Teknolojik Altyapı ve Sadelik
*   Projede herhangi bir modern framework veya kütüphane (React, Vue vb.) kesinlikle kullanılmayacaktır.
*   Yalnızca saf **HTML5**, **CSS3** ve **Modern JavaScript (Vanilla JS)** kullanılacaktır.

## 2. Dosya Mimarisi ve Düzen (File Structure)
*   Dosya ağacı mantıklı, modüler ve temiz bir hiyerarşide açılacaktır. 
*   Varlıklar (resimler, ikonlar), stiller ve betikler kendilerine ait alt dizinlerde muhafaza edilecektir.
*   *Örnek Şablon:*
    ```text
    ├── index.html
    ├── css/
    │   └── style.css
    ├── js/
    │   └── main.js
    └── assets/
        └── images/
    ```

## 3. Arayüz ve Kullanıcı Deneyimi (UI/UX)
*   Tasarım asla sıradan, düz ve cansız olmayacaktır.
*   Göze hitap eden, estetik açıdan zengin, modern ve aynı zamanda yüksek işlevselliğe (functional) sahip bir arayüz inşa edilecektir.
*   Renk paletleri, tipografi ve animasyonlar bütünlük içinde olacak; kullanıcı deneyimi ön planda tutulacaktır.

## 4. Versiyon Kontrol Sistemi ve Kayıt Düzeni (Git Commit)
*   Geliştirme sürecinde disiplin esastır. Yapılan her bir anlamlı işlem, değişiklik veya ekleme sonrasında mutlak suretle **Git commit** atılacaktır.
*   Commit mesajları net, açıklayıcı ve yapılan işi tam yansıtan cinsten olacaktır.