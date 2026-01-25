/**
 * ============================================================================
 * IDEAS TEXTILES SPA - ERP CORE (app.js)
 * Arquitectura: Vanilla JS + Firebase Realtime Database
 * Nivel: Enterprise / Senior
 * ============================================================================
 */

// ============================================================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ============================================================================

const APP_CONFIG = {
    firebaseURL: "https://ideastextilesapp-default-rtdb.firebaseio.com",
    companyName: "Ideas Textiles SPA",
    managerName: "Alejandro Cisterna Ojeda",
    managerTitle: "Gerente General",
    tallas: ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"], // Talla Única es implícita si vacío
    pdfPageSize: {
        tacha: [100, 150], // mm (Etiqueta térmica aprox)
        doc: "legal" // Oficio
    }
};

// Configuración de Firebase (v8 namespace compatible con index.html)
const firebaseConfig = {
    databaseURL: APP_CONFIG.firebaseURL
};

// Inicializar Firebase si no existe
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); // usar la existente
}

const db = firebase.database();

// ============================================================================
// 2. ESTADO GLOBAL (SINGLE SOURCE OF TRUTH)
// ============================================================================

const STATE = {
    products: {},
    fabrics: {},
    orders: {},
    calendarEvents: {},
    auditLog: [],
    ui: {
        currentView: 'inventory',
        currentModal: null,
        tempDispatchData: null // Almacena config temporal de bultos
    },
    connected: false
};

// ============================================================================
// 3. UTILIDADES GENERALES (CORE UTILS)
// ============================================================================

