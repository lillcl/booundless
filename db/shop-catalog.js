/* Full BOOUNDLESS compatibility catalogue. Product metadata is structured so
   search and Vehicle Passport filtering never depend on free-text alone. */

const ART = {
  oil: ['/assets/shop-fluids-filters-v1.png', '0% 0%'],
  filter: ['/assets/shop-fluids-filters-v1.png', '100% 0%'],
  fluid: ['/assets/shop-fluids-filters-v1.png', '0% 100%'],
  coolant: ['/assets/shop-fluids-filters-v1.png', '100% 100%'],
  brake: ['/assets/shop-mechanical-v1.png', '0% 0%'],
  battery: ['/assets/shop-mechanical-v1.png', '100% 0%'],
  tyre: ['/assets/shop-mechanical-v1.png', '0% 100%'],
  wiper: ['/assets/shop-mechanical-v1.png', '100% 100%'],
  wash: ['/assets/shop-care-interior-v1.png', '0% 0%'],
  exterior: ['/assets/shop-care-interior-v1.png', '100% 0%'],
  interior: ['/assets/shop-care-interior-v1.png', '0% 100%'],
  accessory: ['/assets/shop-care-interior-v1.png', '100% 100%'],
  safety: ['/assets/shop-safety-ev-moto-v1.png', '0% 0%'],
  tool: ['/assets/shop-safety-ev-moto-v1.png', '100% 0%'],
  ev: ['/assets/shop-safety-ev-moto-v1.png', '0% 100%'],
  moto: ['/assets/shop-safety-ev-moto-v1.png', '100% 100%'],
};

const rows = [];
const add = (category, slug, name, powertrains, tags, art, price, specifications = '', useCases = '更換', vehicleTypes = 'passenger|van') => {
  rows.push({ category, slug, name, powertrains: powertrains.split('|'), tags: tags.split('|'), art, price_minor: price,
    specifications: specifications ? specifications.split('|') : [], use_cases: useCases.split('|'), vehicle_types: vehicleTypes.split('|') });
};

add('機油與引擎保養','full-synthetic-engine-oil','全合成機油','ICE|Hybrid','機油|engine oil|全合成|汽油車|hybrid|0W-16|0W-20|5W-30|保養','oil',39800,'0W-16|0W-20|5W-30','保養|更換');
add('機油與引擎保養','semi-synthetic-engine-oil','半合成機油','ICE','機油|semi synthetic|半合成|engine oil','oil',28800,'5W-30|10W-40','保養|更換');
add('機油與引擎保養','diesel-engine-oil','柴油引擎機油','ICE','柴油機油|diesel oil|柴油車','oil',42800,'5W-30|5W-40','保養|更換');
add('機油與引擎保養','engine-oil-additive','機油添加劑','ICE|Hybrid','機油添加劑|engine treatment|additive','fluid',12800,'','保養');
add('機油與引擎保養','engine-flush','引擎清潔劑','ICE|Hybrid','引擎清潔|engine flush|油泥|清潔劑','fluid',9800,'','清潔|保養');

add('濾芯','oil-filter','機油隔 / 機油濾芯','ICE|Hybrid','機油隔|機油濾芯|oil filter|filter','filter',8800,'','保養|更換');
add('濾芯','engine-air-filter','空氣濾芯','ICE|Hybrid','風隔|空氣濾芯|air filter|engine air filter','filter',12800,'','保養|更換');
add('濾芯','cabin-filter','冷氣濾芯 / 塵格','ALL','塵格|冷氣濾芯|cabin filter|AC filter|PM2.5','filter',13800,'PM2.5','保養|更換');
add('濾芯','activated-carbon-cabin-filter','活性碳冷氣濾芯','ALL','活性碳|cabin filter|塵格|除味','filter',18800,'活性碳','保養|更換|除味');
add('濾芯','fuel-filter','燃油濾芯','ICE','燃油濾芯|fuel filter|汽油隔','filter',16800,'','保養|更換');

add('波箱 / 傳動','atf-fluid','ATF 自動波箱油','ICE|Hybrid','波箱油|ATF|automatic transmission fluid|自動波','fluid',23800,'ATF','保養|更換');
add('波箱 / 傳動','cvt-fluid','CVT 波箱油','ICE|Hybrid','CVT|CVT fluid|波箱油|無段變速','fluid',25800,'CVT','保養|更換');
add('波箱 / 傳動','dct-fluid','DCT 波箱油','ICE','DCT|雙離合|DCT fluid|波箱油','fluid',28800,'DCT','保養|更換');
add('波箱 / 傳動','mtf-fluid','手波油','ICE','MTF|manual transmission fluid|手波油','fluid',21800,'MTF','保養|更換');
add('波箱 / 傳動','differential-oil','差速器油','ICE|Hybrid|EV','差速器油|differential oil|gear oil','fluid',24800,'','保養|更換');
add('波箱 / 傳動','gear-oil-75w90','齒輪油','ICE|Hybrid|EV','齒輪油|gear oil|75W-90','fluid',22800,'75W-90','保養|更換');

