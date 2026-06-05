/**
 * HEARTBEAT Core Logic - Supabase Edition
 * Handles dynamic content rendering, persistence, and cinematic redirection.
 */

class StreamVault {
    constructor() {
        this.content = [];
        this.editMode = false;
        this.currentEditId = null;
        
        // Hero Carousel State
        this.heroItems = [];
        this.heroCurrentIndex = 0;
        this.heroIntervalId = null;
        
        this.init();
    }

    async init() {
        // Show loading state immediately
        const container = document.getElementById('content-container');
        if (container) {
            container.innerHTML = `
                <div style="text-align:center; padding: 4rem 2rem; color: #aaa;">
                    <div style="font-size:2rem; margin-bottom:1rem;">⏳</div>
                    <p>Loading content...</p>
                </div>`;
        }
        await this.loadContent();
        this.setupEventListeners();
        this.renderAll();
        this.loadGlobalAds();
    }

    // Load Ad Placements
    async loadGlobalAds() {
        if (!supabase) return;
        const { data, error } = await supabase.from('ads').select('*').eq('is_active', true);
        if (data && !error) {
            data.forEach(ad => {
                // Ensure the slot exists on the current page before injecting
                const slotEl = document.getElementById(`ad-${ad.slot_id}`);
                if (slotEl && ad.code) {
                    slotEl.innerHTML = ad.code;
                }
            });
        }
    }

    // Load content from Supabase
    async loadContent() {
        console.log('[HEARTBEAT] Fetching content from Supabase...');
        const { data, error } = await supabase
            .from('content')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[HEARTBEAT] Error loading content:', error.message);
            // Show error on home page
            const container = document.getElementById('content-container');
            if (container) {
                container.innerHTML = `
                    <div style="text-align:center; padding: 4rem 2rem; color:#e57373;">
                        <div style="font-size:2rem; margin-bottom:1rem;">⚠️</div>
                        <p><strong>Could not load content.</strong></p>
                        <p style="font-size:0.85rem; color:#aaa; margin-top:0.5rem;">${error.message}</p>
                    </div>`;
            }
            return;
        }

        console.log('[HEARTBEAT] Loaded', data.length, 'items from Supabase.');

        // Map snake_case from DB back to camelCase for JS
        this.content = data.map(item => ({
            id: item.id,
            title: item.title,
            type: item.type,
            thumbPortrait: item.thumb_portrait,
            thumbLandscape: item.thumb_landscape,
            category: item.category,
            desc: item.description,
            publishDate: item.publish_date,
            featured: item.featured,
            quality: item.quality || '4K Ultra HD',
            videoLink: item.video_link,
            downloadLink: item.download_link,
            embedCode: item.embed_code,
            episodes: item.episodes || []
        }));