const Utils = {
    // Generador de ID único
    generateID: (prefix) => {
        return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    },

    // Formateador de moneda (CLP)
    formatCurrency: (amount) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    },

    // Formateador de fecha
    formatDate: (dateString) => {
        if (!dateString) return '-';
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('es-CL', options);
    },

    // Selector DOM seguro
    $: (selector) => document.querySelector(selector),
    $$: (selector) => document.querySelectorAll(selector),

    // Convertir File a Base64
    fileToBase64: (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    },

    // Logger de Auditoría
    logAction: (action, details) => {
        const logEntry = {
            timestamp: new Date().toISOString(),
            action: action,
            details: details,
            user: "Admin (Sistema)" // Sin login, usuario único
        };
        // Guardar en Firebase (Append only)
        db.ref('auditLog').push(logEntry);
    },

    // Validar inputs obligatorios
    validateForm: (formElement) => {
        const inputs = formElement.querySelectorAll('[required]');
        let isValid = true;
        inputs.forEach(input => {
            if (!input.value.trim()) {
                input.style.borderColor = 'red';
                isValid = false;
            } else {
                input.style.borderColor = '#E5E5EA';
            }
        });
        return isValid;
    },

    // Mostrar Notificación Toast (Estilo iOS)
    showToast: (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px; 
            padding: 12px 24px; border-radius: 50px; 
            background: ${type === 'error' ? 'rgba(255, 59, 48, 0.9)' : 'rgba(255, 255, 255, 0.9)'};
            color: ${type === 'error' ? 'white' : '#1C1C1E'};
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            backdrop-filter: blur(10px); z-index: 9999;
            font-weight: 600; font-size: 14px;
            transform: translateY(-20px); opacity: 0; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        `;
        document.body.appendChild(toast);
        
        // Animación Entrada
        requestAnimationFrame(() => {
            toast.style.transform = 'translateY(0)';
            toast.style.opacity = '1';
        });

        // Animación Salida
        setTimeout(() => {
            toast.style.transform = 'translateY(-20px)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

// ============================================================================
// 4. CAPA DE SINCRONIZACIÓN (FIREBASE LISTENERS)
// ============================================================================

const SyncLayer = {
    init: () => {
        // Listener de Conexión
        db.ref('.info/connected').on('value', (snap) => {
            STATE.connected = snap.val();
            const dot = Utils.$('#connection-status-dot');
            const text = Utils.$('#connection-text');
            if (STATE.connected) {
                dot.classList.add('online');
                text.textContent = 'En Línea';
            } else {
                dot.classList.remove('online');
                text.textContent = 'Desconectado';
            }
        });

        // 1. Productos
        db.ref('products').on('value', (snapshot) => {
            STATE.products = snapshot.val() || {};
            if (STATE.ui.currentView === 'inventory') UIRenderer.renderInventory();
            UIRenderer.updateKPIs();
        });

        // 2. Telas
        db.ref('fabrics').on('value', (snapshot) => {
            STATE.fabrics = snapshot.val() || {};
            if (STATE.ui.currentView === 'inventory') UIRenderer.renderInventory(); // Telas están dentro
            UIRenderer.updateKPIs();
        });

        // 3. Órdenes
        db.ref('orders').on('value', (snapshot) => {
            STATE.orders = snapshot.val() || {};
            if (STATE.ui.currentView === 'orders') UIRenderer.renderOrders();
            if (STATE.ui.currentView === 'dispatch') UIRenderer.renderDispatchSelection();
        });

        // 4. Calendario
        db.ref('calendarEvents').on('value', (snapshot) => {
            STATE.calendarEvents = snapshot.val() || {};
            if (STATE.ui.currentView === 'calendar') UIRenderer.renderCalendar();
        });

        // 5. Auditoría
        db.ref('auditLog').limitToLast(50).on('value', (snapshot) => {
            const logs = [];
            snapshot.forEach(child => logs.unshift(child.val()));
            STATE.auditLog = logs;
            if (STATE.ui.currentView === 'audit') UIRenderer.renderAuditLog();
        });
    }
};

// ============================================================================
// 5. LÓGICA DE NEGOCIO - MÓDULOS
// ============================================================================

const InventoryModule = {
    saveProduct: async (productData) => {
        const id = productData.id || Utils.generateID('PROD');
        // Asegurar estructura de tallas
        const sizesData = {};
        APP_CONFIG.tallas.forEach(t => {
            sizesData[t] = parseInt(productData[`stock_${t}`] || 0);
        });
        
        // Si no hay talla seleccionada específicamente en UI, manejar lógica interna (simplificado aquí a guardar todo)
        // Guardamos metadatos
        const payload = {
            id: id,
            sku: productData.sku.toUpperCase(),
            name: productData.name,
            category: 'Prenda',
            price: parseInt(productData.price),
            sizes: sizesData,
            notes: productData.notes,
            lastUpdated: new Date().toISOString()
        };

        try {
            await db.ref(`products/${id}`).set(payload);
            Utils.showToast('Producto guardado correctamente');
            Utils.logAction('SAVE_PRODUCT', `SKU: ${payload.sku}`);
            ModalManager.close();
        } catch (e) {
            console.error(e);
            Utils.showToast('Error al guardar', 'error');
        }
    },

    deleteProduct: async (id) => {
        if (!confirm('¿Estás seguro de eliminar este producto? Esta acción es irreversible.')) return;
        try {
            await db.ref(`products/${id}`).remove();
            Utils.showToast('Producto eliminado');
            Utils.logAction('DELETE_PRODUCT', `ID: ${id}`);
        } catch (e) {
            Utils.showToast('Error al eliminar', 'error');
        }
    }
};

const FabricsModule = {
    // Las telas son un flujo de movimientos, no solo un número estático
    addMovement: async (data) => {
        const id = data.id || Utils.generateID('FABRIC'); // ID de la tela
        const movementId = Utils.generateID('MOV');
        
        // Estructura de la tela si es nueva
        const fabricPayload = {
            id: id,
            name: data.name,
            code: data.code,
            type: data.type, // 'TELA' o 'INSUMO'
            lastUpdated: new Date().toISOString()
        };

        // Movimiento (Log)
        const movementPayload = {
            id: movementId,
            fabricId: id,
            type: data.movementType, // 'IN' o 'OUT'
            quantity: parseFloat(data.quantity), // Metros
            photo: data.photoBase64, // OBLIGATORIO
            message: data.message, // OBLIGATORIO
            date: new Date().toISOString()
        };

        try {
            // Actualizar cabecera de tela
            await db.ref(`fabrics/${id}/info`).update(fabricPayload);
            // Guardar movimiento
            await db.ref(`fabrics/${id}/movements/${movementId}`).set(movementPayload);
            
            Utils.showToast('Movimiento de tela registrado');
            Utils.logAction('FABRIC_MOVEMENT', `${data.movementType} ${data.quantity}m - ${data.code}`);
            ModalManager.close();
        } catch (e) {
            console.error(e);
            Utils.showToast('Error al guardar movimiento', 'error');
        }
    }
};

const OrdersModule = {
    saveOrder: async (orderData) => {
        const id = orderData.id || Utils.generateID('ORD');
        
        const payload = {
            id: id,
            number: orderData.number,
            client: orderData.client,
            deliveryDate: orderData.deliveryDate,
            status: orderData.status || 'PROCESS', // PROCESS | DISPATCHED
            items: orderData.items, // Array [{sku, size, qty, notes}]
            globalNotes: orderData.globalNotes,
            created: orderData.created || new Date().toISOString(),
            updated: new Date().toISOString(),
            // Datos de despacho (si existen)
            dispatchData: orderData.dispatchData || null
        };

        try {
            await db.ref(`orders/${id}`).set(payload);
            Utils.showToast('Orden guardada exitosamente');
            Utils.logAction('SAVE_ORDER', `Orden #${payload.number}`);
            ModalManager.close();
        } catch (e) {
            Utils.showToast('Error al guardar orden', 'error');
        }
    },

    deleteOrder: async (id) => {
        if (!confirm('¿Borrar orden permanentemente?')) return;
        await db.ref(`orders/${id}`).remove();
        Utils.showToast('Orden eliminada');
    }
};

