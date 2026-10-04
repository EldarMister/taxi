export interface FoodOption { id:string; name:string; price:number; imageKey:string; imageUrl?:string; priceScope?:'PER_PORTION'|'PER_ITEM' }
export interface FoodOptionGroup { id:string; name:string; optionIds:string[]; minSelected?:number; maxSelected?:number }
export interface FoodDish {
  id:string; name:string; category:string; description:string; portion:string; weightGrams:number;
  price:number; imageKey:string; imageUrl?:string; heroImageKey?:string; heroImageUrl?:string; available:boolean; optionIds:string[];
  optionGroups?:FoodOptionGroup[]; defaultOptionIds?:string[];
  originalPrice?:number; ingredients?:string; calories?:number;
  nutritionPer100g?:{calories:number;protein:number;fat:number;carbohydrates:number;estimated?:boolean};
  badge?:string; ratingPercent?:number; reviewCount?:number;
}
export interface FoodRestaurantReview { id:string; authorName:string; rating:number; createdAt:string; text:string; source?:string }
export interface FoodPromotion { id:string; title:string; type:'PERCENT'|'FIXED'|'FREE_DELIVERY'; value:number; minSubtotal:number; dishIds:string[]; active:boolean; startsAt?:string|null; endsAt?:string|null }
export interface FoodRestaurant {
  id:string; name:string; rating:number; reviewCount:number; cuisine:string; categories:string[];
  etaMin:number; etaMax:number; deliveryFee:number; freeDeliveryThreshold?:number; minimumOrder:number; address:string; phone:string|null;
  imageKey:string; imageUrl?:string; heroImageKey:string; heroImageUrl?:string; discountPercent?:number; menuCategories:string[];
  dishes:FoodDish[]; options:FoodOption[]; isDemo:boolean; isOpen?:boolean; reviews?:FoodRestaurantReview[]; ratingCount?:number;
  latitude?:number; longitude?:number; promotions?:FoodPromotion[];
}

export const FOOD_PAYMENT_METHODS = [
  {id:'CASH',name:'Наличными',available:true},
  {id:'CARD',name:'Картой при получении',available:false},
  {id:'ONLINE',name:'Онлайн-оплата',available:false},
] as const;

