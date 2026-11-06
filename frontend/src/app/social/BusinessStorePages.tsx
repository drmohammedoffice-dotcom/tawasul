import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fetchBusinessInsights,
  fetchMyBusiness,
  fetchStoreCatalog,
  fetchStoreOrders,
  placeStoreOrder,
  updateBusiness,
  upsertStoreProduct
} from '@/api/accounts';
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

type CartLine = {
  productId: string;
  title: string;
  priceIqd: number;
  quantity: number;
  media?: any;
  deliveryFeeIqd?: number;
  imageUrl?: string | null;
};

const CART_KEY = (u: string) => `securechat.cart.${u}`;

function loadCart(username: string): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_KEY(username));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveCart(username: string, lines: CartLine[]) {
  try {
    localStorage.setItem(CART_KEY(username), JSON.stringify(lines));
  } catch {
    /* ignore */
  }
}

export function BusinessCatalogPage() {
  const { t } = useI18n();
  const { idOrUsername = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartLine[]>(() => loadCart(idOrUsername));

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

  function addToCart(p: any, buyNow = false) {
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
    if (buyNow) navigate(`/u/${idOrUsername}/store/checkout`);
  }

  if (loading) return <PageLoader />;

  return (
    <div className="store-page store-page-with-fab">
      <div className="page-header">
        <h1>{t('productCatalog')}</h1>
        <div className="inline-actions">
          <Link className="button button-ghost button-compact" to={`/u/${idOrUsername}`}>
            {t('back')}
          </Link>
        </div>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!data?.products?.length ? <EmptyState title={t('emptyCatalog')} /> : null}
      <div className="store-grid">
        {(data?.products || []).map((p: any) => (
          <article key={p.id} className="store-card">
            {p.media ? (
              <MediaFrame
                mediaId={p.media.id}
                secureUrl={p.media.secureUrl}
                mimeType={p.media.mimeType}
                processingStatus={p.media.processingStatus}
                variant="grid"
                controls={false}
              />
            ) : null}
            <h3>{p.title}</h3>
            <p className="store-price">
              {p.priceIqd.toLocaleString()} {p.currency || 'IQD'}
            </p>
            {p.deliveryFeeIqd > 0 ? (
              <p className="muted tiny">
                {t('deliveryFee')}: {Number(p.deliveryFeeIqd).toLocaleString()} IQD
              </p>
            ) : null}
            {!p.inStock ? <p className="field-error">{t('outOfStock')}</p> : null}
            <div className="inline-actions">
              <button
                type="button"
                className="button button-compact button-ghost"
                disabled={!p.inStock}
                onClick={() => addToCart(p)}
              >
                {t('addToCart')}
              </button>
              <button
                type="button"
                className="button button-compact"
                disabled={!p.inStock}
                onClick={() => addToCart(p, true)}
              >
                {t('buyNow')}
              </button>
            </div>
          </article>
        ))}
      </div>
      <Link
        to={`/u/${idOrUsername}/store/checkout`}
        className="store-cart-fab"
        aria-label={t('cart')}
      >
        <span className="store-cart-fab-icon" aria-hidden>
          🛒
        </span>
        {cartCount > 0 ? <span className="store-cart-fab-badge">{cartCount}</span> : null}
      </Link>
    </div>
  );
}

