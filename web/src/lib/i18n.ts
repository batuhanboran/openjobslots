// UI translations. Language selection in quick-settings switches the interface
// live. Keys map to per-language strings; missing entries fall back to English.

export const SUPPORTED_LANGS = [
  "tr", "en", "de", "fr", "es", "pt", "it", "nl", "pl", "ja", "ko", "zh",
] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = "tr";

// Native language names for the picker.
export const LANGUAGE_NAMES: Record<Lang, string> = {
  tr: "Türkçe", en: "English", de: "Deutsch", fr: "Français", es: "Español",
  pt: "Português", it: "Italiano", nl: "Nederlands", pl: "Polski",
  ja: "日本語", ko: "한국어", zh: "中文",
};

type Dict = Record<Lang, string>;
const T: Record<string, Dict> = {
  "search.placeholder": {
    tr: "Açık iş ilanlarını ara…", en: "Search open job slots…", de: "Offene Stellen suchen…",
    fr: "Rechercher des offres d'emploi…", es: "Buscar vacantes…", pt: "Pesquisar vagas abertas…",
    it: "Cerca posizioni aperte…", nl: "Zoek openstaande vacatures…", pl: "Szukaj ofert pracy…",
    ja: "求人を検索…", ko: "채용 공고 검색…", zh: "搜索职位空缺…",
  },
  "search.listening": {
    tr: "Dinleniyor… konuşun", en: "Listening… speak now", de: "Hört zu… sprechen Sie",
    fr: "Écoute… parlez", es: "Escuchando… habla", pt: "Ouvindo… fale", it: "In ascolto… parla",
    nl: "Luistert… spreek nu", pl: "Słucham… mów", ja: "聞き取り中…話してください",
    ko: "듣는 중… 말씀하세요", zh: "正在聆听…请说话",
  },
  "search.button": {
    tr: "Ara", en: "Search", de: "Suchen", fr: "Rechercher", es: "Buscar", pt: "Pesquisar",
    it: "Cerca", nl: "Zoeken", pl: "Szukaj", ja: "検索", ko: "검색", zh: "搜索",
  },
  "search.micStart": {
    tr: "Ses girişini başlat", en: "Start voice input", de: "Spracheingabe starten",
    fr: "Démarrer la saisie vocale", es: "Iniciar entrada de voz", pt: "Iniciar entrada de voz",
    it: "Avvia input vocale", nl: "Steminvoer starten", pl: "Rozpocznij wprowadzanie głosowe",
    ja: "音声入力を開始", ko: "음성 입력 시작", zh: "开始语音输入",
  },
  "search.micStop": {
    tr: "Ses girişini durdur", en: "Stop voice input", de: "Spracheingabe stoppen",
    fr: "Arrêter la saisie vocale", es: "Detener entrada de voz", pt: "Parar entrada de voz",
    it: "Ferma input vocale", nl: "Steminvoer stoppen", pl: "Zatrzymaj wprowadzanie głosowe",
    ja: "音声入力を停止", ko: "음성 입력 중지", zh: "停止语音输入",
  },
  "search.micUnsupported": {
    tr: "Tarayıcınız sesli aramayı desteklemiyor", en: "Your browser doesn't support voice search",
    de: "Ihr Browser unterstützt keine Sprachsuche", fr: "Votre navigateur ne prend pas en charge la recherche vocale",
    es: "Tu navegador no admite la búsqueda por voz", pt: "Seu navegador não suporta busca por voz",
    it: "Il tuo browser non supporta la ricerca vocale", nl: "Je browser ondersteunt geen spraakzoeken",
    pl: "Twoja przeglądarka nie obsługuje wyszukiwania głosowego", ja: "お使いのブラウザは音声検索に対応していません",
    ko: "브라우저가 음성 검색을 지원하지 않습니다", zh: "您的浏览器不支持语音搜索",
  },
  "qs.title": {
    tr: "Hızlı ayarlar", en: "Quick settings", de: "Schnelleinstellungen", fr: "Réglages rapides",
    es: "Ajustes rápidos", pt: "Configurações rápidas", it: "Impostazioni rapide",
    nl: "Snelle instellingen", pl: "Szybkie ustawienia", ja: "クイック設定", ko: "빠른 설정", zh: "快速设置",
  },
  "qs.language": {
    tr: "Görünüm dili", en: "Display language", de: "Anzeigesprache", fr: "Langue d'affichage",
    es: "Idioma de la interfaz", pt: "Idioma de exibição", it: "Lingua dell'interfaccia",
    nl: "Weergavetaal", pl: "Język interfejsu", ja: "表示言語", ko: "표시 언어", zh: "显示语言",
  },
  "qs.languageDesc": {
    tr: "Butonlar, etiketler, ipuçları vs. için", en: "For buttons, labels, tips, etc.",
    de: "Für Schaltflächen, Beschriftungen, Tipps usw.", fr: "Pour les boutons, libellés, astuces, etc.",
    es: "Para botones, etiquetas, consejos, etc.", pt: "Para botões, rótulos, dicas, etc.",
    it: "Per pulsanti, etichette, suggerimenti, ecc.", nl: "Voor knoppen, labels, tips, enz.",
    pl: "Dla przycisków, etykiet, wskazówek itp.", ja: "ボタン、ラベル、ヒントなど",
    ko: "버튼, 라벨, 팁 등", zh: "用于按钮、标签、提示等",
  },
  "qs.region": {
    tr: "Bölge", en: "Region", de: "Region", fr: "Région", es: "Región", pt: "Região",
    it: "Regione", nl: "Regio", pl: "Region", ja: "地域", ko: "지역", zh: "地区",
  },
  "qs.regionDesc": {
    tr: "Arama sonuçlarınız için", en: "For your search results", de: "Für Ihre Suchergebnisse",
    fr: "Pour vos résultats de recherche", es: "Para tus resultados de búsqueda", pt: "Para seus resultados de busca",
    it: "Per i tuoi risultati di ricerca", nl: "Voor je zoekresultaten", pl: "Dla wyników wyszukiwania",
    ja: "検索結果のため", ko: "검색 결과에 적용", zh: "用于您的搜索结果",
  },
  "qs.theme": {
    tr: "Tema", en: "Theme", de: "Design", fr: "Thème", es: "Tema", pt: "Tema", it: "Tema",
    nl: "Thema", pl: "Motyw", ja: "テーマ", ko: "테마", zh: "主题",
  },
  "qs.themeDesc": {
    tr: "Tercih ettiğiniz temayı seçin", en: "Choose your preferred theme", de: "Wählen Sie Ihr bevorzugtes Design",
    fr: "Choisissez votre thème préféré", es: "Elige tu tema preferido", pt: "Escolha seu tema preferido",
    it: "Scegli il tema preferito", nl: "Kies je gewenste thema", pl: "Wybierz preferowany motyw",
    ja: "お好みのテーマを選択", ko: "원하는 테마를 선택하세요", zh: "选择您喜欢的主题",
  },
  "theme.light": {
    tr: "Aydınlık", en: "Light", de: "Hell", fr: "Clair", es: "Claro", pt: "Claro", it: "Chiaro",
    nl: "Licht", pl: "Jasny", ja: "ライト", ko: "라이트", zh: "浅色",
  },
  "theme.dark": {
    tr: "Karanlık", en: "Dark", de: "Dunkel", fr: "Sombre", es: "Oscuro", pt: "Escuro", it: "Scuro",
    nl: "Donker", pl: "Ciemny", ja: "ダーク", ko: "다크", zh: "深色",
  },
  "theme.system": {
    tr: "Cihaz varsayılanı", en: "Device default", de: "Gerätestandard", fr: "Par défaut de l'appareil",
    es: "Predeterminado del dispositivo", pt: "Padrão do dispositivo", it: "Predefinito del dispositivo",
    nl: "Apparaatstandaard", pl: "Domyślne urządzenia", ja: "デバイスの既定", ko: "기기 기본값", zh: "设备默认",
  },
  "qs.feedback": {
    tr: "Geri bildirim paylaş", en: "Share feedback", de: "Feedback geben", fr: "Partager un avis",
    es: "Compartir comentarios", pt: "Enviar feedback", it: "Condividi un feedback",
    nl: "Feedback delen", pl: "Podziel się opinią", ja: "フィードバックを送る", ko: "의견 보내기", zh: "分享反馈",
  },
  "qs.feedbackDesc": {
    tr: "OpenJobSlots'u geliştirmemize yardımcı olun", en: "Help us improve OpenJobSlots",
    de: "Helfen Sie uns, OpenJobSlots zu verbessern", fr: "Aidez-nous à améliorer OpenJobSlots",
    es: "Ayúdanos a mejorar OpenJobSlots", pt: "Ajude-nos a melhorar o OpenJobSlots",
    it: "Aiutaci a migliorare OpenJobSlots", nl: "Help ons OpenJobSlots te verbeteren",
    pl: "Pomóż nam ulepszyć OpenJobSlots", ja: "OpenJobSlots の改善にご協力ください",
    ko: "OpenJobSlots 개선을 도와주세요", zh: "帮助我们改进 OpenJobSlots",
  },
  "qs.share": {
    tr: "Paylaş", en: "Share", de: "Teilen", fr: "Partager", es: "Compartir", pt: "Compartilhar",
    it: "Condividi", nl: "Delen", pl: "Udostępnij", ja: "共有", ko: "공유", zh: "分享",
  },
  "footer.publicRepo": {
    tr: "Public Repo", en: "Public Repo", de: "Öffentliches Repo", fr: "Dépôt public",
    es: "Repo público", pt: "Repo público", it: "Repo pubblico", nl: "Openbare repo",
    pl: "Publiczne repo", ja: "公開リポジトリ", ko: "공개 저장소", zh: "公开仓库",
  },
  "version.public": {
    tr: "Genel", en: "Public", de: "Öffentlich", fr: "Public", es: "Público", pt: "Público",
    it: "Pubblico", nl: "Openbaar", pl: "Publiczny", ja: "公開", ko: "공개", zh: "公开",
  },
  "release.title": {
    tr: "Sürüm notları", en: "Release notes", de: "Versionshinweise", fr: "Notes de version",
    es: "Notas de la versión", pt: "Notas de versão", it: "Note di rilascio", nl: "Release-opmerkingen",
    pl: "Informacje o wersji", ja: "リリースノート", ko: "릴리스 노트", zh: "版本说明",
  },
  "release.close": {
    tr: "Kapat", en: "Close", de: "Schließen", fr: "Fermer", es: "Cerrar", pt: "Fechar",
    it: "Chiudi", nl: "Sluiten", pl: "Zamknij", ja: "閉じる", ko: "닫기", zh: "关闭",
  },
  "release.version": {
    tr: "Sürüm", en: "Version", de: "Version", fr: "Version", es: "Versión", pt: "Versão",
    it: "Versione", nl: "Versie", pl: "Wersja", ja: "バージョン", ko: "버전", zh: "版本",
  },
  "feedback.question": {
    tr: "Gösterilen bilgiler hakkında ne düşünüyorsunuz?", en: "What do you think about the information shown?",
    de: "Was halten Sie von den angezeigten Informationen?", fr: "Que pensez-vous des informations affichées ?",
    es: "¿Qué opinas de la información mostrada?", pt: "O que você acha das informações exibidas?",
    it: "Cosa pensi delle informazioni mostrate?", nl: "Wat vind je van de getoonde informatie?",
    pl: "Co sądzisz o wyświetlanych informacjach?", ja: "表示された情報についてどう思いますか？",
    ko: "표시된 정보에 대해 어떻게 생각하시나요?", zh: "您如何看待所显示的信息？",
  },
  "feedback.r1": {
    tr: "Yardımcı oldu", en: "Helpful", de: "Hilfreich", fr: "Utile", es: "Útil", pt: "Útil",
    it: "Utile", nl: "Nuttig", pl: "Pomocne", ja: "役に立った", ko: "도움이 됨", zh: "有帮助",
  },
  "feedback.r2": {
    tr: "Konuyla ilgili değil", en: "Not relevant", de: "Nicht relevant", fr: "Non pertinent",
    es: "No relevante", pt: "Não relevante", it: "Non pertinente", nl: "Niet relevant",
    pl: "Nietrafne", ja: "関連性がない", ko: "관련 없음", zh: "不相关",
  },
  "feedback.r3": {
    tr: "Bir terslik var", en: "Something's wrong", de: "Etwas stimmt nicht", fr: "Il y a un problème",
    es: "Algo está mal", pt: "Algo está errado", it: "C'è qualcosa che non va", nl: "Er is iets mis",
    pl: "Coś jest nie tak", ja: "何かがおかしい", ko: "문제가 있음", zh: "有点问题",
  },
  "feedback.r4": {
    tr: "Yararlı değil", en: "Not useful", de: "Nicht nützlich", fr: "Pas utile", es: "No es útil",
    pt: "Não é útil", it: "Non utile", nl: "Niet nuttig", pl: "Bezużyteczne", ja: "役に立たない",
    ko: "유용하지 않음", zh: "没用",
  },
  "feedback.commentLabel": {
    tr: "Yorum veya önerileriniz var mı?", en: "Any comments or suggestions?",
    de: "Kommentare oder Vorschläge?", fr: "Des commentaires ou suggestions ?",
    es: "¿Comentarios o sugerencias?", pt: "Comentários ou sugestões?", it: "Commenti o suggerimenti?",
    nl: "Opmerkingen of suggesties?", pl: "Masz uwagi lub sugestie?", ja: "コメントや提案はありますか？",
    ko: "의견이나 제안이 있으신가요?", zh: "有任何意见或建议吗？",
  },
  "feedback.send": {
    tr: "Gönder", en: "Send", de: "Senden", fr: "Envoyer", es: "Enviar", pt: "Enviar",
    it: "Invia", nl: "Verzenden", pl: "Wyślij", ja: "送信", ko: "보내기", zh: "发送",
  },
  "feedback.sending": {
    tr: "Gönderiliyor…", en: "Sending…", de: "Wird gesendet…", fr: "Envoi…", es: "Enviando…",
    pt: "Enviando…", it: "Invio…", nl: "Verzenden…", pl: "Wysyłanie…", ja: "送信中…", ko: "보내는 중…", zh: "发送中…",
  },
  "feedback.thanks": {
    tr: "Teşekkürler! 🎉", en: "Thank you! 🎉", de: "Danke! 🎉", fr: "Merci ! 🎉", es: "¡Gracias! 🎉",
    pt: "Obrigado! 🎉", it: "Grazie! 🎉", nl: "Bedankt! 🎉", pl: "Dziękujemy! 🎉", ja: "ありがとうございます！🎉",
    ko: "감사합니다! 🎉", zh: "谢谢！🎉",
  },
  "feedback.thanksSub": {
    tr: "Geri bildiriminiz alındı.", en: "Your feedback has been received.", de: "Ihr Feedback ist eingegangen.",
    fr: "Votre avis a bien été reçu.", es: "Hemos recibido tus comentarios.", pt: "Seu feedback foi recebido.",
    it: "Il tuo feedback è stato ricevuto.", nl: "Je feedback is ontvangen.", pl: "Otrzymaliśmy Twoją opinię.",
    ja: "フィードバックを受け取りました。", ko: "의견이 접수되었습니다.", zh: "我们已收到您的反馈。",
  },
  "results.count": {
    tr: "sonuç", en: "results", de: "Ergebnisse", fr: "résultats", es: "resultados", pt: "resultados",
    it: "risultati", nl: "resultaten", pl: "wyników", ja: "件", ko: "개 결과", zh: "个结果",
  },
  "results.loadMore": {
    tr: "Daha fazla yükle", en: "Load more", de: "Mehr laden", fr: "Charger plus", es: "Cargar más",
    pt: "Carregar mais", it: "Carica altri", nl: "Meer laden", pl: "Załaduj więcej", ja: "もっと見る",
    ko: "더 보기", zh: "加载更多",
  },
  "results.loading": {
    tr: "Yükleniyor…", en: "Loading…", de: "Wird geladen…", fr: "Chargement…", es: "Cargando…",
    pt: "Carregando…", it: "Caricamento…", nl: "Laden…", pl: "Ładowanie…", ja: "読み込み中…", ko: "불러오는 중…", zh: "加载中…",
  },
  "results.emptyPrefix": {
    tr: "için sonuç bulunamadı.", en: "— no results found.", de: "— keine Ergebnisse gefunden.",
    fr: "— aucun résultat trouvé.", es: "— no se encontraron resultados.", pt: "— nenhum resultado encontrado.",
    it: "— nessun risultato trovato.", nl: "— geen resultaten gevonden.", pl: "— nie znaleziono wyników.",
    ja: "— 結果が見つかりませんでした。", ko: "— 결과를 찾을 수 없습니다.", zh: "— 未找到结果。",
  },
  "results.errorTitle": {
    tr: "Arama şu an kullanılamıyor", en: "Search is unavailable right now", de: "Die Suche ist derzeit nicht verfügbar",
    fr: "La recherche est indisponible pour le moment", es: "La búsqueda no está disponible ahora",
    pt: "A busca está indisponível no momento", it: "La ricerca non è disponibile al momento",
    nl: "Zoeken is momenteel niet beschikbaar", pl: "Wyszukiwanie jest teraz niedostępne",
    ja: "現在検索を利用できません", ko: "지금은 검색을 사용할 수 없습니다", zh: "搜索暂时不可用",
  },
  "results.errorSub": {
    tr: "Sunucuya ulaşılamadı. Lütfen birazdan tekrar deneyin.", en: "Couldn't reach the server. Please try again shortly.",
    de: "Server nicht erreichbar. Bitte versuchen Sie es gleich erneut.", fr: "Serveur injoignable. Réessayez dans un instant.",
    es: "No se pudo conectar al servidor. Inténtalo de nuevo pronto.", pt: "Não foi possível acessar o servidor. Tente novamente em breve.",
    it: "Impossibile raggiungere il server. Riprova tra poco.", nl: "Kan de server niet bereiken. Probeer het zo opnieuw.",
    pl: "Nie można połączyć się z serwerem. Spróbuj ponownie za chwilę.", ja: "サーバーに接続できませんでした。しばらくして再度お試しください。",
    ko: "서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.", zh: "无法连接服务器，请稍后再试。",
  },
  "results.startHint": {
    tr: "Aramaya başlamak için bir anahtar kelime girin.", en: "Enter a keyword to start searching.",
    de: "Geben Sie ein Stichwort ein, um zu suchen.", fr: "Saisissez un mot-clé pour lancer la recherche.",
    es: "Escribe una palabra clave para empezar a buscar.", pt: "Digite uma palavra-chave para começar a buscar.",
    it: "Inserisci una parola chiave per iniziare la ricerca.", nl: "Voer een trefwoord in om te zoeken.",
    pl: "Wpisz słowo kluczowe, aby rozpocząć wyszukiwanie.", ja: "検索するにはキーワードを入力してください。",
    ko: "검색하려면 키워드를 입력하세요.", zh: "输入关键词开始搜索。",
  },
  "nav.home": {
    tr: "Ana sayfa", en: "Home", de: "Startseite", fr: "Accueil", es: "Inicio", pt: "Início",
    it: "Home", nl: "Home", pl: "Strona główna", ja: "ホーム", ko: "홈", zh: "首页",
  },
  "job.untitled": {
    tr: "İsimsiz ilan", en: "Untitled posting", de: "Ohne Titel", fr: "Offre sans titre",
    es: "Oferta sin título", pt: "Vaga sem título", it: "Annuncio senza titolo", nl: "Naamloze vacature",
    pl: "Oferta bez tytułu", ja: "無題の求人", ko: "제목 없는 공고", zh: "无标题职位",
  },
  "date.today": {
    tr: "Bugün", en: "Today", de: "Heute", fr: "Aujourd'hui", es: "Hoy", pt: "Hoje", it: "Oggi",
    nl: "Vandaag", pl: "Dziś", ja: "今日", ko: "오늘", zh: "今天",
  },
  "date.yesterday": {
    tr: "Dün", en: "Yesterday", de: "Gestern", fr: "Hier", es: "Ayer", pt: "Ontem", it: "Ieri",
    nl: "Gisteren", pl: "Wczoraj", ja: "昨日", ko: "어제", zh: "昨天",
  },
  // Region option labels
  "region.all": {
    tr: "Tüm bölgeler", en: "All regions", de: "Alle Regionen", fr: "Toutes les régions",
    es: "Todas las regiones", pt: "Todas as regiões", it: "Tutte le regioni", nl: "Alle regio's",
    pl: "Wszystkie regiony", ja: "すべての地域", ko: "모든 지역", zh: "所有地区",
  },
  "region.na": {
    tr: "Kuzey Amerika", en: "North America", de: "Nordamerika", fr: "Amérique du Nord",
    es: "América del Norte", pt: "América do Norte", it: "Nord America", nl: "Noord-Amerika",
    pl: "Ameryka Północna", ja: "北米", ko: "북미", zh: "北美",
  },
  "region.emea": {
    tr: "EMEA (Avrupa · Orta Doğu · Afrika)", en: "EMEA (Europe · Middle East · Africa)",
    de: "EMEA (Europa · Naher Osten · Afrika)", fr: "EMEA (Europe · Moyen-Orient · Afrique)",
    es: "EMEA (Europa · Oriente Medio · África)", pt: "EMEA (Europa · Oriente Médio · África)",
    it: "EMEA (Europa · Medio Oriente · Africa)", nl: "EMEA (Europa · Midden-Oosten · Afrika)",
    pl: "EMEA (Europa · Bliski Wschód · Afryka)", ja: "EMEA（欧州・中東・アフリカ）",
    ko: "EMEA (유럽 · 중동 · 아프리카)", zh: "EMEA（欧洲·中东·非洲）",
  },
  "region.apac": {
    tr: "APAC (Asya-Pasifik)", en: "APAC (Asia-Pacific)", de: "APAC (Asien-Pazifik)",
    fr: "APAC (Asie-Pacifique)", es: "APAC (Asia-Pacífico)", pt: "APAC (Ásia-Pacífico)",
    it: "APAC (Asia-Pacifico)", nl: "APAC (Azië-Pacific)", pl: "APAC (Azja-Pacyfik)",
    ja: "APAC（アジア太平洋）", ko: "APAC (아시아 태평양)", zh: "APAC（亚太地区）",
  },
  "region.latam": {
    tr: "LATAM (Latin Amerika)", en: "LATAM (Latin America)", de: "LATAM (Lateinamerika)",
    fr: "LATAM (Amérique latine)", es: "LATAM (América Latina)", pt: "LATAM (América Latina)",
    it: "LATAM (America Latina)", nl: "LATAM (Latijns-Amerika)", pl: "LATAM (Ameryka Łacińska)",
    ja: "LATAM（ラテンアメリカ）", ko: "LATAM (라틴 아메리카)", zh: "LATAM（拉丁美洲）",
  },
  "region.us": {
    tr: "Amerika Birleşik Devletleri", en: "United States", de: "Vereinigte Staaten", fr: "États-Unis",
    es: "Estados Unidos", pt: "Estados Unidos", it: "Stati Uniti", nl: "Verenigde Staten",
    pl: "Stany Zjednoczone", ja: "アメリカ合衆国", ko: "미국", zh: "美国",
  },
  "region.uk": {
    tr: "Birleşik Krallık", en: "United Kingdom", de: "Vereinigtes Königreich", fr: "Royaume-Uni",
    es: "Reino Unido", pt: "Reino Unido", it: "Regno Unito", nl: "Verenigd Koninkrijk",
    pl: "Wielka Brytania", ja: "イギリス", ko: "영국", zh: "英国",
  },
  "region.de": {
    tr: "Almanya", en: "Germany", de: "Deutschland", fr: "Allemagne", es: "Alemania", pt: "Alemanha",
    it: "Germania", nl: "Duitsland", pl: "Niemcy", ja: "ドイツ", ko: "독일", zh: "德国",
  },
  "region.ca": {
    tr: "Kanada", en: "Canada", de: "Kanada", fr: "Canada", es: "Canadá", pt: "Canadá",
    it: "Canada", nl: "Canada", pl: "Kanada", ja: "カナダ", ko: "캐나다", zh: "加拿大",
  },
  "region.in": {
    tr: "Hindistan", en: "India", de: "Indien", fr: "Inde", es: "India", pt: "Índia", it: "India",
    nl: "India", pl: "Indie", ja: "インド", ko: "인도", zh: "印度",
  },
  // Suggestion dropdown type hints
  "suggestion.search": {
    tr: "Arama", en: "Search", de: "Suche", fr: "Recherche", es: "Búsqueda", pt: "Busca",
    it: "Ricerca", nl: "Zoeken", pl: "Wyszukiwanie", ja: "検索", ko: "검색", zh: "搜索",
  },
  "suggestion.title": {
    tr: "Ünvan", en: "Title", de: "Titel", fr: "Titre", es: "Puesto", pt: "Cargo",
    it: "Titolo", nl: "Functie", pl: "Stanowisko", ja: "職種", ko: "직함", zh: "职位",
  },
  "suggestion.company": {
    tr: "Şirket", en: "Company", de: "Unternehmen", fr: "Entreprise", es: "Empresa", pt: "Empresa",
    it: "Azienda", nl: "Bedrijf", pl: "Firma", ja: "企業", ko: "회사", zh: "公司",
  },
  "suggestion.location": {
    tr: "Konum", en: "Location", de: "Standort", fr: "Lieu", es: "Ubicación", pt: "Local",
    it: "Località", nl: "Locatie", pl: "Lokalizacja", ja: "勤務地", ko: "위치", zh: "地点",
  },
  "suggestion.ats": {
    tr: "ATS", en: "ATS", de: "ATS", fr: "ATS", es: "ATS", pt: "ATS",
    it: "ATS", nl: "ATS", pl: "ATS", ja: "ATS", ko: "ATS", zh: "ATS",
  },
  "suggestion.filter": {
    tr: "Filtre", en: "Filter", de: "Filter", fr: "Filtre", es: "Filtro", pt: "Filtro",
    it: "Filtro", nl: "Filter", pl: "Filtr", ja: "フィルター", ko: "필터", zh: "筛选",
  },
  // Active intent-filter pills on the results page
  "filter.remote": {
    tr: "Uzaktan", en: "Remote", de: "Remote", fr: "Télétravail", es: "Remoto", pt: "Remoto",
    it: "Da remoto", nl: "Remote", pl: "Zdalnie", ja: "リモート", ko: "원격", zh: "远程",
  },
  "filter.hybrid": {
    tr: "Hibrit", en: "Hybrid", de: "Hybrid", fr: "Hybride", es: "Híbrido", pt: "Híbrido",
    it: "Ibrido", nl: "Hybride", pl: "Hybrydowo", ja: "ハイブリッド", ko: "하이브리드", zh: "混合",
  },
  "filter.onsite": {
    tr: "Ofisten", en: "On-site", de: "Vor Ort", fr: "Sur site", es: "Presencial", pt: "Presencial",
    it: "In sede", nl: "Op locatie", pl: "Stacjonarnie", ja: "オンサイト", ko: "현장 근무", zh: "现场办公",
  },
  "filter.lastDays": {
    tr: "Son {n} gün", en: "Last {n} days", de: "Letzte {n} Tage", fr: "{n} derniers jours",
    es: "Últimos {n} días", pt: "Últimos {n} dias", it: "Ultimi {n} giorni",
    nl: "Laatste {n} dagen", pl: "Ostatnie {n} dni", ja: "過去{n}日", ko: "최근 {n}일", zh: "最近{n}天",
  },
  "filter.remove": {
    tr: "Filtreyi kaldır", en: "Remove filter", de: "Filter entfernen", fr: "Retirer le filtre",
    es: "Quitar filtro", pt: "Remover filtro", it: "Rimuovi filtro", nl: "Filter verwijderen",
    pl: "Usuń filtr", ja: "フィルターを解除", ko: "필터 제거", zh: "移除筛选",
  },
  "results.retry": {
    tr: "Yüklenemedi — tekrar deneyin", en: "Couldn't load — try again", de: "Laden fehlgeschlagen — erneut versuchen",
    fr: "Échec du chargement — réessayez", es: "No se pudo cargar — reintenta", pt: "Falha ao carregar — tente novamente",
    it: "Caricamento non riuscito — riprova", nl: "Laden mislukt — probeer opnieuw",
    pl: "Nie udało się wczytać — spróbuj ponownie", ja: "読み込めませんでした — もう一度お試しください",
    ko: "불러오지 못했습니다 — 다시 시도하세요", zh: "加载失败——请重试",
  },
};

export function translate(lang: Lang, key: string): string {
  const entry = T[key];
  if (!entry) return key;
  return entry[lang] ?? entry.en ?? key;
}