add('煞車系統','front-brake-pads','前煞車皮','ALL','煞車皮|brake pad|front brake pad|前迫力皮','brake',68800,'前軸','更換');
add('煞車系統','rear-brake-pads','後煞車皮','ALL','煞車皮|rear brake pad|後迫力皮','brake',58800,'後軸','更換');
add('煞車系統','brake-disc','煞車碟','ALL','煞車碟|brake disc|brake rotor','brake',118800,'','更換');
add('煞車系統','brake-fluid-dot3','煞車油 DOT 3','ALL','煞車油|brake fluid|DOT3','fluid',8800,'DOT3','保養|更換');
add('煞車系統','brake-fluid-dot4','煞車油 DOT 4','ALL','煞車油|brake fluid|DOT4','fluid',10800,'DOT4','保養|更換');
add('煞車系統','brake-cleaner','煞車清潔劑','ALL','brake cleaner|煞車清潔|清潔劑','exterior',6800,'','清潔');

add('冷卻系統','engine-coolant','引擎冷卻液','ICE|Hybrid','冷卻液|coolant|antifreeze|水箱水','coolant',16800,'預混','保養|更換');
add('冷卻系統','hybrid-coolant','Hybrid 冷卻液','Hybrid','hybrid coolant|混能冷卻液|電池冷卻','coolant',19800,'Hybrid','保養|更換');
add('冷卻系統','ev-coolant','EV 冷卻液','EV','EV coolant|電池冷卻液|電動車','coolant',22800,'EV','保養|更換');
add('冷卻系統','radiator-flush','水箱清潔劑','ICE|Hybrid','radiator flush|水箱清潔|冷卻系統','fluid',9800,'','清潔|保養');

add('點火系統','spark-plug','火花塞','ICE|Hybrid','火花塞|spark plug|銥金|iridium','tool',12800,'銥金','保養|更換');
add('點火系統','ignition-coil','點火線圈','ICE|Hybrid','點火線圈|ignition coil|coil pack','tool',46800,'','更換');

add('電池與電氣','car-battery-12v','12V 汽車電池','ALL','12V電池|car battery|汽車電池|AGM|EFB','battery',118800,'12V','更換');
add('電池與電氣','agm-battery','AGM 電池','ALL','AGM|12V|start stop|汽車電池','battery',168800,'AGM|12V','更換');
add('電池與電氣','efb-battery','EFB 電池','ALL','EFB|start stop|汽車電池','battery',138800,'EFB|12V','更換');
add('電池與電氣','battery-charger','電池充電器','ALL','battery charger|充電器|12V','battery',49800,'12V','應急|保養');
add('電池與電氣','jump-starter','Jump Starter','ALL','jump starter|過江龍|搭電|應急啟動','safety',68800,'','應急');
add('電池與電氣','automotive-fuse','保險絲','ALL','保險絲|fuse|汽車電器','accessory',4800,'','更換|應急');
add('電池與電氣','headlight-bulb','車燈燈泡','ALL','燈泡|headlight bulb|LED|車燈','accessory',18800,'LED','更換');

add('輪胎與輪圈','passenger-tyre','輪胎','ALL','輪胎|tyre|tire|205/55R16|SUV tyre','tyre',78800,'205/55R16|SUV','更換');
add('輪胎與輪圈','tyre-repair-kit','輪胎修補套裝','ALL','補胎|tyre repair|puncture kit','tyre',16800,'','應急|北上');
add('輪胎與輪圈','tyre-inflator','輪胎充氣泵','ALL','充氣泵|air compressor|tyre inflator','tyre',32800,'','應急|北上');
add('輪胎與輪圈','tyre-pressure-gauge','胎壓計','ALL','胎壓|tyre pressure gauge|TPMS','tyre',9800,'','保養|應急');
add('輪胎與輪圈','tpms-sensor','TPMS Sensor','ALL','TPMS|胎壓感應器|sensor','tyre',28800,'TPMS','更換');
add('輪胎與輪圈','wheel-nut','輪圈螺母','ALL','wheel nut|lug nut|輪圈螺絲','tyre',12800,'','更換');

