import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { siApple, siGoogleplay } from 'simple-icons';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight,
  Check, ChevronDown, Download, Menu, Sparkles,
} from 'lucide-react';
import '@fontsource-variable/inter';
import './styles.css';
import './landing.css';
import Landing, { ProductMark } from './Landing.jsx';
import { MediaSlot } from './MediaSlot.jsx';

const links = {
  client: {
    apple: import.meta.env.VITE_CLIENT_APP_STORE_URL?.trim(),
    google: import.meta.env.VITE_CLIENT_GOOGLE_PLAY_URL?.trim(),
    apk: import.meta.env.VITE_CLIENT_APK_URL?.trim(),
  },
  driver: {
    apple: import.meta.env.VITE_DRIVER_APP_STORE_URL?.trim(),
    google: import.meta.env.VITE_DRIVER_GOOGLE_PLAY_URL?.trim(),
    apk: import.meta.env.VITE_DRIVER_APK_URL?.trim(),
  },
};

function useDownloads() {
  const [downloads, setDownloads] = useState({ client: { available: false }, driver: { available: false } });
  useEffect(() => {
    let active = true;
    fetch('/downloads/manifest.json')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data) setDownloads(data); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return downloads;
}

function Logo({ footer = false }) {
  return <a className="logo" href="/" aria-label="Atlas — на главную">
    <img src={footer ? '/images/atlas-chevron-supplied.png' : '/images/atlas-logo.png'} alt="Atlas" />
  </a>;
}

function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const mobileMenu = useRef(null);
  const productTrigger = useRef(null);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    const onPointer = (event) => {
      if (!event.target.closest('.site-header')) {
        setProductsOpen(false);
        if (mobileMenu.current) mobileMenu.current.open = false;
      }
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (mobileMenu.current?.open) {
        mobileMenu.current.open = false;
        mobileMenu.current.querySelector('summary')?.focus();
      }
      if (document.activeElement?.closest('#product-menu')) productTrigger.current?.focus();
      setProductsOpen(false);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('scroll', onScroll); document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, []);
  return <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
    <div className="container nav-shell">
      <Logo />
      <nav className="desktop-nav" aria-label="Основная навигация">
        <button ref={productTrigger} type="button" className={`nav-products${productsOpen ? ' is-open' : ''}`} aria-expanded={productsOpen} aria-controls="product-menu" onClick={() => setProductsOpen((value) => !value)}>Продукты <ChevronDown size={14} /></button>
        <a href="/#possibilities">Возможности</a>
        <a href="/drivers/">Водителям</a>
        <a href="/privacy/">Документы</a>
      </nav>
      <a className="nav-cta" href="/#download">Открыть Atlas <ArrowUpRight size={15} /></a>
      <details ref={mobileMenu} className="mobile-nav">
        <summary aria-label="Открыть меню"><Menu size={24} /></summary>
        <nav aria-label="Мобильная навигация" onClick={(event) => { if (event.target.closest('a')) event.currentTarget.closest('details')?.removeAttribute('open'); }}>
          <a href="/#possibilities">Возможности</a>
          <a href="/drivers/">Водителям</a>
          <a href="/#download">Скачать приложение</a>
          <a href="/privacy/">Конфиденциальность</a>
          <a href="/terms/">Условия использования</a>
        </nav>
      </details>
    </div>
    {productsOpen && <div id="product-menu" className="product-menu"><div className="product-menu-inner"><a href="/#download" onClick={() => setProductsOpen(false)}><ProductMark variant="client" /><span><strong>Atlas App</strong><small>Поездки, доставка и еда</small></span><ArrowUpRight size={17} /></a><a href="/drivers/" onClick={() => setProductsOpen(false)}><ProductMark variant="driver" /><span><strong>Atlas pro</strong><small>Приложение для водителей</small></span><ArrowUpRight size={17} /></a><a href="/#possibilities" onClick={() => setProductsOpen(false)}><span className="product-menu-art"><img src="/images/atlas-services.png" alt="" /></span><span><strong>Возможности</strong><small>Три сервиса в одном месте</small></span><ArrowUpRight size={17} /></a></div></div>}
  </header>;
}