// Reference content for the explicit development seed. These are not connected merchants.
const LEGACY_DEMO_FOOD_RESTAURANTS:FoodRestaurant[] = [
  {
    id:'sushi-roll',name:'Sushi Roll',rating:4.7,reviewCount:320,cuisine:'Суши · Роллы',categories:['Суши','Роллы'],
    etaMin:30,etaMax:45,deliveryFee:0,minimumOrder:0,address:'ул. Ленина 12, Кочкор-Ата',phone:null,
    imageKey:'sushi-roll',heroImageKey:'sushi-hero',discountPercent:30,menuCategories:['Акции','Сеты','Роллы','Суши','Закуски'],isDemo:true,
    dishes:[
      {id:'philadelphia',name:'Филадельфия',category:'Роллы',description:'Классический ролл с лососем, сливочным сыром и огурцом.',portion:'8 шт.',weightGrams:250,price:520,imageKey:'philadelphia',heroImageKey:'philadelphia-hero',available:true,optionIds:['soy','ginger','wasabi']},
      {id:'california',name:'Калифорния',category:'Роллы',description:'Ролл с крабом, авокадо, огурцом и икрой тобико.',portion:'8 шт.',weightGrams:230,price:460,imageKey:'california',available:true,optionIds:['soy','ginger','wasabi']},
      {id:'tempura',name:'Темпура с креветкой',category:'Роллы',description:'Тёплый ролл с креветкой, сливочным сыром и хрустящей темпурой.',portion:'8 шт.',weightGrams:260,price:480,imageKey:'tempura',available:true,optionIds:['soy','ginger','wasabi']},
      {id:'salmon',name:'Ролл с лососем',category:'Роллы',description:'Ролл с нежным лососем, рисом и огурцом.',portion:'8 шт.',weightGrams:240,price:450,imageKey:'salmon',available:true,optionIds:['soy','ginger','wasabi']},
    ],
    options:[{id:'soy',name:'Соевый соус',price:0,imageKey:'soy'},{id:'ginger',name:'Имбирь',price:0,imageKey:'ginger'},{id:'wasabi',name:'Васаби',price:0,imageKey:'wasabi'}],
  },
  {
    id:'kfc',name:'KFC',rating:4.6,reviewCount:1200,cuisine:'Фастфуд',categories:['Бургеры','Фастфуд'],
    etaMin:25,etaMax:35,deliveryFee:100,freeDeliveryThreshold:1000,minimumOrder:0,address:'Кочкор-Ата',phone:null,
    imageKey:'kfc',heroImageKey:'kfc',menuCategories:['Бургеры','Курица','Закуски'],isDemo:true,
    dishes:[
      {id:'chicken-burger',name:'Чикенбургер',category:'Бургеры',description:'Куриное филе, салат и фирменный соус в булочке.',portion:'1 шт.',weightGrams:210,price:290,imageKey:'burger',available:true,optionIds:[]},
      {id:'chicken-bucket',name:'Баскет с курицей',category:'Курица',description:'Хрустящие кусочки курицы для компании.',portion:'8 шт.',weightGrams:450,price:650,imageKey:'fried-chicken',available:true,optionIds:[]},
    ],options:[],
  },
  {
    id:'halva',name:'Халва',rating:4.5,reviewCount:640,cuisine:'Национальная кухня',categories:['Национальная кухня','Восточная'],
    etaMin:30,etaMax:50,deliveryFee:0,minimumOrder:0,address:'Кочкор-Ата',phone:null,
    imageKey:'halva',heroImageKey:'halva',menuCategories:['Горячее','Выпечка'],isDemo:true,
    dishes:[
      {id:'plov',name:'Плов',category:'Горячее',description:'Рассыпчатый рис с говядиной, морковью и восточными специями.',portion:'1 порция',weightGrams:350,price:380,imageKey:'plov',available:true,optionIds:[]},
      {id:'samsa',name:'Самса с мясом',category:'Выпечка',description:'Слоёная самса с говядиной и луком.',portion:'2 шт.',weightGrams:200,price:180,imageKey:'samosa',available:true,optionIds:[]},
    ],options:[],
  },
  {
    id:'ali-burger',name:'Али Бургер',rating:4.4,reviewCount:280,cuisine:'Бургеры',categories:['Бургеры','Фастфуд'],
    etaMin:25,etaMax:40,deliveryFee:100,freeDeliveryThreshold:1000,minimumOrder:0,address:'Кочкор-Ата',phone:null,
    imageKey:'ali-burger',heroImageKey:'ali-burger',menuCategories:['Бургеры','Комбо'],isDemo:true,
    dishes:[
      {id:'ali-cheeseburger',name:'Чизбургер',category:'Бургеры',description:'Говяжья котлета, сыр, овощи и соус в мягкой булочке.',portion:'1 шт.',weightGrams:280,price:320,imageKey:'burger',available:true,optionIds:[]},
      {id:'ali-combo',name:'Бургер комбо',category:'Комбо',description:'Чизбургер, картофель фри и прохладительный напиток.',portion:'1 набор',weightGrams:550,price:490,imageKey:'burger',available:true,optionIds:[]},
    ],options:[],
  },
];

const dish=(id:string,name:string,category:string,description:string,portion:string,weightGrams:number,price:number,imageKey:string,optionIds:string[]=[]):FoodDish=>
  ({id,name,category,description,portion,weightGrams,price,imageKey,available:true,optionIds});
const sushiOptions=['soy','ginger','wasabi'];
const chickenOptions=['ketchup','garlic','bbq'];
const burgerOptions=['extra-cheese','jalapeno','burger-sauce'];

