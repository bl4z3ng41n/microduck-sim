// Country-aware vendor links for the shopping list. Each vendor is a search
// URL builder; items carry per-vendor-kind queries (a marketplace gets a
// descriptive phrase, a distributor gets the part number). Lead times are
// typical delivery ranges in days, by vendor kind and country. Estimates.

export type VendorKind = 'marketplace' | 'distributor' | 'robotics' | 'maker' | 'pcb' | 'intl';

export interface Country {
	code: string;
	name: string;
	flag: string;
	region: 'NA' | 'LATAM' | 'EU' | 'UK' | 'APAC' | 'SA';
	vendors: Vendor[];
}

export interface Vendor {
	name: string;
	kind: VendorKind;
	url: (q: string) => string;
	leadDays: [number, number];
}

export interface FixedLink {
	vendor: string;
	url: string;
	countries: 'all' | string[];
	leadDays: [number, number];
	kind?: VendorKind;
}

export interface Queries {
	marketplace?: string; // Amazon-style phrase
	distributor?: string; // Digi-Key / Mouser part number
	robotics?: string; // RobotShop / Generation Robots
	maker?: string; // Pi shops, Seeed, Core Electronics
}

export interface ResolvedLink {
	vendor: string;
	url: string;
	kind: VendorKind;
	leadDays: [number, number];
	fixed?: boolean;
}

const enc = encodeURIComponent;
const dash = (q: string) => q.trim().replace(/\s+/g, '-');

// Shared builders
const amazon = (tld: string, lead: [number, number] = [2, 6]): Vendor => ({ name: `Amazon.${tld}`, kind: 'marketplace', url: (q) => `https://www.amazon.${tld}/s?k=${enc(q)}`, leadDays: lead });
const digikey = (tld: string, label: string): Vendor => ({ name: `Digi-Key ${label}`, kind: 'distributor', url: (q) => `https://www.digikey.${tld}/en/products/result?keywords=${enc(q)}`, leadDays: [2, 6] });
const mouser = (host: string, label: string): Vendor => ({ name: `Mouser ${label}`, kind: 'distributor', url: (q) => `https://${host}/c/?q=${enc(q)}`, leadDays: [2, 6] });
const robotshop = (sub: string, label: string): Vendor => ({ name: `RobotShop ${label}`, kind: 'robotics', url: (q) => `https://${sub}robotshop.com/search?q=${enc(q)}`, leadDays: [3, 8] });
const aliexpress: Vendor = { name: 'AliExpress', kind: 'intl', url: (q) => `https://www.aliexpress.com/w/wholesale-${enc(dash(q))}.html`, leadDays: [15, 35] };
const jlcpcb: Vendor = { name: 'JLCPCB (PCBA)', kind: 'pcb', url: () => 'https://jlcpcb.com/', leadDays: [14, 25] };
const pcbway: Vendor = { name: 'PCBWay (PCBA)', kind: 'pcb', url: () => 'https://www.pcbway.com/', leadDays: [14, 25] };
const mcmaster: Vendor = { name: 'McMaster-Carr', kind: 'marketplace', url: () => 'https://www.mcmaster.com/', leadDays: [1, 3] };
const seeed: Vendor = { name: 'Seeed Studio', kind: 'maker', url: (q) => `https://www.seeedstudio.com/catalogsearch/result/?q=${enc(q)}`, leadDays: [7, 20] };
const shopify = (name: string, host: string, kind: VendorKind, lead: [number, number] = [3, 8]): Vendor => ({ name, kind, url: (q) => `https://${host}/search?q=${enc(q)}`, leadDays: lead });
const presta = (name: string, base: string, kind: VendorKind, lead: [number, number] = [3, 8]): Vendor => ({ name, kind, url: (q) => `${base}/search?controller=search&s=${enc(q)}`, leadDays: lead });