        this.renderAll();
        if (document.getElementById('admin-content-list')) {
            this.renderAdminList();
            this.loadWithdrawals();
            this.fetchAdminWallet();
        }
    }

    // Save or Update content
    async saveContent(newItem) {
        const dbItem = {
            title: newItem.title,
            type: newItem.type,
            thumb_portrait: newItem.thumbPortrait,
            thumb_landscape: newItem.thumbLandscape,
            category: newItem.category,
            description: newItem.desc,
            publish_date: newItem.publishDate,
            featured: newItem.featured,
            quality: newItem.quality,
            video_link: newItem.videoLink,
            download_link: newItem.downloadLink,
            embed_code: newItem.embedCode,
            episodes: newItem.episodes
        };

        if (this.editMode && this.currentEditId) {
            // Update mode
            const { error } = await supabase
                .from('content')
                .update(dbItem)
                .eq('id', this.currentEditId);
            
            if (error) {
                alert('Error updating: ' + error.message);
                return;
            }
            this.exitEditMode();
        } else {
            // Create mode
            // If featured, unfeature all other items first
            if (newItem.featured) {
                await supabase.from('content').update({ featured: false }).eq('featured', true);
            }

            const { error } = await supabase
                .from('content')
                .insert([dbItem]);

            if (error) {
                alert('Error publishing: ' + error.message);
                return;
            }
        }
        
        await this.loadContent();
        alert(this.editMode ? 'Content Updated!' : 'Content Published!');
    }

    // Delete content
    async deleteContent(id) {
        const { error } = await supabase
            .from('content')
            .delete()
            .eq('id', id);

        if (error) {
            alert('Error deleting: ' + error.message);
            return;
        }
        await this.loadContent();
    }

    // Duplicate content
    async duplicateItem(id) {
        const item = this.content.find(i => i.id === id);
        if (!item) return;

        const newItem = {
            ...item,
            title: item.title + ' (Copy)',
            featured: false
        };
        delete newItem.id; // Let DB generate new UUID

        await this.saveContent(newItem);
    }

    // Rendering Logic - accepts optional filter: 'all' | 'Movie' | 'Series' | 'Trending'
    renderAll(filter = 'all') {
        const container = document.getElementById('content-container');
        if (!container) return;

        container.innerHTML = '';

        let items = this.content;
        let searchQuery = '';
        if (filter === 'Movie') items = this.content.filter(i => i.type === 'Movie');
        else if (filter === 'Series') items = this.content.filter(i => i.type === 'Series');
        else if (filter === 'Trending') items = [...this.content].sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));
        else if (filter.startsWith('search:')) {
            searchQuery = filter.replace('search:', '').toLowerCase();
            items = this.content.filter(i => 
                (i.title && i.title.toLowerCase().includes(searchQuery)) || 
                (i.desc && i.desc.toLowerCase().includes(searchQuery)) ||
                (i.category && i.category.toLowerCase().includes(searchQuery))
            );
        }

        // Hero and Categories Icons only on 'all'
        if (filter === 'all') {
            this.updateHero(); // we'll append the hero div to container inside updateHero
            
            // Append static categories icons row
            const catHtml = `
            <section class="categories-section">
                <div class="section-header">
                    <h2 class="section-title">Categories</h2>
                    <a href="#" onclick="window.app.renderAll('Movie'); return false;" class="view-all">View all <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></a>
                </div>
                <div class="categories-scroll hide-scroll">
                    <div class="category-card" onclick="window.app.renderAll('search:comedy')">
                        <div class="category-icon cat-comedy"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Z"/><path d="M8 9h.01M16 9h.01M8 14c1.33 2 4.67 2 8 0"/></svg></div><span class="category-name">Comedy</span>
                    </div>
                    <div class="category-card" onclick="window.app.renderAll('search:action')">
                        <div class="category-icon cat-action"><svg viewBox="0 0 24 24"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.4-2.2 1.5-2.5l13.5-4c1.1-.3 2.2.4 2.5 1.5l.6 2.4z"/><path d="m9.6 4.7 1.9 5.3M14.6 3.2l1.9 5.3"/><path d="M2 13h20v8H2z"/></svg></div><span class="category-name">Action</span>
                    </div>
                    <div class="category-card" onclick="window.app.renderAll('search:drama')">
                        <div class="category-icon cat-drama"><svg viewBox="0 0 24 24"><path d="M2 12a5 5 0 0 0 5 5h14a5 5 0 0 0-5-5H2z"/><path d="M6 12a5 5 0 0 1 5-5h14a5 5 0 0 1-5 5H6z"/></svg></div><span class="category-name">Drama</span>
                    </div>
                    <div class="category-card" onclick="window.app.renderAll('search:romance')">
                        <div class="category-icon cat-romance"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><span class="category-name">Romance</span>
                    </div>
                    <div class="category-card" onclick="window.app.renderAll('search:family')">
                        <div class="category-icon cat-family"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><span class="category-name">Family</span>
                    </div>
                </div>
            </section>`;
            const catWrapper = document.createElement('div');
            catWrapper.innerHTML = catHtml;
            container.appendChild(catWrapper.firstElementChild);
        } else {
             // Search/Filter Header
             const hdrMap = {
                Movie:    { icon: '🎬', title: 'Movies',    sub: 'All movies in the HEARTBEAT library' },
                Series:   { icon: '📺', title: 'Series',    sub: 'Binge-worthy series, season by season' },
                Trending: { icon: '🔥', title: 'Trending',  sub: 'What everyone is watching right now' }
            };
            let h = hdrMap[filter] || { icon: '📁', title: filter, sub: '' };
            if (filter.startsWith('search:')) {
                h = { icon: '🔍', title: `Search Results`, sub: `Showing results for "${searchQuery}"` };
            }
            const hdr = document.createElement('div');
            hdr.className = 'px-5 pt-6 pb-2';
            hdr.innerHTML = `
                <h1 class="text-[22px] font-bold text-white flex items-center gap-2"><span class="text-[24px]">${h.icon}</span>${h.title}</h1>
                <p class="text-[13px] text-white/60">${h.sub}</p>
            `;
            container.appendChild(hdr);
        }

        if (items.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'px-5 py-10 flex flex-col items-center text-center';
            emptyDiv.innerHTML = `
                <span class="text-4xl mb-4 opacity-50">🎬</span>
                <h2 class="text-white font-semibold mb-2">No content yet</h2>
                <p class="text-white/60 text-sm">Nothing matches this view. <a href="admin.html" class="text-primary hover:underline">Admin Panel</a></p>
            `;
            container.appendChild(emptyDiv);
            return;
        }

        // Generate content rows grouped by category or just one big list
        if (filter === 'Trending' || filter.startsWith('search:')) {
             this.appendCardGrid(container, items, filter === 'Trending' ? 'Trending Results' : 'Search Results');
        } else {
             // Group by category
             const categories = filter === 'all' ? ['Trending Now', ...new Set(items.map(i => i.category))] : [...new Set(items.map(i => i.category))];
             
             categories.forEach(cat => {
                 let catItems = items;
                 if (cat === 'Trending Now') {
                     catItems = [...items].sort((a,b) => new Date(b.publishDate) - new Date(a.publishDate)).slice(0, 5);
                 } else {
                     catItems = items.filter(i => i.category === cat);
                 }
                 if (catItems.length > 0) {
                     this.appendCardScrollRow(container, catItems, cat);
                 }
             });
        }
    }

    appendCardScrollRow(container, items, title) {
        const row = document.createElement('section');
        row.innerHTML = `
            <div class="section-header">
                <h2 class="section-title">${title}</h2>
                <a href="#" onclick="window.app.renderAll('${title}'); return false;" class="view-all">View all <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></a>
            </div>
            <div class="trending-scroll hide-scroll">
                ${items.map(item => this.generateCardHtml(item)).join('')}
            </div>
        `;
        container.appendChild(row);
    }

    appendCardGrid(container, items, title) {
        const row = document.createElement('section');
        row.innerHTML = `
            <div class="section-header">
                <h2 class="section-title">${title}</h2>
            </div>
            <div class="trending-scroll hide-scroll" style="flex-wrap: wrap;">
                ${items.map(item => this.generateCardHtml(item)).join('')}
            </div>
        `;
        container.appendChild(row);
    }

    generateCardHtml(item) {
        return `
        <div class="movie-card card" data-id="${item.id}" onclick="window.app.navigateToWatch('${item.id}')">
            <div class="poster-container">
                <img src="${item.thumbPortrait}" alt="${item.title}" loading="lazy" class="poster-img" onerror="this.src='https://placehold.co/300x450/1a1a2e/ffffff?text=Poster+Not+Found'"/>
                <span class="badge-hd">${item.type === 'Series' ? 'SERIES' : 'HD'}</span>
            </div>
            <div class="movie-title">${item.title}</div>
            <div class="movie-meta">${item.publishDate ? new Date(item.publishDate).getFullYear() : '2026'} • ${item.type}</div>
            <div class="movie-rating">
                <span class="star-rating">⭐</span> 8.${(item.id.charCodeAt(0) % 5) + 5}
            </div>
        </div>`;
    }

    updateHero() {
        this.heroItems = this.content.filter(item => item.featured).slice(0, 5);
        if (this.heroItems.length === 0) {
            this.heroItems = this.content.slice(0, 5);
        }
        
        const container = document.getElementById('content-container');
        if (!container || this.heroItems.length === 0) return;
        
        let heroSection = document.getElementById('hero-banner');
        if (!heroSection) {
            heroSection = document.createElement('section');
            heroSection.id = 'hero-banner';
            heroSection.className = 'hero-container';
            container.insertBefore(heroSection, container.firstChild);
        }
        
        // Start Carousel
        this.renderHeroIndex(0);
        this.startHeroCarousel();
    }

    startHeroCarousel() {
        if (this.heroIntervalId) clearInterval(this.heroIntervalId);
        if (this.heroItems.length <= 1) return;
        
        this.heroIntervalId = setInterval(() => {
            this.heroCurrentIndex = (this.heroCurrentIndex + 1) % this.heroItems.length;
            this.renderHeroIndex(this.heroCurrentIndex);
        }, 5000);
    }

    renderHeroIndex(index) {
        this.heroCurrentIndex = index;
        const featured = this.heroItems[index];
        const heroSection = document.getElementById('hero-banner');
        if (!heroSection || !featured) return;

        let dotsHtml = '';
        for (let i = 0; i < this.heroItems.length; i++) {
            if(i === index) {
                dotsHtml += `<div class="dot active" onclick="event.stopPropagation(); window.app.renderHeroIndex(${i}); window.app.startHeroCarousel();"></div>`;
            } else {
                dotsHtml += `<div class="dot" onclick="event.stopPropagation(); window.app.renderHeroIndex(${i}); window.app.startHeroCarousel();"></div>`;
            }
        }

        heroSection.innerHTML = `
        <div class="hero-card card" onclick="window.app.navigateToWatch('${featured.id}')" data-id="${featured.id}">
            <img src="${featured.thumbLandscape}" alt="${featured.title}" class="hero-bg">
            <div class="hero-overlay">
                <div class="hero-top-badges">
                    <span class="badge-featured">FEATURED TODAY</span>
                    <span class="badge-pagination">${index + 1} / ${this.heroItems.length}</span>
                </div>
                <div class="hero-content">
                    <h1 class="hero-title">${featured.title}</h1>
                    <p class="hero-desc">${featured.desc ? featured.desc.substring(0, 80) + '...' : ''}</p>
                    <div class="hero-actions">
                        <button class="btn btn-play" onclick="event.stopPropagation(); window.app.navigateToWatch('${featured.id}')">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            Play Now
                        </button>
                        <button class="btn btn-info" onclick="event.stopPropagation(); window.app.navigateToWatch('${featured.id}')">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                            More Info
                        </button>
                    </div>
                </div>
                <div class="hero-dots">
                    ${dotsHtml}
                </div>
            </div>
        </div>`;
    }

    // UI Interaction Setup
    setupEventListeners() {
        // Navbar scroll
        window.addEventListener('scroll', () => {
            const nav = document.getElementById('navbar');
            if (nav) {
                window.scrollY > 50 ? nav.classList.add('scrolled') : nav.classList.remove('scrolled');
            }
        });

        // Home page card clicks
        const container = document.getElementById('content-container');
        if (container) {
            container.addEventListener('click', (e) => {
                const card = e.target.closest('.card');
                if (card) this.navigateToWatch(card.dataset.id);
            });
        }

        // Recommendations clicks
        const recContainer = document.getElementById('recommendations-container');
        if (recContainer) {
            recContainer.addEventListener('click', (e) => {
                const card = e.target.closest('.card');
                if (card) this.navigateToWatch(card.dataset.id);
            });
        }

        // Admin Form
        const adminForm = document.getElementById('admin-form');
        if (adminForm) {
            adminForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                // Collect episodes if series
                const episodes = [];
                if (document.getElementById('contentType').value === 'Series') {
                    const rows = document.querySelectorAll('.episode-row');
                    rows.forEach(row => {
                        const title = row.querySelector('.ep-title-input').value;
                        const link = row.querySelector('.ep-link-input').value;
                        const downloadLink = row.querySelector('.ep-download-input').value;
                        const embedCode = row.querySelector('.ep-embed-input').value;
                        if (title && (link || embedCode)) episodes.push({ title, link, downloadLink, embedCode });
                    });
                }

                const newItem = {
                    title: document.getElementById('title').value,
                    type: document.getElementById('contentType').value,
                    thumbPortrait: document.getElementById('thumbPortrait').value,
                    thumbLandscape: document.getElementById('thumbLandscape').value,
                    category: document.getElementById('category').value,
                    desc: document.getElementById('content').value,
                    publishDate: document.getElementById('publishDate').value || new Date().toISOString().split('T')[0],
                    featured: document.getElementById('is-featured').checked,
                    quality: document.getElementById('quality') ? document.getElementById('quality').value : '4K Ultra HD',
                    videoLink: document.getElementById('videoLink').value,
                    downloadLink: document.getElementById('downloadLink').value,
                    embedCode: document.getElementById('embedCode').value || '',
                    episodes: episodes
                };
                
                await this.saveContent(newItem);
                adminForm.reset();
                document.getElementById('publishDate').valueAsDate = new Date();
                this.exitEditMode(); 
            });

            document.getElementById('cancel-edit-btn').addEventListener('click', () => this.exitEditMode());
        }

        // Withdrawal Form
        const withdrawalForm = document.getElementById('withdrawal-form');
        if (withdrawalForm) {
            withdrawalForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const method = document.getElementById('withdrawMethod').value;
                const amount = parseFloat(document.getElementById('withdrawAmount').value);
                if (amount < 1200) {
                    alert('Minimum withdrawal amount is ₹1200');
                    return;
                }

                const withdrawalData = {
                    amount: amount,
                    method: method,
                    upi_id: method === 'UPI' ? document.getElementById('upiId').value : null,
                    bank_name: method === 'Bank Transfer' ? document.getElementById('bankName').value : null,
                    bank_account: method === 'Bank Transfer' ? document.getElementById('bankAccount').value : null,
                    ifsc_code: method === 'Bank Transfer' ? document.getElementById('ifscCode').value : null,
                    branch_name: method === 'Bank Transfer' ? document.getElementById('branchName').value : null
                };

                await this.saveWithdrawal(withdrawalData);
                withdrawalForm.reset();
                this.togglePaymentFields(); // Reset display
            });
        }
    }

    navigateToWatch(id) {
        if (!id || id === 'undefined' || id === 'null') {
            console.warn('[HEARTBEAT] navigateToWatch called with invalid id:', id);
            return;
        }
        window.location.href = `watch.html?id=${id}`;
    }

    // Admin List Rendering
    renderAdminList() {
        const listContainer = document.getElementById('admin-content-list');
        if (!listContainer) return;

        if (this.content.length === 0) {
            listContainer.innerHTML = '<p class="loading-status">No content added yet.</p>';
            return;
        }

        listContainer.innerHTML = this.content.map(item => `
            <div class="list-item">
                <img src="${item.thumbPortrait}" alt="${item.title}">
                <div class="list-item-info">
                    <h4>${item.title} ${item.featured ? '🌟' : ''}</h4>
                    <p>${item.type || 'Movie'} • ${item.category} • ${item.publishDate}</p>
                </div>
                <div class="list-actions">
                    <button class="duplicate-btn" onclick="app.duplicateItem('${item.id}')">Duplicate</button>
                    <button class="edit-btn" onclick="app.enterEditMode('${item.id}')">Edit</button>
                    <button class="delete-btn" onclick="app.deleteItem('${item.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    // Withdrawal Methods
    togglePaymentFields() {
        const method = document.getElementById('withdrawMethod');
        if(!method) return;
        const upiFields = document.getElementById('upi-fields');
        const bankFields = document.getElementById('bank-fields');

        if (method.value === 'UPI') {
            upiFields.style.display = 'block';
            bankFields.style.display = 'none';
        } else {
            upiFields.style.display = 'none';
            bankFields.style.display = 'block';
        }
    }

    async fetchAdminWallet() {
        const display = document.getElementById('admin-display-balance');
        if(!display) return;
        
        const { data, error } = await supabase.from('wallet_balance').select('balance').eq('id', 1).single();
        if (data) {
            display.textContent = `₹${data.balance}`;
            display.dataset.balance = data.balance;
        } else {
            console.warn("Wallet balance not found or no table setup.");
            display.textContent = '₹0';
            display.dataset.balance = 0;
        }
    }

    async saveWithdrawal(data) {
        const msgEl = document.getElementById('withdraw-msg');
        msgEl.style.color = '#fff';
        msgEl.textContent = 'Submitting request...';

        // Check balance first
        const display = document.getElementById('admin-display-balance');
        if (display && display.dataset.balance) {
            const currentBal = parseFloat(display.dataset.balance);
            if (data.amount > currentBal) {
                msgEl.style.color = '#e57373';
                msgEl.textContent = 'Error: Insufficient Vault Balance!';
                return;
            }
        }

        const { error } = await supabase.from('withdrawals').insert([data]);

        if (error) {
            console.error('Withdrawal error:', error);
            msgEl.style.color = '#e57373';
            msgEl.textContent = 'Error: ' + error.message;
            if(error.message.includes('relation "public.withdrawals" does not exist')) {
                 msgEl.textContent = 'Error: Database table missing. Please run the SQL setup.';
            }
        } else {
            // Deduct balance locally and in DB
            if (display && display.dataset.balance) {
                const currentBal = parseFloat(display.dataset.balance);
                const newBal = currentBal - data.amount;
                await supabase.from('wallet_balance').update({ balance: newBal }).eq('id', 1);
                this.fetchAdminWallet(); // Refresh display
            }

            msgEl.style.color = '#81c784';
            msgEl.textContent = 'Withdrawal request submitted successfully!';
            await this.loadWithdrawals(); // refresh list
            setTimeout(() => { msgEl.textContent = ''; }, 3000);
        }
    }

    async loadWithdrawals() {
        const listContainer = document.getElementById('withdrawal-history-list');
        if (!listContainer) return;

        const { data, error } = await supabase
            .from('withdrawals')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            listContainer.innerHTML = '<p class="loading-status" style="color:#e57373;">Failed to load history.</p>';
            return;
        }

        if (!data || data.length === 0) {
            listContainer.innerHTML = '<p class="loading-status">No withdrawals yet.</p>';
            return;
        }

        listContainer.innerHTML = data.map(item => {
            const date = new Date(item.created_at).toLocaleDateString();
            const statusColor = item.status === 'Paid' ? '#81c784' : (item.status === 'Rejected' ? '#e57373' : '#ffd54f');
            const details = item.method === 'UPI' ? item.upi_id : `${item.bank_name ? item.bank_name + ' - ' : ''}A/c: ${item.bank_account} (IFSC: ${item.ifsc_code}) ${item.branch_name ? '- ' + item.branch_name : ''}`;
            return `
            <div class="list-item" style="padding: 1rem;">
                <div class="list-item-info">
                    <h4 style="margin:0 0 0.2rem;">₹${item.amount} via ${item.method}</h4>
                    <p style="margin:0; font-size:0.8rem; color:#aaa;">${details}</p>
                    <p style="margin:0; font-size:0.75rem; color:#888;">Requested on: ${date}</p>
                </div>
                <div class="list-actions">
                    <span style="padding:0.3rem 0.8rem; border-radius:12px; font-size:0.8rem; font-weight:600; background:rgba(255,255,255,0.1); color:${statusColor}">
                        ${item.status}
                    </span>
                </div>
            </div>`;
        }).join('');
    }

    // Edit Mode Logic
    enterEditMode(id) {
        const item = this.content.find(i => i.id === id);
        if (!item) return;

        this.editMode = true;
        this.currentEditId = id;

        // Populate fields
        document.getElementById('title').value = item.title;
        document.getElementById('contentType').value = item.type || 'Movie';
        document.getElementById('thumbPortrait').value = item.thumbPortrait;
        document.getElementById('thumbLandscape').value = item.thumbLandscape;
        document.getElementById('category').value = item.category;
        document.getElementById('content').value = item.desc;
        document.getElementById('publishDate').value = item.publishDate;
        document.getElementById('is-featured').checked = item.featured;
        if (document.getElementById('quality')) {
            document.getElementById('quality').value = item.quality || '4K Ultra HD';
        }
        document.getElementById('videoLink').value = item.videoLink || '';
        document.getElementById('downloadLink').value = item.downloadLink || '';
        document.getElementById('embedCode').value = item.embedCode || '';

        // Handle Episodes
        const container = document.getElementById('episodes-container');
        container.innerHTML = '';
        if (item.episodes && item.episodes.length > 0) {
            item.episodes.forEach(ep => this.addEpisodeRow(ep));
        }

        this.toggleStreamTypeFields();

        // UI Updates
        document.getElementById('edit-mode-tag').classList.remove('hidden-initial');
        document.getElementById('submit-btn').innerHTML = '💾 Save Changes';
        document.getElementById('cancel-edit-btn').style.display = 'block';
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    exitEditMode() {
        this.editMode = false;
        this.currentEditId = null;
        const form = document.getElementById('admin-form');
        if (form) {
            form.reset();
            document.getElementById('episodes-container').innerHTML = '';
            this.toggleStreamTypeFields();
        }
        
        document.getElementById('edit-mode-tag').classList.add('hidden-initial');
        document.getElementById('submit-btn').innerHTML = '🚀 Publish to Website';
        document.getElementById('cancel-edit-btn').style.display = 'none';
        document.getElementById('publishDate').valueAsDate = new Date();
    }

    async deleteItem(id) {
        if (confirm('Delete this content?')) {
            await this.deleteContent(id);
        }
    }

    // Helper Methods for UI
    toggleStreamTypeFields() {
        const type = document.getElementById('contentType').value;
        const movieFields = document.getElementById('movie-fields');
        const seriesFields = document.getElementById('series-fields');
        
        if (type === 'Movie') {
            movieFields.style.display = 'block';
            seriesFields.style.display = 'none';
        } else {
            movieFields.style.display = 'none';
            seriesFields.style.display = 'block';
        }
    }

    addEpisodeRow(data = { title: '', link: '', downloadLink: '', embedCode: '' }) {
        const container = document.getElementById('episodes-container');
        const row = document.createElement('div');
        row.className = 'episode-row';
        row.style.display = 'block';
        row.style.background = 'rgba(255,255,255,0.03)';
        row.style.padding = '1rem';
        row.style.borderRadius = '8px';
        row.style.border = '1px solid rgba(255,255,255,0.1)';
        row.style.marginBottom = '1rem';
        
        row.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
                <input type="text" placeholder="Ep Title (e.g. S1 E1)" value="${data.title || ''}" class="ep-title-input" required style="flex: 1; margin: 0; margin-right: 1rem;">
                <button type="button" class="btn btn-secondary btn-small" onclick="this.closest('.episode-row').remove()" style="padding: 0.4rem 0.8rem; background: #e57373; color: white; border: none; min-width: auto; height: auto;">Remove</button>
            </div>
            <input type="url" placeholder="Watch Now Link (Stream URL)" value="${data.link || ''}" class="ep-link-input" style="margin-bottom: 0.8rem; width: 100%;">
            <input type="url" placeholder="Download Link (Optional)" value="${data.downloadLink || ''}" class="ep-download-input" style="margin-bottom: 0.8rem; width: 100%;">
            <textarea placeholder="Embed Code or Video Link (e.g. YouTube, MP4, <iframe>)" class="ep-embed-input" rows="2" style="margin-bottom: 0; width: 100%; border-radius: 8px; padding: 0.8rem; background: rgba(255,255,255,0.05); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); font-family: monospace;">${data.embedCode || ''}</textarea>
        `;
        container.appendChild(row);
    }
}

