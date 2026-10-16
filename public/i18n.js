(function(){
var dict = {
  en: { nav_about:"About", nav_rooms:"Rooms", nav_gallery:"Gallery", nav_reviews:"Reviews", nav_faq:"FAQ", nav_contact:"Contact", nav_book:"Book a room",
    hero_eyebrow:"BAHIR DAR · ETHIOPIA", hero_h1:'A warm welcome<br><em>in the heart of Bahir Dar.</em>',
    hero_lead:"Near Bahir Dar Stadium — comfortable rooms, friendly service, and easy access to the city's main sights.",
    hero_cta:"Reserve your stay", rooms_eyebrow:"OUR ROOMS", rooms_h2:"Choose your room." },
  am: { nav_about:"ስለ እኛ", nav_rooms:"ክፍሎች", nav_gallery:"ፎቶዎች", nav_reviews:"አስተያየት", nav_faq:"ጥያቄዎች", nav_contact:"አግኙን", nav_book:"ክፍል ያስይዙ",
    hero_eyebrow:"ባህር ዳር · ኢትዮጵያ", hero_h1:'ሞቅ ያለ አቀባበል<br><em>በባህር ዳር ልብ ውስጥ።</em>',
    hero_lead:"ከባህር ዳር ስታዲየም አጠገብ — ምቹ ክፍሎች፣ ወዳጃዊ አገልግሎት፣ ወደ ከተማዋ ዋና መስህቦች ቀላል መዳረሻ።",
    hero_cta:"ቆይታዎን ያስይዙ", rooms_eyebrow:"ክፍሎቻችን", rooms_h2:"ክፍልዎን ይምረጡ።" },
  sw: { nav_about:"Kuhusu", nav_rooms:"Vyumba", nav_gallery:"Picha", nav_reviews:"Maoni", nav_faq:"Maswali", nav_contact:"Wasiliana", nav_book:"Weka nafasi",
    hero_eyebrow:"BAHIR DAR · ETHIOPIA", hero_h1:'Karibu kwa joto<br><em>katikati ya Bahir Dar.</em>',
    hero_lead:"Karibu na Uwanja wa Bahir Dar — vyumba vizuri, huduma ya kirafiki, na ufikiaji rahisi wa vivutio vikuu vya jiji.",
    hero_cta:"Weka nafasi yako", rooms_eyebrow:"VYUMBA VYETU", rooms_h2:"Chagua chumba chako." },
  fr: { nav_about:"À propos", nav_rooms:"Chambres", nav_gallery:"Galerie", nav_reviews:"Avis", nav_faq:"FAQ", nav_contact:"Contact", nav_book:"Réserver",
    hero_eyebrow:"BAHIR DAR · ÉTHIOPIE", hero_h1:'Un accueil chaleureux<br><em>au cœur de Bahir Dar.</em>',
    hero_lead:"Près du stade de Bahir Dar — chambres confortables, service amical, accès facile aux principaux sites de la ville.",
    hero_cta:"Réservez votre séjour", rooms_eyebrow:"NOS CHAMBRES", rooms_h2:"Choisissez votre chambre." },
  ar: { nav_about:"من نحن", nav_rooms:"الغرف", nav_gallery:"الصور", nav_reviews:"التقييمات", nav_faq:"الأسئلة", nav_contact:"اتصل بنا", nav_book:"احجز غرفة",
    hero_eyebrow:"بحر دار · إثيوبيا", hero_h1:'ترحيب دافئ<br><em>في قلب بحر دار.</em>',
    hero_lead:"بالقرب من ملعب بحر دار — غرف مريحة، خدمة ودية، ووصول سهل لأهم معالم المدينة.",
    hero_cta:"احجز إقامتك", rooms_eyebrow:"غرفنا", rooms_h2:"اختر غرفتك." },
  zh: { nav_about:"关于我们", nav_rooms:"客房", nav_gallery:"相册", nav_reviews:"评价", nav_faq:"常见问题", nav_contact:"联系我们", nav_book:"预订客房",
    hero_eyebrow:"巴哈达尔 · 埃塞俄比亚", hero_h1:'温暖的欢迎<br><em>巴哈达尔的心脏地带。</em>',
    hero_lead:"毗邻巴哈达尔体育场——舒适的客房，友好的服务，轻松抵达城市主要景点。",
    hero_cta:"预订您的住宿", rooms_eyebrow:"我们的客房", rooms_h2:"选择您的客房。" },
  hi: { nav_about:"हमारे बारे में", nav_rooms:"कमरे", nav_gallery:"गैलरी", nav_reviews:"समीक्षाएँ", nav_faq:"प्रश्न", nav_contact:"संपर्क करें", nav_book:"कमरा बुक करें",
    hero_eyebrow:"बहिर दार · इथियोपिया", hero_h1:'एक गर्मजोशी भरा स्वागत<br><em>बहिर दार के दिल में।</em>',
    hero_lead:"बहिर दार स्टेडियम के पास — आरामदायक कमरे, मैत्रीपूर्ण सेवा, और शहर के मुख्य आकर्षणों तक आसान पहुंच।",
    hero_cta:"अपना प्रवास आरक्षित करें", rooms_eyebrow:"हमारे कमरे", rooms_h2:"अपना कमरा चुनें।" },
  de: { nav_about:"Über uns", nav_rooms:"Zimmer", nav_gallery:"Galerie", nav_reviews:"Bewertungen", nav_faq:"FAQ", nav_contact:"Kontakt", nav_book:"Zimmer buchen",
    hero_eyebrow:"BAHIR DAR · ÄTHIOPIEN", hero_h1:'Ein herzlicher Empfang<br><em>im Herzen von Bahir Dar.</em>',
    hero_lead:"In der Nähe des Bahir-Dar-Stadions — komfortable Zimmer, freundlicher Service, leichter Zugang zu den wichtigsten Sehenswürdigkeiten der Stadt.",
    hero_cta:"Jetzt buchen", rooms_eyebrow:"UNSERE ZIMMER", rooms_h2:"Wählen Sie Ihr Zimmer." },
  es: { nav_about:"Nosotros", nav_rooms:"Habitaciones", nav_gallery:"Galería", nav_reviews:"Reseñas", nav_faq:"Preguntas", nav_contact:"Contacto", nav_book:"Reservar",
    hero_eyebrow:"BAHIR DAR · ETIOPÍA", hero_h1:'Una cálida bienvenida<br><em>en el corazón de Bahir Dar.</em>',
    hero_lead:"Cerca del estadio de Bahir Dar — habitaciones cómodas, servicio amable y fácil acceso a los principales atractivos de la ciudad.",
    hero_cta:"Reserve su estancia", rooms_eyebrow:"NUESTRAS HABITACIONES", rooms_h2:"Elija su habitación." },
  pt: { nav_about:"Sobre nós", nav_rooms:"Quartos", nav_gallery:"Galeria", nav_reviews:"Avaliações", nav_faq:"Perguntas", nav_contact:"Contato", nav_book:"Reservar quarto",
    hero_eyebrow:"BAHIR DAR · ETIÓPIA", hero_h1:'Uma recepção calorosa<br><em>no coração de Bahir Dar.</em>',
    hero_lead:"Perto do estádio de Bahir Dar — quartos confortáveis, atendimento amigável e fácil acesso às principais atrações da cidade.",
    hero_cta:"Reserve sua estadia", rooms_eyebrow:"NOSSOS QUARTOS", rooms_h2:"Escolha seu quarto." },
  ht: { nav_about:"Sou nou", nav_rooms:"Chanm", nav_gallery:"Galri", nav_reviews:"Avi", nav_faq:"Kesyon", nav_contact:"Kontakte", nav_book:"Rezève chanm",
    hero_eyebrow:"BAHIR DAR · ETIOPI", hero_h1:'Yon akèy cho<br><em>nan kè Bahir Dar.</em>',
    hero_lead:"Toupre estad Bahir Dar — chanm konfòtab, sèvis amikal, ak aksè fasil nan pi gwo atraksyon vil la.",
    hero_cta:"Rezève sejou ou", rooms_eyebrow:"CHANM NOU YO", rooms_h2:"Chwazi chanm ou." },
  ja: { nav_about:"私たちについて", nav_rooms:"客室", nav_gallery:"ギャラリー", nav_reviews:"レビュー", nav_faq:"よくある質問", nav_contact:"お問い合わせ", nav_book:"客室を予約",
    hero_eyebrow:"バハルダール・エチオピア", hero_h1:'温かいおもてなし<br><em>バハルダールの中心で。</em>',
    hero_lead:"バハルダールスタジアムの近く — 快適な客室、親切なサービス、街の主要な観光スポットへの easy アクセス。",
    hero_cta:"ご宿泊を予約する", rooms_eyebrow:"客室一覧", rooms_h2:"お部屋をお選びください。" },
  ko: { nav_about:"소개", nav_rooms:"객실", nav_gallery:"갤러리", nav_reviews:"리뷰", nav_faq:"자주 묻는 질문", nav_contact:"문의하기", nav_book:"객실 예약",
    hero_eyebrow:"바히르다르 · 에티오피아", hero_h1:'따뜻한 환영<br><em>바히르다르의 중심에서.</em>',
    hero_lead:"바히르다르 경기장 근처 — 편안한 객실, 친절한 서비스, 도시 주요 명소로의 쉬운 접근.",
    hero_cta:"객실 예약하기", rooms_eyebrow:"객실 안내", rooms_h2:"객실을 선택하세요." }
};
var current = "en";
function applyLang(lang){
  if (!dict[lang]) return;
  document.querySelectorAll("[data-i18n]").forEach(function(el){
    var key = el.getAttribute("data-i18n");
    var val = dict[lang][key];
    if (val !== undefined) el.innerHTML = val;
  });
  document.documentElement.lang = lang;
  document.documentElement.dir = (lang === "ar") ? "rtl" : "ltr";
  current = lang;
}
document.addEventListener("DOMContentLoaded", function(){
  var sel = document.getElementById("langSelect");
  if (sel) sel.addEventListener("change", function(){ applyLang(this.value); });
});
})();