// These menus are demonstration content only. Existing dish identities and prices
// remain stable so previously saved carts and order snapshots still make sense.
const additionalDishes:Record<string,FoodDish[]>={
  'sushi-roll':[
    dish('dragon-roll','Дракон с угрём','Роллы','Угорь, авокадо, огурец и сливочный сыр под соусом унаги.','8 шт.',270,590,'dragon-roll',sushiOptions),
    dish('baked-salmon-roll','Запечённый ролл с лососем','Роллы','Ролл с лососем и огурцом под нежной запечённой сырной шапочкой.','8 шт.',280,540,'baked-salmon-roll',sushiOptions),
    dish('salmon-nigiri','Нигири с лососем','Суши','Два нигири: рис для суши и тонкие ломтики лосося.','2 шт.',90,220,'salmon-nigiri',sushiOptions),
    dish('shrimp-nigiri','Нигири с креветкой','Суши','Два нигири с отварной тигровой креветкой на рисе.','2 шт.',85,210,'shrimp-nigiri',sushiOptions),
    dish('sushi-set','Сет на двоих','Сеты','Филадельфия, Калифорния и ролл с лососем — три вкуса в одном сете.','24 шт.',720,1290,'sushi-set',sushiOptions),
    dish('miso-soup','Мисо-суп','Супы','Тёплый бульон мисо с тофу, водорослями вакаме и зелёным луком.','350 мл',350,190,'miso-soup'),
    dish('edamame','Эдамаме','Закуски','Молодые соевые бобы в стручках с морской солью.','150 г',150,210,'edamame'),
    dish('shrimp-tempura','Креветки темпура','Закуски','Тигровые креветки в лёгком хрустящем кляре с соусом для подачи.','5 шт.',180,390,'shrimp-tempura'),
  ],
  kfc:[
    dish('chicken-wings','Куриные крылышки','Курица','Сочные крылышки в пряной хрустящей панировке.','6 шт.',300,390,'chicken-wings',chickenOptions),
    dish('chicken-strips','Куриные стрипсы','Курица','Полоски куриного филе в золотистой панировке.','5 шт.',250,350,'chicken-strips',chickenOptions),
    dish('chicken-nuggets','Куриные наггетсы','Курица','Нежные кусочки курицы в тонкой хрустящей корочке.','9 шт.',180,260,'chicken-nuggets',chickenOptions),
    dish('chicken-wrap','Ролл с курицей','Роллы','Пшеничная тортилья с хрустящей курицей, салатом, томатами и соусом.','1 шт.',260,310,'chicken-wrap'),
    dish('kfc-fries','Картофель фри','Закуски','Горячий картофель фри с золотистой корочкой и щепоткой соли.','150 г',150,140,'fries',chickenOptions),
    dish('kfc-potato-wedges','Картофель по-деревенски','Закуски','Картофельные дольки с кожицей, паприкой и ароматными травами.','180 г',180,160,'potato-wedges',chickenOptions),
    dish('coleslaw','Коул-слоу','Салаты','Свежая капуста и морковь с лёгкой сливочной заправкой.','150 г',150,150,'coleslaw'),
    dish('chicken-combo','Чикен-комбо','Комбо','Чикенбургер, порция картофеля фри и прохладительный напиток.','1 набор',550,470,'chicken-combo'),
    dish('kfc-lemonade','Домашний лимонад','Напитки','Освежающий лимонад с лимоном, мятой и льдом.','500 мл',500,140,'lemonade'),
    dish('kfc-cola','Кола','Напитки','Классический газированный напиток в охлаждённой бутылке.','500 мл',500,100,'cola'),
  ],
  halva:[
    dish('manti','Манты с говядиной','Горячее','Манты на пару с сочной начинкой из говядины и лука.','5 шт.',350,340,'manti'),
    dish('lagman','Лагман','Горячее','Домашняя тянутая лапша с говядиной, овощами и насыщенным соусом.','450 г',450,360,'lagman'),
    dish('beshbarmak','Бешбармак','Горячее','Тонкое домашнее тесто, отварная говядина и лук в ароматном бульоне.','450 г',450,420,'beshbarmak'),
    dish('shorpo','Шорпо','Супы','Прозрачный мясной бульон с говядиной, картофелем и морковью.','400 мл',400,290,'shorpo'),
    dish('kuurdak','Куурдак','Горячее','Обжаренная говядина с картофелем, луком и свежей зеленью.','350 г',350,430,'kuurdak'),
    dish('oromo','Оромо с мясом','Горячее','Рулет из тонкого теста с мясом, картофелем и луком, приготовленный на пару.','300 г',300,270,'oromo'),
    dish('achichuk','Ачичук','Салаты','Спелые томаты, тонко нарезанный лук и свежая зелень.','200 г',200,140,'achichuk'),
    dish('flatbread','Лепёшка из тандыра','Выпечка','Ароматная пышная лепёшка с румяной корочкой.','1 шт.',200,70,'flatbread'),
    dish('baursak','Боорсоки','Выпечка','Небольшие кусочки воздушного теста, обжаренные до золотистого цвета.','200 г',200,120,'baursak'),
    dish('tea','Чай с лимоном','Напитки','Горячий чёрный чай с долькой лимона.','400 мл',400,90,'tea'),
  ],
  'ali-burger':[
    dish('ali-double-cheeseburger','Двойной чизбургер','Бургеры','Две говяжьи котлеты, двойной сыр, маринованные огурцы и фирменный соус.','1 шт.',390,460,'double-cheeseburger',burgerOptions),
    dish('ali-bbq-burger','Барбекю бургер','Бургеры','Говяжья котлета, сыр, хрустящий лук и дымный соус барбекю.','1 шт.',320,380,'bbq-burger',burgerOptions),
    dish('ali-mushroom-burger','Грибной бургер','Бургеры','Говяжья котлета с обжаренными шампиньонами, сыром и сливочным соусом.','1 шт.',330,390,'mushroom-burger',burgerOptions),
    dish('ali-chicken-burger','Куриный бургер','Бургеры','Хрустящее куриное филе, свежий салат, томаты и нежный соус.','1 шт.',270,300,'chicken-burger',burgerOptions),
    dish('ali-veggie-burger','Овощной бургер','Бургеры','Овощная котлета, свежие овощи и томатный соус в мягкой булочке.','1 шт.',260,280,'veggie-burger'),
    dish('ali-fries','Картофель фри','Закуски','Хрустящий картофель фри с солью.','150 г',150,130,'fries'),
    dish('ali-potato-wedges','Картофельные дольки','Закуски','Румяные картофельные дольки с пряностями.','180 г',180,150,'potato-wedges'),
    dish('ali-onion-rings','Луковые кольца','Закуски','Сладкий лук в хрустящей золотистой панировке.','8 шт.',160,170,'onion-rings'),
    dish('ali-caesar','Цезарь с курицей','Салаты','Куриное филе, хрустящий салат, томаты, сухарики, сыр и соус цезарь.','250 г',250,290,'caesar-salad'),
    dish('ali-lemonade','Лимонад с мятой','Напитки','Холодный лимонад с лимоном и свежей мятой.','500 мл',500,130,'lemonade'),
  ],
};
const additionalOptions:Record<string,FoodOption[]>={
  kfc:[{id:'ketchup',name:'Кетчуп',price:25,imageKey:'ketchup'},{id:'garlic',name:'Чесночный соус',price:30,imageKey:'garlic-sauce'},{id:'bbq',name:'Соус барбекю',price:30,imageKey:'bbq-sauce'}],
  'ali-burger':[{id:'extra-cheese',name:'Дополнительный сыр',price:40,imageKey:'extra-cheese'},{id:'jalapeno',name:'Халапеньо',price:30,imageKey:'jalapeno'},{id:'burger-sauce',name:'Фирменный соус',price:25,imageKey:'burger-sauce'}],
};

