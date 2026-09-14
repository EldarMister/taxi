export interface FoodOption { id:string; name:string; price:number; imageKey:string; imageUrl?:string }
export interface FoodDish {
  id:string; name:string; category:string; description:string; portion:string; weightGrams:number;
  price:number; imageKey:string; imageUrl?:string; heroImageKey?:string; heroImageUrl?:string; available:boolean; optionIds:string[];
}
export interface FoodRestaurant {
  id:string; name:string; rating:number; reviewCount:number; cuisine:string; categories:string[];
  etaMin:number; etaMax:number; deliveryFee:number; minimumOrder:number; address:string; phone:string|null;
  imageKey:string; imageUrl?:string; heroImageKey:string; heroImageUrl?:string; discountPercent?:number; menuCategories:string[];
  dishes:FoodDish[]; options:FoodOption[]; isDemo:boolean;
}

export const FOOD_PAYMENT_METHODS = [
  {id:'CASH',name:'Наличными',available:true},
  {id:'CARD',name:'Картой при получении',available:false},
  {id:'ONLINE',name:'Онлайн-оплата',available:false},
] as const;

// Reference content for the explicit development seed. These are not connected merchants.
export const DEMO_FOOD_RESTAURANTS:FoodRestaurant[] = [
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
    etaMin:25,etaMax:35,deliveryFee:100,minimumOrder:0,address:'Кочкор-Ата',phone:null,
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
    etaMin:25,etaMax:40,deliveryFee:100,minimumOrder:0,address:'Кочкор-Ата',phone:null,
    imageKey:'ali-burger',heroImageKey:'ali-burger',menuCategories:['Бургеры','Комбо'],isDemo:true,
    dishes:[
      {id:'ali-cheeseburger',name:'Чизбургер',category:'Бургеры',description:'Говяжья котлета, сыр, овощи и соус в мягкой булочке.',portion:'1 шт.',weightGrams:280,price:320,imageKey:'burger',available:true,optionIds:[]},
      {id:'ali-combo',name:'Бургер комбо',category:'Комбо',description:'Чизбургер, картофель фри и прохладительный напиток.',portion:'1 набор',weightGrams:550,price:490,imageKey:'burger',available:true,optionIds:[]},
    ],options:[],
  },
];
