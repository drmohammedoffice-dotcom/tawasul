import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchBusinessInsights, fetchMyBusiness, fetchStoreCatalog, fetchStoreOrders, placeStoreOrder, updateBusiness, upsertStoreProduct } from '@/api/accounts';
import { useI18n } from '@/i18n/I18nProvider';
import { COUNTRY_DIAL_CODES, filterCountries } from '@/lib/countryCodes';
import { MediaFrame } from '../ui/MediaFrame';
import { EmptyState, ErrorBanner, PageLoader } from '../ui/States';
import { useToast } from '../ui/Toast';
import { resolveMediaUrl } from '@/api/social';
const IRAQ_GOVERNORATES = [
    'بغداد',
    'البصرة',
    'نينوى',
    'أربيل',
    'السليمانية',
    'دهوك',
    'كركوك',
    'الأنبار',
    'ديالى',
    'صلاح الدين',
    'بابل',
    'كربلاء',
    'النجف',
    'واسط',
    'ميسان',
    'ذي قار',
    'المثنى',
    'القادسية'
];
const CART_KEY = (u) => `securechat.cart.${u}`;
function loadCart(username) {
    try {
        const raw = localStorage.getItem(CART_KEY(username));
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    }
    catch {
        return [];
    }
}
function saveCart(username, lines) {
    try {
        localStorage.setItem(CART_KEY(username), JSON.stringify(lines));
    }
    catch {
        /* ignore */
    }
}
export function BusinessCatalogPage() {
    const { t } = useI18n();
    const { idOrUsername = '' } = useParams();
    const navigate = useNavigate();
    const { push } = useToast();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [cart, setCart] = useState(() => loadCart(idOrUsername));
    useEffect(() => {
        setLoading(true);
        void fetchStoreCatalog(idOrUsername)
            .then(setData)
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            .finally(() => setLoading(false));
    }, [idOrUsername, t]);
    useEffect(() => {
        saveCart(idOrUsername, cart);
    }, [cart, idOrUsername]);
    const cartCount = cart.reduce((n, l) => n + l.quantity, 0);
    function addToCart(p, buyNow = false) {
        setCart((prev) => {
            const existing = prev.find((l) => l.productId === p.id);
            const imageUrl = p.media?.secureUrl ? resolveMediaUrl(p.media.secureUrl) : null;
            const next = existing
                ? prev.map((l) => (l.productId === p.id ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l))
                : [
                    ...prev,
                    {
                        productId: p.id,
                        title: p.title,
                        priceIqd: p.priceIqd,
                        quantity: 1,
                        media: p.media,
                        deliveryFeeIqd: Number(p.deliveryFeeIqd) || 0,
                        imageUrl
                    }
                ];
            return next;
        });
        push(t('addedToCart'), 'success');
        if (buyNow)
            navigate(`/u/${idOrUsername}/store/checkout`);
    }
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { className: "store-page store-page-with-fab", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('productCatalog') }), _jsx("div", { className: "inline-actions", children: _jsx(Link, { className: "button button-ghost button-compact", to: `/u/${idOrUsername}`, children: t('back') }) })] }), error ? _jsx(ErrorBanner, { message: error }) : null, !data?.products?.length ? _jsx(EmptyState, { title: t('emptyCatalog') }) : null, _jsx("div", { className: "store-grid", children: (data?.products || []).map((p) => (_jsxs("article", { className: "store-card", children: [p.media ? (_jsx(MediaFrame, { mediaId: p.media.id, secureUrl: p.media.secureUrl, mimeType: p.media.mimeType, processingStatus: p.media.processingStatus, variant: "grid", controls: false })) : null, _jsx("h3", { children: p.title }), _jsxs("p", { className: "store-price", children: [p.priceIqd.toLocaleString(), " ", p.currency || 'IQD'] }), p.deliveryFeeIqd > 0 ? (_jsxs("p", { className: "muted tiny", children: [t('deliveryFee'), ": ", Number(p.deliveryFeeIqd).toLocaleString(), " IQD"] })) : null, !p.inStock ? _jsx("p", { className: "field-error", children: t('outOfStock') }) : null, _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: "button button-compact button-ghost", disabled: !p.inStock, onClick: () => addToCart(p), children: t('addToCart') }), _jsx("button", { type: "button", className: "button button-compact", disabled: !p.inStock, onClick: () => addToCart(p, true), children: t('buyNow') })] })] }, p.id))) }), _jsxs(Link, { to: `/u/${idOrUsername}/store/checkout`, className: "store-cart-fab", "aria-label": t('cart'), children: [_jsx("span", { className: "store-cart-fab-icon", "aria-hidden": true, children: "\uD83D\uDED2" }), cartCount > 0 ? _jsx("span", { className: "store-cart-fab-badge", children: cartCount }) : null] })] }));
}
export function BusinessCheckoutPage() {
    const { t, locale } = useI18n();
    const { idOrUsername = '' } = useParams();
    const navigate = useNavigate();
    const { push } = useToast();
    const [cart, setCart] = useState(() => loadCart(idOrUsername));
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [countryCode, setCountryCode] = useState('IQ');
    const [countryQ, setCountryQ] = useState('');
    const [countryOpen, setCountryOpen] = useState(false);
    const [governorate, setGovernorate] = useState(IRAQ_GOVERNORATES[0] || 'بغداد');
    const [area, setArea] = useState('');
    const [landmark, setLandmark] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [defaultDelivery, setDefaultDelivery] = useState(0);
    useEffect(() => {
        void fetchStoreCatalog(idOrUsername)
            .then((data) => {
            const fee = Number(data?.business?.defaultDeliveryFeeIqd ?? data?.defaultDeliveryFeeIqd ?? 0) || 0;
            setDefaultDelivery(fee);
            setCart((prev) => {
                const products = data?.products || [];
                const next = prev.map((l) => {
                    const p = products.find((x) => x.id === l.productId);
                    if (!p)
                        return l;
                    const imageUrl = p.media?.secureUrl
                        ? resolveMediaUrl(p.media.secureUrl) || null
                        : l.imageUrl ?? null;
                    return {
                        ...l,
                        title: p.title || l.title,
                        priceIqd: p.priceIqd ?? l.priceIqd,
                        deliveryFeeIqd: Number(p.deliveryFeeIqd) || fee || l.deliveryFeeIqd || 0,
                        media: p.media || l.media,
                        imageUrl
                    };
                });
                saveCart(idOrUsername, next);
                return next;
            });
        })
            .catch(() => undefined);
    }, [idOrUsername]);
    const subtotal = useMemo(() => cart.reduce((s, l) => s + l.priceIqd * l.quantity, 0), [cart]);
    const deliveryTotal = useMemo(() => {
        if (!cart.length)
            return 0;
        const perLine = cart.map((l) => Number(l.deliveryFeeIqd) || defaultDelivery || 0);
        return Math.max(...perLine, 0);
    }, [cart, defaultDelivery, governorate]);
    const total = subtotal + deliveryTotal;
    const selectedCountry = COUNTRY_DIAL_CODES.find((c) => c.code === countryCode) ?? COUNTRY_DIAL_CODES[0];
    const countryOptions = useMemo(() => filterCountries(countryQ, locale === 'ar' ? 'ar' : 'en'), [countryQ, locale]);
    function setQty(productId, quantity) {
        setCart((prev) => {
            const next = prev
                .map((l) => (l.productId === productId ? { ...l, quantity } : l))
                .filter((l) => l.quantity > 0);
            saveCart(idOrUsername, next);
            return next;
        });
    }
    async function onSubmit(e) {
        e.preventDefault();
        if (!cart.length)
            return;
        setBusy(true);
        setError('');
        try {
            await placeStoreOrder(idOrUsername, {
                customerName: name.trim(),
                phone: `${selectedCountry.dial} ${phone.trim()}`.trim(),
                countryCode,
                governorate,
                area: area.trim(),
                items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                ...(landmark.trim() ? { landmark: landmark.trim() } : {})
            });
            saveCart(idOrUsername, []);
            setCart([]);
            setDone(true);
            push(t('orderThanks'), 'success');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    if (done) {
        return (_jsx("div", { className: "store-page", children: _jsx(EmptyState, { title: t('orderThanks'), action: _jsx(Link, { className: "button", to: `/u/${idOrUsername}`, children: t('backToProfile') }) }) }));
    }
    return (_jsxs("div", { className: "store-page checkout-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('checkout') }), _jsx(Link, { className: "button button-ghost button-compact", to: `/u/${idOrUsername}/store`, children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, !cart.length ? _jsx(EmptyState, { title: t('emptyCart') }) : null, _jsxs("div", { className: "checkout-layout", children: [_jsxs("div", { className: "checkout-cart", children: [cart.map((l) => (_jsxs("div", { className: "checkout-line checkout-line-media", children: [_jsx("div", { className: "checkout-thumb", children: l.imageUrl || l.media?.secureUrl ? (_jsx("img", { src: l.imageUrl || resolveMediaUrl(l.media.secureUrl) || '', alt: "" })) : l.media ? (_jsx(MediaFrame, { mediaId: l.media.id, secureUrl: l.media.secureUrl, mimeType: l.media.mimeType, processingStatus: l.media.processingStatus, variant: "grid", controls: false })) : (_jsx("span", { className: "checkout-thumb-fallback", children: l.title.slice(0, 1) })) }), _jsxs("div", { className: "checkout-line-info", children: [_jsx("strong", { children: l.title }), _jsxs("p", { className: "muted tiny", children: [l.priceIqd.toLocaleString(), " IQD"] }), (Number(l.deliveryFeeIqd) || defaultDelivery) > 0 ? (_jsxs("p", { className: "muted tiny", children: [t('deliveryByGovernorate'), ": ", (Number(l.deliveryFeeIqd) || defaultDelivery).toLocaleString(), " IQD"] })) : null, _jsxs("div", { className: "qty-controls", children: [_jsx("button", { type: "button", className: "icon-btn", onClick: () => setQty(l.productId, l.quantity - 1), children: "\u2212" }), _jsx("span", { children: l.quantity }), _jsx("button", { type: "button", className: "icon-btn", onClick: () => setQty(l.productId, l.quantity + 1), children: "+" }), _jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => setQty(l.productId, 0), children: t('delete') })] })] })] }, l.productId))), cart.length ? (_jsxs("div", { className: "checkout-totals", children: [_jsxs("p", { children: [_jsx("span", { children: t('cartItems') }), _jsxs("strong", { children: [subtotal.toLocaleString(), " IQD"] })] }), _jsxs("p", { children: [_jsxs("span", { children: [t('deliveryFee'), " (", governorate, ")"] }), _jsxs("strong", { children: [deliveryTotal.toLocaleString(), " IQD"] })] }), _jsxs("p", { className: "checkout-total", children: [_jsxs("strong", { children: [t('total'), ":"] }), " ", total.toLocaleString(), " IQD"] })] })) : null] }), _jsxs("form", { className: "create-form checkout-form", onSubmit: (e) => void onSubmit(e), children: [_jsx("h2", { children: t('bookingInfo') }), _jsxs("label", { className: "field-label", children: [t('customerName'), _jsx("input", { value: name, onChange: (e) => setName(e.target.value), required: true, minLength: 2, dir: "auto" })] }), _jsxs("label", { className: "field-label", children: [t('countryCode'), _jsxs("button", { type: "button", className: "button button-ghost country-picker-trigger", onClick: () => setCountryOpen((v) => !v), children: [selectedCountry.dial, " \u00B7 ", locale === 'ar' ? selectedCountry.nameAr : selectedCountry.nameEn, " (", selectedCountry.code, ")"] }), countryOpen ? (_jsxs("div", { className: "country-picker-sheet", children: [_jsx("input", { value: countryQ, onChange: (e) => setCountryQ(e.target.value), placeholder: `${t('country')} / ${t('countryCode')}`, dir: "auto", autoFocus: true }), _jsx("ul", { className: "country-picker-list", children: countryOptions.map((c) => (_jsx("li", { children: _jsxs("button", { type: "button", onClick: () => {
                                                            setCountryCode(c.code);
                                                            setCountryOpen(false);
                                                            setCountryQ('');
                                                        }, children: [_jsx("strong", { children: c.dial }), _jsxs("span", { children: [locale === 'ar' ? c.nameAr : c.nameEn, " (", c.code, ")"] })] }) }, c.code))) })] })) : null] }), _jsxs("label", { className: "field-label", children: [t('phone'), _jsx("input", { value: phone, onChange: (e) => setPhone(e.target.value), required: true, inputMode: "tel", placeholder: "7XXXXXXXXX", dir: "ltr" })] }), _jsxs("label", { className: "field-label", children: [t('country'), _jsx("button", { type: "button", className: "button button-ghost country-picker-trigger", onClick: () => setCountryOpen((v) => !v), children: locale === 'ar' ? selectedCountry.nameAr : selectedCountry.nameEn })] }), _jsxs("label", { className: "field-label", children: [t('governorate'), _jsx("select", { value: governorate, onChange: (e) => setGovernorate(e.target.value), required: true, children: IRAQ_GOVERNORATES.map((g) => (_jsx("option", { value: g, children: g }, g))) })] }), _jsxs("label", { className: "field-label", children: [t('area'), _jsx("input", { value: area, onChange: (e) => setArea(e.target.value), required: true, dir: "auto" })] }), _jsxs("label", { className: "field-label", children: [t('landmark'), _jsx("input", { value: landmark, onChange: (e) => setLandmark(e.target.value), dir: "auto" })] }), _jsx("button", { className: "button", type: "submit", disabled: busy || !cart.length, children: t('completeBooking') })] })] })] }));
}
export function BusinessOrdersPage() {
    const { t } = useI18n();
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        void fetchStoreOrders()
            .then((rows) => setOrders(Array.isArray(rows) ? rows : []))
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            .finally(() => setLoading(false));
    }, [t]);
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { className: "store-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('storeOrders') }), _jsx(Link, { className: "button button-ghost button-compact", to: "/profile", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, !orders.length ? _jsx(EmptyState, { title: t('emptyOrders') }) : null, _jsx("div", { className: "orders-list", children: orders.map((o) => (_jsxs("article", { className: "order-card", children: [_jsxs("header", { children: [_jsx("strong", { children: o.customerName }), _jsx("span", { className: "muted tiny", children: new Date(o.createdAt).toLocaleString() })] }), _jsx("p", { className: "muted tiny", dir: "ltr", children: o.phoneE164 }), _jsxs("p", { children: [o.governorate, " \u00B7 ", o.area, o.landmark ? ` · ${o.landmark}` : ''] }), _jsx("ul", { children: (o.items || []).map((it) => (_jsxs("li", { children: [it.product?.title || it.productId, " \u00D7 ", it.quantity, " \u2014 ", (it.unitPriceIqd * it.quantity).toLocaleString(), ' ', "IQD"] }, it.id))) }), _jsxs("p", { children: [_jsxs("strong", { children: [t('total'), ":"] }), " ", o.totalIqd.toLocaleString(), " IQD"] })] }, o.id))) })] }));
}
export function BusinessInsightsPage() {
    const { t } = useI18n();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        void fetchBusinessInsights()
            .then(setData)
            .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
            .finally(() => setLoading(false));
    }, [t]);
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { className: "store-page insights-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('insights') }), _jsx(Link, { className: "button button-ghost button-compact", to: "/profile", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, data ? (_jsxs("div", { className: "insights-grid", children: [_jsxs("div", { className: "insight-card", children: [_jsx("strong", { children: data.posts }), _jsx("span", { children: t('posts') })] }), _jsxs("div", { className: "insight-card", children: [_jsx("strong", { children: data.reels }), _jsx("span", { children: t('reels') })] }), _jsxs("div", { className: "insight-card", children: [_jsx("strong", { children: data.followers }), _jsx("span", { children: t('followers') })] }), _jsxs("div", { className: "insight-card", children: [_jsx("strong", { children: data.postViews }), _jsx("span", { children: t('postViews') })] }), _jsxs("div", { className: "insight-card", children: [_jsx("strong", { children: data.reelViews }), _jsx("span", { children: t('reelViews') })] }), _jsxs("div", { className: "insight-card", children: [_jsx("strong", { children: data.catalogProducts }), _jsx("span", { children: t('catalogProducts') })] }), _jsxs("div", { className: "insight-card", children: [_jsx("strong", { children: data.storeOrders }), _jsx("span", { children: t('storeOrders') })] }), _jsxs("div", { className: "insight-card", children: [_jsx("strong", { children: data.itemsSold }), _jsx("span", { children: t('itemsSold') })] })] })) : null, data?.recentOrders?.length ? (_jsxs("section", { className: "insights-recent", children: [_jsx("h2", { children: t('recentOrders') }), _jsx("ul", { children: data.recentOrders.map((o) => (_jsxs("li", { children: [o.customerName, " \u2014 ", o.totalIqd.toLocaleString(), " IQD"] }, o.id))) })] })) : null] }));
}
export function BusinessLinksPage() {
    const { t } = useI18n();
    const { push } = useToast();
    const { idOrUsername } = useParams();
    const [links, setLinks] = useState([]);
    const [isOwner, setIsOwner] = useState(false);
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        void (async () => {
            try {
                if (idOrUsername) {
                    const cat = await fetchStoreCatalog(idOrUsername);
                    const raw = cat?.seller?.externalLinks;
                    setLinks(Array.isArray(raw) ? raw : []);
                    setIsOwner(false);
                }
                else {
                    const mine = await fetchMyBusiness();
                    const raw = mine?.businessProfile?.externalLinks;
                    setLinks(Array.isArray(raw) ? raw : []);
                    setIsOwner(mine?.accountType === 'business');
                }
            }
            catch (err) {
                setError(err instanceof Error ? err.message : t('errorGeneric'));
            }
            finally {
                setLoading(false);
            }
        })();
    }, [idOrUsername, t]);
    async function saveLinks(next) {
        setLinks(next);
        await updateBusiness({ externalLinks: next });
        push(t('changesSaved'), 'success');
    }
    async function addLink(e) {
        e.preventDefault();
        const l = label.trim();
        let u = url.trim();
        if (!l || !u)
            return;
        if (!/^https?:\/\//i.test(u))
            u = `https://${u}`;
        try {
            await saveLinks([...links, { label: l, url: u }]);
            setLabel('');
            setUrl('');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
    }
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { className: "store-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('externalLinks') }), _jsx(Link, { className: "button button-ghost button-compact", to: idOrUsername ? `/u/${idOrUsername}` : '/profile', children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, !links.length ? _jsx(EmptyState, { title: t('emptyLinks') }) : null, _jsx("ul", { className: "links-list", children: links.map((l, i) => (_jsxs("li", { children: [_jsx("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", children: l.label }), isOwner ? (_jsx("button", { type: "button", className: "button button-ghost button-compact", onClick: () => void saveLinks(links.filter((_, idx) => idx !== i)), children: t('delete') })) : null] }, `${l.url}-${i}`))) }), isOwner ? (_jsxs("form", { className: "create-form", onSubmit: (e) => void addLink(e), children: [_jsx("input", { value: label, onChange: (e) => setLabel(e.target.value), placeholder: t('linkLabel'), required: true }), _jsx("input", { value: url, onChange: (e) => setUrl(e.target.value), placeholder: "https://", required: true, dir: "ltr" }), _jsx("button", { className: "button", type: "submit", children: t('addLink') })] })) : null] }));
}
/** Owner helper: mark a post as catalog product. */
export async function markPostAsProduct(postId, priceIqd, title) {
    return upsertStoreProduct({
        postId,
        priceIqd,
        ...(title ? { title } : {})
    });
}
/** Owner: manage catalog products, stock, and delivery fees. */
export function BusinessCatalogManagePage() {
    const { t } = useI18n();
    const { push } = useToast();
    const [data, setData] = useState(null);
    const [posts, setPosts] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [defaultFee, setDefaultFee] = useState('0');
    const [busy, setBusy] = useState(false);
    const [addPostId, setAddPostId] = useState('');
    const [addPrice, setAddPrice] = useState('');
    async function reload() {
        setLoading(true);
        setError('');
        try {
            const { fetchMyStoreCatalog } = await import('@/api/accounts');
            const { fetchMyProfile, fetchUserPosts } = await import('@/api/social');
            const next = await fetchMyStoreCatalog();
            setData(next);
            setDefaultFee(String(next?.defaultDeliveryFeeIqd ?? 0));
            const me = await fetchMyProfile();
            const mine = await fetchUserPosts(me.username || me.id);
            setPosts(Array.isArray(mine) ? mine : []);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void reload();
    }, [t]);
    async function addProduct(e) {
        e.preventDefault();
        const price = Math.round(Number(addPrice));
        if (!addPostId || !Number.isFinite(price) || price < 1) {
            setError(t('setPriceIqd'));
            return;
        }
        setBusy(true);
        setError('');
        try {
            await upsertStoreProduct({ postId: addPostId, priceIqd: price });
            push(t('addToCatalog'), 'success');
            setAddPostId('');
            setAddPrice('');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function saveDefaultFee(e) {
        e.preventDefault();
        setBusy(true);
        try {
            await updateBusiness({ defaultDeliveryFeeIqd: Math.max(0, Math.round(Number(defaultFee) || 0)) });
            push(t('changesSaved'), 'success');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    async function patchProduct(id, body) {
        setBusy(true);
        try {
            const { patchStoreProduct } = await import('@/api/accounts');
            await patchStoreProduct(id, body);
            push(t('changesSaved'), 'success');
            await reload();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : t('errorGeneric'));
        }
        finally {
            setBusy(false);
        }
    }
    if (loading)
        return _jsx(PageLoader, {});
    return (_jsxs("div", { className: "store-page", children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { children: t('manageCatalog') }), _jsx(Link, { className: "button button-ghost button-compact", to: "/profile", children: t('back') })] }), error ? _jsx(ErrorBanner, { message: error }) : null, _jsx("p", { className: "muted", children: t('manageCatalogHint') }), _jsxs("form", { className: "create-form", onSubmit: (e) => void saveDefaultFee(e), children: [_jsxs("label", { className: "field-label", children: [t('defaultDeliveryFee'), _jsx("input", { type: "number", min: 0, value: defaultFee, onChange: (e) => setDefaultFee(e.target.value), disabled: busy })] }), _jsx("button", { className: "button button-compact", type: "submit", disabled: busy, children: t('save') })] }), _jsxs("form", { className: "create-form", onSubmit: (e) => void addProduct(e), children: [_jsx("h2", { className: "settings-card-title", children: t('addToCatalog') }), _jsxs("label", { className: "field-label", children: [t('posts'), _jsxs("select", { value: addPostId, onChange: (e) => setAddPostId(e.target.value), disabled: busy, required: true, children: [_jsx("option", { value: "", children: t('selectPost') }), posts
                                        .filter((p) => !(data?.products || []).some((c) => c.postId === p.id))
                                        .map((p) => (_jsx("option", { value: p.id, children: (p.caption || p.id).slice(0, 48) }, p.id)))] })] }), _jsxs("label", { className: "field-label", children: [t('priceIqd'), _jsx("input", { type: "number", min: 1, value: addPrice, onChange: (e) => setAddPrice(e.target.value), disabled: busy, required: true })] }), _jsx("button", { className: "button", type: "submit", disabled: busy || !addPostId, children: t('addToCatalog') }), !posts.length ? _jsx("p", { className: "muted tiny", children: t('addCatalogFromPostHint') }) : null] }), !data?.products?.length ? _jsx(EmptyState, { title: t('emptyCatalog') }) : null, _jsx("div", { className: "store-manage-list", children: (data?.products || []).map((p) => (_jsxs("article", { className: "store-manage-card", children: [p.media ? (_jsx(MediaFrame, { mediaId: p.media.id, secureUrl: p.media.secureUrl, mimeType: p.media.mimeType, processingStatus: p.media.processingStatus, variant: "grid", controls: false })) : null, _jsxs("div", { className: "store-manage-body", children: [_jsx("strong", { children: p.title }), _jsxs("label", { className: "field-label", children: [t('priceIqd'), _jsx("input", { type: "number", defaultValue: p.priceIqd, disabled: busy, onBlur: (e) => {
                                                const v = Math.round(Number(e.target.value));
                                                if (Number.isFinite(v) && v !== p.priceIqd)
                                                    void patchProduct(p.id, { priceIqd: v });
                                            } })] }), _jsxs("label", { className: "field-label", children: [t('productDeliveryFee'), _jsx("input", { type: "number", placeholder: t('useDefaultDelivery'), defaultValue: p.deliveryFeeIqd ?? '', disabled: busy, onBlur: (e) => {
                                                const raw = e.target.value.trim();
                                                if (raw === '') {
                                                    void patchProduct(p.id, { deliveryFeeIqd: null });
                                                    return;
                                                }
                                                const v = Math.round(Number(raw));
                                                if (Number.isFinite(v))
                                                    void patchProduct(p.id, { deliveryFeeIqd: v });
                                            } })] }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { type: "button", className: `button button-compact ${p.inStock ? '' : 'button-ghost'}`, disabled: busy, onClick: () => void patchProduct(p.id, { inStock: !p.inStock }), children: p.inStock ? t('markOutOfStock') : t('markInStock') }), _jsx("button", { type: "button", className: `button button-compact ${p.active ? 'button-ghost' : ''}`, disabled: busy, onClick: () => void patchProduct(p.id, { active: !p.active }), children: p.active ? t('hideFromCatalog') : t('showInCatalog') })] })] })] }, p.id))) }), _jsx("p", { className: "muted tiny", children: t('addCatalogFromPostHint') })] }));
}