const extendedDishes:Record<string,FoodDish[]>={
  'sushi-roll':[
    dish('philadelphia-xl','Филадельфия XL','Роллы','Большая порция роллов с лососем, сыром и огурцом.','16 шт.',500,990,'philadelphia'),
    dish('california-xl','Калифорния XL','Роллы','Большая порция роллов с крабом и авокадо.','16 шт.',460,870,'california'),
    dish('tempura-set','Тёплый сет','Сеты','Темпура с креветкой и запечённые роллы с лососем.','24 шт.',800,1390,'tempura'),
    dish('family-sushi-set','Семейный сет','Сеты','Ассорти классических роллов для большой компании.','48 шт.',1440,2490,'sushi-set'),
    dish('baked-roll-set','Запечённый сет','Сеты','Запечённые роллы с лососем и нежным сырным соусом.','24 шт.',840,1490,'baked-salmon-roll'),
    dish('shrimp-tempura-xl','Креветки темпура XL','Закуски','Большая порция тигровых креветок в хрустящем кляре.','10 шт.',360,740,'shrimp-tempura'),
    dish('sushi-lemonade','Лимонад с лимоном','Напитки','Лимонный лимонад с мятой, можно выбрать объём и добавки.','500 мл',500,140,'lemonade'),
    dish('sushi-tea','Чай с лимоном','Напитки','Горячий чай с лимоном, мятой или без сахара на выбор.','400 мл',400,90,'tea'),
  ],
  kfc:[
    dish('spicy-chicken-burger','Острый чикенбургер','Бургеры','Куриное филе, салат и острый соус. Размер и добавки на выбор.','1 шт.',230,320,'chicken-burger'),
    dish('double-chicken-burger','Двойной чикенбургер','Бургеры','Два куриных филе, сыр, овощи и фирменный соус.','1 шт.',350,430,'chicken-burger'),
    dish('family-chicken-bucket','Семейный баскет','Курица','Большой баскет хрустящих кусочков курицы для компании.','16 шт.',900,1190,'chicken-bucket'),
    dish('spicy-chicken-wings','Острые крылышки','Курица','Крылышки с пряной панировкой и соусами на выбор.','9 шт.',450,540,'chicken-wings'),
    dish('chicken-strips-xl','Стрипсы XL','Курица','Большая порция хрустящих полосок куриного филе.','9 шт.',450,590,'chicken-strips'),
    dish('wrap-combo','Ролл-комбо','Комбо','Ролл с курицей, картофель фри и напиток на выбор.','1 набор',600,510,'chicken-wrap'),
    dish('kfc-caesar','Цезарь с курицей','Салаты','Курица, салат, сухарики, томаты и соус цезарь.','250 г',250,290,'caesar-salad'),
    dish('kfc-tea','Чай с лимоном','Напитки','Горячий чай с выбором объёма и добавок.','400 мл',400,90,'tea'),
  ],
  halva:[
    dish('plov-family','Плов для компании','Горячее','Плов с говядиной и морковью в большой порции.','1 кг',1000,990,'plov'),
    dish('manti-xl','Манты XL','Горячее','Большая порция мантов с говядиной, соусы на выбор.','8 шт.',560,520,'manti'),
    dish('fried-lagman','Жареный лагман','Горячее','Домашняя лапша с говядиной и овощами, обжаренная в воке.','450 г',450,390,'lagman'),
    dish('kuurdak-family','Куурдак для двоих','Горячее','Говядина с картофелем, луком и зеленью на двоих.','700 г',700,790,'kuurdak'),
    dish('samsa-set','Самса для компании','Выпечка','Набор слоёной самсы с говядиной и луком.','6 шт.',600,490,'samsa'),
    dish('halva-caesar','Цезарь с курицей','Салаты','Курица, зелёный салат, сыр, сухарики и заправка.','250 г',250,290,'caesar-salad'),
    dish('halva-lemonade','Домашний лимонад','Напитки','Лимонад с лимоном и мятой. Выберите объём.','500 мл',500,130,'lemonade'),
    dish('halva-cola','Кола','Напитки','Охлаждённый газированный напиток.','500 мл',500,100,'cola'),
  ],
  'ali-burger':[
    dish('ali-triple-cheeseburger','Тройной чизбургер','Бургеры','Три говяжьи котлеты, сыр, огурцы и фирменный соус.','1 шт.',500,590,'double-cheeseburger'),
    dish('ali-spicy-burger','Острый бургер','Бургеры','Говяжья котлета, сыр, халапеньо и острый соус.','1 шт.',310,370,'bbq-burger'),
    dish('ali-double-combo','Двойной комбо','Комбо','Двойной чизбургер с картофелем фри и напитком.','1 набор',700,640,'burger-combo'),
    dish('ali-chicken-combo','Куриный комбо','Комбо','Куриный бургер, картофель фри и напиток на выбор.','1 набор',550,470,'chicken-combo'),
    dish('ali-nuggets','Куриные наггетсы','Закуски','Хрустящие кусочки курицы с соусами на выбор.','9 шт.',180,250,'chicken-nuggets'),
    dish('ali-coleslaw','Коул-слоу','Салаты','Свежая капуста и морковь со сливочной заправкой.','150 г',150,140,'coleslaw'),
    dish('ali-cola','Кола','Напитки','Охлаждённый газированный напиток, объём на выбор.','500 мл',500,100,'cola'),
    dish('ali-tea','Чай с лимоном','Напитки','Горячий чай с выбором объёма, лимоном и мятой.','400 мл',400,90,'tea'),
  ],
};

