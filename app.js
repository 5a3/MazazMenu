// ==========================================
// 1. Firebase Configuration & Initialization
// ==========================================
const firebaseConfig = {
    projectId: "mazaz-de904",
    authDomain: "mazaz-de904.firebaseapp.com",
    storageBucket: "mazaz-de904.appspot.com"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();

// Enable Firestore offline persistence for ultra-fast local cache reads
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// Application State
let categories = [];
let products = [];
let activeCategoryFilter = 'all';

// DOM Elements
const menuContainer = document.getElementById('menuContainer');
const categoriesNav = document.getElementById('categoriesNav');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const menuStatusBar = document.getElementById('menuStatusBar');
const statusText = document.getElementById('statusText');

// Modal Elements
const productDetailModal = document.getElementById('productDetailModal');
const modalProductDetails = document.getElementById('modalProductDetails');
const closeModalBtn = document.getElementById('closeModalBtn');

// ==========================================
// 2. Ultra-Low Read Smart Cache System (0 to 1 Read)
// ==========================================
function setLocalCache(key, data) {
    try {
        localStorage.setItem(`mazaz_customer_${key}`, JSON.stringify(data));
    } catch (e) {
        console.warn('Cache save error:', e);
    }
}

function getLocalCache(key) {
    try {
        const cached = localStorage.getItem(`mazaz_customer_${key}`);
        return cached ? JSON.parse(cached) : null;
    } catch (e) {
        return null;
    }
}

async function loadMenuSmartly() {
    const cachedCategories = getLocalCache('categories');
    const cachedProducts = getLocalCache('products');
    const localSyncTime = parseInt(localStorage.getItem('mazaz_customer_sync') || '0');

    // 1. Render instantly from local cache (0 Reads & 0ms loading time for Customer)
    if (cachedCategories && cachedProducts) {
        categories = cachedCategories;
        products = cachedProducts;
        renderCategoriesNav();
        renderMenu();
        updateStatusUI('منيو محدّث (سريع جداً من الكاش المحلي)', 'cached');
    }

    try {
        // 2. Single Document Meta Read (Check if Admin updated anything on server)
        const metaDoc = await db.collection('system_metadata').doc('version').get();
        let serverSyncTime = 0;

        if (metaDoc.exists && metaDoc.data().last_updated_at) {
            serverSyncTime = metaDoc.data().last_updated_at.toMillis();
        }

        // 3. Fetch full collection ONLY if server version is newer than local cache
        if (!cachedCategories || !cachedProducts || serverSyncTime > localSyncTime) {
            updateStatusUI('جاري تحديث بيانات المنيو من السيرفر...', 'syncing');
            await fetchFreshMenuFromFirebase();
            localStorage.setItem('mazaz_customer_sync', (serverSyncTime || Date.now()).toString());
            updateStatusUI('تم تحديث المنيو من السيرفر بنجاح', 'fresh');
        }
    } catch (err) {
        console.error('Smart menu loading error:', err);
        if (!cachedCategories || !cachedProducts) {
            await fetchFreshMenuFromFirebase();
        }
    }
}

async function fetchFreshMenuFromFirebase() {
    try {
        const [catSnapshot, prodSnapshot] = await Promise.all([
            db.collection('categories').get(),
            db.collection('products').get()
        ]);

        categories = catSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(c => c.is_active !== false)
            .sort((a, b) => (a.order || 1) - (b.order || 1));
        
        products = prodSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(p => p.is_available !== false)
            .sort((a, b) => (a.order || 1) - (b.order || 1));

        setLocalCache('categories', categories);
        setLocalCache('products', products);

        renderCategoriesNav();
        renderMenu();
    } catch (err) {
        console.error('Fetch Fresh Menu Error:', err);
        updateStatusUI('متصل - خطأ في تحديث البيانات', 'error');
    }
}

function updateStatusUI(message, state) {
    if (!statusText || !menuStatusBar) return;
    statusText.textContent = message;
    const dot = menuStatusBar.querySelector('.status-dot');
    if (dot) {
        if (state === 'syncing') dot.style.background = '#F39C12';
        else if (state === 'error') dot.style.background = '#E74C3C';
        else dot.style.background = '#2ECC71';
    }
}

// ==========================================
// 3. UI Rendering & Filtering Logic
// ==========================================
function renderCategoriesNav() {
    if (!categoriesNav) return;
    
    let html = `
        <button class="cat-pill ${activeCategoryFilter === 'all' ? 'active' : ''}" data-id="all">
            <i class="fa-solid fa-fire"></i> الكل
        </button>
    `;

    categories.forEach(cat => {
        html += `
            <button class="cat-pill ${activeCategoryFilter === cat.id ? 'active' : ''}" data-id="${cat.id}">
                ${cat.name_ar}
            </button>
        `;
    });

    categoriesNav.innerHTML = html;

    // Add click listeners to category pills
    categoriesNav.querySelectorAll('.cat-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            categoriesNav.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeCategoryFilter = btn.getAttribute('data-id');
            renderMenu();

            // Smooth scroll to target section if specific category chosen
            if (activeCategoryFilter !== 'all') {
                const targetSec = document.getElementById(`sec-${activeCategoryFilter}`);
                if (targetSec) {
                    const navHeight = document.querySelector('.categories-nav-wrapper')?.offsetHeight || 70;
                    const elementPosition = targetSec.getBoundingClientRect().top + window.pageYOffset;
                    window.scrollTo({
                        top: elementPosition - navHeight - 15,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });
}

function renderMenu() {
    if (!menuContainer) return;

    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    // Filter categories based on search or active pill
    let filteredCategories = categories;
    if (activeCategoryFilter !== 'all') {
        filteredCategories = categories.filter(c => c.id === activeCategoryFilter);
    }

    let hasProducts = false;
    let html = '';

    filteredCategories.forEach(cat => {
        // Find products belonging to this category
        let catProducts = products.filter(p => p.category_id === cat.id);

        // Apply search filter if user is typing
        if (searchTerm) {
            catProducts = catProducts.filter(p => 
                p.name_ar.toLowerCase().includes(searchTerm) ||
                (p.addons && p.addons.some(a => a.name.toLowerCase().includes(searchTerm)))
            );
        }

        if (catProducts.length > 0) {
            hasProducts = true;
            html += `
                <section class="category-section" id="sec-${cat.id}">
                    <h2 class="category-section-title">
                        <i class="fa-solid fa-layer-group"></i> ${cat.name_ar}
                    </h2>
                    <div class="products-grid">
            `;

            catProducts.forEach(prod => {
                html += renderProductCard(prod);
            });

            html += `
                    </div>
                </section>
            `;
        }
    });

    if (!hasProducts) {
        menuContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-utensils"></i>
                <h3>لا توجد نتائج مطابقة</h3>
                <p class="text-muted">جرب البحث بكلمة أخرى أو تغيير القسم المختصر.</p>
            </div>
        `;
    } else {
        menuContainer.innerHTML = html;
    }
}

function renderProductCard(prod) {
    let priceHtml = '';
    
    if (prod.pricing_type === 'single') {
        priceHtml = `
            <div class="price-row">
                <span class="price-label">السعر:</span>
                <span class="price-value">${prod.base_price || 0} <span class="currency">ريال</span></span>
            </div>
        `;
    } else {
        const smallVariant = (prod.variants || []).find(v => v.size_name === 'صغير');
        const largeVariant = (prod.variants || []).find(v => v.size_name === 'كبير');

        priceHtml = `
            <div class="pricing-container">
                ${smallVariant ? `
                    <div class="price-row">
                        <span class="price-label">صغير:</span>
                        <span class="price-value">${smallVariant.price} <span class="currency">ريال</span></span>
                    </div>
                ` : ''}
                ${largeVariant ? `
                    <div class="price-row">
                        <span class="price-label">كبير:</span>
                        <span class="price-value">${largeVariant.price} <span class="currency">ريال</span></span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Addons Preview Tag
    let addonsHtml = '';
    if (prod.addons && prod.addons.length > 0) {
        addonsHtml = `
            <div class="addons-preview">
                <strong><i class="fa-solid fa-circle-plus"></i> الإضافات المتوفرة:</strong><br>
                ${prod.addons.map(a => `<span class="addons-tag">${a.name} (+${a.price} ريال)</span>`).join('')}
            </div>
        `;
    }

    return `
        <div class="product-card" onclick="openProductDetailModal('${prod.id}')">
            <div>
                <div class="product-header">
                    <h3 class="product-title">${prod.name_ar}</h3>
                    ${prod.addons && prod.addons.length > 0 ? `<span class="badge-addon">إضافات</span>` : ''}
                </div>
                ${priceHtml}
            </div>
            ${addonsHtml}
        </div>
    `;
}

// Modal Product View
window.openProductDetailModal = function(id) {
    const prod = products.find(p => p.id === id);
    if (!prod) return;

    let priceDetails = '';
    if (prod.pricing_type === 'single') {
        priceDetails = `<h3 style="color:var(--primary); font-size:1.4rem;">${prod.base_price || 0} ريال</h3>`;
    } else {
        priceDetails = (prod.variants || []).map(v => `
            <div style="display:flex; justify-between; padding:8px 0; border-bottom:1px solid #F1F5F9;">
                <span>الحجم ${v.size_name}:</span>
                <strong style="color:var(--primary); font-size:1.1rem;">${v.price} ريال</strong>
            </div>
        `).join('');
    }

    let addonsDetails = '';
    if (prod.addons && prod.addons.length > 0) {
        addonsDetails = `
            <div style="margin-top:16px;">
                <h4 style="margin-bottom:8px; font-size:0.95rem; color:var(--text-dark);"><i class="fa-solid fa-plus-circle"></i> خيارات الإضافات:</h4>
                ${prod.addons.map(a => `
                    <div style="display:flex; justify-between; background:#F8FAF8; padding:8px 12px; border-radius:8px; margin-bottom:6px;">
                        <span>${a.name}</span>
                        <strong style="color:var(--accent-pink);">+${a.price} ريال</strong>
                    </div>
                `).join('')}
            </div>
        `;
    }

    modalProductDetails.innerHTML = `
        <h2 style="font-size:1.3rem; font-weight:800; color:var(--text-dark); margin-bottom:6px;">${prod.name_ar}</h2>
        <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:14px;">القسم: ${prod.category_name}</p>
        <div style="background:#F8FAF8; padding:12px; border-radius:12px;">
            ${priceDetails}
        </div>
        ${addonsDetails}
    `;

    productDetailModal.classList.add('active');
};

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
        productDetailModal.classList.remove('active');
    });
}

if (productDetailModal) {
    productDetailModal.addEventListener('click', (e) => {
        if (e.target === productDetailModal) {
            productDetailModal.classList.remove('active');
        }
    });
}

// Search Inputs Handlers
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (clearSearchBtn) clearSearchBtn.style.display = val ? 'block' : 'none';
        renderMenu();
    });
}

if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        renderMenu();
    });
}

// ==========================================
// 4. Interactive Menu Paper Image Viewer & Download
// ==========================================
const imageViewerModal = document.getElementById('imageViewerModal');
const viewerTitle = document.getElementById('viewerTitle');
const viewerImage = document.getElementById('viewerImage');
const downloadImageBtn = document.getElementById('downloadImageBtn');
const closeViewerBtn = document.getElementById('closeViewerBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');

let currentZoomScale = 1;

window.openMenuViewer = function(imgSrc, titleText) {
    if (!imageViewerModal || !viewerImage) return;
    
    currentZoomScale = 1;
    viewerImage.style.transform = `scale(${currentZoomScale})`;
    viewerImage.src = imgSrc;
    if (viewerTitle) viewerTitle.textContent = titleText;
    if (downloadImageBtn) {
        downloadImageBtn.href = imgSrc;
        downloadImageBtn.download = titleText.replace(/\s+/g, '_') + '.jpg';
    }

    imageViewerModal.classList.add('active');
};

if (closeViewerBtn) {
    closeViewerBtn.addEventListener('click', () => {
        imageViewerModal.classList.remove('active');
    });
}

if (imageViewerModal) {
    imageViewerModal.addEventListener('click', (e) => {
        if (e.target === imageViewerModal) {
            imageViewerModal.classList.remove('active');
        }
    });
}

if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
        if (currentZoomScale < 2.5) {
            currentZoomScale += 0.25;
            viewerImage.style.transform = `scale(${currentZoomScale})`;
        }
    });
}

if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
        if (currentZoomScale > 0.6) {
            currentZoomScale -= 0.25;
            viewerImage.style.transform = `scale(${currentZoomScale})`;
        }
    });
}

// App Load Initialization
loadMenuSmartly();
