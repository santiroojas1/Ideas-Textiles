/**
 * ============================================================================
 * IDEAS TEXTILES ENTERPRISE ERP | SYSTEM CORE v2.0
 * @author: Gemini Architecture Team
 * @description: Sistema de gestión integral para manufactura textil.
 * @modules: Inventory, Kanban, Calendar, Camera, PDFEngine, RealTimeDB
 * ============================================================================
 */

/* ----------------------------------------------------------------------------
   1. CONFIGURACIÓN E INICIALIZACIÓN (BOOTSTRAP)
   ---------------------------------------------------------------------------- */
const App = {
    // Estado Global de la Aplicación (Single Source of Truth)
    state: {
        currentUser: 'Admin',
        currentView: 'operations', // operations, inventory, agenda, reports
        inventory: [],
        orders: [],
        activeOrderId: null,      // ID de la orden que se está editando
        cameraStream: null,       // Stream de video activo
        cameraMode: 'global',     // 'global' o ID de orden específica
        isDragging: false,
        filterTerm: '',
    },

    // Referencias a Firebase (Se inicializan en init)
    db: null,
    
    // Configuración de Constantes
    config: {
        companyName: "IDEAS TEXTILES SPA",
        currency: "CLP",
        dateFormat: "es-CL",
        storageKey: "ideas_textiles_local_v1"
    },

    /**
     * Ciclo de Vida: Inicio del Sistema
     */
    init: function() {
        console.log("🚀 [SYSTEM] Iniciando IDEAS TEXTILES ERP...");
        
        // 1.1 Conexión a Firebase (REEMPLAZA ESTO CON TUS DATOS REALES DE FIREBASE CONSOLE)
        const firebaseConfig = {
            apiKey: "TU_API_KEY_AQUI",
            authDomain: "ideastextilesapp.firebaseapp.com",
            databaseURL: "https://ideastextilesapp-default-rtdb.firebaseio.com", // Tu URL Real
            projectId: "ideastextilesapp",
            storageBucket: "ideastextilesapp.appspot.com",
            messagingSenderId: "TU_ID",
            appId: "TU_APP_ID"
        };

        // Prevención de doble inicialización
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        this.db = firebase.database();

        // 1.2 Inicializar Subsistemas
        this.Listeners.setupRealTimeUpdates();
        this.UI.setupDragAndDrop();
        this.UI.renderCalendar(new Date().getMonth(), new Date().getFullYear());
        
        // 1.3 Cargar Vista Inicial
        this.UI.switchView('operations');

        console.log("✅ [SYSTEM] Sistema Operativo y Conectado.");
    }
};

/* ----------------------------------------------------------------------------
   2. MIDDLEWARE DE BASE DE DATOS (FIREBASE HANDLERS)
   ---------------------------------------------------------------------------- */
App.Firebase = {
    /**
     * Guarda o actualiza una orden completa
     * @param {Object} orderData - Objeto de la orden
     */
    saveOrder: async (orderData) => {
        try {
            if (!orderData.id) orderData.id = App.Utils.generateUUID();
            orderData.updatedAt = new Date().toISOString();
            
            // Si es nueva, status default
            if (!orderData.status) orderData.status = 'process'; 
            if (!orderData.evidence) orderData.evidence = [];

            await App.db.ref(`orders/${orderData.id}`).set(orderData);
            App.Utils.notify('Orden Guardada', 'Los datos se han sincronizado correctamente.', 'success');
            return orderData.id;
        } catch (error) {
            console.error("Firebase Error:", error);
            App.Utils.notify('Error de Sincronización', error.message, 'error');
        }
    },

    /**
     * Elimina una orden permanentemente
     */
    deleteOrder: async (id) => {
        try {
            await App.db.ref(`orders/${id}`).remove();
            App.Utils.notify('Eliminado', 'La orden ha sido borrada del sistema.', 'success');
        } catch (error) {
            App.Utils.notify('Error', 'No se pudo eliminar la orden.', 'error');
        }
    },

    /**
     * Actualiza solo el estado (Mover tarjeta)
     */
    updateStatus: async (id, newStatus, index) => {
        await App.db.ref(`orders/${id}`).update({ 
            status: newStatus,
            position: index,
            updatedAt: new Date().toISOString()
        });
    },

    /**
     * Guarda una foto (Base64) en la orden
     */
    addEvidence: async (orderId, base64Image) => {
        const newRef = App.db.ref(`orders/${orderId}/evidence`).push();
        await newRef.set({
            url: base64Image,
            date: new Date().toISOString(),
            user: App.state.currentUser
        });
    },

    /* --- Inventario --- */
    addProduct: async (productData) => {
        if (!productData.id) productData.id = App.Utils.generateUUID();
        await App.db.ref(`inventory/${productData.id}`).set(productData);
        App.Utils.notify('Producto Creado', 'Inventario actualizado.', 'success');
    }
};