/** Modifier examples belong only to the explicitly installed test menus. */
function configureDemoMenu(restaurant:FoodRestaurant,dishes:FoodDish[]) {
  const options=[...restaurant.options,...(additionalOptions[restaurant.id]??[])];
  const add=(id:string,name:string,price:number,imageKey:string)=>{
    if(!options.some(option=>option.id===id))options.push({id,name,price,imageKey});
    return id;
  };
  const additions=restaurant.id==='sushi-roll'
    ? [...sushiOptions,add('cream-cheese','Сливочный сыр',50,'extra-cheese'),add('unagi-sauce','Соус унаги',35,'soy')]
    : restaurant.id==='halva'
      ? [add('sour-cream','Сметана',30,'garlic-sauce'),add('extra-meat','Дополнительное мясо',100,'kuurdak'),add('bread-side','Лепёшка к блюду',50,'flatbread'),add('salad-side','Ачичук к блюду',60,'achichuk'),add('no-onion','Без лука',0,'achichuk')]
      : [add('extra-cheese','Дополнительный сыр',40,'extra-cheese'),add('jalapeno','Халапеньо',30,'jalapeno'),add('ketchup','Кетчуп',25,'ketchup'),add('garlic','Чесночный соус',30,'garlic-sauce'),add('bbq','Соус барбекю',30,'bbq-sauce')];
  const drinkExtras=[add('lemon','Лимон',15,'lemonade'),add('mint','Мята',20,'lemonade'),add('no-sugar','Без сахара',0,'tea')];
  const heat=[add('mild','Не остро',0,'burger-sauce'),add('spicy','Остро',0,'jalapeno')];
  const legacyIds=new Set(restaurant.dishes.map(item=>item.id));
  const configured=dishes.map(item=>{
    const drink=item.category==='Напитки';
    const standard=add(`${item.id}-standard`,drink?item.portion:`Обычная · ${item.portion}`,0,item.imageKey);
    const large=add(`${item.id}-large`,drink?'Большой · 700 мл':'Большая порция · +50%',drink?40:Math.round(item.price*0.5/10)*10,item.imageKey);
    const family=add(`${item.id}-family`,drink?'1 литр':'Двойная порция',drink?80:item.price,item.imageKey);
    const groups:FoodOptionGroup[]=[{id:drink?'volume':'size',name:drink?'Объём':'Размер порции',optionIds:[standard,large,family],minSelected:legacyIds.has(item.id)?0:1,maxSelected:1}];
    if(!drink&&['Бургеры','Курица','Роллы','Горячее'].includes(item.category))groups.push({id:'heat',name:'Острота',optionIds:heat,minSelected:0,maxSelected:1});
    const extras=drink?drinkExtras:additions;
    groups.push({id:'extras',name:drink?'Добавки к напитку':'Соусы и добавки',optionIds:extras,minSelected:0,maxSelected:extras.length});
    return {...item,optionIds:groups.flatMap(group=>group.optionIds),optionGroups:groups,defaultOptionIds:[standard]};
  });
  return {dishes:configured,options};
}