add('雨刷與玻璃','wiper-blade','雨刷','ALL','雨刷|雨刮|wiper|wiper blade','wiper',16800,'','更換');
add('雨刷與玻璃','washer-fluid','雨刷水','ALL','雨刷水|washer fluid|玻璃水','wiper',5800,'','保養|清潔');
add('雨刷與玻璃','glass-cleaner','玻璃清潔劑','ALL','glass cleaner|玻璃清潔','exterior',6800,'','清潔');
add('雨刷與玻璃','rain-repellent','撥水劑','ALL','撥水|rain repellent|玻璃鍍膜','exterior',12800,'','清潔|鍍膜');

add('汽車美容 / 日常護理','car-shampoo','洗車液','ALL','洗車|car shampoo|car wash','wash',8800,'','清潔');
add('汽車美容 / 日常護理','car-wax','車蠟','ALL','車蠟|car wax|wax','exterior',15800,'','清潔|鍍膜');
add('汽車美容 / 日常護理','ceramic-coating','車漆鍍膜','ALL','鍍膜|ceramic coating|coating','exterior',39800,'陶瓷鍍膜','鍍膜');
add('汽車美容 / 日常護理','quick-detailer','快速鍍膜噴霧','ALL','quick detailer|鍍膜噴霧|detailer','exterior',13800,'','清潔|鍍膜');
add('汽車美容 / 日常護理','tyre-shine','輪胎蠟','ALL','輪胎蠟|tyre shine|tire dressing','exterior',11800,'','清潔');
add('汽車美容 / 日常護理','wheel-cleaner','輪圈清潔劑','ALL','輪圈清潔|wheel cleaner|鐵粉','exterior',12800,'','清潔');
add('汽車美容 / 日常護理','iron-remover','鐵粉去除劑','ALL','鐵粉|iron remover|車漆','exterior',14800,'','清潔');
add('汽車美容 / 日常護理','tar-remover','柏油去除劑','ALL','柏油|tar remover','exterior',11800,'','清潔');
add('汽車美容 / 日常護理','interior-cleaner','內飾清潔劑','ALL','內飾|interior cleaner|dashboard cleaner','interior',10800,'','清潔|車內');
add('汽車美容 / 日常護理','leather-care','皮革清潔護理','ALL','皮革|leather cleaner|leather conditioner','interior',16800,'','清潔|車內');
add('汽車美容 / 日常護理','fabric-cleaner','布座椅清潔劑','ALL','布座椅|fabric cleaner|interior','interior',12800,'','清潔|車內');
add('汽車美容 / 日常護理','ac-deodorizer','冷氣除味劑','ALL','冷氣除味|AC cleaner|除臭','interior',12800,'','清潔|除味');
add('汽車美容 / 日常護理','microfiber-cloth','超細纖維布','ALL','microfiber|抹布|洗車布','wash',6800,'','清潔');
add('汽車美容 / 日常護理','wash-mitt','洗車手套','ALL','洗車手套|wash mitt','wash',7800,'','清潔');
add('汽車美容 / 日常護理','drying-towel','吸水毛巾','ALL','drying towel|吸水毛巾|洗車','wash',9800,'','清潔');

add('車內用品','phone-mount','手機支架','ALL','手機支架|phone mount|car mount','accessory',18800,'','車內');
add('車內用品','car-charger','車載充電器','ALL','車充|car charger|USB-C|PD','accessory',22800,'USB-C|PD','車內');
add('車內用品','usb-c-cable','USB-C 線材','ALL','USB-C|charging cable|車內充電','accessory',8800,'USB-C','車內');
add('車內用品','dash-cam','行車記錄儀','ALL','行車記錄儀|dash cam|車Cam','accessory',68800,'','車內|安全');
add('車內用品','car-vacuum','車用吸塵器','ALL','吸塵器|car vacuum','interior',28800,'','清潔|車內');
add('車內用品','car-air-freshener','車內空氣清新 / 除味','ALL','除味|air freshener|車廂','interior',6800,'','車內|除味');
add('車內用品','sunshade','遮陽擋','ALL','遮陽擋|sunshade|隔熱','accessory',15800,'','車內');
add('車內用品','trunk-organizer','後備箱收納','ALL','收納|trunk organizer|後備箱','accessory',23800,'','車內|收納');