/* ----------------------------------------------------------------------------
   3. LISTENERS EN TIEMPO REAL (SYNC ENGINE)
   ---------------------------------------------------------------------------- */
App.Listeners = {
    setupRealTimeUpdates: function() {
        // A. Escuchar Órdenes (Operaciones)
        App.db.ref('orders').on('value', (snapshot) => {
            const data = snapshot.val();
            App.state.orders = data ? Object.values(data) : [];
            
            // Re-renderizar si estamos en la vista correspondiente
            if (App.state.currentView === 'operations') {
                App.UI.renderKanban();
            }
            if (App.state.currentView === 'agenda') {
                // Actualizar puntos en el calendario
                App.UI.updateCalendarEvents();
            }
        });

        // B. Escuchar Inventario (Bodega)
        App.db.ref('inventory').on('value', (snapshot) => {
            const data = snapshot.val();
            App.state.inventory = data ? Object.values(data) : [];
            
            if (App.state.currentView === 'inventory') {
                App.UI.renderInventory();
            }
        });
    }
};

/* ----------------------------------------------------------------------------
   4. CONTROLADORES DE LÓGICA DE NEGOCIO (CONTROLLERS)
   ---------------------------------------------------------------------------- */
App.Controllers = {
    
    // --- Lógica del Tablero Kanban ---
    Kanban: {
        filter: () => {
            const term = document.getElementById('search-operations').value.toLowerCase();
            App.state.filterTerm = term;
            App.UI.renderKanban(); // Re-render con filtro
        }
    },

    // --- Lógica de Órdenes (Creación/Edición) ---
    Order: {
        create: () => {
            App.state.activeOrderId = null; // Nueva orden
            App.UI.openOrderModal({
                client: '', oc: '', invoice: '', items: []
            });
        },

        edit: (id) => {
            const order = App.state.orders.find(o => o.id === id);
            if (!order) return;
            App.state.activeOrderId = id;
            App.UI.openOrderModal(order);
        },

        save: () => {
            // Recolectar datos del DOM (Manual Input)
            const client = document.getElementById('inp-client').value;
            const oc = document.getElementById('inp-oc').value;
            const invoice = document.getElementById('inp-invoice').value;

            // Recolectar filas de la tabla manual
            const rows = [];
            document.querySelectorAll('.order-row-item').forEach(row => {
                rows.push({
                    desc: row.querySelector('.inp-desc').value,
                    qty: row.querySelector('.inp-qty').value,
                    size: row.querySelector('.inp-size').value,
                    price: row.querySelector('.inp-price').value
                });
            });

            if (!client) return App.Utils.notify('Faltan Datos', 'El nombre del cliente es obligatorio.', 'warning');

            const orderPayload = {
                id: App.state.activeOrderId, // Si es null, Firebase crea ID
                client, oc, invoice,
                items: rows
            };

            App.Firebase.saveOrder(orderPayload).then(() => {
                App.Controllers.Order.close();
            });
        },

        delete: () => {
            if(!App.state.activeOrderId) return;
            Swal.fire({
                title: '¿Eliminar Orden?',
                text: "Esta acción no se puede deshacer",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                confirmButtonText: 'Sí, eliminar'
            }).then((result) => {
                if (result.isConfirmed) {
                    App.Firebase.deleteOrder(App.state.activeOrderId);
                    App.Controllers.Order.close();
                }
            });
        },

        addRow: () => {
            const container = document.getElementById('order-rows-container');
            const div = document.createElement('div');
            div.className = "order-row-item flex gap-2 mb-2 items-center animate-fade-in";
            div.innerHTML = `
                <input type="text" class="inp-desc flex-1 p-2 border rounded text-sm bg-gray-50" placeholder="Descripción Producto">
                <input type="text" class="inp-size w-16 p-2 border rounded text-sm text-center" placeholder="Talla">
                <input type="number" class="inp-qty w-16 p-2 border rounded text-sm text-center" placeholder="Cant.">
                <input type="text" class="inp-price w-20 p-2 border rounded text-sm text-right" placeholder="$ Precio">
                <button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 px-2"><i class="fa-solid fa-times"></i></button>
            `;
            container.appendChild(div);
        },

        close: () => {
            document.getElementById('modal-order').classList.add('hidden');
            document.getElementById('modal-order-panel').classList.remove('translate-x-0');
            document.getElementById('modal-order-panel').classList.add('translate-x-full');
            App.state.activeOrderId = null;
        }
    },

    // --- Lógica de Inventario ---
    Inventory: {
        filter: () => {
            const term = document.getElementById('search-inventory').value.toLowerCase();
            const filtered = App.state.inventory.filter(p => 
                p.sku.toLowerCase().includes(term) || 
                p.name.toLowerCase().includes(term)
            );
            App.UI.renderInventoryGrid(filtered);
        },
        
        openModal: () => {
            // Implementación simplificada: Prompt rápido (Version Pro: Hacer otro Modal HTML)
            Swal.mixin({
                input: 'text',
                confirmButtonText: 'Siguiente &rarr;',
                showCancelButton: true,
                progressSteps: ['1', '2', '3']
            }).queue([
                { title: 'Código SKU', text: 'Ej: POL-001' },
                { title: 'Nombre Producto', text: 'Ej: Polera Piqué Azul' },
                { title: 'Stock Inicial', text: 'Cantidad numérica' }
            ]).then((result) => {
                if (result.value) {
                    const [sku, name, stock] = result.value;
                    App.Firebase.addProduct({
                        sku, name, stock: parseInt(stock), 
                        updatedAt: new Date().toISOString()
                    });
                }
            })
        }
    }
};