export const COUNTRIES: Country[] = [
	{ code: 'XX', name: 'Worldwide', flag: '🌐', region: 'APAC', vendors: [amazon('com', [7, 20]), robotshop('www.', 'International'), digikey('com', 'International'), mouser('www.mouser.com', 'International'), seeed, aliexpress, jlcpcb, pcbway] },
	{ code: 'CA', name: 'Canada', flag: '🇨🇦', region: 'NA', vendors: [amazon('ca'), robotshop('ca.', '(Mirabel, QC)'), digikey('ca', 'Canada'), mouser('www.mouser.ca', 'Canada'), { name: 'PiShop.ca', kind: 'maker', url: (q) => `https://www.pishop.ca/search.php?search_query=${enc(q)}`, leadDays: [2, 6] }, mcmaster, aliexpress, jlcpcb, pcbway] },
	{ code: 'US', name: 'United States', flag: '🇺🇸', region: 'NA', vendors: [amazon('com', [1, 4]), robotshop('www.', 'US'), digikey('com', 'US'), mouser('www.mouser.com', 'US'), shopify('SparkFun', 'www.sparkfun.com', 'maker', [3, 7]), { name: 'Adafruit', kind: 'maker', url: (q) => `https://www.adafruit.com/search?q=${enc(q)}`, leadDays: [3, 7] }, mcmaster, aliexpress, jlcpcb, pcbway] },
	{ code: 'MX', name: 'Mexico', flag: '🇲🇽', region: 'LATAM', vendors: [amazon('com.mx', [2, 7]), { name: 'Mercado Libre MX', kind: 'marketplace', url: (q) => `https://listado.mercadolibre.com.mx/${enc(dash(q))}`, leadDays: [2, 8] }, digikey('com.mx', 'México'), mouser('www.mouser.mx', 'México'), shopify('330ohms', 'www.330ohms.com', 'maker', [2, 6]), aliexpress, jlcpcb, pcbway] },
	{ code: 'BR', name: 'Brazil', flag: '🇧🇷', region: 'LATAM', vendors: [amazon('com.br', [3, 10]), { name: 'Mercado Livre BR', kind: 'marketplace', url: (q) => `https://lista.mercadolivre.com.br/${enc(dash(q))}`, leadDays: [3, 10] }, digikey('com.br', 'Brasil'), mouser('br.mouser.com', 'Brasil'), aliexpress, jlcpcb, pcbway] },
	{ code: 'GB', name: 'United Kingdom', flag: '🇬🇧', region: 'UK', vendors: [amazon('co.uk', [1, 4]), robotshop('uk.', 'UK'), shopify('The Pi Hut', 'thepihut.com', 'maker', [2, 5]), shopify('Pimoroni', 'shop.pimoroni.com', 'maker', [2, 5]), { name: 'RS Components UK', kind: 'distributor', url: (q) => `https://uk.rs-online.com/web/c/?searchTerm=${enc(q)}`, leadDays: [1, 4] }, { name: 'Farnell UK', kind: 'distributor', url: (q) => `https://uk.farnell.com/search?st=${enc(q)}`, leadDays: [1, 4] }, digikey('co.uk', 'UK'), mouser('www.mouser.co.uk', 'UK'), aliexpress, jlcpcb, pcbway] },
	{ code: 'DE', name: 'Germany', flag: '🇩🇪', region: 'EU', vendors: [amazon('de', [1, 4]), { name: 'MyBotShop', kind: 'robotics', url: (q) => `https://www.mybotshop.de/search?search=${enc(q)}`, leadDays: [2, 6] }, robotshop('eu.', 'EU'), { name: 'Reichelt', kind: 'distributor', url: (q) => `https://www.reichelt.de/index.html?ACTION=446&LA=446&nbc=1&q=${enc(q)}`, leadDays: [1, 4] }, { name: 'Conrad', kind: 'distributor', url: (q) => `https://www.conrad.de/de/search.html?search=${enc(q)}`, leadDays: [1, 4] }, shopify('BerryBase', 'www.berrybase.de', 'maker', [2, 5]), digikey('de', 'Deutschland'), mouser('www.mouser.de', 'Deutschland'), aliexpress, jlcpcb, pcbway] },
	{ code: 'FR', name: 'France', flag: '🇫🇷', region: 'EU', vendors: [amazon('fr', [1, 4]), presta('Génération Robots', 'https://www.generationrobots.com/en', 'robotics', [2, 6]), robotshop('eu.', 'EU'), presta('Kubii', 'https://www.kubii.com/fr', 'maker', [2, 5]), digikey('fr', 'France'), mouser('www.mouser.fr', 'France'), aliexpress, jlcpcb, pcbway] },
	{ code: 'ES', name: 'Spain', flag: '🇪🇸', region: 'EU', vendors: [amazon('es', [1, 4]), presta('BricoGeek', 'https://tienda.bricogeek.com', 'maker', [2, 6]), robotshop('eu.', 'EU'), digikey('es', 'España'), mouser('www.mouser.es', 'España'), aliexpress, jlcpcb, pcbway] },
	{ code: 'IT', name: 'Italy', flag: '🇮🇹', region: 'EU', vendors: [amazon('it', [1, 4]), { name: 'Robot Italy', kind: 'robotics', url: (q) => `https://www.robot-italy.com/it/catalogsearch/result/?q=${enc(q)}`, leadDays: [2, 6] }, robotshop('eu.', 'EU'), digikey('it', 'Italia'), mouser('www.mouser.it', 'Italia'), aliexpress, jlcpcb, pcbway] },
	{ code: 'NL', name: 'Netherlands / Belgium', flag: '🇳🇱', region: 'EU', vendors: [amazon('nl', [1, 4]), presta('Kiwi Electronics', 'https://www.kiwi-electronics.com/en', 'maker', [1, 4]), robotshop('eu.', 'EU'), digikey('nl', 'Nederland'), mouser('www.mouser.com', 'EU'), aliexpress, jlcpcb, pcbway] },
	{ code: 'PL', name: 'Poland', flag: '🇵🇱', region: 'EU', vendors: [amazon('pl', [1, 4]), presta('Botland', 'https://botland.com.pl', 'maker', [1, 4]), robotshop('eu.', 'EU'), digikey('pl', 'Polska'), mouser('www.mouser.com', 'EU'), aliexpress, jlcpcb, pcbway] },
	{ code: 'SE', name: 'Sweden / Nordics', flag: '🇸🇪', region: 'EU', vendors: [amazon('se', [1, 5]), { name: 'Electrokit', kind: 'maker', url: (q) => `https://www.electrokit.com/en/?s=${enc(q)}`, leadDays: [1, 4] }, robotshop('eu.', 'EU'), digikey('se', 'Sverige'), mouser('www.mouser.se', 'Sverige'), aliexpress, jlcpcb, pcbway] },
	{ code: 'EU', name: 'Other EU', flag: '🇪🇺', region: 'EU', vendors: [amazon('de', [2, 6]), robotshop('eu.', 'EU'), presta('Génération Robots', 'https://www.generationrobots.com/en', 'robotics', [3, 8]), digikey('de', 'Europe'), mouser('www.mouser.com', 'Europe'), aliexpress, jlcpcb, pcbway] },
	{ code: 'AU', name: 'Australia', flag: '🇦🇺', region: 'APAC', vendors: [amazon('com.au', [2, 6]), { name: 'Core Electronics', kind: 'maker', url: (q) => `https://core-electronics.com.au/catalogsearch/result/?q=${enc(q)}`, leadDays: [2, 6] }, shopify('Little Bird', 'littlebird.com.au', 'maker', [2, 6]), { name: 'element14 AU', kind: 'distributor', url: (q) => `https://au.element14.com/search?st=${enc(q)}`, leadDays: [1, 4] }, digikey('com.au', 'Australia'), mouser('au.mouser.com', 'Australia'), aliexpress, jlcpcb, pcbway] },
	{ code: 'JP', name: 'Japan', flag: '🇯🇵', region: 'APAC', vendors: [amazon('co.jp', [1, 4]), shopify('Switch Science', 'www.switch-science.com', 'maker', [1, 4]), robotshop('jp.', 'Japan'), digikey('jp', 'Japan'), mouser('www.mouser.jp', 'Japan'), aliexpress, jlcpcb, pcbway] },
	{ code: 'KR', name: 'South Korea', flag: '🇰🇷', region: 'APAC', vendors: [{ name: 'Coupang', kind: 'marketplace', url: (q) => `https://www.coupang.com/np/search?q=${enc(q)}`, leadDays: [1, 3] }, { name: 'Devicemart', kind: 'maker', url: (q) => `https://www.devicemart.co.kr/goods/search?keyword=${enc(q)}`, leadDays: [1, 4] }, digikey('kr', 'Korea'), mouser('kr.mouser.com', 'Korea'), aliexpress, jlcpcb, pcbway] },
	{ code: 'CN', name: 'China', flag: '🇨🇳', region: 'APAC', vendors: [{ name: 'Taobao', kind: 'marketplace', url: (q) => `https://s.taobao.com/search?q=${enc(q)}`, leadDays: [1, 5] }, { name: 'JD.com', kind: 'marketplace', url: (q) => `https://search.jd.com/Search?keyword=${enc(q)}`, leadDays: [1, 4] }, seeed, { name: 'LCSC', kind: 'distributor', url: (q) => `https://www.lcsc.com/search?q=${enc(q)}`, leadDays: [2, 5] }, mouser('www.mouser.cn', 'China'), jlcpcb, pcbway] },
	{ code: 'IN', name: 'India', flag: '🇮🇳', region: 'APAC', vendors: [amazon('in', [2, 6]), { name: 'Robu.in', kind: 'maker', url: (q) => `https://robu.in/?s=${enc(q)}`, leadDays: [2, 7] }, digikey('in', 'India'), mouser('www.mouser.in', 'India'), aliexpress, jlcpcb, pcbway] },
	{ code: 'SG', name: 'Singapore', flag: '🇸🇬', region: 'APAC', vendors: [amazon('sg', [2, 6]), { name: 'Shopee SG', kind: 'marketplace', url: (q) => `https://shopee.sg/search?keyword=${enc(q)}`, leadDays: [2, 7] }, digikey('sg', 'Singapore'), mouser('www.mouser.sg', 'Singapore'), aliexpress, jlcpcb, pcbway] },
	{ code: 'ZA', name: 'South Africa', flag: '🇿🇦', region: 'SA', vendors: [{ name: 'Takealot', kind: 'marketplace', url: (q) => `https://www.takealot.com/all?qsearch=${enc(q)}`, leadDays: [2, 6] }, { name: 'RS South Africa', kind: 'distributor', url: (q) => `https://za.rs-online.com/web/c/?searchTerm=${enc(q)}`, leadDays: [2, 5] }, mouser('www.mouser.com', 'Intl'), aliexpress, jlcpcb, pcbway] }
];

