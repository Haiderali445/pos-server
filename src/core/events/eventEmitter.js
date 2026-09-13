const EventEmitter = require("events");
const { EVENT_TYPES } = require("./eventTypes");

class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.setupInternalHandlers();
  }

  setupInternalHandlers() {
    this.on(EVENT_TYPES.SALE_COMPLETED, (event) => {
      // Async side-effect: log or evaluate low stock
      if (process.env.NODE_ENV !== "test") {
        console.log(`[EventBus] Sale completed for invoice #${event.invoiceId} (Tenant: ${event.tenantId})`);
      }
    });

    this.on(EVENT_TYPES.STOCK_LOW, (event) => {
      console.warn(`[EventBus Alert] Low stock detected for product ${event.productName} (Qty: ${event.currentStock})`);
    });
  }

  emitEvent(eventType, payload) {
    this.emit(eventType, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
}

const appEvents = new AppEventEmitter();

module.exports = { appEvents, AppEventEmitter };