function SiteFooter() {
  return <footer className="site-footer">
    <div className="container footer-grid">
      <div className="footer-brand">
        <Logo footer />
        <p>Город ближе, когда всё нужное рядом.</p>
      </div>
      <div><strong>Продукт</strong><a href="/#possibilities">Возможности</a><a href="/#download">Скачать Atlas</a><a href="/drivers/">Atlas pro для водителей</a></div>
      <div><strong>Документы</strong><a href="/privacy/">Политика конфиденциальности</a><a href="/terms/">Условия использования</a></div>
      <div className="footer-note"><span>Atlas · 2026</span><span>Сделано для движения по городу.</span></div>
    </div>
  </footer>;
}

function StoreButton({ href, icon, title, subtitle }) {
  const content = <><span className="store-icon">{icon}</span><span><small>{subtitle}</small><strong>{title}</strong></span>{href && <ArrowUpRight size={17} className="store-arrow" />}</>;
  return href
    ? <a className="store-button" href={href} target="_blank" rel="noopener noreferrer">{content}</a>
    : <div className="store-button store-unavailable" aria-label={`${title} — скоро`}><span className="store-icon">{icon}</span><span><small>Скоро в</small><strong>{title}</strong></span><span className="soon">Скоро</span></div>;
}

function BrandIcon({ brand }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d={brand.path} /></svg>;
}

function DownloadCard({ variant, downloads, compact = false }) {
  const isDriver = variant === 'driver';
  const info = downloads[variant] || { available: false };
  const config = links[variant];
  const apkUrl = config.apk || (info.available ? info.path : '');
  return <div className={`download-card ${compact ? 'download-compact' : ''}`}>
    <div className="download-card-top">
      <span className="app-icon"><ProductMark variant={variant} /></span>
      <span className="download-card-name"><strong>{isDriver ? 'Atlas pro' : 'Atlas'}</strong><small>{isDriver ? 'Для водителей' : 'Для пассажиров'}</small></span>
      {info.version && <span className="version">v{info.version}</span>}
    </div>
    <p>{isDriver ? 'Принимайте заказы и управляйте работой в одном приложении.' : 'Заказывайте поездки, доставку и любимую еду.'}</p>
    <div className="store-grid">
      <StoreButton href={config.apple} icon={<BrandIcon brand={siApple} />} title="App Store" subtitle="Загрузить в" />
      <StoreButton href={config.google} icon={<BrandIcon brand={siGoogleplay} />} title="Google Play" subtitle="Доступно в" />
    </div>
    {apkUrl
      ? <a className="apk-link" href={apkUrl} download={!config.apk ? `Atlas-${variant}-${info.version || 'latest'}.apk` : undefined}>
          <Download size={19} /> Скачать APK для Android <ArrowRight size={18} />
        </a>
      : <div className="apk-link apk-unavailable"><Download size={19} /> APK скоро будет доступен</div>}
    {info.available && !config.apk && <div className="apk-meta">
      <span>{(info.bytes / 1048576).toFixed(1)} МБ · версия {info.version}</span>
      <details><summary>Контрольная сумма SHA-256</summary><code>{info.sha256}</code></details>
    </div>}
  </div>;
}

function Drivers({ downloads }) {
  return <>
    <section className="subhero driver-subhero"><div className="container driver-subhero-grid"><div><a className="back-link" href="/"><ArrowLeft size={17} /> На главную</a><span className="eyebrow"><ProductMark variant="driver" small /> Atlas pro · водителям</span><h1>Работайте<br /><span>в своём ритме.</span></h1><p>Получайте предложения поездок и доставок, стройте маршрут и следите за балансом в отдельном приложении Atlas pro.</p><a className="button button-primary" href="#driver-download">Скачать Atlas pro <ArrowDown size={18} /></a></div><div className="driver-subhero-visual"><MediaSlot slot="driverPhone" className="driver-media-slot" /></div></div></section>
    <section className="section tutorial-section"><div className="container"><div className="section-heading"><span className="kicker">ИНСТРУКЦИЯ</span><h2>От установки<br />до первого заказа.</h2><p>Короткий путь для нового водителя Atlas pro.</p></div><div className="tutorial-grid">
      <article><span>01</span><img className="tutorial-art" src="/images/product-driver-roles.png" alt="" /><h3>Установите приложение</h3><p>Скачайте Atlas pro на Android. Если устанавливаете APK, откройте файл и разрешите установку для браузера или файлового менеджера.</p></article>
      <article><span>02</span><img className="tutorial-art" src="/images/product-driver-taxi.png" alt="" /><h3>Заполните заявку</h3><p>Войдите по номеру телефона и SMS-коду. Укажите данные о себе и транспорте, добавьте запрошенные фотографии и документы.</p></article>
      <article><span>03</span><img className="tutorial-art" src="/images/product-driver-cargo.png" alt="" /><h3>Дождитесь проверки</h3><p>Команда Atlas проверит заявку и назначит доступный класс автомобиля. До подтверждения выйти на линию нельзя.</p></article>
      <article><span>04</span><img className="tutorial-art" src="/images/product-driver-taxi.png" alt="" /><h3>Выходите на линию</h3><p>После подтверждения проверьте геолокацию, виды заказов и депозит. Переключите статус на «На линии», чтобы получать предложения.</p></article>
      <article><span>05</span><img className="tutorial-art" src="/images/product-driver-courier.png" alt="" /><h3>Выполняйте заказы</h3><p>Посмотрите маршрут и цену, примите заказ, затем отмечайте этапы: «Приехал», «Начать» и «Завершить».</p></article>
      <article className="tutorial-help"><span>?</span><ProductMark variant="driver" /><h3>Если что-то не получается</h3><p>Проверьте связь, доступ к геолокации и статус заявки. В приложении откройте раздел «Поддержка».</p></article>
    </div></div></section>
    <section id="driver-download" className="section driver-download-section"><div className="container driver-download-grid"><div><span className="kicker">НАЧНИТЕ С ATLAS PRO</span><h2>Ваш следующий заказ начинается здесь.</h2><p>Выберите доступный способ установки. Ссылки на магазины появятся после публикации приложения.</p></div><DownloadCard variant="driver" downloads={downloads} compact /></div></section>
  </>;
}