add('安全 / 應急用品','first-aid-kit','急救包','ALL','急救|first aid|emergency','safety',19800,'','應急|北上');
add('安全 / 應急用品','reflective-vest','反光背心','ALL','反光背心|reflective vest|emergency','safety',5800,'','應急|北上');
add('安全 / 應急用品','warning-triangle','警示三角牌','ALL','三角牌|warning triangle|應急','safety',8800,'','應急|北上');
add('安全 / 應急用品','window-breaker','破窗器','ALL','破窗器|window breaker|安全錘','safety',9800,'','應急|安全');
add('安全 / 應急用品','tow-rope','拖車繩','ALL','拖車繩|tow rope|recovery','safety',18800,'','應急|北上');
add('安全 / 應急用品','jumper-cable','搭電線','ALL','搭電線|jumper cable|過江龍','safety',16800,'','應急');
add('安全 / 應急用品','car-fire-extinguisher','車用滅火器','ALL','滅火器|fire extinguisher|安全','safety',23800,'','應急|安全');
add('安全 / 應急用品','flashlight','電筒','ALL','電筒|flashlight|emergency','safety',12800,'','應急|北上');

add('工具 / DIY','basic-tool-kit','基本工具套裝','ALL','工具套裝|tool kit|DIY','tool',38800,'','DIY|應急');
add('工具 / DIY','torque-wrench','扭力扳手','ALL','扭力扳手|torque wrench','tool',42800,'','DIY|更換');
add('工具 / DIY','car-jack','千斤頂','ALL','千斤頂|jack|換胎','tool',48800,'','DIY|應急');
add('工具 / DIY','wheel-wrench','車輪扳手','ALL','wheel wrench|輪胎工具','tool',18800,'','DIY|應急');
add('工具 / DIY','obd2-scanner','OBD-II Scanner','ICE|Hybrid|PHEV','OBD|OBD2|scanner|故障碼','tool',38800,'OBD-II','DIY|診斷');

add('EV 專區','type2-charging-cable','Type 2 充電線','EV|PHEV','Type 2|EV charging cable|充電線','ev',168800,'Type 2','充電|北上');
add('EV 專區','ccs2-accessories','CCS2 相關配件','EV','CCS2|DC charging|EV','ev',38800,'CCS2','充電');
add('EV 專區','portable-ev-charger','家用充電線','EV|PHEV','portable EV charger|隨車充|充電器','ev',288800,'Type 2','充電');
add('EV 專區','charging-port-protection','充電口防護','EV|PHEV','charging port|充電口|防護','ev',18800,'','充電|保護');
add('EV 專區','ev-low-voltage-battery','EV 低壓電池','EV','EV 12V battery|低壓電池','battery',158800,'12V','更換');

add('Hybrid 專區','hybrid-zone-coolant','Hybrid 冷卻液','Hybrid','hybrid coolant|混能','coolant',19800,'Hybrid','保養|更換');
add('Hybrid 專區','hybrid-battery-filter','Hybrid 電池進氣濾網','Hybrid','hybrid battery filter|電池濾網','filter',16800,'Hybrid','保養|更換');
add('Hybrid 專區','hybrid-12v-battery','Hybrid 12V 電池','Hybrid','hybrid 12V|auxiliary battery','battery',148800,'12V','更換');

add('摩托車專區','motorcycle-oil','摩托車機油','MOTORCYCLE','motorcycle oil|電單車機油|4T','moto',18800,'4T','保養|更換','motorcycle');
add('摩托車專區','chain-lube','鏈條油','MOTORCYCLE','chain lube|鏈條油','moto',8800,'','保養','motorcycle');
add('摩托車專區','chain-cleaner','鏈條清潔劑','MOTORCYCLE','chain cleaner|鏈條清潔','moto',7800,'','清潔','motorcycle');
add('摩托車專區','motorcycle-brake-pad','摩托車煞車皮','MOTORCYCLE','motorcycle brake pad|電單車煞車皮','moto',26800,'','更換','motorcycle');
add('摩托車專區','motorcycle-tyre','摩托車輪胎','MOTORCYCLE','motorcycle tyre|電單車輪胎','moto',58800,'','更換','motorcycle');

