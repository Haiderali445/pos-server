const mongoose = require("mongoose");

/**
 * Checks if an error is a MongoDB transient transaction error eligible for retry
 */
function isTransientError(error) {
  if (!error) return false;
  if (typeof error.hasErrorLabel === "function") {
    if (
      error.hasErrorLabel("TransientTransactionError") ||
      error.hasErrorLabel("UnknownTransactionCommitResult")
    ) {
      return true;
    }
  }
  // Error code 112 = WriteConflict
  if (error.code === 112 || error.message?.includes("WriteConflict")) {
    return true;
  }
  return false;
}

/**
 * Checks if MongoDB is running standalone without replica set support
 */
function isReplicaSetNotSupportedError(error) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    msg.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
    msg.includes("This MongoDB deployment does not support retryable writes") ||
    msg.includes("Standalone servers do not support transactions")
  );
}

/**
 * Delay helper with randomized jitter for exponential backoff
 */
const delay = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms + Math.floor(Math.random() * 50)));

/**
 * Transaction Lifecycle Context
 * Allows callers to register side effects that only execute upon successful commit
 */
class TransactionContext {
  constructor(session) {
    this.session = session;
    this._commitCallbacks = [];
    this._rollbackCallbacks = [];
  }

  onCommit(callback) {
    if (typeof callback === "function") {
      this._commitCallbacks.push(callback);
    }
  }

  onRollback(callback) {
    if (typeof callback === "function") {
      this._rollbackCallbacks.push(callback);
    }
  }

  async executeCommitHooks() {
    for (const cb of this._commitCallbacks) {
      try {
        await cb();
      } catch (err) {
        console.error("[UnitOfWork] Error in onCommit lifecycle hook:", err);
      }
    }
  }

  async executeRollbackHooks(error) {
    for (const cb of this._rollbackCallbacks) {
      try {
        await cb(error);
      } catch (err) {
        console.error("[UnitOfWork] Error in onRollback lifecycle hook:", err);
      }
    }
  }
}

/**
 * Enterprise UnitOfWork
 * Manages atomic transactions across MongoDB replica sets with retry resilience,
 * standalone fallback, and lifecycle hook dispatch.
 */
class UnitOfWork {
  constructor() {
    this.defaultOptions = {
      maxRetries: 3,
      initialDelayMs: 100,
      transactionOptions: {
        readConcern: { level: "majority" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      },
    };
  }

  /**
   * Executes a work function inside an ACID MongoDB transaction session.
   *
   * @param {Function} workFn Function to execute: (session, context) => Promise<any>
   * @param {Object} [options] Transaction configuration options
   * @returns {Promise<any>} Result of workFn
   */
  async runInTransaction(workFn, options = {}) {
    const config = {
      ...this.defaultOptions,
      ...options,
      transactionOptions: {
        ...this.defaultOptions.transactionOptions,
        ...(options.transactionOptions || {}),
      },
    };

    // If an active session is already supplied (nested call), participate in existing session
    if (options.session && options.session.inTransaction && options.session.inTransaction()) {
      const nestedContext = new TransactionContext(options.session);
      return workFn(options.session, nestedContext);
    }

    let attempt = 0;

    while (attempt < config.maxRetries) {
      attempt++;
      let session = null;

      try {
        session = await mongoose.startSession();
      } catch (startSessionErr) {
        if (isReplicaSetNotSupportedError(startSessionErr)) {
          console.warn(
            "[UnitOfWork] Standalone MongoDB detected: executing operation without replica set session."
          );
          const fallbackContext = new TransactionContext(null);
          const result = await workFn(null, fallbackContext);
          await fallbackContext.executeCommitHooks();
          return result;
        }
        throw startSessionErr;
      }

      const context = new TransactionContext(session);

      try {
        session.startTransaction(config.transactionOptions);

        const result = await workFn(session, context);

        if (session.inTransaction()) {
          await session.commitTransaction();
        }

        // Execute commit callbacks once transaction is successfully committed to disk
        await context.executeCommitHooks();
        return result;
      } catch (error) {
        if (session && session.inTransaction()) {
          try {
            await session.abortTransaction();
          } catch (abortErr) {
            console.error("[UnitOfWork] Error while aborting transaction:", abortErr.message);
          }
        }

        await context.executeRollbackHooks(error);

        // Standalone MongoDB fallback if transaction is not supported
        if (isReplicaSetNotSupportedError(error)) {
          console.warn(
            "[UnitOfWork] Standalone MongoDB detected during transaction start: executing operation directly."
          );
          await session.endSession();
          const fallbackContext = new TransactionContext(null);
          const result = await workFn(null, fallbackContext);
          await fallbackContext.executeCommitHooks();
          return result;
        }

        // Check if transient error and should retry
        if (isTransientError(error) && attempt < config.maxRetries) {
          const backoff = config.initialDelayMs * Math.pow(2, attempt - 1);
          console.warn(
            `[UnitOfWork] Transient error encountered on attempt ${attempt}/${config.maxRetries}. Retrying in ${backoff}ms...`
          );
          await delay(backoff);
          continue;
        }

        throw error;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }
  }
}

const unitOfWork = new UnitOfWork();

module.exports = {
  UnitOfWork,
  TransactionContext,
  unitOfWork,
};