// ============================================================================
// 6. LÓGICA DE DESPACHO Y BULTOS (CRÍTICA)
// ============================================================================

const DispatchModule = {
    // Paso 1: Configurar Bultos
    initDispatchConfig: (orderId) => {
        const order = STATE.orders[orderId];
        if (!order) return;

        // Renderizar Modal de Configuración Inicial
        const html = `
            <div style="padding:10px;">
                <p style="margin-bottom:15px; color:#666;">Orden <strong>${order.number}</strong> - Cliente: ${order.client}</p>
                
                <div style="margin-bottom:15px;">
                    <label style="display:block; font-size:12px; font-weight:600; margin-bottom:5px;">Nº Factura / Documento</label>
                    <input type="text" id="disp-invoice" placeholder="Ej: 12345" value="${order.dispatchData?.invoice || ''}">
                </div>

                <div style="margin-bottom:15px;">
                    <label style="display:block; font-size:12px; font-weight:600; margin-bottom:5px;">Cantidad de Bultos (Cajas)</label>
                    <input type="number" id="disp-bundles-count" min="1" max="20" value="${order.dispatchData?.bundles?.length || 1}">
                </div>

                <div style="margin-bottom:15px;">
                    <label style="display:block; font-size:12px; font-weight:600; margin-bottom:5px;">Lugar de Despacho</label>
                    <input type="text" id="disp-location" value="${order.dispatchData?.location || 'Bodega Central'}" placeholder="Ubicación física">
                </div>
            </div>
        `;

        ModalManager.open('Configurar Despacho', html, () => {
            // Callback Guardar Configuración Inicial y pasar a UI de empaquetado
            const invoice = Utils.$('#disp-invoice').value;
            const bundlesCount = parseInt(Utils.$('#disp-bundles-count').value) || 1;
            const location = Utils.$('#disp-location').value;

            if (!invoice) return Utils.showToast('Nº Factura es obligatorio', 'error');

            // Crear estructura de bultos vacía o mantener existente si cuadra
            let bundles = [];
            for (let i = 0; i < bundlesCount; i++) {
                // Si ya existía y tenía datos, intentamos preservar, si no, vacío
                bundles.push({
                    id: i + 1,
                    items: [] // {sku, size, qty}
                });
            }

            // Guardar en estado temporal y renderizar UI de despacho completa
            STATE.ui.tempDispatchData = {
                orderId,
                invoice,
                location,
                bundles
            };

            // Cerrar modal y renderizar la vista compleja en el panel derecho
            ModalManager.close();
            UIRenderer.renderDispatchPackingUI();
        });
    },

    // Paso 2: Generar y Guardar Despacho
    finalizeDispatch: async () => {
        const temp = STATE.ui.tempDispatchData;
        if (!temp) return;

        // Validar Fotos (Simulado: en un entorno real iteraríamos inputs de archivo por bulto)
        // Aquí asumimos que las fotos se adjuntan al momento de generar la tacha o se guardan en el objeto de orden globalmente.
        // Por simplicidad del ejemplo y limitación de input, pedimos una foto global del despacho.
        const photoInput = Utils.$('#dispatch-global-photo');
        let photoBase64 = null;
        
        if (photoInput && photoInput.files.length > 0) {
            photoBase64 = await Utils.fileToBase64(photoInput.files[0]);
        } else if (!STATE.orders[temp.orderId].dispatchData?.photo) {
            return Utils.showToast('Foto del despacho (tipo Mercado Libre) es obligatoria', 'error');
        }

        // Recolectar distribución de items en bultos desde el DOM
        // Iteramos por bulto y por item
        const order = STATE.orders[temp.orderId];
        const bundles = temp.bundles.map(b => ({ ...b, items: [] })); // Reiniciar items para rellenar desde UI

        // Recorrer inputs de la matriz
        order.items.forEach((item, itemIdx) => {
            temp.bundles.forEach((bundle, bundleIdx) => {
                const inputId = `pacc-${itemIdx}-${bundleIdx}`;
                const el = document.getElementById(inputId);
                if (el) {
                    const qty = parseInt(el.value) || 0;
                    if (qty > 0) {
                        bundles[bundleIdx].items.push({
                            sku: item.sku,
                            size: item.size,
                            productName: item.productName || 'Producto',
                            qty: qty,
                            notes: item.notes // Heredar notas
                        });
                    }
                }
            });
        });

        // Actualizar Orden
        const updatedOrder = {
            ...order,
            status: 'DISPATCHED',
            dispatchData: {
                invoice: temp.invoice,
                location: temp.location,
                photo: photoBase64 || order.dispatchData?.photo, // Mantener foto anterior si no se sube nueva
                bundles: bundles,
                dispatchedDate: new Date().toISOString()
            }
        };

        try {
            await db.ref(`orders/${temp.orderId}`).set(updatedOrder);
            Utils.showToast('Despacho Registrado. Generando Tachas...');
            
            // Generar PDFs
            PDFGenerator.generateTachas(updatedOrder);
            
            // Limpiar UI
            STATE.ui.tempDispatchData = null;
            Utils.$('#dispatch-configuration-area').innerHTML = '';
        } catch (e) {
            console.error(e);
            Utils.showToast('Error al finalizar despacho', 'error');
        }
    }
};