class Auth {
    constructor() {
        this.session = null;
        this.ready = this.init();
    }

    async init() {
        const { data: { session } } = await supabase.auth.getSession();
        this.session = session;

        // Listen for changes
        supabase.auth.onAuthStateChange((_event, session) => {
            this.session = session;
        });

        return this.session;
    }

    async login(email, password) {
        if (!supabase) {
            return { success: false, message: 'Supabase client not initialized. Check console for details.' };
        }
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error('Login error:', error.message);
            return { success: false, message: error.message };
        }

        this.session = data.session;
        return { success: true, message: 'OK' };
    }

    async logout() {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    }

    isLoggedIn() {
        return this.session !== null;
    }
}

class ShopVault {
    constructor() {
        this.products = [];
        this.editMode = false;
        this.currentEditId = null;
        this.init();
    }

    async init() {
        const form = document.getElementById('admin-product-form');
        if (!form) return; // Only init on admin page

        await this.loadProducts();
        this.setupEventListeners();
    }

    async loadProducts() {
        if (!supabase) return;
        const listContainer = document.getElementById('admin-product-list');
        if (listContainer) listContainer.innerHTML = '<p class="loading-status">Loading products...</p>';

        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error loading products:', error.message);
            if (listContainer) listContainer.innerHTML = `<p class="loading-status" style="color:#e57373;">Error: ${error.message}</p>`;
            return;
        }