const privacySections = [
  { title: '1. Кто обрабатывает данные', body: <>Оператор сервиса Atlas и Atlas pro: <b>[указать официальное наименование, адрес и регистрационные данные]</b>. Контакт по вопросам персональных данных: <b>[указать email]</b>. Эта политика относится к сайту и мобильным приложениям Atlas и Atlas pro.</> },
  { title: '2. Какие данные используются', body: <>Для аккаунта мы обрабатываем номер телефона, имя, настройки и данные авторизации. Для заказов — адреса и маршрут, геолокацию при предоставленном доступе, тариф, стоимость, историю заказов, сообщения и обращения в поддержку. Если вы заказываете поездку другому человеку, могут обрабатываться его имя и номер телефона. Для водителей также нужны сведения о транспорте, фотографии и документы, данные заявки, координаты при работе на линии и во время активной поездки, операции и баланс. Приложения могут обрабатывать технические данные устройства и push-токен для уведомлений.</> },
  { title: '3. Зачем нужны данные', body: <>Данные нужны для входа в аккаунт, расчёта и выполнения заказов, связи между участниками заказа, проверки водителей, навигации, уведомлений, поддержки, предотвращения злоупотреблений и выполнения обязательных требований законодательства. Геолокация используется для выбора адреса и работы поездок; в Atlas pro фоновый доступ может использоваться для активной поездки, если водитель предоставил соответствующее системное разрешение.</> },
  { title: '4. Кому данные могут передаваться', body: <>Информация, необходимая для заказа, доступна его участникам: пассажиру, назначенному водителю или исполнителю, а при доставке еды — ресторану. Для работы сервиса могут привлекаться поставщики инфраструктуры, карт, SMS и push-уведомлений. Данные также могут передаваться по законному требованию уполномоченных органов. <b>[уточнить фактических поставщиков и страны обработки до публикации]</b>.</> },
  { title: '5. Хранение и защита', body: <>Данные хранятся в течение срока, необходимого для работы сервиса, выполнения обязательств и разрешения обращений, а затем удаляются или обезличиваются, если дальнейшее хранение не требуется законом. Доступ к данным ограничивается по ролям; применяются технические и организационные меры защиты. <b>[указать конкретные сроки хранения по категориям данных]</b>.</> },
  { title: '6. Ваши права и выбор', body: <>Вы можете изменять доступ приложения к геолокации, камере, контактам и уведомлениям в настройках устройства. Для запроса доступа, исправления или удаления данных и аккаунта свяжитесь с оператором: <b>[указать email и порядок обработки запросов]</b>. Некоторые сведения могут сохраняться, когда этого требует закон или необходимо для разрешения спора.</> },
  { title: '7. Сайт и обновления политики', body: <>Этот сайт не использует рекламные трекеры или аналитические cookie. Если такие инструменты появятся, политика будет обновлена. Новая редакция публикуется на этой странице с датой вступления в силу. <b>[указать дату публикации и версию политики]</b>.</> },
];

