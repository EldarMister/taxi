import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown, Download } from 'lucide-react';
import { MediaSlot } from './MediaSlot.jsx';

export function ProductMark({ variant = 'brand', small = false }) {
  const sources = { brand: '/images/atlas-brand-original.png', client: '/images/atlas-client-original.png', driver: '/images/atlas-pro-original.png', chevron: '/images/atlas-chevron-supplied.png' };
  return <span className={`product-mark product-mark-${variant}${small ? ' product-mark-small' : ''}`} aria-hidden="true"><img src={sources[variant]} alt="" /></span>;
}

const services = [
  { id: 'ride', name: 'Поездки', detail: 'По вашему маршруту', title: 'Туда, где вас ждут.', copy: 'Укажите адрес и выберите тариф. Маршрут и стоимость будут видны до заказа.' },
  { id: 'cargo', name: 'Доставка', detail: 'От посылки до переезда', title: 'Важное — в пути.', copy: 'Отправляйте посылки и крупные грузы. Выберите подходящий автомобиль в Atlas.' },
  { id: 'food', name: 'Еда', detail: 'Любимые места рядом', title: 'Хороший день начинается со вкуса.', copy: 'Выбирайте ресторан, собирайте заказ и следите за его статусом в приложении.' },
];

function useReveal(root) {
  useEffect(() => {
    const nodes = [...root.current.querySelectorAll('[data-reveal]')];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
    nodes.forEach((node) => { node.classList.add('reveal-ready'); observer.observe(node); });
    const onPreference = () => { if (reduced.matches) nodes.forEach((node) => node.classList.add('is-visible')); };
    reduced.addEventListener('change', onPreference);
    return () => { observer.disconnect(); reduced.removeEventListener('change', onPreference); };
  }, [root]);
}

function HeroWords({ text }) {
  return text.split(' ').map((word, index) => <React.Fragment key={`${index}-${word}`}><span className="l-word"><span style={{ animationDelay: `${120 + index * 55}ms` }}>{word}</span></span>{' '}</React.Fragment>);
}

function Device({ slot, position }) {
  return <div className={`l-device l-device-${position}`}><MediaSlot slot={slot} /></div>;
}

function Services({ active, setActive }) {
  return <section className="l-services l-panel" id="possibilities">
    <div className="l-section-heading" data-reveal><span className="l-product-label"><ProductMark variant="chevron" /> Возможности Atlas</span><h2>Три сервиса.<br /><span>Один Atlas.</span></h2><p>Поездки, доставка и еда. Выбирайте нужное —<br className="l-desktop-break" /> остальное уже есть в Atlas.</p></div>
    <div className="l-service-stage">
      <div className="l-service-art"><img src="/images/atlas-services.png" alt="Поездки, посылки и еда — три возможности Atlas" loading="lazy" width="1536" height="1024" /></div>
      <div className="l-service-caption" aria-live="polite" aria-atomic="true"><div className="l-service-copy" key={services[active].id}><span>0{active + 1} / 03</span><h3>{services[active].title}</h3><p>{services[active].copy}</p></div><a href="#download">Попробовать Atlas <ArrowUpRight size={16} /></a></div>
    </div>
    <div className="l-service-options" aria-label="Выберите сервис Atlas">{services.map((service, index) => <button type="button" key={service.id} className={index === active ? 'is-active' : ''} aria-pressed={index === active} onClick={() => setActive(index)}><span className="l-service-option-copy"><strong>{service.name}</strong><small>{service.detail}</small></span><ArrowUpRight size={18} /></button>)}</div>
  </section>;
}

