import React, { PropsWithChildren, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { api } from './api';
import { appVariant } from './appVariant';
import { shortAddress } from './address';
import type { Language, Order, User } from './types';
import { useTheme } from './design/theme';

export { shortAddress } from './address';

export const colors = { blue: '#087FFF', blueDark: '#0067D9', ink: '#101D38', muted: '#7A8CA8', pale: '#F1F7FD', line: '#E5EDF6', green: '#19B66A', white: '#FFFFFF', danger: '#CA4149' };
export const tr = (language: Language) => (text: string) => language === 'ky' ? (ky[text] || text) : text;
const ky: Record<string, string> = {
  "Куда едем?": "Кайда барабыз?",
  "Такси": "Такси",
  "Место подачи": "Унаа келчү жер",
  "Укажите место подачи": "Унаа келчү жерди көрсөтүңүз",
  "Укажите адрес или включите GPS": "Даректи көрсөтүңүз же GPS күйгүзүңүз",
  "Ваш адрес": "Сиздин дарек",
  "Выберите место подачи": "Унаа келчү жерди тандаңыз",
  "Считаем стоимость…": "Баасын эсептеп жатабыз…",
  "Считаем…": "Эсептеп жатабыз…",
  "Повторим автоматически": "Автоматтык түрдө кайра аракет кылабыз",
  "Обновляем цену…": "Бааны жаңылап жатабыз…",
  "Загружаем тарифы…": "Тарифтер жүктөлүүдө…",
  "Выберите тариф": "Тарифти тандаңыз",
  "Подъезд": "Кире бериш",
  "Укажите номер подъезда": "Кире бериштин номерин көрсөтүңүз",
  "Пожелания к поездке": "Сапар боюнча каалоолор",
  "С питомцем": "Үй жаныбары менен",
  "Перевозку питомца согласуйте с водителем.": "Үй жаныбарын ташууну айдоочу менен макулдашыңыз.",
  "Заказ другому человеку": "Башка адамга буюртма",
  "Имя и телефон пассажира для водителя": "Айдоочу үчүн жүргүнчүнүн аты жана телефону",
  "Водитель увидит имя и телефон этого пассажира": "Айдоочу бул жүргүнчүнүн атын жана телефонун көрөт",
  "Имя пассажира": "Жүргүнчүнүн аты",
  "Телефон пассажира": "Жүргүнчүнүн телефону",
  "Выбрать из контактов": "Байланыштардан тандоо",
  "Убрать пассажира": "Жүргүнчүнү алып салуу",
  "Укажите имя и номер телефона пассажира": "Жүргүнчүнүн атын жана телефон номерин көрсөтүңүз",
  "Контакты на этом устройстве недоступны": "Бул түзмөктө байланыштар жеткиликсиз",
  "Разрешите доступ к контактам в настройках телефона": "Телефондун жөндөөлөрүнөн байланыштарга уруксат бериңиз",
  "У выбранного контакта нет номера телефона": "Тандалган байланышта телефон номери жок",
  "Не удалось открыть контакты": "Байланыштарды ачуу мүмкүн болгон жок",
  "Чат с заказчиком": "Буюртма берген адам менен чат",
  "Например, 2": "Мисалы, 2",
  "Напишите здесь": "Бул жерге жазыңыз",
  "Изменить место подачи": "Унаа келчү жерди өзгөртүү",
  "Изменить пункт назначения": "Бара турган жерди өзгөртүү",
  "Точка посадки": "Отуруучу жер",
  "Пункт назначения": "Бара турган жер",
  "Откуда поедем?": "Кайдан жөнөйбүз?",
  "Карта": "Карта",
  "Ваше местоположение": "Сиздин жайгашкан жериңиз",
  "Определим по GPS": "GPS аркылуу аныктайбыз",
  "Разрешите доступ к геолокации": "Жайгашкан жерге кирүүгө уруксат бериңиз",
  "Так мы быстрее найдём место подачи и покажем вашу точку на карте. Геолокация используется только во время работы приложения.": "Ошентип унаа келчү жерди тезирээк таап, картадан жайгашкан жериңизди көрсөтөбүз. Геолокация тиркеме иштеп турганда гана колдонулат.",
  "Так вы сможете быстро увидеть своё положение на карте. Геолокация используется только во время работы приложения.": "Ошентип картадан жайгашкан жериңизди тез көрө аласыз. Геолокация тиркеме иштеп турганда гана колдонулат.",
  "Не пропустите важное": "Маанилүү билдирүүлөрдү өткөрүп жибербеңиз",
  "Сообщим, когда водитель назначен, приехал, написал вам и завершил поездку.": "Айдоочу дайындалганда, келгенде, сизге жазганда жана сапарды аяктаганда билдиребиз.",
  "Сообщим о новом заказе, сообщении пассажира, когда пассажир выходит, и о завершении поездки.": "Жаңы буюртма, жүргүнчүнүн билдирүүсү, жүргүнчү чыгып жатканы жана сапардын аякташы жөнүндө билдиребиз.",
  "Разрешить доступ": "Уруксат берүү",
  "Включить уведомления": "Билдирүүлөрдү күйгүзүү",
  "Указать адрес вручную": "Даректи кол менен көрсөтүү",
  "Не сейчас": "Азыр эмес",
  "Открыть настройки": "Жөндөөлөрдү ачуу",
  "Разрешение телефона выключено": "Телефондогу уруксат өчүрүлгөн",
  "Разрешите уведомления, чтобы не пропустить события поездки.": "Сапардагы окуяларды өткөрүп жибербөө үчүн билдирүүлөргө уруксат бериңиз.",
  "Разрешите уведомления в настройках устройства.": "Түзмөктүн жөндөөлөрүнөн билдирүүлөргө уруксат бериңиз.",
  "Разрешите доступ к местоположению в настройках устройства.": "Түзмөктүн жөндөөлөрүнөн жайгашкан жерге кирүүгө уруксат бериңиз.",
  "Разрешите доступ к местоположению или выберите адрес вручную.": "Жайгашкан жерге кирүүгө уруксат бериңиз же даректи кол менен тандаңыз.",
  "Включите геолокацию в настройках устройства.": "Түзмөктүн жөндөөлөрүнөн геолокацияны күйгүзүңүз.",
  "Не удалось определить местоположение. Попробуйте ещё раз или выберите адрес вручную.": "Жайгашкан жерди аныктоо мүмкүн болгон жок. Кайра аракет кылыңыз же даректи кол менен тандаңыз.",
  "Шаг 1 из 2": "2 кадамдын 1-кадамы",
  "Шаг 2 из 2": "2 кадамдын 2-кадамы",
  "Ищем адреса…": "Даректерди издеп жатабыз…",
  "Повторить поиск": "Кайра издөө",
  "Куда отправимся?": "Кайда жөнөйбүз?",
  "Введите улицу, номер дома или название места.": "Көчөнү, үйдүн номерин же жердин атын жазыңыз.",
  "Стоимость устарела. Обновите расчёт.": "Баанын мөөнөтү бүттү. Кайра эсептеңиз.",
  'Поменять адреса местами': 'Даректерди алмаштыруу', 'Очистить адрес': 'Даректи тазалоо',
  'Сервер вернул некорректный ответ. Попробуйте ещё раз.': 'Сервер туура эмес жооп берди. Кайра аракет кылыңыз.',
  'Сервер долго не отвечает. Повторите попытку через несколько секунд.': 'Сервер көпкө жооп бербей жатат. Бир нече секунддан кийин кайра аракет кылыңыз.',
  'Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.': 'Серверге туташуу мүмкүн болгон жок. Интернетти текшерип, кайра аракет кылыңыз.',
  'Меню': 'Меню', 'Оценка': 'Баа', 'Повторить подключение': 'Кайра туташуу', 'Выйти из аккаунта': 'Аккаунттан чыгуу',
  'Расчёт устарел. Рассчитайте стоимость ещё раз.': 'Эсептин мөөнөтү бүттү. Баасын кайра эсептеңиз.',
  'Нет связи. Проверьте интернет · Повторить': 'Байланыш жок. Интернетти текшериңиз · Кайталоо',
  'Восстанавливаем соединение…': 'Байланышты калыбына келтирип жатабыз…',
  'Диспетчер проверит профиль и автомобиль. После подтверждения здесь появятся заказы.': 'Диспетчер профилди жана унааны текшерет. Ырасталгандан кийин бул жерде буюртмалар пайда болот.',
  'Предложения появятся, когда рядом будет пассажир.': 'Жакын жерде жүргүнчү болгондо сунуштар пайда болот.',
  'Включите режим на линии, чтобы получать доступные заказы.': 'Жеткиликтүү буюртмаларды алуу үчүн линияга чыгыңыз.',
  'Комфортные поездки': 'Ыңгайлуу сапарлар', 'за поездку': 'сапар үчүн', 'минимум': 'эң аз', 'от': 'баштап', 'каждый день': 'күн сайын',
  'Тарифы пока недоступны': 'Тарифтер азырынча жеткиликтүү эмес',
  'Development: тестовый маршрут. Проверьте боевой ключ маршрутизации перед реальными поездками.': 'Development: сыноо багыты. Чыныгы сапарлардан мурун багыт түзүү ачкычын текшериңиз.',
  'Номер клиента': 'Кардардын номери', 'Номер водителя': 'Айдоочунун номери',
  'SMS подтверждает ваш номер. Данные поездки доступны только вам и назначенному водителю.': 'SMS номериңизди ырастайт. Сапардын маалыматы сизге жана дайындалган айдоочуга гана жеткиликтүү.',
  'Политика конфиденциальности': 'Купуялык саясаты',
  'Следуйте к пассажиру': 'Жүргүнчүгө барыңыз', 'Ожидайте пассажира': 'Жүргүнчүнү күтүңүз',
  'Взять заказ': 'Буюртманы алуу',
  'Свернуть детали поездки': 'Сапардын чоо-жайын жыйноо',
  'Раскрыть детали поездки': 'Сапардын чоо-жайын ачуу',
  'Проведите вправо': 'Оңго сүрүңүз',
  'Сейчас нет свободных водителей. Попробуйте ещё раз.': 'Азыр бош айдоочулар жок. Кайра аракет кылыңыз.',
  'Вы можете оформить новую поездку.': 'Жаңы сапарга буюртма берсеңиз болот.',
  'Предлагаем заказ свободным водителям': 'Буюртманы бош айдоочуларга сунуштап жатабыз',
  'завершённых поездок за период': 'бул мезгилде аяктаган сапар',
  'Пополнение через администратора. Комиссия списывается после завершения поездки.': 'Депозит администратор аркылуу толтурулат. Комиссия сапар аяктагандан кийин алынат.',
  'Наличные вы получаете от пассажиров. Они не зачисляются на депозит.': 'Накталай акчаны жүргүнчүлөрдөн аласыз. Ал депозитке кошулбайт.',
  'Комиссия за поездку': 'Сапар үчүн комиссия', 'Пополнение депозита': 'Депозитти толуктоо', 'Остаток': 'Калдык', 'Остаток:': 'Калдык:',
  'Все поездки оплачиваются наличными в сомах после завершения. Стоимость фиксируется перед заказом.': 'Бардык сапарлар аяктагандан кийин сом менен накталай төлөнөт. Баасы буюртма бергенге чейин белгиленет.',
  'Если возникла проблема с поездкой, сообщите время заказа и номер телефона аккаунта.': 'Сапарда көйгөй жаралса, буюртманын убактысын жана аккаунттун телефон номерин билдириңиз.',
  'Контакт поддержки пока не настроен. Обратитесь к диспетчеру сервиса.': 'Колдоо кызматынын байланышы азырынча көрсөтүлгөн эмес. Кызматтын диспетчерине кайрылыңыз.',
  'Карты — OpenStreetMap, маршруты — OSRM.': 'Карталар — OpenStreetMap, маршруттар — OSRM.',
  '© Участники OpenStreetMap ↗': 'Яндекс Карталарын колдонуу шарттары ↗', 'Политика конфиденциальности ↗': 'Купуялык саясаты ↗',
  'Development: адреса из тестового каталога сервера. Для поиска любых адресов требуется ключ Яндекс.': 'Development: сервердин сыноо каталогундагы даректер. Бардык даректерди издөө үчүн Яндекс ачкычы керек.',
  'Адрес не найден': 'Дарек табылган жок', 'Уточните название улицы или выберите точку на карте.': 'Көчөнүн атын тактаңыз же картадан чекит тандаңыз.',
  'Отправить сообщение': 'Билдирүү жөнөтүү', 'Развернуть или свернуть панель': 'Панелди ачуу же жыйноо',
  'Нет связи с сервером. Проверьте интернет и повторите попытку.': 'Сервер менен байланыш жок. Интернетти текшерип, кайра аракет кылыңыз.',
  'Не удалось выполнить действие. Попробуйте ещё раз.': 'Аракет аткарылган жок. Кайра аракет кылыңыз.',
  'Войдите в аккаунт заново.': 'Аккаунтка кайра кириңиз.', 'Сессия завершена.': 'Сессия аяктады.',
  'Фотография профиля': 'Профилдин сүрөтү', 'Выбрать фото': 'Сүрөт тандоо', 'Изменить фото': 'Сүрөттү өзгөртүү',
  'Выберите квадратную область фотографии.': 'Сүрөттүн чарчы бөлүгүн тандаңыз.',
  'Выберите изображение JPG, PNG или WEBP.': 'JPG, PNG же WEBP сүрөтүн тандаңыз.',
  'Файл фотографии должен быть не больше 5 МБ.': 'Сүрөт файлы 5 МБдан ашпашы керек.',
  'Вход в приложение': 'Тиркемеге кирүү', 'Быстрые и безопасные поездки\nвсегда рядом': 'Тез жана коопсуз сапарлар\nдайыма жаныңызда', 'Номер телефона': 'Телефон номери', 'Код из SMS': 'SMS коду', 'Отправить код': 'Код жөнөтүү', 'Отправить ещё раз': 'Кайра жөнөтүү', 'Продолжить': 'Улантуу', 'Откуда': 'Кайдан', 'Куда': 'Кайда', 'Моё местоположение': 'Менин жайгашкан жерим', 'Найти адрес': 'Даректи табуу', 'Выбрать на карте': 'Картадан тандоо', 'Выберите точку на карте': 'Картадан чекит тандаңыз', 'Тариф': 'Тариф', 'Наличные': 'Накталай', 'Оплата водителю': 'Айдоочуга төлөө', 'Заказать': 'Буюртма берүү', 'Комментарий водителю': 'Айдоочуга комментарий', 'Рассчитать стоимость': 'Баасын эсептөө', 'Выберите маршрут': 'Багыт тандаңыз', 'Ищем водителя': 'Айдоочуну издеп жатабыз', 'Водитель выехал к вам': 'Айдоочу сизге келе жатат', 'Водитель приехал': 'Айдоочу келди', 'Поездка началась': 'Сапар башталды', 'Заказ успешно выполнен': 'Буюртма ийгиликтүү аткарылды', 'Водитель не найден': 'Айдоочу табылган жок', 'Заказ отменён': 'Буюртма жокко чыгарылды', 'Отменить заказ': 'Буюртманы жокко чыгаруу', 'Я выхожу': 'Мен чыгып жатам', 'Позвонить': 'Чалуу', 'Чат': 'Чат', 'Готово': 'Даяр', 'Оцените поездку': 'Сапарды баалаңыз', 'Спасибо, что выбрали Atlas': 'Atlasты тандаганыңыз үчүн рахмат', 'Заказать снова': 'Кайра буюртма берүү', 'На линии': 'Линияда', 'Не на линии': 'Линияда эмес', 'Новый заказ': 'Жаңы буюртма', 'Принять': 'Кабыл алуу', 'Пропустить': 'Өткөрүп жиберүү', 'Приехал': 'Келдим', 'Начать поездку': 'Сапарды баштоо', 'Завершить поездку': 'Сапарды бүтүрүү', 'Профиль': 'Профиль', 'История поездок': 'Сапарлар тарыхы', 'История заказов': 'Буюртмалар тарыхы', 'История': 'Тарых', 'Настройки': 'Жөндөөлөр', 'Поддержка': 'Колдоо', 'Способы оплаты': 'Төлөм ыкмалары', 'Выйти': 'Чыгуу', 'Баланс': 'Баланс', 'Сегодня': 'Бүгүн', 'Неделя': 'Жума', 'Все': 'Баары', 'Сохранить': 'Сактоо', 'Имя': 'Аты', 'Фотография — ссылка HTTPS': 'Сүрөт — HTTPS шилтеме', 'Уведомления': 'Билдирүүлөр', 'Язык интерфейса': 'Тиркеменин тили', 'Русский': 'Орусча', 'Кыргызский': 'Кыргызча', 'Новых заказов пока нет': 'Азырынча жаңы буюртмалар жок', 'Вы не на линии': 'Сиз линияда эмессиз', 'Выйти на линию': 'Линияга чыгуу', 'Ожидаем подтверждение': 'Ырастоону күтүп жатабыз', 'Депозит для комиссии': 'Комиссия үчүн депозит', 'Доход наличными': 'Накталай киреше', 'Комиссия сервиса': 'Кызматтын комиссиясы', 'История операций': 'Операциялар тарыхы', 'Поездок пока нет': 'Азырынча сапарлар жок', 'Операций пока нет': 'Азырынча операциялар жок', 'Обновить': 'Жаңыртуу', 'Завершён': 'Бүттү', 'Отменён': 'Жокко чыгарылды', 'В пути': 'Жолдо', 'Поиск': 'Издөө', 'Ожидание': 'Күтүү', 'Найден': 'Табылды', 'Нет водителя': 'Айдоочу жок', 'До клиента': 'Кардарга чейин', 'Расстояние': 'Аралык', 'Стоимость': 'Баасы', 'Ваше сообщение': 'Билдирүүңүз', 'Напишите первое сообщение': 'Биринчи билдирүүнү жазыңыз', 'Пассажир': 'Жүргүнчү', 'Водитель': 'Айдоочу', 'Закрыть': 'Жабуу', 'Назад': 'Артка', 'Детали поездки': 'Сапардын чоо-жайы', 'Подтверждён': 'Ырасталган', 'Подключаемся…': 'Туташып жатабыз…', 'Маршрут поездки': 'Сапардын багыты', 'Уже отправлено': 'Жөнөтүлдү', 'Пассажир выходит': 'Жүргүнчү чыгып жатат', 'Новый расчёт': 'Жаңы эсеп', 'Платёж': 'Төлөм', 'Автомобиль': 'Унаа', 'Рейтинг': 'Рейтинг', 'Пока нет оценок': 'Азырынча баа жок',
  'Близкая подача': 'Жакын келүү', 'Средняя подача': 'Орточо келүү', 'Дальняя подача': 'Алыс келүү',
  'Подача рассчитывается': 'Келүү жолу эсептелүүдө', 'До клиента · расстояние и время по дороге': 'Кардарга чейинки жол жана убакыт',
  'Время поездки': 'Сапардын убактысы', 'Оцените пассажира': 'Жүргүнчүнү баалаңыз', 'Оценить клиента': 'Кардарды баалоо',
  'Ваш водитель': 'Сиздин айдоочу', 'Информация о поездке': 'Сапар тууралуу маалымат',
  'Дата': 'Күнү', 'Время заказа': 'Буюртма убактысы', 'Время завершения': 'Аяктаган убактысы',
  'Расчётное время в пути': 'Болжолдуу жол убактысы', 'Статус': 'Абалы',
  'Оплата': 'Төлөм', 'Стоимость поездки': 'Сапардын баасы', 'Предварительная стоимость': 'Болжолдуу баасы',
  'Способ оплаты': 'Төлөө ыкмасы', 'Итого': 'Жыйынтык', 'Оплата не проводилась': 'Төлөм жүргүзүлгөн жок',
  'Ваша оценка': 'Сиздин бааңыз', 'Комментарий': 'Комментарий', 'Поездка не найдена': 'Сапар табылган жок',
  'Не удалось позвонить': 'Чалуу мүмкүн болгон жок',
};
export const money = (value: number) => `${Number(value).toLocaleString('ru-RU')} сом`;
export const km = (meters: number) => Number(meters) < 1000
  ? `${Math.round(Number(meters))} м`
  : `${(Number(meters) / 1000).toFixed(1).replace('.', ',')} км`;
export const mins = (seconds: number, language: Language = 'ru') => `${Math.max(1, Math.round(Number(seconds) / 60))} ${language === 'ky' ? 'мүн' : 'мин'}`;
export const tripTime = (seconds: number, language: Language = 'ru') => {
  const totalMinutes = Math.max(1, Math.round(Number(seconds) / 60));
  if (totalMinutes < 60) return `${totalMinutes} ${language === 'ky' ? 'мүн' : 'мин'}`;
  const hours = Math.floor(totalMinutes / 60), minutes = totalMinutes % 60;
  return `${hours} ${language === 'ky' ? 'саат' : 'ч'}${minutes ? ` ${minutes} ${language === 'ky' ? 'мүн' : 'мин'}` : ''}`;
};
export function Icon({ name, size = 22, color }: { name: React.ComponentProps<typeof Ionicons>['name']; size?: number; color?: string }) {
  const { isDark, palette } = useTheme();
  const themedColor = !isDark ? color || colors.ink
    : !color || color === colors.ink ? palette.ink
    : color === colors.blue || color === colors.blueDark ? palette.accent
    : color === colors.muted ? palette.muted
    : color;
  return <Ionicons name={name} size={size} color={themedColor} />;
}
export function ToggleSwitch({ value, onValueChange, disabled = false, label }: { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean; label: string }) {
  const { isDark, palette } = useTheme();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(progress, { toValue: value ? 1 : 0, useNativeDriver: true, damping: 18, stiffness: 260, mass: .8 }).start();
  }, [progress, value]);
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} disabled={disabled} hitSlop={8} onPress={() => onValueChange(!value)} style={({ pressed }) => [s.toggleTrack, value && s.toggleTrackOn, isDark && { backgroundColor: value ? palette.accent : palette.elevated, borderColor: value ? palette.accent : palette.line }, disabled && { opacity: .48 }, pressed && !disabled && { transform: [{ scale: .96 }] }]}>
    <Animated.View style={[s.toggleThumb, isDark && { backgroundColor: value ? palette.background : palette.ink }, { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [2, 22] }) }] }]} />
  </Pressable>;
}
export function PickupIcon({ size = 24, color }: { size?: number; color?: string }) {
  const { palette, isDark } = useTheme();
  const tint = color && !(isDark && color === colors.ink) ? color : palette.ink;
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="14" cy="5" r="2.5" fill={tint}/><Path d="m10.2 9 3.6-.6c1.3-.2 2.3.5 2.8 1.8l1.8 4.8 3 5.1c.5.9-.1 1.9-1 1.9-.5 0-.9-.2-1.2-.7l-3.4-4.9-2.2-.2 1.6 4.3c.3.8-.2 1.5-1 1.5-.5 0-1-.2-1.2-.8l-2.9-6.4-.5-2.6-2.7 1.4H2.4a1.1 1.1 0 0 1 0-2.2h4.2L10.2 9Z" fill={tint}/></Svg>;
}
export function Logo({ large = false }: { large?: boolean }) {
  const driver = appVariant === 'driver';
  const { isDark } = useTheme();
  return <Image
    source={isDark ? require('../assets/logo dark.png') : require('../assets/logo light.png')}
    accessibilityLabel={driver ? 'Atlas pro' : 'Atlas'}
    resizeMode="contain"
    style={{ width: large ? 260 : 176, height: large ? 88 : 60 }}
  />;
}
const carImages = { economy: require('../assets/car-economy.png'), comfort: require('../assets/car-comfort.png'), business: require('../assets/car-business.png') };
export function Car({ color = '#E8EEF5', size = 72 }: { color?: string; size?: number }) {
  const variant = ['#253447', '#202B3A'].includes(color) ? 'business' : ['#67788D', '#52657A'].includes(color) ? 'comfort' : 'economy';
  return <Image source={carImages[variant]} resizeMode="contain" style={{ width: size, height: size * .57 }} accessibilityIgnoresInvertColors />;
}
export function CityArt({ height = 170 }: { height?: number }) {
  return <View style={{ width: '100%', height, overflow: 'hidden' }}><Image source={require('../assets/auth-city.png')} resizeMode="cover" style={{ width: '100%', height: '130%', position: 'absolute', bottom: 0 }} /></View>;
}
export function Button({ label, onPress, secondary, disabled, busy, icon }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; busy?: boolean; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const { isDark, palette } = useTheme();
  const foreground = isDark ? secondary ? palette.ink : palette.accentText : secondary ? colors.blue : 'white';
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [s.button, secondary && s.buttonSecondary, isDark && { backgroundColor: secondary ? palette.elevated : palette.accent, shadowColor: palette.accent }, (disabled || busy) && { opacity: .5 }, pressed && { opacity: .78 }]}>
    {busy ? <ActivityIndicator color={foreground} /> : null}
    <Text style={[s.buttonText, secondary && { color: colors.blue }, isDark && { color: foreground }]}>{label}</Text>
    {!busy && icon ? <View style={{ position: 'absolute', right: 20 }}><Icon name={icon} color={foreground} /></View> : null}
  </Pressable>;
}
export function IconButton({ name, onPress, label }: { name: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; label: string }) {
  const { isDark, palette } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.iconButton, isDark && { backgroundColor: palette.surface, borderColor: palette.line }, pressed && { opacity: .6 }]}><Icon name={name}/></Pressable>;
}
export function Avatar({ user, size = 60 }: { user?: Partial<User> | null; size?: number }) {
  const { isDark, palette } = useTheme();
  const photoUrl = user?.photoUrl;
  const uri = photoUrl ? (/^https?:\/\//i.test(photoUrl) ? photoUrl : `${api.baseUrl}/${photoUrl.replace(/^\/+/, '')}`) : null;
  return uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.elevated }}/> : <View style={[s.avatar, isDark && { backgroundColor: palette.elevated }, { width: size, height: size, borderRadius: size / 2 }]}><Text style={{ fontSize: size * .35, color: palette.accent, fontWeight: '700' }}>{(user?.name || user?.phone || '?').replace('+', '').slice(0, 2).toUpperCase()}</Text></View>;
}
export function Route({ order, pickup, dropoff, t = (text: string) => text }: { order?: Pick<Order, 'pickup' | 'dropoff'>; pickup?: string; dropoff?: string; t?: (text: string) => string }) {
  const { isDark, palette } = useTheme();
  return <View style={s.route}><View style={s.routePins}><Icon name="radio-button-on" color={palette.accent} size={20}/><View style={[s.routeLine, isDark && { backgroundColor: palette.line }]}/><Icon name="location" size={21}/></View><View style={{ flex: 1, gap: 17 }}><View><Text style={[s.caption, isDark && { color: palette.muted }]}>{t('Откуда')}</Text><Text style={[s.routeAddress, isDark && { color: palette.ink }]} numberOfLines={2}>{shortAddress(order?.pickup.address || pickup) || '—'}</Text></View><View><Text style={[s.caption, isDark && { color: palette.muted }]}>{t('Куда')}</Text><Text style={[s.routeAddress, isDark && { color: palette.ink }]} numberOfLines={2}>{shortAddress(order?.dropoff.address || dropoff) || '—'}</Text></View></View></View>;
}
export function Empty({ icon = 'car-outline', title, subtitle }: { icon?: React.ComponentProps<typeof Ionicons>['name']; title: string; subtitle?: string }) {
  const { isDark, palette } = useTheme();
  return <View style={s.empty}><View style={[s.emptyIcon, isDark && { backgroundColor: palette.elevated }]}><Icon name={icon} size={32} color={palette.accent}/></View><Text style={[s.h2, isDark && { color: palette.ink }]}>{title}</Text>{subtitle && <Text style={[s.muted, { textAlign: 'center' }, isDark && { color: palette.muted }]}>{subtitle}</Text>}</View>;
}
export function Sheet({ children, compact = false, maxFraction = .56, handleLabel = 'Развернуть или свернуть панель' }: PropsWithChildren<{ compact?: boolean; maxFraction?: number; handleLabel?: string }>) {
  const { isDark, palette } = useTheme();
  const { height } = useWindowDimensions();
  const max = Math.min(height * maxFraction, 760), min = Math.min(230, height * .28);
  const current = useRef(compact ? min : max); const animated = useRef(new Animated.Value(current.current)).current;
  const origin = useRef(current.current);
  useEffect(() => { const target = compact ? min : max; current.current = target; animated.setValue(target); }, [min, max, compact, animated]);
  const snap = (value: number) => { current.current = value; Animated.spring(animated, { toValue: value, useNativeDriver: false, damping: 24, stiffness: 180, mass: 1 }).start(); };
  const responder = useMemo(() => PanResponder.create({ onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4, onPanResponderGrant: () => { origin.current = current.current; }, onPanResponderMove: (_, g) => animated.setValue(Math.max(min, Math.min(max, origin.current - g.dy))), onPanResponderRelease: (_, g) => snap(origin.current - g.dy > (max + min) / 2 ? max : min) }), [min, max, animated]);
  return <Animated.View style={[s.sheet, isDark && { backgroundColor: palette.surface, shadowColor: palette.background }, { maxHeight: animated }]}><View {...responder.panHandlers}><Pressable onPress={() => snap(current.current === max ? min : max)} accessibilityRole="button" accessibilityLabel={handleLabel} style={s.handleTouch}><View style={[s.handle, isDark && { backgroundColor: palette.line }]}/></Pressable></View><ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetContent}>{children}</ScrollView></Animated.View>;
}
export const s = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 9 }, brand: { color: colors.ink, fontSize: 25, fontWeight: '800', letterSpacing: -.8 },
  h1: { fontSize: 29, fontWeight: '800', color: colors.ink, letterSpacing: -.7 }, h2: { fontSize: 22, fontWeight: '700', color: colors.ink, letterSpacing: -.35 }, h3: { fontSize: 17, fontWeight: '700', color: colors.ink },
  body: { fontSize: 16, color: colors.ink, lineHeight: 23 }, muted: { fontSize: 15, color: colors.muted, lineHeight: 22 }, caption: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  card: { backgroundColor: 'white', borderRadius: 23, padding: 20, borderWidth: 1, borderColor: colors.line }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  button: { minHeight: 56, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.blue, shadowColor: colors.blue, shadowOpacity: .16, shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: 2, flexDirection: 'row', gap: 9 }, buttonSecondary: { backgroundColor: '#EFF6FD', shadowOpacity: 0, elevation: 0 }, buttonText: { fontSize: 18, fontWeight: '700', color: 'white' }, iconButton: { width: 44, height: 44, backgroundColor: 'white', borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 16, color: colors.ink, fontSize: 16, backgroundColor: 'white', minHeight: 54 },
  avatar: { backgroundColor: '#E1EFFF', alignItems: 'center', justifyContent: 'center' }, route: { flexDirection: 'row', gap: 14 }, routePins: { alignItems: 'center', paddingTop: 4, paddingBottom: 8 }, routeLine: { flex: 1, width: 2, backgroundColor: '#CFDCEF', marginVertical: 5, minHeight: 18 }, routeAddress: { fontSize: 16, fontWeight: '600', color: colors.ink, lineHeight: 23 },
  toggleTrack: { width: 50, height: 30, borderRadius: 15, justifyContent: 'center', backgroundColor: '#D7E0EA', borderWidth: 1, borderColor: '#C9D4E0' },
  toggleTrackOn: { backgroundColor: colors.blue, borderColor: colors.blueDark },
  toggleThumb: { position: 'absolute', left: 0, width: 26, height: 26, borderRadius: 13, backgroundColor: 'white', shadowColor: '#18395C', shadowOpacity: .2, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: 'white', shadowColor: '#23466B', shadowOpacity: .1, shadowRadius: 24, shadowOffset: { width: 0, height: -4 }, elevation: 8, overflow: 'hidden' }, handleTouch: { paddingVertical: 11, alignItems: 'center' }, handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#CBD5E3' }, sheetContent: { paddingHorizontal: 16, paddingBottom: 20, gap: 12 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 28, paddingHorizontal: 16 }, emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E8F3FF', justifyContent: 'center', alignItems: 'center' },
  city: { height: 142, width: '100%', position: 'relative' }, cityCar: { position: 'absolute', right: 48, bottom: 4 }, divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
});
