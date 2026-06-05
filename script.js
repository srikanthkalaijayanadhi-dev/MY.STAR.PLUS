/**
 * HEARTBEAT Core Logic - Supabase Edition
 * Handles dynamic content rendering, persistence, and cinematic redirection.
 */

class StreamVault {
    constructor() {
        this.content = [];
        this.editMode = false;
        this.currentEditId = null;
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

        // Determine which items to show
        let items = this.content;
        if (filter === 'Movie') {
            items = this.content.filter(i => i.type === 'Movie');
        } else if (filter === 'Series') {
            items = this.content.filter(i => i.type === 'Series');
        } else if (filter === 'Trending') {
            // Trending = sorted by publish date descending (most recent first)
            items = [...this.content].sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));
        }
        // 'all' keeps original order (newest first from Supabase)

        // ── Page header for filtered views ────────────────────────────
        if (filter !== 'all') {
            const hdrMap = {
                Movie:    { icon: '🎬', title: 'Movies',    sub: 'All movies in the HEARTBEAT library' },
                Series:   { icon: '📺', title: 'Series',    sub: 'Binge-worthy series, season by season' },
                Trending: { icon: '🔥', title: 'Trending',  sub: 'What everyone is watching right now' }
            };
            const h = hdrMap[filter] || { icon: '📁', title: filter, sub: '' };
            const hdr = document.createElement('div');
            hdr.className = 'page-filter-header';
            hdr.innerHTML = `
                <h1><span class="page-icon">${h.icon}</span>${h.title}</h1>
                <p>${h.sub}</p>
            `;
            container.appendChild(hdr);

            // Stats bar
            if (items.length > 0) {
                const stats = document.createElement('div');
                stats.className = 'content-stats';
                stats.innerHTML = `<span>Showing</span> <strong>${items.length}</strong> <span>title${items.length !== 1 ? 's' : ''}</span>`;
                container.appendChild(stats);
            }
        }

        if (items.length === 0) {
            const filterLabel = filter === 'all' ? 'content' : filter === 'Movie' ? 'movies' : filter === 'Series' ? 'series' : 'trending titles';
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.innerHTML = `
                <span class="empty-icon">🎬</span>
                <h2>No ${filterLabel} yet</h2>
                <p>Visit the <a href="admin.html">Admin Panel</a> to publish your first title.</p>
            `;
            container.appendChild(emptyDiv);
            if (filter === 'all') this.updateHero();
            return;
        }

        if (filter === 'Trending') {
            // Trending shows as a single flat row with rank badges
            const wrap = document.createElement('div');
            wrap.style.padding = '1.5rem 4% 3rem';
            const grid = document.createElement('div');
            grid.className = 'row-cards';
            grid.innerHTML = items.map((item, idx) => `
                <article class="card" data-id="${item.id}">
                    <img class="card-thumb" src="${item.thumbPortrait}" alt="${item.title}" loading="lazy">
                    <span class="card-rank">#${idx + 1}</span>
                    <span class="card-type-badge">${item.type}</span>
                    <div class="card-overlay"><span class="play-icon">▶</span></div>
                    <div class="card-info">
                        <h3 class="card-title">${item.title}</h3>
                        <div class="card-meta">
                            <span>${item.type}</span>
                            <span>${item.publishDate ? new Date(item.publishDate).getFullYear() : ''}</span>
                        </div>
                    </div>
                </article>
            `).join('');
            wrap.appendChild(grid);
            container.appendChild(wrap);
        } else if (filter === 'Movie' || filter === 'Series') {
            // Single-type filtered view – group by category
            const categories = [...new Set(items.map(item => item.category))];
            const wrap = document.createElement('div');
            wrap.style.padding = '1.5rem 0 3rem';
            categories.forEach(cat => {
                const catItems = items.filter(item => item.category === cat);
                if (catItems.length === 0) return;

                const row = document.createElement('section');
                row.className = 'content-row';
                row.innerHTML = `
                    <div class="row-header" style="padding: 0 4%;">
                        <h2 class="row-title">${cat}</h2>
                    </div>
                    <div class="row-cards" style="padding: 0 4%;">
                        ${catItems.map(item => `
                            <article class="card" data-id="${item.id}">
                                <img class="card-thumb" src="${item.thumbPortrait}" alt="${item.title}" loading="lazy">
                                <span class="card-type-badge">${item.type === 'Series' ? 'SERIES' : 'HD'}</span>
                                <div class="card-overlay"><span class="play-icon">▶</span></div>
                                <div class="card-info">
                                    <h3 class="card-title">${item.title}</h3>
                                    <div class="card-meta">
                                        <span>${item.type}</span>
                                        <span>${item.publishDate ? new Date(item.publishDate).getFullYear() : ''}</span>
                                    </div>
                                </div>
                            </article>
                        `).join('')}
                    </div>`;
                wrap.appendChild(row);
            });
            container.appendChild(wrap);
        } else {
            // 'all' – Group by category (home page)
            const categories = [...new Set(items.map(item => item.category))];
            categories.forEach(cat => {
                const catItems = items.filter(item => item.category === cat);
                if (catItems.length === 0) return;

                const row = document.createElement('section');
                row.className = 'content-row';
                row.innerHTML = `
                    <div class="row-header">
                        <h2 class="row-title">${cat}</h2>
                    </div>
                    <div class="row-cards">
                        ${catItems.map(item => `
                            <article class="card" data-id="${item.id}">
                                <img class="card-thumb" src="${item.thumbPortrait}" alt="${item.title}" loading="lazy">
                                <span class="card-type-badge">${item.type === 'Series' ? 'SERIES' : 'HD'}</span>
                                <div class="card-overlay"><span class="play-icon">▶</span></div>
                                <div class="card-info">
                                    <h3 class="card-title">${item.title}</h3>
                                    <div class="card-meta">
                                        <span>HD</span>
                                        <span>${item.publishDate ? new Date(item.publishDate).getFullYear() : ''}</span>
                                    </div>
                                </div>
                            </article>
                        `).join('')}
                    </div>`;
                container.appendChild(row);
            });
        }

        // Only update hero when showing all content
        if (filter === 'all') this.updateHero();
    }

    updateHero() {
        const featured = this.content.find(item => item.featured) || (this.content.length > 0 ? this.content[0] : null);
        const hero = document.getElementById('hero-banner');
        if (hero) {
            if (featured) {
                const title = document.getElementById('featured-title');
                const desc = document.getElementById('featured-desc');
                hero.style.backgroundImage = `url('${featured.thumbLandscape}')`;
                hero.style.display = 'flex';
                if (title) title.textContent = featured.title;
                if (desc) desc.textContent = featured.desc;
                hero.onclick = () => this.navigateToWatch(featured.id);
            } else {
                hero.style.display = 'none';
            }
        }
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

window.auth = new Auth();

document.addEventListener('DOMContentLoaded', () => {
    window.app = new StreamVault();
});