/* ----------------------------------------------------------------------------
   5. INTERFAZ DE USUARIO (RENDERERS)
   ---------------------------------------------------------------------------- */
App.UI = {
    
    // Cambiar entre las 4 pestañas principales
    switchView: (viewName) => {
        App.state.currentView = viewName;
        
        // 1. Ocultar todas
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

        // 2. Mostrar activa
        document.getElementById(`view-${viewName}`).classList.remove('hidden');
        document.getElementById(`btn-${viewName}`).classList.add('active');

        // 3. Triggers específicos
        if(viewName === 'operations') App.UI.renderKanban();
        if(viewName === 'inventory') App.UI.renderInventory();
        if(viewName === 'agenda') App.UI.updateCalendarEvents();
    },

    // Renderizar Tablero Kanban
    renderKanban: () => {
        const term = App.state.filterTerm;
        const processCol = document.getElementById('col-process');
        const dispatchCol = document.getElementById('col-dispatched');
        
        // Limpiar
        processCol.innerHTML = '';
        dispatchCol.innerHTML = '';

        let countProcess = 0;
        let countDispatch = 0;

        // Ordenar por posición (Drag & Drop sorting)
        const sortedOrders = App.state.orders.sort((a, b) => (a.position || 0) - (b.position || 0));

        sortedOrders.forEach(order => {
            // Filtro de búsqueda
            const searchStr = `${order.client} ${order.oc} ${order.invoice}`.toLowerCase();
            if (term && !searchStr.includes(term)) return;

            // Construir Card HTML
            const card = document.createElement('div');
            card.className = "bg-white p-4 rounded-xl shadow-sm border border-slate-200 cursor-move group hover:shadow-md transition relative";
            card.setAttribute('data-id', order.id);
            
            // Estado visual de evidencia
            const hasEvidence = order.evidence && Object.keys(order.evidence).length > 0;
            const evidenceBadge = hasEvidence 
                ? `<span class="text-emerald-500 text-xs"><i class="fa-solid fa-check-circle"></i> Foto OK</span>`
                : `<span class="text-red-400 text-xs"><i class="fa-solid fa-triangle-exclamation"></i> Sin Foto</span>`;

            card.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded font-mono">${order.oc || 'S/N'}</span>
                    <button onclick="App.Controllers.Order.edit('${order.id}')" class="text-gray-400 hover:text-blue-600"><i class="fa-solid fa-pen-to-square"></i></button>
                </div>
                <h4 class="font-bold text-slate-800 text-sm leading-tight mb-1">${order.client || 'Cliente Sin Nombre'}</h4>
                <p class="text-xs text-gray-500 mb-3 line-clamp-2">${order.items ? order.items.map(i => i.desc).join(', ') : 'Sin detalle'}</p>
                
                <div class="flex justify-between items-center border-t border-gray-100 pt-2 mt-2">
                    <div class="flex items-center gap-2">
                        ${evidenceBadge}
                    </div>
                    ${order.status === 'dispatched' ? `
                        <button onclick="App.PDF.generateLabel('${order.id}')" class="text-slate-400 hover:text-slate-800 text-xs" title="Imprimir Etiqueta"><i class="fa-solid fa-print"></i></button>
                    ` : ''}
                </div>
            `;

            // Inyectar en columna correcta
            if (order.status === 'dispatched') {
                dispatchCol.appendChild(card);
                countDispatch++;
            } else {
                processCol.appendChild(card);
                countProcess++;
            }
        });

        // Actualizar contadores
        document.getElementById('count-process').innerText = countProcess;
        document.getElementById('count-dispatched').innerText = countDispatch;
    },

    // Inicializar SortableJS (Drag and Drop Library)
    setupDragAndDrop: () => {
        const cols = ['col-process', 'col-dispatched'];
        
        cols.forEach(colId => {
            new Sortable(document.getElementById(colId), {
                group: 'kanban', // Permite mover entre columnas
                animation: 150,
                ghostClass: 'bg-blue-50',
                delay: 100, // Prevenir arrastre accidental en touch
                delayOnTouchOnly: true,
                onEnd: function (evt) {
                    const itemEl = evt.item;
                    const newStatus = evt.to.id === 'col-dispatched' ? 'dispatched' : 'process';
                    const orderId = itemEl.getAttribute('data-id');
                    const newIndex = evt.newIndex;

                    // Regla de Negocio: No permitir despacho sin evidencia
                    if (newStatus === 'dispatched') {
                        const order = App.state.orders.find(o => o.id === orderId);
                        const hasEvidence = order.evidence && Object.keys(order.evidence).length > 0;
                        
                        if (!hasEvidence) {
                            App.Utils.notify('¡Alto!', 'No puedes despachar sin evidencia fotográfica.', 'error');
                            // Revertir movimiento visualmente (Sortable no tiene revert simple, recargamos)
                            setTimeout(() => App.UI.renderKanban(), 500); 
                            return;
                        }
                    }

                    // Guardar cambio en BD
                    App.Firebase.updateStatus(orderId, newStatus, newIndex);
                }
            });
        });
    },

    // Renderizar Inventario
    renderInventory: () => {
        const grid = document.getElementById('inventory-grid');
        grid.innerHTML = '';
        App.state.inventory.forEach(prod => {
            const card = document.createElement('div');
            card.className = "bg-white border rounded-xl p-4 flex flex-col gap-2 hover:shadow-lg transition";
            card.innerHTML = `
                <div class="w-full h-32 bg-slate-100 rounded-lg flex items-center justify-center mb-2">
                    <i class="fa-solid fa-shirt text-4xl text-slate-300"></i>
                </div>
                <div>
                    <p class="text-xs font-bold text-blue-600 uppercase mb-1">${prod.sku}</p>
                    <h3 class="font-bold text-slate-800 text-sm leading-tight">${prod.name}</h3>
                </div>
                <div class="mt-auto pt-4 border-t flex justify-between items-center">
                    <span class="text-xs text-gray-500">Stock Actual</span>
                    <span class="text-lg font-bold text-slate-800">${prod.stock} <span class="text-xs font-normal text-gray-400">un.</span></span>
                </div>
            `;
            grid.appendChild(card);
        });
    },

    // Renderizar Estructura Calendario
    renderCalendar: (month, year) => {
        const container = document.getElementById('calendar-grid-container');
        container.innerHTML = '';
        
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayIndex = new Date(year, month, 1).getDay(); // 0 Dom, 1 Lun...
        
        // Ajuste para que Lun sea 0 en visualización si se desea, o usar celdas vacías
        // Aquí usaremos celdas vacías para rellenar
        const adjustedFirstDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1; // Lunes start

        for (let i = 0; i < adjustedFirstDay; i++) {
            const empty = document.createElement('div');
            empty.className = "calendar-day bg-slate-50";
            container.appendChild(empty);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const cell = document.createElement('div');
            cell.className = "calendar-day relative flex flex-col justify-between";
            // Marcar hoy
            const today = new Date();
            if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
                cell.classList.add('today');
            }

            cell.innerHTML = `
                <span class="text-sm font-bold text-slate-700">${day}</span>
                <div class="flex-1 flex flex-col gap-1 mt-1 overflow-hidden" id="cal-day-${day}">
                    </div>
            `;
            container.appendChild(cell);
        }
    },

    updateCalendarEvents: () => {
        // Limpiar eventos previos
        document.querySelectorAll('[id^="cal-day-"]').forEach(el => el.innerHTML = '');

        const currentMonth = new Date().getMonth(); // Asumiendo vista actual
        const currentYear = new Date().getFullYear();

        App.state.orders.forEach(order => {
            if (!order.updatedAt) return;
            const date = new Date(order.updatedAt);
            
            // Si la orden es de este mes y año
            if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
                const day = date.getDate();
                const container = document.getElementById(`cal-day-${day}`);
                if (container) {
                    const dot = document.createElement('div');
                    dot.className = `text-[8px] px-1 py-0.5 rounded truncate ${order.status === 'dispatched' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`;
                    dot.innerText = order.client || 'Orden';
                    container.appendChild(dot);
                }
            }
        });
    },

    // Abrir Modal de Edición
    openOrderModal: (orderData) => {
        const modal = document.getElementById('modal-order');
        const panel = document.getElementById('modal-order-panel');
        
        modal.classList.remove('hidden');
        // Pequeño delay para animación CSS
        setTimeout(() => {
            panel.classList.remove('translate-x-full');
            panel.classList.add('translate-x-0');
        }, 10);

        // Llenar datos
        document.getElementById('inp-client').value = orderData.client || '';
        document.getElementById('inp-oc').value = orderData.oc || '';
        document.getElementById('inp-invoice').value = orderData.invoice || '';
        
        // Llenar filas manuales
        const container = document.getElementById('order-rows-container');
        container.innerHTML = '';
        if (orderData.items && orderData.items.length > 0) {
            orderData.items.forEach(item => {
                // Reutilizamos lógica de agregar fila pero con valores
                App.Controllers.Order.addRow(); // Crea vacío
                const lastRow = container.lastElementChild;
                lastRow.querySelector('.inp-desc').value = item.desc;
                lastRow.querySelector('.inp-qty').value = item.qty;
                lastRow.querySelector('.inp-size').value = item.size;
                lastRow.querySelector('.inp-price').value = item.price;
            });
        } else {
            // Fila vacía por defecto
            App.Controllers.Order.addRow();
        }

        // Galería de evidencia
        const gallery = document.getElementById('evidence-gallery');
        gallery.innerHTML = '';
        const sectionEvidence = document.getElementById('section-evidence');
        
        // Mostrar sección evidencia solo si existe la orden (no es nueva)
        if (App.state.activeOrderId) {
            sectionEvidence.classList.remove('hidden');
            if (orderData.evidence) {
                Object.values(orderData.evidence).forEach(img => {
                    const thumb = document.createElement('div');
                    thumb.className = "aspect-square rounded-lg bg-cover bg-center border shadow-sm";
                    thumb.style.backgroundImage = `url(${img.url})`;
                    gallery.appendChild(thumb);
                });
            }
        } else {
            sectionEvidence.classList.add('hidden');
        }
    }
};

/* ----------------------------------------------------------------------------
   6. CONTROLADOR DE CÁMARA (WEBRTC & CANVAS)
   ---------------------------------------------------------------------------- */
App.Camera = {
    init: async (mode) => {
        App.state.cameraMode = mode;
        const modal = document.getElementById('modal-camera');
        const video = document.getElementById('camera-feed');
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } // Cámara trasera
            });
            App.state.cameraStream = stream;
            video.srcObject = stream;
            modal.classList.remove('hidden');
        } catch (err) {
            App.Utils.notify('Error de Cámara', 'No se pudo acceder a la cámara. Verifique permisos.', 'error');
            console.error(err);
        }
    },

    capture: () => {
        const video = document.getElementById('camera-feed');
        const canvas = document.getElementById('camera-canvas');
        const context = canvas.getContext('2d');

        // Configurar canvas al tamaño del video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Dibujar frame actual
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convertir a Base64 (JPG comprimido)
        const imageData = canvas.toDataURL('image/jpeg', 0.7);
        
        // Procesar según modo
        if (App.state.cameraMode === 'global') {
            // Modo Rápido (Guardar en una bitácora temporal o alertar)
            App.Utils.notify('Captura Rápida', 'Foto guardada en portapapeles temporal.', 'info');
        } else {
            // Guardar en Orden específica
            App.Firebase.addEvidence(App.state.cameraMode, imageData);
            App.Utils.notify('Éxito', 'Evidencia adjuntada a la orden.', 'success');
            
            // Refrescar modal si está abierto
            const order = App.state.orders.find(o => o.id === App.state.cameraMode);
            if (order) App.UI.openOrderModal(order);
        }

        App.Camera.close();
    },

    close: () => {
        const modal = document.getElementById('modal-camera');
        modal.classList.add('hidden');
        
        if (App.state.cameraStream) {
            App.state.cameraStream.getTracks().forEach(track => track.stop());
            App.state.cameraStream = null;
        }
    }
};

/* ----------------------------------------------------------------------------
   7. MOTOR DE REPORTES PDF (JSPDF + AUTOTABLE)
   ---------------------------------------------------------------------------- */
App.PDF = {
    // A. PDF ETIQUETA (Sticker 10x15 o Carta)
    generateLabel: (orderId) => {
        const order = App.state.orders.find(o => o.id === orderId);
        if (!order) return;

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: "landscape",
            unit: "mm",
            format: [100, 150] // Tamaño etiqueta térmica standard
        });

        // Diseño Etiqueta
        doc.setFillColor(0, 0, 0);
        doc.rect(0, 0, 150, 20, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("DESTINATARIO", 5, 13);

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(18);
        doc.text(order.client.substring(0, 25), 5, 35);
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`OC REF: ${order.oc || 'N/A'}`, 5, 45);
        doc.text(`DOC: ${order.invoice || 'N/A'}`, 5, 50);
        
        doc.setLineWidth(1);
        doc.line(5, 55, 145, 55);

        doc.setFontSize(30);
        doc.setFont("helvetica", "bold");
        doc.text("FRÁGIL", 5, 75);

        doc.setFontSize(8);
        doc.text(`Generado: ${new Date().toLocaleDateString()}`, 5, 95);

        doc.save(`Etiqueta_${order.client}.pdf`);
    },

    // B. PDF ORDEN FORMAL (Documento Comercial)
    generateFormalOrder: () => {
        const orderId = App.state.activeOrderId;
        if (!orderId) return;
        const order = App.state.orders.find(o => o.id === orderId);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Header Corporativo
        doc.setFontSize(22);
        doc.setTextColor(15, 23, 42); // Brand Navy
        doc.text("IDEAS TEXTILES SPA", 14, 20);
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text("Departamento de Producción y Calidad", 14, 26);
        doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 32);

        // Info Cliente
        doc.setFillColor(241, 245, 249);
        doc.rect(14, 40, 182, 25, 'F');
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text(`CLIENTE: ${order.client}`, 20, 50);
        doc.text(`ORDEN DE COMPRA: ${order.oc}`, 20, 58);
        doc.text(`FACTURA / GUÍA: ${order.invoice}`, 120, 58);

        // Tabla Detalle (AutoTable)
        const tableBody = order.items ? order.items.map(item => [
            item.desc, item.size, item.qty, `$ ${item.price}`
        ]) : [];

        doc.autoTable({
            startY: 75,
            head: [['Descripción', 'Talla', 'Cant', 'Precio Unit.']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [15, 23, 42] },
            styles: { fontSize: 10 }
        });

        // Footer
        const finalY = doc.lastAutoTable.finalY + 20;
        doc.setFontSize(10);
        doc.text("__________________________", 14, finalY);
        doc.text("Firma Recepción Conforme", 14, finalY + 5);

        doc.save(`Orden_Formal_${order.oc}.pdf`);
    },

    // C. PDF REPORTE GERENCIAL (Resumen Global)
    generateManagerReport: () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Título
        doc.setFontSize(18);
        doc.text("REPORTE GERENCIAL DE OPERACIONES", 14, 22);
        doc.setFontSize(11);
        doc.text(`Generado el: ${new Date().toLocaleString()}`, 14, 30);

        // KPI Resumen
        const totalOrders = App.state.orders.length;
        const dispatched = App.state.orders.filter(o => o.status === 'dispatched').length;
        const pending = totalOrders - dispatched;

        doc.autoTable({
            startY: 40,
            head: [['Métrica', 'Valor']],
            body: [
                ['Total Órdenes Activas', totalOrders],
                ['En Producción', pending],
                ['Despachadas', dispatched],
                ['Eficiencia de Despacho', `${((dispatched/totalOrders)*100).toFixed(1)}%`]
            ],
            theme: 'striped',
            headStyles: { fillColor: [59, 130, 246] }
        });

        // Listado Detallado
        doc.text("Detalle de Órdenes en Curso", 14, doc.lastAutoTable.finalY + 15);
        
        const rows = App.state.orders.map(o => [
            o.oc, 
            o.client, 
            o.status === 'dispatched' ? 'DESPACHADO' : 'TALLER',
            new Date(o.updatedAt).toLocaleDateString()
        ]);

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 20,
            head: [['OC', 'Cliente', 'Estado', 'Últ. Actividad']],
            body: rows,
        });

        doc.save('Reporte_Gerencial_Mensual.pdf');
    }
};

/* ----------------------------------------------------------------------------
   8. UTILIDADES Y HELPERS GLOBALES
   ---------------------------------------------------------------------------- */
App.Utils = {
    generateUUID: () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    notify: (title, text, icon) => {
        Swal.fire({
            title: title,
            text: text,
            icon: icon,
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
        });
    }
};

/* ----------------------------------------------------------------------------
   9. BOOTSTRAPPER (EJECUCIÓN)
   ---------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    // Esperar a que las librerías carguen
    if (typeof firebase !== 'undefined' && typeof Sortable !== 'undefined') {
        App.init();
    } else {
        alert("ERROR CRÍTICO: Librerías no cargadas. Revise su conexión a internet.");
    }
});