// ============================================================================
// 7. GENERACIÓN DE PDFS (JSPDF)
// ============================================================================

const PDFGenerator = {
    // 1. TACHAS (Etiquetas por Bulto)
    generateTachas: (order) => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: APP_CONFIG.pdfPageSize.tacha
        });

        order.dispatchData.bundles.forEach((bundle, index) => {
            if (index > 0) doc.addPage();

            // Marco
            doc.setLineWidth(0.5);
            doc.rect(2, 2, 146, 96); // Ajustado al tamaño aprox

            // Encabezado
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(APP_CONFIG.companyName, 5, 10);
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(`Lugar: ${order.dispatchData.location}`, 5, 16);
            
            doc.setFontSize(12);
            doc.text(`ORDEN: ${order.number}`, 100, 10);
            doc.text(`BULTO: ${bundle.id} / ${order.dispatchData.bundles.length}`, 100, 16);
            
            doc.line(2, 20, 148, 20);

            // Contenido del Bulto
            let y = 28;
            doc.setFontSize(9);
            doc.text("Producto / Talla", 5, y);
            doc.text("Cant", 80, y);
            doc.text("Check", 100, y);
            doc.text("Notas", 115, y);
            y += 2;
            doc.line(5, y, 145, y);
            y += 5;

            bundle.items.forEach(item => {
                const text = `${item.sku} (${item.size})`;
                doc.text(text.substring(0, 40), 5, y);
                doc.text(item.qty.toString(), 85, y, { align: 'center' });
                doc.rect(102, y - 3, 4, 4); // Checkbox
                if(item.notes) {
                     doc.setFontSize(7);
                     doc.text(item.notes.substring(0, 20), 115, y);
                     doc.setFontSize(9);
                }
                y += 6;
                
                // Salto de página simple si se llena la tacha (poco probable en diseño etiquetas, pero seguridad)
                if (y > 90) {
                    doc.addPage();
                    y = 10;
                }
            });

            // Pie de página
            doc.setFontSize(8);
            doc.text(`Factura: ${order.dispatchData.invoice}`, 5, 95);
            doc.text(`Cliente: ${order.client}`, 50, 95);
        });

        doc.save(`Tachas_Orden_${order.number}.pdf`);
    },

    // 2. COTIZACIÓN
    generateQuote: (data) => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF(); // A4 por defecto

        // Logo y Header
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(APP_CONFIG.companyName, 20, 20);
        
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text("COTIZACIÓN FORMAL", 150, 20);
        doc.text(`Fecha: ${Utils.formatDate(data.date)}`, 150, 28);
        doc.text(`Cliente: ${data.client}`, 20, 40);

        // Tabla Items
        let y = 60;
        doc.setFillColor(240, 240, 240);
        doc.rect(20, y-5, 170, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.text("Descripción", 25, y);
        doc.text("Cant", 140, y);
        doc.text("Precio", 170, y);
        
        y += 10;
        doc.setFont('helvetica', 'normal');
        
        let total = 0;
        data.items.forEach(item => {
            doc.text(item.desc, 25, y);
            doc.text(item.qty.toString(), 145, y, {align:'center'});
            doc.text(Utils.formatCurrency(item.price), 170, y);
            total += (item.qty * item.price);
            y += 8;
        });

        // Total
        y += 5;
        doc.line(20, y, 190, y);
        y += 10;
        doc.setFont('helvetica', 'bold');
        doc.text(`TOTAL NETO: ${Utils.formatCurrency(total)}`, 140, y);

        // Firma
        y = 250;
        doc.line(70, y, 140, y);
        doc.text(APP_CONFIG.managerName, 105, y + 5, {align: 'center'});
        doc.setFontSize(10);
        doc.text(APP_CONFIG.managerTitle, 105, y + 10, {align: 'center'});

        doc.save(`Cotizacion_${data.client}.pdf`);
    },

    // 3. AUDITORÍA (SNAPSHOT)
    generateAuditSnapshot: () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(18);
        doc.text(`AUDITORÍA DE SISTEMA - ${APP_CONFIG.companyName}`, 15, 20);
        doc.setFontSize(10);
        doc.text(`Fecha Snapshot: ${new Date().toLocaleString()}`, 15, 28);

        let y = 40;

        // Resumen
        doc.setFont('helvetica', 'bold');
        doc.text("RESUMEN DE ESTADO", 15, y);
        y+=10;
        doc.setFont('helvetica', 'normal');
        doc.text(`Total Productos: ${Object.keys(STATE.products).length}`, 20, y); y+=6;
        doc.text(`Total Órdenes Activas: ${Object.values(STATE.orders).filter(o => o.status === 'PROCESS').length}`, 20, y); y+=6;
        
        y+=10;
        doc.setFont('helvetica', 'bold');
        doc.text("ÚLTIMOS MOVIMIENTOS", 15, y);
        y+=10;
        doc.setFont('helvetica', 'normal');
        
        STATE.auditLog.slice(0, 20).forEach(log => {
            const line = `${log.timestamp.substring(0,16)} | ${log.action} | ${log.details}`;
            doc.text(line, 20, y);
            y+=6;
            if(y > 280) { doc.addPage(); y=20; }
        });

        doc.save(`Auditoria_${new Date().toISOString().slice(0,10)}.pdf`);
    }
};

