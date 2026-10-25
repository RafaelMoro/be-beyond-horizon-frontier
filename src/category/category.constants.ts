// Copied verbatim from legacy src/categories/constants.ts (origin/develop), typos and trailing spaces included: the FE
// and existing prod docs depend on these exact strings.
export const CATEGORY_DELETED_MESSAGE = 'Category deleted';
export const CATEGORY_NOT_FOUND_ERROR = 'Category not found';
export const CATEGORY_CREATED_MESSAGE = 'New category created';
export const LOCAL_CATEGORIES_EXISTS_ERROR = 'Local categories already exists';

const FOOD_AND_DRINK_CATEGORY = {
  categoryName: 'Comida y Bebida',
  subCategories: [
    'Bar',
    'Alcohol & Cigarros',
    'Comida para llevar',
    'Comida rápida',
    'Cafetería',
    'Restaurantes',
    'Despensa',
  ],
  icon: 'foodAndDrink',
} as const;
const HOUSING_CATEGORY = {
  categoryName: 'Vivienda',
  subCategories: [
    'Renta',
    'Hipoteca',
    'Mantenimiento y reparaciones del hogar',
    'Impuestos sobre la vivienda',
  ],
  icon: 'house',
} as const;
const UTILITIES_CATEGORY = {
  categoryName: 'Servicios básicos',
  subCategories: [
    'Luz',
    'Gas',
    'Calefacción',
    'Agua',
    'Internet',
    'Cable',
    'Communicación móvil',
    'Seguridad',
  ],
  icon: 'utilities',
} as const;
const SUSCRIPTIONS_CATEGORY = {
  categoryName: 'Suscripciones',
  subCategories: [
    'Servicios de streaming',
    'Gimnasio',
    'Software',
    'Membresías',
    'Aprendizaje y educación',
    'Suscripciones en línea',
  ],
  icon: 'subcriptions',
} as const;
const TRANSPORTATION_CATEGORY = {
  categoryName: 'Transporte',
  subCategories: [
    'Gasolina',
    'Renta de carro',
    'Mantenimiento y reparaciones del carro',
    'Tarifas de estacionamiento',
    'Transporte público',
    'Uber/Didi',
    'Boletos de avión',
    'Taxi',
  ],
  icon: 'transportation',
} as const;
const FINANCIAL_EXPENSES_CATEGORY = {
  categoryName: 'Gastos financieros',
  subCategories: [
    'Asesoramiento u orientación',
    'Asignación familiar',
    'Pagos gubernamentales',
    'Comisiones bancarias',
    'Multas o penalizaciones',
    'Cargos y tasas',
    'Impuestos',
    'Deuda de tarjeta de crédito',
    'Seguro o préstamo del carro',
    'Préstamo',
    'Pago',
    'Financiamiento',
    'Seguro',
    'Intereses',
  ],
  icon: 'debtAndLoans',
} as const;
const HEALTHCARE_CATEGORY = {
  categoryName: 'Salud',
  subCategories: [
    'Barbero / Peluquería',
    'Psicólogo / Salud mental',
    'Atención médica especializada',
    'Cuidado dental',
    'Atención de urgencia',
    'Medicinas',
    'Hospital',
    'Recetas médicas',
    'Suplementos de salud',
  ],
  icon: 'healthCare',
} as const;
const KIDS_CATEGORY = {
  categoryName: 'Niños',
  subCategories: [
    'Pensión alimenticiat',
    'Necesidades básicas',
    'Clases particulares',
    'Juguetes',
    'Regalos',
    'Útiles escolares / almuerzo',
    'Actividades extracurriculares',
    'Salidas',
    'Ropa',
    'Calzado',
  ],
  icon: 'kids',
} as const;
const SHOPPING = {
  categoryName: 'Compras',
  subCategories: [
    'Ropa',
    'Calzado',
    'Niños',
    'Casa y jardín',
    'Electrónica o accesorios',
    'Videojuegos',
    'Software',
    'Farmacia',
    'Joyeria',
    'Mascotas',
    'Papelería / Herramientas',
    'Regalos',
    'Salud y belleza',
    'Tiempo libre / Hobbies',
  ],
  icon: 'shopping',
} as const;

const ENTERTAINMENT_AND_LEISURE_CATEGORY = {
  categoryName: 'Entretenimiento',
  subCategories: [
    'Salidas',
    'Bienestar y belleza',
    'Donaciones / Regalos',
    'Eventos deportivos / Cultura',
    'Deportes / Fitness',
    'Educación / Desarrollo personal',
    'Eventos especiales',
    'Libros, audiolibros',
    'Lotería / Juegos de azar',
    'Vacaciones / Hotel',
    'Hobbies',
    'Conciertos',
    'Cine',
  ],
  icon: 'entertainment',
} as const;
const SAVINGS_CATEGORY = {
  categoryName: 'Ahorro',
  subCategories: [
    'Ahorros',
    'Fondo de emergencia',
    'Jubilación',
    'Inversiones',
    'Vacaciones',
    'Automóvil / Propiedad inmobiliaria ',
  ],
  icon: 'savings',
} as const;
const INCOME_CATEGORY = {
  categoryName: 'Ingreso',
  subCategories: [
    'Salario',
    'Comisiones / bonos',
    'Propinas',
    'Inversiones',
    'Negocios',
    'Servicios profesionales',
    'Reembolsos',
    'Regalos',
  ],
  icon: 'income',
} as const;

// The 12 defaults, in seed order.
export const ALL_LOCAL_CATEGORIES = [
  FOOD_AND_DRINK_CATEGORY,
  HOUSING_CATEGORY,
  UTILITIES_CATEGORY,
  SUSCRIPTIONS_CATEGORY,
  TRANSPORTATION_CATEGORY,
  FINANCIAL_EXPENSES_CATEGORY,
  HEALTHCARE_CATEGORY,
  KIDS_CATEGORY,
  SHOPPING,
  ENTERTAINMENT_AND_LEISURE_CATEGORY,
  SAVINGS_CATEGORY,
  INCOME_CATEGORY,
] as const;