        this.products = data || [];
        this.renderAdminList();
    }

    renderAdminList() {
        const listContainer = document.getElementById('admin-product-list');
        if (!listContainer) return;

        if (this.products.length === 0) {
            listContainer.innerHTML = '<p class="loading-status">No products added yet.</p>';
            return;
        }

        listContainer.innerHTML = this.products.map(item => `
            <div class="list-item">
                <img src="${item.image_url || 'https://placehold.co/100x100/1a1a2e/ffffff?text=No+Image'}" alt="${item.name}">
                <div class="list-item-info">
                    <h4>${item.name} ${item.featured ? '🌟' : ''}</h4>
                    <p>${item.original_price ? `<del style="opacity:0.5">${item.original_price}</del> ` : ''}${item.price} ${item.discount_percentage ? `<span style="color:#e50914; font-size:0.8rem; font-weight:bold;">(-${item.discount_percentage}%)</span>` : ''} • ${item.category} • ${item.status ? 'Active' : 'Hidden'}</p>
                </div>
                <div class="list-actions">
                    <button class="edit-btn" onclick="shop.enterEditMode(${item.id})">Edit</button>
                    <button class="delete-btn" onclick="shop.deleteProduct(${item.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    setupEventListeners() {
        const form = document.getElementById('admin-product-form');
        if (form) {
            const origInput = document.getElementById('prodOriginalPrice');
            const saleInput = document.getElementById('prodPrice');
            const discInput = document.getElementById('prodDiscount');
            
            const calcDiscount = () => {
                const origStr = origInput.value.replace(/[^0-9.]/g, '');
                const saleStr = saleInput.value.replace(/[^0-9.]/g, '');
                const orig = parseFloat(origStr);
                const sale = parseFloat(saleStr);
                if (orig > 0 && sale > 0 && orig > sale) {
                    const pct = Math.round(((orig - sale) / orig) * 100);
                    discInput.value = pct;
                } else {
                    discInput.value = '';
                }
            };

            if (origInput && saleInput) {
                origInput.addEventListener('input', calcDiscount);
                saleInput.addEventListener('input', calcDiscount);
            }

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const productData = {
                    name: document.getElementById('prodName').value,
                    image_url: document.getElementById('prodImage').value,
                    category: document.getElementById('prodCategory').value,
                    price: document.getElementById('prodPrice').value,
                    original_price: document.getElementById('prodOriginalPrice').value,
                    discount_percentage: document.getElementById('prodDiscount').value ? parseInt(document.getElementById('prodDiscount').value) : null,
                    affiliate_url: document.getElementById('prodAffiliateUrl').value,
                    description: document.getElementById('prodDesc').value,
                    featured: document.getElementById('prodFeatured').checked,
                    status: document.getElementById('prodStatus').checked
                };

                await this.saveProduct(productData);
            });

            document.getElementById('prod-cancel-edit-btn').addEventListener('click', () => this.exitEditMode());
        }
    }

    async saveProduct(data) {
        if (this.editMode && this.currentEditId) {
            const { error } = await supabase.from('products').update(data).eq('id', this.currentEditId);
            if (error) {
                alert('Error updating product: ' + error.message);
                return;
            }
            alert('Product Updated!');
        } else {
            if (data.featured) {
                // Keep multiple featured products or just one? Let's keep multiple. No unfeature logic needed.
            }
            const { error } = await supabase.from('products').insert([data]);
            if (error) {
                alert('Error publishing product: ' + error.message);
                return;
            }
            alert('Product Published!');
        }

        this.exitEditMode();
        await this.loadProducts();
    }

    enterEditMode(id) {
        const item = this.products.find(i => i.id === id);
        if (!item) return;

        this.editMode = true;
        this.currentEditId = id;

        document.getElementById('prodName').value = item.name;
        document.getElementById('prodImage').value = item.image_url;
        document.getElementById('prodCategory').value = item.category;
        document.getElementById('prodPrice').value = item.price;
        document.getElementById('prodOriginalPrice').value = item.original_price || '';
        document.getElementById('prodDiscount').value = item.discount_percentage || '';
        document.getElementById('prodAffiliateUrl').value = item.affiliate_url;
        document.getElementById('prodDesc').value = item.description;
        document.getElementById('prodFeatured').checked = item.featured;
        document.getElementById('prodStatus').checked = item.status;

        document.getElementById('prod-edit-mode-tag').classList.remove('hidden-initial');
        document.getElementById('prod-submit-btn').innerHTML = '💾 Save Product';
        document.getElementById('prod-cancel-edit-btn').style.display = 'block';
        
        window.scrollTo({ top: document.getElementById('admin-product-form').offsetTop - 100, behavior: 'smooth' });
    }

    exitEditMode() {
        this.editMode = false;
        this.currentEditId = null;
        
        const form = document.getElementById('admin-product-form');
        if (form) form.reset();

        document.getElementById('prod-edit-mode-tag').classList.add('hidden-initial');
        document.getElementById('prod-submit-btn').innerHTML = '🚀 Publish Product';
        document.getElementById('prod-cancel-edit-btn').style.display = 'none';
    }

    async deleteProduct(id) {
        if (confirm('Delete this product permanently?')) {
            const { error } = await supabase.from('products').delete().eq('id', id);
            if (error) {
                alert('Error deleting product: ' + error.message);
                return;
            }
            await this.loadProducts();
        }
    }
}

window.auth = new Auth();

document.addEventListener('DOMContentLoaded', () => {
    window.app = new StreamVault();
    window.shop = new ShopVault();
});