// ============================================================================
// 8. RENDERIZADO UI (MANIPULACIÓN DOM)
// ============================================================================

const UIRenderer = {
    // Render Inventario (Prendas)
    renderInventory: () => {
        const container = Utils.$('#inventory-container');
        container.innerHTML = '';

        // Filtro simple (podría ser más complejo)
        const products = Object.values(STATE.products);

        products.forEach(p => {
            // Calcular stock total
            const totalStock = Object.values(p.sizes || {}).reduce((a, b) => a + b, 0);
            const isLowStock = totalStock < 5; // Regla de negocio simple

            const card = document.createElement('div');
            card.className = 'ios-card';
            card.innerHTML = `
                <div class="card-header">
                    <span style="font-weight:700; color:var(--ios-blue);">${p.sku}</span>
                    <span class="btn-ios ${isLowStock ? 'btn-danger' : 'btn-secondary'}" style="font-size:10px; padding:4px 8px;">
                        ${totalStock} unid.
                    </span>
                </div>
                <h4 style="margin:0 0 5px 0; font-size:16px;">${p.name}</h4>
                <p style="color:var(--ios-text-secondary); font-size:12px; margin-bottom:15px;">${Utils.formatCurrency(p.price)}</p>
                
                <div style="display:flex; gap:5px; flex-wrap:wrap; margin-bottom:15px;">
                    ${Object.entries(p.sizes || {}).map(([size, qty]) => 
                        qty > 0 ? `<span style="background:var(--ios-bg-primary); padding:2px 6px; border-radius:4px; font-size:10px;">${size}: ${qty}</span>` : ''
                    ).join('')}
                </div>

                <div style="display:flex; gap:10px; margin-top:auto;">
                    <button class="btn-ios btn-secondary" onclick="UIRenderer.openProductModal('${p.id}')" style="flex:1;">Editar</button>
                    <button class="btn-ios btn-danger" onclick="InventoryModule.deleteProduct('${p.id}')" style="padding:10px;">🗑</button>
                </div>
            `;
            container.appendChild(card);
        });
    },

    // KPIs
    updateKPIs: () => {
        const prods = Object.values(STATE.products);
        const totalP = prods.reduce((acc, p) => acc + Object.values(p.sizes||{}).reduce((a,b)=>a+b,0), 0);
        Utils.$('#kpi-total-products').textContent = totalP;
        
        const low = prods.filter(p => Object.values(p.sizes||{}).reduce((a,b)=>a+b,0) < 5).length;
        Utils.$('#kpi-low-stock').textContent = low;

        // Calcular metros (suma de último movimiento de cada tela es ineficiente, mejor guardar saldo en cabecera, 
        // pero aquí iteramos movimientos para ser exactos con la "verdad única")
        // Simplificación: usaremos un campo calculado si existiera, si no 0.
        let totalMeters = 0;
        // En una implementación real, calcularíamos el balance.
        Utils.$('#kpi-fabric-meters').textContent = "Calc..."; 
    },

    // Render Órdenes
    renderOrders: () => {
        const container = Utils.$('#orders-list-container');
        container.innerHTML = '';
        
        const sortedOrders = Object.values(STATE.orders).sort((a,b) => new Date(b.created) - new Date(a.created));

        if(sortedOrders.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">No hay órdenes registradas</div>';
            return;
        }

        sortedOrders.forEach(o => {
            const row = document.createElement('div');
            row.style.cssText = "padding:15px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;";
            
            const badgeClass = o.status === 'DISPATCHED' ? 'background:#34C759; color:white;' : 'background:#FF9500; color:white;';
            const statusLabel = o.status === 'DISPATCHED' ? 'DESPACHADO' : 'EN PROCESO';

            row.innerHTML = `
                <div>
                    <div style="font-weight:700; font-size:16px;">${o.number} <span style="font-size:10px; padding:2px 6px; border-radius:4px; ${badgeClass}">${statusLabel}</span></div>
                    <div style="font-size:13px; color:#666;">Cliente: ${o.client}</div>
                    <div style="font-size:12px; color:#999;">Entrega: ${Utils.formatDate(o.deliveryDate)}</div>
                </div>
                <button class="btn-ios btn-secondary" onclick="UIRenderer.openOrderModal('${o.id}')">Ver / Editar</button>
            `;
            container.appendChild(row);
        });
    },

    // Render Panel Despacho
    renderDispatchSelection: () => {
        const list = Utils.$('#dispatch-orders-list');
        list.innerHTML = '';

        // Solo órdenes en proceso
        const activeOrders = Object.values(STATE.orders).filter(o => o.status === 'PROCESS');
        
        activeOrders.forEach(o => {
            const item = document.createElement('div');
            item.className = 'ios-card';
            item.style.padding = '15px';
            item.style.cursor = 'pointer';
            item.innerHTML = `
                <strong>${o.number}</strong><br>
                <small>${o.client}</small>
            `;
            item.onclick = () => {
                // Seleccionar visualmente
                Array.from(list.children).forEach(c => c.style.border = '1px solid transparent');
                item.style.border = '2px solid var(--ios-blue)';
                // Iniciar flujo
                DispatchModule.initDispatchConfig(o.id);
            };
            list.appendChild(item);
        });
    },

    renderDispatchPackingUI: () => {
        const container = Utils.$('#dispatch-configuration-area');
        const tempData = STATE.ui.tempDispatchData;
        if (!tempData) return;

        const order = STATE.orders[tempData.orderId];
        container.style.opacity = '1';
        container.style.pointerEvents = 'all';

        let html = `
            <div style="background:white; padding:15px; border-radius:10px; margin-bottom:15px; font-size:13px;">
                <strong>EMPAQUETADO:</strong> Factura ${tempData.invoice} | ${tempData.bundles.length} Bultos<br>
                <input type="file" id="dispatch-global-photo" accept="image/*" style="margin-top:10px;">
                <small style="color:gray;">Foto del despacho (Obligatoria)</small>
            </div>
            
            <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead>
                    <tr style="background:#f0f0f5; text-align:left;">
                        <th style="padding:8px;">Producto</th>
                        ${tempData.bundles.map(b => `<th style="padding:8px; text-align:center;">Caja ${b.id}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
        `;

        order.items.forEach((item, itemIdx) => {
            html += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px;">
                        ${item.sku} (${item.size})<br>
                        <span style="color:#666;">Total: ${item.qty}</span>
                    </td>
                    ${tempData.bundles.map((b, bundleIdx) => `
                        <td style="padding:8px; text-align:center;">
                            <input type="number" id="pacc-${itemIdx}-${bundleIdx}" 
                                   min="0" max="${item.qty}" 
                                   style="width:50px; text-align:center; padding:4px;" 
                                   placeholder="0">
                        </td>
                    `).join('')}
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        
        // Inyectar botón de acción ya existente en HTML base, o re-renderizarlo
        Utils.$('#bultos-container').innerHTML = html;
        
        // Asignar evento al botón existente
        const btn = Utils.$('#btn-generate-tacha');
        btn.onclick = DispatchModule.finalizeDispatch;
        btn.innerHTML = `Confirmar Despacho y Generar ${tempData.bundles.length} Etiquetas`;
    },

    // Modales Dinámicos
    openProductModal: (productId = null) => {
        const p = productId ? STATE.products[productId] : {};
        const isEdit = !!productId;

        // Generar campos de tallas dinámicamente
        const sizesInputs = APP_CONFIG.tallas.map(size => `
            <div style="display:flex; flex-direction:column; align-items:center;">
                <label style="font-size:10px;">${size}</label>
                <input type="number" id="stock_${size}" value="${p.sizes ? (p.sizes[size] || 0) : 0}" style="width:50px; text-align:center;">
            </div>
        `).join('');

        const formHtml = `
            <form id="product-form">
                <input type="hidden" id="prod-id" value="${p.id || ''}">
                <div style="margin-bottom:15px;">
                    <label>SKU (Código)</label>
                    <input type="text" id="prod-sku" value="${p.sku || ''}" required>
                </div>
                <div style="margin-bottom:15px;">
                    <label>Nombre</label>
                    <input type="text" id="prod-name" value="${p.name || ''}" required>
                </div>
                <div style="margin-bottom:15px;">
                    <label>Precio</label>
                    <input type="number" id="prod-price" value="${p.price || ''}">
                </div>
                
                <label>Inventario por Talla</label>
                <div style="display:flex; gap:5px; flex-wrap:wrap; background:#f9f9f9; padding:10px; border-radius:10px; margin-bottom:15px;">
                    ${sizesInputs}
                </div>

                <div style="margin-bottom:15px;">
                    <label>Notas / Mensajes</label>
                    <textarea id="prod-notes" rows="3">${p.notes || ''}</textarea>
                </div>
            </form>
        `;

        ModalManager.open(isEdit ? 'Editar Producto' : 'Nuevo Producto', formHtml, () => {
            if (!Utils.validateForm(Utils.$('#product-form'))) return;
            
            const data = {
                id: Utils.$('#prod-id').value,
                sku: Utils.$('#prod-sku').value,
                name: Utils.$('#prod-name').value,
                price: Utils.$('#prod-price').value,
                notes: Utils.$('#prod-notes').value
            };
            // Agregar stocks
            APP_CONFIG.tallas.forEach(size => {
                data[`stock_${size}`] = Utils.$(`#stock_${size}`).value;
            });

            InventoryModule.saveProduct(data);
        });
    },

    openOrderModal: (orderId = null) => {
        const o = orderId ? STATE.orders[orderId] : { items: [] };
        const isEdit = !!orderId;

        // Lógica para construir tabla de items editable
        // Simplificado: Textarea JSON o UI compleja. Haremos UI de filas agregables básica.
        let itemsHtml = o.items.map((item, idx) => `
            <div class="order-item-row" style="display:flex; gap:5px; margin-bottom:5px;">
                <input type="text" placeholder="SKU" class="item-sku" value="${item.sku}" style="flex:1;">
                <input type="text" placeholder="Talla" class="item-size" value="${item.size}" style="width:60px;">
                <input type="number" placeholder="Cant" class="item-qty" value="${item.qty}" style="width:60px;">
                <button type="button" onclick="this.parentElement.remove()" style="color:red;">&times;</button>
            </div>
        `).join('');

        const formHtml = `
            <form id="order-form">
                <input type="hidden" id="ord-id" value="${o.id || ''}">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
                    <div>
                        <label>Nº Orden</label>
                        <input type="text" id="ord-number" value="${o.number || ''}" required>
                    </div>
                    <div>
                        <label>Fecha Entrega</label>
                        <input type="date" id="ord-date" value="${o.deliveryDate || ''}" required>
                    </div>
                </div>
                <div style="margin-bottom:15px;">
                    <label>Cliente</label>
                    <input type="text" id="ord-client" value="${o.client || ''}" required>
                </div>
                
                <label>Productos (SKU | Talla | Cant)</label>
                <div id="order-items-container" style="background:#f9f9f9; padding:10px; border-radius:10px; margin-bottom:10px; max-height:200px; overflow-y:auto;">
                    ${itemsHtml}
                </div>
                <button type="button" class="btn-ios btn-secondary" onclick="UIRenderer.addOrderItemRow()" style="width:100%; margin-bottom:15px;">+ Agregar Producto</button>

                <div style="margin-bottom:15px;">
                    <label>Mensajes Globales</label>
                    <textarea id="ord-notes" rows="2">${o.globalNotes || ''}</textarea>
                </div>
                
                ${isEdit ? `
                <div style="margin-bottom:15px;">
                    <label>Estado</label>
                    <select id="ord-status">
                        <option value="PROCESS" ${o.status==='PROCESS'?'selected':''}>En Proceso</option>
                        <option value="DISPATCHED" ${o.status==='DISPATCHED'?'selected':''}>Despachado</option>
                    </select>
                </div>` : ''}
            </form>
        `;

        ModalManager.open(isEdit ? 'Editar Orden' : 'Nueva Orden', formHtml, () => {
            // Recolectar items
            const items = [];
            Utils.$$('.order-item-row').forEach(row => {
                const sku = row.querySelector('.item-sku').value;
                const qty = row.querySelector('.item-qty').value;
                if(sku && qty) {
                    items.push({
                        sku: sku,
                        size: row.querySelector('.item-size').value || 'U',
                        qty: parseInt(qty)
                    });
                }
            });

            if (items.length === 0) return Utils.showToast('Debe agregar al menos un producto', 'error');

            const data = {
                id: Utils.$('#ord-id').value,
                number: Utils.$('#ord-number').value,
                client: Utils.$('#ord-client').value,
                deliveryDate: Utils.$('#ord-date').value,
                globalNotes: Utils.$('#ord-notes').value,
                items: items,
                status: isEdit ? Utils.$('#ord-status').value : 'PROCESS'
            };

            OrdersModule.saveOrder(data);
        });
    },

    addOrderItemRow: () => {
        const div = document.createElement('div');
        div.className = 'order-item-row';
        div.style.cssText = "display:flex; gap:5px; margin-bottom:5px;";
        div.innerHTML = `
            <input type="text" placeholder="SKU" class="item-sku" style="flex:1;">
            <input type="text" placeholder="Talla" class="item-size" style="width:60px;">
            <input type="number" placeholder="Cant" class="item-qty" style="width:60px;">
            <button type="button" onclick="this.parentElement.remove()" style="color:red;">&times;</button>
        `;
        Utils.$('#order-items-container').appendChild(div);
    }
};

