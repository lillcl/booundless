const VEHICLE_CLASSES = new Set([
  'light_passenger', 'light_goods', 'heavy_passenger',
  'heavy_goods',
]);
const CONFIDENCE_FIELDS = ['make', 'model', 'body_color', 'vehicle_class', 'fuel_type', 'plate', 'year', 'vin'];

export const VEHICLE_VISION_SYSTEM = '你是無界啟程 BOOUNDLESS 的 AI 助手。使用繁體中文，回答精簡實用；不要虛構車況、法規或即時路況，並提醒使用者核實建議。 你是車輛照片辨識助手。只輸出 JSON，格式為 {"make":"","model":"","body_color":"","vehicle_class":"","fuel_type":"","plate":"","year":null,"vin":"","confidence":{"make":"low","model":"low","body_color":"low","vehicle_class":"low","fuel_type":"low","plate":"low","year":"low","vin":"low"}}。vehicle_class 只可為 light_passenger、light_goods、heavy_passenger、heavy_goods 或空字串；fuel_type 只可為燃油、純電、油電混合或空字串。品牌與車款必須相容，例如 Model Y 屬於 Tesla；如果不確定，留空。只讀取主體車輛的車牌，不要讀背景車輛。車牌、年份與 VIN 必須有清楚可見的文字證據；普通車身照片不能推斷年份、VIN、里程或保養狀況。confidence 每欄只可為 low、medium、high。看不清楚的欄位留空，不要猜測。';

export function normalizeVehicleVision(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const clean = (value, max = 80) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const confidence = {};
  for (const key of CONFIDENCE_FIELDS) {
    confidence[key] = ['low', 'medium', 'high'].includes(source.confidence?.[key])
      ? source.confidence[key] : 'low';
  }
  const parsedYear = Number(source.year);
  const vin = clean(source.vin, 30).toUpperCase();
  const vehicle = {
    make: clean(source.make),
    model: clean(source.model),
    body_color: clean(source.body_color, 40),
    vehicle_class: VEHICLE_CLASSES.has(source.vehicle_class) ? source.vehicle_class : '',
    fuel_type: ['燃油', '純電', '油電混合'].includes(source.fuel_type) ? source.fuel_type : '',
    plate: clean(source.plate, 32).toUpperCase(),
    year: source.year != null && source.year !== '' && Number.isInteger(parsedYear)
      && parsedYear >= 1950 && parsedYear <= new Date().getFullYear() + 1 ? parsedYear : null,
    vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : '',
    confidence,
  };
  /* These Tesla model names are unambiguous. A conflicting free-form make
     must not produce a combination such as "Honda Model Y". */
  if (/^(?:tesla\s+)?(?:model\s*[s3xy]|cybertruck)$/i.test(vehicle.model)) {
    if (vehicle.make.toLowerCase() !== 'tesla') confidence.make = 'medium';
    vehicle.make = 'Tesla';
  }
  return vehicle;
}