/** Default destination: Worldwide (international vendors). */
export const DEFAULT_COUNTRY = 'XX';

// Worldwide first (default), then countries alphabetically by name.
COUNTRIES.sort((a, b) => (a.code === 'XX' ? -1 : b.code === 'XX' ? 1 : a.name.localeCompare(b.name, 'en')));

export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Lead time to `code` for ROBOTIS US and other US-shipping stores. */
export function shipsFromUs(code: string): [number, number] {
	if (code === 'US') return [3, 7];
	if (code === 'CA' || code === 'MX') return [7, 14];
	return [10, 21];
}

/** Resolve the vendor links for one item in one country. */
export function linksFor(
	item: { queries: Queries; kinds?: VendorKind[]; fixed?: FixedLink[] },
	code: string
): ResolvedLink[] {
	const country = COUNTRY_BY_CODE.get(code) ?? COUNTRY_BY_CODE.get(DEFAULT_COUNTRY)!;
	const out: ResolvedLink[] = [];
	for (const f of item.fixed ?? []) {
		if (f.countries === 'all' || f.countries.includes(code)) {
			out.push({ vendor: f.vendor, url: f.url, kind: f.kind ?? 'robotics', leadDays: f.vendor.startsWith('ROBOTIS US') ? shipsFromUs(code) : f.leadDays, fixed: true });
		}
	}
	const allowed = new Set<VendorKind>(item.kinds ?? ['marketplace', 'distributor', 'robotics', 'maker', 'intl']);
	for (const v of country.vendors) {
		if (!allowed.has(v.kind)) continue;
		const q = v.kind === 'distributor' ? item.queries.distributor ?? item.queries.marketplace
			: v.kind === 'robotics' ? item.queries.robotics ?? item.queries.marketplace
			: v.kind === 'maker' ? item.queries.maker ?? item.queries.marketplace
			: item.queries.marketplace ?? item.queries.distributor;
		if (!q && v.kind !== 'pcb') continue;
		out.push({ vendor: v.name, url: v.url(q ?? ''), kind: v.kind, leadDays: v.leadDays });
	}
	return out;
}