export default function Landing({ downloads, DownloadCard }) {
  const root = useRef(null);
  const [activeService, setActiveService] = useState(0);
  useReveal(root);
  return <div className="landing" ref={root}>
    <section className="l-hero l-panel">
      <div className="l-hero-copy"><span className="l-product-label l-intro-badge"><ProductMark variant="chevron" /> Atlas App</span><h1><HeroWords text="Весь город в одном Atlas." /></h1><p className="l-intro-description">Поездки, доставка и любимая еда — в одном приложении.</p><div className="l-actions l-intro-actions"><a className="l-button l-button-primary" href="#download"><Download size={19} strokeWidth={1.8} /> Скачать Atlas</a><a className="l-button l-button-soft" href="#possibilities">Узнать больше</a></div></div>
      <div className="l-devices" aria-label="Скриншоты приложения Atlas"><Device slot="clientRide" position="left" /><Device slot="clientHome" position="center" /><Device slot="clientFood" position="right" /></div>
    </section>

    <section className="l-overview l-panel"><div className="l-container"><h2 data-reveal>Один Atlas. Всё нужное рядом.</h2><div className="l-overview-grid">{services.map((service, index) => <a href="#possibilities" key={service.id} onClick={() => setActiveService(index)}><strong>{service.name}</strong><span>{service.detail}</span></a>)}</div><div className="l-overview-note" data-reveal><p>Для тех, кто едет. И тех, кто везёт.</p><span>Atlas для пассажиров и Atlas pro для водителей.</span><a href="#download" className="l-button l-button-ink">Выбрать приложение <ArrowRight size={16} /></a></div></div></section>

    <section className="l-pro l-panel" id="atlas-pro"><div className="l-container">
      <div className="l-section-heading" data-reveal><span className="l-product-label"><ProductMark variant="chevron" /> Atlas pro</span><h2>На линии.<br /><span>В своём ритме.</span></h2><p>Приложение для водителей, в котором всё важное<br className="l-desktop-break" /> собрано вокруг вашей работы.</p><div className="l-actions"><a href="/drivers/" className="l-button l-button-white">Начать работу</a><a href="/drivers/#driver-download" className="l-button l-button-dark">Скачать Atlas pro</a></div></div>
      <div className="l-pro-preview"><MediaSlot slot="driverPreview" /></div>
      <div className="l-pro-summary" data-reveal><div><h3>От первого заказа.<br />До новых возможностей.</h3><p>Один понятный путь для каждого заказа —<br />от выхода на линию до завершения поездки.</p></div><a href="/drivers/" className="l-button l-button-dark">Инструкция <ArrowUpRight size={16} /></a></div>
      <div className="l-pro-features"><article><span>На линии</span><h3>Заказы рядом</h3><p>Предложения поездок и доставок приходят в Atlas pro, пока вы на линии.</p><div className="l-feature-tags"><span><ProductMark small variant="chevron" /> Atlas pro</span><span>Поездки</span><span>Доставка</span></div></article><article><span>В пути</span><h3>Всё по маршруту</h3><p>Откройте маршрут, отметьте подачу и ведите заказ до завершения поездки.</p><div className="l-feature-tags"><span>Подача</span><span>В пути</span><span>Завершение</span></div></article><article><span>После поездки</span><h3>Работа в деталях</h3><p>Возвращайтесь к завершённым заказам и следите за изменениями баланса.</p><div className="l-feature-tags"><span>История заказов</span><span>Баланс</span></div></article></div>
    </div></section>

    <Services active={activeService} setActive={setActiveService} />

    <section className="l-download" id="download"><div className="l-container"><div className="l-section-heading" data-reveal><span className="l-product-label"><ProductMark /> Приложения Atlas</span><h2>Начните с Atlas.</h2><p>Выберите приложение и удобный способ установки.</p></div><div className="download-grid"><DownloadCard variant="client" downloads={downloads} /><DownloadCard variant="driver" downloads={downloads} /></div><p className="l-download-note">App Store и Google Play появятся после публикации.<br />Доступные APK можно установить напрямую на Android.</p></div></section>

    <section className="l-faq"><div className="l-container l-faq-grid"><div data-reveal><h2>Вопросы?<br /><span>Разберёмся.</span></h2><a href="/drivers/">Руководство для водителей <ArrowUpRight size={16} /></a></div><div className="faq-list"><details><summary>Какое приложение мне нужно? <ChevronDown size={18} /></summary><p>Atlas — для поездок, доставки и еды. Atlas pro — для водителей и исполнителей, которые принимают заказы.</p></details><details><summary>Как установить APK? <ChevronDown size={18} /></summary><p>Скачайте файл на Android, откройте его и разрешите установку для выбранного браузера или файлового менеджера, если телефон запросит это.</p></details><details><summary>Как начать работать водителем? <ChevronDown size={18} /></summary><p>Установите Atlas pro, войдите по номеру телефона, заполните заявку и дождитесь проверки. Все шаги описаны в руководстве для водителей.</p></details><details><summary>Где прочитать правила сервиса? <ChevronDown size={18} /></summary><p><a href="/privacy/">Политика конфиденциальности</a> и <a href="/terms/">условия использования</a> доступны на отдельных страницах сайта.</p></details></div></div></section>
  </div>;
}