add('套餐 / Bundles','basic-service-kit','基本保養套裝','ICE|Hybrid','保養套裝|機油+機油隔|service kit','oil',48800,'','保養|套餐');
add('套餐 / Bundles','minor-service-kit','小保養套裝','ICE|Hybrid','小保養|minor service|機油|filter','filter',56800,'','保養|套餐');
add('套餐 / Bundles','ac-service-kit','冷氣保養套裝','ALL','冷氣保養|cabin filter|除味','interior',29800,'','保養|除味|套餐');
add('套餐 / Bundles','brake-service-kit','煞車保養套裝','ALL','煞車保養|brake kit|煞車皮|煞車油','brake',88800,'','保養|套餐');
add('套餐 / Bundles','used-car-baseline-kit','二手車接手套裝','ALL','二手車|接手保養|baseline|used car','tool',98800,'','保養|基準|套餐');
add('套餐 / Bundles','road-trip-emergency-kit','長途 / 北上應急套裝','ALL','北上|橫琴|應急|road trip|emergency kit','safety',68800,'','北上|應急|套餐');
add('套餐 / Bundles','car-care-bundle','洗車護理套裝','ALL','洗車套裝|detailing kit|car care','wash',42800,'','清潔|套餐');

export const SHOP_CATALOG = rows.map((row, index) => {
  const [image_url, image_position] = ART[row.art];
  const applies = row.powertrains.includes('ALL') ? '所有動力車型' : row.powertrains.join(' / ');
  return {
    id: `catalog-${row.slug}`, slug: row.slug, name: row.name, category: row.category,
    short_description: `${row.name}，適用於 ${applies}；購買前請按 Vehicle Passport 核對規格。`,
    description: `BOOUNDLESS 精選 ${row.name}。系統會先按車輛類型及動力系統篩選；涉及尺寸、黏度或原廠認證時，請以車主手冊及實車資料為準。`,
    tags: [...new Set([row.name, row.category, ...row.tags])], vehicle_types: row.vehicle_types,
    powertrains: row.powertrains, compatible_makes: [], compatible_models: [], compatible_years: [],
    specifications: row.specifications, use_cases: row.use_cases, image_url, image_position,
    image_alt: `${row.name} 商品圖片`, price_minor: row.price_minor, stock_quantity: 12 + (index % 17),
    sku: `BL-${String(index + 1).padStart(3, '0')}`, featured: index < 8,
  };
});

export async function seedShopCatalog(db) {
  const payload = JSON.stringify(SHOP_CATALOG);
  await db.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
        id text, slug text, name text, category text, short_description text, description text,
        tags text[], vehicle_types text[], powertrains text[], compatible_makes text[], compatible_models text[],
        compatible_years integer[], specifications text[], use_cases text[], image_url text, image_position text,
        image_alt text, price_minor integer, stock_quantity integer, sku text, featured boolean
      )
    )
    INSERT INTO shop_products(id,slug,name,category,short_description,description,tags,vehicle_types,powertrains,
      compatible_makes,compatible_models,compatible_years,specifications,use_cases,primary_image_url,primary_image_alt,
      image_position,is_active,is_featured)
    SELECT id,slug,name,category,short_description,description,tags,vehicle_types,powertrains,compatible_makes,
      compatible_models,compatible_years,specifications,use_cases,image_url,image_alt,image_position,TRUE,featured FROM incoming
    ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,category=EXCLUDED.category,
      short_description=EXCLUDED.short_description,description=EXCLUDED.description,tags=EXCLUDED.tags,
      vehicle_types=EXCLUDED.vehicle_types,powertrains=EXCLUDED.powertrains,compatible_makes=EXCLUDED.compatible_makes,
      compatible_models=EXCLUDED.compatible_models,compatible_years=EXCLUDED.compatible_years,
      specifications=EXCLUDED.specifications,use_cases=EXCLUDED.use_cases,primary_image_url=EXCLUDED.primary_image_url,
      primary_image_alt=EXCLUDED.primary_image_alt,image_position=EXCLUDED.image_position,is_active=TRUE,
      is_featured=EXCLUDED.is_featured,updated_at=NOW()
  `, [payload]);
  await db.query(`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text,slug text,name text,price_minor integer,stock_quantity integer,sku text)
    )
    INSERT INTO shop_product_variants(id,product_id,sku,variant_name,price_minor,stock_quantity,is_active)
    SELECT 'variant-'||slug,id,sku,'標準規格',price_minor,stock_quantity,TRUE FROM incoming
    ON CONFLICT(id) DO UPDATE SET sku=EXCLUDED.sku,price_minor=EXCLUDED.price_minor,is_active=TRUE,updated_at=NOW()
  `, [payload]);
  await db.query(`UPDATE shop_products SET is_active=FALSE,updated_at=NOW()
    WHERE id IN ('prod-oil-0w20','prod-oil-5w30','prod-filter','prod-coolant','prod-care')`);
}