export function BusinessCheckoutPage() {
  const { t, locale } = useI18n();
  const { idOrUsername = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const [cart, setCart] = useState<CartLine[]>(() => loadCart(idOrUsername));
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
          const next: CartLine[] = prev.map((l) => {
            const p = products.find((x: any) => x.id === l.productId);
            if (!p) return l;
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
    if (!cart.length) return 0;
    const perLine = cart.map((l) => Number(l.deliveryFeeIqd) || defaultDelivery || 0);
    return Math.max(...perLine, 0);
  }, [cart, defaultDelivery, governorate]);
  const total = subtotal + deliveryTotal;
  const selectedCountry =
    COUNTRY_DIAL_CODES.find((c) => c.code === countryCode) ?? COUNTRY_DIAL_CODES[0]!;
  const countryOptions = useMemo(
    () => filterCountries(countryQ, locale === 'ar' ? 'ar' : 'en'),
    [countryQ, locale]
  );

  function setQty(productId: string, quantity: number) {
    setCart((prev) => {
      const next = prev
        .map((l) => (l.productId === productId ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0);
      saveCart(idOrUsername, next);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cart.length) return;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="store-page">
        <EmptyState
          title={t('orderThanks')}
          action={
            <Link className="button" to={`/u/${idOrUsername}`}>
              {t('backToProfile')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="store-page checkout-page">
      <div className="page-header">
        <h1>{t('checkout')}</h1>
        <Link className="button button-ghost button-compact" to={`/u/${idOrUsername}/store`}>
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!cart.length ? <EmptyState title={t('emptyCart')} /> : null}

      <div className="checkout-layout">
        <div className="checkout-cart">
          {cart.map((l) => (
            <div key={l.productId} className="checkout-line checkout-line-media">
              <div className="checkout-thumb">
                {l.imageUrl || l.media?.secureUrl ? (
                  <img src={l.imageUrl || resolveMediaUrl(l.media.secureUrl) || ''} alt="" />
                ) : l.media ? (
                  <MediaFrame
                    mediaId={l.media.id}
                    secureUrl={l.media.secureUrl}
                    mimeType={l.media.mimeType}
                    processingStatus={l.media.processingStatus}
                    variant="grid"
                    controls={false}
                  />
                ) : (
                  <span className="checkout-thumb-fallback">{l.title.slice(0, 1)}</span>
                )}
              </div>
              <div className="checkout-line-info">
                <strong>{l.title}</strong>
                <p className="muted tiny">{l.priceIqd.toLocaleString()} IQD</p>
                {(Number(l.deliveryFeeIqd) || defaultDelivery) > 0 ? (
                  <p className="muted tiny">
                    {t('deliveryByGovernorate')}: {(Number(l.deliveryFeeIqd) || defaultDelivery).toLocaleString()} IQD
                  </p>
                ) : null}
                <div className="qty-controls">
                  <button type="button" className="icon-btn" onClick={() => setQty(l.productId, l.quantity - 1)}>
                    −
                  </button>
                  <span>{l.quantity}</span>
                  <button type="button" className="icon-btn" onClick={() => setQty(l.productId, l.quantity + 1)}>
                    +
                  </button>
                  <button
                    type="button"
                    className="button button-ghost button-compact"
                    onClick={() => setQty(l.productId, 0)}
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {cart.length ? (
            <div className="checkout-totals">
              <p>
                <span>{t('cartItems')}</span>
                <strong>{subtotal.toLocaleString()} IQD</strong>
              </p>
              <p>
                <span>
                  {t('deliveryFee')} ({governorate})
                </span>
                <strong>{deliveryTotal.toLocaleString()} IQD</strong>
              </p>
              <p className="checkout-total">
                <strong>{t('total')}:</strong> {total.toLocaleString()} IQD
              </p>
            </div>
          ) : null}
        </div>

        <form className="create-form checkout-form" onSubmit={(e) => void onSubmit(e)}>
          <h2>{t('bookingInfo')}</h2>
          <label className="field-label">
            {t('customerName')}
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} dir="auto" />
          </label>
          <label className="field-label">
            {t('countryCode')}
            <button
              type="button"
              className="button button-ghost country-picker-trigger"
              onClick={() => setCountryOpen((v) => !v)}
            >
              {selectedCountry.dial} · {locale === 'ar' ? selectedCountry.nameAr : selectedCountry.nameEn} (
              {selectedCountry.code})
            </button>
            {countryOpen ? (
              <div className="country-picker-sheet">
                <input
                  value={countryQ}
                  onChange={(e) => setCountryQ(e.target.value)}
                  placeholder={`${t('country')} / ${t('countryCode')}`}
                  dir="auto"
                  autoFocus
                />
                <ul className="country-picker-list">
                  {countryOptions.map((c) => (
                    <li key={c.code}>
                      <button
                        type="button"
                        onClick={() => {
                          setCountryCode(c.code);
                          setCountryOpen(false);
                          setCountryQ('');
                        }}
                      >
                        <strong>{c.dial}</strong>
                        <span>
                          {locale === 'ar' ? c.nameAr : c.nameEn} ({c.code})
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </label>
          <label className="field-label">
            {t('phone')}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              inputMode="tel"
              placeholder="7XXXXXXXXX"
              dir="ltr"
            />
          </label>
          <label className="field-label">
            {t('country')}
            <button
              type="button"
              className="button button-ghost country-picker-trigger"
              onClick={() => setCountryOpen((v) => !v)}
            >
              {locale === 'ar' ? selectedCountry.nameAr : selectedCountry.nameEn}
            </button>
          </label>
          <label className="field-label">
            {t('governorate')}
            <select value={governorate} onChange={(e) => setGovernorate(e.target.value)} required>
              {IRAQ_GOVERNORATES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {t('area')}
            <input value={area} onChange={(e) => setArea(e.target.value)} required dir="auto" />
          </label>
          <label className="field-label">
            {t('landmark')}
            <input value={landmark} onChange={(e) => setLandmark(e.target.value)} dir="auto" />
          </label>
          <button className="button" type="submit" disabled={busy || !cart.length}>
            {t('completeBooking')}
          </button>
        </form>
      </div>
    </div>
  );
}

export function BusinessOrdersPage() {
  const { t } = useI18n();
  const [orders, setOrders] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchStoreOrders()
      .then((rows) => setOrders(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <PageLoader />;

  return (
    <div className="store-page">
      <div className="page-header">
        <h1>{t('storeOrders')}</h1>
        <Link className="button button-ghost button-compact" to="/profile">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!orders.length ? <EmptyState title={t('emptyOrders')} /> : null}
      <div className="orders-list">
        {orders.map((o) => (
          <article key={o.id} className="order-card">
            <header>
              <strong>{o.customerName}</strong>
              <span className="muted tiny">{new Date(o.createdAt).toLocaleString()}</span>
            </header>
            <p className="muted tiny" dir="ltr">
              {o.phoneE164}
            </p>
            <p>
              {o.governorate} · {o.area}
              {o.landmark ? ` · ${o.landmark}` : ''}
            </p>
            <ul>
              {(o.items || []).map((it: any) => (
                <li key={it.id}>
                  {it.product?.title || it.productId} × {it.quantity} — {(it.unitPriceIqd * it.quantity).toLocaleString()}{' '}
                  IQD
                </li>
              ))}
            </ul>
            <p>
              <strong>{t('total')}:</strong> {o.totalIqd.toLocaleString()} IQD
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function BusinessInsightsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchBusinessInsights()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : t('errorGeneric')))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <PageLoader />;

  return (
    <div className="store-page insights-page">
      <div className="page-header">
        <h1>{t('insights')}</h1>
        <Link className="button button-ghost button-compact" to="/profile">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {data ? (
        <div className="insights-grid">
          <div className="insight-card">
            <strong>{data.posts}</strong>
            <span>{t('posts')}</span>
          </div>
          <div className="insight-card">
            <strong>{data.reels}</strong>
            <span>{t('reels')}</span>
          </div>
          <div className="insight-card">
            <strong>{data.followers}</strong>
            <span>{t('followers')}</span>
          </div>
          <div className="insight-card">
            <strong>{data.postViews}</strong>
            <span>{t('postViews')}</span>
          </div>
          <div className="insight-card">
            <strong>{data.reelViews}</strong>
            <span>{t('reelViews')}</span>
          </div>
          <div className="insight-card">
            <strong>{data.catalogProducts}</strong>
            <span>{t('catalogProducts')}</span>
          </div>
          <div className="insight-card">
            <strong>{data.storeOrders}</strong>
            <span>{t('storeOrders')}</span>
          </div>
          <div className="insight-card">
            <strong>{data.itemsSold}</strong>
            <span>{t('itemsSold')}</span>
          </div>
        </div>
      ) : null}
      {data?.recentOrders?.length ? (
        <section className="insights-recent">
          <h2>{t('recentOrders')}</h2>
          <ul>
            {data.recentOrders.map((o: any) => (
              <li key={o.id}>
                {o.customerName} — {o.totalIqd.toLocaleString()} IQD
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function BusinessLinksPage() {
  const { t } = useI18n();
  const { push } = useToast();
  const { idOrUsername } = useParams();
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>([]);
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
        } else {
          const mine = await fetchMyBusiness();
          const raw = mine?.businessProfile?.externalLinks;
          setLinks(Array.isArray(raw) ? raw : []);
          setIsOwner(mine?.accountType === 'business');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errorGeneric'));
      } finally {
        setLoading(false);
      }
    })();
  }, [idOrUsername, t]);

  async function saveLinks(next: Array<{ label: string; url: string }>) {
    setLinks(next);
    await updateBusiness({ externalLinks: next });
    push(t('changesSaved'), 'success');
  }

  async function addLink(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    let u = url.trim();
    if (!l || !u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      await saveLinks([...links, { label: l, url: u }]);
      setLabel('');
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="store-page">
      <div className="page-header">
        <h1>{t('externalLinks')}</h1>
        <Link className="button button-ghost button-compact" to={idOrUsername ? `/u/${idOrUsername}` : '/profile'}>
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!links.length ? <EmptyState title={t('emptyLinks')} /> : null}
      <ul className="links-list">
        {links.map((l, i) => (
          <li key={`${l.url}-${i}`}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label}
            </a>
            {isOwner ? (
              <button
                type="button"
                className="button button-ghost button-compact"
                onClick={() => void saveLinks(links.filter((_, idx) => idx !== i))}
              >
                {t('delete')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {isOwner ? (
        <form className="create-form" onSubmit={(e) => void addLink(e)}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('linkLabel')} required />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required dir="ltr" />
          <button className="button" type="submit">
            {t('addLink')}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** Owner helper: mark a post as catalog product. */
export async function markPostAsProduct(postId: string, priceIqd: number, title?: string) {
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
  const [data, setData] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [t]);

  async function addProduct(e: FormEvent) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDefaultFee(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateBusiness({ defaultDeliveryFeeIqd: Math.max(0, Math.round(Number(defaultFee) || 0)) });
      push(t('changesSaved'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function patchProduct(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const { patchStoreProduct } = await import('@/api/accounts');
      await patchStoreProduct(id, body);
      push(t('changesSaved'), 'success');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="store-page">
      <div className="page-header">
        <h1>{t('manageCatalog')}</h1>
        <Link className="button button-ghost button-compact" to="/profile">
          {t('back')}
        </Link>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <p className="muted">{t('manageCatalogHint')}</p>

      <form className="create-form" onSubmit={(e) => void saveDefaultFee(e)}>
        <label className="field-label">
          {t('defaultDeliveryFee')}
          <input
            type="number"
            min={0}
            value={defaultFee}
            onChange={(e) => setDefaultFee(e.target.value)}
            disabled={busy}
          />
        </label>
        <button className="button button-compact" type="submit" disabled={busy}>
          {t('save')}
        </button>
      </form>

      <form className="create-form" onSubmit={(e) => void addProduct(e)}>
        <h2 className="settings-card-title">{t('addToCatalog')}</h2>
        <label className="field-label">
          {t('posts')}
          <select value={addPostId} onChange={(e) => setAddPostId(e.target.value)} disabled={busy} required>
            <option value="">{t('selectPost')}</option>
            {posts
              .filter((p) => !(data?.products || []).some((c: any) => c.postId === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.caption || p.id).slice(0, 48)}
                </option>
              ))}
          </select>
        </label>
        <label className="field-label">
          {t('priceIqd')}
          <input
            type="number"
            min={1}
            value={addPrice}
            onChange={(e) => setAddPrice(e.target.value)}
            disabled={busy}
            required
          />
        </label>
        <button className="button" type="submit" disabled={busy || !addPostId}>
          {t('addToCatalog')}
        </button>
        {!posts.length ? <p className="muted tiny">{t('addCatalogFromPostHint')}</p> : null}
      </form>

      {!data?.products?.length ? <EmptyState title={t('emptyCatalog')} /> : null}
      <div className="store-manage-list">
        {(data?.products || []).map((p: any) => (
          <article key={p.id} className="store-manage-card">
            {p.media ? (
              <MediaFrame
                mediaId={p.media.id}
                secureUrl={p.media.secureUrl}
                mimeType={p.media.mimeType}
                processingStatus={p.media.processingStatus}
                variant="grid"
                controls={false}
              />
            ) : null}
            <div className="store-manage-body">
              <strong>{p.title}</strong>
              <label className="field-label">
                {t('priceIqd')}
                <input
                  type="number"
                  defaultValue={p.priceIqd}
                  disabled={busy}
                  onBlur={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (Number.isFinite(v) && v !== p.priceIqd) void patchProduct(p.id, { priceIqd: v });
                  }}
                />
              </label>
              <label className="field-label">
                {t('productDeliveryFee')}
                <input
                  type="number"
                  placeholder={t('useDefaultDelivery')}
                  defaultValue={p.deliveryFeeIqd ?? ''}
                  disabled={busy}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === '') {
                      void patchProduct(p.id, { deliveryFeeIqd: null });
                      return;
                    }
                    const v = Math.round(Number(raw));
                    if (Number.isFinite(v)) void patchProduct(p.id, { deliveryFeeIqd: v });
                  }}
                />
              </label>
              <div className="inline-actions">
                <button
                  type="button"
                  className={`button button-compact ${p.inStock ? '' : 'button-ghost'}`}
                  disabled={busy}
                  onClick={() => void patchProduct(p.id, { inStock: !p.inStock })}
                >
                  {p.inStock ? t('markOutOfStock') : t('markInStock')}
                </button>
                <button
                  type="button"
                  className={`button button-compact ${p.active ? 'button-ghost' : ''}`}
                  disabled={busy}
                  onClick={() => void patchProduct(p.id, { active: !p.active })}
                >
                  {p.active ? t('hideFromCatalog') : t('showInCatalog')}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="muted tiny">{t('addCatalogFromPostHint')}</p>
    </div>
  );
}