const ModalManager = {
    open: (title, contentHtml, onSave) => {
        Utils.$('#modal-title').textContent = title;
        Utils.$('#modal-body').innerHTML = contentHtml;
        const overlay = Utils.$('#modal-overlay');
        overlay.style.display = 'flex';
        setTimeout(() => overlay.classList.add('open'), 10);

        // Bind Save
        const saveBtn = Utils.$('#modal-btn-save');
        // Clonar nodo para eliminar listeners previos
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.onclick = onSave;

        STATE.ui.currentModal = overlay;
    },
    close: () => {
        const overlay = Utils.$('#modal-overlay');
        overlay.classList.remove('open');
        setTimeout(() => overlay.style.display = 'none', 300);
    }
};

// ============================================================================
// 9. EVENTOS Y NAVEGACIÓN
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    
    // Inicializar Firebase Listeners
    SyncLayer.init();

    // Navegación Sidebar
    Utils.$$('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // UI Switch
            Utils.$$('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active'); // Ojo: si hay click dentro del SVG, usar e.currentTarget
            
            const viewId = btn.getAttribute('data-view');
            STATE.ui.currentView = viewId;

            // Ocultar todas las secciones
            Utils.$$('.view-section').forEach(sec => sec.classList.remove('active'));
            
            // Mostrar la seleccionada
            const target = Utils.$(`#view-${viewId}`);
            if (target) {
                target.classList.add('active');
                // Actualizar Título
                Utils.$('#view-title').textContent = btn.innerText.trim();
                
                // Disparar renders específicos si es necesario
                if(viewId === 'orders') UIRenderer.renderOrders();
                if(viewId === 'inventory') UIRenderer.renderInventory();
                if(viewId === 'dispatch') UIRenderer.renderDispatchSelection();
            }
        });
    });

    // Botones Globales
    Utils.$('#btn-global-add').addEventListener('click', () => {
        if(STATE.ui.currentView === 'inventory') UIRenderer.openProductModal();
        if(STATE.ui.currentView === 'orders') UIRenderer.openOrderModal();
    });

    Utils.$('#modal-close').addEventListener('click', ModalManager.close);
    Utils.$('#modal-btn-cancel').addEventListener('click', ModalManager.close);

    // Botones Auditoría y Cotización
    const auditBtn = Utils.$('#btn-generate-audit-pdf');
    if(auditBtn) auditBtn.addEventListener('click', PDFGenerator.generateAuditSnapshot);

    const quoteForm = Utils.$('#quote-form');
    if(quoteForm) {
        quoteForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Recolectar datos básicos de cotización (demo)
            const data = {
                client: Utils.$('#quote-client').value,
                date: Utils.$('#quote-date').value,
                items: [
                    // En producción, esto vendría de inputs dinámicos igual que órdenes
                    { desc: "Servicio de Confección Textil", qty: 100, price: 4500 }
                ]
            };
            PDFGenerator.generateQuote(data);
        });
    }

    // Inicializar Vista por defecto
    UIRenderer.renderInventory();
});

// ============================================================================
// FIN DE ARCHIVO
// ============================================================================