const termsSections = [
  { title: '1. Стороны и область действия', body: <>Эти условия регулируют использование сайта и приложений Atlas и Atlas pro. Оператор сервиса: <b>[указать официальное наименование и реквизиты]</b>. Используя приложение, пользователь подтверждает ознакомление с действующей редакцией условий. Отдельные правила для водителей и партнёров могут оформляться дополнительными соглашениями.</> },
  { title: '2. Аккаунт и доступ', body: <>Для работы с приложением нужен номер телефона и подтверждение кодом. Пользователь отвечает за актуальность введённых сведений и сохранность доступа к своему устройству. Atlas предназначен для заказа услуг, Atlas pro — для зарегистрированных водителей и исполнителей. Оператор вправе ограничить доступ при нарушении условий или требованиях безопасности.</> },
  { title: '3. Заказы и оплата', body: <>Пассажир выбирает маршрут, услугу и доступный тариф. Предварительная стоимость показывается до подтверждения заказа; фактические условия заказа отображаются в приложении. Сейчас оплата поездок и доставок производится наличными в кыргызских сомах. Отмена и изменение заказа обрабатываются по правилам, показанным в приложении. <b>[уточнить комиссии, возвраты и спорные случаи до публикации]</b>.</> },
  { title: '4. Условия для водителей', body: <>Водитель подаёт заявку и предоставляет достоверные сведения о себе, документах и транспорте. Выход на линию возможен только после проверки и подтверждения оператором, при выполнении требований приложения к геолокации, видам заказов и депозиту. Водитель самостоятельно отвечает за законность перевозки, состояние транспорта и соблюдение правил дорожного движения. <b>[добавить полные условия сотрудничества и комиссий]</b>.</> },
  { title: '5. Допустимое использование', body: <>Запрещено использовать сервис для незаконных заказов, обмана, угроз, передачи чужих данных без основания, попыток вмешательства в работу приложения или обхода ограничений доступа. Пользователь должен соблюдать применимое законодательство и уважать других участников сервиса.</> },
  { title: '6. Работа сервиса и ответственность', body: <>Оператор стремится поддерживать доступность сервиса, но работа приложения зависит от связи, картографических и других внешних сервисов. При проблеме с заказом обратитесь в поддержку через приложение. Пределы ответственности сторон определяются применимым законодательством и окончательной редакцией соглашений. <b>[уточнить юрисдикцию и порядок разрешения споров]</b>.</> },
  { title: '7. Изменения и контакты', body: <>Актуальная редакция условий размещается на этой странице. Существенные изменения доводятся до пользователей доступными средствами. Вопросы по условиям: <b>[указать контактный email]</b>. <b>[указать дату вступления в силу]</b>.</> },
];

function LegalPage({ kind }) {
  const isPrivacy = kind === 'privacy';
  const title = isPrivacy ? 'Политика конфиденциальности' : 'Условия использования';
  const sections = isPrivacy ? privacySections : termsSections;
  return <section className="legal-page"><div className="container legal-container"><a className="back-link" href="/"><ArrowLeft size={17} /> На главную</a><div className="legal-head"><span className="kicker">ДОКУМЕНТЫ ATLAS</span><h1>{title}</h1><p>Для приложений Atlas и Atlas pro · Проект редакции</p></div><div className="draft-notice"><Sparkles size={20} /><div><strong>Документ подготовлен к заполнению</strong><p>Перед публикацией сервиса замените выделенные поля на данные оператора, контакт, сроки хранения и окончательные условия. Текст должен быть проверен с учётом фактической работы сервиса.</p></div></div><div className="legal-layout"><aside><strong>На этой странице</strong>{sections.map((section, index) => <a key={section.title} href={`#section-${index + 1}`}>{section.title.replace(/^\d+\. /, '')}</a>)}</aside><div className="legal-body">{sections.map((section, index) => <section id={`section-${index + 1}`} key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}<div className="legal-end"><Check size={18} /> Последнее обновление: после утверждения документа</div></div></div></div></section>;
}

function App() {
  const downloads = useDownloads();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  let content = <Landing downloads={downloads} DownloadCard={DownloadCard} />;
  if (path === '/drivers') content = <Drivers downloads={downloads} />;
  if (path === '/privacy') content = <LegalPage kind="privacy" />;
  if (path === '/terms') content = <LegalPage kind="terms" />;
  return <><SiteHeader /><main className={path === '/' ? 'site-main' : 'site-main subpage-main'}>{content}</main><SiteFooter /></>;
}

createRoot(document.getElementById('root')).render(<App />);
