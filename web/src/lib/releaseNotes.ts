// Release notes (Turkish) mirrored from the OpenJobSlots production app so the
// version popup matches the existing site 1:1.

export interface ReleaseNote {
  version: string;
  date: string; // Turkish short format, e.g. "10 Tem 2026"
  title: string;
  summary: string;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "3.0.0",
    date: "10 Tem 2026",
    title: "Tam ATS kataloğu ve toplayıcı kaynaklar",
    summary:
      "Alım kayıt defterine 628 ATS platformunun tamamını kaydedip yapılandırır, sertifikalı fetch ve parser zinciriyle RemoteOK, Himalayas ve Arbeitnow toplayıcı kaynaklarını ekler, Workable ve Personio'yu etkinleştirir, Workday, BrassRing ve AppliTrack genelinde konum ve coğrafi veri çıkarımını onarır, gelecekteki ilan tarihlerinin indekse girmesini engeller ve yük altında veritabanı ile worker baskısını düşürür.",
  },
  {
    version: "2.3.0",
    date: "9 Haz 2026",
    title: "Akıllı CV Arama ve Masaüstü İstatistik Paneli",
    summary:
      "Masaüstünde PDF CV dosyalarını sürükleyip bırakarak tarayıcı tarafında ayrıştırma ve Meilisearch anahtar kelimeleriyle eşleşen işleri otomatik getirme özelliğini sunar, Anasayfa'da ortalanmış cam kristal (glassmorphic) istatistik paneli ekler ve arama sonuçları başlığındaki masaüstüne özel canlı metrikleri geri getirir.",
  },
  {
    version: "2.2.0",
    date: "1 Haz 2026",
    title: "ATS mimarisi ve kurtarma güvenlik hatları",
    summary:
      "ATS kurtarma kanıtını kaynak yerel modüllere yaklaştırır, alias ve fixture sahipliğini sıkılaştırır, daha güvenli salt okunur Meili/Postgres facet-drift tanılaması ekler ve isteğe bağlı zenginleştirme payload'larından gelen hatalı parser-drift uyarılarını azaltır.",
  },
  {
    version: "2.1.0",
    date: "31 May 2026",
    title: "ATS pipeline ve runtime güvenliği",
    summary:
      "Kaynak modülü yönlendirmesini ve parser kanıt hatlarını güçlendirir, ATS pipeline korumalarını açık tutar, yük altında yinelenen okuma işlerini birleştirir, arka plan worker ve deploy baskısını düşürür, onarım penceresinden sonra Meili/Postgres eşitliğini doğrulanmış tutar.",
  },
  {
    version: "2.0.0",
    date: "27 May 2026",
    title: "Kapsam, ATS alımı ve arama eşitliği",
    summary:
      "Net iş ilanı sayılarını, arama başlığında ATS ve şirket kapsamını, daha fazla kaynağa özel ATS alımını ve parser çalışmasını, kontrollü canary genişlemesini, daha yüksek worker verimini ve yenilenmiş arama indeksi eşitliğini ekler.",
  },
  {
    version: "1.9.3",
    date: "18 May 2026",
    title: "İndeks tazeliği ve genel sayı düzeni",
    summary:
      "Genel arama sayısını canlı indeksle uyumlu tuttu, sıralama geçişini iyileştirdi, worker tazelik bütçesini geri getirdi ve daha büyük, daha taze bir indeks için sonraki güvenli kaynak kalitesi yolunu belgeledi.",
  },
  {
    version: "1.9.2",
    date: "17 May 2026",
    title: "Genel arama bağımlılıklarını sağlamlaştırma",
    summary:
      "Genel arama güncellemesini canlı tuttu ve web build için sabitlenmiş geçişli override'larla deploy zamanı bağımlılık uyarılarını çözdü.",
  },
  {
    version: "1.9.1",
    date: "17 May 2026",
    title: "Genel arama deneyimi güncellemesi",
    summary:
      "Genel arama kabuğunu temizledi, openjobslots logosunu korudu, masaüstü için yapışkan arama paneli, mobil uyumlu filtreler, dinamik sonuç sayıları, 3 günlük güncellik filtresi, genişletilmiş sıralama kontrolleri, görünür niyet çipleri olan arama önerileri ve kompakt kaynak paneli ekledi.",
  },
  {
    version: "1.8.0",
    date: "12 May 2026",
    title: "Sertifikalı kaynak indeksleme sürümü",
    summary:
      "Kaynağa özel modüller, sertifikasyon çalışma alanı, API ve HTML parser dalgaları, eşik tabanlı indeksleme, sertifikalı genel veri seti yeniden oluşturma ve son Meili/Postgres eşitliği ile ATS fetch/parser/indeks döngüsünü kapattı.",
  },
  {
    version: "1.7.0",
    date: "12 May 2026",
    title: "Temiz parser kalite sürümü",
    summary:
      "Parser kalite kapısı, ATS sertifikasyon çalışma alanı, parser onarımları, kontrollü genel veri seti yeniden oluşturma, sürekli kaynak kalitesi koruması ve son Meili rebuild ile temiz parser/veri kalitesi döngüsünü kapattı.",
  },
];