function demoReviews(restaurantId:string):FoodRestaurantReview[] {
  return [
    {id:`${restaurantId}-test-review-1`,authorName:'Тестовый клиент 1',rating:5,createdAt:'2026-10-03T12:00:00.000Z',text:'Тестовый отзыв: всё понравилось, заказ приехал горячим. Проверка отображения пяти звёзд.',source:'Тестовые отзывы'},
    {id:`${restaurantId}-test-review-2`,authorName:'Тестовый клиент 2',rating:4,createdAt:'2026-10-02T10:00:00.000Z',text:'Тестовый отзыв: удобный выбор размера и соусов. Проверка длинного текста и сортировки отзывов.',source:'Тестовые отзывы'},
    {id:`${restaurantId}-test-review-3`,authorName:'Тестовый клиент 3',rating:2,createdAt:'2026-10-01T09:00:00.000Z',text:'Тестовый отзыв: пример низкой оценки для пункта «Сначала плохие».',source:'Тестовые отзывы'},
    {id:`${restaurantId}-test-review-4`,authorName:'Тестовый клиент 4',rating:5,createdAt:'2026-10-04T03:00:00.000Z',text:'Тестовый отзыв: пример нового отзыва для проверки сортировки по дате.',source:'Тестовые отзывы'},
  ];
}

export const DEMO_FOOD_RESTAURANTS:FoodRestaurant[]=LEGACY_DEMO_FOOD_RESTAURANTS.map(restaurant=>{
  const items=[...restaurant.dishes.map(item=>({...item,...(item.id==='chicken-burger'?{imageKey:'chicken-burger'}:item.id==='ali-combo'?{imageKey:'burger-combo'}:{})})),...additionalDishes[restaurant.id],...extendedDishes[restaurant.id]];
  const {dishes,options}=configureDemoMenu(restaurant,items);
  return {...restaurant,dishes,options,menuCategories:[...new Set(dishes.map(item=>item.category))],reviews:demoReviews(restaurant.id)};
});

function comparableDemo(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(comparableDemo).join(',')}]`;
  if(value&&typeof value==='object') {
    return `{${Object.entries(value).filter(([key,item])=>item!==undefined&&!(key==='freeDeliveryThreshold'&&item===0)&&!(key==='isOpen'&&item===true)&&!(['heroImageKey','imageUrl','heroImageUrl'].includes(key)&&(item===''||item===null)))
      .sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${comparableDemo(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Seed-time upgrade only: never overwrite real merchants or edited demo menus. */
export function upgradeLegacyDemoCatalog(stored:{id:string;isDemo:boolean;catalog:unknown}):FoodRestaurant|null {
  if(!stored.isDemo)return null;
  const legacy=LEGACY_DEMO_FOOD_RESTAURANTS.find(restaurant=>restaurant.id===stored.id);
  if(!legacy||comparableDemo(stored.catalog)!==comparableDemo(legacy))return null;
  return structuredClone(DEMO_FOOD_RESTAURANTS.find(restaurant=>restaurant.id===stored.id)!);
}
